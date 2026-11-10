import { env } from '../env.js'
import { ollamaEmbeddingClient } from '../client/ollama/ollama-embedding.client.js'
import {
  OllamaContextOverflowError,
  OllamaUnavailableError,
} from '../client/ollama/ollama.error.js'
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

type RomToEmbed = Awaited<ReturnType<typeof findRomsWithoutEmbedding>>[number]

/**
 * Vectorizes one batch and writes its vectors. When the batch overflows the
 * model's context window it is halved and each half is retried, down to a
 * single ROM. Any other failure is counted and logged.
 * @returns `'stop'` when the run cannot go on (cancelled, or Ollama is down)
 */
async function embedBatch(
  batch: RomToEmbed[],
  start: number,
  signal: AbortSignal,
  client: EmbeddingClient,
  result: BackfillResult,
): Promise<'continue' | 'stop'> {
  if (signal.aborted) return 'stop'

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
    return 'continue'
  } catch (err) {
    if (err instanceof OllamaContextOverflowError && batch.length > 1) {
      logger.warn('Embedding batch overflows the context window: halving it', {
        batchStart: start,
        size: batch.length,
      })
      const middle = Math.ceil(batch.length / 2)
      const halves = [batch.slice(0, middle), batch.slice(middle)]
      for (const [index, half] of halves.entries()) {
        const outcome = await embedBatch(
          half,
          start + index * middle,
          signal,
          client,
          result,
        )
        if (outcome === 'stop') return 'stop'
      }
      return 'continue'
    }

    result.failed += batch.length
    logger.error('Embedding batch failed', {
      batchStart: start,
      stack: err instanceof Error ? err.stack : String(err),
    })
    // Every other batch would fail the same way, after as many retries
    return err instanceof OllamaUnavailableError ? 'stop' : 'continue'
  }
}

/**
 * Vectorizes every ROM of the user that has no vector yet, by batches.
 * A failed batch is skipped and counted so one bad batch does not stop the run,
 * except when Ollama is unreachable: the run stops at the first such failure.
 * The vectors already written are kept, so running it again resumes with the
 * ROMs that still have none.
 */
export async function backfillEmbeddings(
  userId: string,
  signal: AbortSignal,
  client: EmbeddingClient = ollamaEmbeddingClient,
): Promise<BackfillResult> {
  const result: BackfillResult = { embedded: 0, failed: 0 }
  const roms = await findRomsWithoutEmbedding(userId)

  for (let start = 0; start < roms.length; start += EMBEDDING_BATCH_SIZE) {
    const batch = roms.slice(start, start + EMBEDDING_BATCH_SIZE)
    if ((await embedBatch(batch, start, signal, client, result)) === 'stop') {
      break
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
