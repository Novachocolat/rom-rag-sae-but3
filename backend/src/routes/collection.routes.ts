import {
  collectionCreateSchema,
  collectionIdParamsSchema,
  collectionListQuerySchema,
  collectionMergeSchema,
  collectionUpdateSchema,
} from '@repo/shared/schemas'
import type {
  CollectionCreate,
  CollectionDetail,
  CollectionListQuery,
  CollectionMerge,
  CollectionSummary,
  CollectionUpdate,
  DuplicateGroup,
  Paginated,
} from '@repo/shared/types'
import { Router } from 'express'
import { OllamaUnavailableError } from '../client/ollama/ollama.error.js'
import type { CollectionSource } from '../generated/prisma/client.js'
import { AppError } from '../lib/error.js'
import { startJob } from '../lib/job-runner.js'
import { logger } from '../lib/logger.js'
import { prisma } from '../lib/prisma.js'
import { requireAuth } from '../middleware/require-auth.middleware.js'
import { validate } from '../middleware/validate.middleware.js'
import {
  buildGroupingPorts,
  GROUPING_PROMPT,
  proposeGroupings,
  type ClusterRom,
  type GroupingOutcome,
} from '../service/ai-grouping.service.js'
import {
  buildCandidateClusters,
  DEFAULT_SIMILARITY_THRESHOLD,
  detectCollections,
  findDuplicates,
  type CandidateCluster,
  type CollectionStage,
  type GroupableRom,
} from '../service/grouping.service.js'
import { createGroupingProposal } from '../storage/ai-proposal.storage.js'
import {
  createCollection,
  deleteCollection,
  getCollectionWithRoms,
  listCollections,
  listRomsForGrouping,
  mergeCollections,
  updateCollection,
  type GroupingRomRow,
} from '../storage/collection.storage.js'
import { listPlatforms } from '../storage/dat.storage.js'
import {
  findNearest,
  getMemberSimilarities,
} from '../storage/embedding.storage.js'

export const collectionRouter = Router()

// Neighbours fetched per isolated ROM when building the semantic clusters
const NEIGHBOR_LIMIT = 10

/**
 * Maps a detection stage to the stored source. The schema has no value of its
 * own for a title match, so both deterministic stages are stored as
 * `DAT_CLONE`: what the source tells the user is "not decided by the model".
 */
const SOURCE_BY_STAGE: Record<CollectionStage, CollectionSource> = {
  CLONE_OF: 'DAT_CLONE',
  BASE_TITLE: 'DAT_CLONE',
  SEMANTIC: 'AI',
}

// Users with a detection in progress: a second run started meanwhile would
// read the same ungrouped ROMs and create every collection twice. In memory,
// like the job runner itself (see ADR-012).
const runningDetections = new Set<string>()

/**
 * Gives a ROM without platform a placeholder platform of its own, so the
 * catalog stages, which only group within a platform, never group it.
 */
function toGroupable(row: GroupingRomRow): GroupableRom {
  return { ...row, platformId: row.platformId ?? `unknown:${row.id}` }
}

/** @returns The platform shared by every ROM, or null when they differ or have none */
function sharedPlatformId(
  romIds: string[],
  platformIdOf: Map<string, string | null>,
): string | null {
  const platformIds = new Set(romIds.map((id) => platformIdOf.get(id) ?? null))
  const [only] = platformIds
  return platformIds.size === 1 && only ? only : null
}

/**
 * Stores what the model answered about one chunk of a cluster.
 * A PROPOSED outcome creates an `AI` collection, linked to a PENDING proposal:
 * the user confirms it by keeping the collection, or refuses it by dissolving
 * it. Any other outcome creates nothing and is kept as a REJECTED proposal,
 * for audit, anchored to one ROM of the chunk.
 */
async function recordOutcome(
  userId: string,
  outcome: GroupingOutcome,
  platformIdOf: Map<string, string | null>,
): Promise<void> {
  const audit = {
    payload: {
      decision: outcome.decision,
      canonicalTitle: outcome.canonicalTitle,
      members: outcome.members,
      removedRomIds: outcome.removedRomIds,
      reasoning: outcome.reasoning,
      issues: outcome.issues,
    },
    rawResponse: outcome.raw,
    model: outcome.model,
    promptName: GROUPING_PROMPT.name,
    promptVersion: GROUPING_PROMPT.version,
    confidence: outcome.confidence,
    durationMs: outcome.durationMs,
    promptTokens: outcome.promptTokens,
    completionTokens: outcome.completionTokens,
  }

  if (outcome.decision === 'PROPOSED') {
    const collection = await createCollection({
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
    await createGroupingProposal({
      ...audit,
      collectionId: collection.id,
      status: 'PENDING',
    })
    return
  }

  const anchorRomId = outcome.members[0]?.romId ?? outcome.removedRomIds[0]
  if (!anchorRomId) return
  await createGroupingProposal({
    ...audit,
    romId: anchorRomId,
    status: 'REJECTED',
  })
}

/**
 * Stage 3: asks the model to confirm or correct each cluster of similar ROMs.
 * A cluster the model fails on is logged and skipped. When Ollama cannot be
 * reached the stage stops quietly: no other cluster could be judged either,
 * and the collections of stages 1 and 2 are already saved (degraded mode).
 */
async function groupIsolatedRoms(
  userId: string,
  clusters: CandidateCluster[],
  rows: GroupingRomRow[],
  signal: AbortSignal,
): Promise<void> {
  const platforms = await listPlatforms({ prisma })
  const platformNames = new Map(
    platforms.map((platform) => [platform.id, platform.name]),
  )
  const romById = new Map(rows.map((row) => [row.id, row]))
  const platformIdOf = new Map(rows.map((row) => [row.id, row.platformId]))
  const ports = await buildGroupingPorts()

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
      if (err instanceof OllamaUnavailableError) {
        logger.warn('Ollama is unreachable: semantic grouping skipped')
        return
      }
      logger.warn('Grouping proposal failed for a cluster', {
        message: err instanceof Error ? err.message : String(err),
      })
      continue
    }

    for (const outcome of outcomes) {
      await recordOutcome(userId, outcome, platformIdOf)
    }
  }
}

/**
 * Runs the three stages over the user's ROMs that are in no collection yet,
 * creating collections as it goes. It is not one transaction: an aborted run
 * keeps what it already created, and the next run carries on from there.
 * @param signal - Checked between two collections and between two clusters
 */
async function runDetection(
  userId: string,
  signal: AbortSignal,
): Promise<void> {
  const rows = await listRomsForGrouping(userId, { onlyUngrouped: true })
  const platformIdOf = new Map(rows.map((row) => [row.id, row.platformId]))

  const { collections, isolated } = detectCollections(rows.map(toGroupable))
  for (const detected of collections) {
    signal.throwIfAborted()
    await createCollection({
      userId,
      canonicalTitle: detected.canonicalTitle,
      platformId: sharedPlatformId(detected.romIds, platformIdOf),
      source: SOURCE_BY_STAGE[detected.stage],
      confidence: detected.confidence,
      members: detected.romIds.map((romId) => ({ romId })),
    })
  }

  // findNearest only searches the ROMs of the owner of `romId`
  const clusters = await buildCandidateClusters(
    isolated,
    (romId) => findNearest(romId, NEIGHBOR_LIMIT, DEFAULT_SIMILARITY_THRESHOLD),
    { threshold: DEFAULT_SIMILARITY_THRESHOLD },
  )
  if (clusters.length > 0) {
    await groupIsolatedRoms(userId, clusters, rows, signal)
  }
}

/**
 * Builds the API shape of a collection: its members and their pairwise
 * similarities. `sizeBytes` is a BigInt, which JSON cannot carry: it is sent
 * as a number.
 * @throws {AppError} 404 COLLECTION_NOT_FOUND
 */
async function toCollectionDetail(
  userId: string,
  id: string,
): Promise<CollectionDetail> {
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
    createdAt: collection.createdAt.toISOString(),
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

/**
 * POST /api/collections/detect: starts the detection as a background job and
 * answers 202 with its id. Answers 409 DETECTION_ALREADY_RUNNING while a
 * detection of the same user is still running.
 */
collectionRouter.post('/collections/detect', requireAuth, (_req, res, next) => {
  try {
    const userId = res.locals.userId as string
    if (runningDetections.has(userId)) {
      throw AppError.conflict(
        'DETECTION_ALREADY_RUNNING',
        'A collection detection is already running',
      )
    }

    runningDetections.add(userId)
    const jobId = startJob(async (signal) => {
      try {
        await runDetection(userId, signal)
      } finally {
        runningDetections.delete(userId)
      }
    })
    res.status(202).json({ jobId })
  } catch (err) {
    next(err)
  }
})

/**
 * GET /api/collections/duplicates: exact and header duplicates among all the
 * user's ROMs. Declared before /collections/:id so that "duplicates" is not
 * read as an id.
 */
collectionRouter.get(
  '/collections/duplicates',
  requireAuth,
  async (_req, res, next) => {
    try {
      const userId = res.locals.userId as string
      const rows = await listRomsForGrouping(userId)
      const fileNameOf = new Map(rows.map((row) => [row.id, row.fileName]))

      const duplicates: DuplicateGroup[] = findDuplicates(
        rows.map(toGroupable),
      ).map((group) => ({
        kind: group.kind,
        label: group.label,
        roms: group.romIds.map((id) => ({
          id,
          fileName: fileNameOf.get(id) ?? '',
        })),
      }))
      res.status(200).json({ duplicates })
    } catch (err) {
      next(err)
    }
  },
)

/** GET /api/collections: paginated list of the user's collections with their member count. */
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

      const body: Paginated<CollectionSummary> = {
        data: collections.map((collection) => ({
          id: collection.id,
          canonicalTitle: collection.canonicalTitle,
          source: collection.source,
          confidence: collection.confidence,
          platformId: collection.platformId,
          memberCount: collection._count.members,
          createdAt: collection.createdAt.toISOString(),
        })),
        pagination: {
          page,
          pageSize,
          total,
          totalPages: Math.ceil(total / pageSize),
        },
      }
      res.status(200).json(body)
    } catch (err) {
      next(err)
    }
  },
)

/** GET /api/collections/:id: one collection, its members and their pairwise similarity. */
collectionRouter.get(
  '/collections/:id',
  requireAuth,
  validate({ params: collectionIdParamsSchema }),
  async (req, res, next) => {
    try {
      const userId = res.locals.userId as string
      const { id } = req.params as { id: string }
      res.status(200).json(await toCollectionDetail(userId, id))
    } catch (err) {
      next(err)
    }
  },
)

/** POST /api/collections: manual creation (source MANUAL), answers 201. */
collectionRouter.post(
  '/collections',
  requireAuth,
  validate({ body: collectionCreateSchema }),
  async (req, res, next) => {
    try {
      const userId = res.locals.userId as string
      const body = req.body as CollectionCreate
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

/**
 * PATCH /api/collections/:id: renames, adds members and removes members, all
 * or nothing. Answers the updated collection.
 */
collectionRouter.patch(
  '/collections/:id',
  requireAuth,
  validate({
    params: collectionIdParamsSchema,
    body: collectionUpdateSchema,
  }),
  async (req, res, next) => {
    try {
      const userId = res.locals.userId as string
      const { id } = req.params as { id: string }
      const body = req.body as CollectionUpdate

      await updateCollection(userId, id, body)
      res.status(200).json(await toCollectionDetail(userId, id))
    } catch (err) {
      next(err)
    }
  },
)

/**
 * POST /api/collections/:id/merge: moves the members of `sourceId` into the
 * collection of the URL and dissolves `sourceId`. Answers the merged
 * collection.
 */
collectionRouter.post(
  '/collections/:id/merge',
  requireAuth,
  validate({
    params: collectionIdParamsSchema,
    body: collectionMergeSchema,
  }),
  async (req, res, next) => {
    try {
      const userId = res.locals.userId as string
      const { id } = req.params as { id: string }
      const { sourceId } = req.body as CollectionMerge

      await mergeCollections(userId, id, sourceId)
      res.status(200).json(await toCollectionDetail(userId, id))
    } catch (err) {
      next(err)
    }
  },
)

/** DELETE /api/collections/:id: dissolves the collection and keeps the ROMs, answers 204. */
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
