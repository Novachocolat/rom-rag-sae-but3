import path from 'node:path'
import dotenv from 'dotenv'
import { envSchema } from '@repo/shared/schemas'

// Load the repo-root .env before validating process.env
dotenv.config({ path: path.resolve(import.meta.dirname, '../../.env') })

export const env = envSchema.parse(process.env)
