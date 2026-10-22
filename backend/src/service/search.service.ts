import type { SearchQuery } from '@repo/shared/schemas'
import {
  OllamaTimeoutError,
  OllamaUnavailableError,
} from '../client/ollama/ollama.error.js'
import { ollamaEmbeddingClient } from '../client/ollama/ollama-embedding.client.js'
import type { EmbeddingClient } from '../client/ollama/ollama.types.js'
import {
  findNearestToVector,
  type NearestRom,
} from '../storage/embedding.storage.js'
import {
  listDuplicateCandidates,
  listRoms,
  type DuplicateCandidate,
  type ListRomsFilters,
  type ListRomsResult,
} from '../storage/rom.storage.js'
import { findDuplicates } from './grouping.service.js'

// A semantic search ranks at most this many ROMs, then filters and pages them
export const SEMANTIC_CANDIDATES = 100

export type SearchMode = 'lexical' | 'semantic'

export interface SearchResultItem {
  rom: ListRomsResult['roms'][number]
  // Raw cosine similarity (ADR-010); null for a lexical hit
  score: number | null
}

export interface SearchOutcome {
  items: SearchResultItem[]
  total: number
  page: number
  pageSize: number
  // The mode that actually produced the items
  mode: SearchMode
  // True when a semantic search fell back to the lexical one
  degraded: boolean
}

export interface SearchPorts {
  embedder: EmbeddingClient
  findNearestToVector: (
    userId: string,
    vector: number[],
    k: number,
  ) => Promise<NearestRom[]>
  listRoms: (filters: ListRomsFilters) => Promise<ListRomsResult>
  listDuplicateCandidates: (userId: string) => Promise<DuplicateCandidate[]>
}

interface IdFilter {
  includeIds?: string[]
  excludeIds?: string[]
}

// Ollama being down or too slow is the only reason to fall back: any other
// error is a real bug and must not be hidden behind a lexical result
function isOllamaDown(err: unknown): boolean {
  return (
    err instanceof OllamaUnavailableError || err instanceof OllamaTimeoutError
  )
}

// Every member of a duplicate group is flagged, the original included
async function findDuplicateIds(
  userId: string,
  ports: SearchPorts,
): Promise<string[]> {
  const candidates = await ports.listDuplicateCandidates(userId)
  const groupable = candidates.map((candidate) => ({
    ...candidate,
    platformId: candidate.platformId ?? '',
    gameExternalId: null,
    cloneOfId: null,
  }))
  return findDuplicates(groupable).flatMap((group) => group.romIds)
}

async function duplicateFilter(
  userId: string,
  duplicate: boolean | undefined,
  ports: SearchPorts,
): Promise<IdFilter> {
  if (duplicate === undefined) return {}
  const ids = await findDuplicateIds(userId, ports)
  return duplicate ? { includeIds: ids } : { excludeIds: ids }
}

function toListFilters(
  userId: string,
  query: SearchQuery,
  idFilter: IdFilter,
): ListRomsFilters {
  return {
    userId,
    platformId: query.platformId,
    identificationSource: query.identificationSource,
    region: query.region,
    yearMin: query.yearMin,
    yearMax: query.yearMax,
    collectionId: query.collectionId,
    inCollection: query.inCollection,
    sort: query.sort,
    order: query.order,
    ...idFilter,
  }
}

async function lexicalSearch(
  userId: string,
  query: SearchQuery,
  ports: SearchPorts,
): Promise<SearchOutcome> {
  const idFilter = await duplicateFilter(userId, query.duplicate, ports)
  const result = await ports.listRoms({
    ...toListFilters(userId, query, idFilter),
    search: query.q,
    page: query.page,
    pageSize: query.pageSize,
  })

  return {
    items: result.roms.map((rom) => ({ rom, score: null })),
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
    mode: 'lexical',
    degraded: false,
  }
}

async function semanticSearch(
  userId: string,
  query: SearchQuery,
  text: string,
  ports: SearchPorts,
): Promise<SearchOutcome> {
  const [vector] = await ports.embedder.embed([text])
  if (!vector) throw new Error('The embedding client returned no vector')

  const nearest = await ports.findNearestToVector(
    userId,
    vector,
    SEMANTIC_CANDIDATES,
  )
  const scoreById = new Map(nearest.map((row) => [row.romId, row.similarity]))

  // The structured filters apply to the candidates, never to the ranking
  const duplicateIds = await duplicateFilter(userId, query.duplicate, ports)
  const candidateIds = duplicateIds.includeIds
    ? nearest
        .map((row) => row.romId)
        .filter((id) => duplicateIds.includeIds?.includes(id))
    : nearest.map((row) => row.romId)

  const filtered =
    candidateIds.length === 0
      ? []
      : (
          await ports.listRoms({
            ...toListFilters(userId, query, {
              includeIds: candidateIds,
              ...(duplicateIds.excludeIds && {
                excludeIds: duplicateIds.excludeIds,
              }),
            }),
            page: 1,
            pageSize: candidateIds.length,
          })
        ).roms

  // The storage orders by `sort`; a semantic result is ordered by score
  const ranked = filtered
    .map((rom) => ({ rom, score: scoreById.get(rom.id) ?? null }))
    .sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity))

  const start = (query.page - 1) * query.pageSize
  return {
    items: ranked.slice(start, start + query.pageSize),
    total: ranked.length,
    page: query.page,
    pageSize: query.pageSize,
    mode: 'semantic',
    degraded: false,
  }
}

/**
 * Lexical search is SQL. Semantic search embeds the query and ranks by cosine
 * similarity; when Ollama is down it falls back to the lexical search and
 * says so with `degraded: true`, so the UI never passes it off as a semantic one.
 */
export async function searchRoms(
  userId: string,
  query: SearchQuery,
  ports: SearchPorts,
): Promise<SearchOutcome> {
  if (query.mode === 'semantic' && query.q) {
    try {
      return await semanticSearch(userId, query, query.q, ports)
    } catch (err) {
      if (!isOllamaDown(err)) throw err
      const lexical = await lexicalSearch(userId, query, ports)
      return { ...lexical, degraded: true }
    }
  }
  return lexicalSearch(userId, query, ports)
}

// Builds the real ports: Ollama embeddings and PostgreSQL
export function buildSearchPorts(): SearchPorts {
  return {
    embedder: ollamaEmbeddingClient,
    findNearestToVector,
    listRoms,
    listDuplicateCandidates,
  }
}
