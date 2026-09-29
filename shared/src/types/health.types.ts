import type { z } from 'zod'
import type {
  dependencyStatusSchema,
  healthSchema,
} from '../schemas/health.schema.js'

export type DependencyStatus = z.infer<typeof dependencyStatusSchema>
export type Health = z.infer<typeof healthSchema>
