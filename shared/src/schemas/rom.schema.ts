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

// The catalog entry a ROM was matched against, flattened with its DAT file
export const romDatEntrySchema = z.object({
  id: z.string(),
  gameName: z.string(),
  romName: z.string(),
  description: z.string(),
  sizeBytes: z.number(),
  crc: z.string().nullable(),
  md5: z.string().nullable(),
  sha1: z.string().nullable(),
  status: z.string().nullable(),
  datFileName: z.string(),
  datVersion: z.string().nullable(),
})

// Validates and parses the full record of a ROM, as its detail page shows it
// `md5/sha1` cover the whole file: `md5Data`/`sha1Data` skip the first `headerBytesSkipped` bytes and are null when no known header was detected
export const romDetailSchema = romSummarySchema.extend({
  relativePath: z.string(),
  extension: z.string(),
  md5: z.string(),
  sha1: z.string(),
  crc32: z.string().nullable(),
  md5Data: z.string().nullable(),
  sha1Data: z.string().nullable(),
  headerBytesSkipped: z.number().int().nonnegative(),
  firstSeenAt: z.iso.datetime(),
  lastScannedAt: z.iso.datetime(),
  region: z.string().nullable(),
  languages: z.array(z.string()),
  releaseYear: z.number().int().nullable(),
  publisher: z.string().nullable(),
  genre: z.string().nullable(),
  summary: z.string().nullable(),
  datEntry: romDatEntrySchema.nullable(),
})
