import { randomBytes } from 'node:crypto'
import { hash as argon2Hash, verify as argon2Verify } from '@node-rs/argon2'
import type { PublicUser } from '@repo/shared/schemas'

// Pure business logic for authentication: no Express, no Prisma, no Redis.
// Storage and HTTP wiring live in `storage/` and `routes/auth.routes.ts`.

// OWASP-recommended Argon2id baseline (cheat sheet, option 1): 19 MiB of
// memory per hash, 2 iterations, single-threaded. Explicit rather than left
// to the library default so the policy survives a future default change, and
// so it can be justified on its own (memory-hardness is what makes Argon2
// resistant to GPU/ASIC cracking; 19 MiB keeps a signup/login under ~50ms on
// commodity hardware while still being expensive to brute-force at scale).
//
// `algorithm: 2` is `Algorithm.Argon2id` (the hybrid variant, resistant to
// both GPU cracking and side-channel attacks) — written as a literal because
// `Algorithm` is an ambient `const enum`, which `verbatimModuleSyntax` (see
// tsconfig.base.json) forbids importing as a value.
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

// Hashes a plaintext password for storage.
export function hashPassword(plain: string): Promise<string> {
  return argon2Hash(plain, ARGON2_OPTIONS)
}

// Verifies a plaintext password against a stored hash.
export function verifyPassword(
  hashed: string,
  plain: string,
): Promise<boolean> {
  return argon2Verify(hashed, plain, ARGON2_OPTIONS)
}

// Generates an opaque session token: 32 random bytes, base64url-encoded
// (no padding, URL/cookie-safe), unguessable and unrelated to the user id.
export function createSessionToken(): string {
  return randomBytes(32).toString('base64url')
}

// Strips every field that must never leave the backend (starting with
// `passwordHash`) before a user is serialized into an HTTP response.
export function toPublicUser(user: UserRecord): PublicUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    createdAt: user.createdAt,
  }
}
