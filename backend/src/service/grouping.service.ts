// Pure grouping pipeline: no database or LLM access. Everything it needs is
// passed in, so each stage can be unit-tested with plain objects.
import { normalizeTitle } from './title-normalizer.service.js'

export interface GroupableRom {
  id: string
  fileName: string
  platformId: string
  sha1: string
  sha1Data: string | null
  gameExternalId: string | null
  cloneOfId: string | null
}

export interface NeighborLookup {
  (romId: string): Promise<Array<{ romId: string; similarity: number }>>
}

export type CollectionStage = 'CLONE_OF' | 'BASE_TITLE' | 'SEMANTIC'

export interface CollectionGroup {
  stage: CollectionStage
  confidence: number
  canonicalTitle?: string
  romIds: string[]
}

export interface DuplicateGroup {
  kind: 'EXACT_DUPLICATE' | 'HEADER_DUPLICATE'
  label: string
  romIds: string[]
  confidence: number
}

export interface CandidateCluster {
  romIds: string[]
}

export function detectCollections(roms: GroupableRom[]): {
  collections: CollectionGroup[]
  isolated: GroupableRom[]
} {
  const exactDuplicateIds = new Set(
    findDuplicates(roms)
      .filter((group) => group.kind === 'EXACT_DUPLICATE')
      .flatMap((group) => group.romIds),
  )

  const used = new Set<string>()
  const collections: CollectionGroup[] = []

  const cloneGroups = new Map<string, Set<string>>()
  for (const rom of roms) {
    if (exactDuplicateIds.has(rom.id) || !rom.cloneOfId) continue

    const parent = roms.find(
      (candidate) =>
        candidate.id !== rom.id &&
        candidate.platformId === rom.platformId &&
        candidate.gameExternalId === rom.cloneOfId,
    )

    if (!parent) continue

    const groupKey = `${rom.platformId}:${parent.gameExternalId ?? rom.cloneOfId}`
    const ids = cloneGroups.get(groupKey) ?? new Set<string>()
    ids.add(rom.id)
    ids.add(parent.id)
    cloneGroups.set(groupKey, ids)
  }

  for (const ids of cloneGroups.values()) {
    const romIds = [...ids].sort()
    const canonicalTitle = roms.find((rom) => rom.id === romIds[0])?.fileName
      ? normalizeTitle(roms.find((rom) => rom.id === romIds[0])!.fileName)
          .baseTitle
      : undefined

    collections.push({
      stage: 'CLONE_OF',
      confidence: 1,
      canonicalTitle,
      romIds,
    })

    romIds.forEach((id) => used.add(id))
  }

  const baseTitleGroups = new Map<string, Set<string>>()
  for (const rom of roms) {
    if (used.has(rom.id) || exactDuplicateIds.has(rom.id)) continue

    const normalized = normalizeTitle(rom.fileName)
    const key = `${rom.platformId}:${normalized.baseTitle}`
    const ids = baseTitleGroups.get(key) ?? new Set<string>()
    ids.add(rom.id)
    baseTitleGroups.set(key, ids)
  }

  for (const ids of baseTitleGroups.values()) {
    const romIds = [...ids].sort()
    if (romIds.length < 2) continue

    const canonicalTitle = normalizeTitle(
      roms.find((rom) => rom.id === romIds[0])?.fileName ?? '',
    ).baseTitle

    collections.push({
      stage: 'BASE_TITLE',
      confidence: 0.95,
      canonicalTitle,
      romIds,
    })

    romIds.forEach((id) => used.add(id))
  }

  const isolated = roms.filter((rom) => !used.has(rom.id))
  return { collections, isolated }
}

export async function buildCandidateClusters(
  isolated: GroupableRom[],
  findNeighbors: NeighborLookup,
  options: { threshold?: number } = {},
): Promise<CandidateCluster[]> {
  const threshold = options.threshold ?? 0.85
  const isolatedIds = new Set(isolated.map((rom) => rom.id))
  const graph = new Map<string, Set<string>>()

  const candidateEntries = await Promise.all(
    isolated.map(async (rom) => ({
      romId: rom.id,
      neighbors: await findNeighbors(rom.id),
    })),
  )

  for (const { romId, neighbors } of candidateEntries) {
    const adjacency = graph.get(romId) ?? new Set<string>()
    for (const neighbor of neighbors) {
      if (
        neighbor.romId === romId ||
        !isolatedIds.has(neighbor.romId) ||
        neighbor.similarity < threshold
      ) {
        continue
      }

      adjacency.add(neighbor.romId)
      const reverse = graph.get(neighbor.romId) ?? new Set<string>()
      reverse.add(romId)
      graph.set(neighbor.romId, reverse)
    }
    graph.set(romId, adjacency)
  }

  const visited = new Set<string>()
  const clusters: CandidateCluster[] = []

  for (const rom of isolated) {
    if (visited.has(rom.id)) continue

    const queue = [rom.id]
    const cluster: string[] = []

    while (queue.length > 0) {
      const current = queue.pop()!
      if (visited.has(current)) continue

      visited.add(current)
      cluster.push(current)

      const neighbors = graph.get(current) ?? new Set<string>()
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          queue.push(neighbor)
        }
      }
    }

    if (cluster.length > 1) {
      clusters.push({ romIds: cluster.sort() })
    }
  }

  return clusters
}

export function findDuplicates(roms: GroupableRom[]): DuplicateGroup[] {
  const exactBySha1 = new Map<string, string[]>()
  for (const rom of roms) {
    const sha1 = rom.sha1.trim().toLowerCase()
    if (!sha1) continue

    const ids = exactBySha1.get(sha1) ?? []
    ids.push(rom.id)
    exactBySha1.set(sha1, ids)
  }

  const groups: DuplicateGroup[] = []
  for (const [, ids] of exactBySha1.entries()) {
    if (ids.length < 2) continue
    groups.push({
      kind: 'EXACT_DUPLICATE',
      label: 'Identical ROM dump',
      romIds: [...ids].sort(),
      confidence: 1,
    })
  }

  const headerByData = new Map<string, string[]>()
  for (const rom of roms) {
    const sha1Data = rom.sha1Data?.trim()
    if (!sha1Data) continue

    const exactMatch = groups.some(
      (group) =>
        group.romIds.includes(rom.id) && group.kind === 'EXACT_DUPLICATE',
    )
    if (exactMatch) continue

    const ids = headerByData.get(sha1Data) ?? []
    ids.push(rom.id)
    headerByData.set(sha1Data, ids)
  }

  for (const ids of headerByData.values()) {
    if (ids.length < 2) continue

    const uniqueIds = [...new Set(ids)].sort()
    groups.push({
      kind: 'HEADER_DUPLICATE',
      label: 'Same dump, different header',
      romIds: uniqueIds,
      confidence: 0.99,
    })
  }

  return groups
}
