import type {
  IdentificationSource,
  Platform,
  Rom,
} from '../generated/prisma/client.js'
import { prisma } from '../lib/prisma.js'

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
  roms: (Rom & { platform: Platform | null })[]
  total: number
  page: number
  pageSize: number
}

/**
 * Creates or updates a ROM keyed by `userId` + `relativePath`, so rescanning
 * the same file never duplicates it and only bumps `lastScannedAt`.
 */
export function upsertRom(input: UpsertRomInput): Promise<Rom> {
  const { userId, relativePath, ...rest } = input

  return prisma.rom.upsert({
    where: { userId_relativePath: { userId, relativePath } },
    create: { userId, relativePath, ...rest },
    update: rest,
  })
}

// Returns a ROM by id, or null if it does not exist
export function findRomById(id: string): Promise<Rom | null> {
  return prisma.rom.findUnique({ where: { id } })
}

// Lists a user's ROMs matching `filters`, 20 per page by default
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
      include: { platform: true },
    }),
    prisma.rom.count({ where }),
  ])

  return { roms, total, page, pageSize }
}

// Counts a user's ROMs per identification source; absent sources have no key
export async function countRomsByStatus(
  userId: string,
): Promise<Partial<Record<IdentificationSource, number>>> {
  const grouped = await prisma.rom.groupBy({
    by: ['identificationSource'],
    where: { userId },
    _count: { _all: true },
  })

  return Object.fromEntries(
    grouped.map((row) => [row.identificationSource, row._count._all]),
  )
}

/**
 * Deletes the user's ROMs under `rootRelativePath` that are not in
 * `keepRelativePaths`. Scoped to that subtree, so scanning `snes` never
 * removes the ROMs of `gb`.
 */
export async function deleteMissingRoms(
  userId: string,
  rootRelativePath: string,
  keepRelativePaths: string[],
): Promise<number> {
  const { count } = await prisma.rom.deleteMany({
    where: {
      userId,
      relativePath: {
        notIn: keepRelativePaths,
        // relativePath is always POSIX ('/'), regardless of the host OS
        ...(rootRelativePath !== '' && {
          startsWith: `${rootRelativePath}/`,
        }),
      },
    },
  })
  return count
}
