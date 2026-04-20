import { Request, Response, NextFunction } from 'express'
import { ZodError } from 'zod'
import logger from '../logger/logger'

export class ApiError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export const notFound = (msg: string) => new ApiError(404, msg)
export const badRequest = (msg: string) => new ApiError(400, msg)
export const unauthorized = (msg: string) => new ApiError(401, msg)

export function globalErrorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof ApiError) {
    res.status(err.statusCode).json({ error: err.message })
    return
  }

  if (err instanceof ZodError) {
    res.status(400).json({ error: 'Validation failed', details: err.errors })
    return
  }

  // Express JSON body-parser SyntaxError
  if (err instanceof SyntaxError && 'status' in err && (err as NodeJS.ErrnoException & { status?: number }).status === 400) {
    res.status(400).json({ error: 'Invalid JSON body' })
    return
  }

  logger.error({ err }, 'Unhandled error')
  res.status(500).json({ error: 'Internal server error' })
}
