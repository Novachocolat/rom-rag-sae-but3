import cors from 'cors'
import express, { type Express } from 'express'
import helmet from 'helmet'
import { env } from './env.js'
import { healthRouter } from './routes/health.routes.js'

// Builds the Express application without binding a port
export function createApp(): Express {
  const app = express()

  // Baseline hardening and JSON body parsing for every route
  app.use(helmet())
  app.use(cors({ origin: env.CORS_ORIGIN }))
  app.use(express.json())

  app.use('/api', healthRouter)

  return app
}
