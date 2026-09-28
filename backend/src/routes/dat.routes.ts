import { Router } from 'express'
import { z } from 'zod'
import { validate } from '../middleware/validate.middleware.js'
import {
  importDatFile,
  getDatCatalog,
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

datRouter.delete(
  '/dat/:id',
  validate({ params: idParamsSchema }),
  async (req, res) => {
    const { id } = req.params as z.infer<typeof idParamsSchema>
    await deleteDatFile(id)
    res.status(204).send()
  },
)
