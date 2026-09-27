import type { z } from 'zod'
import type {
  signupSchema,
  loginSchema,
  publicUserSchema,
} from '../schemas/user.schema.js'

export type SignupInput = z.infer<typeof signupSchema>
export type LoginInput = z.infer<typeof loginSchema>
export type PublicUser = z.infer<typeof publicUserSchema>
