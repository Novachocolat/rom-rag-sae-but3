import { z } from 'zod'

export const modelMetricsSchema = z.object({
  model: z.string(),
  inferences: z.number().int().nonnegative(),
  avgDurationMs: z.number().nullable(),
  p95DurationMs: z.number().nullable(),
  avgTokensPerSecond: z.number().nullable(),
})

// Response of GET /api/metrics
export const metricsSchema = z.object({
  config: z.object({
    llmModel: z.string(),
    embeddingModel: z.string(),
    embeddingDimension: z.number().int(),
    contextWindow: z.number().int(),
    temperature: z.number(),
    thinking: z.boolean(),
    confidenceThreshold: z.number(),
  }),
  inference: z.object({
    total: z.number().int().nonnegative(),
    models: z.array(modelMetricsSchema),
  }),
  cache: z.object({
    hits: z.number().int().nonnegative(),
    misses: z.number().int().nonnegative(),
    hitRate: z.number().nullable(),
  }),
  errors: z.array(
    z.object({ type: z.string(), count: z.number().int().nonnegative() }),
  ),
  index: z.object({ vectors: z.number().int().nonnegative() }),
})
