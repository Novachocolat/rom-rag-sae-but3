import { z } from 'zod'

// Validates and parses environment variables using Zod
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  PORT: z.coerce.number().int().positive(),
  CORS_ORIGIN: z.string(),
  DATABASE_URL: z.string(),
  REDIS_URL: z.string(),

  // Ollama
  OLLAMA_BASE_URL: z.url(),
  OLLAMA_LLM_MODEL: z.string().min(1),
  OLLAMA_EMBEDDING_MODEL: z.string().min(1),
  OLLAMA_EMBEDDING_DIM: z.coerce.number().int(),
  OLLAMA_TIMEOUT_MS: z.coerce.number().int(),
  OLLAMA_NUM_CTX: z.coerce.number().int(),
  OLLAMA_TEMPERATURE: z.coerce.number().min(0).max(2),
  OLLAMA_MAX_RETRIES: z.coerce.number().int(),
  OLLAMA_THINKING: z.stringbool(),

  // ROM library
  ROM_LIBRARY_ROOT: z.string().min(1),
  ROM_EXTENSIONS: z
    .string()
    .transform((value) => value.split(',').map((ext) => ext.trim())),
  SCAN_CONCURRENCY: z.coerce.number().int().min(1),

  // Sessions
  SESSION_COOKIE_NAME: z.string(),
  SESSION_TTL_SECONDS: z.coerce.number().int(),

  // AI
  AI_CACHE_TTL_SECONDS: z.coerce.number().int(),
  AI_CONFIDENCE_THRESHOLD: z.coerce.number().min(0).max(1),

  POSTGRES_PORT: z.coerce.number().int(),
  FRONTEND_PORT: z.coerce.number().int(),
})
