import type { CollectionSource } from '../generated/prisma/client.js'
import { AppError } from '../lib/error.js'
import { prisma } from '../lib/prisma.js'

// A collection holds at least two ROMs, otherwise there is nothing to group
const MIN_COLLECTION_SIZE = 2

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

// Changes of one update; every field is optional and they are applied together
export interface CollectionChanges {
  canonicalTitle?: string
  addRomIds?: string[]
  removeRomIds?: string[]
}

// What the grouping stages need to know about a ROM
export interface GroupingRomRow {
  id: string
  fileName: string
  title: string | null
  platformId: string | null
  sha1: string
  sha1Data: string | null
  gameExternalId: string | null
  cloneOfId: string | null
}

function notFound(id: string): AppError {
  return AppError.notFound('COLLECTION_NOT_FOUND', `Collection ${id} not found`)
}

/**
 * Loads a collection of the user.
 * @throws {AppError} 404 COLLECTION_NOT_FOUND when it does not exist or
 * belongs to someone else
 */
async function assertOwned(userId: string, collectionId: string) {
  const collection = await prisma.collection.findFirst({
    where: { id: collectionId, userId },
  })
  if (!collection) throw notFound(collectionId)
  return collection
}

/**
 * Checks that every ROM belongs to the user: a collection must only ever hold
 * its owner's ROMs.
 * @throws {AppError} 404 ROM_NOT_FOUND when at least one is missing or foreign
 */
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

/**
 * Checks that the platform exists, so an unknown id answers 404 instead of
 * failing on the foreign key.
 * @throws {AppError} 404 PLATFORM_NOT_FOUND
 */
async function assertPlatformExists(platformId: string): Promise<void> {
  const found = await prisma.platform.count({ where: { id: platformId } })
  if (found === 0) {
    throw AppError.notFound(
      'PLATFORM_NOT_FOUND',
      `Platform ${platformId} not found`,
    )
  }
}

// A ROM can only appear once per collection (composite primary key); the last
// entry of a repeated ROM wins
function uniqueMembers(members: CollectionMemberInput[]) {
  return [...new Map(members.map((member) => [member.romId, member])).values()]
}

/**
 * Creates a collection and its members in one write.
 * @returns The collection with its member count (`_count.members`)
 * @throws {AppError} 404 ROM_NOT_FOUND when a member is not one of the user's
 * ROMs, 404 PLATFORM_NOT_FOUND when the platform does not exist
 */
export async function createCollection(input: CreateCollectionInput) {
  const { members = [], ...data } = input
  const unique = uniqueMembers(members)
  await assertRomsOwned(
    input.userId,
    unique.map((member) => member.romId),
  )
  if (input.platformId) await assertPlatformExists(input.platformId)

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

/**
 * Lists the user's collections, newest first.
 * @returns The requested page with member counts, and the total number of
 * collections
 */
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

/**
 * Loads a collection with its members and a summary of each ROM.
 * @throws {AppError} 404 COLLECTION_NOT_FOUND
 */
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

/**
 * Renames a collection, adds members and removes members, all in one
 * transaction: a change that fails leaves the collection untouched.
 * A ROM that is already a member is not added twice.
 * @throws {AppError} 404 COLLECTION_NOT_FOUND, 404 ROM_NOT_FOUND when a ROM to
 * add is not the user's, 404 COLLECTION_MEMBER_NOT_FOUND when a ROM to remove
 * is not a member
 */
export async function updateCollection(
  userId: string,
  id: string,
  changes: CollectionChanges,
): Promise<void> {
  const toAdd = [...new Set(changes.addRomIds ?? [])]
  const toRemove = [...new Set(changes.removeRomIds ?? [])]

  await assertOwned(userId, id)
  await assertRomsOwned(userId, toAdd)

  await prisma.$transaction(async (tx) => {
    if (changes.canonicalTitle !== undefined) {
      await tx.collection.update({
        where: { id },
        data: { canonicalTitle: changes.canonicalTitle },
      })
    }

    if (toAdd.length > 0) {
      await tx.collectionMember.createMany({
        data: toAdd.map((romId) => ({ collectionId: id, romId })),
        skipDuplicates: true,
      })
    }

    if (toRemove.length > 0) {
      const { count } = await tx.collectionMember.deleteMany({
        where: { collectionId: id, romId: { in: toRemove } },
      })
      // Throwing rolls the whole update back
      if (count !== toRemove.length) {
        throw AppError.notFound(
          'COLLECTION_MEMBER_NOT_FOUND',
          `One or more ROMs are not in collection ${id}`,
        )
      }
    }
  })
}

/**
 * Moves every member of `sourceId` into `targetId`, then deletes `sourceId`,
 * in one transaction. A ROM present in both keeps the target's variant label,
 * and the AI proposals of the source follow its members.
 * @throws {AppError} 400 INVALID_MERGE when both ids are equal, 404
 * COLLECTION_NOT_FOUND when one of them is not the user's
 */
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
    const moved = await tx.collectionMember.findMany({
      where: { collectionId: sourceId },
    })
    await tx.collectionMember.createMany({
      data: moved.map((member) => ({
        collectionId: targetId,
        romId: member.romId,
        variantLabel: member.variantLabel,
      })),
      skipDuplicates: true,
    })
    await tx.collectionMember.deleteMany({ where: { collectionId: sourceId } })
    await tx.aiProposal.updateMany({
      where: { collectionId: sourceId },
      data: { collectionId: targetId },
    })
    await tx.collection.delete({ where: { id: sourceId } })
  })
}

/**
 * Dissolves a collection; the ROMs themselves are kept.
 * Dissolving is how a user refuses an AI grouping, so the proposal that created
 * the collection is closed as REJECTED and detached from it.
 * @throws {AppError} 404 COLLECTION_NOT_FOUND
 */
export async function deleteCollection(
  userId: string,
  id: string,
): Promise<void> {
  await assertOwned(userId, id)
  const reviewedAt = new Date()

  await prisma.$transaction([
    prisma.aiProposal.updateMany({
      where: { collectionId: id, status: 'PENDING' },
      data: { status: 'REJECTED', reviewedAt, reviewedById: userId },
    }),
    prisma.aiProposal.updateMany({
      where: { collectionId: id },
      data: { collectionId: null },
    }),
    prisma.collectionMember.deleteMany({ where: { collectionId: id } }),
    prisma.collection.delete({ where: { id } }),
  ])
}

/**
 * Lists the user's ROMs with what the grouping stages rely on: file name,
 * title, hashes and the DAT ids of the matched catalog entry.
 * @param options.onlyUngrouped - Leaves out the ROMs already in a collection,
 * so a second detection never builds the same collection twice
 * @returns One row per ROM; `gameExternalId` and `cloneOfId` are null for a ROM
 * without DAT entry
 */
export async function listRomsForGrouping(
  userId: string,
  options: { onlyUngrouped?: boolean } = {},
): Promise<GroupingRomRow[]> {
  const roms = await prisma.rom.findMany({
    where: {
      userId,
      ...(options.onlyUngrouped && { collectionMembers: { none: {} } }),
    },
    select: {
      id: true,
      fileName: true,
      title: true,
      platformId: true,
      sha1: true,
      sha1Data: true,
      datEntry: { select: { gameExternalId: true, cloneOfId: true } },
    },
  })

  return roms.map(({ datEntry, ...rom }) => ({
    ...rom,
    gameExternalId: datEntry?.gameExternalId ?? null,
    cloneOfId: datEntry?.cloneOfId ?? null,
  }))
}

/**
 * Lists the user's AI groupings still waiting for review, newest first.
 * The owner is the one of the collection the proposal created.
 * @returns The requested page and the total number of pending groupings
 */
export async function listPendingGroupingProposals(
  input: ListCollectionsInput,
) {
  const where = {
    kind: 'GROUPING' as const,
    status: 'PENDING' as const,
    collection: { userId: input.userId },
  }

  const [proposals, total] = await Promise.all([
    prisma.aiProposal.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
    }),
    prisma.aiProposal.count({ where }),
  ])

  return { proposals, total }
}

/**
 * Keeps an AI collection: closes its pending proposal as ACCEPTED and takes the excluded ROMs out, in one transactions.
 * The excluded ROMs stay in the library.
 * @throws {AppError} 404 COLLECTION_NOT_FOUND, 409 NO_PENDING_PROPOSAL when nothing waits for review
 * 404 COLLECTION_MEMBER_NOT_FOUND when an excluded ROM is not a member
 * 400 COLLECTION_TOO_SMALL when fewer than two members remain
 */
export async function acceptCollection(
  userId: string,
  id: string,
  excludeRomIds: string[],
): Promise<void> {
  const toRemove = [...new Set(excludeRomIds)]
  await assertOwned(userId, id)

  await prisma.$transaction(async (tx) => {
    const { count: pending } = await tx.aiProposal.updateMany({
      where: { collectionId: id, kind: 'GROUPING', status: 'PENDING' },
      data: {
        status: 'ACCEPTED',
        reviewedAt: new Date(),
        reviewedById: userId,
      },
    })
    // Throwing rolls the whole acceptance back
    if (pending === 0) {
      throw AppError.conflict(
        'NO_PENDING_PROPOSAL',
        `Collection ${id} has no grouping waiting for review`,
      )
    }

    if (toRemove.length > 0) {
      const { count } = await tx.collectionMember.deleteMany({
        where: { collectionId: id, romId: { in: toRemove } },
      })
      if (count !== toRemove.length) {
        throw AppError.notFound(
          'COLLECTION_MEMBER_NOT_FOUND',
          `One or more ROMs are not in collection ${id}`,
        )
      }
    }

    const remaining = await tx.collectionMember.count({
      where: { collectionId: id },
    })
    if (remaining < MIN_COLLECTION_SIZE) {
      throw AppError.badRequest(
        'COLLECTION_TOO_SMALL',
        'A collection needs at least two members: reject the grouping instead',
      )
    }
  })
}
