import cors from 'cors'
import express, { type Express } from 'express'
import helmet from 'helmet'
import cookieParser from 'cookie-parser'
import { env } from './env.js'
import { requestIdMiddleware } from './middleware/request-id.middleware.js'
import { rootRouter } from './routes/index.js'
import { notFoundMiddleware } from './middleware/not-found.middleware.js'
import { errorMiddleware } from './middleware/error.middleware.js'

// Builds the Express application without binding a port
export function createApp(): Express {
  const app = express()

  // Every middleware must follow this order to ensure data integrity and error handling
  app.use(requestIdMiddleware) // Adds an UUID to identify each request

  app.use(helmet()) // Baseline hardening
  app.use(cors({ credentials: true, origin: env.CORS_ORIGIN })) // Only allow known origins to query routes

  app.use(express.json()) // JSON body parsing for every route
  app.use(cookieParser()) // `req.cookies` can be parsed easily

  // Every backend routes use `/api` as a base
  app.use('/api', rootRouter)

  app.use(notFoundMiddleware) // Always throws 404 at any unknown route
  app.use(errorMiddleware) // Catches any error (if any)

  return app
}
