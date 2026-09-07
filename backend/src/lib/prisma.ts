import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";

// Initializes the Prisma Client with the PostgreSQL adapter, using the connection string (DATABASE_URL) from .env
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
export const prisma = new PrismaClient({ adapter }) // Exports the Prisma Client instance for database operations