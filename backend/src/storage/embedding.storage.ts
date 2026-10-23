import { Prisma } from '../generated/prisma/client.js'
import { env } from '../env.js'
import { AppError } from '../lib/error.js'
import { prisma } from '../lib/prisma.js'
import type { RomForEmbedding } from '../service/embedding-text.service.js'

const HNSW_INDEX_NAME = 'romembedding_embedding_hnsw'

export interface NearestRom {
  romId: string
  fileName: string
  title: string | null
  // 1 - cosine distance, so 1 means identical direction
  similarity: number
}

export interface RomWithoutEmbedding extends RomForEmbedding {
  id: string
}

// pgvector text literal: it is bound as a parameter and cast, never concatenated into the SQL
function toVectorLiteral(vector: number[]): string {
  if (vector.length !== env.OLLAMA_EMBEDDING_DIM) {
    throw new RangeError(
      `Expected a vector of ${String(env.OLLAMA_EMBEDDING_DIM)} dimensions, got ${String(vector.length)}`,
    )
  }
  if (!vector.every(Number.isFinite)) {
    throw new RangeError('Vector contains a non-finite value')
  }
  return `[${vector.join(',')}]`
}

// Only tagged templates below: $executeRawUnsafe with interpolation would be an SQL injection
export async function upsertEmbedding(
  romId: string,
  vector: number[],
  text: string,
  model: string,
): Promise<void> {
  const literal = toVectorLiteral(vector)

  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "RomEmbedding" ("romId", "sourceText", "model", "embedding", "createdAt")
    VALUES (${romId}, ${text}, ${model}, ${literal}::vector, NOW())
    ON CONFLICT ("romId") DO UPDATE SET
      "sourceText" = EXCLUDED."sourceText",
      "model" = EXCLUDED."model",
      "embedding" = EXCLUDED."embedding",
      "createdAt" = EXCLUDED."createdAt"
  `)
}

/**
 * Nearest neighbours of a ROM among the same owner's ROMs, closest first.
 * Returns an empty list when the ROM has no vector of the configured model yet.
 * The owner filter makes the planner scan that owner's vectors and sort them
 * (exact, EXPLAIN-checked) instead of walking the HNSW index, which would cap
 * the candidates across all users before filtering.
 * Vectors of another model are never compared: after a model switch they are
 * absent until re-embedded (ADR-010).
 */
export async function findNearest(
  romId: string,
  k: number,
  minSimilarity: number,
): Promise<NearestRom[]> {
  const maxDistance = 1 - minSimilarity
  const model = env.OLLAMA_EMBEDDING_MODEL

  return prisma.$queryRaw<NearestRom[]>(Prisma.sql`
    SELECT
      r."id" AS "romId",
      r."fileName" AS "fileName",
      r."title" AS "title",
      1 - (e."embedding" <=> (SELECT "embedding" FROM "RomEmbedding" WHERE "romId" = ${romId} AND "model" = ${model})) AS "similarity"
    FROM "RomEmbedding" e
    JOIN "Rom" r ON r."id" = e."romId"
    WHERE e."romId" <> ${romId}
      AND e."model" = ${model}
      AND r."userId" = (SELECT "userId" FROM "Rom" WHERE "id" = ${romId})
      AND (e."embedding" <=> (SELECT "embedding" FROM "RomEmbedding" WHERE "romId" = ${romId} AND "model" = ${model})) <= ${maxDistance}
    ORDER BY e."embedding" <=> (SELECT "embedding" FROM "RomEmbedding" WHERE "romId" = ${romId} AND "model" = ${model})
    LIMIT ${k}
  `)
}

export interface RomPairSimilarity {
  romA: string
  romB: string
  // 1 - cosine distance, so 1 means identical direction
  similarity: number
}

/**
 * Cosine similarity of every pair among the given ROMs, most similar first.
 * Each pair appears once (`romA` < `romB`) and a ROM without vector is absent.
 * There is no owner filter: the caller passes ROMs it has already checked.
 */
export async function getMemberSimilarities(
  romIds: string[],
): Promise<RomPairSimilarity[]> {
  if (romIds.length < 2) return []

  return prisma.$queryRaw<RomPairSimilarity[]>(Prisma.sql`
    SELECT
      a."romId" AS "romA",
      b."romId" AS "romB",
      1 - (a."embedding" <=> b."embedding") AS "similarity"
    FROM "RomEmbedding" a
    JOIN "RomEmbedding" b ON a."romId" < b."romId"
    WHERE a."romId" = ANY(${romIds}::text[])
      AND b."romId" = ANY(${romIds}::text[])
    ORDER BY "similarity" DESC
  `)
}

export function countEmbeddings(userId: string): Promise<number> {
  return prisma.romEmbedding.count({ where: { rom: { userId } } })
}

export function findRomsWithoutEmbedding(
  userId: string,
): Promise<RomWithoutEmbedding[]> {
  return prisma.rom.findMany({
    where: { userId, embedding: { is: null } },
    select: {
      id: true,
      title: true,
      fileName: true,
      publisher: true,
      genre: true,
      releaseYear: true,
      languages: true,
      platform: { select: { name: true } },
    },
    orderBy: { fileName: 'asc' },
  })
}

// Prisma cannot express the HNSW index, and a generated migration drops it again
export async function assertHnswIndexPresent(): Promise<void> {
  const rows = await prisma.$queryRaw<{ indexname: string }[]>(Prisma.sql`
    SELECT indexname FROM pg_indexes WHERE indexname = ${HNSW_INDEX_NAME}
  `)

  if (rows.length === 0) {
    throw new AppError(
      500,
      'HNSW_INDEX_MISSING',
      `pgvector index ${HNSW_INDEX_NAME} is missing: similarity search would silently fall back to a sequential scan`,
      { index: HNSW_INDEX_NAME },
    )
  }
}

/**
 * Nearest ROMs of a user to a query vector, closest first.
 * `romIds`, when given, restricts the candidates before the ranking, so a
 * filter never loses a match ranked beyond `k` among all the user's ROMs.
 * Same concern as findNearest: walking the HNSW index would cap the
 * candidates before the filters apply. A literal query vector lets the planner
 * pick that index, so the MATERIALIZED CTE forces the exact per-owner scan.
 * Only vectors of the configured model are compared; a ROM without one is
 * absent. No similarity threshold on purpose (ADR-010): the raw cosine score
 * is returned and the caller decides what to show; only `k` bounds the result.
 */
export async function findNearestToVector(
  userId: string,
  vector: number[],
  k: number,
  romIds?: string[],
): Promise<NearestRom[]> {
  const literal = toVectorLiteral(vector)
  if (romIds?.length === 0) return []

  return prisma.$queryRaw<NearestRom[]>(Prisma.sql`
    WITH candidates AS MATERIALIZED (
      SELECT
        r."id" AS "romId",
        r."fileName" AS "fileName",
        r."title" AS "title",
        e."embedding" <=> ${literal}::vector AS "distance"
      FROM "RomEmbedding" e
      JOIN "Rom" r ON r."id" = e."romId"
      WHERE r."userId" = ${userId}
        AND e."model" = ${env.OLLAMA_EMBEDDING_MODEL}
        ${romIds ? Prisma.sql`AND r."id" = ANY(${romIds}::text[])` : Prisma.empty}
    )
    SELECT "romId", "fileName", "title", 1 - "distance" AS "similarity"
    FROM candidates
    ORDER BY "distance", "romId"
    LIMIT ${k}
  `)
}
