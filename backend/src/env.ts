import { envSchema } from '@repo/shared/schemas'

// Ensures any environment variable is processed by Zod
export const env = envSchema.parse(process.env)
