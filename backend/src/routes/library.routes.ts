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

/**
 * @openapi
 * /library/browse:
 *   get:
 *     tags: [Library]
 *     summary: Lists the subdirectories of a folder of the ROM library
 *     security: [{ sessionCookie: [] }]
 *     parameters:
 *       - in: query
 *         name: path
 *         description: Folder relative to ROM_LIBRARY_ROOT, the root when empty
 *         schema: { type: string, default: '' }
 *     responses:
 *       200:
 *         description: The folder and its subdirectories
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/LibraryBrowse' }
 *       400:
 *         description: The path escapes the root or does not exist (INVALID_PATH)
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ApiError' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
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
      // Catches common errors
      if (err instanceof PathTraversalError) {
        next(AppError.badRequest('INVALID_PATH', err.message))
        return
      }
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        next(AppError.badRequest('INVALID_PATH', 'Directory does not exist'))
        return
      }
      next(err)
    }
  },
)
