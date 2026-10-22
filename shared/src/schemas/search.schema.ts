import { z } from 'zod'
import { paginationSchema } from './api.schema.js'
import { identificationSourceSchema, romSummarySchema } from './rom.schema.js'

export const searchModeSchema = z.enum(['lexical', 'semantic'])

export const romSortSchema = z.enum([
  'fileName',
  'title',
  'releaseYear',
  'sizeBytes',
  'lastScannedAt',
])

// Booleans arrive as "true" / "false" in a query string
export const searchQuerySchema = z
  .object({
    q: z.string().trim().min(1).optional(),
    mode: searchModeSchema.default('lexical'),
    platformId: z.string().optional(),
    identificationSource: identificationSourceSchema.optional(),
    region: z.string().optional(),
    yearMin: z.coerce.number().int().optional(),
    yearMax: z.coerce.number().int().optional(),
    // `collectionId` wins over `inCollection` when both are given
    collectionId: z.uuid().optional(),
    inCollection: z.stringbool().optional(),
    duplicate: z.stringbool().optional(),
    sort: romSortSchema.default('fileName'),
    order: z.enum(['asc', 'desc']).default('asc'),
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().positive().max(100).default(20),
  })
  .refine(
    (query) =>
      query.yearMin === undefined ||
      query.yearMax === undefined ||
      query.yearMin <= query.yearMax,
    { message: 'yearMin must not exceed yearMax', path: ['yearMin'] },
  )
  .refine((query) => query.mode !== 'semantic' || query.q !== undefined, {
    message: 'A semantic search needs a query',
    path: ['q'],
  })

// `score` is the raw cosine similarity (1 = same direction), never filtered
// or rescaled (ADR-010); it is null for a lexical hit
export const searchResultItemSchema = romSummarySchema.extend({
  score: z.number().nullable(),
})

// `degraded` is true when a semantic search fell back to the lexical one
export const searchResultSchema = z.object({
  data: z.array(searchResultItemSchema),
  pagination: paginationSchema,
  mode: searchModeSchema,
  degraded: z.boolean(),
})

export type SearchQuery = z.infer<typeof searchQuerySchema>
export type SearchResult = z.infer<typeof searchResultSchema>
export type RomSortKey = z.infer<typeof romSortSchema>
