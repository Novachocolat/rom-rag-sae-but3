import { z } from 'zod'

// Payload to create a new account. 12 chars is the minimum recommended by
// OWASP for a password that is not paired with a second factor.
export const signupSchema = z.object({
  email: z.email(),
  password: z.string().min(12),
  displayName: z.string().min(1).optional(),
})

// Payload to open a session. No length check here: it must keep accepting an
// existing password even if the signup policy changes later.
export const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
})

// Shape of a user as returned by the API. `passwordHash` must never appear
// here, or anywhere else in an HTTP response.
export const publicUserSchema = z.object({
  id: z.string(),
  email: z.email(),
  displayName: z.string().nullable(),
  createdAt: z.coerce.date(),
})

export type SignupInput = z.infer<typeof signupSchema>
export type LoginInput = z.infer<typeof loginSchema>
export type PublicUser = z.infer<typeof publicUserSchema>
