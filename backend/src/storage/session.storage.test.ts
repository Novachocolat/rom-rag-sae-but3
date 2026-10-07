import { describe, expect, it, vi } from 'vitest'
import { redis } from '../lib/redis.js'
import {
  deleteSession,
  getSession,
  saveSession,
  touchSession,
} from './session.storage.js'

vi.mock('../lib/redis.js', () => ({
  redis: {
    set: vi.fn(),
    get: vi.fn(),
    del: vi.fn(),
    expire: vi.fn(),
  },
}))

const set = vi.mocked(redis.set)
const get = vi.mocked(redis.get)
const del = vi.mocked(redis.del)
const expire = vi.mocked(redis.expire)

// Tests for the Redis-backed session store: each function must key its data
// as `session:<token>` and let Redis own expiry (no TTL bookkeeping here).
describe('session.storage', () => {
  it('saveSession stores the userId under session:<token> with a TTL', async () => {
    set.mockResolvedValue('OK')

    await saveSession('tok123', 'user-1', 604800)

    expect(set).toHaveBeenCalledWith('session:tok123', 'user-1', 'EX', 604800)
  })

  it('getSession reads the userId back by token', async () => {
    get.mockResolvedValue('user-1')

    const result = await getSession('tok123')

    expect(get).toHaveBeenCalledWith('session:tok123')
    expect(result).toBe('user-1')
  })

  it('getSession returns null for an unknown or expired token', async () => {
    get.mockResolvedValue(null)

    await expect(getSession('missing')).resolves.toBeNull()
  })

  it('deleteSession removes the session key outright', async () => {
    del.mockResolvedValue(1)

    await deleteSession('tok123')

    expect(del).toHaveBeenCalledWith('session:tok123')
  })

  it('touchSession renews the TTL without touching the value', async () => {
    expire.mockResolvedValue(1)

    await touchSession('tok123', 604800)

    expect(expire).toHaveBeenCalledWith('session:tok123', 604800)
  })
})
