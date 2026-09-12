import { Redis } from 'ioredis'
import { env } from '../env.js'

// Redis client using `lazyConnect` to avoid connecting when the module is imported for testing
export const redis = new Redis(env.REDIS_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: 2,
})
