import { redis } from '../lib/redis.js'

// Sessions are ephemeral and read on almost every request a good fit for
// Redis, already part of the stack (see ADR-010).
function sessionKey(token: string): string {
  return `session:${token}`
}

/** Creates a session that expires automatically after `ttlSeconds`. */
export function saveSession(
  token: string,
  userId: string,
  ttlSeconds: number,
): Promise<'OK'> {
  return redis.set(sessionKey(token), userId, 'EX', ttlSeconds)
}

/** Returns the session's userId, or null if unknown, expired, or deleted. */
export function getSession(token: string): Promise<string | null> {
  return redis.get(sessionKey(token))
}

/** Deletes a session immediately, unlike a stateless token that would keep
 * validating until it expires on its own. */
export async function deleteSession(token: string): Promise<void> {
  await redis.del(sessionKey(token))
}

/** Renews a session's TTL (sliding expiration) on each authenticated request. */
export async function touchSession(
  token: string,
  ttlSeconds: number,
): Promise<void> {
  await redis.expire(sessionKey(token), ttlSeconds)
}
