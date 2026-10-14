import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '../lib/prisma.js'
import {
  createCollection,
  deleteCollection,
  getCollectionWithRoms,
  listCollections,
  listRomsForGrouping,
  mergeCollections,
  updateCollection,
  acceptCollection,
  listPendingGroupingProposals,
} from './collection.storage.js'

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    collection: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    collectionMember: {
      createMany: vi.fn(),
      deleteMany: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    aiProposal: { updateMany: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    rom: { count: vi.fn(), findMany: vi.fn() },
    platform: { count: vi.fn() },
    $transaction: vi.fn(),
  },
}))

// An interactive transaction receives a client: the mocked one stands in for it
function runTransactions(): void {
  vi.mocked(prisma.$transaction).mockImplementation(((arg: unknown) =>
    typeof arg === 'function'
      ? (arg as (tx: typeof prisma) => Promise<unknown>)(prisma)
      : Promise.resolve(arg)) as never)
}

function ownCollection(): void {
  vi.mocked(prisma.collection.findFirst).mockResolvedValue({
    id: 'c1',
    userId: 'user-1',
  } as never)
}

// Unit tests with a mocked Prisma client; the real queries are exercised by
// collection.storage.integration.test.ts
describe('collection.storage', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    runTransactions()
  })

  describe('createCollection', () => {
    it('creates the collection with each ROM once', async () => {
      vi.mocked(prisma.rom.count).mockResolvedValue(2)

      await createCollection({
        userId: 'user-1',
        canonicalTitle: 'Tetris',
        source: 'MANUAL',
        members: [
          { romId: 'a' },
          { romId: 'b', variantLabel: 'Europe' },
          { romId: 'a', variantLabel: 'USA' },
        ],
      })

      expect(prisma.rom.count).toHaveBeenCalledWith({
        where: { id: { in: ['a', 'b'] }, userId: 'user-1' },
      })
      expect(prisma.collection.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-1',
            canonicalTitle: 'Tetris',
            source: 'MANUAL',
            members: {
              create: [
                { romId: 'a', variantLabel: 'USA' },
                { romId: 'b', variantLabel: 'Europe' },
              ],
            },
          }),
        }),
      )
    })

    it('refuses a ROM that is not the user own', async () => {
      vi.mocked(prisma.rom.count).mockResolvedValue(1)

      await expect(
        createCollection({
          userId: 'user-1',
          canonicalTitle: 'Tetris',
          source: 'MANUAL',
          members: [{ romId: 'a' }, { romId: 'foreign' }],
        }),
      ).rejects.toMatchObject({ statusCode: 404, code: 'ROM_NOT_FOUND' })
      expect(prisma.collection.create).not.toHaveBeenCalled()
    })

    it('answers 404 instead of a foreign key error for an unknown platform', async () => {
      vi.mocked(prisma.platform.count).mockResolvedValue(0)

      await expect(
        createCollection({
          userId: 'user-1',
          canonicalTitle: 'Tetris',
          platformId: 'ghost',
          source: 'MANUAL',
        }),
      ).rejects.toMatchObject({ statusCode: 404, code: 'PLATFORM_NOT_FOUND' })
      expect(prisma.collection.create).not.toHaveBeenCalled()
    })
  })

  describe('listCollections', () => {
    it('pages the collections of the user, newest first', async () => {
      vi.mocked(prisma.collection.findMany).mockResolvedValue([])
      vi.mocked(prisma.collection.count).mockResolvedValue(0)

      await listCollections({ userId: 'user-1', page: 3, pageSize: 10 })

      expect(prisma.collection.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1' },
          orderBy: { createdAt: 'desc' },
          skip: 20,
          take: 10,
        }),
      )
    })
  })

  describe('getCollectionWithRoms', () => {
    it('answers 404 for a collection of someone else', async () => {
      vi.mocked(prisma.collection.findFirst).mockResolvedValue(null)

      await expect(getCollectionWithRoms('user-1', 'c1')).rejects.toMatchObject(
        { statusCode: 404, code: 'COLLECTION_NOT_FOUND' },
      )
      expect(prisma.collection.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'c1', userId: 'user-1' } }),
      )
    })
  })

  describe('updateCollection', () => {
    it('renames, adds and removes inside one transaction', async () => {
      ownCollection()
      vi.mocked(prisma.rom.count).mockResolvedValue(1)
      vi.mocked(prisma.collectionMember.deleteMany).mockResolvedValue({
        count: 1,
      })

      await updateCollection('user-1', 'c1', {
        canonicalTitle: 'New',
        addRomIds: ['b', 'b'],
        removeRomIds: ['a'],
      })

      expect(prisma.$transaction).toHaveBeenCalledTimes(1)
      expect(prisma.collection.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { canonicalTitle: 'New' },
      })
      expect(prisma.collectionMember.createMany).toHaveBeenCalledWith({
        data: [{ collectionId: 'c1', romId: 'b' }],
        skipDuplicates: true,
      })
      expect(prisma.collectionMember.deleteMany).toHaveBeenCalledWith({
        where: { collectionId: 'c1', romId: { in: ['a'] } },
      })
    })

    it('fails the transaction when a ROM to remove is not a member', async () => {
      ownCollection()
      vi.mocked(prisma.collectionMember.deleteMany).mockResolvedValue({
        count: 0,
      })

      await expect(
        updateCollection('user-1', 'c1', { removeRomIds: ['a'] }),
      ).rejects.toMatchObject({
        statusCode: 404,
        code: 'COLLECTION_MEMBER_NOT_FOUND',
      })
    })

    it('writes nothing for a collection of someone else', async () => {
      vi.mocked(prisma.collection.findFirst).mockResolvedValue(null)

      await expect(
        updateCollection('user-1', 'c1', { canonicalTitle: 'New' }),
      ).rejects.toMatchObject({ code: 'COLLECTION_NOT_FOUND' })
      expect(prisma.$transaction).not.toHaveBeenCalled()
    })
  })

  describe('mergeCollections', () => {
    it('refuses to merge a collection into itself', async () => {
      await expect(
        mergeCollections('user-1', 'c1', 'c1'),
      ).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_MERGE' })
    })

    it('moves members and proposals, then deletes the source', async () => {
      ownCollection()
      vi.mocked(prisma.collectionMember.findMany).mockResolvedValue([
        { collectionId: 'c2', romId: 'a', variantLabel: 'USA' },
      ])

      await mergeCollections('user-1', 'c1', 'c2')

      expect(prisma.collectionMember.createMany).toHaveBeenCalledWith({
        data: [{ collectionId: 'c1', romId: 'a', variantLabel: 'USA' }],
        skipDuplicates: true,
      })
      expect(prisma.aiProposal.updateMany).toHaveBeenCalledWith({
        where: { collectionId: 'c2' },
        data: { collectionId: 'c1' },
      })
      expect(prisma.collection.delete).toHaveBeenCalledWith({
        where: { id: 'c2' },
      })
    })
  })

  describe('deleteCollection', () => {
    it('closes the pending proposal as rejected before deleting', async () => {
      ownCollection()

      await deleteCollection('user-1', 'c1')

      expect(prisma.aiProposal.updateMany).toHaveBeenNthCalledWith(1, {
        where: { collectionId: 'c1', status: 'PENDING' },
        data: expect.objectContaining({
          status: 'REJECTED',
          reviewedById: 'user-1',
        }),
      })
      expect(prisma.aiProposal.updateMany).toHaveBeenNthCalledWith(2, {
        where: { collectionId: 'c1' },
        data: { collectionId: null },
      })
      expect(prisma.collection.delete).toHaveBeenCalledWith({
        where: { id: 'c1' },
      })
    })
  })

  describe('listRomsForGrouping', () => {
    it('flattens the DAT ids and filters grouped ROMs on demand', async () => {
      vi.mocked(prisma.rom.findMany).mockResolvedValue([
        {
          id: 'a',
          fileName: 'a.gb',
          title: 'A',
          platformId: 'p1',
          sha1: 's',
          sha1Data: null,
          datEntry: { gameExternalId: '0002', cloneOfId: '0001' },
        },
        {
          id: 'b',
          fileName: 'b.gb',
          title: null,
          platformId: null,
          sha1: 't',
          sha1Data: null,
          datEntry: null,
        },
      ] as never)

      const rows = await listRomsForGrouping('user-1', { onlyUngrouped: true })

      expect(rows[0]).toMatchObject({
        id: 'a',
        title: 'A',
        gameExternalId: '0002',
        cloneOfId: '0001',
      })
      expect(rows[0]).not.toHaveProperty('datEntry')
      expect(rows[1]).toMatchObject({ gameExternalId: null, cloneOfId: null })
      expect(prisma.rom.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1', collectionMembers: { none: {} } },
        }),
      )
    })
  })

  describe('listPendingGroupingProposals', () => {
    it('lists the pending GROUPING proposals of the user, newest first', async () => {
      vi.mocked(prisma.aiProposal.findMany).mockResolvedValue([])
      vi.mocked(prisma.aiProposal.count).mockResolvedValue(0)

      const result = await listPendingGroupingProposals({
        userId: 'user-1',
        page: 2,
        pageSize: 10,
      })

      expect(result).toEqual({ proposals: [], total: 0 })
      expect(prisma.aiProposal.findMany).toHaveBeenCalledWith({
        where: {
          kind: 'GROUPING',
          status: 'PENDING',
          collection: { userId: 'user-1' },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: 10,
        take: 10,
      })
    })
  })

  describe('acceptCollection', () => {
    beforeEach(() => {
      ownCollection()
      vi.mocked(prisma.aiProposal.updateMany).mockResolvedValue({ count: 1 })
      vi.mocked(prisma.collectionMember.deleteMany).mockResolvedValue({
        count: 1,
      })
      vi.mocked(prisma.collectionMember.count).mockResolvedValue(2)
    })

    it('closes the pending proposal as accepted and drops the excluded members', async () => {
      await acceptCollection('user-1', 'c1', ['r3'])

      expect(prisma.aiProposal.updateMany).toHaveBeenCalledWith({
        where: { collectionId: 'c1', kind: 'GROUPING', status: 'PENDING' },
        data: expect.objectContaining({
          status: 'ACCEPTED',
          reviewedById: 'user-1',
        }),
      })
      expect(prisma.collectionMember.deleteMany).toHaveBeenCalledWith({
        where: { collectionId: 'c1', romId: { in: ['r3'] } },
      })
    })

    it('removes nobody when nothing is excluded', async () => {
      await acceptCollection('user-1', 'c1', [])

      expect(prisma.collectionMember.deleteMany).not.toHaveBeenCalled()
    })

    it('refuses a collection that has no pending proposal', async () => {
      vi.mocked(prisma.aiProposal.updateMany).mockResolvedValue({ count: 0 })

      await expect(acceptCollection('user-1', 'c1', [])).rejects.toMatchObject({
        code: 'NO_PENDING_PROPOSAL',
      })
    })

    it('refuses an excluded ROM that is not a member', async () => {
      vi.mocked(prisma.collectionMember.deleteMany).mockResolvedValue({
        count: 0,
      })

      await expect(
        acceptCollection('user-1', 'c1', ['ghost']),
      ).rejects.toMatchObject({ code: 'COLLECTION_MEMBER_NOT_FOUND' })
    })

    it('refuses to leave fewer than two members', async () => {
      vi.mocked(prisma.collectionMember.count).mockResolvedValue(1)

      await expect(
        acceptCollection('user-1', 'c1', ['r3']),
      ).rejects.toMatchObject({ code: 'COLLECTION_TOO_SMALL' })
    })
  })
})
