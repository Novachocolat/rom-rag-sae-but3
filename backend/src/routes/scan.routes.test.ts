import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { scanRouter } from './scan.routes.js'
import { errorMiddleware } from '../middleware/error.middleware.js'
import { prisma } from '../lib/prisma.js'
import { startJob, cancelJob } from '../lib/job-runner.js'
import * as identificationService from '../service/identification.service.js'

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    scanJob: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}))

vi.mock('../lib/redis.js', () => ({
  redis: {},
}))

vi.mock('../lib/job-runner.js', () => ({
  startJob: vi.fn(),
  cancelJob: vi.fn(),
}))

vi.mock('../storage/rom.storage.js', () => ({
  upsertRom: vi.fn(),
}))

vi.mock('../service/identification.service.js', () => ({
  initProgress: vi.fn(),
  updateProgress: vi.fn(),
  getProgress: vi.fn(),
  finishProgress: vi.fn(),
}))

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/api', scanRouter)
  app.use(errorMiddleware)
  return app
}

describe('scan.routes', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  describe('POST /api/scans', () => {
    it('returns 400 when the body is missing `path`', async () => {
      const res = await request(buildApp()).post('/api/scans').send({})

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('returns 401 when no x-user-id header is provided', async () => {
      const res = await request(buildApp())
        .post('/api/scans')
        .send({ path: 'snes' })

      expect(res.status).toBe(401)
      expect(res.body.error.code).toBe('UNAUTHENTICATED')
    })

    it('returns 400 when the path escapes ROM_LIBRARY_ROOT', async () => {
      const res = await request(buildApp())
        .post('/api/scans')
        .set('x-user-id', 'user-1')
        .send({ path: '../../etc' })

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('INVALID_SCAN_ROOT')
    })

    it('returns 202 and a jobId for a valid request', async () => {
      vi.mocked(startJob).mockReturnValue('job-123')

      const res = await request(buildApp())
        .post('/api/scans')
        .set('x-user-id', 'user-1')
        .send({ path: 'snes' })

      expect(res.status).toBe(202)
      expect(res.body).toEqual({ jobId: 'job-123' })
      expect(startJob).toHaveBeenCalledTimes(1)
    })
  })

  describe('GET /api/scans/:id', () => {
    it('returns the progress from Redis when present', async () => {
      const progress = {
        jobId: 'job-123',
        status: 'RUNNING' as const,
        totalFiles: 10,
        processedFiles: 4,
        identifiedCount: 3,
        unidentifiedCount: 1,
        errorCount: 0,
        current: 'game.nes',
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        finishedAt: null,
        errorMessage: null,
      }
      vi.mocked(identificationService.getProgress).mockResolvedValue(progress)

      const res = await request(buildApp()).get('/api/scans/job-123')

      expect(res.status).toBe(200)
      expect(res.body).toEqual(progress)
      expect(prisma.scanJob.findUnique).not.toHaveBeenCalled()
    })

    it('falls back to Postgres when Redis has nothing', async () => {
      vi.mocked(identificationService.getProgress).mockResolvedValue(null)
      vi.mocked(prisma.scanJob.findUnique).mockResolvedValue({
        id: 'job-123',
        status: 'COMPLETED',
        totalFiles: 10,
        processedFiles: 10,
        identifiedCount: 8,
        unidentifiedCount: 2,
        errorCount: 0,
      } as never)

      const res = await request(buildApp()).get('/api/scans/job-123')

      expect(res.status).toBe(200)
      expect(res.body.status).toBe('DONE')
      expect(res.body.processedFiles).toBe(10)
    })

    it('returns 404 when the job is in neither Redis nor Postgres', async () => {
      vi.mocked(identificationService.getProgress).mockResolvedValue(null)
      vi.mocked(prisma.scanJob.findUnique).mockResolvedValue(null)

      const res = await request(buildApp()).get('/api/scans/unknown-job')

      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('SCAN_NOT_FOUND')
    })
  })

  describe('GET /api/scans', () => {
    it('returns 401 when no x-user-id header is provided', async () => {
      const res = await request(buildApp()).get('/api/scans')

      expect(res.status).toBe(401)
    })

    it('returns a paginated history for the authenticated user', async () => {
      vi.mocked(prisma.scanJob.findMany).mockResolvedValue([
        { id: 'job-1' },
        { id: 'job-2' },
      ] as never)
      vi.mocked(prisma.scanJob.count).mockResolvedValue(2)

      const res = await request(buildApp())
        .get('/api/scans?page=1&pageSize=10')
        .set('x-user-id', 'user-1')

      expect(res.status).toBe(200)
      expect(res.body.total).toBe(2)
      expect(res.body.page).toBe(1)
      expect(res.body.pageSize).toBe(10)
      expect(res.body.jobs).toHaveLength(2)
    })
  })

  describe('DELETE /api/scans/:id', () => {
    it('returns 204 when the job was cancelled', async () => {
      vi.mocked(cancelJob).mockReturnValue(true)

      const res = await request(buildApp()).delete('/api/scans/job-123')

      expect(res.status).toBe(204)
      expect(cancelJob).toHaveBeenCalledWith('job-123')
    })

    it('returns 404 when the job is unknown or already finished', async () => {
      vi.mocked(cancelJob).mockReturnValue(false)

      const res = await request(buildApp()).delete('/api/scans/job-123')

      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('SCAN_NOT_FOUND')
    })
  })
})
