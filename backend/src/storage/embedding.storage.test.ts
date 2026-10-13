import type { Sql } from '@prisma/client/runtime/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { env } from '../env.js'
import { prisma } from '../lib/prisma.js'
import {
  assertHnswIndexPresent,
  countEmbeddings,
  findNearest,
  findRomsWithoutEmbedding,
  getMemberSimilarities,
  upsertEmbedding,
} from './embedding.storage.js'

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(),
    romEmbedding: { count: vi.fn() },
    rom: { count: vi.fn(), findMany: vi.fn() },
  },
}))

const vector = Array.from({ length: env.OLLAMA_EMBEDDING_DIM }, () => 0.5)

// The raw call receives a Prisma.sql object: its values are the bound parameters
function sqlOf(mock: unknown): Sql {
  return vi.mocked(mock as (sql: Sql) => unknown).mock.calls[0]?.[0] as Sql
}

// Tests for the pgvector storage, the only place allowed to write raw SQL
describe('embedding.storage', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  describe('upsertEmbedding', () => {
    it('binds every value as a parameter', async () => {
      await upsertEmbedding('rom-1', vector, 'x\'; DROP TABLE "Rom";--', 'm')

      const sql = sqlOf(prisma.$executeRaw)
      expect(sql.values).toContain('x\'; DROP TABLE "Rom";--')
      expect(sql.values).toContain(`[${vector.join(',')}]`)
      expect(sql.sql).not.toContain('DROP TABLE')
      expect(sql.sql).toContain('::vector')
    })

    it('rejects a vector of the wrong dimension', async () => {
      await expect(upsertEmbedding('rom-1', [0.1], 't', 'm')).rejects.toThrow(
        RangeError,
      )
      expect(prisma.$executeRaw).not.toHaveBeenCalled()
    })

    it('rejects a vector with a non-finite value', async () => {
      const bad = [...vector]
      bad[0] = Number.NaN

      await expect(upsertEmbedding('rom-1', bad, 't', 'm')).rejects.toThrow(
        RangeError,
      )
    })
  })

  describe('findNearest', () => {
    it('orders by cosine distance and converts the threshold to a distance', async () => {
      const rows = [
        { romId: 'rom-2', fileName: 'b.gb', title: null, similarity: 0.95 },
      ]
      vi.mocked(prisma.$queryRaw).mockResolvedValue(rows)

      const result = await findNearest('rom-1', 5, 0.9)

      expect(result).toEqual(rows)
      const sql = sqlOf(prisma.$queryRaw)
      expect(sql.sql).toContain('<=>')
      expect(sql.values).toContain(5)
      expect(sql.values.some((v) => Math.abs(Number(v) - 0.1) < 1e-9)).toBe(
        true,
      )
    })
  })

  describe('getMemberSimilarities', () => {
    it('binds the ids as one array parameter and returns the pairs', async () => {
      const rows = [{ romA: 'rom-1', romB: 'rom-2', similarity: 0.97 }]
      vi.mocked(prisma.$queryRaw).mockResolvedValue(rows)

      const result = await getMemberSimilarities(['rom-1', 'rom-2'])

      expect(result).toEqual(rows)
      const sql = sqlOf(prisma.$queryRaw)
      expect(sql.values).toContainEqual(['rom-1', 'rom-2'])
      expect(sql.sql).toContain('<=>')
    })

    it('does not query for fewer than two ROMs', async () => {
      expect(await getMemberSimilarities(['rom-1'])).toEqual([])
      expect(prisma.$queryRaw).not.toHaveBeenCalled()
    })
  })

  describe('counts and lookups', () => {
    it('countEmbeddings is scoped to the user', async () => {
      vi.mocked(prisma.romEmbedding.count).mockResolvedValue(3)

      expect(await countEmbeddings('user-1')).toBe(3)
      expect(prisma.romEmbedding.count).toHaveBeenCalledWith({
        where: { rom: { userId: 'user-1' } },
      })
    })

    it('findRomsWithoutEmbedding selects the fields used for the text', async () => {
      vi.mocked(prisma.rom.findMany).mockResolvedValue([])

      await findRomsWithoutEmbedding('user-1')

      expect(prisma.rom.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1', embedding: { is: null } },
        }),
      )
    })
  })

  describe('assertHnswIndexPresent', () => {
    it('resolves when the index exists', async () => {
      vi.mocked(prisma.$queryRaw).mockResolvedValue([
        { indexname: 'romembedding_embedding_hnsw' },
      ])

      await expect(assertHnswIndexPresent()).resolves.toBeUndefined()
    })

    it('fails explicitly when the index is missing', async () => {
      vi.mocked(prisma.$queryRaw).mockResolvedValue([])

      await expect(assertHnswIndexPresent()).rejects.toMatchObject({
        code: 'HNSW_INDEX_MISSING',
      })
    })
  })
})
