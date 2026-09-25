import { z } from 'zod'

// Body of POST /api/scans
export const scanRequestSchema = z.object({
  path: z.string().min(1),
})

export const scanStatusSchema = z.enum([
  'PENDING',
  'RUNNING',
  'DONE',
  'ERROR',
  'CANCELLED',
])

// Progress payload returned by GET /api/scans/:id
export const scanProgressSchema = z.object({
  jobId: z.string(),
  status: scanStatusSchema,
  totalFiles: z.number().int().nonnegative(),
  processedFiles: z.number().int().nonnegative(),
  identifiedCount: z.number().int().nonnegative(),
  unidentifiedCount: z.number().int().nonnegative(),
  errorCount: z.number().int().nonnegative(),
  current: z.string().nullable(),
})

export const scanIdParamsSchema = z.object({
  id: z.string().min(1),
})

export const scanListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
})

export type ScanRequest = z.infer<typeof scanRequestSchema>
export type ScanStatus = z.infer<typeof scanStatusSchema>
export type ScanProgress = z.infer<typeof scanProgressSchema>
export type ScanListQuery = z.infer<typeof scanListQuerySchema>
