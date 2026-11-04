import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  OllamaContextOverflowError,
  OllamaUnavailableError,
} from '../client/ollama/ollama.error.js'
import type { EmbeddingClient } from '../client/ollama/ollama.types.js'
import {
  countEmbeddings,
  findRomsWithoutEmbedding,
  upsertEmbedding,
} from '../storage/embedding.storage.js'
import {
  backfillEmbeddings,
  EMBEDDING_BATCH_SIZE,
  getEmbeddingStatus,
} from './embedding.service.js'

vi.mock('../storage/embedding.storage.js', () => ({
  countEmbeddings: vi.fn(),
  findRomsWithoutEmbedding: vi.fn(),
  upsertEmbedding: vi.fn(),
}))
vi.mock('../client/ollama/ollama-embedding.client.js', () => ({
  ollamaEmbeddingClient: { embed: vi.fn(), dimension: 768 },
}))

function makeRoms(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `rom-${String(i)}`,
    title: null,
    fileName: `Game ${String(i)} (Europe).gb`,
    publisher: null,
    genre: null,
    releaseYear: null,
    languages: [],
    platform: null,
  }))
}

function makeClient(): EmbeddingClient {
  return {
    dimension: 768,
    embed: vi.fn((texts: string[]) =>
      Promise.resolve(texts.map(() => [0.1, 0.2])),
    ),
  }
}

// Tests for the backfill orchestration, with the model and the database mocked
describe('embedding.service', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(findRomsWithoutEmbedding).mockResolvedValue([])
  })

  describe('backfillEmbeddings', () => {
    it('sends the ROMs by batches and writes each vector', async () => {
      const total = EMBEDDING_BATCH_SIZE + 1
      vi.mocked(findRomsWithoutEmbedding).mockResolvedValue(makeRoms(total))
      const client = makeClient()

      const result = await backfillEmbeddings(
        'user-1',
        new AbortController().signal,
        client,
      )

      expect(result).toEqual({ embedded: total, failed: 0 })
      expect(client.embed).toHaveBeenCalledTimes(2)
      expect(upsertEmbedding).toHaveBeenCalledTimes(total)
    })

    it('counts a failed batch and carries on with the next one', async () => {
      vi.mocked(findRomsWithoutEmbedding).mockResolvedValue(
        makeRoms(EMBEDDING_BATCH_SIZE + 2),
      )
      const client = makeClient()
      vi.mocked(client.embed).mockRejectedValueOnce(new Error('boom'))

      const result = await backfillEmbeddings(
        'user-1',
        new AbortController().signal,
        client,
      )

      expect(result).toEqual({ embedded: 2, failed: EMBEDDING_BATCH_SIZE })
    })

    it('halves a batch that overflows the context window and retries each half', async () => {
      vi.mocked(findRomsWithoutEmbedding).mockResolvedValue(makeRoms(4))
      const client = makeClient()
      vi.mocked(client.embed).mockRejectedValueOnce(
        new OllamaContextOverflowError('too big'),
      )

      const result = await backfillEmbeddings(
        'user-1',
        new AbortController().signal,
        client,
      )

      expect(result).toEqual({ embedded: 4, failed: 0 })
      expect(
        vi.mocked(client.embed).mock.calls.map(([texts]) => texts.length),
      ).toEqual([4, 2, 2])
    })

    it('counts a single ROM that still overflows and keeps the others', async () => {
      vi.mocked(findRomsWithoutEmbedding).mockResolvedValue(makeRoms(3))
      const client = makeClient()
      vi.mocked(client.embed).mockImplementation((texts) =>
        texts.includes('game 1')
          ? Promise.reject(new OllamaContextOverflowError('too big'))
          : Promise.resolve(texts.map(() => [0.1, 0.2])),
      )

      const result = await backfillEmbeddings(
        'user-1',
        new AbortController().signal,
        client,
      )

      expect(result).toEqual({ embedded: 2, failed: 1 })
    })

    it('stops at the first batch that finds Ollama unreachable, keeping what was written', async () => {
      vi.mocked(findRomsWithoutEmbedding).mockResolvedValue(
        makeRoms(EMBEDDING_BATCH_SIZE * 3),
      )
      const client = makeClient()
      vi.mocked(client.embed)
        .mockResolvedValueOnce(
          Array.from({ length: EMBEDDING_BATCH_SIZE }, () => [0.1, 0.2]),
        )
        .mockRejectedValue(new OllamaUnavailableError('down'))

      const result = await backfillEmbeddings(
        'user-1',
        new AbortController().signal,
        client,
      )

      expect(result).toEqual({
        embedded: EMBEDDING_BATCH_SIZE,
        failed: EMBEDDING_BATCH_SIZE,
      })
      expect(client.embed).toHaveBeenCalledTimes(2)
      expect(upsertEmbedding).toHaveBeenCalledTimes(EMBEDDING_BATCH_SIZE)
    })

    it('fails the batch when the model returns the wrong number of vectors', async () => {
      vi.mocked(findRomsWithoutEmbedding).mockResolvedValue(makeRoms(3))
      const client = makeClient()
      vi.mocked(client.embed).mockResolvedValue([[0.1]])

      const result = await backfillEmbeddings(
        'user-1',
        new AbortController().signal,
        client,
      )

      expect(result).toEqual({ embedded: 0, failed: 3 })
      expect(upsertEmbedding).not.toHaveBeenCalled()
    })

    it('stops when the job is cancelled', async () => {
      vi.mocked(findRomsWithoutEmbedding).mockResolvedValue(makeRoms(3))
      const client = makeClient()
      const controller = new AbortController()
      controller.abort()

      const result = await backfillEmbeddings(
        'user-1',
        controller.signal,
        client,
      )

      expect(result).toEqual({ embedded: 0, failed: 0 })
      expect(client.embed).not.toHaveBeenCalled()
    })
  })

  describe('getEmbeddingStatus', () => {
    it('reports the progress of the library', async () => {
      vi.mocked(countEmbeddings).mockResolvedValue(8)
      vi.mocked(findRomsWithoutEmbedding).mockResolvedValue(makeRoms(2))

      expect(await getEmbeddingStatus('user-1')).toEqual({
        total: 10,
        embedded: 8,
        missing: 2,
      })
    })
  })
})
