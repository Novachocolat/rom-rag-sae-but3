import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../lib/prisma.js'
import {
  upsertRom,
  findRomById,
  listRoms,
  countRomsByStatus,
  deleteMissingRoms,
} from './rom.storage.js'

// Integration tests: run against the real Postgres configured in
// vitest.config.ts (DATABASE_URL). Requires `docker compose up -d postgres`.

let userId: string

function baseRomInput(
  overrides: Partial<Parameters<typeof upsertRom>[0]> = {},
) {
  return {
    userId,
    relativePath: 'game.nes',
    fileName: 'game.nes',
    extension: '.nes',
    sizeBytes: 1024n,
    md5: 'a'.repeat(32),
    sha1: 'b'.repeat(40),
    headerBytesSkipped: 0,
    identificationSource: 'UNIDENTIFIED' as const,
    ...overrides,
  }
}

beforeAll(async () => {
  const user = await prisma.user.create({
    data: {
      email: `rom-storage-test-${randomUUID()}@example.com`,
      passwordHash: 'irrelevant',
    },
  })
  userId = user.id
})

afterEach(async () => {
  await prisma.rom.deleteMany({ where: { userId } })
})

afterAll(async () => {
  await prisma.user.delete({ where: { id: userId } })
  await prisma.$disconnect()
})

describe('rom.storage', () => {
  it('upsertRom creates a new rom on first call', async () => {
    const rom = await upsertRom(baseRomInput())

    expect(rom.id).toBeTruthy()
    expect(rom.userId).toBe(userId)
    expect(rom.relativePath).toBe('game.nes')
    expect(rom.identificationSource).toBe('UNIDENTIFIED')
  })

  it('upsertRom updates the existing rom on the same userId + relativePath', async () => {
    await upsertRom(baseRomInput({ title: 'First title' }))
    const updated = await upsertRom(
      baseRomInput({
        title: 'Updated title',
        identificationSource: 'DAT_SHA1',
      }),
    )

    const all = await prisma.rom.findMany({ where: { userId } })
    expect(all).toHaveLength(1)
    expect(updated.title).toBe('Updated title')
    expect(updated.identificationSource).toBe('DAT_SHA1')
  })

  it('findRomById returns the rom', async () => {
    const created = await upsertRom(baseRomInput())
    const found = await findRomById(created.id)

    expect(found.id).toBe(created.id)
  })

  it('findRomById throws AppError.notFound for an unknown id', async () => {
    await expect(findRomById(randomUUID())).rejects.toMatchObject({
      statusCode: 404,
      code: 'ROM_NOT_FOUND',
    })
  })

  it('listRoms paginates and filters by userId', async () => {
    await upsertRom(baseRomInput({ relativePath: 'a.nes', fileName: 'a.nes' }))
    await upsertRom(baseRomInput({ relativePath: 'b.nes', fileName: 'b.nes' }))
    await upsertRom(baseRomInput({ relativePath: 'c.nes', fileName: 'c.nes' }))

    const page1 = await listRoms({ userId, page: 1, pageSize: 2 })
    expect(page1.roms).toHaveLength(2)
    expect(page1.total).toBe(3)

    const page2 = await listRoms({ userId, page: 2, pageSize: 2 })
    expect(page2.roms).toHaveLength(1)
  })

  it('listRoms filters by search on title/fileName', async () => {
    await upsertRom(
      baseRomInput({
        relativePath: 'zelda.nes',
        fileName: 'zelda.nes',
        title: 'Zelda',
      }),
    )
    await upsertRom(
      baseRomInput({
        relativePath: 'mario.nes',
        fileName: 'mario.nes',
        title: 'Mario',
      }),
    )

    const result = await listRoms({ userId, search: 'zelda' })
    expect(result.roms).toHaveLength(1)
    expect(result.roms[0]?.fileName).toBe('zelda.nes')
  })

  it('countRomsByStatus groups by identificationSource', async () => {
    await upsertRom(
      baseRomInput({ relativePath: 'a.nes', identificationSource: 'DAT_SHA1' }),
    )
    await upsertRom(
      baseRomInput({
        relativePath: 'b.nes',
        identificationSource: 'UNIDENTIFIED',
      }),
    )
    await upsertRom(
      baseRomInput({
        relativePath: 'c.nes',
        identificationSource: 'UNIDENTIFIED',
      }),
    )

    const counts = await countRomsByStatus(userId)

    expect(counts.DAT_SHA1).toBe(1)
    expect(counts.UNIDENTIFIED).toBe(2)
  })

  it('deleteMissingRoms removes roms not in the keep list', async () => {
    await upsertRom(
      baseRomInput({ relativePath: 'keep.nes', fileName: 'keep.nes' }),
    )
    await upsertRom(
      baseRomInput({ relativePath: 'remove.nes', fileName: 'remove.nes' }),
    )

    const deletedCount = await deleteMissingRoms(userId, ['keep.nes'])

    expect(deletedCount).toBe(1)
    const remaining = await prisma.rom.findMany({ where: { userId } })
    expect(remaining).toHaveLength(1)
    expect(remaining[0]?.relativePath).toBe('keep.nes')
  })
})
