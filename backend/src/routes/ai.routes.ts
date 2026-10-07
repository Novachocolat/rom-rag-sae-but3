import { randomUUID } from 'node:crypto'
import {
  aiProposalListQuerySchema,
  proposalReviewSchema,
  romIdentificationSchema,
} from '@repo/shared/schemas'
import type {
  AiProposal,
  AiProposalListQuery,
  Paginated,
  ProposalReview,
} from '@repo/shared/types'
import { Router } from 'express'
import { z } from 'zod'
import { startJob } from '../lib/job-runner.js'
import { requireAuth } from '../middleware/require-auth.middleware.js'
import { validate } from '../middleware/validate.middleware.js'
import {
  identifyStoredRom,
  identifyUnidentifiedRoms,
  reviewProposal,
} from '../service/ai-identification.service.js'
import { listProposals } from '../storage/ai-proposal.storage.js'

export const aiRouter = Router()

const idParamsSchema = z.object({ id: z.uuid() })

// Shape of a proposal row joined with its ROM, as returned by ai-proposal.storage
interface ProposalRow {
  id: string
  romId: string | null
  status: AiProposal['status']
  confidence: number
  payload: unknown
  model: string
  promptName: string
  promptVersion: string
  createdAt: Date
  rom: { fileName: string } | null
}

// Converts a stored proposal to the API shape. The payload is ours, but it is
// parsed anyway so a malformed row cannot leak an untyped object to the client.
function toAiProposal(row: ProposalRow): AiProposal {
  const payload = row.payload as { identification: unknown; issues: string[] }

  return {
    id: row.id,
    romId: row.romId ?? '',
    romFileName: row.rom?.fileName ?? '',
    status: row.status,
    source: 'AI_PROPOSED',
    confidence: row.confidence,
    identification: romIdentificationSchema.parse(payload.identification),
    issues: payload.issues,
    model: row.model,
    promptName: row.promptName,
    promptVersion: row.promptVersion,
    createdAt: row.createdAt.toISOString(),
  }
}

// POST /api/ai/roms/:id/identify: synchronous, one ROM, answers the proposal
aiRouter.post(
  '/ai/roms/:id/identify',
  requireAuth,
  validate({ params: idParamsSchema }),
  async (req, res, next) => {
    try {
      const userId = res.locals.userId as string
      const { id } = req.params as z.infer<typeof idParamsSchema>

      const proposal = await identifyStoredRom(id, userId)
      res.status(200).json({ proposal: toAiProposal(proposal) })
    } catch (err) {
      next(err)
    }
  },
)

// POST /api/ai/roms/identify-batch: every UNIDENTIFIED ROM, as a background job
aiRouter.post('/ai/roms/identify-batch', requireAuth, (_req, res, next) => {
  try {
    const userId = res.locals.userId as string
    const jobId = randomUUID()

    startJob((signal) => identifyUnidentifiedRoms(userId, signal), jobId)

    res.status(202).json({ jobId })
  } catch (err) {
    next(err)
  }
})

// GET /api/ai/proposals: the review queue, filtered by status (PENDING by default)
aiRouter.get(
  '/ai/proposals',
  requireAuth,
  validate({ query: aiProposalListQuerySchema }),
  async (req, res, next) => {
    try {
      const userId = res.locals.userId as string
      const { status, page, pageSize } =
        req.query as unknown as AiProposalListQuery

      const { proposals, total } = await listProposals({
        userId,
        status,
        page,
        pageSize,
      })

      const body: Paginated<AiProposal> = {
        data: proposals.map((row) => toAiProposal(row as ProposalRow)),
        pagination: {
          page,
          pageSize,
          total,
          totalPages: Math.ceil(total / pageSize),
        },
      }

      res.status(200).json(body)
    } catch (err) {
      next(err)
    }
  },
)

// POST /api/ai/proposals/:id/review: accept (optionally corrected) or reject
aiRouter.post(
  '/ai/proposals/:id/review',
  requireAuth,
  validate({ params: idParamsSchema, body: proposalReviewSchema }),
  async (req, res, next) => {
    try {
      const userId = res.locals.userId as string
      const { id } = req.params as z.infer<typeof idParamsSchema>
      const review = req.body as ProposalReview

      const result = await reviewProposal(id, userId, review)
      res.status(200).json(result)
    } catch (err) {
      next(err)
    }
  },
)
