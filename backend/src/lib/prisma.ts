import { PrismaPg } from '@prisma/adapter-pg'
import { env } from '../env.js'
import { PrismaClient } from '../generated/prisma/client.js'

// Creates a new PrismaPg adapter instance with the connection string from environment variables
const adapter = new PrismaPg({ connectionString: env.DATABASE_URL })

// Prisma client as a singleton to avoid exhausting database connections in development
export const prisma = new PrismaClient({ adapter })
