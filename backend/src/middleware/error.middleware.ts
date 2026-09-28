import type { Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { AppError } from '../lib/error.js'
import { logger } from '../lib/logger.js'

// Maps Prisma errors without importing any dependency
interface PrismaError extends Error {
  code?: string
  meta?: Record<string, unknown>
}

// Handles errors by formatting them into JSON and hiding away stack trace
export function errorMiddleware(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const requestId = (res.locals.requestId as string) || 'unknown'

  let statusCode = 500
  let code = 'INTERNAL_ERROR'
  let message = 'An internal error occurred'
  let details: unknown = undefined

  // 1. Classifies the error type
  if (err instanceof AppError) {
    statusCode = err.statusCode
    code = err.code
    message = err.message
    details = err.details
  } else if (err instanceof z.ZodError) {
    statusCode = 400
    code = 'VALIDATION_ERROR'
    message = 'Invalid request data'
    details = err.issues
  } else if (err && typeof err === 'object' && 'code' in err) {
    const prismaErr = err as PrismaError

    // Known Prisma errors: unique (P2002), not found (P2025), foreign key (P2003)
    if (prismaErr.code === 'P2002') {
      statusCode = 409
      code = 'CONFLICT'
      message = 'An identical resource already exists'
      details = prismaErr.meta
    } else if (prismaErr.code === 'P2025') {
      statusCode = 404
      code = 'NOT_FOUND'
      message = 'Requested resource not found'
      details = prismaErr.meta
    } else if (prismaErr.code === 'P2003') {
      statusCode = 409
      code = 'FOREIGN_KEY_CONSTRAINT'
      message = 'Resource is referenced elsewhere and cannot be deleted'
      details = prismaErr.meta
    }
  }

  // 2. Logs to backend with associated requestId
  const logMeta = {
    requestId,
    statusCode,
    code,
    path: req.originalUrl,
    method: req.method,
    stack: err instanceof Error ? err.stack : String(err),
  }

  // 3. 5xx are unexpected and logged as errors, anything else is a client mistake
  if (statusCode >= 500) {
    logger.error(
      err instanceof Error ? err.message : 'Unhandled fatal error',
      logMeta,
    )
  } else {
    logger.warn(`Request failed: ${message}`, logMeta)
  }

  // 4. Sends the response in JSON
  res.status(statusCode).json({
    error: {
      code,
      message,
      details,
      requestId,
    },
  })
}
