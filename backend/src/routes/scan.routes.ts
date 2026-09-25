// backend/src/routes/scan.routes.ts
import path from 'node:path'
import { Router, type Request } from 'express'
import type { ScanProgress } from '../schemas/scan.schema.js'
import {
  scanRequestSchema,
  scanIdParamsSchema,
  scanListQuerySchema,
} from '../schemas/scan.schema.js'
import { validate } from '../middleware/validate.middleware.js'
import { env } from '../env.js'
import { AppError } from '../lib/error.js'
import { redis } from '../lib/redis.js'
import { prisma } from '../lib/prisma.js'
import { startJob, cancelJob } from '../lib/job-runner.js'
import { runScan, type ScanDependencies } from '../service/scan.service.js'
import {
  initProgress,
  updateProgress,
  getProgress,
  finishProgress,
} from '../service/identification.service.js'
import { upsertRom } from '../storage/rom.storage.js'

function getUserId(req: Request): string {
  const userId = req.headers['x-user-id']
  if (typeof userId !== 'string' || !userId) {
    throw AppError.unauthorized(
      'UNAUTHENTICATED',
      'Utilisateur non authentifié',
    )
  }
  return userId
}

// Ensures `requestedPath` resolves inside ROM_LIBRARY_ROOT (no path traversal)
function resolveScanRoot(requestedPath: string): string {
  const resolved = path.resolve(env.ROM_LIBRARY_ROOT, requestedPath)
  const root = path.resolve(env.ROM_LIBRARY_ROOT)

  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw AppError.badRequest(
      'INVALID_SCAN_ROOT',
      'Le chemin doit être à l’intérieur de la bibliothèque de ROMs',
      { path: requestedPath },
    )
  }
  return resolved
}

//real filesystem walker (owned by another ticket)
const walk: ScanDependencies['walk'] = () => {
  throw new Error('walk() not implemented yet')
}

//real hasher (owned by another ticket)
const hash: ScanDependencies['hash'] = () => {
  throw new Error('hash() not implemented yet')
}

//real DAT lookup backed by Postgres (owned by another ticket)
const lookup: ScanDependencies['lookup'] = {
  findBySha1Full: () => Promise.resolve(null),
  findByMd5Full: () => Promise.resolve(null),
  findBySha1Data: () => Promise.resolve(null),
  findByMd5Data: () => Promise.resolve(null),
  findByNormalizedName: () => Promise.resolve(null),
}

function buildReportProgress(
  getJobId: () => string,
): ScanDependencies['reportProgress'] {
  return {
    init: (totalFiles) =>
      initProgress(redis, getJobId(), totalFiles).then(() => undefined),
    update: (patch, options) =>
      updateProgress(redis, getJobId(), patch, options),
    finish: (status, errorMessage) =>
      finishProgress(redis, getJobId(), status, errorMessage).then(
        () => undefined,
      ),
  }
}

export const scanRouter = Router()

// POST /api/scans — starts a scan job on `path`, returns 202 + jobId
scanRouter.post('/scans', validate({ body: scanRequestSchema }), (req, res) => {
  const userId = getUserId(req)
  const root = resolveScanRoot(req.body.path as string)
  let jobId: string

  const deps: ScanDependencies = {
    walk,
    hash,
    lookup,
    saveRom: ({ userId: u, relativePath, candidate, identification }) =>
      upsertRom({
        userId: u,
        relativePath,
        fileName: candidate.fileName,
        extension: path.extname(candidate.fileName),
        sizeBytes: 0n,
        md5: candidate.md5FullFile,
        sha1: candidate.sha1FullFile,
        md5Data: candidate.md5Data,
        sha1Data: candidate.sha1Data,
        headerBytesSkipped: candidate.headerBytesSkipped,
        identificationSource: identification.source,
        confidence: identification.confidence,
      }).then(() => undefined),
    reportProgress: buildReportProgress(() => jobId),
  }

  jobId = startJob(() =>
    runScan(deps, { userId, root, concurrency: env.SCAN_CONCURRENCY }),
  )

  res.status(202).json({ jobId })
})

// GET /api/scans/:id — progress, Redis first, Postgres fallback
scanRouter.get(
  '/scans/:id',
  validate({ params: scanIdParamsSchema }),
  (req, res, next) => {
    void (async () => {
      const { id } = req.params as { id: string }

      const fromRedis = await getProgress(redis, id)
      if (fromRedis) {
        res.status(200).json(fromRedis)
        return
      }

      const job = await prisma.scanJob.findUnique({ where: { id } })
      if (!job) {
        throw AppError.notFound('SCAN_NOT_FOUND', `Scan ${id} introuvable`)
      }

      const payload: ScanProgress = {
        jobId: job.id,
        status:
          job.status === 'COMPLETED'
            ? 'DONE'
            : job.status === 'FAILED'
              ? 'ERROR'
              : job.status,
        totalFiles: job.totalFiles,
        processedFiles: job.processedFiles,
        identifiedCount: job.identifiedCount,
        unidentifiedCount: job.unidentifiedCount,
        errorCount: job.errorCount,
        current: null,
      }
      res.status(200).json(payload)
    })().catch(next)
  },
)

// DELETE /api/scans/:id - cancellation
scanRouter.delete(
  '/scans/:id',
  validate({ params: scanIdParamsSchema }),
  (req, res) => {
    const { id } = req.params as { id: string }
    const cancelled = cancelJob(id)

    if (!cancelled) {
      throw AppError.notFound(
        'SCAN_NOT_FOUND',
        `Scan ${id} introuvable ou déjà terminé`,
      )
    }

    res.status(204).send()
  },
)

// GET /api/scans — paginated scan history
scanRouter.get(
  '/scans',
  validate({ query: scanListQuerySchema }),
  (req, res, next) => {
    void (async () => {
      const userId = getUserId(req)
      const { page, pageSize } = req.query as unknown as {
        page: number
        pageSize: number
      }

      const [jobs, total] = await Promise.all([
        prisma.scanJob.findMany({
          where: { userId },
          orderBy: { startedAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        prisma.scanJob.count({ where: { userId } }),
      ])

      res.status(200).json({ jobs, total, page, pageSize })
    })().catch(next)
  },
)
