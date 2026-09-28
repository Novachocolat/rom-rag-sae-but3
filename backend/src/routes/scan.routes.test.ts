import path from 'node:path'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../app.js'
import { env } from '../env.js'
import { cancelJob, startJob } from '../lib/job-runner.js'
import { redis } from '../lib/redis.js'
import {
  finishProgress,
  getProgress,
  initProgress,
  updateProgress,
} from '../service/identification.service.js'
import { runScan, type ScanDependencies } from '../service/scan.service.js'
import {
  findEntriesByNormalizedName,
  findEntryByMd5,
  findEntryBySha1,
} from '../storage/dat.storage.js'
import {
  isLibraryDirectory,
  walkDirectory,
} from '../storage/filesystem.storage.js'
import {
  createScanJob,
  findScanJob,
  finishScanJob,
  listScanJobs,
  markScanJobRunning,
} from '../storage/scan-job.storage.js'

vi.mock('../lib/redis.js', () => ({
  redis: { get: vi.fn(), expire: vi.fn() },
}))
vi.mock('../lib/job-runner.js', () => ({
  startJob: vi.fn(),
  cancelJob: vi.fn(),
}))
vi.mock('../service/identification.service.js', () => ({
  initProgress: vi.fn(),
  updateProgress: vi.fn(),
  getProgress: vi.fn(),
  finishProgress: vi.fn(),
}))
vi.mock('../service/scan.service.js', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../service/scan.service.js')>()
  return { ...original, runScan: vi.fn() }
})
vi.mock('../storage/dat.storage.js', () => ({
  findEntryBySha1: vi.fn(),
  findEntryByMd5: vi.fn(),
  findEntriesByNormalizedName: vi.fn(),
}))
vi.mock('../storage/filesystem.storage.js', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../storage/filesystem.storage.js')>()
  return { ...original, isLibraryDirectory: vi.fn(), walkDirectory: vi.fn() }
})
vi.mock('../storage/scan-job.storage.js', () => ({
  createScanJob: vi.fn(),
  markScanJobRunning: vi.fn(),
  finishScanJob: vi.fn(),
  findScanJob: vi.fn(),
  listScanJobs: vi.fn(),
}))

const AUTH_COOKIE = `${env.SESSION_COOKIE_NAME}=tok123`
const JOB_ID = '6f1c1f63-3a5e-4c6b-9a57-1f0d7a1b2c3d'

const scanJobRow = {
  id: JOB_ID,
  userId: 'user-1',
  rootRelativePath: 'nes',
  status: 'COMPLETED' as const,
  totalFiles: 10,
  processedFiles: 10,
  identifiedCount: 8,
  unidentifiedCount: 2,
  errorCount: 0,
  startedAt: new Date('2026-09-27T10:00:00Z'),
  finishedAt: new Date('2026-09-27T10:01:00Z'),
  errorMessage: null,
}

// Starts a scan through the route and returns the dependencies it wired
async function startScanAndGetDeps(): Promise<ScanDependencies> {
  vi.mocked(isLibraryDirectory).mockResolvedValue(true)
  vi.mocked(createScanJob).mockResolvedValue(scanJobRow)
  await request(createApp())
    .post('/api/scans')
    .set('Cookie', AUTH_COOKIE)
    .send({ path: 'nes' })

  const job = vi.mocked(startJob).mock.lastCall?.[0]
  await job?.(new AbortController().signal)
  const deps = vi.mocked(runScan).mock.lastCall?.[0]
  if (!deps) throw new Error('runScan was not called')
  return deps
}

describe('scan.routes', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(redis.get).mockResolvedValue('user-1')
    vi.mocked(redis.expire).mockResolvedValue(1)
  })

  describe('POST /api/scans', () => {
    it('rejects an unauthenticated request', async () => {
      const res = await request(createApp())
        .post('/api/scans')
        .send({ path: 'nes' })

      expect(res.status).toBe(401)
      expect(startJob).not.toHaveBeenCalled()
    })

    it('returns 400 when the body has no `path`', async () => {
      const res = await request(createApp())
        .post('/api/scans')
        .set('Cookie', AUTH_COOKIE)
        .send({})

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('returns 400 when the path escapes ROM_LIBRARY_ROOT', async () => {
      const res = await request(createApp())
        .post('/api/scans')
        .set('Cookie', AUTH_COOKIE)
        .send({ path: '../../etc' })

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('INVALID_PATH')
      expect(createScanJob).not.toHaveBeenCalled()
    })

    it('returns 400 when the path is not a directory', async () => {
      vi.mocked(isLibraryDirectory).mockResolvedValue(false)

      const res = await request(createApp())
        .post('/api/scans')
        .set('Cookie', AUTH_COOKIE)
        .send({ path: 'missing' })

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('INVALID_PATH')
    })

    it('records the job, starts it under the same id and returns 202', async () => {
      vi.mocked(isLibraryDirectory).mockResolvedValue(true)
      vi.mocked(createScanJob).mockResolvedValue(scanJobRow)

      const res = await request(createApp())
        .post('/api/scans')
        .set('Cookie', AUTH_COOKIE)
        .send({ path: 'nes/../nes' })

      expect(res.status).toBe(202)
      expect(res.body).toEqual({ jobId: JOB_ID })
      expect(createScanJob).toHaveBeenCalledWith('user-1', 'nes')
      expect(startJob).toHaveBeenCalledWith(expect.any(Function), JOB_ID)
    })

    it('hands runScan the resolved root and SCAN_CONCURRENCY', async () => {
      await startScanAndGetDeps()

      expect(runScan).toHaveBeenCalledWith(expect.any(Object), {
        userId: 'user-1',
        absoluteRoot: path.resolve(env.ROM_LIBRARY_ROOT, 'nes'),
        rootRelativePath: 'nes',
        concurrency: env.SCAN_CONCURRENCY,
        signal: expect.any(AbortSignal),
      })
    })
  })

  describe('scan dependencies wiring', () => {
    it('walk collects every ROM file of the directory', async () => {
      const deps = await startScanAndGetDeps()
      const entry = {
        absolutePath: '/roms/nes/a.nes',
        relativePath: 'a.nes',
        sizeBytes: 1,
      }
      vi.mocked(walkDirectory).mockImplementation(async function* () {
        yield entry
      })

      await expect(deps.walk('/roms/nes')).resolves.toEqual([entry])
      expect(walkDirectory).toHaveBeenCalledWith('/roms/nes', {
        extensions: env.ROM_EXTENSIONS,
      })
    })

    it('lookup maps DAT rows and searches data-only hashes in the same columns', async () => {
      const deps = await startScanAndGetDeps()
      // @ts-expect-error partial mock, only the fields the test needs
      vi.mocked(findEntryBySha1).mockResolvedValue({
        id: 'entry-1',
        gameName: 'Game (Europe)',
        sha1: 'sha1',
        md5: null,
      })
      vi.mocked(findEntryByMd5).mockResolvedValue(null)
      vi.mocked(findEntriesByNormalizedName).mockResolvedValue([])

      const expected = {
        id: 'entry-1',
        name: 'Game (Europe)',
        sha1: 'sha1',
        md5: '',
      }
      await expect(deps.lookup.findBySha1Full('sha1')).resolves.toEqual(
        expected,
      )
      await expect(deps.lookup.findBySha1Data('sha1')).resolves.toEqual(
        expected,
      )
      await expect(deps.lookup.findByMd5Full('md5')).resolves.toBeNull()
      await expect(deps.lookup.findByMd5Data('md5')).resolves.toBeNull()
      await expect(deps.lookup.findByNormalizedName('game')).resolves.toBeNull()
    })

    it('reportProgress writes to both Redis and PostgreSQL', async () => {
      const deps = await startScanAndGetDeps()
      const counters = {
        processedFiles: 1,
        identifiedCount: 1,
        unidentifiedCount: 0,
        errorCount: 0,
        current: null,
      }

      await deps.reportProgress.init(3)
      await deps.reportProgress.update(counters)
      await deps.reportProgress.finish('COMPLETED', counters, null)

      expect(markScanJobRunning).toHaveBeenCalledWith(JOB_ID, 3)
      expect(initProgress).toHaveBeenCalledWith(JOB_ID, 'user-1', 3)
      expect(updateProgress).toHaveBeenCalledWith(JOB_ID, counters)
      expect(finishProgress).toHaveBeenCalledWith(JOB_ID, 'COMPLETED', null)
      expect(finishScanJob).toHaveBeenCalledWith(
        JOB_ID,
        'COMPLETED',
        counters,
        null,
      )
    })
  })

  describe('GET /api/scans/:id', () => {
    it('returns the live progress from Redis, without its owner', async () => {
      const progress = {
        jobId: JOB_ID,
        status: 'RUNNING' as const,
        totalFiles: 10,
        processedFiles: 4,
        identifiedCount: 3,
        unidentifiedCount: 1,
        errorCount: 0,
        current: 'nes/game.nes',
        errorMessage: null,
      }
      vi.mocked(getProgress).mockResolvedValue({
        ...progress,
        userId: 'user-1',
      })

      const res = await request(createApp())
        .get(`/api/scans/${JOB_ID}`)
        .set('Cookie', AUTH_COOKIE)

      expect(res.status).toBe(200)
      expect(res.body).toEqual(progress)
      expect(findScanJob).not.toHaveBeenCalled()
    })

    it('falls back to PostgreSQL once the Redis progress expired', async () => {
      vi.mocked(getProgress).mockResolvedValue(null)
      vi.mocked(findScanJob).mockResolvedValue(scanJobRow)

      const res = await request(createApp())
        .get(`/api/scans/${JOB_ID}`)
        .set('Cookie', AUTH_COOKIE)

      expect(res.status).toBe(200)
      expect(res.body).toMatchObject({
        jobId: JOB_ID,
        status: 'COMPLETED',
        processedFiles: 10,
        current: null,
      })
    })

    it('returns 404 for a scan owned by someone else', async () => {
      vi.mocked(getProgress).mockResolvedValue({
        jobId: JOB_ID,
        userId: 'user-2',
        status: 'RUNNING',
        totalFiles: 1,
        processedFiles: 0,
        identifiedCount: 0,
        unidentifiedCount: 0,
        errorCount: 0,
        current: null,
        errorMessage: null,
      })
      vi.mocked(findScanJob).mockResolvedValue(null)

      const res = await request(createApp())
        .get(`/api/scans/${JOB_ID}`)
        .set('Cookie', AUTH_COOKIE)

      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('SCAN_NOT_FOUND')
      expect(findScanJob).toHaveBeenCalledWith(JOB_ID, 'user-1')
    })

    it('returns 400 for an id that is not a UUID', async () => {
      const res = await request(createApp())
        .get('/api/scans/not-a-uuid')
        .set('Cookie', AUTH_COOKIE)

      expect(res.status).toBe(400)
    })
  })

  describe('GET /api/scans', () => {
    it('rejects an unauthenticated request', async () => {
      const res = await request(createApp()).get('/api/scans')

      expect(res.status).toBe(401)
    })

    it('returns a paginated history for the authenticated user', async () => {
      vi.mocked(listScanJobs).mockResolvedValue({
        jobs: [scanJobRow],
        total: 11,
      })

      const res = await request(createApp())
        .get('/api/scans?page=2&pageSize=5')
        .set('Cookie', AUTH_COOKIE)

      expect(res.status).toBe(200)
      expect(listScanJobs).toHaveBeenCalledWith('user-1', 2, 5)
      expect(res.body.pagination).toEqual({
        page: 2,
        pageSize: 5,
        total: 11,
        totalPages: 3,
      })
      expect(res.body.data[0]).toMatchObject({
        jobId: JOB_ID,
        rootRelativePath: 'nes',
      })
    })
  })

  describe('DELETE /api/scans/:id', () => {
    it('returns 204 once the running scan is aborted', async () => {
      vi.mocked(findScanJob).mockResolvedValue(scanJobRow)
      vi.mocked(cancelJob).mockReturnValue(true)

      const res = await request(createApp())
        .delete(`/api/scans/${JOB_ID}`)
        .set('Cookie', AUTH_COOKIE)

      expect(res.status).toBe(204)
      expect(cancelJob).toHaveBeenCalledWith(JOB_ID)
    })

    it('returns 404 for an unknown scan or one owned by someone else', async () => {
      vi.mocked(findScanJob).mockResolvedValue(null)

      const res = await request(createApp())
        .delete(`/api/scans/${JOB_ID}`)
        .set('Cookie', AUTH_COOKIE)

      expect(res.status).toBe(404)
      expect(cancelJob).not.toHaveBeenCalled()
    })

    it('returns 409 for a scan that is not running anymore', async () => {
      vi.mocked(findScanJob).mockResolvedValue(scanJobRow)
      vi.mocked(cancelJob).mockReturnValue(false)

      const res = await request(createApp())
        .delete(`/api/scans/${JOB_ID}`)
        .set('Cookie', AUTH_COOKIE)

      expect(res.status).toBe(409)
      expect(res.body.error.code).toBe('SCAN_NOT_RUNNING')
    })
  })
})
