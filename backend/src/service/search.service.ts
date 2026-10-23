import type { SearchMode, SearchQuery } from '@repo/shared/schemas'
import {
  OllamaModelNotFoundError,
  OllamaServerError,
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
  listRomIds,
  listRoms,
  type DuplicateCandidate,
  type ListRomsFilters,
  type ListRomsResult,
  type RomFilters,
} from '../storage/rom.storage.js'
import { findDuplicates } from './grouping.service.js'

// A semantic search keeps at most this many ROMs: the nearest among those
// matching the filters, so `total` never exceeds it
export const SEMANTIC_CANDIDATES = 100

// The route flattens an item into `searchResultItemSchema` ({ ...summary, score })
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
    romIds?: string[],
  ) => Promise<NearestRom[]>
  listRoms: (filters: ListRomsFilters) => Promise<ListRomsResult>
  listRomIds: (filters: RomFilters) => Promise<string[]>
  listDuplicateCandidates: (userId: string) => Promise<DuplicateCandidate[]>
}

interface IdFilter {
  includeIds?: string[]
  excludeIds?: string[]
}

// Ollama being down, too slow, missing the model or failing server-side is
// the only reason to fall back: any other error (an invalid response, a bug)
// must not be hidden behind a lexical result
function isOllamaDown(err: unknown): boolean {
  return (
    err instanceof OllamaUnavailableError ||
    err instanceof OllamaTimeoutError ||
    err instanceof OllamaModelNotFoundError ||
    err instanceof OllamaServerError
  )
}

// Every member of a duplicate group is flagged, the original included, and a
// ROM in several groups only once. Loads every ROM of the user on each call:
// fine for a personal library, a cache or an SQL-side detection if it grows
async function findDuplicateIds(
  userId: string,
  ports: SearchPorts,
): Promise<Set<string>> {
  const candidates = await ports.listDuplicateCandidates(userId)
  const groupable = candidates.map((candidate) => ({
    ...candidate,
    platformId: candidate.platformId ?? '',
    gameExternalId: null,
    cloneOfId: null,
  }))
  return new Set(findDuplicates(groupable).flatMap((group) => group.romIds))
}

async function duplicateFilter(
  userId: string,
  duplicate: boolean | undefined,
  ports: SearchPorts,
): Promise<IdFilter> {
  if (duplicate === undefined) return {}
  const ids = [...(await findDuplicateIds(userId, ports))]
  return duplicate ? { includeIds: ids } : { excludeIds: ids }
}

// The filters resolved in SQL, shared by both modes
function structuredFilters(query: SearchQuery): Omit<RomFilters, 'userId'> {
  return {
    platformId: query.platformId,
    identificationSource: query.identificationSource,
    region: query.region,
    yearMin: query.yearMin,
    yearMax: query.yearMax,
    collectionId: query.collectionId,
    inCollection: query.inCollection,
  }
}

async function lexicalSearch(
  userId: string,
  query: SearchQuery,
  ports: SearchPorts,
): Promise<SearchOutcome> {
  const idFilter = await duplicateFilter(userId, query.duplicate, ports)
  const result = await ports.listRoms({
    userId,
    ...structuredFilters(query),
    ...idFilter,
    search: query.q,
    sort: query.sort,
    order: query.order,
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

// Ids of the ROMs matching the filters, or undefined when nothing is
// filtered and the whole library competes in the ranking
async function semanticCandidateIds(
  userId: string,
  query: SearchQuery,
  ports: SearchPorts,
): Promise<string[] | undefined> {
  const filters = structuredFilters(query)
  const filtered = Object.values(filters).some((value) => value !== undefined)
  if (!filtered && query.duplicate === undefined) return undefined

  const [ids, duplicateIds] = await Promise.all([
    ports.listRomIds({ userId, ...filters }),
    query.duplicate === undefined ? undefined : findDuplicateIds(userId, ports),
  ])
  if (!duplicateIds) return ids
  return ids.filter((id) => duplicateIds.has(id) === query.duplicate)
}

// Ranked by score: `sort` and `order` do not apply
async function semanticSearch(
  userId: string,
  query: SearchQuery,
  text: string,
  ports: SearchPorts,
): Promise<SearchOutcome> {
  // The filters resolve while Ollama embeds the query
  const [[vector], candidateIds] = await Promise.all([
    ports.embedder.embed([text]),
    semanticCandidateIds(userId, query, ports),
  ])
  if (!vector) throw new Error('The embedding client returned no vector')

  // Filtered before the ranking, so a match is never lost beyond the cap
  const nearest = await ports.findNearestToVector(
    userId,
    vector,
    SEMANTIC_CANDIDATES,
    candidateIds,
  )

  const start = (query.page - 1) * query.pageSize
  const pageRows = nearest.slice(start, start + query.pageSize)
  const roms =
    pageRows.length === 0
      ? []
      : (
          await ports.listRoms({
            userId,
            includeIds: pageRows.map((row) => row.romId),
            page: 1,
            pageSize: pageRows.length,
          })
        ).roms
  const romById = new Map(roms.map((rom) => [rom.id, rom]))

  // Keeps the score order; a ROM deleted since the ranking is skipped
  const items = pageRows.flatMap((row) => {
    const rom = romById.get(row.romId)
    return rom ? [{ rom, score: row.similarity }] : []
  })

  return {
    items,
    total: nearest.length,
    page: query.page,
    pageSize: query.pageSize,
    mode: 'semantic',
    degraded: false,
  }
}

/**
 * Lexical search is SQL. Semantic search embeds the query and ranks the ROMs
 * matching the filters by cosine similarity; when Ollama is down it falls back
 * to the lexical search and says so with `degraded: true`, so the UI never
 * passes it off as a semantic one.
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
    listRomIds,
    listDuplicateCandidates,
  }
}
