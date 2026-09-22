import { Router } from 'express'
import { z } from 'zod'
import { validate } from '../middleware/validate.middleware.js'
import {
  importDatFile,
  getDatCatalog,
  deleteDatFile,
} from '../service/dat-import.service.js'

const importBodySchema = z.object({
  fileName: z.string().min(1, 'Le nom du fichier est requis'),
})

const idParamsSchema = z.object({
  id: z.uuid('ID invalide'),
})

export const datRouter = Router()

// TODO: Add Swagger documentation with swagger-jsdoc package
datRouter.get('/dat', async (_req, res) => {
  const datFiles = await getDatCatalog()
  res.json({ data: datFiles })
})

datRouter.post(
  '/dat/import',
  validate({ body: importBodySchema }),
  async (req, res) => {
    const { fileName } = req.body as z.infer<typeof importBodySchema>
    const result = await importDatFile(fileName)
    res.status(201).json(result)
  },
)

datRouter.post(
  '/dat/:id',
  validate({ params: idParamsSchema }),
  async (req, res) => {
    const { id } = req.params as z.infer<typeof idParamsSchema>
    await deleteDatFile(id)
    res.status(204).send()
  },
)
