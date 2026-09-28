import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../app.js'
import { redis } from '../lib/redis.js'
import { env } from '../env.js'
import { listRoms } from '../storage/rom.storage.js'

// Mocks dependencies
vi.mock('../lib/redis.js', () => ({
  redis: { get: vi.fn(), expire: vi.fn() },
}))
vi.mock('../storage/rom.storage.js', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../storage/rom.storage.js')>()
  return { ...original, listRoms: vi.fn() }
})

const get = vi.mocked(redis.get)
const expire = vi.mocked(redis.expire)
const listRomsMock = vi.mocked(listRoms)
const AUTH_COOKIE = `${env.SESSION_COOKIE_NAME}=tok123`

// Tests for GET /api/roms route
describe('GET /api/roms', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    get.mockResolvedValue('user-1')
    expire.mockResolvedValue(1)
  })

  it('rejects an unauthenticated request', async () => {
    const response = await request(createApp()).get('/api/roms')
    expect(response.status).toBe(401)
  })

  it('returns a paginated, serializable list', async () => {
    listRomsMock.mockResolvedValue({
      roms: [
        {
          id: 'rom-1',
          fileName: 'game.nes',
          sizeBytes: 1024n,
          platformId: 'p-1',
          platform: { name: 'NES' },
          identificationSource: 'DAT_SHA1',
          confidence: 1,
          title: 'Game',
        },
      ] as never,
      total: 1,
      page: 1,
      pageSize: 20,
    })

    const response = await request(createApp())
      .get('/api/roms')
      .set('Cookie', AUTH_COOKIE)

    expect(response.status).toBe(200)
    expect(response.body.data[0]).toMatchObject({
      id: 'rom-1',
      sizeBytes: 1024,
      platformName: 'NES',
    })
    expect(listRomsMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', page: 1, pageSize: 20 }),
    )
  })
})
