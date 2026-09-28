import type { Request, Response, NextFunction } from 'express'
import { AppError } from '../lib/error.js'

// Ensures any non-existing route throws a 404 Not Found error
export function notFoundMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  next(
    AppError.notFound(
      'ROUTE_NOT_FOUND',
      `Route ${req.method} ${req.originalUrl} not found`,
    ),
  )
}
