import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from './app.js'
import { prisma } from './lib/prisma.js'
import { redis } from './lib/redis.js'

// Mocks the database and Redis clients so that the tests don't actually connect to anything
vi.mock('./lib/prisma.js', () => ({
  prisma: { user: { count: vi.fn() } },
}))
vi.mock('./lib/redis.js', () => ({
  redis: { ping: vi.fn() },
}))

// Tests for the `createApp` function, which builds the Express application without binding a port
describe('createApp', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(prisma.user.count).mockResolvedValue(0)
    vi.mocked(redis.ping).mockResolvedValue('PONG')
  })

  it('builds an app without binding a port', () => {
    const app = createApp()

    expect(app).toBeDefined()
    expect(typeof app.listen).toBe('function')
  })

  it('mounts the health router under /api', async () => {
    const response = await request(createApp()).get('/api/health')

    expect(response.status).toBe(200)
  })

  it('does not serve the health route at the root', async () => {
    const response = await request(createApp()).get('/health')

    expect(response.status).toBe(404)
  })

  it('applies the helmet security headers', async () => {
    const response = await request(createApp()).get('/api/health')

    expect(response.headers['x-content-type-options']).toBe('nosniff')
  })

  it('allows the configured CORS origin', async () => {
    const response = await request(createApp())
      .get('/api/health')
      .set('Origin', 'http://localhost:5173')

    expect(response.headers['access-control-allow-origin']).toBe(
      'http://localhost:5173',
    )
  })
})
