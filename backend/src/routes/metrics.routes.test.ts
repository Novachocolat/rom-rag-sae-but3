import express from 'express'
import type { NextFunction, Request, Response } from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { env } from '../env.js'
import { errorMiddleware } from '../middleware/error.middleware.js'
import { countEmbeddings } from '../storage/embedding.storage.js'
import { readRawMetrics } from '../storage/metrics.storage.js'
import { metricsRouter } from './metrics.routes.js'

vi.mock('../middleware/require-auth.middleware.js', () => ({
  requireAuth: (_req: Request, res: Response, next: NextFunction) => {
    res.locals.userId = 'user-1'
    next()
  },
}))
vi.mock('../storage/metrics.storage.js', () => ({ readRawMetrics: vi.fn() }))
vi.mock('../storage/embedding.storage.js', () => ({ countEmbeddings: vi.fn() }))

function buildApp() {
  const app = express()
  app.use('/api', metricsRouter)
  app.use(errorMiddleware)
  return app
}

// Tests for GET /api/metrics, which aggregates Redis counters with the configuration
describe('GET /api/metrics', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('answers the aggregated report with the configuration and the vector count of the user', async () => {
    vi.mocked(readRawMetrics).mockResolvedValue({
      inferencesByModel: { [env.OLLAMA_LLM_MODEL]: 2 },
      durationsByModel: { [env.OLLAMA_LLM_MODEL]: [100, 300] },
      tokensPerSecondByModel: { [env.OLLAMA_LLM_MODEL]: [10, 30] },
      cacheHits: 1,
      cacheMisses: 1,
      errorsByType: {},
    })
    vi.mocked(countEmbeddings).mockResolvedValue(42)

    const response = await request(buildApp()).get('/api/metrics')

    expect(response.status).toBe(200)
    expect(countEmbeddings).toHaveBeenCalledWith('user-1')
    expect(response.body.config.llmModel).toBe(env.OLLAMA_LLM_MODEL)
    expect(response.body.inference.models[0]).toMatchObject({
      inferences: 2,
      avgDurationMs: 200,
      avgTokensPerSecond: 20,
    })
    expect(response.body.cache.hitRate).toBe(0.5)
    expect(response.body.index.vectors).toBe(42)
  })

  it('forwards a Redis failure to the error middleware', async () => {
    vi.mocked(readRawMetrics).mockRejectedValue(new Error('redis down'))
    vi.mocked(countEmbeddings).mockResolvedValue(0)

    const response = await request(buildApp()).get('/api/metrics')

    expect(response.status).toBe(500)
  })
})
