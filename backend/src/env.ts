import { envSchema } from '@repo/shared/schemas'

// FIX (@ThFoxY, 2026-09-10): Moved `envSchema` to `/shared/schemas`
export const env = envSchema.parse(process.env)
