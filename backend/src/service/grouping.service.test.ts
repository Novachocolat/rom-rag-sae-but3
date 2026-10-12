import { describe, expect, it } from 'vitest'
import {
  buildCandidateClusters,
  detectCollections,
  findDuplicates,
  type GroupableRom,
  type NeighborLookup,
} from './grouping.service.js'

function makeRom(
  overrides: Partial<GroupableRom> & { id: string },
): GroupableRom {
  return {
    fileName: `${overrides.id}.gb`,
    platformId: 'p1',
    sha1: `sha1-${overrides.id}`,
    sha1Data: null,
    gameExternalId: null,
    cloneOfId: null,
    ...overrides,
  }
}

describe('detectCollections', () => {
  it('stage 1 groups a clone with its parent at confidence 1.0', () => {
    const roms = [
      makeRom({
        id: 'parent',
        fileName: 'Sonic (World).md',
        gameExternalId: '0001',
      }),
      makeRom({
        id: 'clone',
        fileName: 'Sonic (Japan).md',
        gameExternalId: '0002',
        cloneOfId: '0001',
      }),
    ]

    const { collections, isolated } = detectCollections(roms)

    expect(collections).toHaveLength(1)
    expect(collections[0]?.stage).toBe('CLONE_OF')
    expect(collections[0]?.confidence).toBe(1.0)
    expect(collections[0]?.romIds.sort()).toEqual(['clone', 'parent'])
    expect(isolated).toHaveLength(0)
  })

  it('does not mix the same game id across two platforms', () => {
    const roms = [
      makeRom({ id: 'a', platformId: 'p1', gameExternalId: '0001' }),
      makeRom({ id: 'b', platformId: 'p2', gameExternalId: '0001' }),
    ]

    expect(detectCollections(roms).collections).toHaveLength(0)
  })

  it('stage 2 groups regional variants by baseTitle and platform at 0.95', () => {
    const roms = [
      makeRom({ id: 'usa', fileName: 'Tetris (USA).gb' }),
      makeRom({ id: 'eur', fileName: 'Tetris (Europe).gb' }),
      makeRom({ id: 'other', fileName: 'Kirby (USA).gb' }),
    ]

    const { collections, isolated } = detectCollections(roms)

    expect(collections).toHaveLength(1)
    expect(collections[0]?.stage).toBe('BASE_TITLE')
    expect(collections[0]?.confidence).toBe(0.95)
    expect(collections[0]?.canonicalTitle).toBe('tetris')
    expect(isolated.map((rom) => rom.id)).toEqual(['other'])
  })

  it('does not group the same title across platforms', () => {
    const roms = [
      makeRom({ id: 'a', fileName: 'Tetris (USA).gb', platformId: 'p1' }),
      makeRom({ id: 'b', fileName: 'Tetris (USA).nes', platformId: 'p2' }),
    ]

    expect(detectCollections(roms).collections).toHaveLength(0)
  })

  it('never turns exact copies of one file into a collection', () => {
    const roms = [
      makeRom({ id: 'a', fileName: 'Tetris (USA).gb', sha1: 'same' }),
      makeRom({ id: 'b', fileName: 'Tetris (USA) copy.gb', sha1: 'same' }),
    ]

    const { collections, isolated } = detectCollections(roms)

    expect(collections).toHaveLength(0)
    expect(isolated).toHaveLength(2)
  })
})

describe('buildCandidateClusters', () => {
  const isolated = ['a', 'b', 'c', 'd', 'e'].map((id) => makeRom({ id }))

  it('forms connected components above the threshold', async () => {
    const graph: Record<string, { romId: string; similarity: number }[]> = {
      a: [{ romId: 'b', similarity: 0.9 }],
      b: [{ romId: 'c', similarity: 0.88 }],
      d: [{ romId: 'e', similarity: 0.5 }],
    }
    const findNeighbors: NeighborLookup = (romId) =>
      Promise.resolve(graph[romId] ?? [])

    const clusters = await buildCandidateClusters(isolated, findNeighbors, {
      threshold: 0.85,
    })

    expect(clusters).toHaveLength(1)
    expect(clusters[0]?.romIds.sort()).toEqual(['a', 'b', 'c'])
  })

  it('ignores neighbors that are not part of the isolated set', async () => {
    const findNeighbors: NeighborLookup = (romId) =>
      Promise.resolve(
        romId === 'a' ? [{ romId: 'already-grouped', similarity: 0.99 }] : [],
      )

    const clusters = await buildCandidateClusters(isolated, findNeighbors)

    expect(clusters).toHaveLength(0)
  })
})

describe('findDuplicates', () => {
  it('flags files sharing a SHA-1 as exact duplicates', () => {
    const roms = [
      makeRom({ id: 'a', sha1: 'same' }),
      makeRom({ id: 'b', sha1: 'same' }),
      makeRom({ id: 'c', sha1: 'other' }),
    ]

    const duplicates = findDuplicates(roms)

    expect(duplicates).toHaveLength(1)
    expect(duplicates[0]?.kind).toBe('EXACT_DUPLICATE')
    expect(duplicates[0]?.romIds.sort()).toEqual(['a', 'b'])
  })

  it('flags same data with a different header as its own kind', () => {
    const roms = [
      makeRom({ id: 'headered', sha1: 'sha-h', sha1Data: 'data' }),
      makeRom({ id: 'bare', sha1: 'sha-b', sha1Data: 'data' }),
    ]

    const duplicates = findDuplicates(roms)

    expect(duplicates).toHaveLength(1)
    expect(duplicates[0]?.kind).toBe('HEADER_DUPLICATE')
    expect(duplicates[0]?.label).toBe('Same dump, different header')
  })

  it('does not report a header duplicate when the SHA-1 is identical', () => {
    const roms = [
      makeRom({ id: 'a', sha1: 'same', sha1Data: 'data' }),
      makeRom({ id: 'b', sha1: 'same', sha1Data: 'data' }),
    ]

    expect(findDuplicates(roms).map((group) => group.kind)).toEqual([
      'EXACT_DUPLICATE',
    ])
  })
})
