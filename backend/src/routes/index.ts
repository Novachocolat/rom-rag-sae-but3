import { Router } from 'express'
import { authRouter } from './auth.routes.js'
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
/**
 * POST /auth/signup
 * POST /auth/login
 * POST /auth/logout
 * GET /auth/me
 */
rootRouter.use(authRouter)
