import type { SearchQuery } from '@repo/shared/schemas'
import { describe, expect, it, vi } from 'vitest'
import {
  OllamaTimeoutError,
  OllamaUnavailableError,
} from '../client/ollama/ollama.error.js'
import type { ListRomsResult } from '../storage/rom.storage.js'
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

// An Ollama error without depending on how its constructor is declared
function makeOllamaError(
  type: typeof OllamaUnavailableError | typeof OllamaTimeoutError,
): Error {
  return Object.create(type.prototype) as Error
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
    listDuplicateCandidates: vi.fn().mockResolvedValue([]),
    ...overrides,
  }
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
      listDuplicateCandidates: vi.fn().mockResolvedValue([
        {
          id: 'a',
          fileName: 'a.gb',
          title: null,
          platformId: 'p1',
          sha1: 'same',
          sha1Data: null,
        },
        {
          id: 'b',
          fileName: 'b.gb',
          title: null,
          platformId: 'p1',
          sha1: 'same',
          sha1Data: null,
        },
        {
          id: 'c',
          fileName: 'c.gb',
          title: null,
          platformId: 'p1',
          sha1: 'other',
          sha1Data: null,
        },
      ]),
    })

    await searchRoms('user-1', makeQuery({ duplicate: true }), ports)

    expect(ports.listRoms).toHaveBeenCalledWith(
      expect.objectContaining({ includeIds: ['a', 'b'] }),
    )
  })

  it('excludes duplicates when duplicate is false', async () => {
    const ports = makePorts({
      listDuplicateCandidates: vi.fn().mockResolvedValue([
        {
          id: 'a',
          fileName: 'a.gb',
          title: null,
          platformId: 'p1',
          sha1: 'same',
          sha1Data: null,
        },
        {
          id: 'b',
          fileName: 'b.gb',
          title: null,
          platformId: 'p1',
          sha1: 'same',
          sha1Data: null,
        },
      ]),
    })

    await searchRoms('user-1', makeQuery({ duplicate: false }), ports)

    expect(ports.listRoms).toHaveBeenCalledWith(
      expect.objectContaining({ excludeIds: ['a', 'b'] }),
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
      findNearestToVector: vi.fn().mockResolvedValue([
        { romId: 'a', fileName: 'a.gb', title: null, similarity: 0.9 },
        { romId: 'b', fileName: 'b.gb', title: null, similarity: 0.4 },
      ]),
      // The storage answers in `sort` order, not in score order
      listRoms: vi.fn().mockResolvedValue({
        roms: [makeRom('b'), makeRom('a')],
        total: 2,
        page: 1,
        pageSize: 2,
      }),
    })

    const outcome = await searchRoms(
      'user-1',
      makeQuery({ mode: 'semantic', q: 'a plumber jumping' }),
      ports,
    )

    expect(ports.embedder.embed).toHaveBeenCalledWith(['a plumber jumping'])
    expect(ports.findNearestToVector).toHaveBeenCalledWith(
      'user-1',
      [0.1, 0.2],
      SEMANTIC_CANDIDATES,
    )
    expect(outcome.items.map((item) => item.rom.id)).toEqual(['a', 'b'])
    expect(outcome.items.map((item) => item.score)).toEqual([0.9, 0.4])
    expect(outcome.mode).toBe('semantic')
    expect(outcome.degraded).toBe(false)
  })

  it('never drops a low score (ADR-010)', async () => {
    const ports = makePorts({
      findNearestToVector: vi
        .fn()
        .mockResolvedValue([
          { romId: 'a', fileName: 'a.gb', title: null, similarity: -0.2 },
        ]),
      listRoms: vi.fn().mockResolvedValue({
        roms: [makeRom('a')],
        total: 1,
        page: 1,
        pageSize: 1,
      }),
    })

    const outcome = await searchRoms(
      'user-1',
      makeQuery({ mode: 'semantic', q: 'anything' }),
      ports,
    )

    expect(outcome.items[0]?.score).toBe(-0.2)
  })

  it('applies the structured filters to the candidates', async () => {
    const ports = makePorts({
      findNearestToVector: vi
        .fn()
        .mockResolvedValue([
          { romId: 'a', fileName: 'a.gb', title: null, similarity: 0.9 },
        ]),
    })

    await searchRoms(
      'user-1',
      makeQuery({ mode: 'semantic', q: 'x', platformId: 'p1', yearMax: 2000 }),
      ports,
    )

    expect(ports.listRoms).toHaveBeenCalledWith(
      expect.objectContaining({
        platformId: 'p1',
        yearMax: 2000,
        includeIds: ['a'],
      }),
    )
  })

  it('answers an empty page without hitting the storage when nothing is close', async () => {
    const ports = makePorts()

    const outcome = await searchRoms(
      'user-1',
      makeQuery({ mode: 'semantic', q: 'x' }),
      ports,
    )

    expect(outcome.items).toEqual([])
    expect(outcome.total).toBe(0)
    expect(ports.listRoms).not.toHaveBeenCalled()
  })

  it('pages the ranked candidates by offset', async () => {
    const ids = ['a', 'b', 'c', 'd', 'e']
    const ports = makePorts({
      findNearestToVector: vi.fn().mockResolvedValue(
        ids.map((romId, index) => ({
          romId,
          fileName: `${romId}.gb`,
          title: null,
          similarity: 0.9 - index * 0.1,
        })),
      ),
      listRoms: vi.fn().mockResolvedValue({
        roms: ids.map(makeRom),
        total: 5,
        page: 1,
        pageSize: 5,
      }),
    })

    const outcome = await searchRoms(
      'user-1',
      makeQuery({ mode: 'semantic', q: 'x', page: 2, pageSize: 2 }),
      ports,
    )

    expect(outcome.items.map((item) => item.rom.id)).toEqual(['c', 'd'])
    expect(outcome.total).toBe(5)
    expect(outcome.page).toBe(2)
  })

  it('only keeps the nearest ROMs that are duplicates', async () => {
    const ports = makePorts({
      findNearestToVector: vi.fn().mockResolvedValue([
        { romId: 'a', fileName: 'a.gb', title: null, similarity: 0.9 },
        { romId: 'z', fileName: 'z.gb', title: null, similarity: 0.8 },
      ]),
      listDuplicateCandidates: vi.fn().mockResolvedValue([
        {
          id: 'a',
          fileName: 'a.gb',
          title: null,
          platformId: 'p1',
          sha1: 'same',
          sha1Data: null,
        },
        {
          id: 'b',
          fileName: 'b.gb',
          title: null,
          platformId: 'p1',
          sha1: 'same',
          sha1Data: null,
        },
      ]),
    })

    await searchRoms(
      'user-1',
      makeQuery({ mode: 'semantic', q: 'x', duplicate: true }),
      ports,
    )

    expect(ports.listRoms).toHaveBeenCalledWith(
      expect.objectContaining({ includeIds: ['a'] }),
    )
  })
})

describe('fallback when Ollama is down', () => {
  it.each([
    ['unavailable', OllamaUnavailableError],
    ['too slow', OllamaTimeoutError],
  ] as const)(
    'falls back to the lexical search and flags it when Ollama is %s',
    async (_label, errorType) => {
      const ports = makePorts({
        embedder: {
          embed: vi.fn().mockRejectedValue(makeOllamaError(errorType)),
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
        makeQuery({ mode: 'semantic', q: 'zelda' }),
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

  it('does not hide any other error behind a lexical result', async () => {
    const ports = makePorts({
      embedder: {
        embed: vi.fn().mockRejectedValue(new Error('boom')),
        dimension: 2,
      },
    })

    await expect(
      searchRoms('user-1', makeQuery({ mode: 'semantic', q: 'x' }), ports),
    ).rejects.toThrow('boom')
    expect(ports.listRoms).not.toHaveBeenCalled()
  })
})
