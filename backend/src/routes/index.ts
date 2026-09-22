import { Router } from 'express'
import { healthRouter } from './health.routes.js'
import { datRouter } from './dat.routes.js'

// Barrel file to exports all routes
export const rootRouter = Router()

rootRouter.use(healthRouter) // GET /health
/**
 * GET /api/dat
 * POST /api/dat/import
 * DELETE /api/dat/:id
 */
rootRouter.use(datRouter)
