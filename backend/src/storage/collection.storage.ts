import type { CollectionSource } from '../generated/prisma/client.js'
import { AppError } from '../lib/error.js'
import { prisma } from '../lib/prisma.js'

export interface CollectionMemberInput {
  romId: string
  variantLabel?: string | null
}

export interface CreateCollectionInput {
  userId: string
  canonicalTitle: string
  platformId?: string | null
  source: CollectionSource
  confidence?: number | null
  members?: CollectionMemberInput[]
}

export interface ListCollectionsInput {
  userId: string
  page: number
  pageSize: number
}

// What the grouping stages need to know about a ROM
export interface GroupingRomRow {
  id: string
  fileName: string
  platformId: string | null
  sha1: string
  sha1Data: string | null
  gameExternalId: string | null
  cloneOfId: string | null
}

export interface RomNeighbor {
  romId: string
  similarity: number
}

export interface MemberSimilarity {
  romA: string
  romB: string
  similarity: number
}

function notFound(id: string): AppError {
  return AppError.notFound('COLLECTION_NOT_FOUND', `Collection ${id} not found`)
}

// Throws unless the collection exists and belongs to the user
async function assertOwned(userId: string, collectionId: string) {
  const collection = await prisma.collection.findFirst({
    where: { id: collectionId, userId },
  })
  if (!collection) throw notFound(collectionId)
  return collection
}

// A collection must only ever hold the user's own ROMs
async function assertRomsOwned(
  userId: string,
  romIds: string[],
): Promise<void> {
  const unique = [...new Set(romIds)]
  if (unique.length === 0) return

  const owned = await prisma.rom.count({
    where: { id: { in: unique }, userId },
  })
  if (owned !== unique.length) {
    throw AppError.notFound('ROM_NOT_FOUND', 'One or more ROMs were not found')
  }
}

// A ROM can only appear once per collection (composite primary key)
function uniqueMembers(members: CollectionMemberInput[]) {
  return [...new Map(members.map((member) => [member.romId, member])).values()]
}

export async function createCollection(input: CreateCollectionInput) {
  const { members = [], ...data } = input
  const unique = uniqueMembers(members)
  await assertRomsOwned(
    input.userId,
    unique.map((member) => member.romId),
  )

  return prisma.collection.create({
    data: {
      ...data,
      members: {
        create: unique.map((member) => ({
          romId: member.romId,
          variantLabel: member.variantLabel ?? null,
        })),
      },
    },
    include: { _count: { select: { members: true } } },
  })
}

// Already present members are skipped, so the call can be repeated safely
export async function addMembers(
  userId: string,
  collectionId: string,
  members: CollectionMemberInput[],
): Promise<number> {
  await assertOwned(userId, collectionId)
  const unique = uniqueMembers(members)
  await assertRomsOwned(
    userId,
    unique.map((member) => member.romId),
  )

  const { count } = await prisma.collectionMember.createMany({
    data: unique.map((member) => ({
      collectionId,
      romId: member.romId,
      variantLabel: member.variantLabel ?? null,
    })),
    skipDuplicates: true,
  })
  return count
}

export async function listCollections(input: ListCollectionsInput) {
  const where = { userId: input.userId }

  const [collections, total] = await Promise.all([
    prisma.collection.findMany({
      where,
      include: { _count: { select: { members: true } } },
      orderBy: { createdAt: 'desc' },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
    }),
    prisma.collection.count({ where }),
  ])

  return { collections, total }
}

export async function getCollectionWithRoms(userId: string, id: string) {
  const collection = await prisma.collection.findFirst({
    where: { id, userId },
    include: {
      members: {
        include: {
          rom: {
            select: {
              id: true,
              fileName: true,
              sizeBytes: true,
              region: true,
              platformId: true,
              identificationSource: true,
            },
          },
        },
      },
    },
  })
  if (!collection) throw notFound(id)
  return collection
}

export async function updateCollection(
  userId: string,
  id: string,
  data: { canonicalTitle: string },
) {
  await assertOwned(userId, id)
  return prisma.collection.update({ where: { id }, data })
}

// Moves every member of `sourceId` into `targetId`, then dissolves `sourceId`
export async function mergeCollections(
  userId: string,
  targetId: string,
  sourceId: string,
): Promise<void> {
  if (targetId === sourceId) {
    throw AppError.badRequest(
      'INVALID_MERGE',
      'A collection cannot be merged into itself',
    )
  }
  await assertOwned(userId, targetId)
  await assertOwned(userId, sourceId)

  await prisma.$transaction(async (tx) => {
    const transaction = tx as typeof prisma
    const moved: Array<{ romId: string; variantLabel: string | null }> =
      await transaction.collectionMember.findMany({
        where: { collectionId: sourceId },
      })
    await transaction.collectionMember.createMany({
      data: moved.map(
        (member: { romId: string; variantLabel: string | null }) => ({
          collectionId: targetId,
          romId: member.romId,
          variantLabel: member.variantLabel,
        }),
      ),
      skipDuplicates: true,
    })
    await transaction.collectionMember.deleteMany({
      where: { collectionId: sourceId },
    })
    await transaction.collection.delete({ where: { id: sourceId } })
  })
}

export async function removeMember(
  userId: string,
  collectionId: string,
  romId: string,
): Promise<void> {
  const { count } = await prisma.collectionMember.deleteMany({
    where: { collectionId, romId, collection: { userId } },
  })
  if (count === 0) {
    throw AppError.notFound(
      'COLLECTION_MEMBER_NOT_FOUND',
      `ROM ${romId} is not in collection ${collectionId}`,
    )
  }
}

// Dissolves the collection; the ROMs themselves are kept
export async function deleteCollection(
  userId: string,
  id: string,
): Promise<void> {
  await assertOwned(userId, id)
  await prisma.$transaction([
    prisma.collectionMember.deleteMany({ where: { collectionId: id } }),
    prisma.collection.delete({ where: { id } }),
  ])
}

// The user's ROMs with the catalog ids stages 1 and 2 rely on. With
// `onlyUngrouped`, ROMs that already belong to a collection are left out, so
// a second detection never builds the same collection twice.
export async function listRomsForGrouping(
  userId: string,
  options: { onlyUngrouped?: boolean } = {},
): Promise<GroupingRomRow[]> {
  const roms = (await prisma.rom.findMany({
    where: {
      userId,
      ...(options.onlyUngrouped && { collectionMembers: { none: {} } }),
    },
    select: {
      id: true,
      fileName: true,
      platformId: true,
      sha1: true,
      sha1Data: true,
      datEntry: { select: { gameExternalId: true, cloneOfId: true } },
    },
  })) as Array<{
    id: string
    fileName: string
    platformId: string | null
    sha1: string
    sha1Data: string | null
    datEntry: { gameExternalId: string | null; cloneOfId: string | null } | null
  }>

  return roms.map(
    (rom: {
      id: string
      fileName: string
      platformId: string | null
      sha1: string
      sha1Data: string | null
      datEntry: {
        gameExternalId: string | null
        cloneOfId: string | null
      } | null
    }) => {
      const { datEntry, ...romData } = rom
      return {
        ...romData,
        gameExternalId: datEntry?.gameExternalId ?? null,
        cloneOfId: datEntry?.cloneOfId ?? null,
      }
    },
  )
}

// Nearest ROMs of the same user by cosine similarity (1 = identical). The
// subquery form lets pgvector use its index; a ROM without embedding has none.
export async function findNeighbors(
  userId: string,
  romId: string,
  limit: number,
): Promise<RomNeighbor[]> {
  const rows = (await prisma.$queryRaw<
    Array<{ romId: string; similarity: number | string | null }>
  >`
    SELECT e."romId" AS "romId",
           1 - (e."embedding" <=> (
             SELECT "embedding" FROM "RomEmbedding" WHERE "romId" = ${romId}
           )) AS "similarity"
    FROM "RomEmbedding" e
    JOIN "Rom" r ON r."id" = e."romId"
    WHERE e."romId" <> ${romId}
      AND r."userId" = ${userId}
      AND EXISTS (SELECT 1 FROM "RomEmbedding" WHERE "romId" = ${romId})
    ORDER BY e."embedding" <=> (
      SELECT "embedding" FROM "RomEmbedding" WHERE "romId" = ${romId}
    )
    LIMIT ${limit}
  `) as Array<{ romId: string; similarity: number | string | null }>
  return rows.map(
    (row: { romId: string; similarity: number | string | null }) => ({
      romId: row.romId,
      similarity: Number(row.similarity),
    }),
  )
}

// Pairwise cosine similarity between ROMs, most similar pair first
export async function getMemberSimilarities(
  romIds: string[],
): Promise<MemberSimilarity[]> {
  if (romIds.length < 2) return []

  const rows = (await prisma.$queryRaw<
    Array<{ romA: string; romB: string; similarity: number | string | null }>
  >`
    SELECT a."romId" AS "romA",
           b."romId" AS "romB",
           1 - (a."embedding" <=> b."embedding") AS "similarity"
    FROM "RomEmbedding" a
    JOIN "RomEmbedding" b ON a."romId" < b."romId"
    WHERE a."romId" = ANY(${romIds}::text[])
      AND b."romId" = ANY(${romIds}::text[])
    ORDER BY "similarity" DESC
  `) as Array<{
    romA: string
    romB: string
    similarity: number | string | null
  }>
  return rows.map(
    (row: {
      romA: string
      romB: string
      similarity: number | string | null
    }) => ({
      romA: row.romA,
      romB: row.romB,
      similarity: Number(row.similarity),
    }),
  )
}
