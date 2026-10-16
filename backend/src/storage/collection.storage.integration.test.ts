import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../lib/prisma.js'
import {
  createCollection,
  deleteCollection,
  getCollectionWithRoms,
  listRomsForGrouping,
  mergeCollections,
  updateCollection,
} from './collection.storage.js'

// Needs a migrated PostgreSQL (`docker compose up -d postgres`); opt-in, like
// the other database integration tests
const enabled = process.env.RUN_DB_INTEGRATION === '1'

let userId: string
let otherUserId: string
const romIds: string[] = []

async function createRom(name: string, owner: string): Promise<string> {
  const rom = await prisma.rom.create({
    data: {
      userId: owner,
      relativePath: `${name}-${randomUUID()}.gb`,
      fileName: `${name}.gb`,
      extension: '.gb',
      sizeBytes: 1024n,
      md5: 'a'.repeat(32),
      sha1: 'b'.repeat(40),
      identificationSource: 'UNIDENTIFIED',
    },
  })
  romIds.push(rom.id)
  return rom.id
}

async function memberIds(collectionId: string): Promise<string[]> {
  const collection = await getCollectionWithRoms(userId, collectionId)
  return collection.members.map((member) => member.romId).sort()
}

// Runs the real queries and transactions of the storage against PostgreSQL
describe.skipIf(!enabled)('collection.storage on PostgreSQL', () => {
  beforeAll(async () => {
    const users = await Promise.all(
      [0, 1].map(() =>
        prisma.user.create({
          data: {
            email: `collection-grouping-${randomUUID()}@example.com`,
            passwordHash: 'irrelevant',
          },
        }),
      ),
    )
    userId = users[0]?.id ?? ''
    otherUserId = users[1]?.id ?? ''
  })

  // Children first: foreign keys forbid deleting a row still referenced
  afterEach(async () => {
    const owners = { userId: { in: [userId, otherUserId] } }
    await prisma.aiProposal.deleteMany({
      where: {
        OR: [{ collection: owners }, { reviewedById: userId }],
      },
    })
    await prisma.collectionMember.deleteMany({ where: { collection: owners } })
    await prisma.collection.deleteMany({ where: owners })
    await prisma.rom.deleteMany({ where: { id: { in: romIds } } })
    romIds.length = 0
  })

  afterAll(async () => {
    await prisma.user.deleteMany({
      where: { id: { in: [userId, otherUserId] } },
    })
    await prisma.$disconnect()
  })

  describe('listRomsForGrouping', () => {
    it('returns the user ROMs with null catalog ids when none is matched', async () => {
      const a = await createRom('a', userId)
      await createRom('foreign', otherUserId)

      const roms = await listRomsForGrouping(userId)

      expect(roms.map((rom) => rom.id)).toEqual([a])
      expect(roms[0]?.title).toBeNull()
      expect(roms[0]?.gameExternalId).toBeNull()
      expect(roms[0]?.cloneOfId).toBeNull()
    })

    it('leaves out ROMs already in a collection with onlyUngrouped', async () => {
      const grouped = await createRom('grouped', userId)
      const free = await createRom('free', userId)
      await createCollection({
        userId,
        canonicalTitle: 'game',
        source: 'MANUAL',
        members: [{ romId: grouped }],
      })

      const ungrouped = await listRomsForGrouping(userId, {
        onlyUngrouped: true,
      })
      const all = await listRomsForGrouping(userId)

      expect(ungrouped.map((rom) => rom.id)).toEqual([free])
      expect(all).toHaveLength(2)
    })
  })

  describe('createCollection', () => {
    it('refuses a ROM owned by someone else', async () => {
      const foreign = await createRom('foreign', otherUserId)

      await expect(
        createCollection({
          userId,
          canonicalTitle: 'stolen',
          source: 'MANUAL',
          members: [{ romId: foreign }],
        }),
      ).rejects.toMatchObject({ statusCode: 404, code: 'ROM_NOT_FOUND' })
    })

    it('answers 404 for a platform that does not exist', async () => {
      await expect(
        createCollection({
          userId,
          canonicalTitle: 'game',
          platformId: randomUUID(),
          source: 'MANUAL',
        }),
      ).rejects.toMatchObject({ statusCode: 404, code: 'PLATFORM_NOT_FOUND' })
    })
  })

  describe('updateCollection', () => {
    it('renames, adds and removes members together', async () => {
      const a = await createRom('a', userId)
      const b = await createRom('b', userId)
      const collection = await createCollection({
        userId,
        canonicalTitle: 'old',
        source: 'MANUAL',
        members: [{ romId: a }],
      })

      await updateCollection(userId, collection.id, {
        canonicalTitle: 'new',
        addRomIds: [b],
        removeRomIds: [a],
      })

      const updated = await getCollectionWithRoms(userId, collection.id)
      expect(updated.canonicalTitle).toBe('new')
      expect(await memberIds(collection.id)).toEqual([b])
    })

    it('rolls everything back when a ROM to remove is not a member', async () => {
      const a = await createRom('a', userId)
      const b = await createRom('b', userId)
      const stranger = await createRom('stranger', userId)
      const collection = await createCollection({
        userId,
        canonicalTitle: 'old',
        source: 'MANUAL',
        members: [{ romId: a }],
      })

      await expect(
        updateCollection(userId, collection.id, {
          canonicalTitle: 'new',
          addRomIds: [b],
          removeRomIds: [stranger],
        }),
      ).rejects.toMatchObject({ code: 'COLLECTION_MEMBER_NOT_FOUND' })

      const untouched = await getCollectionWithRoms(userId, collection.id)
      expect(untouched.canonicalTitle).toBe('old')
      expect(await memberIds(collection.id)).toEqual([a])
    })

    it('refuses to add a ROM owned by someone else', async () => {
      const foreign = await createRom('foreign', otherUserId)
      const collection = await createCollection({
        userId,
        canonicalTitle: 'mine',
        source: 'MANUAL',
      })

      await expect(
        updateCollection(userId, collection.id, { addRomIds: [foreign] }),
      ).rejects.toMatchObject({ code: 'ROM_NOT_FOUND' })
    })
  })

  describe('mergeCollections', () => {
    it('moves the members into the target and dissolves the source', async () => {
      const a = await createRom('a', userId)
      const b = await createRom('b', userId)
      const target = await createCollection({
        userId,
        canonicalTitle: 'target',
        source: 'MANUAL',
        members: [{ romId: a }],
      })
      const source = await createCollection({
        userId,
        canonicalTitle: 'source',
        source: 'MANUAL',
        members: [{ romId: a }, { romId: b }],
      })

      await mergeCollections(userId, target.id, source.id)

      expect(await memberIds(target.id)).toEqual([a, b].sort())
      await expect(
        getCollectionWithRoms(userId, source.id),
      ).rejects.toMatchObject({ code: 'COLLECTION_NOT_FOUND' })
    })
  })

  describe('deleteCollection', () => {
    it('keeps the ROMs and closes the pending AI proposal as rejected', async () => {
      const a = await createRom('a', userId)
      const collection = await createCollection({
        userId,
        canonicalTitle: 'ai made',
        source: 'AI',
        members: [{ romId: a }],
      })
      const proposal = await prisma.aiProposal.create({
        data: {
          kind: 'GROUPING',
          collectionId: collection.id,
          payload: {},
          model: 'test-model',
          promptName: 'grouping',
          promptVersion: 'v1',
          confidence: 0.9,
          status: 'PENDING',
        },
      })

      await deleteCollection(userId, collection.id)

      const closed = await prisma.aiProposal.findUnique({
        where: { id: proposal.id },
      })
      expect(closed?.status).toBe('REJECTED')
      expect(closed?.collectionId).toBeNull()
      expect(closed?.reviewedById).toBe(userId)
      expect(await prisma.rom.count({ where: { id: a } })).toBe(1)
    })
  })
})
