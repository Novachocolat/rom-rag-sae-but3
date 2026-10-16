import { env } from '../env.js'
import { ollamaEmbeddingClient } from '../client/ollama/ollama-embedding.client.js'
import type { EmbeddingClient } from '../client/ollama/ollama.types.js'
import { logger } from '../lib/logger.js'
import {
  countEmbeddings,
  findRomsWithoutEmbedding,
  upsertEmbedding,
} from '../storage/embedding.storage.js'
import { buildEmbeddingText } from './embedding-text.service.js'

// One /api/embed call per batch: a call per ROM would be far too slow on a large library
export const EMBEDDING_BATCH_SIZE = 32

export interface BackfillResult {
  embedded: number
  failed: number
}

export interface EmbeddingStatus {
  total: number
  embedded: number
  missing: number
}

/**
 * Vectorizes every ROM of the user that has no vector yet, by batches.
 * A failed batch is skipped and counted so one bad batch does not stop the run.
 */
export async function backfillEmbeddings(
  userId: string,
  signal: AbortSignal,
  client: EmbeddingClient = ollamaEmbeddingClient,
): Promise<BackfillResult> {
  const result: BackfillResult = { embedded: 0, failed: 0 }
  const roms = await findRomsWithoutEmbedding(userId)

  for (let start = 0; start < roms.length; start += EMBEDDING_BATCH_SIZE) {
    if (signal.aborted) break

    const batch = roms.slice(start, start + EMBEDDING_BATCH_SIZE)
    const texts = batch.map((rom) => buildEmbeddingText(rom))

    try {
      const vectors = await client.embed(texts)
      if (vectors.length !== batch.length) {
        throw new Error(
          `Expected ${String(batch.length)} vectors, got ${String(vectors.length)}`,
        )
      }

      for (const [index, rom] of batch.entries()) {
        await upsertEmbedding(
          rom.id,
          vectors[index] as number[],
          texts[index] as string,
          env.OLLAMA_EMBEDDING_MODEL,
        )
      }
      result.embedded += batch.length
    } catch (err) {
      result.failed += batch.length
      logger.error('Embedding batch failed', {
        batchStart: start,
        stack: err instanceof Error ? err.stack : String(err),
      })
    }
  }

  return result
}

export async function getEmbeddingStatus(
  userId: string,
): Promise<EmbeddingStatus> {
  const [embedded, missing] = await Promise.all([
    countEmbeddings(userId),
    findRomsWithoutEmbedding(userId).then((roms) => roms.length),
  ])

  return { total: embedded + missing, embedded, missing }
}
