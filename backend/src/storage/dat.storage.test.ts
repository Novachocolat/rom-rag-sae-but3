import { describe, it, expect, vi } from 'vitest'
import type { PrismaClient } from '../generated/prisma/client.js'
import {
  upsertDatFile,
  bulkInsertEntries,
  findEntryBySha1,
  findEntryByMd5,
  findEntriesByNormalizedName,
  createPlatform,
  findPlatformBySlug,
  findDatFileByContentSha1,
  listDatFiles,
  deleteDatFile,
  type DatEntryInput,
} from './dat.storage.js'

// Builds a minimal Prisma mock, only implementing what each tests needs
function createPrismaMock() {
  return {
    datFile: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      delete: vi.fn(),
    },
    datEntry: {
      createMany: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    platform: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  } as unknown as PrismaClient
}

// Builds a test entry whose parameters can be overwritten
function buildEntry(overrides: Partial<DatEntryInput> = {}): DatEntryInput {
  return {
    datFileId: 'dat-file-1',
    gameName: 'Game',
    gameExternalId: '0001',
    cloneOfId: undefined,
    description: 'Game',
    categories: ['Games'],
    serial: undefined,
    romName: 'Game.sfc',
    sizeBytes: 1024n,
    crc: 'aaaaaaaa',
    md5: undefined,
    sha1: undefined,
    sha256: undefined,
    status: undefined,
    ...overrides,
  }
}

// Tests for the .dat storage layer, which receives its Prisma Client as a dependency
describe('upsertDatFile', () => {
  it('must upsert on contentSha1 and fall back version to "unknown"', async () => {
    const prisma = createPrismaMock()
    vi.mocked(prisma.datFile.upsert).mockResolvedValue({
      id: 'dat-1',
    } as never)

    await upsertDatFile(
      { prisma },
      {
        platformId: 'platform-1',
        headerName: 'Nintendo - Game Boy',
        version: undefined,
        fileName: 'gb.dat',
        entryCount: 10,
        contentSha1: 'sha1-hash',
      },
    )

    expect(prisma.datFile.upsert).toHaveBeenCalledWith({
      where: { contentSha1: 'sha1-hash' },
      create: expect.objectContaining({
        version: 'unknown',
      }),
      update: expect.objectContaining({
        entryCount: 10,
      }),
    })
  })
})

describe('bulkInsertEntries', () => {
  it('must insert entries in batches of 1,000', async () => {
    const prisma = createPrismaMock()
    vi.mocked(prisma.datEntry.createMany).mockImplementation((async (args: {
      data: unknown[]
    }) => ({ count: args.data.length })) as never)

    const entries = Array.from({ length: 2_500 }, () => buildEntry())
    const inserted = await bulkInsertEntries({ prisma }, entries)

    expect(prisma.datEntry.createMany).toHaveBeenCalledTimes(3)
    expect(inserted).toBe(2_500)
  })

  it('must not call createMany when there is nothing to insert', async () => {
    const prisma = createPrismaMock()

    const inserted = await bulkInsertEntries({ prisma }, [])

    expect(prisma.datEntry.createMany).not.toHaveBeenCalled()
    expect(inserted).toBe(0)
  })
})

describe('findEntryBySha1', () => {
  it('must lowercase the SHA-1 before querying', async () => {
    const prisma = createPrismaMock()
    vi.mocked(prisma.datEntry.findFirst).mockResolvedValue(null)

    await findEntryBySha1({ prisma }, 'ABCDEF0123456789ABCDEF0123456789ABCDEF0')

    expect(prisma.datEntry.findFirst).toHaveBeenCalledWith({
      where: { sha1: 'abcdef0123456789abcdef0123456789abcdef0' },
    })
  })
})

describe('findEntryByMd5', () => {
  it('must lowercase the MD5 before querying', async () => {
    const prisma = createPrismaMock()
    vi.mocked(prisma.datEntry.findFirst).mockResolvedValue(null)

    await findEntryByMd5({ prisma }, 'ABCDEF0123456789ABCDEF0123456789')

    expect(prisma.datEntry.findFirst).toHaveBeenCalledWith({
      where: { md5: 'abcdef0123456789abcdef0123456789' },
    })
  })
})

describe('findEntriesByNormalizedName', () => {
  it('must query case-insensitively on the exact rom name', async () => {
    const prisma = createPrismaMock()
    vi.mocked(prisma.datEntry.findMany).mockResolvedValue([])

    await findEntriesByNormalizedName(
      { prisma },
      'Super Mario Kart (Europe).sfc',
    )

    expect(prisma.datEntry.findMany).toHaveBeenCalledWith({
      where: {
        romName: {
          equals: 'Super Mario Kart (Europe).sfc',
          mode: 'insensitive',
        },
      },
    })
  })
})

describe('createPlatform', () => {
  it('must create a platform with the given data', async () => {
    const prisma = createPrismaMock()
    vi.mocked(prisma.platform.create).mockResolvedValue({
      id: 'platform-1',
    } as never)

    const input = {
      slug: 'nintendo-game-boy',
      name: 'Nintendo - Game Boy',
      extensions: [],
    }
    await createPlatform({ prisma }, input)

    expect(prisma.platform.create).toHaveBeenCalledWith({ data: input })
  })
})

describe('findPlatformBySlug', () => {
  it('must query the platform by its unique slug', async () => {
    const prisma = createPrismaMock()
    vi.mocked(prisma.platform.findUnique).mockResolvedValue(null)

    await findPlatformBySlug({ prisma }, 'nintendo-game-boy')

    expect(prisma.platform.findUnique).toHaveBeenCalledWith({
      where: { slug: 'nintendo-game-boy' },
    })
  })
})

describe('findDatFileByContentSha1', () => {
  it('must query the DatFile by its unique contentSha1', async () => {
    const prisma = createPrismaMock()
    vi.mocked(prisma.datFile.findUnique).mockResolvedValue(null)

    await findDatFileByContentSha1({ prisma }, 'sha1-hash')

    expect(prisma.datFile.findUnique).toHaveBeenCalledWith({
      where: { contentSha1: 'sha1-hash' },
    })
  })
})

describe('listDatFiles', () => {
  it('must list files ordered by most recent, with their platform', async () => {
    const prisma = createPrismaMock()
    vi.mocked(prisma.datFile.findMany).mockResolvedValue([])

    await listDatFiles({ prisma })

    expect(prisma.datFile.findMany).toHaveBeenCalledWith({
      orderBy: { importedAt: 'desc' },
      include: { platform: { select: { slug: true, name: true } } },
    })
  })
})

describe('deleteDatFile', () => {
  it('must delete the entries before deleting the DatFile itself, inside a transaction', async () => {
    const prisma = createPrismaMock()
    interface Tx {
      datEntry: { deleteMany: ReturnType<typeof vi.fn> }
      datFile: { delete: ReturnType<typeof vi.fn> }
    }
    const tx: Tx = {
      datEntry: { deleteMany: vi.fn() },
      datFile: { delete: vi.fn().mockResolvedValue({ id: 'dat-1' }) },
    }
    vi.mocked(prisma.$transaction).mockImplementation((async (
      callback: (tx: Tx) => unknown,
    ) => callback(tx)) as never)

    await deleteDatFile({ prisma }, 'dat-1')

    expect(tx.datEntry.deleteMany).toHaveBeenCalledWith({
      where: { datFileId: 'dat-1' },
    })
    expect(tx.datFile.delete).toHaveBeenCalledWith({ where: { id: 'dat-1' } })
  })
})
