import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { prisma } from './lib/prisma.js'
import { redis } from './lib/redis.js'
import { startServer } from './server.js'

// Mocks the database and Redis clients so that the tests don't actually connect to anything
vi.mock('./lib/prisma.js', () => ({
  prisma: { user: { count: vi.fn() }, $disconnect: vi.fn() },
}))
vi.mock('./lib/redis.js', () => ({
  redis: { ping: vi.fn(), quit: vi.fn() },
}))

// Tests for the `startServer` function, which binds the application to a port and wires a graceful shutdown
describe('startServer', () => {
  let server: ReturnType<typeof startServer> | undefined

  afterEach(async () => {
    // Clean up the server after each test to avoid leaking handles
    if (server?.listening) {
      await new Promise((resolve) => server?.close(resolve))
    }
    server = undefined
  })

  it('binds to the given port', async () => {
    server = startServer(0) // Uses port 0 to let the OS pick a free port during tests

    await new Promise((resolve) => server?.once('listening', resolve))

    expect(server.listening).toBe(true)
    expect((server.address() as AddressInfo).port).toBeGreaterThan(0)
  })

  it('does not start a server on import', () => {
    expect(prisma.$disconnect).not.toHaveBeenCalled()
    expect(redis.quit).not.toHaveBeenCalled()
  })
})
