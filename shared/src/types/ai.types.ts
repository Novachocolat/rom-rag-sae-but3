import type { z } from 'zod'
import type {
  aiProposalListQuerySchema,
  aiProposalSchema,
  aiProposalStatusSchema,
  proposalCorrectionsSchema,
  proposalReviewSchema,
  romIdentificationSchema,
} from '../schemas/ai.schema.js'

export type RomIdentification = z.infer<typeof romIdentificationSchema>
export type AiProposalStatus = z.infer<typeof aiProposalStatusSchema>
export type AiProposal = z.infer<typeof aiProposalSchema>
export type ProposalCorrections = z.infer<typeof proposalCorrectionsSchema>
export type ProposalReview = z.infer<typeof proposalReviewSchema>
export type AiProposalListQuery = z.infer<typeof aiProposalListQuerySchema>
