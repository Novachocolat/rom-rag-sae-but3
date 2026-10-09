import { beforeEach, describe, expect, it, vi } from 'vitest'
import { env } from '../../env.js'
import { checkOllama, pingOllama } from './ollama-health.js'

function fakeResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response
}

// Tests for the two Ollama health probes, which intentionally bypass
// ollama-http.ts to fail fast and never retry
describe('pingOllama', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  it('reports up with the version and a latency when Ollama answers', async () => {
    vi.mocked(fetch).mockResolvedValue(fakeResponse(200, { version: '0.5.1' }))

    const result = await pingOllama()

    expect(result.up).toBe(true)
    expect(result.version).toBe('0.5.1')
    expect(result.latencyMs).toBeGreaterThanOrEqual(0)
  })

  it('calls GET /api/version', async () => {
    vi.mocked(fetch).mockResolvedValue(fakeResponse(200, { version: '0.5.1' }))

    await pingOllama()

    expect(fetch).toHaveBeenCalledWith(
      `${env.OLLAMA_BASE_URL}/api/version`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
  })

  it('reports down when the response is not ok', async () => {
    vi.mocked(fetch).mockResolvedValue(fakeResponse(503, {}))

    const result = await pingOllama()

    expect(result.up).toBe(false)
  })

  it('reports down when fetch rejects, without throwing', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('ECONNREFUSED'))

    const result = await pingOllama()

    expect(result.up).toBe(false)
  })
})

describe('checkOllama', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  it('reports ok when every configured model is present', async () => {
    vi.mocked(fetch).mockResolvedValue(
      fakeResponse(200, {
        models: [
          { name: env.OLLAMA_LLM_MODEL },
          { name: env.OLLAMA_EMBEDDING_MODEL },
        ],
      }),
    )

    const result = await checkOllama()

    expect(result.status).toBe('ok')
    expect(result.models).toEqual([
      { name: env.OLLAMA_LLM_MODEL, present: true },
      { name: env.OLLAMA_EMBEDDING_MODEL, present: true },
    ])
  })

  it('reports degraded when a configured model is missing', async () => {
    vi.mocked(fetch).mockResolvedValue(
      fakeResponse(200, { models: [{ name: env.OLLAMA_LLM_MODEL }] }),
    )

    const result = await checkOllama()

    expect(result.status).toBe('degraded')
    expect(result.models).toEqual([
      { name: env.OLLAMA_LLM_MODEL, present: true },
      { name: env.OLLAMA_EMBEDDING_MODEL, present: false },
    ])
  })

  it('reports every model missing when the response is not ok', async () => {
    vi.mocked(fetch).mockResolvedValue(fakeResponse(500, {}))

    const result = await checkOllama()

    expect(result.status).toBe('degraded')
    expect(result.models.every((m) => !m.present)).toBe(true)
  })

  it('reports every model missing when fetch rejects, without throwing', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('ECONNREFUSED'))

    const result = await checkOllama()

    expect(result.status).toBe('degraded')
    expect(result.models.every((m) => !m.present)).toBe(true)
  })
})
