import { envSchema } from '@repo/shared/schemas'

export const env = envSchema.parse(process.env)
