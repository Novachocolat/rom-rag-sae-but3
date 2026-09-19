import * as z from 'zod'

// Validates and parses API errors using Zod
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
    requestId: z.string(),
  }),
})

// Validates and parses pagination using Zod
export const paginationSchema = z.object({
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
})

// Helper to create paginated response with any Zod schema
export function createPaginatedResponseSchema<T extends z.ZodType>(
  itemSchema: T,
) {
  return z.object({
    data: z.array(itemSchema),
    pagination: paginationSchema,
  })
}
