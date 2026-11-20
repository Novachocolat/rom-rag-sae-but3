import { Router } from 'express'
import { z } from 'zod'
import { validate } from '../middleware/validate.middleware.js'
import {
  importDatFile,
  getDatCatalog,
  listPlatformsCatalog,
  deleteDatFile,
} from '../service/dat-import.service.js'

// A bare file name only: the service resolves it inside dataset/dat
const importBodySchema = z.object({
  fileName: z.string().min(1, 'File name is required'),
})

const idParamsSchema = z.object({
  id: z.uuid('Invalid ID'),
})

export const datRouter = Router()

/**
 * @openapi
 * /dat:
 *   get:
 *     tags: [DAT]
 *     summary: Lists the imported .dat catalogs, newest first
 *     responses:
 *       200:
 *         description: Imported catalogs with their platform
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required: [data]
 *               properties:
 *                 data:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/DatFile' }
 */
// GET /api/dat: every imported catalog with its platform
datRouter.get('/dat', async (_req, res) => {
  const datFiles = await getDatCatalog()
  res.json({ data: datFiles })
})

/**
 * @openapi
 * /dat/import:
 *   post:
 *     tags: [DAT]
 *     summary: Imports a .dat catalog from dataset/dat
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/DatImportRequest' }
 *           example: { fileName: 'Nintendo - Game Boy (20260915-022607).dat' }
 *     responses:
 *       201:
 *         description: Catalog imported with its entries
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/DatImportResult' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       404:
 *         description: No such file in dataset/dat (DAT_FILE_NOT_FOUND)
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ApiError' }
 *       409:
 *         description: The same catalog content is already imported
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ApiError' }
 */
// POST /api/dat/import: parses a catalog of dataset/dat and stores its entries
datRouter.post(
  '/dat/import',
  validate({ body: importBodySchema }),
  async (req, res) => {
    const { fileName } = req.body as z.infer<typeof importBodySchema>
    const result = await importDatFile(fileName)
    res.status(201).json(result)
  },
)

/**
 * @openapi
 * /dat/{id}:
 *   delete:
 *     tags: [DAT]
 *     summary: Deletes an imported catalog and its entries
 *     parameters:
 *       - $ref: '#/components/parameters/IdPath'
 *     responses:
 *       204: { description: Catalog deleted }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       409:
 *         description: A scanned ROM still references one of its entries (FOREIGN_KEY_CONSTRAINT)
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ApiError' }
 */
// DELETE /api/dat/:id: removes a catalog, refused while a ROM still points to it
datRouter.delete(
  '/dat/:id',
  validate({ params: idParamsSchema }),
  async (req, res) => {
    const { id } = req.params as z.infer<typeof idParamsSchema>
    await deleteDatFile(id)
    res.status(204).send()
  },
)

/**
 * @openapi
 * /platforms:
 *   get:
 *     tags: [DAT]
 *     summary: Lists the platforms known from the imported catalogs
 *     responses:
 *       200:
 *         description: Every platform
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/Platform' }
 */
// GET /api/platforms: the platforms of the library filters
datRouter.get('/platforms', async (_req, res, next) => {
  try {
    const platforms = await listPlatformsCatalog()
    res
      .status(200)
      .json(platforms.map((p) => ({ id: p.id, slug: p.slug, name: p.name })))
  } catch (err) {
    next(err)
  }
})
