import type { Request, Response, NextFunction } from 'express'
import type { ParamsDictionary, Query } from 'express-serve-static-core'
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
        req.query = (await schemas.query.parseAsync(req.query)) as Query
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
