import type { z } from 'zod'
import type {
  identificationSourceSchema,
  romSummarySchema,
  romListQuerySchema,
  platformSchema,
  romDatEntrySchema,
  romDetailSchema,
} from '../schemas/rom.schema.js'

export type IdentificationSource = z.infer<typeof identificationSourceSchema>
export type RomSummary = z.infer<typeof romSummarySchema>
export type RomListQuery = z.infer<typeof romListQuerySchema>
export type Platform = z.infer<typeof platformSchema>
export type RomDatEntry = z.infer<typeof romDatEntrySchema>
export type RomDetail = z.infer<typeof romDetailSchema>
