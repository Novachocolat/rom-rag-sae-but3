import type { Request, Response, NextFunction } from 'express'
import { AppError } from '../lib/error.js'

// Ensures any non-existing route throws an 404 Not Found error
export function notFoundMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  next(
    AppError.notFound(
      'ROUTE_NOT_FOUND',
      `La route ${req.method} ${req.originalUrl} n'existe pas`,
    ),
  )
}
