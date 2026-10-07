import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../app.js'
import { OllamaUnavailableError } from '../client/ollama/ollama.error.js'
import { env } from '../env.js'
import { startJob } from '../lib/job-runner.js'
import { redis } from '../lib/redis.js'
import {
  identifyStoredRom,
  identifyUnidentifiedRoms,
  reviewProposal,
} from '../service/ai-identification.service.js'
import { listProposals } from '../storage/ai-proposal.storage.js'

vi.mock('../lib/redis.js', () => ({
  redis: { get: vi.fn(), expire: vi.fn() },
}))
vi.mock('../lib/job-runner.js', () => ({ startJob: vi.fn() }))
vi.mock('../service/ai-identification.service.js', () => ({
  identifyStoredRom: vi.fn(),
  identifyUnidentifiedRoms: vi.fn(),
  reviewProposal: vi.fn(),
}))
vi.mock('../storage/ai-proposal.storage.js', () => ({
  listProposals: vi.fn(),
}))

const AUTH_COOKIE = `${env.SESSION_COOKIE_NAME}=tok123`
const PROPOSAL_ID = '6f1c1f63-3a5e-4c6b-9a57-1f0d7a1b2c3d'

const identification = {
  title: 'Tetris',
  platform: 'Nintendo Game Boy',
  region: 'Europe',
  languages: ['en'],
  releaseYear: 1989,
  publisher: 'Nintendo',
  genre: 'Puzzle',
  confidence: 0.9,
  reasoning: 'Matches the Game Boy extension.',
}

// A proposal row as the storage layer returns it, with its ROM included
const proposalRow = {
  id: PROPOSAL_ID,
  romId: 'rom-1',
  status: 'PENDING',
  confidence: 0.9,
  payload: { identification, issues: [], source: 'AI_PROPOSED' },
  model: 'gemma4:26b',
  promptName: 'identification',
  promptVersion: 'v1',
  createdAt: new Date('2026-10-06T10:00:00.000Z'),
  rom: { id: 'rom-1', userId: 'user-1', fileName: 'Tetris (World).gb' },
}

// Tests for the /api/ai routes: identification, batch, review queue and review
describe('AI routes', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(redis.get).mockResolvedValue('user-1')
    vi.mocked(redis.expire).mockResolvedValue(1)
  })

  describe('POST /api/ai/roms/:id/identify', () => {
    it('rejects an unauthenticated request', async () => {
      const response = await request(createApp()).post(
        '/api/ai/roms/rom-1/identify',
      )

      expect(response.status).toBe(401)
    })

    it('returns the proposal labelled AI_PROPOSED', async () => {
      vi.mocked(identifyStoredRom).mockResolvedValue(proposalRow as never)

      const response = await request(createApp())
        .post(`/api/ai/roms/${PROPOSAL_ID}/identify`)
        .set('Cookie', AUTH_COOKIE)

      expect(response.status).toBe(200)
      expect(response.body.proposal).toMatchObject({
        id: PROPOSAL_ID,
        romFileName: 'Tetris (World).gb',
        status: 'PENDING',
        source: 'AI_PROPOSED',
        identification,
        createdAt: '2026-10-06T10:00:00.000Z',
      })
    })

    it('answers 503 OLLAMA_UNAVAILABLE when Ollama is off', async () => {
      vi.mocked(identifyStoredRom).mockRejectedValue(
        new OllamaUnavailableError('Ollama is not reachable'),
      )

      const response = await request(createApp())
        .post(`/api/ai/roms/${PROPOSAL_ID}/identify`)
        .set('Cookie', AUTH_COOKIE)

      expect(response.status).toBe(503)
      expect(response.body.error.code).toBe('OLLAMA_UNAVAILABLE')
    })

    it('rejects a ROM id that is not a UUID', async () => {
      const response = await request(createApp())
        .post('/api/ai/roms/not-a-uuid/identify')
        .set('Cookie', AUTH_COOKIE)

      expect(response.status).toBe(400)
      expect(identifyStoredRom).not.toHaveBeenCalled()
    })
  })

  describe('POST /api/ai/roms/identify-batch', () => {
    it('starts a background job and answers 202 with its id', async () => {
      const response = await request(createApp())
        .post('/api/ai/roms/identify-batch')
        .set('Cookie', AUTH_COOKIE)

      expect(response.status).toBe(202)
      expect(response.body.jobId).toMatch(/^[0-9a-f-]{36}$/)
      expect(startJob).toHaveBeenCalledWith(
        expect.any(Function),
        response.body.jobId,
      )
    })

    it('runs the batch for the authenticated user only', async () => {
      vi.mocked(startJob).mockImplementation((fn) => {
        void fn(new AbortController().signal)
        return 'job'
      })

      await request(createApp())
        .post('/api/ai/roms/identify-batch')
        .set('Cookie', AUTH_COOKIE)

      expect(identifyUnidentifiedRoms).toHaveBeenCalledWith(
        'user-1',
        expect.any(AbortSignal),
      )
    })
  })

  describe('GET /api/ai/proposals', () => {
    it('returns the review queue paginated, PENDING by default', async () => {
      vi.mocked(listProposals).mockResolvedValue({
        proposals: [proposalRow],
        total: 1,
      } as never)

      const response = await request(createApp())
        .get('/api/ai/proposals')
        .set('Cookie', AUTH_COOKIE)

      expect(response.status).toBe(200)
      expect(listProposals).toHaveBeenCalledWith({
        userId: 'user-1',
        status: 'PENDING',
        page: 1,
        pageSize: 20,
      })
      expect(response.body.pagination).toEqual({
        page: 1,
        pageSize: 20,
        total: 1,
        totalPages: 1,
      })
      expect(response.body.data[0].source).toBe('AI_PROPOSED')
    })

    it('filters by an explicit status', async () => {
      vi.mocked(listProposals).mockResolvedValue({
        proposals: [],
        total: 0,
      } as never)

      await request(createApp())
        .get('/api/ai/proposals?status=REJECTED')
        .set('Cookie', AUTH_COOKIE)

      expect(listProposals).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'REJECTED' }),
      )
    })

    it('rejects an unknown status', async () => {
      const response = await request(createApp())
        .get('/api/ai/proposals?status=MAYBE')
        .set('Cookie', AUTH_COOKIE)

      expect(response.status).toBe(400)
    })
  })

  describe('POST /api/ai/proposals/:id/review', () => {
    it('accepts a proposal', async () => {
      vi.mocked(reviewProposal).mockResolvedValue({
        status: 'ACCEPTED',
      } as never)

      const response = await request(createApp())
        .post(`/api/ai/proposals/${PROPOSAL_ID}/review`)
        .set('Cookie', AUTH_COOKIE)
        .send({ action: 'accept' })

      expect(response.status).toBe(200)
      expect(response.body).toEqual({ status: 'ACCEPTED' })
      expect(reviewProposal).toHaveBeenCalledWith(PROPOSAL_ID, 'user-1', {
        action: 'accept',
      })
    })

    it('rejects a proposal', async () => {
      vi.mocked(reviewProposal).mockResolvedValue({
        status: 'REJECTED',
      } as never)

      const response = await request(createApp())
        .post(`/api/ai/proposals/${PROPOSAL_ID}/review`)
        .set('Cookie', AUTH_COOKIE)
        .send({ action: 'reject' })

      expect(response.status).toBe(200)
      expect(response.body).toEqual({ status: 'REJECTED' })
    })

    it('refuses corrections sent with a reject', async () => {
      const response = await request(createApp())
        .post(`/api/ai/proposals/${PROPOSAL_ID}/review`)
        .set('Cookie', AUTH_COOKIE)
        .send({ action: 'reject', corrections: { title: 'Other' } })

      expect(response.status).toBe(400)
      expect(reviewProposal).not.toHaveBeenCalled()
    })

    it('refuses an unknown action', async () => {
      const response = await request(createApp())
        .post(`/api/ai/proposals/${PROPOSAL_ID}/review`)
        .set('Cookie', AUTH_COOKIE)
        .send({ action: 'maybe' })

      expect(response.status).toBe(400)
    })
  })
})
