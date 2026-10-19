import type { Metrics } from '@repo/shared/types'
import { Router } from 'express'
import { env } from '../env.js'
import { requireAuth } from '../middleware/require-auth.middleware.js'
import { buildMetrics } from '../service/metrics.service.js'
import { countEmbeddings } from '../storage/embedding.storage.js'
import { readRawMetrics } from '../storage/metrics.storage.js'

export const metricsRouter = Router()

// GET /api/metrics: JSON report on the AI stack
metricsRouter.get('/metrics', requireAuth, async (_req, res, next) => {
  try {
    const userId = res.locals.userId as string
    const [raw, vectors] = await Promise.all([
      readRawMetrics(),
      countEmbeddings(userId),
    ])

    const body: Metrics = buildMetrics(
      raw,
      {
        llmModel: env.OLLAMA_LLM_MODEL,
        embeddingModel: env.OLLAMA_EMBEDDING_MODEL,
        embeddingDimension: env.OLLAMA_EMBEDDING_DIM,
        contextWindow: env.OLLAMA_NUM_CTX,
        temperature: env.OLLAMA_TEMPERATURE,
        thinking: env.OLLAMA_THINKING,
        confidenceThreshold: env.AI_CONFIDENCE_THRESHOLD,
      },
      vectors,
    )
    res.status(200).json(body)
  } catch (err) {
    next(err)
  }
})
