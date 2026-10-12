import { Router } from 'express'
import { z } from 'zod'
import { OllamaUnavailableError } from '../client/ollama/ollama.error.js'
import type { CollectionSource } from '../generated/prisma/client.js'
import { startJob } from '../lib/job-runner.js'
import { logger } from '../lib/logger.js'
import { prisma } from '../lib/prisma.js'
import { requireAuth } from '../middleware/require-auth.middleware.js'
import { validate } from '../middleware/validate.middleware.js'
import {
  buildGroupingPorts,
  proposeGroupings,
  type ClusterRom,
  type GroupingOutcome,
} from '../service/ai-grouping.service.js'
import {
  buildCandidateClusters,
  detectCollections,
  findDuplicates,
  type CollectionGroup,
  type CollectionStage,
  type GroupableRom,
} from '../service/grouping.service.js'
import { normalizeTitle } from '../service/title-normalizer.service.js'
import {
  addMembers,
  createCollection,
  deleteCollection,
  findNeighbors,
  getCollectionWithRoms,
  getMemberSimilarities,
  listCollections,
  listRomsForGrouping,
  removeMember,
  updateCollection,
  type GroupingRomRow,
} from '../storage/collection.storage.js'
import { listPlatforms } from '../storage/dat.storage.js'

export const collectionRouter = Router()

const NEIGHBOR_LIMIT = 10

// Stages 1 and 2 rely on the DAT catalogs; only a semantic cluster is AI-made
const SOURCE_BY_STAGE: Record<CollectionStage, CollectionSource> = {
  CLONE_OF: 'DAT_CLONE',
  BASE_TITLE: 'DAT_CLONE',
  SEMANTIC: 'AI',
}

const collectionIdParamsSchema = z.object({ id: z.uuid() })

const collectionListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
})

const createCollectionBodySchema = z.object({
  canonicalTitle: z.string().trim().min(1),
  platformId: z.uuid().nullable().optional(),
  romIds: z.array(z.uuid()).default([]),
})

const patchCollectionBodySchema = z
  .object({
    canonicalTitle: z.string().trim().min(1).optional(),
    addRomIds: z.array(z.uuid()).min(1).optional(),
    removeRomIds: z.array(z.uuid()).min(1).optional(),
  })
  .refine(
    (body) =>
      body.canonicalTitle !== undefined ||
      body.addRomIds !== undefined ||
      body.removeRomIds !== undefined,
    { message: 'Nothing to update' },
  )

type CreateCollectionBody = z.infer<typeof createCollectionBodySchema>
type PatchCollectionBody = z.infer<typeof patchCollectionBodySchema>
type CollectionListQuery = z.infer<typeof collectionListQuerySchema>

// The grouping stages need a platform: a ROM without one gets a platform of
// its own, so the catalog stages never group it with another ROM
function toGroupable(row: GroupingRomRow): GroupableRom {
  return { ...row, platformId: row.platformId ?? `unknown:${row.id}` }
}

// The platform shared by every member, or null when they differ
function sharedPlatformId(
  romIds: string[],
  platformIdOf: Map<string, string | null>,
): string | null {
  const platformIds = new Set(romIds.map((id) => platformIdOf.get(id) ?? null))
  const [only] = platformIds
  return platformIds.size === 1 && only ? only : null
}

function titleOf(
  group: CollectionGroup,
  fileNameOf: Map<string, string>,
): string {
  if (group.canonicalTitle) return group.canonicalTitle
  const firstFileName = fileNameOf.get(group.romIds[0] ?? '') ?? ''
  return normalizeTitle(firstFileName).baseTitle || 'Untitled'
}

// Stage 3: the model confirms or corrects each cluster of similar ROMs.
// Only a confident, validated proposal becomes a collection.
async function groupIsolatedRoms(
  userId: string,
  clusters: { romIds: string[] }[],
  rows: GroupingRomRow[],
  signal: AbortSignal,
): Promise<void> {
  const platforms = await listPlatforms({ prisma })
  const platformNames = new Map(
    platforms.map((platform) => [platform.id, platform.name]),
  )
  const romById = new Map(rows.map((row) => [row.id, row]))
  const platformIdOf = new Map(rows.map((row) => [row.id, row.platformId]))
  const ports = buildGroupingPorts()

  for (const cluster of clusters) {
    signal.throwIfAborted()

    const clusterRoms: ClusterRom[] = cluster.romIds.flatMap((id) => {
      const row = romById.get(id)
      if (!row) return []
      const platformName = row.platformId
        ? (platformNames.get(row.platformId) ?? null)
        : null
      return [{ id, fileName: row.fileName, platformName }]
    })

    let outcomes: GroupingOutcome[]
    try {
      outcomes = await proposeGroupings(clusterRoms, ports)
    } catch (err) {
      // Without the model, no other cluster can be judged either
      if (err instanceof OllamaUnavailableError) throw err
      logger.warn('Grouping proposal failed for a cluster', {
        message: err instanceof Error ? err.message : String(err),
      })
      continue
    }

    for (const outcome of outcomes) {
      if (outcome.decision !== 'PROPOSED') continue
      await createCollection({
        userId,
        canonicalTitle: outcome.canonicalTitle.trim(),
        platformId: sharedPlatformId(
          outcome.members.map((member) => member.romId),
          platformIdOf,
        ),
        source: 'AI',
        confidence: outcome.confidence,
        members: outcome.members,
      })
    }
  }
}

// Runs the three stages over the ROMs that are not in a collection yet
async function runDetection(
  userId: string,
  signal: AbortSignal,
): Promise<void> {
  const rows = await listRomsForGrouping(userId, { onlyUngrouped: true })
  const platformIdOf = new Map(rows.map((row) => [row.id, row.platformId]))
  const fileNameOf = new Map(rows.map((row) => [row.id, row.fileName]))

  const { collections, isolated } = detectCollections(rows.map(toGroupable))
  for (const detected of collections) {
    signal.throwIfAborted()
    await createCollection({
      userId,
      canonicalTitle: titleOf(detected, fileNameOf),
      platformId: sharedPlatformId(detected.romIds, platformIdOf),
      source: SOURCE_BY_STAGE[detected.stage],
      confidence: detected.confidence,
      members: detected.romIds.map((romId) => ({ romId })),
    })
  }

  const clusters = await buildCandidateClusters(isolated, (romId) =>
    findNeighbors(userId, romId, NEIGHBOR_LIMIT),
  )
  if (clusters.length > 0) {
    await groupIsolatedRoms(userId, clusters, rows, signal)
  }
}

// `sizeBytes` is a BigInt, which JSON cannot carry: sent as a number
async function toCollectionDetail(userId: string, id: string) {
  const collection = await getCollectionWithRoms(userId, id)
  const similarities = await getMemberSimilarities(
    collection.members.map((member) => member.romId),
  )

  return {
    id: collection.id,
    canonicalTitle: collection.canonicalTitle,
    source: collection.source,
    confidence: collection.confidence,
    platformId: collection.platformId,
    createdAt: collection.createdAt,
    members: collection.members.map((member) => ({
      romId: member.romId,
      variantLabel: member.variantLabel,
      fileName: member.rom.fileName,
      sizeBytes: Number(member.rom.sizeBytes),
      region: member.rom.region,
      identificationSource: member.rom.identificationSource,
    })),
    similarities,
  }
}

// POST /api/collections/detect: starts the detection in the background
collectionRouter.post('/collections/detect', requireAuth, (_req, res, next) => {
  try {
    const userId = res.locals.userId as string
    const jobId = startJob((signal) => runDetection(userId, signal))
    res.status(202).json({ jobId })
  } catch (err) {
    next(err)
  }
})

// GET /api/collections/duplicates: declared before /collections/:id so that
// "duplicates" is not read as an id
collectionRouter.get(
  '/collections/duplicates',
  requireAuth,
  async (_req, res, next) => {
    try {
      const userId = res.locals.userId as string
      const rows = await listRomsForGrouping(userId)
      const fileNameOf = new Map(rows.map((row) => [row.id, row.fileName]))

      const duplicates = findDuplicates(rows.map(toGroupable)).map((group) => ({
        kind: group.kind,
        label: group.label,
        roms: group.romIds.map((id) => ({
          id,
          fileName: fileNameOf.get(id) ?? '',
        })),
      }))
      res.json({ duplicates })
    } catch (err) {
      next(err)
    }
  },
)

// GET /api/collections
collectionRouter.get(
  '/collections',
  requireAuth,
  validate({ query: collectionListQuerySchema }),
  async (req, res, next) => {
    try {
      const userId = res.locals.userId as string
      const { page, pageSize } = req.query as unknown as CollectionListQuery
      const { collections, total } = await listCollections({
        userId,
        page,
        pageSize,
      })

      res.json({
        items: collections.map((collection) => ({
          id: collection.id,
          canonicalTitle: collection.canonicalTitle,
          source: collection.source,
          confidence: collection.confidence,
          platformId: collection.platformId,
          memberCount: collection._count.members,
          createdAt: collection.createdAt,
        })),
        total,
        page,
        pageSize,
      })
    } catch (err) {
      next(err)
    }
  },
)

// GET /api/collections/:id: members and their pairwise similarity
collectionRouter.get(
  '/collections/:id',
  requireAuth,
  validate({ params: collectionIdParamsSchema }),
  async (req, res, next) => {
    try {
      const userId = res.locals.userId as string
      const { id } = req.params as { id: string }
      res.json(await toCollectionDetail(userId, id))
    } catch (err) {
      next(err)
    }
  },
)

// POST /api/collections: manual creation
collectionRouter.post(
  '/collections',
  requireAuth,
  validate({ body: createCollectionBodySchema }),
  async (req, res, next) => {
    try {
      const userId = res.locals.userId as string
      const body = req.body as CreateCollectionBody
      const collection = await createCollection({
        userId,
        canonicalTitle: body.canonicalTitle,
        platformId: body.platformId ?? null,
        source: 'MANUAL',
        members: body.romIds.map((romId) => ({ romId })),
      })

      res.status(201).json({
        id: collection.id,
        canonicalTitle: collection.canonicalTitle,
        memberCount: collection._count.members,
      })
    } catch (err) {
      next(err)
    }
  },
)

// PATCH /api/collections/:id: rename, add and remove members
collectionRouter.patch(
  '/collections/:id',
  requireAuth,
  validate({
    params: collectionIdParamsSchema,
    body: patchCollectionBodySchema,
  }),
  async (req, res, next) => {
    try {
      const userId = res.locals.userId as string
      const { id } = req.params as { id: string }
      const body = req.body as PatchCollectionBody

      if (body.canonicalTitle !== undefined) {
        await updateCollection(userId, id, {
          canonicalTitle: body.canonicalTitle,
        })
      }
      if (body.addRomIds) {
        await addMembers(
          userId,
          id,
          body.addRomIds.map((romId) => ({ romId })),
        )
      }
      for (const romId of body.removeRomIds ?? []) {
        await removeMember(userId, id, romId)
      }

      res.json(await toCollectionDetail(userId, id))
    } catch (err) {
      next(err)
    }
  },
)

// DELETE /api/collections/:id: dissolves the collection, keeps the ROMs
collectionRouter.delete(
  '/collections/:id',
  requireAuth,
  validate({ params: collectionIdParamsSchema }),
  async (req, res, next) => {
    try {
      const userId = res.locals.userId as string
      const { id } = req.params as { id: string }
      await deleteCollection(userId, id)
      res.status(204).send()
    } catch (err) {
      next(err)
    }
  },
)
