import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../app.js'
import { pingOllama } from '../client/ollama/ollama-health.js'
import { prisma } from '../lib/prisma.js'
import { redis } from '../lib/redis.js'

// Mocks all three dependencies: Prisma's `count`, Redis' `ping`, and the Ollama probe
vi.mock('../lib/prisma.js', () => ({
  prisma: { user: { count: vi.fn() } },
}))
vi.mock('../lib/redis.js', () => ({
  redis: { ping: vi.fn() },
}))
vi.mock('../client/ollama/ollama-health.js', () => ({
  pingOllama: vi.fn(),
}))

const count = vi.mocked(prisma.user.count)
const ping = vi.mocked(redis.ping)
const ollamaPing = vi.mocked(pingOllama)

// Tests for GET /api/health route, which probes every dependency and
// returns 200 (ok/degraded) or 503 depending on the critical ones
describe('GET /api/health', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    // Ollama up by default; individual tests override this to exercise degradation
    ollamaPing.mockResolvedValue({ up: true, version: '0.1.0', latencyMs: 5 })
  })

  it('returns 200 and marks every dependency up when they all answer', async () => {
    count.mockResolvedValue(0)
    ping.mockResolvedValue('PONG')

    const response = await request(createApp()).get('/api/health')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      status: 'ok',
      dependencies: { postgres: 'up', redis: 'up', ollama: 'up' },
    })
  })

  it('returns 503 and marks postgres down when the query fails', async () => {
    count.mockRejectedValue(new Error('connection refused'))
    ping.mockResolvedValue('PONG')

    const response = await request(createApp()).get('/api/health')

    expect(response.status).toBe(503)
    expect(response.body).toEqual({
      status: 'error',
      dependencies: { postgres: 'down', redis: 'up', ollama: 'up' },
    })
  })

  it('returns 503 and marks redis down when the ping fails', async () => {
    count.mockResolvedValue(0)
    ping.mockRejectedValue(new Error('connection refused'))

    const response = await request(createApp()).get('/api/health')

    expect(response.status).toBe(503)
    expect(response.body).toEqual({
      status: 'error',
      dependencies: { postgres: 'up', redis: 'down', ollama: 'up' },
    })
  })

  it('treats an unexpected ping reply as down', async () => {
    count.mockResolvedValue(0)
    ping.mockResolvedValue('WAT')

    const response = await request(createApp()).get('/api/health')

    expect(response.status).toBe(503)
    expect(response.body.dependencies.redis).toBe('down')
  })

  it('returns 200 degraded when Ollama is down but Postgres/Redis are up', async () => {
    count.mockResolvedValue(0)
    ping.mockResolvedValue('PONG')
    ollamaPing.mockResolvedValue({ up: false, latencyMs: 3000 })

    const response = await request(createApp()).get('/api/health')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      status: 'degraded',
      dependencies: { postgres: 'up', redis: 'up', ollama: 'down' },
    })
  })

  it('stays 503 error when a critical dependency is down even if Ollama is up', async () => {
    count.mockRejectedValue(new Error('connection refused'))
    ping.mockResolvedValue('PONG')

    const response = await request(createApp()).get('/api/health')

    expect(response.status).toBe(503)
    expect(response.body.status).toBe('error')
  })

  it('probes every dependency concurrently on every request', async () => {
    count.mockResolvedValue(0)
    ping.mockResolvedValue('PONG')

    await request(createApp()).get('/api/health')

    expect(count).toHaveBeenCalledTimes(1)
    expect(ping).toHaveBeenCalledTimes(1)
    expect(ollamaPing).toHaveBeenCalledTimes(1)
  })
})
