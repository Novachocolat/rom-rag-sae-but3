import type { Request, Response, NextFunction } from 'express'
import type { ParamsDictionary } from 'express-serve-static-core'
import { z } from 'zod'

interface ValidationSchemas {
  body?: z.ZodType
  query?: z.ZodType
  params?: z.ZodType
}

// Validates any parameters, queries or body of a request against validation schemas
export function validate(schemas: ValidationSchemas) {
  return async (
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (schemas.params) {
        req.params = (await schemas.params.parseAsync(
          req.params,
        )) as ParamsDictionary
      }
      if (schemas.query) {
        const parsed = await schemas.query.parseAsync(req.query)
        // Express 5 makes `req.query` a getter-only property (derived from
        // req.url), so it can no longer be reassigned directly.
        Object.defineProperty(req, 'query', {
          value: parsed,
          writable: true,
          enumerable: true,
          configurable: true,
        })
      }
      if (schemas.body) {
        req.body = await schemas.body.parseAsync(req.body)
      }

      next()
    } catch (err) {
      next(err)
    }
  }
}
