import { z } from 'zod'
import { createPaginatedResponseSchema } from './api.schema.js'
import { identificationSourceSchema } from './rom.schema.js'

// How a collection came to exist
// `DAT_CLONE` covers both deterministic stages (catalog parent/clone link and identical base title)
// `AI` handles the semantic one
export const collectionSourceSchema = z.enum(['DAT_CLONE', 'AI', 'MANUAL'])

export const collectionIdParamsSchema = z.object({ id: z.uuid() })

export const collectionListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
})

// Body of a manual creation
export const collectionCreateSchema = z.object({
  canonicalTitle: z.string().trim().min(1),
  platformId: z.uuid().nullable().optional(),
  romIds: z.array(z.uuid()).default([]),
})

// Body of an update: at least one of the three changes is required
export const collectionUpdateSchema = z
  .object({
    canonicalTitle: z.string().trim().min(1).optional(),
    addRomIds: z.array(z.uuid()).min(1).optional(),
    removeRomIds: z.array(z.uuid()).min(1).optional(),
  })
  .refine(
    (body) =>
      body.canonicalTitle !== undefined ||
      body.addRomIds !== undefined ||
      body.removeRomIds !== undefined,
    { message: 'Nothing to update' },
  )

// Body of a merge: the collection to dissolve into the one named in the URL
export const collectionMergeSchema = z.object({ sourceId: z.uuid() })

// A collection as the list shows it
export const collectionSummarySchema = z.object({
  id: z.string(),
  canonicalTitle: z.string(),
  source: collectionSourceSchema,
  confidence: z.number().nullable(),
  platformId: z.string().nullable(),
  memberCount: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
})

export const collectionListSchema = createPaginatedResponseSchema(
  collectionSummarySchema,
)

export const collectionMemberSchema = z.object({
  romId: z.string(),
  variantLabel: z.string().nullable(),
  fileName: z.string(),
  sizeBytes: z.number(),
  region: z.string().nullable(),
  identificationSource: identificationSourceSchema,
})

// Cosine similarity of two members (1 = identical); each pair appears once
export const memberSimilaritySchema = z.object({
  romA: z.string(),
  romB: z.string(),
  similarity: z.number(),
})

export const collectionDetailSchema = collectionSummarySchema
  .omit({ memberCount: true })
  .extend({
    members: z.array(collectionMemberSchema),
    similarities: z.array(memberSimilaritySchema),
  })

// ROMs holding the same dump: the very same file, or the same data behind a different header
export const duplicateGroupSchema = z.object({
  kind: z.enum(['EXACT_DUPLICATE', 'HEADER_DUPLICATE']),
  label: z.string(),
  roms: z.array(z.object({ id: z.string(), fileName: z.string() })),
})

// Body of an acceptance: the members the reviewer takes out before keeping the collection
export const collectionAcceptSchema = z.object({
  excludeRomIds: z.array(z.uuid()).default([]),
})

// An AI grouping waiting for review: the collection it created, with the model's answer
export const collectionProposalSchema = z.object({
  proposalId: z.string(),
  confidence: z.number(),
  reasoning: z.string(),
  issues: z.array(z.string()),
  model: z.string(),
  promptName: z.string(),
  promptVersion: z.string(),
  createdAt: z.iso.datetime(),
  collection: collectionDetailSchema,
})

export const collectionProposalListSchema = createPaginatedResponseSchema(
  collectionProposalSchema,
)
