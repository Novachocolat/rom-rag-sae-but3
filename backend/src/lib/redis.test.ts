import { describe, expect, it } from 'vitest'
import { redis } from './redis.js'

// Tests for the Redis client, which uses `lazyConnect` so that it doesn't connect when the module is imported for testing
describe('redis client', () => {
  it('is constructed without connecting', () => {
    expect(redis.status).toBe('wait')
  })

  it('targets the validated REDIS_URL', () => {
    expect(redis.options.host).toBe('localhost')
    expect(redis.options.port).toBe(6379)
  })

  it('caps retries so a dead server fails fast', () => {
    expect(redis.options.maxRetriesPerRequest).toBe(2)
  })
})
