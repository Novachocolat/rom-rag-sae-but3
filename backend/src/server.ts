import type { Server } from 'node:http'
import { createApp } from './app.js'
import { env } from './env.js'
import { prisma } from './lib/prisma.js'
import { redis } from './lib/redis.js'
import { logger } from './lib/logger.js'
import { assertHnswIndexPresent } from './storage/embedding.storage.js'

// Starts the server and binds the application to `port` with a graceful shutdown
export function startServer(port: number = env.PORT): Server {
  const server = createApp().listen(port, () => {
    logger.info(`🎊 backend listening on port ${String(port)}`)
  })

  // Waits for the server to close, then disconnects from the database and Redis before exiting
  const shutdown = (): void => {
    server.close(() => {
      void Promise.allSettled([prisma.$disconnect(), redis.quit()]).then(() => {
        process.exit(0)
      })
    })
  }

  process.once('SIGTERM', shutdown)
  process.once('SIGINT', shutdown)

  return server
}

// Avoid starting the server when running tests
if (env.NODE_ENV !== 'test') {
  startServer() // Starts the server on the default port when not in test mode

  // Logged loudly, not fatal: the app still works, only similarity search degrades
  assertHnswIndexPresent().catch((err: unknown) => {
    logger.error('HNSW index check failed', {
      stack: err instanceof Error ? err.stack : String(err),
    })
  })
}
