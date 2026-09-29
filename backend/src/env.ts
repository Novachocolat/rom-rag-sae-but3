import path from 'node:path'
import dotenv from 'dotenv'
import { envSchema } from '@repo/shared/schemas'

// Load the root .env before validating process.env
dotenv.config({ path: path.resolve(import.meta.dirname, '../../.env') })

// Ensures any environment variable is processed by Zod
export const env = envSchema.parse(process.env)
