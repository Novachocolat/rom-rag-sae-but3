import { romIdentificationSchema } from '@repo/shared/schemas'
import type { ProposalCorrections, RomIdentification } from '@repo/shared/types'
import { env } from '../env.js'
import type { LlmClient } from '../client/ollama/ollama.types.js'
import { AppError } from '../lib/error.js'
import { loadPrompt, renderTemplate } from '../lib/prompt-loader.js'
import { prisma } from '../lib/prisma.js'
import { logger } from '../lib/logger.js'
import {
  isKnownLanguageCode,
  normalizeTitle,
} from './title-normalizer.service.js'
import {
  guessPlatformFromExtension,
  normalizeExtension,
} from './rom-file.service.js'
import {
  findCandidateEntries,
  findEntriesByNormalizedName,
  listPlatforms,
} from '../storage/dat.storage.js'
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
  type ProposalStatus,
} from '../storage/ai-proposal.storage.js'
import { findRomById, listUnidentifiedRomIds } from '../storage/rom.storage.js'
import {
  OllamaTimeoutError,
  OllamaUnavailableError,
} from '../client/ollama/ollama.error.js'
import { ollamaLlmClient } from '../client/ollama/ollama-llm.client.js'

export const IDENTIFICATION_PROMPT = { name: 'identification', version: 'v1' }

const CANDIDATE_LIMIT = 5
const MIN_RELEASE_YEAR = 1970
const MAX_TITLE_LENGTH = 200
// Found in an imported catalog: the title is real, so the model is more likely right
const CATALOG_CONFIDENCE_BOOST = 0.1

export interface PlatformInfo {
  id: string
  name: string
  slug: string
  extensions: string[]
}

export interface RomForIdentification {
  fileName: string
  extension: string // dot included, lowercase
  sizeBytes: number
  platform: PlatformInfo | null // deduced from the ROM or its extension
  candidates: string[] // closest catalog names, to anchor the model
}

// Fills the placeholders of prompts/identification.v1.md
export function buildPromptVariables(
  rom: RomForIdentification,
): Record<string, string> {
  return {
    fileName: rom.fileName,
    extension: rom.extension,
    sizeBytes: String(rom.sizeBytes),
    platformHint: rom.platform
      ? `${rom.platform.name} (${rom.platform.slug})`
      : 'unknown (the extension does not decide it)',
    candidates:
      rom.candidates.length > 0
        ? rom.candidates.map((name) => `- ${name}`).join('\n')
        : '- none',
  }
}

// The model may answer with a platform name or its slug, in any casing
export function findPlatform(
  proposed: string,
  platforms: PlatformInfo[],
): PlatformInfo | null {
  const needle = proposed.trim().toLowerCase()
  return (
    platforms.find(
      (platform) =>
        platform.name.toLowerCase() === needle ||
        platform.slug.toLowerCase() === needle,
    ) ?? null
  )
}

/**
 * Structural checks are already done by Zod; these are the coherence checks
 * the model cannot be trusted to get right on its own. Returns the reasons a
 * proposal must be rejected, empty when it is coherent.
 */
export function checkCoherence(
  identification: RomIdentification,
  extension: string,
  platforms: PlatformInfo[],
  currentYear: number,
): string[] {
  const issues: string[] = []

  const title = identification.title?.trim() ?? ''
  if (title.length === 0) {
    issues.push('no title proposed')
  } else if (title.length > MAX_TITLE_LENGTH) {
    issues.push(`title longer than ${MAX_TITLE_LENGTH} characters`)
  }

  if (identification.platform !== null) {
    const platform = findPlatform(identification.platform, platforms)
    if (!platform) {
      issues.push(`unknown platform "${identification.platform}"`)
    } else if (
      !platform.extensions.map((e) => e.toLowerCase()).includes(extension)
    ) {
      issues.push(
        `platform ${platform.name} does not use the extension ${extension}`,
      )
    }
  }

  const year = identification.releaseYear
  if (year !== null && (year < MIN_RELEASE_YEAR || year > currentYear)) {
    issues.push(
      `release year ${year} outside ${MIN_RELEASE_YEAR}-${currentYear}`,
    )
  }

  const unknownLanguages = identification.languages.filter(
    (code) => !isKnownLanguageCode(code),
  )
  if (unknownLanguages.length > 0) {
    issues.push(`unknown language codes: ${unknownLanguages.join(', ')}`)
  }

  return issues
}

export type IdentificationDecision = 'PROPOSED' | 'LOW_CONFIDENCE' | 'REJECTED'

// A proposal with any coherence issue is rejected outright; a coherent one is
// proposed only when the model is confident enough
export function decide(
  issues: string[],
  confidence: number,
  threshold: number,
): IdentificationDecision {
  if (issues.length > 0) return 'REJECTED'
  return confidence >= threshold ? 'PROPOSED' : 'LOW_CONFIDENCE'
}

// Maps a decision to the status the proposal is stored with: only a PROPOSED
// one waits for a human; the others are kept for audit only
export function statusFor(decision: IdentificationDecision): ProposalStatus {
  return decision === 'PROPOSED' ? 'PENDING' : 'REJECTED'
}

export interface IdentificationPorts {
  llm: LlmClient
  model: string
  renderPrompt: (variables: Record<string, string>) => string
  cache: {
    get(key: string): Promise<CachedIdentification | null>
    set(key: string, value: CachedIdentification): Promise<void>
  }
  titleInCatalog: (title: string, extension: string) => Promise<boolean>
  platforms: PlatformInfo[]
  confidenceThreshold: number
  currentYear: number
}

export interface IdentificationOutcome {
  decision: IdentificationDecision
  identification: RomIdentification
  confidence: number
  issues: string[]
  raw: string
  model: string
  durationMs: number
  promptTokens: number
  completionTokens: number
  fromCache: boolean
}

/**
 * Asks the model to identify a ROM and runs every check on its answer.
 * Pure orchestration: the LLM, cache and catalog are injected through `ports`.
 */
export async function proposeIdentification(
  rom: RomForIdentification,
  ports: IdentificationPorts,
): Promise<IdentificationOutcome> {
  const renderedPrompt = ports.renderPrompt(buildPromptVariables(rom))
  const cacheKey = buildAiCacheKey({
    kind: 'identification',
    model: ports.model,
    promptName: IDENTIFICATION_PROMPT.name,
    promptVersion: IDENTIFICATION_PROMPT.version,
    renderedPrompt,
  })

  let entry: CachedIdentification
  let fromCache: boolean

  const cached = await ports.cache.get(cacheKey)
  if (cached) {
    entry = cached
    fromCache = true
  } else {
    const fresh = await ports.llm.generateJson({
      prompt: renderedPrompt,
      schema: romIdentificationSchema,
    })
    entry = {
      data: fresh.data,
      raw: fresh.raw,
      model: fresh.model,
      durationMs: fresh.durationMs,
      promptTokens: fresh.promptTokens,
      completionTokens: fresh.completionTokens,
      tokensPerSecond: fresh.tokensPerSecond,
    }
    await ports.cache.set(cacheKey, entry)
    fromCache = false
  }

  const identification = entry.data
  const issues = checkCoherence(
    identification,
    rom.extension,
    ports.platforms,
    ports.currentYear,
  )

  let confidence = identification.confidence
  const title = identification.title?.trim()
  if (title && (await ports.titleInCatalog(title, rom.extension))) {
    confidence = Math.min(1, confidence + CATALOG_CONFIDENCE_BOOST)
  }

  return {
    decision: decide(issues, confidence, ports.confidenceThreshold),
    identification,
    confidence,
    issues,
    raw: entry.raw,
    model: entry.model,
    durationMs: entry.durationMs,
    promptTokens: entry.promptTokens,
    completionTokens: entry.completionTokens,
    fromCache,
  }
}

// Applies a reviewer's corrections on top of the model's answer
export function mergeCorrections(
  identification: RomIdentification,
  corrections: ProposalCorrections,
): RomIdentification {
  return { ...identification, ...corrections }
}

// Builds the real ports: Ollama, Redis cache, DAT catalogs and the prompt file
function buildRealPorts(platforms: PlatformInfo[]): IdentificationPorts {
  const template = loadPrompt(
    IDENTIFICATION_PROMPT.name,
    IDENTIFICATION_PROMPT.version,
  )

  return {
    llm: ollamaLlmClient,
    model: env.OLLAMA_LLM_MODEL,
    renderPrompt: (variables) => renderTemplate(template, variables),
    cache: { get: getCachedIdentification, set: setCachedIdentification },
    titleInCatalog: async (title, extension) =>
      (
        await findEntriesByNormalizedName(
          { prisma },
          normalizeTitle(title).baseTitle,
          extension,
        )
      ).length > 0,
    platforms,
    confidenceThreshold: env.AI_CONFIDENCE_THRESHOLD,
    currentYear: new Date().getFullYear(),
  }
}

async function loadPlatforms(): Promise<PlatformInfo[]> {
  return listPlatforms({ prisma })
}

// Resolves the platform of a stored ROM: its own one, else the only one whose extension matches
function resolvePlatform(
  platformId: string | null,
  extension: string,
  platforms: PlatformInfo[],
): PlatformInfo | null {
  if (platformId) {
    return platforms.find((platform) => platform.id === platformId) ?? null
  }
  const [onlyMatch, ...others] = guessPlatformFromExtension(
    extension,
    platforms,
  )
  if (onlyMatch === undefined || others.length > 0) return null
  return platforms.find((platform) => platform.id === onlyMatch) ?? null
}

/**
 * Identifies one stored ROM and records the result as a proposal.
 * The ROM itself is only touched when a reviewer accepts the proposal.
 */
export async function identifyStoredRom(romId: string, userId: string) {
  const rom = await findRomById(romId)
  if (!rom || rom.userId !== userId) {
    throw AppError.notFound('ROM_NOT_FOUND', 'ROM not found')
  }
  if (rom.identificationSource !== 'UNIDENTIFIED') {
    throw AppError.conflict(
      'ROM_ALREADY_IDENTIFIED',
      'ROM is already identified and cannot be re-identified by AI',
    )
  }
  if (await findPendingProposalForRom(romId)) {
    throw AppError.conflict(
      'PROPOSAL_ALREADY_PENDING',
      'ROM already has a proposal waiting for review',
    )
  }

  const extension = normalizeExtension(rom.fileName)
  const platforms = await loadPlatforms()
  const platform = resolvePlatform(rom.platformId, extension, platforms)

  const similar = await findCandidateEntries(
    { prisma },
    {
      normalizedName: normalizeTitle(rom.fileName).baseTitle,
      extension,
      platformId: platform?.id ?? null,
    },
    CANDIDATE_LIMIT,
  )

  const outcome = await proposeIdentification(
    {
      fileName: rom.fileName,
      extension,
      sizeBytes: Number(rom.sizeBytes),
      platform,
      candidates: similar.map((entry) => entry.gameName),
    },
    buildRealPorts(platforms),
  )

  const proposal = await createProposal({
    romId,
    payload: {
      identification: outcome.identification,
      issues: outcome.issues,
      decision: outcome.decision,
      lowConfidence: outcome.decision === 'LOW_CONFIDENCE',
      source: 'AI_PROPOSED',
    },
    rawResponse: outcome.raw,
    model: outcome.model,
    promptName: IDENTIFICATION_PROMPT.name,
    promptVersion: IDENTIFICATION_PROMPT.version,
    confidence: outcome.confidence,
    status: statusFor(outcome.decision),
    durationMs: Math.round(outcome.durationMs),
    promptTokens: outcome.promptTokens,
    completionTokens: outcome.completionTokens,
  })

  return proposal
}

/**
 * Accepts or rejects a pending proposal. Only an accept writes into the ROM,
 * and corrections go through the same coherence checks as the model's answer.
 */
export async function reviewProposal(
  proposalId: string,
  userId: string,
  review: { action: 'accept' | 'reject'; corrections?: ProposalCorrections },
) {
  const proposal = await getProposal(proposalId)
  if (!proposal || proposal.rom?.userId !== userId) {
    throw AppError.notFound('PROPOSAL_NOT_FOUND', 'Proposal not found')
  }
  if (proposal.status !== 'PENDING') {
    throw AppError.conflict(
      'PROPOSAL_ALREADY_REVIEWED',
      'Proposal has already been reviewed',
    )
  }

  if (review.action === 'reject') {
    await updateProposalStatus(proposalId, 'REJECTED', userId)
    return { status: 'REJECTED' as const }
  }

  const payload = proposal.payload as { identification: RomIdentification }
  const identification = mergeCorrections(
    payload.identification,
    review.corrections ?? {},
  )
  const extension = normalizeExtension(proposal.rom?.fileName ?? '')
  const platforms = await loadPlatforms()

  const issues = checkCoherence(
    identification,
    extension,
    platforms,
    new Date().getFullYear(),
  )
  if (issues.length > 0 || identification.title === null) {
    throw AppError.badRequest(
      'INVALID_CORRECTION',
      'Corrected identification is not coherent',
      { issues },
    )
  }

  const platform = identification.platform
    ? findPlatform(identification.platform, platforms)
    : null

  await applyAcceptedIdentification(proposalId, userId, proposal.romId ?? '', {
    title: identification.title,
    platformId: platform?.id,
    region: identification.region,
    languages: identification.languages,
    releaseYear: identification.releaseYear,
    publisher: identification.publisher,
    genre: identification.genre,
    identificationSource: 'USER_CONFIRMED',
    confidence: proposal.confidence,
  })
  return { status: 'ACCEPTED' as const }
}

// Identifies every UNIDENTIFIED ROM of a user, one at a time to respect Ollama.
// Stops early when Ollama is unreachable instead of failing each ROM in turn.
export async function identifyUnidentifiedRoms(
  userId: string,
  signal: AbortSignal,
): Promise<{ attempted: number }> {
  const romIds = await listUnidentifiedRomIds(userId)
  let attempted = 0

  for (const romId of romIds) {
    if (signal.aborted) break
    attempted += 1
    try {
      await identifyStoredRom(romId, userId)
    } catch (err) {
      if (
        err instanceof OllamaUnavailableError ||
        err instanceof OllamaTimeoutError
      ) {
        logger.warn('AI batch stopped: Ollama is not answering', { romId })
        break
      }
      logger.error('AI identification failed for a ROM', {
        romId,
        stack: err instanceof Error ? err.stack : String(err),
      })
    }
  }

  return { attempted }
}
