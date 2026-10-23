import type { RomSortKey } from '@repo/shared/schemas'
import type {
  IdentificationSource,
  Platform,
  Prisma,
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

export interface RomFilters {
  userId: string
  platformId?: string
  identificationSource?: IdentificationSource
  region?: string
  search?: string
  // Inclusive bounds on the release year; a ROM without a year never matches
  yearMin?: number
  yearMax?: number
  // `collectionId` wins over `inCollection` when both are given
  collectionId?: string
  inCollection?: boolean
  // Restrict to, or exclude, a set of ROM ids (resolved by the caller)
  includeIds?: string[]
  excludeIds?: string[]
}

export interface ListRomsFilters extends RomFilters {
  sort?: RomSortKey
  order?: 'asc' | 'desc'
  page?: number
  pageSize?: number
}

export interface ListRomsResult {
  roms: (Rom & { platform: Platform | null })[]
  total: number
  page: number
  pageSize: number
}

export interface DuplicateCandidate {
  id: string
  fileName: string
  title: string | null
  platformId: string | null
  sha1: string
  sha1Data: string | null
}

// Relations the detail page displays next to the ROM itself
const romDetailInclude = {
  platform: true,
  datEntry: { include: { datFile: true } },
} as const

export type RomWithDetail = Prisma.RomGetPayload<{
  include: typeof romDetailInclude
}>

// Nullable columns sort their empty values last, whatever the direction
const ORDER_BY: Record<
  RomSortKey,
  (order: 'asc' | 'desc') => Prisma.RomOrderByWithRelationInput
> = {
  fileName: (order) => ({ fileName: order }),
  title: (order) => ({ title: { sort: order, nulls: 'last' } }),
  releaseYear: (order) => ({ releaseYear: { sort: order, nulls: 'last' } }),
  sizeBytes: (order) => ({ sizeBytes: order }),
  lastScannedAt: (order) => ({ lastScannedAt: order }),
}

// Creates or updates a ROM keyed by `userId` + `relativePath`, so rescanning
// the same file never duplicates it and only bumps `lastScannedAt`
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

// Returns a user's ROM with its platform and matched DAT entry, or null if it does not exist
// Scoped by `userId` so a user can never read the ROM of another one
export function findRomDetail(
  id: string,
  userId: string,
): Promise<RomWithDetail | null> {
  return prisma.rom.findFirst({
    where: { id, userId },
    include: romDetailInclude,
  })
}

function romWhere(filters: RomFilters): Prisma.RomWhereInput {
  return {
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
    ...((filters.yearMin !== undefined || filters.yearMax !== undefined) && {
      releaseYear: {
        ...(filters.yearMin !== undefined && { gte: filters.yearMin }),
        ...(filters.yearMax !== undefined && { lte: filters.yearMax }),
      },
    }),
    ...(filters.collectionId
      ? {
          collectionMembers: {
            some: { collectionId: filters.collectionId },
          },
        }
      : filters.inCollection !== undefined && {
          collectionMembers: filters.inCollection ? { some: {} } : { none: {} },
        }),
    ...((filters.includeIds !== undefined ||
      filters.excludeIds !== undefined) && {
      id: {
        ...(filters.includeIds !== undefined && { in: filters.includeIds }),
        ...(filters.excludeIds !== undefined && { notIn: filters.excludeIds }),
      },
    }),
  }
}

// Lists a user's ROMs matching `filters`, 20 per page by default
export async function listRoms(
  filters: ListRomsFilters,
): Promise<ListRomsResult> {
  const page = filters.page && filters.page > 0 ? filters.page : 1
  const pageSize =
    filters.pageSize && filters.pageSize > 0 ? filters.pageSize : 20
  const where = romWhere(filters)

  // `id` breaks ties, so offset pagination never repeats or skips a row
  const orderBy: Prisma.RomOrderByWithRelationInput[] = [
    ORDER_BY[filters.sort ?? 'fileName'](filters.order ?? 'asc'),
    { id: 'asc' },
  ]

  const [roms, total] = await Promise.all([
    prisma.rom.findMany({
      where,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy,
      include: { platform: true },
    }),
    prisma.rom.count({ where }),
  ])

  return { roms, total, page, pageSize }
}

// Ids of every ROM of a user matching `filters`, unpaged and unordered
export async function listRomIds(filters: RomFilters): Promise<string[]> {
  const rows = await prisma.rom.findMany({
    where: romWhere(filters),
    select: { id: true },
  })
  return rows.map((row) => row.id)
}

// What duplicate detection needs from every ROM of a user, and nothing more
export function listDuplicateCandidates(
  userId: string,
): Promise<DuplicateCandidate[]> {
  return prisma.rom.findMany({
    where: { userId },
    select: {
      id: true,
      fileName: true,
      title: true,
      platformId: true,
      sha1: true,
      sha1Data: true,
    },
  })
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

// Deletes the user's ROMs under `rootRelativePath` that are not in
// `keepRelativePaths`. Scoped to that subtree, so scanning `snes` never
// removes the ROMs of `gb`
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

// IDs of a user's ROMs still UNIDENTIFIED with no pending AI proposal to review
export async function listUnidentifiedRomIds(
  userId: string,
): Promise<string[]> {
  const roms = await prisma.rom.findMany({
    where: {
      userId,
      identificationSource: 'UNIDENTIFIED',
      aiProposals: { none: { status: 'PENDING' } },
    },
    select: { id: true },
    orderBy: { fileName: 'asc' },
  })
  return roms.map((rom) => rom.id)
}
