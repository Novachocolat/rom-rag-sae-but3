import { z } from 'zod'

// Status of a dependency, either "up" or "down"
export const dependencyStatusSchema = z.enum(['up', 'down'])

// Health check schema, including the status of the service and its dependencies
export const healthSchema = z.object({
  status: z.enum(['ok', 'error']),
  dependencies: z.object({
    postgres: dependencyStatusSchema,
    redis: dependencyStatusSchema,
  }),
})

export type DependencyStatus = z.infer<typeof dependencyStatusSchema>
export type Health = z.infer<typeof healthSchema>
