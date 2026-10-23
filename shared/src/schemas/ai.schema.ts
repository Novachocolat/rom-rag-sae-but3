import { z } from 'zod'

// Every key is required and nullable on purpose: an optional key lets the model
// omit it, a nullable one forces it to take a position
export const romIdentificationSchema = z.object({
  title: z.string().nullable(),
  platform: z.string().nullable(),
  region: z.string().nullable(),
  languages: z.array(z.string()),
  releaseYear: z.number().int().nullable(),
  publisher: z.string().nullable(),
  genre: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
})

export const aiProposalStatusSchema = z.enum([
  'PENDING',
  'ACCEPTED',
  'REJECTED',
])

// Fields a reviewer may override before accepting; confidence and reasoning
// describe the model's own answer, so they can't be corrected
export const proposalCorrectionsSchema = romIdentificationSchema
  .omit({ confidence: true, reasoning: true })
  .partial()

export const proposalReviewSchema = z
  .object({
    action: z.enum(['accept', 'reject']),
    corrections: proposalCorrectionsSchema.optional(),
  })
  .refine((review) => review.action === 'accept' || !review.corrections, {
    message: 'corrections can only accompany an accept',
    path: ['corrections'],
  })

// What producing a proposal cost; null on rows saved before it was recorded
export const inferenceStatsSchema = z.object({
  durationMs: z.number().nullable(),
  tokensPerSecond: z.number().nullable(),
  fromCache: z.boolean().nullable(),
})

// A proposal as the review queue shows it. `source` is the label the UI
// displays: a proposal is never a confirmed identification.
export const aiProposalSchema = z.object({
  id: z.string(),
  romId: z.string(),
  romFileName: z.string(),
  status: aiProposalStatusSchema,
  source: z.literal('AI_PROPOSED'),
  confidence: z.number(),
  identification: romIdentificationSchema,
  issues: z.array(z.string()),
  model: z.string(),
  promptName: z.string(),
  promptVersion: z.string(),
  inference: inferenceStatsSchema,
  createdAt: z.iso.datetime(),
  reviewedAt: z.iso.datetime().nullable(), // Null until a user reviews it
})

// 'ALL' lifts the status filter, for the proposal history of a ROM
export const aiProposalStatusFilterSchema = z.enum([
  ...aiProposalStatusSchema.options,
  'ALL',
])

export const aiProposalListQuerySchema = z.object({
  status: aiProposalStatusFilterSchema.default('PENDING'),
  romId: z.uuid().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
})

// `belongs` lets the model remove a ROM from the cluster; without it the
// model could only confirm what clustering already decided
export const collectionGroupingSchema = z.object({
  sameGame: z.boolean(),
  canonicalTitle: z.string(),
  members: z.array(
    z.object({
      romId: z.string(),
      variantLabel: z.string().nullable(),
      belongs: z.boolean(),
    }),
  ),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
})
