import { Request, Response, NextFunction } from 'express'
import { z, ZodError } from 'zod'
import { validateRequest } from '../../src/middlewares/validateRequest'

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    body: {},
    params: {},
    query: {},
    ...overrides,
  } as unknown as Request
}

const mockRes = {} as Response

function runMiddleware(
  req: Request,
  schemas: Parameters<typeof validateRequest>[0],
): { next: jest.Mock; req: Request } {
  const next = jest.fn()
  validateRequest(schemas)(req, mockRes, next as NextFunction)
  return { next, req }
}

describe('validateRequest middleware', () => {
  describe('body validation', () => {
    const bodySchema = z.object({ name: z.string().min(1), age: z.number().int().positive() })

    it('passes valid body through and calls next()', () => {
      const req = makeReq({ body: { name: 'Alice', age: 25 } })
      const { next } = runMiddleware(req, { body: bodySchema })
      expect(next).toHaveBeenCalledWith()
    })

    it('calls next(ZodError) when body field is missing', () => {
      const req = makeReq({ body: { name: 'Alice' } })
      const { next } = runMiddleware(req, { body: bodySchema })
      expect(next).toHaveBeenCalledWith(expect.any(ZodError))
    })

    it('calls next(ZodError) when body field has wrong type', () => {
      const req = makeReq({ body: { name: 123, age: 25 } })
      const { next } = runMiddleware(req, { body: bodySchema })
      expect(next).toHaveBeenCalledWith(expect.any(ZodError))
    })

    it('calls next(ZodError) when body is completely empty', () => {
      const req = makeReq({ body: {} })
      const { next } = runMiddleware(req, { body: bodySchema })
      expect(next).toHaveBeenCalledWith(expect.any(ZodError))
    })

    it('strips unknown fields via Zod default (strict mode off)', () => {
      const req = makeReq({ body: { name: 'Alice', age: 25, extra: 'ignored' } })
      const { next, req: mutatedReq } = runMiddleware(req, { body: bodySchema })
      expect(next).toHaveBeenCalledWith()
      expect((mutatedReq.body as Record<string, unknown>).extra).toBeUndefined()
    })

    it('mutates req.body to parsed (coerced) value', () => {
      const coercingSchema = z.object({ count: z.coerce.number() })
      const req = makeReq({ body: { count: '42' } })
      runMiddleware(req, { body: coercingSchema })
      expect(req.body.count).toBe(42)
    })
  })

  describe('params validation', () => {
    const paramsSchema = z.object({ id: z.string().uuid() })

    it('passes valid params and calls next()', () => {
      const req = makeReq({ params: { id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' } as Record<string, string> })
      const { next } = runMiddleware(req, { params: paramsSchema })
      expect(next).toHaveBeenCalledWith()
    })

    it('calls next(ZodError) for invalid UUID param', () => {
      const req = makeReq({ params: { id: 'not-a-uuid' } as Record<string, string> })
      const { next } = runMiddleware(req, { params: paramsSchema })
      expect(next).toHaveBeenCalledWith(expect.any(ZodError))
    })
  })

  describe('query validation', () => {
    const querySchema = z.object({
      format: z.enum(['json', 'markdown']).default('json'),
      depth: z.coerce.number().min(1).max(5).default(2),
    })

    it('passes valid query', () => {
      const req = makeReq({ query: { format: 'markdown', depth: '3' } as Record<string, string> })
      const { next } = runMiddleware(req, { query: querySchema })
      expect(next).toHaveBeenCalledWith()
    })

    it('applies default values when query params omitted', () => {
      const req = makeReq({ query: {} })
      const { next, req: mutated } = runMiddleware(req, { query: querySchema })
      expect(next).toHaveBeenCalledWith()
      expect((mutated.query as Record<string, unknown>).format).toBe('json')
      expect((mutated.query as Record<string, unknown>).depth).toBe(2)
    })

    it('calls next(ZodError) for invalid enum value', () => {
      const req = makeReq({ query: { format: 'xml' } as Record<string, string> })
      const { next } = runMiddleware(req, { query: querySchema })
      expect(next).toHaveBeenCalledWith(expect.any(ZodError))
    })

    it('calls next(ZodError) when depth out of range', () => {
      const req = makeReq({ query: { depth: '99' } as Record<string, string> })
      const { next } = runMiddleware(req, { query: querySchema })
      expect(next).toHaveBeenCalledWith(expect.any(ZodError))
    })
  })

  describe('multi-schema validation', () => {
    it('validates body + params + query together', () => {
      const req = makeReq({
        body: { code: 'const x = 1' },
        params: { name: 'validateUser' } as Record<string, string>,
        query: { format: 'json' } as Record<string, string>,
      })
      const { next } = runMiddleware(req, {
        body: z.object({ code: z.string() }),
        params: z.object({ name: z.string() }),
        query: z.object({ format: z.string() }),
      })
      expect(next).toHaveBeenCalledWith()
    })

    it('fails on params even when body is valid', () => {
      const req = makeReq({
        body: { code: 'good' },
        params: { name: '' } as Record<string, string>,
      })
      const { next } = runMiddleware(req, {
        body: z.object({ code: z.string() }),
        params: z.object({ name: z.string().min(1) }),
      })
      expect(next).toHaveBeenCalledWith(expect.any(ZodError))
    })

    it('does not call next() twice on error', () => {
      const req = makeReq({ body: { bad: true } })
      const { next } = runMiddleware(req, {
        body: z.object({ name: z.string() }),
      })
      expect(next).toHaveBeenCalledTimes(1)
    })
  })

  describe('no schemas provided', () => {
    it('calls next() when no schemas given', () => {
      const req = makeReq()
      const { next } = runMiddleware(req, {})
      expect(next).toHaveBeenCalledWith()
    })
  })
})
