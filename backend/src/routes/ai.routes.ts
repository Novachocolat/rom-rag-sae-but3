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
import {
  backfillEmbeddings,
  getEmbeddingStatus,
} from '../service/embedding.service.js'
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
  durationMs: number | null
  createdAt: Date
  reviewedAt: Date | null
  rom: { fileName: string } | null
}

// What the identification prompt stored with its proposal
// The metrics are optional: rows saved before they were recorded lack them
const identificationPayloadSchema = z.object({
  identification: romIdentificationSchema,
  issues: z.array(z.string()),
  tokensPerSecond: z.number().optional(),
  fromCache: z.boolean().optional(),
})

// Converts a stored proposal to the API shape. The payload is ours, but it is
// parsed anyway so a malformed row cannot leak an untyped object to the client.
function toAiProposal(row: ProposalRow): AiProposal {
  const payload = identificationPayloadSchema.parse(row.payload)

  return {
    id: row.id,
    romId: row.romId ?? '',
    romFileName: row.rom?.fileName ?? '',
    status: row.status,
    source: 'AI_PROPOSED',
    confidence: row.confidence,
    identification: payload.identification,
    issues: payload.issues,
    model: row.model,
    promptName: row.promptName,
    promptVersion: row.promptVersion,
    // `durationMs` is a column of the row, the other metrics live in its payload
    inference: {
      durationMs: row.durationMs,
      tokensPerSecond: payload.tokensPerSecond ?? null,
      fromCache: payload.fromCache ?? null,
    },
    createdAt: row.createdAt.toISOString(),
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
  }
}

/**
 * @openapi
 * /ai/roms/{id}/identify:
 *   post:
 *     tags: [AI]
 *     summary: Asks the LLM to identify one ROM (synchronous, can take a while)
 *     description: The answer is a proposal waiting for review, never a confirmed identification.
 *     security: [{ sessionCookie: [] }]
 *     parameters:
 *       - $ref: '#/components/parameters/IdPath'
 *     responses:
 *       200:
 *         description: The proposal created for the ROM
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required: [proposal]
 *               properties:
 *                 proposal: { $ref: '#/components/schemas/AiProposal' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       409: { $ref: '#/components/responses/Conflict' }
 *       502: { $ref: '#/components/responses/OllamaError' }
 *       503: { $ref: '#/components/responses/OllamaError' }
 *       504: { $ref: '#/components/responses/OllamaError' }
 */
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

/**
 * @openapi
 * /ai/roms/identify-batch:
 *   post:
 *     tags: [AI]
 *     summary: Identifies every UNIDENTIFIED ROM of the user as a background job
 *     security: [{ sessionCookie: [] }]
 *     responses:
 *       202:
 *         description: Job started, proposals appear in GET /ai/proposals
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/JobAccepted' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
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

/**
 * @openapi
 * /ai/proposals:
 *   get:
 *     tags: [AI]
 *     summary: The identification proposals, PENDING ones by default
 *     security: [{ sessionCookie: [] }]
 *     parameters:
 *       - in: query
 *         name: status
 *         description: ALL lifts the status filter
 *         schema:
 *           type: string
 *           enum: [PENDING, ACCEPTED, REJECTED, ALL]
 *           default: PENDING
 *       - in: query
 *         name: romId
 *         description: Narrows the list to one ROM
 *         schema: { type: string, format: uuid }
 *       - $ref: '#/components/parameters/Page'
 *       - $ref: '#/components/parameters/PageSize'
 *     responses:
 *       200:
 *         description: One page of proposals
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/AiProposalPage' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
// GET /api/ai/proposals: the review queue, filtered by status (PENDING by default)
// `romId` narrows it to one ROM and `status=ALL` lifts the status filter, which together give the proposal history of a ROM
aiRouter.get(
  '/ai/proposals',
  requireAuth,
  validate({ query: aiProposalListQuerySchema }),
  async (req, res, next) => {
    try {
      const userId = res.locals.userId as string
      const { status, romId, page, pageSize } =
        req.query as unknown as AiProposalListQuery

      const { proposals, total } = await listProposals({
        userId,
        status: status === 'ALL' ? undefined : status,
        romId,
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

/**
 * @openapi
 * /ai/proposals/{id}/review:
 *   post:
 *     tags: [AI]
 *     summary: Accepts (optionally corrected) or rejects a proposal
 *     security: [{ sessionCookie: [] }]
 *     parameters:
 *       - $ref: '#/components/parameters/IdPath'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/ProposalReviewRequest' }
 *           example: { action: accept, corrections: { region: Europe } }
 *     responses:
 *       200:
 *         description: The proposal status after the review
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ProposalReviewResult' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       409:
 *         description: The proposal was already reviewed
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ApiError' }
 */
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

/**
 * @openapi
 * /ai/embeddings/backfill:
 *   post:
 *     tags: [AI]
 *     summary: Vectorizes every ROM without an embedding as a background job
 *     security: [{ sessionCookie: [] }]
 *     responses:
 *       202:
 *         description: Job started, follow it with GET /ai/embeddings/status
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/JobAccepted' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
// POST /api/ai/embeddings/backfill: vectorizes every ROM without a vector, as a background job
aiRouter.post('/ai/embeddings/backfill', requireAuth, (_req, res, next) => {
  try {
    const userId = res.locals.userId as string
    const jobId = randomUUID()
    startJob((signal) => backfillEmbeddings(userId, signal), jobId)

    res.status(202).json({ jobId })
  } catch (err) {
    next(err)
  }
})

/**
 * @openapi
 * /ai/embeddings/status:
 *   get:
 *     tags: [AI]
 *     summary: How many of the user's ROMs have an embedding (backfill progress)
 *     security: [{ sessionCookie: [] }]
 *     responses:
 *       200:
 *         description: Embedding counts
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/EmbeddingStatus' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
// GET /api/ai/embeddings/status: how many ROMs have a vector, which is the backfill progress
aiRouter.get('/ai/embeddings/status', requireAuth, async (_req, res, next) => {
  try {
    const userId = res.locals.userId as string
    res.status(200).json(await getEmbeddingStatus(userId))
  } catch (err) {
    next(err)
  }
})
