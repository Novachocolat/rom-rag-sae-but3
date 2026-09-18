import { loginSchema, signupSchema } from '@repo/shared/schemas'
import { Router } from 'express'
import type { CookieOptions, Response } from 'express'
import { env } from '../env.js'
import { AppError } from '../lib/error.js'
import { validate } from '../middleware/validate.middleware.js'
import { requireAuth } from '../middleware/require-auth.middleware.js'
import {
  createSessionToken,
  hashPassword,
  toPublicUser,
  verifyPassword,
} from '../service/auth.service.js'
import {
  createUser,
  findUserByEmail,
  findUserById,
} from '../storage/user.storage.js'
import { deleteSession, saveSession } from '../storage/session.storage.js'

export const authRouter = Router()

// Shared cookie attributes for the session cookie. `secure: false` is
// intentional: this is a local-only application (see docs/SECURITY.md), so
// there is no HTTPS termination in front of it to make a `secure` cookie
// usable in development. `sameSite: 'lax'` blocks cross-site POST/fetch use
// of the cookie while still sending it on a top-level navigation.
const SESSION_COOKIE_OPTIONS: CookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: false,
}

// Issues a fresh session for `userId` and attaches it to the response as a
// cookie. Shared by signup and login so both start from the exact same state.
async function startSession(res: Response, userId: string): Promise<void> {
  const token = createSessionToken()
  await saveSession(token, userId, env.SESSION_TTL_SECONDS)

  res.cookie(env.SESSION_COOKIE_NAME, token, {
    ...SESSION_COOKIE_OPTIONS,
    maxAge: env.SESSION_TTL_SECONDS * 1000,
  })
}

authRouter.post(
  '/auth/signup',
  validate({ body: signupSchema }),
  async (req, res, next) => {
    try {
      const { email, password, displayName } = req.body

      const existing = await findUserByEmail(email)
      if (existing) {
        next(AppError.conflict('EMAIL_ALREADY_EXISTS', 'Email already in use'))
        return
      }

      const passwordHash = await hashPassword(password)
      const user = await createUser({ email, passwordHash, displayName })

      await startSession(res, user.id)

      res.status(201).json(toPublicUser(user))
    } catch (err) {
      next(err)
    }
  },
)

authRouter.post(
  '/auth/login',
  validate({ body: loginSchema }),
  async (req, res, next) => {
    try {
      const { email, password } = req.body

      // Never reveal whether the email or the password was wrong: a single
      // generic error for both cases (see docs/SECURITY.md).
      const invalidCredentials = AppError.unauthorized(
        'INVALID_CREDENTIALS',
        'Invalid credentials',
      )

      const user = await findUserByEmail(email)
      if (!user) {
        next(invalidCredentials)
        return
      }

      const valid = await verifyPassword(user.passwordHash, password)
      if (!valid) {
        next(invalidCredentials)
        return
      }

      await startSession(res, user.id)

      res.status(200).json(toPublicUser(user))
    } catch (err) {
      next(err)
    }
  },
)

authRouter.post('/auth/logout', async (req, res, next) => {
  try {
    const token: unknown = req.cookies[env.SESSION_COOKIE_NAME]

    // Idempotent: still succeeds if there is no cookie or the session was
    // already gone, so a double logout is never an error.
    if (typeof token === 'string' && token.length > 0) {
      await deleteSession(token)
    }

    res.clearCookie(env.SESSION_COOKIE_NAME, SESSION_COOKIE_OPTIONS)
    res.status(204).send()
  } catch (err) {
    next(err)
  }
})

authRouter.get('/auth/me', requireAuth, async (_req, res, next) => {
  try {
    const user = await findUserById(res.locals.userId as string)

    // The session was valid, but the account it points to is gone (e.g.
    // deleted after the session was created): treat it as unauthenticated.
    if (!user) {
      next(AppError.unauthorized('UNAUTHENTICATED', 'Authentication required'))
      return
    }

    res.status(200).json(toPublicUser(user))
  } catch (err) {
    next(err)
  }
})
