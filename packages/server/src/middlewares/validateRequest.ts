import { Request, Response, NextFunction } from 'express'
import { ZodSchema } from 'zod'

interface ValidationTarget {
  body?: ZodSchema
  params?: ZodSchema
  query?: ZodSchema
}

export function validateRequest(schemas: ValidationTarget) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (schemas.body) req.body = schemas.body.parse(req.body)
      if (schemas.params) req.params = schemas.params.parse(req.params) as Record<string, string>
      if (schemas.query) req.query = schemas.query.parse(req.query) as Record<string, string>
      next()
    } catch (err) {
      next(err)
    }
  }
}
