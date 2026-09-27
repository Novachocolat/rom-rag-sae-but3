import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { createApp } from '../app.js'
import { prisma } from '../lib/prisma.js'
import { redis } from '../lib/redis.js'

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  },
}))
vi.mock('../lib/redis.js', () => ({
  redis: {
    set: vi.fn(),
    get: vi.fn(),
    del: vi.fn(),
    expire: vi.fn(),
  },
}))

const NOW = new Date('2026-01-01T00:00:00.000Z')

function dbUser(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'user-1',
    email: 'player@example.com',
    passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$existinghash',
    displayName: 'Player One',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

type DbUser = ReturnType<typeof dbUser>

// The real Prisma client returns a thenable with chainable relation
// accessors (`.roms()`, `.collections()`, ...); the mocks only need to
// resolve to a plain user, hence the cast through `unknown`.
const findUnique = vi.mocked(prisma.user.findUnique) as unknown as Mock<
  (args: { where: Record<string, unknown> }) => Promise<DbUser | null>
>
const create = vi.mocked(prisma.user.create) as unknown as Mock<
  (args: { data: Record<string, unknown> }) => Promise<DbUser>
>
const redisSet = vi.mocked(redis.set)
const redisGet = vi.mocked(redis.get)
const redisDel = vi.mocked(redis.del)
const redisExpire = vi.mocked(redis.expire)

// Tests for the four auth endpoints, covering the DoD scenarios end to end
// through the real Express app (Prisma and Redis are mocked at the client
// boundary; hashing/session-token generation run for real).
describe('auth routes', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    // In-memory stand-in for Redis session storage, so a session created by
    // one request (signup/login) can be read back by a later one (/me,
    // logout) within the same test, the way real Redis would behave.
    const sessions = new Map<string, string>()
    redisSet.mockImplementation(async (key, value) => {
      sessions.set(String(key), String(value))
      return 'OK'
    })
    redisGet.mockImplementation(
      async (key) => sessions.get(String(key)) ?? null,
    )
    redisDel.mockImplementation(async (key) => {
      const existed = sessions.delete(String(key))
      return existed ? 1 : 0
    })
    redisExpire.mockResolvedValue(1)
  })

  describe('POST /api/auth/signup', () => {
    it('creates the account and returns 201 with a public user and a cookie', async () => {
      findUnique.mockResolvedValue(null)
      create.mockImplementation(({ data }) =>
        Promise.resolve(dbUser({ ...data })),
      )

      const response = await request(createApp())
        .post('/api/auth/signup')
        .send({
          email: 'player@example.com',
          password: 'correct horse battery staple',
          displayName: 'Player One',
        })

      expect(response.status).toBe(201)
      expect(response.body).toEqual({
        id: 'user-1',
        email: 'player@example.com',
        displayName: 'Player One',
        createdAt: NOW.toISOString(),
      })
      expect(response.headers['set-cookie']?.[0]).toMatch(/^rr_session=/)
      expect(JSON.stringify(response.body)).not.toContain('passwordHash')
    })

    it('rejects a duplicate email with 409', async () => {
      findUnique.mockResolvedValue(dbUser())

      const response = await request(createApp())
        .post('/api/auth/signup')
        .send({
          email: 'player@example.com',
          password: 'correct horse battery staple',
        })

      expect(response.status).toBe(409)
      expect(create).not.toHaveBeenCalled()
    })

    it('rejects a password shorter than 12 characters', async () => {
      const response = await request(createApp())
        .post('/api/auth/signup')
        .send({
          email: 'player@example.com',
          password: 'short',
        })

      expect(response.status).toBe(400)
      expect(findUnique).not.toHaveBeenCalled()
    })
  })

  describe('POST /api/auth/login', () => {
    it('logs in with the right credentials and returns 200 with a cookie', async () => {
      const { hashPassword } = await import('../service/auth.service.js')
      const passwordHash = await hashPassword('correct horse battery staple')
      findUnique.mockResolvedValue(dbUser({ passwordHash }))

      const response = await request(createApp()).post('/api/auth/login').send({
        email: 'player@example.com',
        password: 'correct horse battery staple',
      })

      expect(response.status).toBe(200)
      expect(response.body.id).toBe('user-1')
      expect(response.headers['set-cookie']?.[0]).toMatch(/^rr_session=/)
    })

    it('rejects a wrong password with 401 and a generic message', async () => {
      const { hashPassword } = await import('../service/auth.service.js')
      const passwordHash = await hashPassword('correct horse battery staple')
      findUnique.mockResolvedValue(dbUser({ passwordHash }))

      const response = await request(createApp()).post('/api/auth/login').send({
        email: 'player@example.com',
        password: 'wrong password',
      })

      expect(response.status).toBe(401)
      expect(response.body.error.message).toBe('Invalid credentials')
    })

    it('rejects an unknown email with the exact same 401 message', async () => {
      findUnique.mockResolvedValue(null)

      const response = await request(createApp()).post('/api/auth/login').send({
        email: 'ghost@example.com',
        password: 'whatever password',
      })

      expect(response.status).toBe(401)
      expect(response.body.error.message).toBe('Invalid credentials')
    })
  })

  describe('GET /api/auth/me', () => {
    it('returns 401 without a session cookie', async () => {
      const response = await request(createApp()).get('/api/auth/me')

      expect(response.status).toBe(401)
    })

    it('returns 200 with the public user for a valid session cookie', async () => {
      const agent = request.agent(createApp())
      // No duplicate on signup's email lookup, but a hit on /me's id lookup.
      findUnique.mockImplementation(({ where }) =>
        Promise.resolve('email' in where ? null : dbUser()),
      )
      create.mockImplementation(({ data }) =>
        Promise.resolve(dbUser({ ...data })),
      )

      await agent.post('/api/auth/signup').send({
        email: 'player@example.com',
        password: 'correct horse battery staple',
      })

      const response = await agent.get('/api/auth/me')

      expect(response.status).toBe(200)
      expect(response.body.email).toBe('player@example.com')
      expect(JSON.stringify(response.body)).not.toContain('passwordHash')
    })

    it('returns 401 when the session is valid but the user is gone', async () => {
      const agent = request.agent(createApp())
      findUnique.mockResolvedValue(null)
      create.mockImplementation(({ data }) =>
        Promise.resolve(dbUser({ ...data })),
      )

      await agent.post('/api/auth/signup').send({
        email: 'player@example.com',
        password: 'correct horse battery staple',
      })

      // The session cookie is still valid, but the user row was deleted
      // (e.g. account removal) after the session was created.
      const response = await agent.get('/api/auth/me')

      expect(response.status).toBe(401)
    })
  })

  describe('POST /api/auth/logout', () => {
    it('clears the cookie and actually deletes the session from Redis', async () => {
      const agent = request.agent(createApp())
      findUnique.mockResolvedValue(null)
      create.mockImplementation(({ data }) =>
        Promise.resolve(dbUser({ ...data })),
      )

      await agent.post('/api/auth/signup').send({
        email: 'player@example.com',
        password: 'correct horse battery staple',
      })

      const logoutResponse = await agent.post('/api/auth/logout')
      expect(logoutResponse.status).toBe(204)
      expect(redisDel).toHaveBeenCalledTimes(1)

      // The session is really gone server-side, not just cleared client-side.
      findUnique.mockResolvedValue(dbUser())
      const meResponse = await agent.get('/api/auth/me')
      expect(meResponse.status).toBe(401)
    })

    it('is idempotent when there is no session to invalidate', async () => {
      const response = await request(createApp()).post('/api/auth/logout')

      expect(response.status).toBe(204)
      expect(redisDel).not.toHaveBeenCalled()
    })
  })
})
