import { z } from 'zod'

// Zod enum with every identification sources
export const identificationSourceSchema = z.enum([
  'DAT_SHA1',
  'DAT_MD5',
  'DAT_SHA1_DATA',
  'DAT_MD5_DATA',
  'DAT_NAME',
  'AI_PROPOSED',
  'USER_CONFIRMED',
  'UNIDENTIFIED',
])

// Validates and parses a ROM summary
export const romSummarySchema = z.object({
  id: z.string(),
  fileName: z.string(),
  sizeBytes: z.number(),
  platformId: z.string().nullable(),
  platformName: z.string().nullable(),
  identificationSource: identificationSourceSchema,
  confidence: z.number().nullable(),
  title: z.string().nullable(),
})

// Validates and parses a query listing ROMs
export const romListQuerySchema = z.object({
  search: z.string().optional(),
  platformId: z.string().optional(),
  identificationSource: identificationSourceSchema.optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
})

// Validates and parses a platform
export const platformSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
})
