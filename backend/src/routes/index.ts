import { Router } from 'express'
import { authRouter } from './auth.routes.js'
import { healthRouter } from './health.routes.js'

// Barrel file to exports all routes
export const rootRouter = Router()

rootRouter.use(healthRouter) // GET /health
rootRouter.use(authRouter) // POST /auth/signup, POST /auth/login, POST /auth/logout, GET /auth/me
