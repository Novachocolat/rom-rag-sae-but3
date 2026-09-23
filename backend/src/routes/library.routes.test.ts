import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../app.js'
import { redis } from '../lib/redis.js'
import { env } from '../env.js'
import {
  PathTraversalError,
  listSubdirectories,
} from '../storage/filesystem.storage.js'

vi.mock('../lib/redis.js', () => ({
  redis: { get: vi.fn(), expire: vi.fn() },
}))
vi.mock('../storage/filesystem.storage.js', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../storage/filesystem.storage.js')>()
  return { ...original, listSubdirectories: vi.fn() }
})

const get = vi.mocked(redis.get)
const expire = vi.mocked(redis.expire)
const listSubdirectoriesMock = vi.mocked(listSubdirectories)

const AUTH_COOKIE = `${env.SESSION_COOKIE_NAME}=tok123`

describe('GET /api/library/browse', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    get.mockResolvedValue('user-1')
    expire.mockResolvedValue(1)
  })

  it('rejects an unauthenticated request', async () => {
    const response = await request(createApp()).get('/api/library/browse')

    expect(response.status).toBe(401)
    expect(listSubdirectoriesMock).not.toHaveBeenCalled()
  })

  it('lists subdirectories for the root path by default', async () => {
    listSubdirectoriesMock.mockResolvedValue(['gb', 'snes'])

    const response = await request(createApp())
      .get('/api/library/browse')
      .set('Cookie', AUTH_COOKIE)

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ path: '', directories: ['gb', 'snes'] })
    expect(listSubdirectoriesMock).toHaveBeenCalledWith('')
  })

  it('forwards the requested path', async () => {
    listSubdirectoriesMock.mockResolvedValue(['gbc'])

    const response = await request(createApp())
      .get('/api/library/browse')
      .query({ path: 'gb' })
      .set('Cookie', AUTH_COOKIE)

    expect(response.status).toBe(200)
    expect(listSubdirectoriesMock).toHaveBeenCalledWith('gb')
  })

  it('turns a path-traversal attempt into a 400', async () => {
    listSubdirectoriesMock.mockRejectedValue(new PathTraversalError('../etc'))

    const response = await request(createApp())
      .get('/api/library/browse')
      .query({ path: '../etc' })
      .set('Cookie', AUTH_COOKIE)

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('INVALID_PATH')
  })

  it('turns an unexpected failure into a 500', async () => {
    listSubdirectoriesMock.mockRejectedValue(new Error('disk unreadable'))

    const response = await request(createApp())
      .get('/api/library/browse')
      .set('Cookie', AUTH_COOKIE)

    expect(response.status).toBe(500)
  })
})
