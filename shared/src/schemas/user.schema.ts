import { z } from 'zod'

/** Signup payload. 12-char minimum password, per the OWASP baseline. */
export const signupSchema = z.object({
  email: z.email(),
  password: z.string().min(12),
  displayName: z.string().min(1).optional(),
})

/** Login payload. No length check, so an older password still logs in. */
export const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
})

/** User shape returned by the API — never includes `passwordHash`. */
export const publicUserSchema = z.object({
  id: z.string(),
  email: z.email(),
  displayName: z.string().nullable(),
  createdAt: z.coerce.date(),
})

export type SignupInput = z.infer<typeof signupSchema>
export type LoginInput = z.infer<typeof loginSchema>
export type PublicUser = z.infer<typeof publicUserSchema>
