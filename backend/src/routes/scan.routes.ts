import path from 'node:path'
import { scanListQuerySchema, scanRequestSchema } from '@repo/shared/schemas'
import type {
  Paginated,
  ScanJobSummary,
  ScanListQuery,
  ScanRequest,
} from '@repo/shared/types'
import { Router } from 'express'
import { z } from 'zod'
import { env } from '../env.js'
import type { DatEntry as DatEntryRow } from '../generated/prisma/client.js'
import { AppError } from '../lib/error.js'
import { cancelJob, startJob } from '../lib/job-runner.js'
import { prisma } from '../lib/prisma.js'
import { requireAuth } from '../middleware/require-auth.middleware.js'
import { validate } from '../middleware/validate.middleware.js'
import {
  finishProgress,
  getProgress,
  initProgress,
  updateProgress,
  type DatEntry,
  type DatLookup,
} from '../service/identification.service.js'
import { detectPlatformSlug } from '../service/rom-file.service.js'
import {
  runScan,
  toScanJobSummary,
  toScanProgress,
  type ScanDependencies,
} from '../service/scan.service.js'
import {
  findEntriesByNormalizedName,
  findEntryByMd5,
  findEntryBySha1,
  listPlatforms,
} from '../storage/dat.storage.js'
import {
  PathTraversalError,
  hashFile,
  isLibraryDirectory,
  readFileHead,
  resolveWithinRoot,
  walkDirectory,
  type WalkEntry,
} from '../storage/filesystem.storage.js'
import { upsertRom } from '../storage/rom.storage.js'
import {
  createScanJob,
  findScanJob,
  finishScanJob,
  listScanJobs,
  markScanJobRunning,
} from '../storage/scan-job.storage.js'

export const scanRouter = Router()

const scanIdParamsSchema = z.object({
  id: z.uuid(),
})

function toDatEntry(row: DatEntryRow | null | undefined): DatEntry | null {
  if (!row) return null
  return {
    id: row.id,
    name: row.gameName,
    sha1: row.sha1 ?? '',
    md5: row.md5 ?? '',
  }
}

// No-Intro catalogs hash headerless data, so the data-only hashes are looked
// up in the same columns as the full-file ones.
const datLookup: DatLookup = {
  findBySha1Full: async (sha1) =>
    toDatEntry(await findEntryBySha1({ prisma }, sha1)),
  findByMd5Full: async (md5) =>
    toDatEntry(await findEntryByMd5({ prisma }, md5)),
  findBySha1Data: async (sha1) =>
    toDatEntry(await findEntryBySha1({ prisma }, sha1)),
  findByMd5Data: async (md5) =>
    toDatEntry(await findEntryByMd5({ prisma }, md5)),
  findByNormalizedName: async (name, extension) => {
    const entries = await findEntriesByNormalizedName(
      { prisma },
      name,
      extension,
    )
    return entries.length === 1 ? toDatEntry(entries[0]) : null
  },
}

// The whole list is needed up front to know `totalFiles`
async function collectRomFiles(absoluteRoot: string): Promise<WalkEntry[]> {
  const entries: WalkEntry[] = []
  for await (const entry of walkDirectory(absoluteRoot, {
    extensions: env.ROM_EXTENSIONS,
  })) {
    entries.push(entry)
  }
  return entries
}

// Plugs the real filesystem, DAT catalogs, Redis and PostgreSQL into the
// scan orchestration, which stays free of any I/O.
function buildScanDependencies(
  jobId: string,
  userId: string,
): ScanDependencies {
  let platformIdBySlug: Promise<Map<string, string>> | undefined

  return {
    walk: collectRomFiles,
    hash: hashFile,
    lookup: datLookup,
    detectPlatform: async (entry) => {
      platformIdBySlug ??= listPlatforms({ prisma }).then(
        (platforms) =>
          new Map(platforms.map((platform) => [platform.slug, platform.id])),
      )
      const slug = detectPlatformSlug(
        entry.absolutePath,
        await readFileHead(entry.absolutePath),
      )
      return slug ? ((await platformIdBySlug).get(slug) ?? null) : null
    },
    saveRom: upsertRom,
    reportProgress: {
      init: async (totalFiles) => {
        await markScanJobRunning(jobId, totalFiles)
        await initProgress(jobId, userId, totalFiles)
      },
      update: (counters) => updateProgress(jobId, counters),
      finish: async (status, counters, errorMessage) => {
        await finishProgress(jobId, status, errorMessage)
        await finishScanJob(jobId, status, counters, errorMessage)
      },
    },
  }
}

// POST /api/scans: records the job, starts it in the background, answers 202
scanRouter.post(
  '/scans',
  requireAuth,
  validate({ body: scanRequestSchema }),
  async (req, res, next) => {
    try {
      const userId = res.locals.userId as string
      const { path: requestedPath } = req.body as ScanRequest

      if (!(await isLibraryDirectory(requestedPath))) {
        next(
          AppError.badRequest('INVALID_PATH', 'Scan root is not a directory', {
            path: requestedPath,
          }),
        )
        return
      }

      const absoluteRoot = resolveWithinRoot(requestedPath)
      // Always POSIX ('/'): joined with, and compared against, entry.relativePath
      const rootRelativePath = path
        .relative(path.resolve(env.ROM_LIBRARY_ROOT), absoluteRoot)
        .split(path.sep)
        .join('/')
      const job = await createScanJob(userId, rootRelativePath)

      startJob(
        (signal) =>
          runScan(buildScanDependencies(job.id, userId), {
            userId,
            absoluteRoot,
            rootRelativePath,
            concurrency: env.SCAN_CONCURRENCY,
            signal,
          }),
        job.id,
      )

      res.status(202).json({ jobId: job.id })
    } catch (err) {
      if (err instanceof PathTraversalError) {
        next(AppError.badRequest('INVALID_PATH', err.message))
        return
      }
      next(err)
    }
  },
)

// GET /api/scans/:id: live progress from Redis, PostgreSQL once it expired
scanRouter.get(
  '/scans/:id',
  requireAuth,
  validate({ params: scanIdParamsSchema }),
  async (req, res, next) => {
    try {
      const userId = res.locals.userId as string
      const { id } = req.params as z.infer<typeof scanIdParamsSchema>

      const live = await getProgress(id)
      if (live?.userId === userId) {
        const { userId: _owner, ...progress } = live
        res.status(200).json(progress)
        return
      }

      const job = await findScanJob(id, userId)
      if (!job) {
        next(AppError.notFound('SCAN_NOT_FOUND', 'Scan not found'))
        return
      }

      res.status(200).json(toScanProgress(job))
    } catch (err) {
      next(err)
    }
  },
)

// GET /api/scans: the user's scan history, most recent first
scanRouter.get(
  '/scans',
  requireAuth,
  validate({ query: scanListQuerySchema }),
  async (req, res, next) => {
    try {
      const userId = res.locals.userId as string
      const { page, pageSize } = req.query as unknown as ScanListQuery

      const { jobs, total } = await listScanJobs(userId, page, pageSize)
      const body: Paginated<ScanJobSummary> = {
        data: jobs.map(toScanJobSummary),
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

// DELETE /api/scans/:id: aborts a running scan, which then ends CANCELLED
scanRouter.delete(
  '/scans/:id',
  requireAuth,
  validate({ params: scanIdParamsSchema }),
  async (req, res, next) => {
    try {
      const userId = res.locals.userId as string
      const { id } = req.params as z.infer<typeof scanIdParamsSchema>

      const job = await findScanJob(id, userId)
      if (!job) {
        next(AppError.notFound('SCAN_NOT_FOUND', 'Scan not found'))
        return
      }
      if (!cancelJob(id)) {
        next(AppError.conflict('SCAN_NOT_RUNNING', 'Scan is not running'))
        return
      }

      res.status(204).send()
    } catch (err) {
      next(err)
    }
  },
)
