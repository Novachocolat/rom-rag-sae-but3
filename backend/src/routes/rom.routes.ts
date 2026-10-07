import { romListQuerySchema } from '@repo/shared/schemas'
import type { Paginated, RomListQuery, RomSummary } from '@repo/shared/types'
import { Router } from 'express'
import { requireAuth } from '../middleware/require-auth.middleware.js'
import { validate } from '../middleware/validate.middleware.js'
import { listRoms, type ListRomsResult } from '../storage/rom.storage.js'

export const romRouter = Router()

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
