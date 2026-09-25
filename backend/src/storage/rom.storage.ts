import type { IdentificationSource, Rom } from '../generated/prisma/client.js'
import { prisma } from '../lib/prisma.js'
import { AppError } from '../lib/error.js'

export interface UpsertRomInput {
  userId: string
  relativePath: string
  fileName: string
  extension: string
  sizeBytes: bigint
  md5: string
  sha1: string
  crc32?: string | null
  md5Data?: string | null
  sha1Data?: string | null
  headerBytesSkipped: number
  platformId?: string | null
  datEntryId?: string | null
  identificationSource: IdentificationSource
  confidence?: number | null
  title?: string | null
  region?: string | null
  languages?: string[]
  releaseYear?: number | null
  publisher?: string | null
  genre?: string | null
  summary?: string | null
}

export async function upsertRom(input: UpsertRomInput): Promise<Rom> {
  const { userId, relativePath, ...rest } = input

  return prisma.rom.upsert({
    where: { userId_relativePath: { userId, relativePath } },
    create: { userId, relativePath, ...rest },
    update: { ...rest },
  })
}

export async function findRomById(id: string): Promise<Rom> {
  const rom = await prisma.rom.findUnique({ where: { id } })
  if (!rom) {
    throw AppError.notFound('ROM_NOT_FOUND', `Rom ${id} introuvable`)
  }
  return rom
}

export interface ListRomsFilters {
  userId: string
  platformId?: string
  identificationSource?: IdentificationSource
  region?: string
  search?: string
  page?: number
  pageSize?: number
}

export interface ListRomsResult {
  roms: Rom[]
  total: number
  page: number
  pageSize: number
}

export async function listRoms(
  filters: ListRomsFilters,
): Promise<ListRomsResult> {
  const page = filters.page && filters.page > 0 ? filters.page : 1
  const pageSize =
    filters.pageSize && filters.pageSize > 0 ? filters.pageSize : 20

  const where = {
    userId: filters.userId,
    ...(filters.platformId && { platformId: filters.platformId }),
    ...(filters.identificationSource && {
      identificationSource: filters.identificationSource,
    }),
    ...(filters.region && { region: filters.region }),
    ...(filters.search && {
      OR: [
        { title: { contains: filters.search, mode: 'insensitive' as const } },
        {
          fileName: { contains: filters.search, mode: 'insensitive' as const },
        },
      ],
    }),
  }

  const [roms, total] = await Promise.all([
    prisma.rom.findMany({
      where,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { fileName: 'asc' },
    }),
    prisma.rom.count({ where }),
  ])

  return { roms, total, page, pageSize }
}

export async function countRomsByStatus(
  userId: string,
): Promise<Record<IdentificationSource, number>> {
  const grouped = await prisma.rom.groupBy({
    by: ['identificationSource'],
    where: { userId },
    _count: { _all: true },
  })

  const result = {} as Record<IdentificationSource, number>
  for (const row of grouped) {
    // eslint-disable-next-line no-underscore-dangle -- Prisma's groupBy API
    result[row.identificationSource] = row._count._all
  }
  return result
}

export async function deleteMissingRoms(
  userId: string,
  keepRelativePaths: string[],
): Promise<number> {
  const { count } = await prisma.rom.deleteMany({
    where: {
      userId,
      relativePath: { notIn: keepRelativePaths },
    },
  })
  return count
}
