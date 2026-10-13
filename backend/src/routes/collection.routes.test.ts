import express from 'express'
import type { NextFunction, Request, Response } from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OllamaUnavailableError } from '../client/ollama/ollama.error.js'
import { AppError } from '../lib/error.js'
import { startJob } from '../lib/job-runner.js'
import { errorMiddleware } from '../middleware/error.middleware.js'
import {
  buildGroupingPorts,
  proposeGroupings,
  type GroupingOutcome,
} from '../service/ai-grouping.service.js'
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
  GROUPING_PROMPT: { name: 'grouping', version: 'v1' },
  buildGroupingPorts: vi.fn(),
  proposeGroupings: vi.fn(),
}))
vi.mock('../storage/ai-proposal.storage.js', () => ({
  createGroupingProposal: vi.fn(),
}))
vi.mock('../storage/embedding.storage.js', () => ({
  findNearest: vi.fn(),
  getMemberSimilarities: vi.fn(),
}))
vi.mock('../storage/collection.storage.js', () => ({
  createCollection: vi.fn(),
  deleteCollection: vi.fn(),
  getCollectionWithRoms: vi.fn(),
  listCollections: vi.fn(),
  listRomsForGrouping: vi.fn(),
  mergeCollections: vi.fn(),
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

function makeRow(
  id: string,
  fileName: string,
  sha1 = `sha1-${id}`,
): GroupingRomRow {
  return {
    id,
    fileName,
    title: null,
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
    canonicalTitle: 'Alpha Quest',
    members: [
      { romId: 'x', variantLabel: null },
      { romId: 'y', variantLabel: 'II' },
    ],
    removedRomIds: [],
    confidence: 0.9,
    reasoning: 'Same game',
    issues: [],
    raw: '{"raw":true}',
    model: 'test-model',
    durationMs: 1,
    promptTokens: 1,
    completionTokens: 1,
    ...overrides,
  }
}

function makeDetail() {
  return {
    id: ID,
    canonicalTitle: 'Tetris',
    source: 'MANUAL',
    confidence: null,
    platformId: null,
    createdAt: new Date('2026-10-01T10:00:00Z'),
    members: [],
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

// Two isolated ROMs that the embeddings put next to each other
function mockSemanticPair(): void {
  vi.mocked(listRomsForGrouping).mockResolvedValue([
    makeRow('x', 'Alpha Quest.gb'),
    makeRow('y', 'Alpha Quest II.gb'),
  ])
  vi.mocked(findNearest).mockImplementation((romId) =>
    Promise.resolve(
      romId === 'x'
        ? [{ romId: 'y', fileName: 'y', title: null, similarity: 0.95 }]
        : [],
    ),
  )
  vi.mocked(listPlatforms).mockResolvedValue([
    { id: PLATFORM_ID, name: 'Game Boy', slug: 'gb', extensions: ['.gb'] },
  ] as never)
  vi.mocked(createCollection).mockResolvedValue({ id: 'collection-1' } as never)
}

describe('collection.routes', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  describe('POST /api/collections/detect', () => {
    it('answers 202 with the job id', async () => {
      const waitForJob = captureJob()
      vi.mocked(listRomsForGrouping).mockResolvedValue([])

      const res = await request(buildApp()).post('/api/collections/detect')
      await waitForJob()

      expect(res.status).toBe(202)
      expect(res.body).toEqual({ jobId: 'job-1' })
    })

    it('answers 409 while a detection of the same user is running', async () => {
      const waitForJob = captureJob()
      let finish: (rows: GroupingRomRow[]) => void = () => undefined
      vi.mocked(listRomsForGrouping).mockReturnValue(
        new Promise((resolve) => {
          finish = resolve
        }),
      )

      const first = await request(buildApp()).post('/api/collections/detect')
      const second = await request(buildApp()).post('/api/collections/detect')
      finish([])
      await waitForJob()
      const third = await request(buildApp()).post('/api/collections/detect')
      await waitForJob()

      expect(first.status).toBe(202)
      expect(second.status).toBe(409)
      expect(second.body.error.code).toBe('DETECTION_ALREADY_RUNNING')
      // The guard is released once the first run is over
      expect(third.status).toBe(202)
    })

    it('builds the catalog collections, then an AI collection for isolated ROMs', async () => {
      const waitForJob = captureJob()
      mockSemanticPair()
      vi.mocked(listRomsForGrouping).mockResolvedValue([
        makeRow('usa', 'Tetris (USA).gb'),
        makeRow('eur', 'Tetris (Europe).gb'),
        makeRow('x', 'Alpha Quest.gb'),
        makeRow('y', 'Alpha Quest II.gb'),
      ])
      vi.mocked(proposeGroupings).mockResolvedValue([makeOutcome()])

      await request(buildApp()).post('/api/collections/detect')
      await waitForJob()

      expect(listRomsForGrouping).toHaveBeenCalledWith('user-1', {
        onlyUngrouped: true,
      })
      expect(findNearest).toHaveBeenCalledWith('x', 10, 0.85)
      expect(createCollection).toHaveBeenCalledTimes(2)
      expect(createCollection).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          userId: 'user-1',
          canonicalTitle: 'Tetris',
          platformId: PLATFORM_ID,
          source: 'DAT_CLONE',
          confidence: 0.95,
        }),
      )
      expect(createCollection).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          canonicalTitle: 'Alpha Quest',
          source: 'AI',
          confidence: 0.9,
          platformId: PLATFORM_ID,
        }),
      )
    })

    it('links the AI collection to a pending proposal holding the audit trail', async () => {
      const waitForJob = captureJob()
      mockSemanticPair()
      vi.mocked(proposeGroupings).mockResolvedValue([makeOutcome()])

      await request(buildApp()).post('/api/collections/detect')
      await waitForJob()

      expect(createGroupingProposal).toHaveBeenCalledWith(
        expect.objectContaining({
          collectionId: 'collection-1',
          status: 'PENDING',
          rawResponse: '{"raw":true}',
          model: 'test-model',
          promptName: 'grouping',
          promptVersion: 'v1',
          confidence: 0.9,
        }),
      )
    })

    it('creates no collection from an unsure or refused answer, but keeps it for audit', async () => {
      const waitForJob = captureJob()
      mockSemanticPair()
      vi.mocked(proposeGroupings).mockResolvedValue([
        makeOutcome({ decision: 'LOW_CONFIDENCE' }),
        makeOutcome({
          decision: 'NOT_SAME_GAME',
          members: [],
          removedRomIds: ['x', 'y'],
        }),
      ])

      await request(buildApp()).post('/api/collections/detect')
      await waitForJob()

      expect(createCollection).not.toHaveBeenCalled()
      expect(createGroupingProposal).toHaveBeenCalledTimes(2)
      expect(createGroupingProposal).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ romId: 'x', status: 'REJECTED' }),
      )
    })

    it('keeps the catalog collections when Ollama is down (degraded mode)', async () => {
      const waitForJob = captureJob()
      mockSemanticPair()
      vi.mocked(listRomsForGrouping).mockResolvedValue([
        makeRow('usa', 'Tetris (USA).gb'),
        makeRow('eur', 'Tetris (Europe).gb'),
        makeRow('x', 'Alpha Quest.gb'),
        makeRow('y', 'Alpha Quest II.gb'),
      ])
      vi.mocked(proposeGroupings).mockRejectedValue(
        new OllamaUnavailableError('down'),
      )

      await request(buildApp()).post('/api/collections/detect')

      await expect(waitForJob()).resolves.toBeUndefined()
      expect(createCollection).toHaveBeenCalledTimes(1)
      expect(createCollection).toHaveBeenCalledWith(
        expect.objectContaining({ source: 'DAT_CLONE' }),
      )
      expect(createGroupingProposal).not.toHaveBeenCalled()
    })

    it('skips the model when no isolated ROM has a close neighbor', async () => {
      const waitForJob = captureJob()
      vi.mocked(listRomsForGrouping).mockResolvedValue([
        makeRow('x', 'Alpha Quest.gb'),
        makeRow('y', 'Beta Quest.gb'),
      ])
      vi.mocked(findNearest).mockResolvedValue([])

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
            canonicalTitle: 'Tetris',
            source: 'DAT_CLONE',
            confidence: 0.95,
            platformId: PLATFORM_ID,
            createdAt: new Date('2026-10-01T10:00:00Z'),
            _count: { members: 3 },
          },
        ],
        total: 11,
      } as never)

      const res = await request(buildApp()).get(
        '/api/collections?page=1&pageSize=10',
      )

      expect(res.status).toBe(200)
      expect(res.body.data[0].memberCount).toBe(3)
      expect(res.body.data[0].createdAt).toBe('2026-10-01T10:00:00.000Z')
      expect(res.body.pagination).toEqual({
        page: 1,
        pageSize: 10,
        total: 11,
        totalPages: 2,
      })
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
        ...makeDetail(),
        source: 'AI',
        confidence: 0.9,
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
    it('hands every change to one storage call', async () => {
      vi.mocked(getCollectionWithRoms).mockResolvedValue(makeDetail() as never)
      vi.mocked(getMemberSimilarities).mockResolvedValue([])

      const res = await request(buildApp())
        .patch(`/api/collections/${ID}`)
        .send({
          canonicalTitle: 'new title',
          addRomIds: [OTHER_ID],
          removeRomIds: [PLATFORM_ID],
        })

      expect(res.status).toBe(200)
      expect(updateCollection).toHaveBeenCalledTimes(1)
      expect(updateCollection).toHaveBeenCalledWith('user-1', ID, {
        canonicalTitle: 'new title',
        addRomIds: [OTHER_ID],
        removeRomIds: [PLATFORM_ID],
      })
    })

    it('answers 400 when there is nothing to update', async () => {
      const res = await request(buildApp())
        .patch(`/api/collections/${ID}`)
        .send({})

      expect(res.status).toBe(400)
      expect(updateCollection).not.toHaveBeenCalled()
    })
  })

  describe('POST /api/collections/:id/merge', () => {
    it('merges the source into the collection of the URL', async () => {
      vi.mocked(getCollectionWithRoms).mockResolvedValue(makeDetail() as never)
      vi.mocked(getMemberSimilarities).mockResolvedValue([])

      const res = await request(buildApp())
        .post(`/api/collections/${ID}/merge`)
        .send({ sourceId: OTHER_ID })

      expect(res.status).toBe(200)
      expect(res.body.id).toBe(ID)
      expect(mergeCollections).toHaveBeenCalledWith('user-1', ID, OTHER_ID)
    })

    it('answers 400 without a source', async () => {
      const res = await request(buildApp())
        .post(`/api/collections/${ID}/merge`)
        .send({})

      expect(res.status).toBe(400)
      expect(mergeCollections).not.toHaveBeenCalled()
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
