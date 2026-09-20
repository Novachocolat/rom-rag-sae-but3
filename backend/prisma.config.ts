import path from 'node:path'
import dotenv from 'dotenv'
import { defineConfig } from 'prisma/config'

// Resolves the .env file relative to this config file
dotenv.config({ path: path.resolve(import.meta.dirname, '../.env') })

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    // Run by `prisma db seed` (npm run db:seed)
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: process.env['DATABASE_URL'],
  },
})
