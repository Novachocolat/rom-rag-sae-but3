import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { env } from '../env.js'
import { prisma } from '../lib/prisma.js'
import { findNearestToVector, upsertEmbedding } from './embedding.storage.js'

// Needs a migrated PostgreSQL (`docker compose up -d postgres`); opt-in, like
// the other database integration tests
const enabled = process.env.RUN_DB_INTEGRATION === '1'

let userId: string
let otherUserId: string
const romIds: string[] = []

// A vector of the configured dimension, zero-padded after `head`
function vec(...head: number[]): number[] {
  return Array.from(
    { length: env.OLLAMA_EMBEDDING_DIM },
    (_, i) => head[i] ?? 0,
  )
}

async function createRom(
  owner: string,
  name: string,
  embedding: number[],
  model: string = env.OLLAMA_EMBEDDING_MODEL,
): Promise<string> {
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
  await upsertEmbedding(rom.id, embedding, name, model)
  return rom.id
}

describe.skipIf(!enabled)('findNearestToVector on PostgreSQL', () => {
  beforeAll(async () => {
    const users = await Promise.all(
      [0, 1].map(() =>
        prisma.user.create({
          data: {
            email: `embedding-search-${randomUUID()}@example.com`,
            passwordHash: 'irrelevant',
          },
        }),
      ),
    )
    userId = users[0]?.id ?? ''
    otherUserId = users[1]?.id ?? ''
  })

  afterEach(async () => {
    await prisma.romEmbedding.deleteMany({ where: { romId: { in: romIds } } })
    await prisma.rom.deleteMany({ where: { id: { in: romIds } } })
    romIds.length = 0
  })

  afterAll(async () => {
    await prisma.user.deleteMany({
      where: { id: { in: [userId, otherUserId] } },
    })
    await prisma.$disconnect()
  })

  it('returns the closest ROMs first with their raw cosine score', async () => {
    const near = await createRom(userId, 'near', vec(1, 0.1))
    const far = await createRom(userId, 'far', vec(0, 1))

    const result = await findNearestToVector(userId, vec(1), 5)

    expect(result.map((row) => row.romId)).toEqual([near, far])
    expect(result[0]?.similarity).toBeGreaterThan(0.99)
    expect(result[1]?.similarity).toBeCloseTo(0, 5)
  })

  it('never filters a low or negative score out (ADR-010)', async () => {
    const opposite = await createRom(userId, 'opposite', vec(-1))

    const result = await findNearestToVector(userId, vec(1), 5)

    expect(result.map((row) => row.romId)).toEqual([opposite])
    expect(result[0]?.similarity).toBeCloseTo(-1, 5)
  })

  it('only returns ROMs of the given user', async () => {
    const mine = await createRom(userId, 'mine', vec(1))
    await createRom(otherUserId, 'foreign', vec(1, 0.01))

    const result = await findNearestToVector(userId, vec(1), 5)

    expect(result.map((row) => row.romId)).toEqual([mine])
  })

  it('is bounded by k', async () => {
    await createRom(userId, 'a', vec(1))
    await createRom(userId, 'b', vec(0.9, 0.1))
    await createRom(userId, 'c', vec(0.8, 0.2))

    expect(await findNearestToVector(userId, vec(1), 2)).toHaveLength(2)
  })

  it('restricts to romIds before applying k', async () => {
    await createRom(userId, 'closest', vec(1))
    await createRom(userId, 'close', vec(0.9, 0.1))
    const far = await createRom(userId, 'far', vec(0, 1))

    const result = await findNearestToVector(userId, vec(1), 1, [far])

    expect(result.map((row) => row.romId)).toEqual([far])
  })

  it('returns nothing for an empty romIds', async () => {
    await createRom(userId, 'a', vec(1))

    expect(await findNearestToVector(userId, vec(1), 5, [])).toEqual([])
  })

  it('ignores a vector of another model', async () => {
    const current = await createRom(userId, 'current', vec(0, 1))
    await createRom(userId, 'stale', vec(1), 'old-model')

    const result = await findNearestToVector(userId, vec(1), 5)

    expect(result.map((row) => row.romId)).toEqual([current])
  })

  it('refuses a vector of the wrong dimension', async () => {
    await expect(findNearestToVector(userId, [1, 2, 3], 5)).rejects.toThrow(
      RangeError,
    )
  })
})
