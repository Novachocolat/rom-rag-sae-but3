import { describe, expect, it, vi } from 'vitest'
import {
  buildGroupingVariables,
  ClusterTooLargeError,
  MAX_ROMS_PER_CALL,
  proposeGrouping,
  proposeGroupings,
  splitForPrompt,
  type ClusterRom,
  type CollectionGrouping,
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
    renderPrompt: (variables) => variables.roms ?? '',
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
