import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '../lib/prisma.js'
import {
  applyAcceptedIdentification,
  createProposal,
  findPendingProposalForRom,
  getProposal,
  listProposals,
  updateProposalStatus,
} from './ai-proposal.storage.js'

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    aiProposal: {
      create: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    rom: { update: vi.fn() },
    $transaction: vi.fn(),
  },
}))

// Tests for the AI proposal storage, which must never touch a ROM except on accept
describe('ai-proposal.storage', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('createProposal stores an IDENTIFICATION proposal', async () => {
    const input = {
      romId: 'rom-1',
      payload: { source: 'AI_PROPOSED' },
      rawResponse: '{}',
      model: 'gemma4:26b',
      promptName: 'identification',
      promptVersion: 'v1',
      confidence: 0.9,
      status: 'PENDING' as const,
      durationMs: 1200,
      promptTokens: 300,
      completionTokens: 80,
    }

    await createProposal(input)

    expect(prisma.aiProposal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { kind: 'IDENTIFICATION', ...input },
      }),
    )
  })

  it('listProposals scopes the query to the user and the requested status', async () => {
    vi.mocked(prisma.aiProposal.findMany).mockResolvedValue([])
    vi.mocked(prisma.aiProposal.count).mockResolvedValue(0)

    await listProposals({
      userId: 'user-1',
      status: 'PENDING',
      page: 2,
      pageSize: 10,
    })

    const expectedWhere = {
      kind: 'IDENTIFICATION',
      status: 'PENDING',
      rom: { userId: 'user-1' },
    }
    expect(prisma.aiProposal.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expectedWhere, skip: 10, take: 10 }),
    )
    expect(prisma.aiProposal.count).toHaveBeenCalledWith({
      where: expectedWhere,
    })
  })

  it('listProposals returns every status of one ROM when no status is given', async () => {
    vi.mocked(prisma.aiProposal.findMany).mockResolvedValue([])
    vi.mocked(prisma.aiProposal.count).mockResolvedValue(0)

    await listProposals({
      userId: 'user-1',
      romId: 'rom-1',
      page: 1,
      pageSize: 20,
    })

    const expectedWhere = {
      kind: 'IDENTIFICATION',
      romId: 'rom-1',
      rom: { userId: 'user-1' },
    }
    expect(prisma.aiProposal.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expectedWhere }),
    )
    expect(prisma.aiProposal.count).toHaveBeenCalledWith({
      where: expectedWhere,
    })
  })

  it('getProposal looks a proposal up with its ROM', async () => {
    await getProposal('prop-1')

    expect(prisma.aiProposal.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'prop-1' } }),
    )
  })

  it('findPendingProposalForRom only considers PENDING proposals', async () => {
    await findPendingProposalForRom('rom-1')

    expect(prisma.aiProposal.findFirst).toHaveBeenCalledWith({
      where: { romId: 'rom-1', status: 'PENDING' },
    })
  })

  it('updateProposalStatus records the reviewer and the review date', async () => {
    await updateProposalStatus('prop-1', 'REJECTED', 'user-1')

    expect(prisma.aiProposal.update).toHaveBeenCalledWith({
      where: { id: 'prop-1' },
      data: expect.objectContaining({
        status: 'REJECTED',
        reviewedById: 'user-1',
        reviewedAt: expect.any(Date),
      }),
    })
  })

  it('applyAcceptedIdentification updates the proposal and the ROM in one transaction', async () => {
    const tx = {
      aiProposal: { update: vi.fn().mockResolvedValue({}) },
      rom: { update: vi.fn().mockResolvedValue({ id: 'rom-1' }) },
    }
    vi.mocked(prisma.$transaction).mockImplementation(((
      callback: (t: typeof tx) => unknown,
    ) => callback(tx)) as never)

    await applyAcceptedIdentification('prop-1', 'user-1', 'rom-1', {
      title: 'Tetris',
      identificationSource: 'USER_CONFIRMED',
    })

    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(tx.aiProposal.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'prop-1' },
        data: expect.objectContaining({
          status: 'ACCEPTED',
          reviewedById: 'user-1',
        }),
      }),
    )
    expect(tx.rom.update).toHaveBeenCalledWith({
      where: { id: 'rom-1' },
      data: { title: 'Tetris', identificationSource: 'USER_CONFIRMED' },
    })
  })
})
