import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { Prisma } from '../generated/prisma/client.js'
import { prisma } from '../lib/prisma.js'
import { listDuplicateCandidates, listRoms } from './rom.storage.js'

// Integration tests: need `docker compose up -d postgres`

let userId: string
let otherUserId: string
const romIds: string[] = []

async function createRom(
  name: string,
  extra: Partial<Prisma.RomUncheckedCreateInput> = {},
  owner: string = userId,
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
      ...extra,
    },
  })
  romIds.push(rom.id)
  return rom.id
}

async function names(filters: Parameters<typeof listRoms>[0]) {
  const { roms } = await listRoms(filters)
  return roms.map((rom) => rom.fileName)
}

beforeAll(async () => {
  const users = await Promise.all(
    [0, 1].map(() =>
      prisma.user.create({
        data: {
          email: `rom-search-${randomUUID()}@example.com`,
          passwordHash: 'irrelevant',
        },
      }),
    ),
  )
  userId = users[0]?.id ?? ''
  otherUserId = users[1]?.id ?? ''
})

afterEach(async () => {
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
  await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } })
  await prisma.$disconnect()
})

describe('listRoms: release year', () => {
  it('keeps the inclusive range and drops a ROM without a year', async () => {
    await createRom('y1990', { releaseYear: 1990 })
    await createRom('y1995', { releaseYear: 1995 })
    await createRom('y2000', { releaseYear: 2000 })
    await createRom('noyear')

    const result = await names({
      userId,
      yearMin: 1995,
      yearMax: 2000,
      sort: 'releaseYear',
    })

    expect(result).toEqual(['y1995.gb', 'y2000.gb'])
  })

  it('accepts a single bound', async () => {
    await createRom('old', { releaseYear: 1985 })
    await createRom('new', { releaseYear: 2001 })

    expect(await names({ userId, yearMax: 1990 })).toEqual(['old.gb'])
  })
})

describe('listRoms: collections', () => {
  async function createCollection(romId: string): Promise<string> {
    const collection = await prisma.collection.create({
      data: {
        userId,
        canonicalTitle: 'game',
        source: 'MANUAL',
        members: { create: [{ romId }] },
      },
    })
    return collection.id
  }

  it('filters by collection id', async () => {
    const grouped = await createRom('grouped')
    await createRom('free')
    const collectionId = await createCollection(grouped)

    expect(await names({ userId, collectionId })).toEqual(['grouped.gb'])
  })

  it('separates ROMs in a collection from the others', async () => {
    const grouped = await createRom('grouped')
    await createRom('free')
    await createCollection(grouped)

    expect(await names({ userId, inCollection: true })).toEqual(['grouped.gb'])
    expect(await names({ userId, inCollection: false })).toEqual(['free.gb'])
  })
})

describe('listRoms: id filters', () => {
  it('restricts to includeIds and drops excludeIds', async () => {
    const a = await createRom('a')
    const b = await createRom('b')
    const c = await createRom('c')

    expect(await names({ userId, includeIds: [a, b] })).toEqual([
      'a.gb',
      'b.gb',
    ])
    expect(await names({ userId, excludeIds: [a] })).toEqual(['b.gb', 'c.gb'])
    expect(
      await names({ userId, includeIds: [a, b, c], excludeIds: [b] }),
    ).toEqual(['a.gb', 'c.gb'])
  })

  it('returns nothing for an empty includeIds', async () => {
    await createRom('a')

    expect(await names({ userId, includeIds: [] })).toEqual([])
  })
})

describe('listRoms: sort', () => {
  it('puts ROMs without a title last in both directions', async () => {
    await createRom('b', { title: 'Bravo' })
    await createRom('a', { title: 'Alpha' })
    await createRom('none')

    expect(await names({ userId, sort: 'title', order: 'asc' })).toEqual([
      'a.gb',
      'b.gb',
      'none.gb',
    ])
    expect(await names({ userId, sort: 'title', order: 'desc' })).toEqual([
      'b.gb',
      'a.gb',
      'none.gb',
    ])
  })

  it('sorts by size', async () => {
    await createRom('big', { sizeBytes: 4096n })
    await createRom('small', { sizeBytes: 16n })

    expect(await names({ userId, sort: 'sizeBytes', order: 'desc' })).toEqual([
      'big.gb',
      'small.gb',
    ])
  })

  it('never repeats or skips a row across pages with equal sort values', async () => {
    for (const name of ['a', 'b', 'c', 'd', 'e']) {
      await createRom(name, { releaseYear: 1990 })
    }

    const seen: string[] = []
    for (const page of [1, 2, 3]) {
      seen.push(
        ...(await names({ userId, sort: 'releaseYear', page, pageSize: 2 })),
      )
    }

    expect(new Set(seen).size).toBe(5)
  })
})

describe('listDuplicateCandidates', () => {
  it('returns only the ROMs of the user', async () => {
    const mine = await createRom('mine')
    await createRom('foreign', {}, otherUserId)

    const candidates = await listDuplicateCandidates(userId)

    expect(candidates.map((candidate) => candidate.id)).toEqual([mine])
  })
})
