import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../lib/prisma.js'
import { findNearest } from '../storage/embedding.storage.js'
import { backfillEmbeddings } from './embedding.service.js'

// Needs a migrated database and a reachable Ollama with the embedding model pulled
const enabled = process.env.RUN_OLLAMA_INTEGRATION === '1'

const TITLES = [
  'Pokemon - Version Rouge (France)',
  'Pokemon - Version Bleue (France)',
  'Pokemon - Version Jaune - Edition Speciale Pikachu (France)',
  'Tetris (World)',
]

// The demonstration expected by US-4.1: the sibling Pokemon versions come first
describe.skipIf(!enabled)('embedding backfill and nearest neighbours', () => {
  const userId = randomUUID()
  const romIds: string[] = []

  beforeAll(async () => {
    await prisma.user.create({
      data: {
        id: userId,
        email: `${userId}@example.test`,
        passwordHash: 'x',
      },
    })

    for (const title of TITLES) {
      const rom = await prisma.rom.create({
        data: {
          userId,
          relativePath: `${title}.gb`,
          fileName: `${title}.gb`,
          extension: 'gb',
          sizeBytes: 1n,
          md5: randomUUID(),
          sha1: randomUUID(),
          identificationSource: 'UNIDENTIFIED',
          title,
        },
      })
      romIds.push(rom.id)
    }

    await backfillEmbeddings(userId, new AbortController().signal)
  }, 300_000)

  afterAll(async () => {
    await prisma.romEmbedding.deleteMany({ where: { rom: { userId } } })
    await prisma.rom.deleteMany({ where: { userId } })
    await prisma.user.delete({ where: { id: userId } })
    await prisma.$disconnect()
  })

  it('ranks the Bleue and Jaune versions first, above 0.9', async () => {
    const neighbours = await findNearest(romIds[0] as string, 3, 0)

    expect(neighbours.slice(0, 2).map((n) => n.title)).toEqual(
      expect.arrayContaining([TITLES[1], TITLES[2]]),
    )
    for (const neighbour of neighbours.slice(0, 2)) {
      expect(neighbour.similarity).toBeGreaterThan(0.9)
    }
  })
})
