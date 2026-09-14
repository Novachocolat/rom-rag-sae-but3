import type { Server } from 'node:http'
import { createApp } from './app.js'
import { env } from './env.js'
import { prisma } from './lib/prisma.js'
import { redis } from './lib/redis.js'

// Starts the server and binds the application to `port` with a graceful shutdown
export function startServer(port: number = env.PORT): Server {
  const server = createApp().listen(port, () => {
    console.log(`🎊 backend listening on port ${String(port)}`)
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
}
