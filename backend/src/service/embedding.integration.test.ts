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

// Measured with embeddinggemma on bare titles: siblings at about 0.6-0.7, the
// unrelated game at about 0.45. The ranking matters, not an absolute 0.9
const MIN_SIBLING_SIMILARITY = 0.5
const MIN_MARGIN_OVER_INTRUDER = 0.1

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

  it('ranks the Bleue and Jaune versions before an unrelated game', async () => {
    const neighbours = await findNearest(romIds[0] as string, 3, 0)
    const siblings = neighbours.slice(0, 2)
    const intruder = neighbours[2]

    expect(siblings.map((n) => n.title)).toEqual(
      expect.arrayContaining([TITLES[1], TITLES[2]]),
    )
    expect(intruder?.title).toBe(TITLES[3])
    for (const sibling of siblings) {
      expect(sibling.similarity).toBeGreaterThan(MIN_SIBLING_SIMILARITY)
      expect(sibling.similarity - (intruder?.similarity ?? 0)).toBeGreaterThan(
        MIN_MARGIN_OVER_INTRUDER,
      )
    }
  })
})
