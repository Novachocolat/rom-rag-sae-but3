import type { Request, Response, NextFunction } from 'express'
import crypto from 'crypto'

// Generates an UUID for each request and helps to group logs from the same request
export function requestIdMiddleware(
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  const requestId = crypto.randomUUID()

  res.locals.requestId = requestId

  res.setHeader('X-Request-Id', requestId)

  next()
}
