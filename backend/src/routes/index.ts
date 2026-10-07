import { Router } from 'express'
import { authRouter } from './auth.routes.js'
import { healthRouter } from './health.routes.js'
import { scanRouter } from './scan.routes.js'
import { libraryRouter } from './library.routes.js'
import { datRouter } from './dat.routes.js'
import { romRouter } from './rom.routes.js'
import { aiRouter } from './ai.routes.js'

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
/**
 * GET /library/browse
 */
rootRouter.use(libraryRouter)
/**
 * POST /scans
 * GET /scans
 * GET /scans/:id
 * DELETE /scans/:id
 */
rootRouter.use(scanRouter)
/**
 * GET /roms
 */
rootRouter.use(romRouter)
/**
 * POST /ai/roms/:id/identify
 * POST /ai/roms/identify-batch
 * GET /ai/proposals
 * POST /ai/proposals/:id/review
 */
rootRouter.use(aiRouter)
