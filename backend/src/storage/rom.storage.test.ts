import { describe, expect, it, vi } from 'vitest'
import { prisma } from '../lib/prisma.js'
import {
  countRomsByStatus,
  deleteMissingRoms,
  findRomById,
  listRoms,
  listUnidentifiedRomIds,
  upsertRom,
  type UpsertRomInput,
} from './rom.storage.js'

// Mocks Prisma dependency
vi.mock('../lib/prisma.js', () => ({
  prisma: {
    rom: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}))

const upsert = vi.mocked(prisma.rom.upsert)
const findUnique = vi.mocked(prisma.rom.findUnique)
const findMany = vi.mocked(prisma.rom.findMany)
const count = vi.mocked(prisma.rom.count)
const groupBy = vi.mocked(prisma.rom.groupBy)
const deleteMany = vi.mocked(prisma.rom.deleteMany)

const romInput: UpsertRomInput = {
  userId: 'user-1',
  relativePath: 'nes/game.nes',
  fileName: 'game.nes',
  extension: '.nes',
  sizeBytes: 1024n,
  md5: 'a'.repeat(32),
  sha1: 'b'.repeat(40),
  headerBytesSkipped: 16,
  identificationSource: 'UNIDENTIFIED',
}

// Tests for the Prisma access layer for ROMs: each function must delegate
// to the right Prisma call with the right arguments, nothing more.
describe('rom.storage', () => {
  it('upsertRom keys the ROM on userId + relativePath', async () => {
    await upsertRom(romInput)

    const { userId, relativePath, ...rest } = romInput
    expect(upsert).toHaveBeenCalledWith({
      where: { userId_relativePath: { userId, relativePath } },
      create: romInput,
      update: rest,
    })
  })

  it('findRomById looks up by id', async () => {
    findUnique.mockResolvedValue(null)

    await expect(findRomById('rom-1')).resolves.toBeNull()
    expect(findUnique).toHaveBeenCalledWith({ where: { id: 'rom-1' } })
  })

  it('listRoms paginates and applies every filter', async () => {
    findMany.mockResolvedValue([])
    count.mockResolvedValue(3)

    const result = await listRoms({
      userId: 'user-1',
      platformId: 'platform-1',
      identificationSource: 'DAT_SHA1',
      region: 'Europe',
      search: 'zelda',
      page: 2,
      pageSize: 10,
    })

    const where = {
      userId: 'user-1',
      platformId: 'platform-1',
      identificationSource: 'DAT_SHA1',
      region: 'Europe',
      OR: [
        { title: { contains: 'zelda', mode: 'insensitive' } },
        { fileName: { contains: 'zelda', mode: 'insensitive' } },
      ],
    }
    expect(findMany).toHaveBeenCalledWith({
      where,
      skip: 10,
      take: 10,
      orderBy: { fileName: 'asc' },
      include: { platform: true },
    })
    expect(count).toHaveBeenCalledWith({ where })
    expect(result).toEqual({ roms: [], total: 3, page: 2, pageSize: 10 })
  })

  it('listRoms falls back to the first page of 20', async () => {
    findMany.mockResolvedValue([])
    count.mockResolvedValue(0)

    const result = await listRoms({ userId: 'user-1', page: 0 })

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-1' },
        skip: 0,
        take: 20,
      }),
    )
    expect(result).toMatchObject({ page: 1, pageSize: 20 })
  })

  it('countRomsByStatus maps each group to its count', async () => {
    // Prisma's groupBy return type is generic over its arguments: cast needed
    groupBy.mockResolvedValue([
      { identificationSource: 'DAT_SHA1', _count: { _all: 1 } },
      { identificationSource: 'UNIDENTIFIED', _count: { _all: 2 } },
    ] as never)

    await expect(countRomsByStatus('user-1')).resolves.toEqual({
      DAT_SHA1: 1,
      UNIDENTIFIED: 2,
    })
  })

  it('deleteMissingRoms only deletes inside the scanned subtree', async () => {
    deleteMany.mockResolvedValue({ count: 1 })

    const deleted = await deleteMissingRoms('user-1', 'nes', ['nes/keep.nes'])

    expect(deleted).toBe(1)
    expect(deleteMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        relativePath: {
          notIn: ['nes/keep.nes'],
          startsWith: 'nes/',
        },
      },
    })
  })

  it('deleteMissingRoms covers the whole library when the root is empty', async () => {
    deleteMany.mockResolvedValue({ count: 0 })

    await deleteMissingRoms('user-1', '', [])

    expect(deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', relativePath: { notIn: [] } },
    })
  })
})

// Tests for listUnidentifiedRomIds, which selects the batch of ROMs to identify with AI
describe('listUnidentifiedRomIds', () => {
  it('selects only UNIDENTIFIED ROMs of the user that have no pending proposal', async () => {
    vi.mocked(prisma.rom.findMany).mockResolvedValue([{ id: 'rom-1' }] as never)

    const ids = await listUnidentifiedRomIds('user-1')

    expect(ids).toEqual(['rom-1'])
    expect(prisma.rom.findMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        identificationSource: 'UNIDENTIFIED',
        aiProposals: { none: { status: 'PENDING' } },
      },
      select: { id: true },
      orderBy: { fileName: 'asc' },
    })
  })
})
