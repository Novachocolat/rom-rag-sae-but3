import { romListQuerySchema } from '@repo/shared/schemas'
import type {
  Paginated,
  RomDetail,
  RomListQuery,
  RomSummary,
} from '@repo/shared/types'
import { Router } from 'express'
import { z } from 'zod'
import { AppError } from '../lib/error.js'
import { requireAuth } from '../middleware/require-auth.middleware.js'
import { validate } from '../middleware/validate.middleware.js'
import {
  findRomDetail,
  listRoms,
  type ListRomsResult,
  type RomWithDetail,
} from '../storage/rom.storage.js'

export const romRouter = Router()

const idParamsSchema = z.object({ id: z.uuid() })

// Converts a ROM to its summary
function toRomSummary(rom: ListRomsResult['roms'][number]): RomSummary {
  return {
    id: rom.id,
    fileName: rom.fileName,
    sizeBytes: Number(rom.sizeBytes), // BigInt is not JSON-serializable
    platformId: rom.platformId,
    platformName: rom.platform?.name ?? null,
    identificationSource: rom.identificationSource,
    confidence: rom.confidence,
    title: rom.title,
  }
}

// Converts a ROM and its relations to the detail shape: every BigInt becomes a number and every Date an ISO string, so the body is JSON-serializable
function toRomDetail(rom: RomWithDetail): RomDetail {
  const { datEntry } = rom

  return {
    ...toRomSummary(rom),
    relativePath: rom.relativePath,
    extension: rom.extension,
    md5: rom.md5,
    sha1: rom.sha1,
    crc32: rom.crc32,
    md5Data: rom.md5Data,
    sha1Data: rom.sha1Data,
    headerBytesSkipped: rom.headerBytesSkipped,
    firstSeenAt: rom.firstSeenAt.toISOString(),
    lastScannedAt: rom.lastScannedAt.toISOString(),
    region: rom.region,
    languages: rom.languages,
    releaseYear: rom.releaseYear,
    publisher: rom.publisher,
    genre: rom.genre,
    summary: rom.summary,
    datEntry: datEntry && {
      id: datEntry.id,
      gameName: datEntry.gameName,
      romName: datEntry.romName,
      description: datEntry.description,
      sizeBytes: Number(datEntry.sizeBytes),
      crc: datEntry.crc,
      md5: datEntry.md5,
      sha1: datEntry.sha1,
      status: datEntry.status,
      datFileName: datEntry.datFile.fileName,
      datVersion: datEntry.datFile.version,
    },
  }
}

// TODO: Add Swagger documentation with swagger-jsdoc package
romRouter.get(
  '/roms',
  requireAuth,
  validate({ query: romListQuerySchema }),
  async (req, res, next) => {
    try {
      const userId = res.locals.userId as string
      const { search, platformId, identificationSource, page, pageSize } =
        req.query as unknown as RomListQuery

      const result = await listRoms({
        userId,
        search,
        platformId,
        identificationSource,
        page,
        pageSize,
      })

      const body: Paginated<RomSummary> = {
        data: result.roms.map(toRomSummary),
        pagination: {
          page: result.page,
          pageSize: result.pageSize,
          total: result.total,
          totalPages: Math.ceil(result.total / result.pageSize),
        },
      }

      res.status(200).json(body)
    } catch (err) {
      next(err)
    }
  },
)

// GET /api/roms/:id: the full record of one ROM, for its detail page
romRouter.get(
  '/roms/:id',
  requireAuth,
  validate({ params: idParamsSchema }),
  async (req, res, next) => {
    try {
      const userId = res.locals.userId as string
      const { id } = req.params as z.infer<typeof idParamsSchema>

      const rom = await findRomDetail(id, userId)
      if (!rom) {
        throw AppError.notFound('ROM_NOT_FOUND', 'ROM not found')
      }

      res.status(200).json(toRomDetail(rom))
    } catch (err) {
      next(err)
    }
  },
)
