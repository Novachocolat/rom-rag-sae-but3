import type { z } from 'zod'
import type {
  metricsSchema,
  modelMetricsSchema,
} from '../schemas/metrics.schema.js'

export type ModelMetrics = z.infer<typeof modelMetricsSchema>
export type Metrics = z.infer<typeof metricsSchema>
