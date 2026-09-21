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

// secure: false because this is a local-only app with no TLS in front of it.
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

      // Check-then-insert: a small race window exists, acceptable at this
      // project's scale.
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

      // Same error for a wrong email or a wrong password: never reveal which.
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

    // Idempotent: a missing or already-gone session is not an error.
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

    // Session valid, but the account behind it is gone: treat as logged out.
    if (!user) {
      next(AppError.unauthorized('UNAUTHENTICATED', 'Authentication required'))
      return
    }

    res.status(200).json(toPublicUser(user))
  } catch (err) {
    next(err)
  }
})
