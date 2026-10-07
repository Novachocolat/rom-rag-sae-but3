import type { z } from 'zod'
import type {
  scanRequestSchema,
  scanStatusSchema,
  scanProgressSchema,
  scanJobSummarySchema,
  scanListQuerySchema,
} from '../schemas/scan.schema.js'

export type ScanRequest = z.infer<typeof scanRequestSchema>
export type ScanStatus = z.infer<typeof scanStatusSchema>
export type ScanProgress = z.infer<typeof scanProgressSchema>
export type ScanJobSummary = z.infer<typeof scanJobSummarySchema>
export type ScanListQuery = z.infer<typeof scanListQuerySchema>
