import { Router } from 'express'
import { healthRouter } from './health.routes.js'
import { scanRouter } from './scan.routes.js'

// Barrel file to exports all routes
export const rootRouter = Router()

rootRouter.use(healthRouter)
rootRouter.use('/api', scanRouter)
