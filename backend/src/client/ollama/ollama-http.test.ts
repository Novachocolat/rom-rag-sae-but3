import { beforeEach, describe, expect, it, vi } from 'vitest'
import { env } from '../../env.js'
import { logger } from '../../lib/logger.js'
import { ollamaRequest } from './ollama-http.js'
import {
  OllamaContextOverflowError,
  OllamaInvalidJsonError,
  OllamaModelNotFoundError,
  OllamaServerError,
  OllamaTimeoutError,
  OllamaUnavailableError,
} from './ollama.error.js'

vi.mock('../../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

function fakeResponse(status: number, bodyText: string): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(bodyText),
  } as Response
}

// Tests for the Ollama HTTP transport: the only module allowed to call
// `fetch` against Ollama (timeouts, retries and error classification)
describe('ollamaRequest', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubGlobal('fetch', vi.fn())
    // Makes the retry backoff instant: these tests assert attempt counts and
    // classification, not real timing.
    vi.stubGlobal('setTimeout', (cb: () => void) => {
      cb()
      return 0 as unknown as ReturnType<typeof setTimeout>
    })
  })

  it('returns the parsed JSON body on success', async () => {
    vi.mocked(fetch).mockResolvedValue(
      fakeResponse(200, JSON.stringify({ response: 'hi' })),
    )

    const result = await ollamaRequest('/api/generate', {
      model: 'gemma4:26b',
      body: { model: 'gemma4:26b', prompt: 'hello' },
    })

    expect(result).toEqual({ response: 'hi' })
  })

  it('sends the method, JSON content-type and serialized body, with a timeout signal', async () => {
    vi.mocked(fetch).mockResolvedValue(fakeResponse(200, '{}'))

    await ollamaRequest('/api/generate', {
      model: 'gemma4:26b',
      body: { model: 'gemma4:26b', prompt: 'hello' },
    })

    expect(fetch).toHaveBeenCalledWith(
      `${env.OLLAMA_BASE_URL}/api/generate`,
      expect.objectContaining({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'gemma4:26b', prompt: 'hello' }),
        signal: expect.any(AbortSignal),
      }),
    )
  })

  it('respects a custom method and omits the body when none is given', async () => {
    vi.mocked(fetch).mockResolvedValue(fakeResponse(200, '{}'))

    await ollamaRequest('/api/tags', { model: 'n/a', method: 'GET' })

    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ method: 'GET', body: undefined }),
    )
  })

  it('throws OllamaInvalidJsonError on a non-JSON 200 response, without retrying', async () => {
    vi.mocked(fetch).mockResolvedValue(fakeResponse(200, 'not json'))

    await expect(
      ollamaRequest('/api/generate', { model: 'm' }),
    ).rejects.toBeInstanceOf(OllamaInvalidJsonError)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('throws OllamaModelNotFoundError on a 404 "model not found" body, without retrying', async () => {
    vi.mocked(fetch).mockResolvedValue(
      fakeResponse(404, JSON.stringify({ error: 'model "x" not found' })),
    )

    await expect(
      ollamaRequest('/api/generate', { model: 'x' }),
    ).rejects.toBeInstanceOf(OllamaModelNotFoundError)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('throws OllamaContextOverflowError when the body mentions the context length, without retrying', async () => {
    vi.mocked(fetch).mockResolvedValue(
      fakeResponse(
        500,
        JSON.stringify({ error: 'prompt exceeds context length' }),
      ),
    )

    await expect(
      ollamaRequest('/api/generate', { model: 'm' }),
    ).rejects.toBeInstanceOf(OllamaContextOverflowError)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('throws OllamaTimeoutError on an aborted request, without retrying', async () => {
    const timeoutError = new Error('The operation timed out')
    timeoutError.name = 'TimeoutError'
    vi.mocked(fetch).mockRejectedValue(timeoutError)

    await expect(
      ollamaRequest('/api/generate', { model: 'm' }),
    ).rejects.toBeInstanceOf(OllamaTimeoutError)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('retries a 503 response and succeeds once Ollama recovers', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(fakeResponse(503, 'unavailable'))
      .mockResolvedValueOnce(fakeResponse(200, '{"ok":true}'))

    const result = await ollamaRequest('/api/generate', { model: 'm' })

    expect(result).toEqual({ ok: true })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('retries a plain network failure classified as OllamaUnavailableError', async () => {
    vi.mocked(fetch)
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce(fakeResponse(200, '{}'))

    const result = await ollamaRequest('/api/generate', { model: 'm' })

    expect(result).toEqual({})
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('throws OllamaUnavailableError when every retry also fails to connect', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('ECONNREFUSED'))

    await expect(
      ollamaRequest('/api/generate', { model: 'm' }),
    ).rejects.toBeInstanceOf(OllamaUnavailableError)
  })

  it('gives up after OLLAMA_MAX_RETRIES retries and throws the last error', async () => {
    vi.mocked(fetch).mockResolvedValue(fakeResponse(500, 'boom'))

    await expect(
      ollamaRequest('/api/generate', { model: 'm' }),
    ).rejects.toBeInstanceOf(OllamaServerError)
    expect(fetch).toHaveBeenCalledTimes(env.OLLAMA_MAX_RETRIES + 1)
  })

  it('logs every successful call with model, path and durationMs', async () => {
    vi.mocked(fetch).mockResolvedValue(fakeResponse(200, '{}'))

    await ollamaRequest('/api/generate', { model: 'gemma4:26b' })

    expect(logger.info).toHaveBeenCalledWith(
      'Ollama call succeeded',
      expect.objectContaining({
        model: 'gemma4:26b',
        path: '/api/generate',
        durationMs: expect.any(Number),
      }),
    )
  })
})
