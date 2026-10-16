import type { z } from 'zod'
import type {
  collectionAcceptSchema,
  collectionCreateSchema,
  collectionDetailSchema,
  collectionListQuerySchema,
  collectionMemberSchema,
  collectionMergeSchema,
  collectionProposalSchema,
  collectionSourceSchema,
  collectionSummarySchema,
  collectionUpdateSchema,
  duplicateGroupSchema,
  memberSimilaritySchema,
} from '../schemas/collection.schema.js'

export type CollectionSource = z.infer<typeof collectionSourceSchema>
export type CollectionListQuery = z.infer<typeof collectionListQuerySchema>
export type CollectionCreate = z.infer<typeof collectionCreateSchema>
export type CollectionUpdate = z.infer<typeof collectionUpdateSchema>
export type CollectionMerge = z.infer<typeof collectionMergeSchema>
export type CollectionSummary = z.infer<typeof collectionSummarySchema>
export type CollectionMember = z.infer<typeof collectionMemberSchema>
export type MemberSimilarity = z.infer<typeof memberSimilaritySchema>
export type CollectionDetail = z.infer<typeof collectionDetailSchema>
export type DuplicateGroup = z.infer<typeof duplicateGroupSchema>
export type CollectionAccept = z.infer<typeof collectionAcceptSchema>
export type CollectionProposal = z.infer<typeof collectionProposalSchema>
