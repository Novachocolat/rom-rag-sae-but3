import type { DependencyStatus, Health } from '@repo/shared/schemas'
import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { redis } from '../lib/redis.js'

// Checks if Postgres is reachable by counting the number of users in the database
async function checkPostgres(): Promise<DependencyStatus> {
  try {
    await prisma.user.count()
    return 'up'
  } catch {
    return 'down'
  }
}

// Checks if Redis is reachable by sending a ping command
async function checkRedis(): Promise<DependencyStatus> {
  try {
    return (await redis.ping()) === 'PONG' ? 'up' : 'down'
  } catch {
    return 'down'
  }
}

export const healthRouter = Router()

// TODO: Add Swagger documentation with swagger-jsdoc package
healthRouter.get('/health', async (_req, res) => {
  const [postgres, redisStatus] = await Promise.all([
    checkPostgres(),
    checkRedis(),
  ])

  const healthy = postgres === 'up' && redisStatus === 'up'
  const payload: Health = {
    status: healthy ? 'ok' : 'error',
    dependencies: { postgres, redis: redisStatus },
  }

  // 200: OK - The service is healthy
  // 503: Service Unavailable - The service is unhealthy
  res.status(healthy ? 200 : 503).json(payload)
})
