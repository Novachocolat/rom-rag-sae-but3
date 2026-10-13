import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { env } from '../env.js'
import { prisma } from '../lib/prisma.js'
import {
  assertHnswIndexPresent,
  countEmbeddings,
  findNearest,
  findRomsWithoutEmbedding,
  getMemberSimilarities,
  upsertEmbedding,
} from './embedding.storage.js'

// Needs a migrated PostgreSQL with pgvector; no model involved, vectors are synthetic
const enabled = process.env.RUN_DB_INTEGRATION === '1'

// Unit vector pointing mostly along `axis`, tilted by `tilt` towards the next axis
function vectorAt(axis: number, tilt = 0): number[] {
  const vector = Array.from({ length: env.OLLAMA_EMBEDDING_DIM }, () => 0)
  vector[axis] = 1
  vector[axis + 1] = tilt
  return vector
}

// Runs the real SQL of the storage against pgvector
describe.skipIf(!enabled)('embedding.storage on PostgreSQL', () => {
  const userId = randomUUID()
  const otherUserId = randomUUID()
  const ids: Record<string, string> = {}

  async function createRom(user: string, name: string): Promise<string> {
    const rom = await prisma.rom.create({
      data: {
        userId: user,
        relativePath: `${name}.gb`,
        fileName: `${name}.gb`,
        extension: 'gb',
        sizeBytes: 1n,
        md5: randomUUID(),
        sha1: randomUUID(),
        identificationSource: 'UNIDENTIFIED',
        title: name,
      },
    })
    return rom.id
  }

  beforeAll(async () => {
    for (const id of [userId, otherUserId]) {
      await prisma.user.create({
        data: { id, email: `${id}@example.test`, passwordHash: 'x' },
      })
    }
    ids.base = await createRom(userId, 'base')
    ids.close = await createRom(userId, 'close')
    ids.far = await createRom(userId, 'far')
    ids.foreign = await createRom(otherUserId, 'foreign')
    ids.none = await createRom(userId, 'none')

    await upsertEmbedding(ids.base as string, vectorAt(0), 'base', 'm')
    await upsertEmbedding(ids.close as string, vectorAt(0, 0.1), 'close', 'm')
    await upsertEmbedding(ids.far as string, vectorAt(5), 'far', 'm')
    await upsertEmbedding(ids.foreign as string, vectorAt(0), 'foreign', 'm')
  })

  afterAll(async () => {
    await prisma.romEmbedding.deleteMany({
      where: { rom: { userId: { in: [userId, otherUserId] } } },
    })
    await prisma.rom.deleteMany({
      where: { userId: { in: [userId, otherUserId] } },
    })
    await prisma.user.deleteMany({
      where: { id: { in: [userId, otherUserId] } },
    })
    await prisma.$disconnect()
  })

  it('finds the HNSW index', async () => {
    await expect(assertHnswIndexPresent()).resolves.toBeUndefined()
  })

  it('returns the closest ROM first, as 1 - cosine distance', async () => {
    const result = await findNearest(ids.base as string, 5, 0)

    expect(result[0]?.romId).toBe(ids.close)
    expect(result[0]?.similarity).toBeGreaterThan(0.99)
    expect(result.find((n) => n.romId === ids.far)?.similarity).toBeCloseTo(0)
  })

  it('applies the similarity threshold and k', async () => {
    const strict = await findNearest(ids.base as string, 5, 0.9)
    expect(strict.map((n) => n.romId)).toEqual([ids.close])

    const limited = await findNearest(ids.base as string, 1, 0)
    expect(limited).toHaveLength(1)
  })

  it("never returns another user's ROM nor the ROM itself", async () => {
    const result = await findNearest(ids.base as string, 10, 0)
    const returned = result.map((n) => n.romId)

    expect(returned).not.toContain(ids.foreign)
    expect(returned).not.toContain(ids.base)
  })

  it('returns each pair of ROMs once, most similar first', async () => {
    const pairs = await getMemberSimilarities([
      ids.base as string,
      ids.close as string,
      ids.far as string,
      ids.none as string,
    ])

    // `none` has no vector, so only the three embedded ROMs are paired
    expect(pairs).toHaveLength(3)
    expect([pairs[0]?.romA, pairs[0]?.romB].sort()).toEqual(
      [ids.base, ids.close].sort(),
    )
    expect(pairs[0]?.similarity).toBeGreaterThan(0.99)
  })

  it('updates the vector in place on a second upsert', async () => {
    await upsertEmbedding(ids.far as string, vectorAt(0, 0.05), 'far v2', 'm')

    const result = await findNearest(ids.base as string, 5, 0.9)
    expect(result.map((n) => n.romId)).toContain(ids.far)
    expect(await countEmbeddings(userId)).toBe(3)
  })

  it('lists only the ROMs without a vector', async () => {
    const missing = await findRomsWithoutEmbedding(userId)

    expect(missing.map((r) => r.id)).toEqual([ids.none])
  })
})
