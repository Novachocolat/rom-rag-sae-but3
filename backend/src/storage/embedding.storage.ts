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
 * Returns an empty list when the ROM has no vector yet.
 * The owner filter makes the planner scan that owner's vectors and sort them
 * (exact, EXPLAIN-checked) instead of walking the HNSW index, which would cap
 * the candidates across all users before filtering.
 */
export async function findNearest(
  romId: string,
  k: number,
  minSimilarity: number,
): Promise<NearestRom[]> {
  const maxDistance = 1 - minSimilarity

  return prisma.$queryRaw<NearestRom[]>(Prisma.sql`
    SELECT
      r."id" AS "romId",
      r."fileName" AS "fileName",
      r."title" AS "title",
      1 - (e."embedding" <=> (SELECT "embedding" FROM "RomEmbedding" WHERE "romId" = ${romId})) AS "similarity"
    FROM "RomEmbedding" e
    JOIN "Rom" r ON r."id" = e."romId"
    WHERE e."romId" <> ${romId}
      AND r."userId" = (SELECT "userId" FROM "Rom" WHERE "id" = ${romId})
      AND (e."embedding" <=> (SELECT "embedding" FROM "RomEmbedding" WHERE "romId" = ${romId})) <= ${maxDistance}
    ORDER BY e."embedding" <=> (SELECT "embedding" FROM "RomEmbedding" WHERE "romId" = ${romId})
    LIMIT ${k}
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
