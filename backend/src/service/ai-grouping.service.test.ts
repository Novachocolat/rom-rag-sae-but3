import type { CollectionGrouping } from '@repo/shared/types'
import { describe, expect, it, vi } from 'vitest'
import {
  buildGroupingVariables,
  ClusterTooLargeError,
  MAX_ROMS_PER_CALL,
  proposeGrouping,
  proposeGroupings,
  splitForPrompt,
  type ClusterRom,
  type GroupingPorts,
} from './ai-grouping.service.js'

function makeRoms(ids: string[]): ClusterRom[] {
  return ids.map((id) => ({
    id,
    fileName: `Tetris (${id}).gb`,
    platformName: 'Game Boy',
  }))
}

function makeIds(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `r${String(i)}`)
}

function makeGrouping(
  overrides: Partial<CollectionGrouping> = {},
): CollectionGrouping {
  return {
    sameGame: true,
    canonicalTitle: 'tetris',
    members: [
      { romId: 'a', variantLabel: 'USA', belongs: true },
      { romId: 'b', variantLabel: 'Europe', belongs: true },
      { romId: 'c', variantLabel: 'Japan', belongs: true },
    ],
    confidence: 0.9,
    reasoning: 'Same title in three regions',
    ...overrides,
  }
}

function makePorts(data: CollectionGrouping, confidenceThreshold = 0.75) {
  const generateJson = vi.fn().mockResolvedValue({
    data,
    raw: '{}',
    model: 'test-model',
    durationMs: 12,
    promptTokens: 3,
    completionTokens: 4,
    tokensPerSecond: 5,
    fromCache: false,
  })
  const ports: GroupingPorts = {
    llm: { generateJson },
    renderPrompt: (variables) => ({
      system: 'system rules',
      user: variables.roms ?? '',
    }),
    confidenceThreshold,
  }
  return { ports, generateJson }
}

describe('proposeGrouping', () => {
  it('proposes a collection with the ROMs the model keeps', async () => {
    const { ports } = makePorts(makeGrouping())

    const outcome = await proposeGrouping(makeRoms(['a', 'b', 'c']), ports)

    expect(outcome.decision).toBe('PROPOSED')
    expect(outcome.canonicalTitle).toBe('tetris')
    expect(outcome.members.map((member) => member.romId)).toEqual([
      'a',
      'b',
      'c',
    ])
    expect(outcome.members[1]?.variantLabel).toBe('Europe')
    expect(outcome.removedRomIds).toEqual([])
  })

  it('sends the system message and the user prompt separately', async () => {
    const { ports, generateJson } = makePorts(makeGrouping())

    await proposeGrouping(makeRoms(['a', 'b', 'c']), ports)

    expect(generateJson).toHaveBeenCalledWith(
      expect.objectContaining({
        system: 'system rules',
        prompt: expect.stringContaining('- a | Tetris (a).gb'),
      }),
    )
  })

  it('never accepts a romId the model invented', async () => {
    const { ports } = makePorts(
      makeGrouping({
        members: [
          { romId: 'a', variantLabel: 'USA', belongs: true },
          { romId: 'b', variantLabel: 'Europe', belongs: true },
          { romId: 'ghost', variantLabel: 'Japan', belongs: true },
        ],
      }),
    )

    const outcome = await proposeGrouping(makeRoms(['a', 'b']), ports)

    expect(outcome.members.map((member) => member.romId)).toEqual(['a', 'b'])
    expect(outcome.issues).toEqual(['The model invented the ROM id "ghost"'])
  })

  it('lets the model remove a ROM with belongs: false', async () => {
    const { ports } = makePorts(
      makeGrouping({
        members: [
          { romId: 'a', variantLabel: 'USA', belongs: true },
          { romId: 'b', variantLabel: 'Europe', belongs: true },
          { romId: 'c', variantLabel: null, belongs: false },
        ],
      }),
    )

    const outcome = await proposeGrouping(makeRoms(['a', 'b', 'c']), ports)

    expect(outcome.decision).toBe('PROPOSED')
    expect(outcome.removedRomIds).toEqual(['c'])
    expect(outcome.members.map((member) => member.romId)).toEqual(['a', 'b'])
  })

  it('treats a ROM the model left out as removed', async () => {
    const { ports } = makePorts(
      makeGrouping({
        members: [
          { romId: 'a', variantLabel: 'USA', belongs: true },
          { romId: 'b', variantLabel: 'Europe', belongs: true },
        ],
      }),
    )

    const outcome = await proposeGrouping(makeRoms(['a', 'b', 'c']), ports)

    expect(outcome.removedRomIds).toEqual(['c'])
  })

  it('keeps the first verdict when the model repeats a romId', async () => {
    const { ports } = makePorts(
      makeGrouping({
        members: [
          { romId: 'a', variantLabel: 'USA', belongs: true },
          { romId: 'a', variantLabel: 'Other', belongs: true },
          { romId: 'b', variantLabel: 'Europe', belongs: true },
        ],
      }),
    )

    const outcome = await proposeGrouping(makeRoms(['a', 'b']), ports)

    expect(outcome.members).toHaveLength(2)
    expect(outcome.members[0]?.variantLabel).toBe('USA')
  })

  it('answers NOT_SAME_GAME when the model says so', async () => {
    const { ports } = makePorts(makeGrouping({ sameGame: false }))

    const outcome = await proposeGrouping(makeRoms(['a', 'b', 'c']), ports)

    expect(outcome.decision).toBe('NOT_SAME_GAME')
  })

  it('answers NOT_SAME_GAME when fewer than two valid ROMs remain', async () => {
    const { ports } = makePorts(
      makeGrouping({
        members: [
          { romId: 'a', variantLabel: 'USA', belongs: true },
          { romId: 'ghost', variantLabel: 'Europe', belongs: true },
        ],
      }),
    )

    const outcome = await proposeGrouping(makeRoms(['a', 'b']), ports)

    expect(outcome.decision).toBe('NOT_SAME_GAME')
  })

  it('keeps an unsure answer as LOW_CONFIDENCE', async () => {
    const { ports } = makePorts(makeGrouping({ confidence: 0.5 }))

    const outcome = await proposeGrouping(makeRoms(['a', 'b', 'c']), ports)

    expect(outcome.decision).toBe('LOW_CONFIDENCE')
  })

  it('rejects a proposal without a canonical title', async () => {
    const { ports } = makePorts(makeGrouping({ canonicalTitle: '  ' }))

    const outcome = await proposeGrouping(makeRoms(['a', 'b', 'c']), ports)

    expect(outcome.decision).toBe('REJECTED')
  })

  it('refuses a cluster above the limit without calling the model', async () => {
    const { ports, generateJson } = makePorts(makeGrouping())

    await expect(
      proposeGrouping(makeRoms(makeIds(MAX_ROMS_PER_CALL + 1)), ports),
    ).rejects.toBeInstanceOf(ClusterTooLargeError)
    expect(generateJson).not.toHaveBeenCalled()
  })
})

describe('proposeGroupings', () => {
  it('splits a big cluster and skips a lone leftover ROM', async () => {
    const { ports, generateJson } = makePorts(makeGrouping())

    const outcomes = await proposeGroupings(
      makeRoms(makeIds(MAX_ROMS_PER_CALL + 1)),
      ports,
    )

    expect(generateJson).toHaveBeenCalledTimes(1)
    expect(outcomes).toHaveLength(1)
  })

  it('keeps the variants of one game in the same chunk', async () => {
    const { ports, generateJson } = makePorts(makeGrouping())
    const roms: ClusterRom[] = [
      { id: 'z1', fileName: 'Zelda (USA).gb', platformName: 'Game Boy' },
      ...makeIds(MAX_ROMS_PER_CALL).map((id) => ({
        id,
        fileName: `Game ${id.slice(1).padStart(2, '0')}.gb`,
        platformName: 'Game Boy',
      })),
      { id: 'z2', fileName: 'Zelda (Europe).gb', platformName: 'Game Boy' },
    ]

    await proposeGroupings(roms, ports)

    const lastPrompt = generateJson.mock.calls.at(-1)?.[0] as { prompt: string }
    expect(lastPrompt.prompt).toContain('- z1 |')
    expect(lastPrompt.prompt).toContain('- z2 |')
  })
})

describe('splitForPrompt', () => {
  it('splits into chunks of at most the given size', () => {
    const chunks = splitForPrompt(Array.from({ length: 31 }, (_, i) => i))

    expect(chunks.map((chunk) => chunk.length)).toEqual([15, 15, 1])
  })
})

describe('buildGroupingVariables', () => {
  it('lists every ROM with its id and normalized title', () => {
    const variables = buildGroupingVariables(makeRoms(['a', 'b']))

    expect(variables.romCount).toBe('2')
    expect(variables.roms).toContain('- a | Tetris (a).gb | Game Boy | tetris')
    expect(variables.roms).toContain('- b | Tetris (b).gb | Game Boy | tetris')
  })

  it('says so explicitly when the platform is unknown', () => {
    const variables = buildGroupingVariables([
      { id: 'a', fileName: 'Tetris.gb', platformName: null },
    ])

    expect(variables.roms).toContain('unknown platform')
  })
})
