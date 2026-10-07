import { env } from '../../env.js'
import { ollamaRequest } from './ollama-http.js'
import { OllamaInvalidJsonError } from './ollama.error.js'
import type { EmbeddingClient } from './ollama.types.js'

// Shape of Ollama's POST /api/embed response. The API returns
// `embeddings` (one vector per input); some server versions still answer
// with the legacy singular `embedding`, from the now-replaced
// `/api/embeddings` endpoint. Both must be handled, or an instance upgrade
// silently breaks every embedding call.
interface OllamaEmbedResponse {
  embeddings?: number[][]
  embedding?: number[]
}

async function embed(texts: string[]): Promise<number[][]> {
  const response = await ollamaRequest<OllamaEmbedResponse>('/api/embed', {
    model: env.OLLAMA_EMBEDDING_MODEL,
    body: { model: env.OLLAMA_EMBEDDING_MODEL, input: texts },
  })

  const vectors =
    response.embeddings ??
    (response.embedding ? [response.embedding] : undefined)

  if (!vectors) {
    throw new OllamaInvalidJsonError(
      'Ollama embedding response has neither `embeddings` nor `embedding`',
      { response },
    )
  }

  // Guards against a model swap producing vectors incompatible with the
  // pgvector(768) column: better to fail loudly here than corrupt the index.
  const actualDimension = vectors[0]?.length
  if (actualDimension !== env.OLLAMA_EMBEDDING_DIM) {
    throw new OllamaInvalidJsonError(
      `Embedding dimension mismatch: expected ${env.OLLAMA_EMBEDDING_DIM}, got ${actualDimension}`,
      { expected: env.OLLAMA_EMBEDDING_DIM, actual: actualDimension },
    )
  }

  return vectors
}

export const ollamaEmbeddingClient: EmbeddingClient = {
  embed,
  dimension: env.OLLAMA_EMBEDDING_DIM,
}
