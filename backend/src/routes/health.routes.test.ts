import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../app.js'
import { prisma } from '../lib/prisma.js'
import { redis } from '../lib/redis.js'

// Mocks both dependencies to each have a `count` and `ping` method
vi.mock('../lib/prisma.js', () => ({
  prisma: { user: { count: vi.fn() } },
}))
vi.mock('../lib/redis.js', () => ({
  redis: { ping: vi.fn() },
}))

const count = vi.mocked(prisma.user.count)
const ping = vi.mocked(redis.ping)

// Tests for GET /api/health route, which probes both dependencies and returns a 200 or 503 depending on their health
describe('GET /api/health', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns 200 and marks both dependencies up when they answer', async () => {
    count.mockResolvedValue(0)
    ping.mockResolvedValue('PONG')

    const response = await request(createApp()).get('/api/health')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      status: 'ok',
      dependencies: { postgres: 'up', redis: 'up' },
    })
  })

  it('returns 503 and marks postgres down when the query fails', async () => {
    count.mockRejectedValue(new Error('connection refused'))
    ping.mockResolvedValue('PONG')

    const response = await request(createApp()).get('/api/health')

    expect(response.status).toBe(503)
    expect(response.body).toEqual({
      status: 'error',
      dependencies: { postgres: 'down', redis: 'up' },
    })
  })

  it('returns 503 and marks redis down when the ping fails', async () => {
    count.mockResolvedValue(0)
    ping.mockRejectedValue(new Error('connection refused'))

    const response = await request(createApp()).get('/api/health')

    expect(response.status).toBe(503)
    expect(response.body).toEqual({
      status: 'error',
      dependencies: { postgres: 'up', redis: 'down' },
    })
  })

  it('treats an unexpected ping reply as down', async () => {
    count.mockResolvedValue(0)
    ping.mockResolvedValue('WAT')

    const response = await request(createApp()).get('/api/health')

    expect(response.status).toBe(503)
    expect(response.body.dependencies.redis).toBe('down')
  })

  it('probes both dependencies concurrently on every request', async () => {
    count.mockResolvedValue(0)
    ping.mockResolvedValue('PONG')

    await request(createApp()).get('/api/health')

    expect(count).toHaveBeenCalledTimes(1)
    expect(ping).toHaveBeenCalledTimes(1)
  })
})
