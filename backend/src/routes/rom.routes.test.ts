import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../app.js'
import { redis } from '../lib/redis.js'
import { env } from '../env.js'
import { findRomDetail, listRoms } from '../storage/rom.storage.js'
import { romDetailSchema } from '@repo/shared/schemas'

// Mocks dependencies
vi.mock('../lib/redis.js', () => ({
  redis: { get: vi.fn(), expire: vi.fn() },
}))
vi.mock('../storage/rom.storage.js', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../storage/rom.storage.js')>()
  return { ...original, listRoms: vi.fn(), findRomDetail: vi.fn() }
})

const get = vi.mocked(redis.get)
const expire = vi.mocked(redis.expire)
const listRomsMock = vi.mocked(listRoms)
const findRomDetailMock = vi.mocked(findRomDetail)
const AUTH_COOKIE = `${env.SESSION_COOKIE_NAME}=tok123`
const ROM_ID = '6f1c1f63-3a5e-4c6b-9a57-1f0d7a1b2c3d'

// A ROM as the storage layer returns it for the detail page: a headered NES dump matched on its data fingerprint
const romRow = {
  id: ROM_ID,
  userId: 'user-1',
  relativePath: 'nes/Game (Europe).nes',
  fileName: 'Game (Europe).nes',
  extension: '.nes',
  sizeBytes: 40976n,
  md5: 'a'.repeat(32),
  sha1: 'b'.repeat(40),
  crc32: null,
  md5Data: 'c'.repeat(32),
  sha1Data: 'd'.repeat(40),
  headerBytesSkipped: 16,
  firstSeenAt: new Date('2026-10-01T08:00:00.000Z'),
  lastScannedAt: new Date('2026-10-06T10:00:00.000Z'),
  platformId: 'p-1',
  platform: { name: 'NES' },
  datEntryId: 'entry-1',
  identificationSource: 'DAT_SHA1_DATA',
  confidence: 0.97,
  title: 'Game (Europe)',
  region: 'Europe',
  languages: ['en'],
  releaseYear: null,
  publisher: null,
  genre: null,
  summary: null,
  datEntry: {
    id: 'entry-1',
    gameName: 'Game (Europe)',
    romName: 'Game (Europe).nes',
    description: 'Game (Europe)',
    sizeBytes: 40960n,
    crc: 'deadbeef',
    md5: 'c'.repeat(32),
    sha1: 'd'.repeat(40),
    status: 'verified',
    datFile: { fileName: 'nes.dat', version: '20260901' },
  },
}

// Tests for GET /api/roms route, which feeds the ROM list page
describe('GET /api/roms', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    get.mockResolvedValue('user-1')
    expire.mockResolvedValue(1)
  })

  it('rejects an unauthenticated request', async () => {
    const response = await request(createApp()).get('/api/roms')
    expect(response.status).toBe(401)
  })

  it('returns a paginated, serializable list', async () => {
    listRomsMock.mockResolvedValue({
      roms: [
        {
          id: 'rom-1',
          fileName: 'game.nes',
          sizeBytes: 1024n,
          platformId: 'p-1',
          platform: { name: 'NES' },
          identificationSource: 'DAT_SHA1',
          confidence: 1,
          title: 'Game',
        },
      ] as never,
      total: 1,
      page: 1,
      pageSize: 20,
    })

    const response = await request(createApp())
      .get('/api/roms')
      .set('Cookie', AUTH_COOKIE)

    expect(response.status).toBe(200)
    expect(response.body.data[0]).toMatchObject({
      id: 'rom-1',
      sizeBytes: 1024,
      platformName: 'NES',
    })
    expect(listRomsMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', page: 1, pageSize: 20 }),
    )
  })
})

// Tests for GET /api/roms/:id route, which feeds the ROM detail page
describe('GET /api/roms/:id', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    get.mockResolvedValue('user-1')
    expire.mockResolvedValue(1)
  })

  it('rejects an unauthenticated request', async () => {
    const response = await request(createApp()).get(`/api/roms/${ROM_ID}`)

    expect(response.status).toBe(401)
    expect(findRomDetailMock).not.toHaveBeenCalled()
  })

  it('rejects a ROM id that is not a UUID', async () => {
    const response = await request(createApp())
      .get('/api/roms/not-a-uuid')
      .set('Cookie', AUTH_COOKIE)

    expect(response.status).toBe(400)
    expect(findRomDetailMock).not.toHaveBeenCalled()
  })

  it('answers 404 ROM_NOT_FOUND for an unknown or foreign ROM', async () => {
    findRomDetailMock.mockResolvedValue(null)

    const response = await request(createApp())
      .get(`/api/roms/${ROM_ID}`)
      .set('Cookie', AUTH_COOKIE)

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('ROM_NOT_FOUND')
    expect(findRomDetailMock).toHaveBeenCalledWith(ROM_ID, 'user-1')
  })

  it('returns raw and data fingerprints, the header size and the DAT entry', async () => {
    findRomDetailMock.mockResolvedValue(romRow as never)

    const response = await request(createApp())
      .get(`/api/roms/${ROM_ID}`)
      .set('Cookie', AUTH_COOKIE)

    expect(response.status).toBe(200)
    // Parsing with the shared schema proves the body honours the contract
    expect(romDetailSchema.parse(response.body)).toEqual({
      id: ROM_ID,
      fileName: 'Game (Europe).nes',
      sizeBytes: 40976,
      platformId: 'p-1',
      platformName: 'NES',
      identificationSource: 'DAT_SHA1_DATA',
      confidence: 0.97,
      title: 'Game (Europe)',
      relativePath: 'nes/Game (Europe).nes',
      extension: '.nes',
      md5: 'a'.repeat(32),
      sha1: 'b'.repeat(40),
      crc32: null,
      md5Data: 'c'.repeat(32),
      sha1Data: 'd'.repeat(40),
      headerBytesSkipped: 16,
      firstSeenAt: '2026-10-01T08:00:00.000Z',
      lastScannedAt: '2026-10-06T10:00:00.000Z',
      region: 'Europe',
      languages: ['en'],
      releaseYear: null,
      publisher: null,
      genre: null,
      summary: null,
      datEntry: {
        id: 'entry-1',
        gameName: 'Game (Europe)',
        romName: 'Game (Europe).nes',
        description: 'Game (Europe)',
        sizeBytes: 40960,
        crc: 'deadbeef',
        md5: 'c'.repeat(32),
        sha1: 'd'.repeat(40),
        status: 'verified',
        datFileName: 'nes.dat',
        datVersion: '20260901',
      },
    })
  })

  it('returns a null DAT entry for a ROM no catalog matched', async () => {
    findRomDetailMock.mockResolvedValue({
      ...romRow,
      identificationSource: 'UNIDENTIFIED',
      confidence: 0,
      datEntryId: null,
      datEntry: null,
    } as never)

    const response = await request(createApp())
      .get(`/api/roms/${ROM_ID}`)
      .set('Cookie', AUTH_COOKIE)

    expect(response.status).toBe(200)
    expect(response.body.datEntry).toBeNull()
    expect(response.body.identificationSource).toBe('UNIDENTIFIED')
  })
})
