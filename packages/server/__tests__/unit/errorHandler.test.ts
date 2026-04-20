import { Request, Response, NextFunction } from 'express'
import { ZodError, z } from 'zod'
import {
  ApiError,
  globalErrorHandler,
  notFound,
  badRequest,
  unauthorized,
} from '../../src/middlewares/errorHandler'

const mockReq = {} as Request
const mockNext = jest.fn() as NextFunction

function makeRes() {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  } as unknown as Response
  return res
}

describe('ApiError', () => {
  it('constructs with statusCode and message', () => {
    const err = new ApiError(418, "I'm a teapot")
    expect(err.statusCode).toBe(418)
    expect(err.message).toBe("I'm a teapot")
  })

  it('is an instance of Error', () => {
    expect(new ApiError(400, 'bad')).toBeInstanceOf(Error)
  })

  it('has name ApiError', () => {
    expect(new ApiError(400, 'bad').name).toBe('ApiError')
  })
})

describe('ApiError factory helpers', () => {
  it('notFound creates 404 ApiError', () => {
    const err = notFound('Thing not found')
    expect(err).toBeInstanceOf(ApiError)
    expect(err.statusCode).toBe(404)
    expect(err.message).toBe('Thing not found')
  })

  it('badRequest creates 400 ApiError', () => {
    const err = badRequest('Invalid input')
    expect(err.statusCode).toBe(400)
    expect(err.message).toBe('Invalid input')
  })

  it('unauthorized creates 401 ApiError', () => {
    const err = unauthorized('Token missing')
    expect(err.statusCode).toBe(401)
    expect(err.message).toBe('Token missing')
  })
})

describe('globalErrorHandler', () => {
  it('returns statusCode + error message for ApiError', () => {
    const res = makeRes()
    globalErrorHandler(new ApiError(404, 'Not found'), mockReq, res, mockNext)
    expect(res.status).toHaveBeenCalledWith(404)
    expect(res.json).toHaveBeenCalledWith({ error: 'Not found' })
  })

  it('returns 400 with details for ZodError', () => {
    const res = makeRes()
    let zodErr: ZodError
    try {
      z.object({ name: z.string() }).parse({ name: 123 })
    } catch (e) {
      zodErr = e as ZodError
    }
    globalErrorHandler(zodErr!, mockReq, res, mockNext)
    expect(res.status).toHaveBeenCalledWith(400)
    const body = (res.json as jest.Mock).mock.calls[0][0]
    expect(body.error).toBe('Validation failed')
    expect(Array.isArray(body.details)).toBe(true)
    expect(body.details.length).toBeGreaterThan(0)
  })

  it('returns 500 for unknown errors', () => {
    const res = makeRes()
    globalErrorHandler(new Error('Unexpected'), mockReq, res, mockNext)
    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({ error: 'Internal server error' })
  })

  it('returns 500 for thrown strings', () => {
    const res = makeRes()
    globalErrorHandler('something broke', mockReq, res, mockNext)
    expect(res.status).toHaveBeenCalledWith(500)
  })

  it('returns 500 for null errors', () => {
    const res = makeRes()
    globalErrorHandler(null, mockReq, res, mockNext)
    expect(res.status).toHaveBeenCalledWith(500)
  })

  it('preserves statusCode across different ApiError codes', () => {
    const codes = [400, 401, 403, 404, 409, 422, 500]
    for (const code of codes) {
      const res = makeRes()
      globalErrorHandler(new ApiError(code, 'msg'), mockReq, res, mockNext)
      expect(res.status).toHaveBeenCalledWith(code)
    }
  })
})
