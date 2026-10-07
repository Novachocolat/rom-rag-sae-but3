import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LlmClient } from '../client/ollama/ollama.types.js'
import { OllamaUnavailableError } from '../client/ollama/ollama.error.js'
import { AppError } from '../lib/error.js'
import { loadPrompt, renderTemplate } from '../lib/prompt-loader.js'
import { prisma } from '../lib/prisma.js'
import { redis } from '../lib/redis.js'
import {
  buildAiCacheKey,
  getCachedIdentification,
  setCachedIdentification,
  type CachedIdentification,
} from '../storage/ai-cache.storage.js'
import {
  applyAcceptedIdentification,
  createProposal,
  findPendingProposalForRom,
  getProposal,
  updateProposalStatus,
} from '../storage/ai-proposal.storage.js'
import {
  findCandidateEntries,
  findEntriesByNormalizedName,
  listPlatforms,
} from '../storage/dat.storage.js'
import { findRomById, listUnidentifiedRomIds } from '../storage/rom.storage.js'
import {
  buildPromptVariables,
  checkCoherence,
  decide,
  findPlatform,
  identifyStoredRom,
  identifyUnidentifiedRoms,
  IDENTIFICATION_PROMPT,
  mergeCorrections,
  proposeIdentification,
  reviewProposal,
  statusFor,
  type IdentificationPorts,
  type PlatformInfo,
  type RomForIdentification,
} from './ai-identification.service.js'

vi.mock('../lib/prisma.js', () => ({ prisma: { $transaction: vi.fn() } }))
vi.mock('../lib/redis.js', () => ({ redis: { get: vi.fn(), set: vi.fn() } }))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../client/ollama/ollama-llm.client.js', () => ({
  ollamaLlmClient: { generateJson: vi.fn(), generateText: vi.fn() },
}))
vi.mock('../storage/ai-cache.storage.js', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../storage/ai-cache.storage.js')>()
  return {
    ...original,
    getCachedIdentification: vi.fn(),
    setCachedIdentification: vi.fn(),
  }
})
vi.mock('../storage/ai-proposal.storage.js', () => ({
  applyAcceptedIdentification: vi.fn(),
  createProposal: vi.fn(),
  findPendingProposalForRom: vi.fn(),
  getProposal: vi.fn(),
  updateProposalStatus: vi.fn(),
}))
vi.mock('../storage/dat.storage.js', () => ({
  findCandidateEntries: vi.fn(),
  findEntriesByNormalizedName: vi.fn(),
  listPlatforms: vi.fn(),
}))
vi.mock('../storage/rom.storage.js', () => ({
  findRomById: vi.fn(),
  listUnidentifiedRomIds: vi.fn(),
}))

const YEAR = 2026

const PLATFORMS: PlatformInfo[] = [
  {
    id: 'plat-gb',
    name: 'Nintendo Game Boy',
    slug: 'nintendo-game-boy',
    extensions: ['.gb'],
  },
  {
    id: 'plat-md',
    name: 'Sega Mega Drive',
    slug: 'sega-mega-drive',
    extensions: ['.md', '.bin'],
  },
]

// A coherent answer for a .gb ROM, overridable per test
function validIdentification(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Tetris',
    platform: 'Nintendo Game Boy',
    region: 'Europe',
    languages: ['en'],
    releaseYear: 1989,
    publisher: 'Nintendo',
    genre: 'Puzzle',
    confidence: 0.9,
    reasoning: 'The file name and the Game Boy extension agree.',
    ...overrides,
  }
}

const rom: RomForIdentification = {
  fileName: 'Tetris (World).gb',
  extension: '.gb',
  sizeBytes: 32768,
  platform: PLATFORMS[0] ?? null,
  candidates: ['Tetris (World)', 'Tetris Plus (Europe)'],
}

function buildPorts(overrides: Partial<IdentificationPorts> = {}) {
  const llm = {
    generateJson: vi.fn().mockResolvedValue({
      data: validIdentification(),
      raw: JSON.stringify(validIdentification()),
      model: 'gemma4:26b',
      durationMs: 1200,
      promptTokens: 300,
      completionTokens: 80,
      tokensPerSecond: 40,
      fromCache: false,
    }),
    generateText: vi.fn(),
  } satisfies LlmClient

  const ports: IdentificationPorts = {
    llm,
    model: 'gemma4:26b',
    renderPrompt: (variables) => `PROMPT for ${variables.fileName}`,
    cache: {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
    },
    titleInCatalog: vi.fn().mockResolvedValue(false),
    platforms: PLATFORMS,
    confidenceThreshold: 0.75,
    currentYear: YEAR,
    ...overrides,
  }
  return { ports, llm }
}

describe('buildPromptVariables', () => {
  it('fills every placeholder from the ROM context', () => {
    const variables = buildPromptVariables(rom)

    expect(variables).toEqual({
      fileName: 'Tetris (World).gb',
      extension: '.gb',
      sizeBytes: '32768',
      platformHint: 'Nintendo Game Boy (nintendo-game-boy)',
      candidates: '- Tetris (World)\n- Tetris Plus (Europe)',
    })
  })

  it('says so explicitly when there is no platform hint or no candidate', () => {
    const variables = buildPromptVariables({
      ...rom,
      platform: null,
      candidates: [],
    })

    expect(variables.platformHint).toMatch(/^unknown/)
    expect(variables.candidates).toBe('- none')
  })
})

// Keeps the shipped prompt and the variables it is filled with in sync
describe('identification prompt', () => {
  it('renders without a missing placeholder for a real ROM', () => {
    const template = loadPrompt(
      IDENTIFICATION_PROMPT.name,
      IDENTIFICATION_PROMPT.version,
    )

    const rendered = renderTemplate(template, buildPromptVariables(rom))

    expect(rendered).toContain('Tetris (World).gb')
    expect(rendered).not.toContain('{{')
  })
})

describe('findPlatform', () => {
  it('matches by name or slug, ignoring case', () => {
    expect(findPlatform('nintendo game boy', PLATFORMS)?.id).toBe('plat-gb')
    expect(findPlatform('SEGA-MEGA-DRIVE', PLATFORMS)?.id).toBe('plat-md')
  })

  it('returns null for a platform that does not exist', () => {
    expect(findPlatform('Atari 2600', PLATFORMS)).toBeNull()
  })
})

describe('checkCoherence', () => {
  it('reports no issue for a coherent identification', () => {
    expect(
      checkCoherence(validIdentification(), '.gb', PLATFORMS, YEAR),
    ).toEqual([])
  })

  it('rejects a platform incompatible with the file extension', () => {
    const issues = checkCoherence(
      validIdentification({ platform: 'Sega Mega Drive' }),
      '.gb',
      PLATFORMS,
      YEAR,
    )

    expect(issues).toEqual([
      'platform Sega Mega Drive does not use the extension .gb',
    ])
  })

  it('rejects a platform that is not in the catalog', () => {
    const issues = checkCoherence(
      validIdentification({ platform: 'Commodore 64' }),
      '.gb',
      PLATFORMS,
      YEAR,
    )

    expect(issues).toEqual(['unknown platform "Commodore 64"'])
  })

  it('accepts a missing platform, since the model made no claim', () => {
    expect(
      checkCoherence(
        validIdentification({ platform: null }),
        '.gb',
        PLATFORMS,
        YEAR,
      ),
    ).toEqual([])
  })

  it.each([
    ['before 1970', 1969],
    ['after the current year', YEAR + 1],
  ])('rejects a release year %s', (_label, releaseYear) => {
    const issues = checkCoherence(
      validIdentification({ releaseYear }),
      '.gb',
      PLATFORMS,
      YEAR,
    )

    expect(issues).toHaveLength(1)
    expect(issues[0]).toContain('release year')
  })

  it('rejects an empty title', () => {
    expect(
      checkCoherence(
        validIdentification({ title: '   ' }),
        '.gb',
        PLATFORMS,
        YEAR,
      ),
    ).toEqual(['no title proposed'])
  })

  it('rejects an implausibly long title', () => {
    const issues = checkCoherence(
      validIdentification({ title: 'x'.repeat(201) }),
      '.gb',
      PLATFORMS,
      YEAR,
    )

    expect(issues[0]).toContain('title longer than')
  })

  it('rejects language codes the app does not know', () => {
    const issues = checkCoherence(
      validIdentification({ languages: ['en', 'klingon'] }),
      '.gb',
      PLATFORMS,
      YEAR,
    )

    expect(issues).toEqual(['unknown language codes: klingon'])
  })
})

describe('decide and statusFor', () => {
  it('rejects any proposal with an issue, whatever its confidence', () => {
    expect(decide(['some issue'], 1, 0.75)).toBe('REJECTED')
  })

  it('proposes a coherent answer at or above the threshold', () => {
    expect(decide([], 0.75, 0.75)).toBe('PROPOSED')
  })

  it('keeps a coherent but unsure answer as LOW_CONFIDENCE', () => {
    expect(decide([], 0.5, 0.75)).toBe('LOW_CONFIDENCE')
  })

  it('only a PROPOSED decision waits for a human', () => {
    expect(statusFor('PROPOSED')).toBe('PENDING')
    expect(statusFor('LOW_CONFIDENCE')).toBe('REJECTED')
    expect(statusFor('REJECTED')).toBe('REJECTED')
  })
})

describe('proposeIdentification', () => {
  it('calls the model with the rendered prompt and the Zod-derived schema, then caches the answer', async () => {
    const { ports, llm } = buildPorts()

    const outcome = await proposeIdentification(rom, ports)

    expect(llm.generateJson).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: 'PROMPT for Tetris (World).gb' }),
    )
    expect(ports.cache.set).toHaveBeenCalledWith(
      expect.stringMatching(/^ai:identification:[0-9a-f]{64}$/),
      expect.objectContaining({ raw: expect.any(String) }),
    )
    expect(outcome.decision).toBe('PROPOSED')
    expect(outcome.fromCache).toBe(false)
  })

  it('serves a cache hit without calling the model', async () => {
    const cached: CachedIdentification = {
      data: validIdentification(),
      raw: '{}',
      model: 'gemma4:26b',
      durationMs: 1,
      promptTokens: 1,
      completionTokens: 1,
      tokensPerSecond: 1,
    }
    const { ports, llm } = buildPorts({
      cache: {
        get: vi.fn().mockResolvedValue(cached),
        set: vi.fn(),
      },
    })

    const outcome = await proposeIdentification(rom, ports)

    expect(llm.generateJson).not.toHaveBeenCalled()
    expect(outcome.fromCache).toBe(true)
    expect(outcome.decision).toBe('PROPOSED')
  })

  it('changes the cache key when the prompt version changes', async () => {
    const withV1 = buildAiCacheKey({
      kind: 'identification',
      model: 'gemma4:26b',
      promptName: 'identification',
      promptVersion: 'v1',
      renderedPrompt: 'same text',
    })
    const withV2 = buildAiCacheKey({
      kind: 'identification',
      model: 'gemma4:26b',
      promptName: 'identification',
      promptVersion: 'v2',
      renderedPrompt: 'same text',
    })

    expect(withV1).not.toBe(withV2)
  })

  it('raises the confidence when the title exists in an imported catalog', async () => {
    const { ports } = buildPorts({
      titleInCatalog: vi.fn().mockResolvedValue(true),
    })

    const outcome = await proposeIdentification(rom, ports)

    expect(outcome.confidence).toBeCloseTo(1.0)
  })

  it('caps the boosted confidence at 1', async () => {
    const { ports, llm } = buildPorts({
      titleInCatalog: vi.fn().mockResolvedValue(true),
    })
    llm.generateJson.mockResolvedValue({
      data: validIdentification({ confidence: 0.98 }),
      raw: '{}',
      model: 'gemma4:26b',
      durationMs: 1,
      promptTokens: 1,
      completionTokens: 1,
      tokensPerSecond: 1,
      fromCache: false,
    })

    const outcome = await proposeIdentification(rom, ports)

    expect(outcome.confidence).toBe(1)
  })

  it('rejects an incoherent proposal even when the model is very confident', async () => {
    const { ports, llm } = buildPorts()
    llm.generateJson.mockResolvedValue({
      data: validIdentification({
        platform: 'Sega Mega Drive',
        confidence: 0.99,
      }),
      raw: '{}',
      model: 'gemma4:26b',
      durationMs: 1,
      promptTokens: 1,
      completionTokens: 1,
      tokensPerSecond: 1,
      fromCache: false,
    })

    const outcome = await proposeIdentification(rom, ports)

    expect(outcome.decision).toBe('REJECTED')
    expect(outcome.issues).toHaveLength(1)
  })

  it('keeps a coherent answer below the threshold as LOW_CONFIDENCE', async () => {
    const { ports, llm } = buildPorts()
    llm.generateJson.mockResolvedValue({
      data: validIdentification({ confidence: 0.4 }),
      raw: '{}',
      model: 'gemma4:26b',
      durationMs: 1,
      promptTokens: 1,
      completionTokens: 1,
      tokensPerSecond: 1,
      fromCache: false,
    })

    const outcome = await proposeIdentification(rom, ports)

    expect(outcome.decision).toBe('LOW_CONFIDENCE')
  })
})

describe('mergeCorrections', () => {
  it('overrides only the corrected fields', () => {
    const merged = mergeCorrections(validIdentification(), {
      title: 'Tetris (Rev A)',
    })

    expect(merged.title).toBe('Tetris (Rev A)')
    expect(merged.publisher).toBe('Nintendo')
    expect(merged.confidence).toBe(0.9)
  })
})

describe('identifyStoredRom', () => {
  const storedRom = {
    id: 'rom-1',
    userId: 'user-1',
    fileName: 'Tetris (World).gb',
    sizeBytes: 32768n,
    platformId: 'plat-gb',
    identificationSource: 'UNIDENTIFIED',
  }

  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(listPlatforms).mockResolvedValue(PLATFORMS as never)
    vi.mocked(findCandidateEntries).mockResolvedValue([
      { gameName: 'Tetris (World)' },
    ])
    vi.mocked(findEntriesByNormalizedName).mockResolvedValue([])
    vi.mocked(findPendingProposalForRom).mockResolvedValue(null)
    vi.mocked(getCachedIdentification).mockResolvedValue(null)
    vi.mocked(setCachedIdentification).mockResolvedValue(undefined)
    vi.mocked(findRomById).mockResolvedValue(storedRom as never)
    vi.mocked(createProposal).mockImplementation(((input: object) =>
      Promise.resolve({ id: 'prop-1', ...input })) as never)
  })

  it('answers 404 for a ROM owned by someone else', async () => {
    vi.mocked(findRomById).mockResolvedValue({
      ...storedRom,
      userId: 'other',
    } as never)

    await expect(identifyStoredRom('rom-1', 'user-1')).rejects.toMatchObject({
      statusCode: 404,
      code: 'ROM_NOT_FOUND',
    })
  })

  it('refuses to identify a ROM already identified by a catalog', async () => {
    vi.mocked(findRomById).mockResolvedValue({
      ...storedRom,
      identificationSource: 'DAT_SHA1',
    } as never)

    await expect(identifyStoredRom('rom-1', 'user-1')).rejects.toMatchObject({
      statusCode: 409,
      code: 'ROM_ALREADY_IDENTIFIED',
    })
  })

  it('refuses a second proposal while one is still pending', async () => {
    vi.mocked(findPendingProposalForRom).mockResolvedValue({
      id: 'old',
    } as never)

    await expect(identifyStoredRom('rom-1', 'user-1')).rejects.toMatchObject({
      statusCode: 409,
      code: 'PROPOSAL_ALREADY_PENDING',
    })
  })

  it('records a coherent answer as a PENDING proposal, leaving the ROM untouched', async () => {
    vi.mocked(redis.get).mockResolvedValue(null)
    const llmJson = await import('../client/ollama/ollama-llm.client.js')
    vi.mocked(llmJson.ollamaLlmClient.generateJson).mockResolvedValue({
      data: validIdentification(),
      raw: '{}',
      model: 'gemma4:26b',
      durationMs: 1,
      promptTokens: 1,
      completionTokens: 1,
      tokensPerSecond: 1,
      fromCache: false,
    } as never)

    await identifyStoredRom('rom-1', 'user-1')

    expect(createProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        romId: 'rom-1',
        status: 'PENDING',
        payload: expect.objectContaining({ source: 'AI_PROPOSED' }),
      }),
    )
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('records an incoherent answer as a REJECTED proposal for audit', async () => {
    const llmJson = await import('../client/ollama/ollama-llm.client.js')
    vi.mocked(llmJson.ollamaLlmClient.generateJson).mockResolvedValue({
      data: validIdentification({ platform: 'Sega Mega Drive' }),
      raw: '{}',
      model: 'gemma4:26b',
      durationMs: 1,
      promptTokens: 1,
      completionTokens: 1,
      tokensPerSecond: 1,
      fromCache: false,
    } as never)

    await identifyStoredRom('rom-1', 'user-1')

    expect(createProposal).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'REJECTED' }),
    )
  })
})

describe('reviewProposal', () => {
  const pending = {
    id: 'prop-1',
    romId: 'rom-1',
    status: 'PENDING',
    confidence: 0.9,
    payload: { identification: validIdentification() },
    rom: { id: 'rom-1', userId: 'user-1', fileName: 'Tetris (World).gb' },
  }

  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(listPlatforms).mockResolvedValue(PLATFORMS as never)
  })

  it('answers 404 for a proposal owned by someone else', async () => {
    vi.mocked(getProposal).mockResolvedValue({
      ...pending,
      rom: { ...pending.rom, userId: 'other' },
    } as never)

    await expect(
      reviewProposal('prop-1', 'user-1', { action: 'reject' }),
    ).rejects.toMatchObject({ statusCode: 404, code: 'PROPOSAL_NOT_FOUND' })
  })

  it('answers 409 when the proposal was already reviewed', async () => {
    vi.mocked(getProposal).mockResolvedValue({
      ...pending,
      status: 'ACCEPTED',
    } as never)

    await expect(
      reviewProposal('prop-1', 'user-1', { action: 'accept' }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'PROPOSAL_ALREADY_REVIEWED',
    })
  })

  it('rejects a proposal without touching the ROM', async () => {
    vi.mocked(getProposal).mockResolvedValue(pending as never)

    const result = await reviewProposal('prop-1', 'user-1', {
      action: 'reject',
    })

    expect(result).toEqual({ status: 'REJECTED' })
    expect(updateProposalStatus).toHaveBeenCalledWith(
      'prop-1',
      'REJECTED',
      'user-1',
    )
    expect(applyAcceptedIdentification).not.toHaveBeenCalled()
  })

  it('accepts a proposal and promotes the ROM to USER_CONFIRMED', async () => {
    vi.mocked(getProposal).mockResolvedValue(pending as never)

    const result = await reviewProposal('prop-1', 'user-1', {
      action: 'accept',
    })

    expect(result).toEqual({ status: 'ACCEPTED' })
    expect(applyAcceptedIdentification).toHaveBeenCalledWith(
      'prop-1',
      'user-1',
      'rom-1',
      expect.objectContaining({
        title: 'Tetris',
        platformId: 'plat-gb',
        identificationSource: 'USER_CONFIRMED',
      }),
    )
  })

  it('applies corrections, then checks them with the same coherence rules', async () => {
    vi.mocked(getProposal).mockResolvedValue(pending as never)

    await expect(
      reviewProposal('prop-1', 'user-1', {
        action: 'accept',
        corrections: { platform: 'Sega Mega Drive' },
      }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_CORRECTION' })
    expect(applyAcceptedIdentification).not.toHaveBeenCalled()
  })

  it('refuses to accept when the corrected title is removed', async () => {
    vi.mocked(getProposal).mockResolvedValue(pending as never)

    await expect(
      reviewProposal('prop-1', 'user-1', {
        action: 'accept',
        corrections: { title: null },
      }),
    ).rejects.toBeInstanceOf(AppError)
  })
})

describe('identifyUnidentifiedRoms', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(listPlatforms).mockResolvedValue(PLATFORMS as never)
    vi.mocked(findCandidateEntries).mockResolvedValue([])
    vi.mocked(findEntriesByNormalizedName).mockResolvedValue([])
    vi.mocked(findPendingProposalForRom).mockResolvedValue(null)
    vi.mocked(getCachedIdentification).mockResolvedValue(null)
    vi.mocked(findRomById).mockResolvedValue({
      id: 'rom-a',
      userId: 'user-1',
      fileName: 'Tetris (World).gb',
      sizeBytes: 32768n,
      platformId: 'plat-gb',
      identificationSource: 'UNIDENTIFIED',
    } as never)
  })

  it('stops the batch as soon as Ollama is unreachable', async () => {
    vi.mocked(listUnidentifiedRomIds).mockResolvedValue(['rom-a', 'rom-b'])
    const llmJson = await import('../client/ollama/ollama-llm.client.js')
    vi.mocked(llmJson.ollamaLlmClient.generateJson).mockRejectedValue(
      new OllamaUnavailableError('down'),
    )

    const result = await identifyUnidentifiedRoms(
      'user-1',
      new AbortController().signal,
    )

    expect(result.attempted).toBe(1)
    expect(findRomById).toHaveBeenCalledTimes(1)
  })

  it('does nothing when the batch was already aborted', async () => {
    vi.mocked(listUnidentifiedRomIds).mockResolvedValue(['rom-a'])
    const controller = new AbortController()
    controller.abort()

    const result = await identifyUnidentifiedRoms('user-1', controller.signal)

    expect(result.attempted).toBe(0)
    expect(findRomById).not.toHaveBeenCalled()
  })
})
