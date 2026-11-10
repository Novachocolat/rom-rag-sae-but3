import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../../app.js'
import { env } from '../../env.js'
import { startJob } from '../../lib/job-runner.js'
import { logger } from '../../lib/logger.js'
import { redis } from '../../lib/redis.js'
import { EMBEDDING_BATCH_SIZE } from '../../service/embedding.service.js'
import {
  createGroupingProposal,
  createProposal,
  findPendingProposalForRom,
  listProposals,
} from '../../storage/ai-proposal.storage.js'
import {
  getCachedIdentification,
  setCachedIdentification,
} from '../../storage/ai-cache.storage.js'
import {
  createCollection,
  listRomsForGrouping,
  type GroupingRomRow,
} from '../../storage/collection.storage.js'
import {
  findCandidateEntries,
  findEntriesByNormalizedName,
  listPlatforms,
} from '../../storage/dat.storage.js'
import {
  countEmbeddings,
  findNearest,
  findRomsWithoutEmbedding,
  upsertEmbedding,
} from '../../storage/embedding.storage.js'
import {
  findRomById,
  listUnidentifiedRomIds,
} from '../../storage/rom.storage.js'

// Resilience of the AI features when Ollama misbehaves. Everything runs for
// real, from the Express route down to the HTTP transport (retries, backoff,
// error classification); only the Ollama server (`fetch`), the storage layer,
// Redis and the logger are simulated.

vi.mock('../../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
vi.mock('../../lib/redis.js', () => ({
  redis: { get: vi.fn(), expire: vi.fn() },
}))
vi.mock('../../lib/prisma.js', () => ({ prisma: {} }))
vi.mock('../../lib/job-runner.js', () => ({ startJob: vi.fn() }))
vi.mock('../../storage/rom.storage.js', () => ({
  findRomById: vi.fn(),
  listUnidentifiedRomIds: vi.fn(),
}))
vi.mock('../../storage/ai-proposal.storage.js', () => ({
  createProposal: vi.fn(),
  createGroupingProposal: vi.fn(),
  findPendingProposalForRom: vi.fn(),
  listProposals: vi.fn(),
  getProposal: vi.fn(),
  updateProposalStatus: vi.fn(),
  applyAcceptedIdentification: vi.fn(),
}))
vi.mock('../../storage/ai-cache.storage.js', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../../storage/ai-cache.storage.js')
  >()),
  getCachedIdentification: vi.fn(),
  setCachedIdentification: vi.fn(),
}))
vi.mock('../../storage/dat.storage.js', () => ({
  listPlatforms: vi.fn(),
  findCandidateEntries: vi.fn(),
  findEntriesByNormalizedName: vi.fn(),
}))
vi.mock('../../storage/embedding.storage.js', () => ({
  countEmbeddings: vi.fn(),
  findRomsWithoutEmbedding: vi.fn(),
  upsertEmbedding: vi.fn(),
  findNearest: vi.fn(),
  getMemberSimilarities: vi.fn(),
}))
vi.mock('../../storage/collection.storage.js', () => ({
  createCollection: vi.fn(),
  listRomsForGrouping: vi.fn(),
}))

const AUTH_COOKIE = `${env.SESSION_COOKIE_NAME}=tok123`
const ROM_ID = '0b9d5a52-6a3e-4c0f-8d1a-5e2f7c9b4a10'
const ATTEMPTS = env.OLLAMA_MAX_RETRIES + 1

// ---------------------------------------------------------------------------
// The simulated Ollama server
// ---------------------------------------------------------------------------

function fakeResponse(status: number, bodyText: string): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(bodyText),
  } as Response
}

// What `fetch` throws when nothing listens on the port
function connectionRefused(): TypeError {
  return new TypeError('fetch failed', {
    cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:11434'), {
      code: 'ECONNREFUSED',
    }),
  })
}

function timeoutError(): Error {
  const error = new Error('The operation was aborted due to timeout')
  error.name = 'TimeoutError'
  return error
}

// An /api/generate answer carrying `output` as the model's text
function generateAnswer(output: string): Response {
  return fakeResponse(
    200,
    JSON.stringify({
      model: env.OLLAMA_LLM_MODEL,
      response: output,
      total_duration: 2_000_000_000,
      prompt_eval_count: 10,
      eval_count: 20,
      eval_duration: 1_000_000_000,
    }),
  )
}

const identification = {
  title: 'Tetris',
  platform: 'Nintendo Game Boy',
  region: 'World',
  languages: ['en'],
  releaseYear: 1989,
  publisher: 'Nintendo',
  genre: 'Puzzle',
  confidence: 0.9,
  reasoning: 'Matches the Game Boy extension.',
}

function vector(): number[] {
  return Array.from({ length: env.OLLAMA_EMBEDDING_DIM }, () => 0.1)
}

// An /api/embed answer with one vector per input
function embedAnswer(inputCount: number): Response {
  return fakeResponse(
    200,
    JSON.stringify({
      embeddings: Array.from({ length: inputCount }, () => vector()),
    }),
  )
}

function requestedInputs(init: RequestInit | undefined): string[] {
  return (JSON.parse(init?.body as string) as { input: string[] }).input
}

// Calls that reached the simulated server, for one endpoint
function callsTo(path: string) {
  return vi
    .mocked(fetch)
    .mock.calls.filter(([url]) => String(url).endsWith(path))
}

// ---------------------------------------------------------------------------
// Application state shared by the scenarios
// ---------------------------------------------------------------------------

const gameBoy = {
  id: 'platform-gb',
  name: 'Nintendo Game Boy',
  slug: 'nintendo-game-boy',
  extensions: ['.gb'],
}

function storedRom(id: string) {
  return {
    id,
    userId: 'user-1',
    fileName: 'Tetris (World).gb',
    sizeBytes: 32768n,
    platformId: gameBoy.id,
    identificationSource: 'UNIDENTIFIED',
  }
}

function arrangeIdentification(): void {
  vi.mocked(findRomById).mockImplementation((id) =>
    Promise.resolve(storedRom(id) as never),
  )
  vi.mocked(findPendingProposalForRom).mockResolvedValue(null as never)
  vi.mocked(listPlatforms).mockResolvedValue([gameBoy] as never)
  vi.mocked(findCandidateEntries).mockResolvedValue([])
  vi.mocked(findEntriesByNormalizedName).mockResolvedValue([])
  vi.mocked(getCachedIdentification).mockResolvedValue(null)
  vi.mocked(setCachedIdentification).mockResolvedValue(undefined)
  vi.mocked(createProposal).mockResolvedValue({
    id: '6f1c1f63-3a5e-4c6b-9a57-1f0d7a1b2c3d',
    romId: ROM_ID,
    status: 'PENDING',
    confidence: 0.9,
    payload: { identification, issues: [], source: 'AI_PROPOSED' },
    model: env.OLLAMA_LLM_MODEL,
    promptName: 'identification',
    promptVersion: 'v2',
    createdAt: new Date('2026-10-06T10:00:00.000Z'),
    reviewedAt: null,
    rom: { id: ROM_ID, userId: 'user-1', fileName: 'Tetris (World).gb' },
  } as never)
  vi.mocked(listProposals).mockResolvedValue({
    proposals: [],
    total: 0,
  } as never)
}

function identify() {
  return request(createApp())
    .post(`/api/ai/roms/${ROM_ID}/identify`)
    .set('Cookie', AUTH_COOKIE)
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

// Vectors are "written" into a set, so the status route reflects the backfill
function arrangeEmbeddings(romCount: number): void {
  const roms = Array.from({ length: romCount }, (_, i) => ({
    id: `rom-${String(i)}`,
    title: null,
    fileName: `Game ${String(i)} (Europe).gb`,
    publisher: null,
    genre: null,
    releaseYear: null,
    languages: [],
    platform: null,
  }))
  const written = new Set<string>()

  vi.mocked(findRomsWithoutEmbedding).mockImplementation(() =>
    Promise.resolve(roms.filter((rom) => !written.has(rom.id))),
  )
  vi.mocked(countEmbeddings).mockImplementation(() =>
    Promise.resolve(written.size),
  )
  vi.mocked(upsertEmbedding).mockImplementation((romId) => {
    written.add(romId)
    return Promise.resolve()
  })
}

function backfill() {
  return request(createApp())
    .post('/api/ai/embeddings/backfill')
    .set('Cookie', AUTH_COOKIE)
}

function embeddingStatus() {
  return request(createApp())
    .get('/api/ai/embeddings/status')
    .set('Cookie', AUTH_COOKIE)
}

describe('Ollama resilience', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubGlobal('fetch', vi.fn())
    // The retry backoff (250 ms and more) is skipped; shorter timers, such as
    // the ones of the HTTP test client, keep running for real
    const realSetTimeout = globalThis.setTimeout
    vi.stubGlobal('setTimeout', (callback: () => void, delay?: number) => {
      if ((delay ?? 0) >= 200) {
        callback()
        return 0 as unknown as ReturnType<typeof setTimeout>
      }
      return realSetTimeout(callback, delay)
    })
    vi.mocked(redis.get).mockResolvedValue('user-1')
    vi.mocked(redis.expire).mockResolvedValue(1)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('identification of one ROM', () => {
    beforeEach(arrangeIdentification)

    it('creates a proposal when Ollama answers correctly (reference run)', async () => {
      vi.mocked(fetch).mockResolvedValue(
        generateAnswer(JSON.stringify(identification)),
      )

      const response = await identify()

      expect(response.status).toBe(200)
      expect(response.body.proposal.source).toBe('AI_PROPOSED')
      expect(createProposal).toHaveBeenCalledTimes(1)
    })

    it('Ollama unreachable: retried, then 503 OLLAMA_UNAVAILABLE, and the application stays usable', async () => {
      vi.mocked(fetch).mockRejectedValue(connectionRefused())

      const response = await identify()

      expect(response.status).toBe(503)
      expect(response.body.error.code).toBe('OLLAMA_UNAVAILABLE')
      expect(fetch).toHaveBeenCalledTimes(ATTEMPTS)
      expect(createProposal).not.toHaveBeenCalled()

      // Routes that need no inference keep answering
      const queue = await request(createApp())
        .get('/api/ai/proposals')
        .set('Cookie', AUTH_COOKIE)
      expect(queue.status).toBe(200)
    })

    it('recovers by itself when Ollama comes back during the retries', async () => {
      vi.mocked(fetch)
        .mockRejectedValueOnce(connectionRefused())
        .mockResolvedValueOnce(generateAnswer(JSON.stringify(identification)))

      const response = await identify()

      expect(response.status).toBe(200)
      expect(fetch).toHaveBeenCalledTimes(2)
    })

    it('500 error: retried OLLAMA_MAX_RETRIES times, then 502 OLLAMA_SERVER_ERROR', async () => {
      vi.mocked(fetch).mockResolvedValue(fakeResponse(500, 'boom'))

      const response = await identify()

      expect(response.status).toBe(502)
      expect(response.body.error.code).toBe('OLLAMA_SERVER_ERROR')
      expect(fetch).toHaveBeenCalledTimes(env.OLLAMA_MAX_RETRIES + 1)
      expect(createProposal).not.toHaveBeenCalled()
    })

    it('timeout: not retried, 504 OLLAMA_TIMEOUT', async () => {
      vi.mocked(fetch).mockRejectedValue(timeoutError())

      const response = await identify()

      expect(response.status).toBe(504)
      expect(response.body.error.code).toBe('OLLAMA_TIMEOUT')
      expect(fetch).toHaveBeenCalledTimes(1)
      expect(createProposal).not.toHaveBeenCalled()
    })

    it('malformed JSON: 502 OLLAMA_INVALID_JSON, raw output in details and in the logs, no proposal', async () => {
      const raw = '{"title": "Tetris", "platform": '
      vi.mocked(fetch).mockResolvedValue(generateAnswer(raw))

      const response = await identify()

      expect(response.status).toBe(502)
      expect(response.body.error.code).toBe('OLLAMA_INVALID_JSON')
      expect(response.body.error.details).toEqual({ raw })
      expect(logger.error).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ raw, model: env.OLLAMA_LLM_MODEL }),
      )
      expect(fetch).toHaveBeenCalledTimes(1)
      expect(createProposal).not.toHaveBeenCalled()
    })

    it('empty response: handled as invalid JSON', async () => {
      vi.mocked(fetch).mockResolvedValue(generateAnswer(''))

      const response = await identify()

      expect(response.status).toBe(502)
      expect(response.body.error.code).toBe('OLLAMA_INVALID_JSON')
      expect(response.body.error.details).toEqual({ raw: '' })
      expect(createProposal).not.toHaveBeenCalled()
    })

    it('valid JSON that Zod refuses: 502, issues listed, no proposal', async () => {
      const raw = JSON.stringify({ title: 'Tetris', confidence: 'high' })
      vi.mocked(fetch).mockResolvedValue(generateAnswer(raw))

      const response = await identify()

      expect(response.status).toBe(502)
      expect(response.body.error.code).toBe('OLLAMA_INVALID_JSON')
      expect(response.body.error.details.raw).toBe(raw)
      expect(response.body.error.details.issues).toEqual(expect.any(Array))
      expect(response.body.error.details.issues.length).toBeGreaterThan(0)
      expect(logger.error).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ raw }),
      )
      expect(createProposal).not.toHaveBeenCalled()
    })

    it('model not pulled (404): 503 OLLAMA_MODEL_NOT_FOUND naming the model, not retried', async () => {
      vi.mocked(fetch).mockResolvedValue(
        fakeResponse(
          404,
          JSON.stringify({
            error: `model "${env.OLLAMA_LLM_MODEL}" not found, try pulling it first`,
          }),
        ),
      )

      const response = await identify()

      expect(response.status).toBe(503)
      expect(response.body.error.code).toBe('OLLAMA_MODEL_NOT_FOUND')
      expect(response.body.error.message).toContain(env.OLLAMA_LLM_MODEL)
      expect(fetch).toHaveBeenCalledTimes(1)
      expect(createProposal).not.toHaveBeenCalled()
    })

    it('context overflow: 413 OLLAMA_CONTEXT_OVERFLOW, not retried', async () => {
      vi.mocked(fetch).mockResolvedValue(
        fakeResponse(500, JSON.stringify({ error: 'exceeds context length' })),
      )

      const response = await identify()

      expect(response.status).toBe(413)
      expect(response.body.error.code).toBe('OLLAMA_CONTEXT_OVERFLOW')
      expect(fetch).toHaveBeenCalledTimes(1)
      expect(createProposal).not.toHaveBeenCalled()
    })
  })

  describe('identification batch', () => {
    it('stops at the first ROM when Ollama is unreachable', async () => {
      arrangeIdentification()
      vi.mocked(listUnidentifiedRomIds).mockResolvedValue(['a', 'b', 'c'])
      vi.mocked(fetch).mockRejectedValue(connectionRefused())
      const waitForJob = captureJob()

      const response = await request(createApp())
        .post('/api/ai/roms/identify-batch')
        .set('Cookie', AUTH_COOKIE)

      expect(response.status).toBe(202)
      await expect(waitForJob()).resolves.toEqual({ attempted: 1 })
      // One ROM with its retries, not three
      expect(fetch).toHaveBeenCalledTimes(ATTEMPTS)
    })
  })

  describe('embeddings backfill', () => {
    it('context overflow: the batch is halved until Ollama accepts it', async () => {
      arrangeEmbeddings(4)
      vi.mocked(fetch).mockImplementation((_url, init) => {
        const inputs = requestedInputs(init)
        return Promise.resolve(
          inputs.length > 2
            ? fakeResponse(500, JSON.stringify({ error: 'context length' }))
            : embedAnswer(inputs.length),
        )
      })
      const waitForJob = captureJob()

      await backfill()

      await expect(waitForJob()).resolves.toEqual({ embedded: 4, failed: 0 })
      // 4 ROMs refused, then 2 + 2 accepted
      expect(
        callsTo('/api/embed').map(([, init]) => requestedInputs(init).length),
      ).toEqual([4, 2, 2])
      expect(upsertEmbedding).toHaveBeenCalledTimes(4)
    })

    it('context overflow on a single ROM: counted as failed, the others are kept', async () => {
      arrangeEmbeddings(3)
      vi.mocked(fetch).mockImplementation((_url, init) => {
        const inputs = requestedInputs(init)
        const tooLong = inputs.some((text) => text === 'game 1')
        return Promise.resolve(
          tooLong
            ? fakeResponse(500, JSON.stringify({ error: 'context length' }))
            : embedAnswer(inputs.length),
        )
      })
      const waitForJob = captureJob()

      await backfill()

      await expect(waitForJob()).resolves.toEqual({ embedded: 2, failed: 1 })
    })

    it('reads the legacy /api/embed answer (`embedding` instead of `embeddings`)', async () => {
      arrangeEmbeddings(1)
      vi.mocked(fetch).mockResolvedValue(
        fakeResponse(200, JSON.stringify({ embedding: vector() })),
      )
      const waitForJob = captureJob()

      await backfill()

      await expect(waitForJob()).resolves.toEqual({ embedded: 1, failed: 0 })
    })

    it('Ollama cut mid-run: stops at the first failure, keeps the written vectors, resumes later', async () => {
      // 32 + 32 + 1 ROMs: the first batch succeeds, the second finds Ollama down
      const total = EMBEDDING_BATCH_SIZE * 2 + 1
      arrangeEmbeddings(total)
      vi.mocked(fetch)
        .mockImplementationOnce((_url, init) =>
          Promise.resolve(embedAnswer(requestedInputs(init).length)),
        )
        .mockRejectedValue(connectionRefused())
      const waitForJob = captureJob()

      await backfill()
      const interrupted = (await waitForJob()) as {
        embedded: number
        failed: number
      }

      expect(interrupted).toEqual({
        embedded: EMBEDDING_BATCH_SIZE,
        failed: EMBEDDING_BATCH_SIZE,
      })
      // First batch once, second batch with its retries, the third never sent
      expect(fetch).toHaveBeenCalledTimes(1 + ATTEMPTS)

      // The only observable: the status route, which still answers
      const status = await embeddingStatus()
      expect(status.status).toBe(200)
      expect(status.body).toEqual({
        total,
        embedded: EMBEDDING_BATCH_SIZE,
        missing: EMBEDDING_BATCH_SIZE + 1,
      })

      // Ollama is back: a new run only vectorizes what is missing
      vi.mocked(fetch).mockReset()
      vi.mocked(fetch).mockImplementation((_url, init) =>
        Promise.resolve(embedAnswer(requestedInputs(init).length)),
      )

      await backfill()

      await expect(waitForJob()).resolves.toEqual({
        embedded: EMBEDDING_BATCH_SIZE + 1,
        failed: 0,
      })
      expect((await embeddingStatus()).body).toEqual({
        total,
        embedded: total,
        missing: 0,
      })
    })
  })

  describe('collection detection', () => {
    function row(id: string, fileName: string): GroupingRomRow {
      return {
        id,
        fileName,
        title: null,
        platformId: gameBoy.id,
        sha1: `sha1-${id}`,
        sha1Data: null,
        gameExternalId: null,
        cloneOfId: null,
      }
    }

    it('Ollama cut during the semantic stage: the catalog collections are kept, the semantic stage is skipped', async () => {
      vi.mocked(listRomsForGrouping).mockResolvedValue([
        row('usa', 'Tetris (USA).gb'),
        row('eur', 'Tetris (Europe).gb'),
        row('x', 'Alpha Quest.gb'),
        row('y', 'Alpha Quest II.gb'),
      ])
      vi.mocked(findNearest).mockImplementation((romId) =>
        Promise.resolve(
          romId === 'x'
            ? [{ romId: 'y', fileName: 'y', title: null, similarity: 0.95 }]
            : [],
        ),
      )
      vi.mocked(listPlatforms).mockResolvedValue([gameBoy] as never)
      vi.mocked(createCollection).mockResolvedValue({
        id: 'collection-1',
      } as never)
      vi.mocked(fetch).mockRejectedValue(connectionRefused())
      const waitForJob = captureJob()

      const response = await request(createApp())
        .post('/api/collections/detect')
        .set('Cookie', AUTH_COOKIE)

      expect(response.status).toBe(202)
      await expect(waitForJob()).resolves.toBeUndefined()
      // Stage 2 (same base title) was saved before the model was needed
      expect(createCollection).toHaveBeenCalledTimes(1)
      expect(createCollection).toHaveBeenCalledWith(
        expect.objectContaining({ source: 'DAT_CLONE' }),
      )
      // The model was tried (with its retries), then given up
      expect(fetch).toHaveBeenCalledTimes(ATTEMPTS)
      expect(createGroupingProposal).not.toHaveBeenCalled()
    })
  })
})
