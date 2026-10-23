import type { SearchQuery } from '@repo/shared/schemas'
import { describe, expect, it, vi } from 'vitest'
import {
  OllamaInvalidJsonError,
  OllamaModelNotFoundError,
  OllamaServerError,
  OllamaTimeoutError,
  OllamaUnavailableError,
} from '../client/ollama/ollama.error.js'
import type {
  DuplicateCandidate,
  ListRomsFilters,
  ListRomsResult,
} from '../storage/rom.storage.js'
import {
  SEMANTIC_CANDIDATES,
  searchRoms,
  type SearchPorts,
} from './search.service.js'

type RomRow = ListRomsResult['roms'][number]

function makeRom(id: string): RomRow {
  return { id, fileName: `${id}.gb` } as unknown as RomRow
}

function makeQuery(overrides: Partial<SearchQuery> = {}): SearchQuery {
  return {
    mode: 'lexical',
    sort: 'fileName',
    order: 'asc',
    page: 1,
    pageSize: 20,
    ...overrides,
  }
}

function makeCandidate(
  id: string,
  sha1: string,
  sha1Data: string | null = null,
): DuplicateCandidate {
  return {
    id,
    fileName: `${id}.gb`,
    title: null,
    platformId: 'p1',
    sha1,
    sha1Data,
  }
}

// Nearest rows in the given order, scores decreasing from 0.9
function makeNearest(ids: string[]) {
  return ids.map((romId, index) => ({
    romId,
    fileName: `${romId}.gb`,
    title: null,
    similarity: 0.9 - index * 0.1,
  }))
}

// Answers `includeIds` in reverse, as the storage orders by `sort`, not by score
function hydratingListRoms() {
  return vi.fn().mockImplementation((filters: ListRomsFilters) => {
    const roms = (filters.includeIds ?? []).map(makeRom).reverse()
    return Promise.resolve({
      roms,
      total: roms.length,
      page: 1,
      pageSize: roms.length,
    })
  })
}

function makePorts(overrides: Partial<SearchPorts> = {}): SearchPorts {
  return {
    embedder: { embed: vi.fn().mockResolvedValue([[0.1, 0.2]]), dimension: 2 },
    findNearestToVector: vi.fn().mockResolvedValue([]),
    listRoms: vi
      .fn()
      .mockImplementation((filters: { page?: number; pageSize?: number }) =>
        Promise.resolve({
          roms: [],
          total: 0,
          page: filters.page ?? 1,
          pageSize: filters.pageSize ?? 20,
        }),
      ),
    listRomIds: vi.fn().mockResolvedValue([]),
    listDuplicateCandidates: vi.fn().mockResolvedValue([]),
    ...overrides,
  }
}

function semantic(overrides: Partial<SearchQuery> = {}): SearchQuery {
  return makeQuery({ mode: 'semantic', q: 'x', ...overrides })
}

describe('lexical search', () => {
  it('searches the text and applies the filters in SQL', async () => {
    const ports = makePorts()

    const outcome = await searchRoms(
      'user-1',
      makeQuery({ q: 'zelda', platformId: 'p1', yearMin: 1990, sort: 'title' }),
      ports,
    )

    expect(ports.listRoms).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        search: 'zelda',
        platformId: 'p1',
        yearMin: 1990,
        sort: 'title',
      }),
    )
    expect(ports.embedder.embed).not.toHaveBeenCalled()
    expect(outcome.mode).toBe('lexical')
    expect(outcome.degraded).toBe(false)
  })

  it('gives no score to a lexical hit', async () => {
    const ports = makePorts({
      listRoms: vi.fn().mockResolvedValue({
        roms: [makeRom('a')],
        total: 1,
        page: 1,
        pageSize: 20,
      }),
    })

    const outcome = await searchRoms('user-1', makeQuery({ q: 'a' }), ports)

    expect(outcome.items).toEqual([{ rom: makeRom('a'), score: null }])
    expect(outcome.total).toBe(1)
  })

  it('restricts to duplicates when duplicate is true', async () => {
    const ports = makePorts({
      listDuplicateCandidates: vi
        .fn()
        .mockResolvedValue([
          makeCandidate('a', 'same'),
          makeCandidate('b', 'same'),
          makeCandidate('c', 'other'),
        ]),
    })

    await searchRoms('user-1', makeQuery({ duplicate: true }), ports)

    expect(ports.listRoms).toHaveBeenCalledWith(
      expect.objectContaining({ includeIds: ['a', 'b'] }),
    )
  })

  it('excludes duplicates when duplicate is false', async () => {
    const ports = makePorts({
      listDuplicateCandidates: vi
        .fn()
        .mockResolvedValue([
          makeCandidate('a', 'same'),
          makeCandidate('b', 'same'),
        ]),
    })

    await searchRoms('user-1', makeQuery({ duplicate: false }), ports)

    expect(ports.listRoms).toHaveBeenCalledWith(
      expect.objectContaining({ excludeIds: ['a', 'b'] }),
    )
  })

  it('lists a ROM in both an exact and a header group once', async () => {
    const ports = makePorts({
      listDuplicateCandidates: vi
        .fn()
        .mockResolvedValue([
          makeCandidate('a', 'same', 'data'),
          makeCandidate('b', 'same', 'data'),
          makeCandidate('c', 'other', 'data'),
        ]),
    })

    await searchRoms('user-1', makeQuery({ duplicate: true }), ports)

    expect(ports.listRoms).toHaveBeenCalledWith(
      expect.objectContaining({ includeIds: ['a', 'b', 'c'] }),
    )
  })

  it('does not load the duplicate candidates when the filter is off', async () => {
    const ports = makePorts()

    await searchRoms('user-1', makeQuery(), ports)

    expect(ports.listDuplicateCandidates).not.toHaveBeenCalled()
  })
})

describe('semantic search', () => {
  it('embeds the query and ranks by raw cosine score, highest first', async () => {
    const ports = makePorts({
      findNearestToVector: vi.fn().mockResolvedValue(makeNearest(['a', 'b'])),
      listRoms: hydratingListRoms(),
    })

    const outcome = await searchRoms(
      'user-1',
      semantic({ q: 'a plumber jumping' }),
      ports,
    )

    expect(ports.embedder.embed).toHaveBeenCalledWith(['a plumber jumping'])
    expect(outcome.items.map((item) => item.rom.id)).toEqual(['a', 'b'])
    expect(outcome.items.map((item) => item.score)).toEqual([0.9, 0.8])
    expect(outcome.mode).toBe('semantic')
    expect(outcome.degraded).toBe(false)
  })

  it('ranks the whole library when nothing is filtered', async () => {
    const ports = makePorts()

    await searchRoms('user-1', semantic(), ports)

    expect(ports.listRomIds).not.toHaveBeenCalled()
    expect(ports.findNearestToVector).toHaveBeenCalledWith(
      'user-1',
      [0.1, 0.2],
      SEMANTIC_CANDIDATES,
      undefined,
    )
  })

  it('never drops a low score (ADR-010)', async () => {
    const ports = makePorts({
      findNearestToVector: vi
        .fn()
        .mockResolvedValue([
          { romId: 'a', fileName: 'a.gb', title: null, similarity: -0.2 },
        ]),
      listRoms: hydratingListRoms(),
    })

    const outcome = await searchRoms('user-1', semantic(), ports)

    expect(outcome.items[0]?.score).toBe(-0.2)
  })

  it('applies the structured filters before the ranking', async () => {
    const ports = makePorts({
      listRomIds: vi.fn().mockResolvedValue(['a', 'b']),
    })

    await searchRoms(
      'user-1',
      semantic({ platformId: 'p1', yearMax: 2000 }),
      ports,
    )

    expect(ports.listRomIds).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        platformId: 'p1',
        yearMax: 2000,
      }),
    )
    expect(ports.findNearestToVector).toHaveBeenCalledWith(
      'user-1',
      [0.1, 0.2],
      SEMANTIC_CANDIDATES,
      ['a', 'b'],
    )
  })

  it('never filters the text again in SQL', async () => {
    const ports = makePorts({
      findNearestToVector: vi.fn().mockResolvedValue(makeNearest(['a'])),
      listRoms: hydratingListRoms(),
    })

    await searchRoms('user-1', semantic({ q: 'plumber' }), ports)

    expect(vi.mocked(ports.listRoms).mock.calls[0]?.[0]).not.toHaveProperty(
      'search',
    )
  })

  it('only keeps the duplicates among the filtered ROMs', async () => {
    const ports = makePorts({
      listRomIds: vi.fn().mockResolvedValue(['a', 'b', 'z']),
      listDuplicateCandidates: vi
        .fn()
        .mockResolvedValue([
          makeCandidate('a', 'same'),
          makeCandidate('b', 'same'),
          makeCandidate('z', 'other'),
        ]),
    })

    await searchRoms('user-1', semantic({ duplicate: true }), ports)

    expect(ports.findNearestToVector).toHaveBeenCalledWith(
      'user-1',
      [0.1, 0.2],
      SEMANTIC_CANDIDATES,
      ['a', 'b'],
    )
  })

  it('drops the duplicates from the ranking when duplicate is false', async () => {
    const ports = makePorts({
      listRomIds: vi.fn().mockResolvedValue(['a', 'b', 'z']),
      listDuplicateCandidates: vi
        .fn()
        .mockResolvedValue([
          makeCandidate('a', 'same'),
          makeCandidate('b', 'same'),
          makeCandidate('z', 'other'),
        ]),
    })

    await searchRoms('user-1', semantic({ duplicate: false }), ports)

    expect(ports.findNearestToVector).toHaveBeenCalledWith(
      'user-1',
      [0.1, 0.2],
      SEMANTIC_CANDIDATES,
      ['z'],
    )
  })

  it('answers an empty page without hitting the storage when nothing is close', async () => {
    const ports = makePorts()

    const outcome = await searchRoms('user-1', semantic(), ports)

    expect(outcome.items).toEqual([])
    expect(outcome.total).toBe(0)
    expect(ports.listRoms).not.toHaveBeenCalled()
  })

  it('only loads the ROMs of the requested page', async () => {
    const ports = makePorts({
      findNearestToVector: vi
        .fn()
        .mockResolvedValue(makeNearest(['a', 'b', 'c', 'd', 'e'])),
      listRoms: hydratingListRoms(),
    })

    const outcome = await searchRoms(
      'user-1',
      semantic({ page: 2, pageSize: 2 }),
      ports,
    )

    expect(ports.listRoms).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', includeIds: ['c', 'd'] }),
    )
    expect(outcome.items.map((item) => item.rom.id)).toEqual(['c', 'd'])
    expect(outcome.total).toBe(5)
    expect(outcome.page).toBe(2)
  })

  it('answers an empty page with the right total past the last page', async () => {
    const ports = makePorts({
      findNearestToVector: vi
        .fn()
        .mockResolvedValue(makeNearest(['a', 'b', 'c'])),
    })

    const outcome = await searchRoms(
      'user-1',
      semantic({ page: 3, pageSize: 2 }),
      ports,
    )

    expect(outcome.items).toEqual([])
    expect(outcome.total).toBe(3)
    expect(outcome.page).toBe(3)
    expect(ports.listRoms).not.toHaveBeenCalled()
  })

  it('skips a ROM deleted since the ranking', async () => {
    const ports = makePorts({
      findNearestToVector: vi.fn().mockResolvedValue(makeNearest(['a', 'b'])),
      listRoms: vi.fn().mockResolvedValue({
        roms: [makeRom('b')],
        total: 1,
        page: 1,
        pageSize: 2,
      }),
    })

    const outcome = await searchRoms('user-1', semantic(), ports)

    expect(outcome.items.map((item) => item.rom.id)).toEqual(['b'])
  })
})

describe('fallback when Ollama is down', () => {
  it.each([
    ['unavailable', new OllamaUnavailableError('down')],
    ['too slow', new OllamaTimeoutError('slow')],
    ['missing the model', new OllamaModelNotFoundError('not pulled')],
    ['failing server-side', new OllamaServerError('500')],
  ])(
    'falls back to the lexical search and flags it when Ollama is %s',
    async (_label, error) => {
      const ports = makePorts({
        embedder: {
          embed: vi.fn().mockRejectedValue(error),
          dimension: 2,
        },
        listRoms: vi.fn().mockResolvedValue({
          roms: [makeRom('a')],
          total: 1,
          page: 1,
          pageSize: 20,
        }),
      })

      const outcome = await searchRoms(
        'user-1',
        semantic({ q: 'zelda' }),
        ports,
      )

      expect(ports.listRoms).toHaveBeenCalledWith(
        expect.objectContaining({ search: 'zelda' }),
      )
      expect(outcome.mode).toBe('lexical')
      expect(outcome.degraded).toBe(true)
      expect(outcome.items[0]?.score).toBeNull()
    },
  )

  it('keeps the filters and the duplicate filter', async () => {
    const ports = makePorts({
      embedder: {
        embed: vi.fn().mockRejectedValue(new OllamaUnavailableError('down')),
        dimension: 2,
      },
      listDuplicateCandidates: vi
        .fn()
        .mockResolvedValue([
          makeCandidate('a', 'same'),
          makeCandidate('b', 'same'),
        ]),
    })

    await searchRoms(
      'user-1',
      semantic({
        q: 'zelda',
        platformId: 'p1',
        yearMin: 1990,
        duplicate: true,
        sort: 'title',
      }),
      ports,
    )

    expect(ports.listRoms).toHaveBeenCalledWith(
      expect.objectContaining({
        search: 'zelda',
        platformId: 'p1',
        yearMin: 1990,
        includeIds: ['a', 'b'],
        sort: 'title',
      }),
    )
  })

  it.each([
    ['an invalid Ollama response', new OllamaInvalidJsonError('bad json')],
    ['any other error', new Error('boom')],
  ])('does not hide %s behind a lexical result', async (_label, error) => {
    const ports = makePorts({
      embedder: {
        embed: vi.fn().mockRejectedValue(error),
        dimension: 2,
      },
    })

    await expect(searchRoms('user-1', semantic(), ports)).rejects.toBe(error)
    expect(ports.listRoms).not.toHaveBeenCalled()
  })
})
