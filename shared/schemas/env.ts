import { z } from 'zod'

// Validates and parses environment variables using Zod
// FIX (@ThFoxY, 2026-09-10): Remove the default values (no hardcoded values allowed)
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  PORT: z.coerce.number().int().positive(),
  CORS_ORIGIN: z.string(),
  DATABASE_URL: z.string(),
  REDIS_URL: z.string(),
})
