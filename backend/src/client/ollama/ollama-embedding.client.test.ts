import { beforeEach, describe, expect, it, vi } from 'vitest'
import { env } from '../../env.js'
import { ollamaRequest } from './ollama-http.js'
import { ollamaEmbeddingClient } from './ollama-embedding.client.js'
import { OllamaInvalidJsonError } from './ollama.error.js'

vi.mock('./ollama-http.js', () => ({ ollamaRequest: vi.fn() }))

const mockedRequest = vi.mocked(ollamaRequest)

// A valid-dimension vector, matching env.OLLAMA_EMBEDDING_DIM
function fakeVector(): number[] {
  return Array.from({ length: env.OLLAMA_EMBEDDING_DIM }, (_, i) => i / 1000)
}

describe('ollamaEmbeddingClient', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('exposes the configured dimension', () => {
    expect(ollamaEmbeddingClient.dimension).toBe(env.OLLAMA_EMBEDDING_DIM)
  })

  it('sends the model and input texts to /api/embed', async () => {
    mockedRequest.mockResolvedValue({ embeddings: [fakeVector()] })

    await ollamaEmbeddingClient.embed(['Sonic the Hedgehog'])

    expect(mockedRequest).toHaveBeenCalledWith('/api/embed', {
      model: env.OLLAMA_EMBEDDING_MODEL,
      body: {
        model: env.OLLAMA_EMBEDDING_MODEL,
        input: ['Sonic the Hedgehog'],
      },
    })
  })

  it('handles the recent response shape: { embeddings: [[...]] }', async () => {
    const vector = fakeVector()
    mockedRequest.mockResolvedValue({ embeddings: [vector] })

    const result = await ollamaEmbeddingClient.embed(['a'])

    expect(result).toEqual([vector])
  })

  it('handles the legacy response shape: { embedding: [...] }', async () => {
    const vector = fakeVector()
    mockedRequest.mockResolvedValue({ embedding: vector })

    const result = await ollamaEmbeddingClient.embed(['a'])

    expect(result).toEqual([vector])
  })

  it('throws OllamaInvalidJsonError when neither `embeddings` nor `embedding` is present', async () => {
    mockedRequest.mockResolvedValue({})

    await expect(ollamaEmbeddingClient.embed(['a'])).rejects.toBeInstanceOf(
      OllamaInvalidJsonError,
    )
  })

  it('throws OllamaInvalidJsonError when the vector dimension does not match OLLAMA_EMBEDDING_DIM', async () => {
    mockedRequest.mockResolvedValue({ embeddings: [[0.1, 0.2, 0.3]] })

    await expect(ollamaEmbeddingClient.embed(['a'])).rejects.toBeInstanceOf(
      OllamaInvalidJsonError,
    )
  })
})
