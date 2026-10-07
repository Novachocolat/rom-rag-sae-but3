import type { DependencyStatus, Health } from '@repo/shared/types'
import { Router } from 'express'
import { pingOllama } from '../client/ollama/ollama-health.js'
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

// Checks if Ollama is reachable via the lightest probe available
async function checkOllamaDependency(): Promise<DependencyStatus> {
  return (await pingOllama()).up ? 'up' : 'down'
}

export const healthRouter = Router()

// TODO: Add Swagger documentation with swagger-jsdoc package
// Checks the health state of each dependency (Postgres, Redis, Ollama)
healthRouter.get('/health', async (_req, res) => {
  const [postgres, redisStatus, ollama] = await Promise.all([
    checkPostgres(),
    checkRedis(),
    checkOllamaDependency(),
  ])

  // Postgres/Redis are critical: without them the app can't run at all.
  // Ollama is optional: its absence degrades AI features but the rest of
  // the app (sprints 1-2) keeps working, so it must not turn into a 503.
  const criticalUp = postgres === 'up' && redisStatus === 'up'
  const status: Health['status'] = !criticalUp
    ? 'error'
    : ollama === 'up'
      ? 'ok'
      : 'degraded'

  const payload: Health = {
    status,
    dependencies: { postgres, redis: redisStatus, ollama },
  }

  // 200: OK or degraded - the service itself is usable
  // 503: Service Unavailable - a critical dependency is down
  res.status(criticalUp ? 200 : 503).json(payload)
})
