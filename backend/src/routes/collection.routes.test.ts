import express from 'express'
import type { NextFunction, Request, Response } from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '../lib/error.js'
import { startJob } from '../lib/job-runner.js'
import { errorMiddleware } from '../middleware/error.middleware.js'
import {
  buildGroupingPorts,
  proposeGroupings,
  type GroupingOutcome,
} from '../service/ai-grouping.service.js'
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
} from '../storage/collection.storage.js'
import { listPlatforms } from '../storage/dat.storage.js'
import { collectionRouter } from './collection.routes.js'

vi.mock('../middleware/require-auth.middleware.js', () => ({
  requireAuth: (_req: Request, res: Response, next: NextFunction) => {
    res.locals.userId = 'user-1'
    next()
  },
}))
vi.mock('../lib/prisma.js', () => ({ prisma: {} }))
vi.mock('../lib/job-runner.js', () => ({ startJob: vi.fn() }))
vi.mock('../storage/dat.storage.js', () => ({ listPlatforms: vi.fn() }))
vi.mock('../service/ai-grouping.service.js', () => ({
  buildGroupingPorts: vi.fn(),
  proposeGroupings: vi.fn(),
}))
vi.mock('../storage/collection.storage.js', () => ({
  addMembers: vi.fn(),
  createCollection: vi.fn(),
  deleteCollection: vi.fn(),
  findNeighbors: vi.fn(),
  getCollectionWithRoms: vi.fn(),
  getMemberSimilarities: vi.fn(),
  listCollections: vi.fn(),
  listRomsForGrouping: vi.fn(),
  removeMember: vi.fn(),
  updateCollection: vi.fn(),
}))

const ID = '6f1c1f63-3a5e-4c6b-9a57-1f0d7a1b2c3d'
const OTHER_ID = '7a2d2e74-4b6f-4d7c-8b68-2e1e8b2c3d4e'
const PLATFORM_ID = '8b3e3f85-5c70-4e8d-9c79-3f2f9c3d4e5f'

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/api', collectionRouter)
  app.use(errorMiddleware)
  return app
}

function makeRow(id: string, fileName: string, sha1 = `sha1-${id}`) {
  return {
    id,
    fileName,
    platformId: PLATFORM_ID,
    sha1,
    sha1Data: null,
    gameExternalId: null,
    cloneOfId: null,
  }
}

function makeOutcome(
  overrides: Partial<GroupingOutcome> = {},
): GroupingOutcome {
  return {
    decision: 'PROPOSED',
    canonicalTitle: 'alpha quest',
    members: [
      { romId: 'x', variantLabel: null },
      { romId: 'y', variantLabel: 'II' },
    ],
    removedRomIds: [],
    confidence: 0.9,
    reasoning: 'Same game',
    issues: [],
    raw: '{}',
    model: 'test-model',
    durationMs: 1,
    promptTokens: 1,
    completionTokens: 1,
    ...overrides,
  }
}

// Makes startJob run the job and hands back its promise, so a test can wait
function captureJob(): () => Promise<unknown> {
  let job: Promise<unknown> = Promise.resolve()
  vi.mocked(startJob).mockImplementation((fn) => {
    job = fn(new AbortController().signal)
    return 'job-1'
  })
  return () => job
}

describe('collection.routes', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  describe('POST /api/collections/detect', () => {
    it('answers 202 with the job id', async () => {
      vi.mocked(startJob).mockReturnValue('job-1')

      const res = await request(buildApp()).post('/api/collections/detect')

      expect(res.status).toBe(202)
      expect(res.body).toEqual({ jobId: 'job-1' })
    })

    it('builds the DAT collections, then an AI collection for isolated ROMs', async () => {
      const waitForJob = captureJob()
      vi.mocked(listRomsForGrouping).mockResolvedValue([
        makeRow('usa', 'Tetris (USA).gb'),
        makeRow('eur', 'Tetris (Europe).gb'),
        makeRow('x', 'Alpha Quest.gb'),
        makeRow('y', 'Alpha Quest II.gb'),
      ])
      vi.mocked(findNeighbors).mockImplementation((_user, romId) =>
        Promise.resolve(
          romId === 'x' ? [{ romId: 'y', similarity: 0.95 }] : [],
        ),
      )
      vi.mocked(listPlatforms).mockResolvedValue([
        { id: PLATFORM_ID, name: 'Game Boy', slug: 'gb', extensions: ['.gb'] },
      ] as never)
      vi.mocked(proposeGroupings).mockResolvedValue([makeOutcome()])

      await request(buildApp()).post('/api/collections/detect')
      await waitForJob()

      expect(listRomsForGrouping).toHaveBeenCalledWith('user-1', {
        onlyUngrouped: true,
      })
      expect(createCollection).toHaveBeenCalledTimes(2)
      expect(createCollection).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          userId: 'user-1',
          canonicalTitle: 'tetris',
          platformId: PLATFORM_ID,
          source: 'DAT_CLONE',
          confidence: 0.95,
        }),
      )
      expect(createCollection).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          canonicalTitle: 'alpha quest',
          source: 'AI',
          confidence: 0.9,
          platformId: PLATFORM_ID,
        }),
      )
    })

    it('does not create a collection from an unsure or rejected proposal', async () => {
      const waitForJob = captureJob()
      vi.mocked(listRomsForGrouping).mockResolvedValue([
        makeRow('x', 'Alpha Quest.gb'),
        makeRow('y', 'Alpha Quest II.gb'),
      ])
      vi.mocked(findNeighbors).mockImplementation((_user, romId) =>
        Promise.resolve(
          romId === 'x' ? [{ romId: 'y', similarity: 0.95 }] : [],
        ),
      )
      vi.mocked(listPlatforms).mockResolvedValue([] as never)
      vi.mocked(proposeGroupings).mockResolvedValue([
        makeOutcome({ decision: 'LOW_CONFIDENCE' }),
        makeOutcome({ decision: 'NOT_SAME_GAME' }),
      ])

      await request(buildApp()).post('/api/collections/detect')
      await waitForJob()

      expect(createCollection).not.toHaveBeenCalled()
    })

    it('skips the model when no isolated ROM has a close neighbor', async () => {
      const waitForJob = captureJob()
      vi.mocked(listRomsForGrouping).mockResolvedValue([
        makeRow('x', 'Alpha Quest.gb'),
        makeRow('y', 'Beta Quest.gb'),
      ])
      vi.mocked(findNeighbors).mockResolvedValue([])

      await request(buildApp()).post('/api/collections/detect')
      await waitForJob()

      expect(proposeGroupings).not.toHaveBeenCalled()
      expect(buildGroupingPorts).not.toHaveBeenCalled()
    })
  })

  describe('GET /api/collections', () => {
    it('lists the collections with their member count', async () => {
      vi.mocked(listCollections).mockResolvedValue({
        collections: [
          {
            id: ID,
            canonicalTitle: 'tetris',
            source: 'DAT_CLONE',
            confidence: 0.95,
            platformId: PLATFORM_ID,
            createdAt: new Date('2026-10-01T10:00:00Z'),
            _count: { members: 3 },
          },
        ],
        total: 1,
      } as never)

      const res = await request(buildApp()).get(
        '/api/collections?page=1&pageSize=10',
      )

      expect(res.status).toBe(200)
      expect(res.body.total).toBe(1)
      expect(res.body.items[0].memberCount).toBe(3)
      expect(listCollections).toHaveBeenCalledWith({
        userId: 'user-1',
        page: 1,
        pageSize: 10,
      })
    })
  })

  describe('GET /api/collections/duplicates', () => {
    it('reports exact duplicates and header duplicates apart', async () => {
      vi.mocked(listRomsForGrouping).mockResolvedValue([
        makeRow('a', 'Tetris.gb', 'same'),
        makeRow('b', 'Tetris copy.gb', 'same'),
        { ...makeRow('c', 'Mario.sfc', 'sha-h'), sha1Data: 'data' },
        { ...makeRow('d', 'Mario headerless.sfc', 'sha-b'), sha1Data: 'data' },
      ])

      const res = await request(buildApp()).get('/api/collections/duplicates')

      expect(res.status).toBe(200)
      const kinds = (res.body.duplicates as { kind: string }[]).map(
        (group) => group.kind,
      )
      expect(kinds).toEqual(['EXACT_DUPLICATE', 'HEADER_DUPLICATE'])
      expect(res.body.duplicates[0].roms).toEqual([
        { id: 'a', fileName: 'Tetris.gb' },
        { id: 'b', fileName: 'Tetris copy.gb' },
      ])
      expect(res.body.duplicates[1].label).toBe('Same dump, different header')
    })
  })

  describe('GET /api/collections/:id', () => {
    it('returns the members and their similarities', async () => {
      vi.mocked(getCollectionWithRoms).mockResolvedValue({
        id: ID,
        canonicalTitle: 'tetris',
        source: 'AI',
        confidence: 0.9,
        platformId: PLATFORM_ID,
        createdAt: new Date('2026-10-01T10:00:00Z'),
        members: [
          {
            romId: 'a',
            variantLabel: 'USA',
            rom: {
              id: 'a',
              fileName: 'Tetris (USA).gb',
              sizeBytes: 32768n,
              region: 'USA',
              platformId: PLATFORM_ID,
              identificationSource: 'DAT_SHA1',
            },
          },
        ],
      } as never)
      vi.mocked(getMemberSimilarities).mockResolvedValue([
        { romA: 'a', romB: 'b', similarity: 0.97 },
      ])

      const res = await request(buildApp()).get(`/api/collections/${ID}`)

      expect(res.status).toBe(200)
      expect(res.body.members[0].sizeBytes).toBe(32768)
      expect(res.body.members[0].variantLabel).toBe('USA')
      expect(res.body.similarities).toEqual([
        { romA: 'a', romB: 'b', similarity: 0.97 },
      ])
    })

    it('answers 400 for an id that is not a UUID', async () => {
      const res = await request(buildApp()).get('/api/collections/not-a-uuid')

      expect(res.status).toBe(400)
    })

    it('answers 404 for a collection that is not the user own', async () => {
      vi.mocked(getCollectionWithRoms).mockRejectedValue(
        AppError.notFound('COLLECTION_NOT_FOUND', 'not found'),
      )

      const res = await request(buildApp()).get(`/api/collections/${ID}`)

      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('COLLECTION_NOT_FOUND')
    })
  })

  describe('POST /api/collections', () => {
    it('creates a manual collection', async () => {
      vi.mocked(createCollection).mockResolvedValue({
        id: ID,
        canonicalTitle: 'tetris',
        _count: { members: 2 },
      } as never)

      const res = await request(buildApp())
        .post('/api/collections')
        .send({ canonicalTitle: ' tetris ', romIds: [ID, OTHER_ID] })

      expect(res.status).toBe(201)
      expect(res.body).toEqual({
        id: ID,
        canonicalTitle: 'tetris',
        memberCount: 2,
      })
      expect(createCollection).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          canonicalTitle: 'tetris',
          source: 'MANUAL',
          members: [{ romId: ID }, { romId: OTHER_ID }],
        }),
      )
    })

    it('answers 400 without a title', async () => {
      const res = await request(buildApp()).post('/api/collections').send({})

      expect(res.status).toBe(400)
      expect(createCollection).not.toHaveBeenCalled()
    })
  })

  describe('PATCH /api/collections/:id', () => {
    it('renames, adds and removes members', async () => {
      vi.mocked(getCollectionWithRoms).mockResolvedValue({
        id: ID,
        canonicalTitle: 'new title',
        source: 'MANUAL',
        confidence: null,
        platformId: null,
        createdAt: new Date(),
        members: [],
      } as never)
      vi.mocked(getMemberSimilarities).mockResolvedValue([])

      const res = await request(buildApp())
        .patch(`/api/collections/${ID}`)
        .send({
          canonicalTitle: 'new title',
          addRomIds: [OTHER_ID],
          removeRomIds: [PLATFORM_ID],
        })

      expect(res.status).toBe(200)
      expect(updateCollection).toHaveBeenCalledWith('user-1', ID, {
        canonicalTitle: 'new title',
      })
      expect(addMembers).toHaveBeenCalledWith('user-1', ID, [
        { romId: OTHER_ID },
      ])
      expect(removeMember).toHaveBeenCalledWith('user-1', ID, PLATFORM_ID)
    })

    it('answers 400 when there is nothing to update', async () => {
      const res = await request(buildApp())
        .patch(`/api/collections/${ID}`)
        .send({})

      expect(res.status).toBe(400)
    })
  })

  describe('DELETE /api/collections/:id', () => {
    it('dissolves the collection', async () => {
      const res = await request(buildApp()).delete(`/api/collections/${ID}`)

      expect(res.status).toBe(204)
      expect(deleteCollection).toHaveBeenCalledWith('user-1', ID)
    })

    it('answers 404 when the collection is unknown', async () => {
      vi.mocked(deleteCollection).mockRejectedValue(
        AppError.notFound('COLLECTION_NOT_FOUND', 'not found'),
      )

      const res = await request(buildApp()).delete(`/api/collections/${ID}`)

      expect(res.status).toBe(404)
    })
  })
})
