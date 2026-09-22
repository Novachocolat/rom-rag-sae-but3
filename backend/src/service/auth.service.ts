import { randomBytes } from 'node:crypto'
import { hash as argon2Hash, verify as argon2Verify } from '@node-rs/argon2'
import type { PublicUser } from '@repo/shared/schemas'

const ARGON2_OPTIONS = {
  algorithm: 2,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
}

interface UserRecord {
  id: string
  email: string
  displayName: string | null
  createdAt: Date
}

/** Hashes a plaintext password with Argon2id for storage. */
export function hashPassword(plain: string): Promise<string> {
  return argon2Hash(plain, ARGON2_OPTIONS)
}

/** Verifies a plaintext password against a stored Argon2id hash. */
export function verifyPassword(
  hashed: string,
  plain: string,
): Promise<boolean> {
  return argon2Verify(hashed, plain, ARGON2_OPTIONS)
}

/** Generates an opaque, unguessable session token (32 random bytes, base64url). */
export function createSessionToken(): string {
  return randomBytes(32).toString('base64url')
}

/** Projects a user record to the API's public shape : drops `passwordHash`. */
export function toPublicUser(user: UserRecord): PublicUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    createdAt: user.createdAt,
  }
}
