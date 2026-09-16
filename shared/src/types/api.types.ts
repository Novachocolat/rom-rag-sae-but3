import type { z } from 'zod'
import type { apiErrorSchema, paginationSchema } from '../schemas/api.schema.js'

export type ApiError = z.infer<typeof apiErrorSchema>

export type Pagination = z.infer<typeof paginationSchema>

// Generic paginated response wrapper
export type Paginated<T> = {
  data: T[]
  pagination: Pagination
}
