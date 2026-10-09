import type { Prisma } from '../generated/prisma/client.js'
import { prisma } from '../lib/prisma.js'

export type ProposalStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED'

export interface CreateProposalInput {
  romId: string
  payload: Prisma.InputJsonValue
  rawResponse: string
  model: string
  promptName: string
  promptVersion: string
  confidence: number
  status: ProposalStatus
  durationMs: number
  promptTokens: number
  completionTokens: number
}

export interface ListProposalsInput {
  userId: string
  status?: ProposalStatus // omitted: every status
  romId?: string // omitted: every ROM of the user
  page: number
  pageSize: number
}

// A proposal along with the ROM it targets (only the file name is needed for display)
const withRom = {
  rom: { select: { id: true, userId: true, fileName: true } },
} as const

// Records an AI proposal; a rejected one is kept too, for audit
export function createProposal(input: CreateProposalInput) {
  return prisma.aiProposal.create({
    data: { kind: 'IDENTIFICATION', ...input },
    include: withRom,
  })
}

// Proposals of one user, newest first: the review queue when filtered by status, the history of a ROM when filtered by `romId`
export async function listProposals(input: ListProposalsInput) {
  const where = {
    kind: 'IDENTIFICATION' as const,
    status: input.status,
    ...(input.romId && { romId: input.romId }),
    rom: { userId: input.userId },
  }

  const [proposals, total] = await Promise.all([
    prisma.aiProposal.findMany({
      where,
      include: withRom,
      orderBy: { createdAt: 'desc' },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
    }),
    prisma.aiProposal.count({ where }),
  ])

  return { proposals, total }
}

export function getProposal(id: string) {
  return prisma.aiProposal.findUnique({ where: { id }, include: withRom })
}

// The single pending proposal of a ROM, if any: a second identification must not pile up
export function findPendingProposalForRom(romId: string) {
  return prisma.aiProposal.findFirst({
    where: { romId, status: 'PENDING' },
  })
}

// Used for a rejection, which changes nothing on the ROM itself
export function updateProposalStatus(
  id: string,
  status: Exclude<ProposalStatus, 'PENDING'>,
  reviewerId: string,
) {
  return prisma.aiProposal.update({
    where: { id },
    data: { status, reviewedAt: new Date(), reviewedById: reviewerId },
  })
}

// Accepting a proposal is the only path that writes an AI result into the ROM.
// Both writes share one transaction: a proposal marked ACCEPTED always comes
// with its ROM updated, and vice versa.
export function applyAcceptedIdentification(
  proposalId: string,
  reviewerId: string,
  romId: string,
  romData: Prisma.RomUncheckedUpdateInput,
) {
  return prisma.$transaction(async (tx) => {
    await tx.aiProposal.update({
      where: { id: proposalId },
      data: {
        status: 'ACCEPTED',
        reviewedAt: new Date(),
        reviewedById: reviewerId,
      },
    })
    return tx.rom.update({ where: { id: romId }, data: romData })
  })
}
