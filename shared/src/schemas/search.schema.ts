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

// Keeps the year inside the int4 `releaseYear` column and a plausible range
const YEAR_MIN = 1950
const YEAR_MAX = 2100

// Bounds the SQL offset: 10 000 pages of 100 is far beyond any library
const PAGE_MAX = 10_000

// A search form sends its empty fields as `?key=`: they mean "not set",
// so they are never coerced (an empty yearMin would become 0)
function blankAsUnset<T extends z.ZodType>(schema: T) {
  return z.preprocess(
    (value) =>
      typeof value === 'string' && value.trim() === '' ? undefined : value,
    schema,
  )
}

const yearSchema = z.coerce.number().int().min(YEAR_MIN).max(YEAR_MAX)

/**
 * Booleans arrive as "true" / "false" in a query string.
 * A semantic search ranks by cosine score: it keeps at most the 100 nearest
 * ROMs among those matching the filters, so `total` is capped at 100 and
 * `sort` / `order` only apply to a lexical search.
 */
export const searchQuerySchema = z
  .object({
    q: blankAsUnset(z.string().trim().optional()),
    mode: blankAsUnset(searchModeSchema.default('lexical')),
    platformId: blankAsUnset(z.uuid().optional()),
    identificationSource: blankAsUnset(identificationSourceSchema.optional()),
    region: blankAsUnset(z.string().optional()),
    yearMin: blankAsUnset(yearSchema.optional()),
    yearMax: blankAsUnset(yearSchema.optional()),
    collectionId: blankAsUnset(z.uuid().optional()),
    inCollection: blankAsUnset(z.stringbool().optional()),
    duplicate: blankAsUnset(z.stringbool().optional()),
    sort: blankAsUnset(romSortSchema.default('fileName')),
    order: blankAsUnset(z.enum(['asc', 'desc']).default('asc')),
    page: blankAsUnset(
      z.coerce.number().int().positive().max(PAGE_MAX).default(1),
    ),
    pageSize: blankAsUnset(
      z.coerce.number().int().positive().max(100).default(20),
    ),
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
  .refine(
    (query) =>
      query.collectionId === undefined || query.inCollection === undefined,
    {
      message: 'collectionId and inCollection cannot be combined',
      path: ['inCollection'],
    },
  )

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
export type SearchMode = z.infer<typeof searchModeSchema>
export type RomSortKey = z.infer<typeof romSortSchema>
