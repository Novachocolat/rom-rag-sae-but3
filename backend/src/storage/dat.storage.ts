import type {
  PrismaClient,
  DatEntry,
  DatFile,
  Platform,
} from '../generated/prisma/client.js'

// Prisma Client as a storage dependency
export interface DatStorageDeps {
  prisma: PrismaClient
}

// Structured input to insert a .dat file
export interface UpsertDatFileInput {
  platformId: string
  headerName: string
  version: string | undefined
  fileName: string
  entryCount: number
  contentSha1: string
}

// Structured input of a .dat file entry
export interface DatEntryInput {
  datFileId: string
  gameName: string
  gameExternalId: string
  cloneOfId: string | undefined
  description: string
  categories: string[]
  serial: string | undefined
  romName: string
  sizeBytes: bigint
  crc: string | undefined
  md5: string | undefined
  sha1: string | undefined
  sha256: string | undefined
  status: string | undefined
}

// Structured input to create a platform
export interface CreatePlatformInput {
  slug: string // The slug is not always matching the name
  name: string
  shortName?: string
  extensions: string[] // Can have multiple extensions for the same platform
}

/**
 * Creates a platform (only if the .dat header does not identify one by default)
 * @param {DatStorageDeps} deps - Prisma Client as a dependency
 * @param {CreatePlatformInput} input - The platform to create
 */
export async function createPlatform(
  deps: DatStorageDeps,
  input: CreatePlatformInput,
): Promise<Platform> {
  return deps.prisma.platform.create({
    data: input,
  })
}

/**
 * Searches a platform using its slug
 * @param {DatStorageDeps} deps - Prisma Client as a dependency
 * @param {string} slug - The slug of the platform
 */
export async function findPlatformBySlug(
  deps: DatStorageDeps,
  slug: string,
): Promise<Platform | null> {
  return deps.prisma.platform.findUnique({
    where: { slug },
  })
}

/**
 * Creates or updates a .dat file, identified by hashing its content, without duplicates
 * @param {DatStorageDeps} deps - Prisma Client as a dependency
 * @param {UpsertDatFileInput} input - Input to insert a .dat file
 * @returns
 */
export async function upsertDatFile(
  deps: DatStorageDeps,
  input: UpsertDatFileInput,
): Promise<DatFile> {
  return deps.prisma.datFile.upsert({
    where: { contentSha1: input.contentSha1 },
    create: {
      platformId: input.platformId,
      headerName: input.headerName,
      version: input.version ?? 'unknown',
      fileName: input.fileName,
      entryCount: input.entryCount,
      contentSha1: input.contentSha1,
    },
    update: {
      entryCount: input.entryCount,
      importedAt: new Date(),
    },
  })
}

/**
 * Inserts any .dat file entry in batches of 1,000 to avoid overload
 * @param {DatStorageDeps} deps - Prisma Client as a dependency
 * @param {DatEntry[]} entries - Array containing any .dat file entry
 */
export async function bulkInsertEntries(
  deps: DatStorageDeps,
  entries: DatEntryInput[],
): Promise<number> {
  const BATCH_SIZE = 1_000
  let inserted = 0

  // `createMany` avoid inserting one by one, which would take minutes
  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE)
    const result = await deps.prisma.datEntry.createMany({
      data: batch,
    })
    inserted += result.count
  }

  return inserted // How many entries were inserted
}

/**
 * SHA-1 search matching using lowercase
 * @param {DatStorageDeps} deps - Prisma Client as a dependency
 * @param {string} sha1 - SHA-1 hash
 */
export async function findEntryBySha1(
  deps: DatStorageDeps,
  sha1: string,
): Promise<DatEntry | null> {
  return deps.prisma.datEntry.findFirst({
    where: { sha1: sha1.toLowerCase() },
  })
}

/**
 * MD5 search matching using lowercase
 * @param {DatStorageDeps} deps - Prisma Client as a dependency
 * @param {string} sha1 - MD5 hash
 */
export async function findEntryByMd5(
  deps: DatStorageDeps,
  md5: string,
): Promise<DatEntry | null> {
  return deps.prisma.datEntry.findFirst({
    where: { md5: md5.toLowerCase() },
  })
}

/**
 * Matches normalized ROM names (case-insensitive) when no SHA-1 or MD5 work
 * @param {DatStorageDeps} deps - Prisma Client as a dependency
 * @param {string} romName - ROM name
 */
export async function findEntriesByNormalizedName(
  deps: DatStorageDeps,
  romName: string,
): Promise<DatEntry[]> {
  return deps.prisma.datEntry.findMany({
    where: { romName: { equals: romName, mode: 'insensitive' } },
  })
}

/**
 * Searches a .dat file already imported for that exact content (avoid duplicates)
 * @param {DatStorageDeps} deps - Prisma Client as a dependency
 * @param {string} contentSha1 - SHA-1 of the raw .dat file content
 */
export async function findDatFileByContentSha1(
  deps: DatStorageDeps,
  contentSha1: string,
): Promise<DatFile | null> {
  return deps.prisma.datFile.findUnique({
    where: { contentSha1 },
  })
}

/**
 * Lists .dat files, including its platform, slug and name
 * @param {DatStorageDeps} deps - Prisma Client as a dependency
 */
export async function listDatFiles(
  deps: DatStorageDeps,
): Promise<(DatFile & { platform: { slug: string; name: string } })[]> {
  return deps.prisma.datFile.findMany({
    orderBy: { importedAt: 'desc' },
    include: { platform: { select: { slug: true, name: true } } },
  })
}

/**
 * Deletes a .dat file and its entries
 * @param {DatStorageDeps} deps - Prisma Client as a dependency
 * @param {string} contentSha1 - SHA-1 of the raw .dat file content
 * @throws P2003 (FOREIGN_KEY_CONSTRAINT) if an entry is still referenced by an existing ROM
 */
export async function deleteDatFile(
  deps: DatStorageDeps,
  id: string,
): Promise<DatFile> {
  return deps.prisma.$transaction(async (tx) => {
    await tx.datEntry.deleteMany({
      where: {
        datFileId: id,
      },
    })
    return tx.datFile.delete({
      where: {
        id,
      },
    })
  })
}
