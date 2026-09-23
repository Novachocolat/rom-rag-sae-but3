import { z } from 'zod'

// Normalizes strings in small caps for hashes
const hashSchema = z.string().transform((val) => val.toLowerCase())

export const datRomSchema = z.object({
  name: z.string(),
  // BigInt to ensure massive files go through
  size: z
    .string()
    .regex(/^\d+$/, 'size doit être un entier positif')
    .transform((val) => BigInt(val)),
  crc: hashSchema.optional(),
  md5: hashSchema.optional(),
  sha1: hashSchema.optional(),
  sha256: hashSchema.optional(),
  status: z.string().optional(), // e.g. "verified", "baddump"
})

export const datGameSchema = z.object({
  id: z.string(), // Internal No-Intro ID for `gameExternalId`
  name: z.string(),
  description: z.string().optional(),
  cloneofid: z.string().optional(), // Always as a string
  // Must always be an array even with only one category
  category: z.preprocess((val) => {
    if (val === undefined || val === null || val === '') return []
    return Array.isArray(val) ? val : [val]
  }, z.array(z.string())),
  // Must always be an array even with only one rom
  rom: z.preprocess((val) => {
    if (!val) return []
    return Array.isArray(val) ? val : [val]
  }, z.array(datRomSchema)),
})

export const datHeaderSchema = z.object({
  name: z.string(), // Matches the platform's slug
  description: z.string().optional(),
  version: z.string().optional(),
  homepage: z.string().optional(),
})

// Global validation schema for any .dat file
export const datFileSummarySchema = z.object({
  datafile: z.object({
    header: datHeaderSchema,
    game: z.preprocess((val) => {
      if (!val) return []
      return Array.isArray(val) ? val : [val]
    }, z.array(datGameSchema)),
  }),
})
