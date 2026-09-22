import { Router } from 'express'
import { z } from 'zod'
import { AppError } from '../lib/error.js'
import { requireAuth } from '../middleware/require-auth.middleware.js'
import { validate } from '../middleware/validate.middleware.js'
import {
  PathTraversalError,
  listSubdirectories,
} from '../storage/filesystem.storage.js'

export const libraryRouter = Router()

const browseQuerySchema = z.object({
  path: z.string().optional().default(''),
})

// GET /api/library/browse?path=
// Lists subdirectories under ROM_LIBRARY_ROOT for the frontend's folder picker.
libraryRouter.get(
  '/library/browse',
  requireAuth,
  validate({ query: browseQuerySchema }),
  async (req, res, next) => {
    try {
      const { path: relativePath } = req.query as { path: string }
      const directories = await listSubdirectories(relativePath)

      res.status(200).json({ path: relativePath, directories })
    } catch (err) {
      if (err instanceof PathTraversalError) {
        next(AppError.badRequest('INVALID_PATH', err.message))
        return
      }
      next(err)
    }
  },
)
