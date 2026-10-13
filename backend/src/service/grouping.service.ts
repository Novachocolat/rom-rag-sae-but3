// Pure grouping pipeline: no database or LLM access. Everything it needs is
// passed in, so each stage can be unit-tested with plain objects.
import { normalizeTitle } from './title-normalizer.service.js'

// Minimum cosine similarity for two ROMs to be linked in the semantic stage
export const DEFAULT_SIMILARITY_THRESHOLD = 0.85

// Neighbour lookups run by batches of this size, so a large library does not
// open one database query per ROM at the same time
const NEIGHBOR_LOOKUP_CONCURRENCY = 8

const UNTITLED = 'Untitled'

/**
 * Minimal view of a ROM needed by the grouping stages. `platformId` is never
 * null here: the caller gives a ROM without platform a placeholder of its own.
 */
export interface GroupableRom {
  id: string
  fileName: string
  title: string | null
  platformId: string
  sha1: string
  sha1Data: string | null
  gameExternalId: string | null
  cloneOfId: string | null
}

/**
 * Returns the nearest ROMs of `romId` with their cosine similarity (1 =
 * identical). Injected so this service stays free of database access.
 */
export interface NeighborLookup {
  (romId: string): Promise<Array<{ romId: string; similarity: number }>>
}

/**
 * Stage that produced a collection: a DAT parent/clone link, an identical
 * normalized title, or embedding similarity confirmed by the model.
 */
export type CollectionStage = 'CLONE_OF' | 'BASE_TITLE' | 'SEMANTIC'

/**
 * A detected collection: its stage, a fixed confidence (1 for CLONE_OF, 0.95
 * for BASE_TITLE), a title fit for display and its sorted ROM ids.
 */
export interface CollectionGroup {
  stage: CollectionStage
  confidence: number
  canonicalTitle: string
  romIds: string[]
}

/**
 * ROMs holding the same dump: the very same file (EXACT_DUPLICATE) or the same
 * data behind a different header (HEADER_DUPLICATE).
 */
export interface DuplicateGroup {
  kind: 'EXACT_DUPLICATE' | 'HEADER_DUPLICATE'
  label: string
  romIds: string[]
  confidence: number
}

/** ROMs linked by embedding similarity, still to be confirmed by the model. */
export interface CandidateCluster {
  romIds: string[]
}

/**
 * Title shown to the user for a ROM: its identified title when it has one,
 * otherwise its file name. Tags such as "(Europe)" or "[!]" are removed, and
 * so is the extension of a file name. The casing is kept, unlike `baseTitle`.
 * @returns The cleaned title, possibly empty
 */
export function displayTitle(
  rom: Pick<GroupableRom, 'fileName' | 'title'>,
): string {
  const title = rom.title?.trim()
  const source = title
    ? title
    : rom.fileName.replace(/\.[a-z0-9]{1,4}\s*$/i, '')

  return source
    .replace(/_/g, ' ')
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Appends `value` to the list stored under `key`, creating it when needed
function push<T>(groups: Map<string, T[]>, key: string, value: T): void {
  const group = groups.get(key)
  if (group) group.push(value)
  else groups.set(key, [value])
}

/**
 * Stages 1 and 2 of the grouping pipeline, without database or LLM.
 * Stage 1 groups the ROMs of one DAT family on a platform: a parent and its
 * clones, or clones of the same parent even when that parent is not in the
 * library. Stage 2 groups the remaining ROMs that share a platform and a
 * non-empty normalized base title.
 * Exact copies of one file count once: the first copy can join a collection,
 * the others are left out of every stage (they are reported by findDuplicates).
 * @param roms - Every ROM to consider
 * @returns The detected collections, and `isolated`: the ROMs that joined none
 */
export function detectCollections(roms: GroupableRom[]): {
  collections: CollectionGroup[]
  isolated: GroupableRom[]
} {
  const redundantCopies = new Set(
    findDuplicates(roms)
      .filter((group) => group.kind === 'EXACT_DUPLICATE')
      .flatMap((group) => group.romIds.slice(1)),
  )
  const candidates = roms.filter((rom) => !redundantCopies.has(rom.id))

  const used = new Set<string>()
  const collections: CollectionGroup[] = []

  // Stage 1: a clone points to its parent, a parent is its own family root
  const families = new Map<string, GroupableRom[]>()
  for (const rom of candidates) {
    const rootId = rom.cloneOfId ?? rom.gameExternalId
    if (!rootId) continue
    push(families, `${rom.platformId}:${rootId}`, rom)
  }

  for (const family of families.values()) {
    if (family.length < 2) continue

    // The parent names the collection; without it, any titled member does
    const parent = family.find((rom) => !rom.cloneOfId)
    collections.push({
      stage: 'CLONE_OF',
      confidence: 1,
      canonicalTitle: titleFor(family, parent),
      romIds: family.map((rom) => rom.id).sort(),
    })
    family.forEach((rom) => used.add(rom.id))
  }

  // Stage 2: same platform and same base title. An empty base title (a file
  // name made of tags only) says nothing about the game, so it never groups.
  const sameTitle = new Map<string, GroupableRom[]>()
  for (const rom of candidates) {
    if (used.has(rom.id)) continue

    const { baseTitle } = normalizeTitle(rom.fileName)
    if (!baseTitle) continue
    push(sameTitle, `${rom.platformId}:${baseTitle}`, rom)
  }

  for (const group of sameTitle.values()) {
    if (group.length < 2) continue

    collections.push({
      stage: 'BASE_TITLE',
      confidence: 0.95,
      canonicalTitle: titleFor(group),
      romIds: group.map((rom) => rom.id).sort(),
    })
    group.forEach((rom) => used.add(rom.id))
  }

  const isolated = candidates.filter((rom) => !used.has(rom.id))
  return { collections, isolated }
}

// Display title of a group: the preferred ROM first, then an identified
// member, then the first member by id so the result does not depend on order
function titleFor(group: GroupableRom[], preferred?: GroupableRom): string {
  const sorted = [...group].sort((a, b) => a.id.localeCompare(b.id))
  const named = preferred ?? sorted.find((rom) => rom.title?.trim())
  const fallback = sorted[0]

  return (
    (named && displayTitle(named)) ||
    (fallback && displayTitle(fallback)) ||
    UNTITLED
  )
}

/**
 * Stage 3 preparation: links isolated ROMs whose similarity reaches the
 * threshold and returns the connected components of that graph. Links are
 * transitive: A close to B and B close to C puts A and C in one cluster.
 * @param isolated - ROMs left over by detectCollections
 * @param findNeighbors - Neighbour lookup, called once per isolated ROM
 * @param options.threshold - Minimum cosine similarity to link two ROMs
 * @returns Clusters of at least two ROMs, ids sorted; neighbours outside
 * `isolated` are ignored
 */
export async function buildCandidateClusters(
  isolated: GroupableRom[],
  findNeighbors: NeighborLookup,
  options: { threshold?: number } = {},
): Promise<CandidateCluster[]> {
  const threshold = options.threshold ?? DEFAULT_SIMILARITY_THRESHOLD
  const isolatedIds = new Set(isolated.map((rom) => rom.id))
  const graph = new Map<string, Set<string>>()

  const link = (from: string, to: string): void => {
    const adjacency = graph.get(from) ?? new Set<string>()
    adjacency.add(to)
    graph.set(from, adjacency)
  }

  for (
    let start = 0;
    start < isolated.length;
    start += NEIGHBOR_LOOKUP_CONCURRENCY
  ) {
    const batch = isolated.slice(start, start + NEIGHBOR_LOOKUP_CONCURRENCY)
    const entries = await Promise.all(
      batch.map(async (rom) => ({
        romId: rom.id,
        neighbors: await findNeighbors(rom.id),
      })),
    )

    for (const { romId, neighbors } of entries) {
      for (const neighbor of neighbors) {
        if (
          neighbor.romId === romId ||
          !isolatedIds.has(neighbor.romId) ||
          neighbor.similarity < threshold
        ) {
          continue
        }
        // Undirected: being a neighbour of one side is enough to link both
        link(romId, neighbor.romId)
        link(neighbor.romId, romId)
      }
    }
  }

  const visited = new Set<string>()
  const clusters: CandidateCluster[] = []

  for (const rom of isolated) {
    if (visited.has(rom.id) || !graph.has(rom.id)) continue

    const pending = [rom.id]
    const cluster: string[] = []

    while (pending.length > 0) {
      const current = pending.pop()!
      if (visited.has(current)) continue

      visited.add(current)
      cluster.push(current)

      for (const neighbor of graph.get(current) ?? []) {
        if (!visited.has(neighbor)) pending.push(neighbor)
      }
    }

    if (cluster.length > 1) {
      clusters.push({ romIds: cluster.sort() })
    }
  }

  return clusters
}

/**
 * Finds ROMs that are the same dump.
 * EXACT_DUPLICATE: same `sha1`, confidence 1.
 * HEADER_DUPLICATE: same `sha1Data` but different `sha1`, confidence 0.99.
 * Exact copies count once there, represented by their first id, so the two
 * kinds never report the same pair twice.
 * Hashes are compared trimmed and case-insensitively.
 * @returns Exact groups first, then header groups, ids sorted; ROMs without
 * duplicate are absent
 */
export function findDuplicates(roms: GroupableRom[]): DuplicateGroup[] {
  const bySha1 = new Map<string, string[]>()
  for (const rom of roms) {
    const sha1 = rom.sha1.trim().toLowerCase()
    if (sha1) push(bySha1, sha1, rom.id)
  }

  const groups: DuplicateGroup[] = []
  for (const ids of bySha1.values()) {
    if (ids.length < 2) continue
    groups.push({
      kind: 'EXACT_DUPLICATE',
      label: 'Identical ROM dump',
      romIds: [...ids].sort(),
      confidence: 1,
    })
  }

  // sha1Data -> sha1 -> ids: two different files are needed for a header group
  const byData = new Map<string, Map<string, string[]>>()
  for (const rom of roms) {
    const sha1Data = rom.sha1Data?.trim().toLowerCase()
    if (!sha1Data) continue

    const files = byData.get(sha1Data) ?? new Map<string, string[]>()
    push(files, rom.sha1.trim().toLowerCase(), rom.id)
    byData.set(sha1Data, files)
  }

  for (const files of byData.values()) {
    if (files.size < 2) continue
    groups.push({
      kind: 'HEADER_DUPLICATE',
      label: 'Same dump, different header',
      romIds: [...files.values()].map((ids) => [...ids].sort()[0]!).sort(),
      confidence: 0.99,
    })
  }

  return groups
}
