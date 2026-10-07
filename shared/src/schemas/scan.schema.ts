import { z } from 'zod'

// Scan request payload with `path` relative to `ROM_LIBRARY_ROOT`, as `''` scans it whole
export const scanRequestSchema = z.object({
  path: z.string(),
})

// Scan status, same values as Prisma's `ScanJobStatus`, so Redis and PostgreSQL agree
export const scanStatusSchema = z.enum([
  'PENDING',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
])

// Live progress of a scan, read from Redis or from its PostgreSQL fallback
export const scanProgressSchema = z.object({
  jobId: z.string(),
  status: scanStatusSchema,
  totalFiles: z.number().int().nonnegative(),
  processedFiles: z.number().int().nonnegative(),
  identifiedCount: z.number().int().nonnegative(),
  unidentifiedCount: z.number().int().nonnegative(),
  errorCount: z.number().int().nonnegative(),
  current: z.string().nullable(), // Relative path of the last processed file
  errorMessage: z.string().nullable(),
})

// One row of the scan history
export const scanJobSummarySchema = scanProgressSchema.extend({
  rootRelativePath: z.string(),
  startedAt: z.coerce.date(),
  finishedAt: z.coerce.date().nullable(),
})

// Pagination of the scan history, coerced from the query string
export const scanListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
})
