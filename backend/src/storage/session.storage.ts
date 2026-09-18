import { redis } from '../lib/redis.js'

// Sessions are ephemeral, read on almost every request, and need native
// expiry: the canonical use case for Redis rather than Postgres, and Redis
// is already part of the stack (see docs/adr).
function sessionKey(token: string): string {
  return `session:${token}`
}

// Creates a session, expiring automatically after `ttlSeconds`.
export function saveSession(
  token: string,
  userId: string,
  ttlSeconds: number,
): Promise<'OK'> {
  return redis.set(sessionKey(token), userId, 'EX', ttlSeconds)
}

// Returns the user id tied to a session token, or null if it does not exist
// (never existed, expired, or was deleted by a logout).
export function getSession(token: string): Promise<string | null> {
  return redis.get(sessionKey(token))
}

// Deletes a session outright, e.g. on logout: the token becomes unusable
// immediately, unlike a stateless token that would keep validating until it
// expires on its own.
export async function deleteSession(token: string): Promise<void> {
  await redis.del(sessionKey(token))
}

// Extends a session's TTL on every authenticated request, so an active user
// is never logged out mid-use while an idle one still expires.
export async function touchSession(
  token: string,
  ttlSeconds: number,
): Promise<void> {
  await redis.expire(sessionKey(token), ttlSeconds)
}
