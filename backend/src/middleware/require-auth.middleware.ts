import type { NextFunction, Request, Response } from 'express'
import { env } from '../env.js'
import { AppError } from '../lib/error.js'
import { getSession, touchSession } from '../storage/session.storage.js'

// Resolves the session cookie into `res.locals.userId`, or rejects with 401.
// Every route that needs an authenticated user should be mounted behind this.
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const token: unknown = req.cookies[env.SESSION_COOKIE_NAME]

  if (typeof token !== 'string' || token.length === 0) {
    next(AppError.unauthorized('UNAUTHENTICATED', 'Authentication required'))
    return
  }

  const userId = await getSession(token)

  if (userId === null) {
    next(AppError.unauthorized('UNAUTHENTICATED', 'Authentication required'))
    return
  }

  // Sliding expiration: an active user is never logged out mid-session.
  await touchSession(token, env.SESSION_TTL_SECONDS)

  res.locals.userId = userId
  next()
}
