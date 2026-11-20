import { Router } from 'express'
import swaggerUi from 'swagger-ui-express'
import type { env } from '../env.js'
import { openapiSpec } from '../lib/openapi.js'

// Swagger is a development aid: never exposed in production, so the API surface is not advertised
export function isDocsEnabled(nodeEnv: (typeof env)['NODE_ENV']): boolean {
  return nodeEnv !== 'production'
}

export const docsRouter = Router()

// GET /api/docs.json: the raw OpenAPI document, e.g. to import it in Bruno
docsRouter.get('/docs.json', (_req, res) => {
  res.status(200).json(openapiSpec)
})

// GET /api/docs: the Swagger UI
docsRouter.use('/docs', swaggerUi.serve, swaggerUi.setup(openapiSpec))
