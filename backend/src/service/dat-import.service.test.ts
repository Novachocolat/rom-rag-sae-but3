import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFile } from 'node:fs/promises'
import { parseDatXml } from './dat-parser.service.js'
import {
  upsertDatFile,
  bulkInsertEntries,
  findDatFileByContentSha1,
  createPlatform,
  findPlatformBySlug,
  listDatFiles,
  deleteDatFile as deleteDatFileStorage,
} from '../storage/dat.storage.js'
import {
  importDatFile,
  getDatCatalog,
  deleteDatFile,
} from './dat-import.service.js'

// Mocks dependencies to ensure testing pass
vi.mock('../lib/prisma.js', () => ({ prisma: {} }))
vi.mock('node:fs/promises', () => ({ readFile: vi.fn() }))
vi.mock('./dat-parser.service.js', () => ({ parseDatXml: vi.fn() }))
vi.mock('../storage/dat.storage.js', () => ({
  upsertDatFile: vi.fn(),
  bulkInsertEntries: vi.fn(),
  findDatFileByContentSha1: vi.fn(),
  createPlatform: vi.fn(),
  findPlatformBySlug: vi.fn(),
  listDatFiles: vi.fn(),
  deleteDatFile: vi.fn(),
}))

// Fixture for a game containing two ROMs
const GAME_WITH_TWO_ROMS = {
  id: '1204',
  name: 'Multi ROM Game',
  description: undefined,
  cloneofid: undefined,
  category: ['Games'],
  rom: [
    {
      name: 'Disk1.sfc',
      size: 1024n,
      crc: 'aaaa',
      md5: undefined,
      sha1: undefined,
      sha256: undefined,
      status: undefined,
    },
    {
      name: 'Disk2.sfc',
      size: 2048n,
      crc: 'bbbb',
      md5: undefined,
      sha1: undefined,
      sha256: undefined,
      status: undefined,
    },
  ],
}

// Tests for the .dat import pipeline
describe('importDatFile', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('must reject a fileName that escapes dataset/dat/ before touching the filesystem', async () => {
    await expect(importDatFile('../secrets.dat')).rejects.toMatchObject({
      code: 'INVALID_FILE_NAME',
      statusCode: 400,
    })
    expect(readFile).not.toHaveBeenCalled()
  })

  it('must throw a 404 AppError when the file does not exist in dataset/dat/', async () => {
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'))

    await expect(importDatFile('missing.dat')).rejects.toMatchObject({
      code: 'DAT_FILE_NOT_FOUND',
      statusCode: 404,
    })
  })

  it('must throw a 409 conflict and stop before parsing when the content was already imported', async () => {
    vi.mocked(readFile).mockResolvedValue(Buffer.from('<datafile/>'))
    vi.mocked(findDatFileByContentSha1).mockResolvedValue({
      id: 'existing-dat-file',
    } as never)

    await expect(importDatFile('nes.dat')).rejects.toMatchObject({
      code: 'DAT_ALREADY_IMPORTED',
      statusCode: 409,
    })
    expect(parseDatXml).not.toHaveBeenCalled()
    expect(upsertDatFile).not.toHaveBeenCalled()
  })

  it('must reuse an existing platform instead of creating one when the slug is already seeded', async () => {
    vi.mocked(readFile).mockResolvedValue(Buffer.from('<datafile/>'))
    vi.mocked(findDatFileByContentSha1).mockResolvedValue(null)
    vi.mocked(parseDatXml).mockReturnValue({
      header: { name: 'Nintendo - Super Nintendo Entertainment System' },
      entries: [],
    })
    vi.mocked(findPlatformBySlug).mockResolvedValue({
      id: 'platform-snes',
    } as never)
    vi.mocked(upsertDatFile).mockResolvedValue({ id: 'dat-file-1' } as never)
    vi.mocked(bulkInsertEntries).mockResolvedValue(0)

    await importDatFile('snes.dat')

    expect(findPlatformBySlug).toHaveBeenCalledWith(
      { prisma: {} },
      'nintendo-snes',
    )
    expect(createPlatform).not.toHaveBeenCalled()
  })

  it('must create a new platform only when no seeded slug matches the header', async () => {
    vi.mocked(readFile).mockResolvedValue(Buffer.from('<datafile/>'))
    vi.mocked(findDatFileByContentSha1).mockResolvedValue(null)
    vi.mocked(parseDatXml).mockReturnValue({
      header: { name: 'Atari - 2600' },
      entries: [],
    })
    vi.mocked(findPlatformBySlug).mockResolvedValue(null)
    vi.mocked(createPlatform).mockResolvedValue({
      id: 'platform-atari',
    } as never)
    vi.mocked(upsertDatFile).mockResolvedValue({ id: 'dat-file-1' } as never)
    vi.mocked(bulkInsertEntries).mockResolvedValue(0)

    await importDatFile('atari.dat')

    expect(createPlatform).toHaveBeenCalledWith(
      { prisma: {} },
      { slug: 'atari-2600', name: 'Atari - 2600', extensions: [] },
    )
  })

  it('must count entries per rom (not per game) and flatten multi-rom games before insertion', async () => {
    vi.mocked(readFile).mockResolvedValue(Buffer.from('<datafile/>'))
    vi.mocked(findDatFileByContentSha1).mockResolvedValue(null)
    vi.mocked(parseDatXml).mockReturnValue({
      header: { name: 'Nintendo - Nintendo Entertainment System (Headered)' },
      entries: [GAME_WITH_TWO_ROMS],
    })
    vi.mocked(findPlatformBySlug).mockResolvedValue({
      id: 'platform-nes',
    } as never)
    vi.mocked(upsertDatFile).mockResolvedValue({ id: 'dat-file-1' } as never)
    vi.mocked(bulkInsertEntries).mockResolvedValue(2)

    const result = await importDatFile('nes.dat')

    expect(upsertDatFile).toHaveBeenCalledWith(
      { prisma: {} },
      expect.objectContaining({ entryCount: 2 }),
    )
    expect(bulkInsertEntries).toHaveBeenCalledWith({ prisma: {} }, [
      expect.objectContaining({
        datFileId: 'dat-file-1',
        gameExternalId: '1204',
        romName: 'Disk1.sfc',
      }),
      expect.objectContaining({
        datFileId: 'dat-file-1',
        gameExternalId: '1204',
        romName: 'Disk2.sfc',
      }),
    ])
    expect(result).toEqual({
      datFile: { id: 'dat-file-1' },
      insertedEntries: 2,
    })
  })
})

describe('getDatCatalog', () => {
  it('must delegate to the storage layer with the shared prisma client', async () => {
    vi.mocked(listDatFiles).mockResolvedValue([])

    await getDatCatalog()

    expect(listDatFiles).toHaveBeenCalledWith({ prisma: {} })
  })
})

describe('deleteDatFile (service)', () => {
  it('must delegate to the storage layer with the given id', async () => {
    vi.mocked(deleteDatFileStorage).mockResolvedValue({ id: 'dat-1' } as never)

    await deleteDatFile('dat-1')

    expect(deleteDatFileStorage).toHaveBeenCalledWith({ prisma: {} }, 'dat-1')
  })
})
