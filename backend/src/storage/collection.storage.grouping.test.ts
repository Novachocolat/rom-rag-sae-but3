import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../lib/prisma.js'
import {
  addMembers,
  createCollection,
  findNeighbors,
  getMemberSimilarities,
  listRomsForGrouping,
} from './collection.storage.js'

// Integration tests: need `docker compose up -d postgres`

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

// A 768-dimension vector (the embedding size), zero-padded after `head`
function vector(...head: number[]): string {
  const values = Array.from({ length: 768 }, (_, i) => head[i] ?? 0)
  return `[${values.join(',')}]`
}

async function addEmbedding(romId: string, embedding: string): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO "RomEmbedding" ("romId", "sourceText", "model", "embedding")
    VALUES (${romId}, 'test', 'test-model', ${embedding}::vector)
  `
}

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

afterEach(async () => {
  await prisma.$executeRaw`
    DELETE FROM "RomEmbedding" WHERE "romId" = ANY(${romIds}::text[])
  `
  await prisma.collectionMember.deleteMany({
    where: { collection: { userId: { in: [userId, otherUserId] } } },
  })
  await prisma.collection.deleteMany({
    where: { userId: { in: [userId, otherUserId] } },
  })
  await prisma.rom.deleteMany({ where: { id: { in: romIds } } })
  romIds.length = 0
})

afterAll(async () => {
  await prisma.rom.deleteMany({ where: { id: { in: romIds } } })
  await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } })
  await prisma.$disconnect()
})

describe('listRomsForGrouping', () => {
  it('returns the user ROMs with null catalog ids when none is matched', async () => {
    const a = await createRom('a', userId)
    await createRom('foreign', otherUserId)

    const roms = await listRomsForGrouping(userId)

    expect(roms.map((rom) => rom.id)).toEqual([a])
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

    const ungrouped = await listRomsForGrouping(userId, { onlyUngrouped: true })
    const all = await listRomsForGrouping(userId)

    expect(ungrouped.map((rom) => rom.id)).toEqual([free])
    expect(all).toHaveLength(2)
  })
})

describe('findNeighbors', () => {
  it('returns the closest ROMs of the user first, never the ROM itself', async () => {
    const a = await createRom('a', userId)
    const b = await createRom('b', userId)
    const c = await createRom('c', userId)
    await addEmbedding(a, vector(1))
    await addEmbedding(b, vector(0.99, 0.1))
    await addEmbedding(c, vector(0, 1))

    const neighbors = await findNeighbors(userId, a, 5)

    expect(neighbors.map((neighbor) => neighbor.romId)).toEqual([b, c])
    expect(neighbors[0]?.similarity).toBeGreaterThan(0.99)
    expect(neighbors[1]?.similarity).toBeLessThan(0.1)
  })

  it('never returns a ROM owned by someone else', async () => {
    const a = await createRom('a', userId)
    const foreign = await createRom('foreign', otherUserId)
    await addEmbedding(a, vector(1))
    await addEmbedding(foreign, vector(1, 0.01))

    const neighbors = await findNeighbors(userId, a, 5)

    expect(neighbors.map((neighbor) => neighbor.romId)).not.toContain(foreign)
  })

  it('returns nothing for a ROM without embedding', async () => {
    const a = await createRom('a', userId)
    const b = await createRom('b', userId)
    await addEmbedding(b, vector(1))

    expect(await findNeighbors(userId, a, 5)).toEqual([])
  })
})

describe('getMemberSimilarities', () => {
  it('returns each pair once, most similar first', async () => {
    const a = await createRom('a', userId)
    const b = await createRom('b', userId)
    const c = await createRom('c', userId)
    await addEmbedding(a, vector(1))
    await addEmbedding(b, vector(0.99, 0.1))
    await addEmbedding(c, vector(0, 1))

    const similarities = await getMemberSimilarities([a, b, c])

    expect(similarities).toHaveLength(3)
    expect([similarities[0]?.romA, similarities[0]?.romB].sort()).toEqual(
      [a, b].sort(),
    )
  })

  it('returns nothing for fewer than two ROMs', async () => {
    expect(await getMemberSimilarities(['only-one'])).toEqual([])
  })
})

describe('ROM ownership', () => {
  it('createCollection refuses a ROM owned by someone else', async () => {
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

  it('addMembers refuses a ROM owned by someone else', async () => {
    const foreign = await createRom('foreign', otherUserId)
    const collection = await createCollection({
      userId,
      canonicalTitle: 'mine',
      source: 'MANUAL',
    })

    await expect(
      addMembers(userId, collection.id, [{ romId: foreign }]),
    ).rejects.toMatchObject({ code: 'ROM_NOT_FOUND' })
  })
})
