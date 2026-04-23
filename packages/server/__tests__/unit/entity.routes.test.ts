jest.mock('../../src/config/redis', () => ({
  getRedisClient: jest.fn(),
  connectRedis: jest.fn(),
  default: undefined,
}))

jest.mock('../../src/services/graph/graph.service', () => ({
  getImpactCount: jest.fn().mockResolvedValue(0),
  getDependents: jest.fn().mockResolvedValue([]),
  getEntityClients: jest.fn().mockResolvedValue([]),
  updateDependents: jest.fn().mockResolvedValue(undefined),
  updateClientIndex: jest.fn().mockResolvedValue(undefined),
}))

import {
  getEntityHandler,
  getEntityImpactHandler,
  getEntityDependentsHandler,
  getEntityClientsHandler,
} from '../../src/routes/entity.routes'
import { getRedisClient } from '../../src/config/redis'
import { getImpactCount, getDependents, getEntityClients } from '../../src/services/graph/graph.service'
import { Request, Response, NextFunction } from 'express'

const makeReq = (params: Record<string, string> = {}) => ({ params }) as unknown as Request
const makeRes = () => {
  const res = { json: jest.fn(), status: jest.fn() } as unknown as Response
  ;(res.status as jest.Mock).mockReturnValue(res)
  return res
}
const makeNext = () => jest.fn() as unknown as NextFunction

const mockRedis = {
  hgetall: jest.fn().mockResolvedValue({}),
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(getRedisClient as jest.Mock).mockReturnValue(mockRedis)
  mockRedis.hgetall.mockResolvedValue({})
  ;(getImpactCount as jest.Mock).mockResolvedValue(0)
  ;(getDependents as jest.Mock).mockResolvedValue([])
  ;(getEntityClients as jest.Mock).mockResolvedValue([])
})

// ── getEntityHandler ──────────────────────────────────────────────────────────

describe('getEntityHandler', () => {
  it('calls hgetall with entity:{name} key', async () => {
    const fields = { name: 'foo', signature: 'foo(): void', body: 'function foo() {}', devId: 'devA', file: 'a.ts', kind: 'function', line: '5', updatedAt: '2026-01-01T00:00:00.000Z' }
    mockRedis.hgetall.mockResolvedValue(fields)
    const req = makeReq({ name: 'foo' })
    const res = makeRes()
    const next = makeNext()
    await getEntityHandler(req, res, next)
    expect(mockRedis.hgetall).toHaveBeenCalledWith('entity:foo')
  })

  it('returns entity fields in response', async () => {
    const fields = { name: 'foo', signature: 'foo(): void', body: 'function foo() {}', devId: 'devA', file: 'a.ts', kind: 'function', line: '5', updatedAt: '2026-01-01T00:00:00.000Z' }
    mockRedis.hgetall.mockResolvedValue(fields)
    const req = makeReq({ name: 'foo' })
    const res = makeRes()
    const next = makeNext()
    await getEntityHandler(req, res, next)
    expect(res.json).toHaveBeenCalled()
    const result = (res.json as jest.Mock).mock.calls[0][0]
    expect(result.name).toBe('foo')
    expect(result.signature).toBe('foo(): void')
  })

  it('parses line field to number (not string) in response', async () => {
    const fields = { name: 'foo', signature: 'foo(): void', body: '', devId: 'devA', file: 'a.ts', kind: 'function', line: '42', updatedAt: '2026-01-01T00:00:00.000Z' }
    mockRedis.hgetall.mockResolvedValue(fields)
    const req = makeReq({ name: 'foo' })
    const res = makeRes()
    const next = makeNext()
    await getEntityHandler(req, res, next)
    const result = (res.json as jest.Mock).mock.calls[0][0]
    expect(result.line).toBe(42)
    expect(typeof result.line).toBe('number')
  })

  it('calls next(notFound) when hgetall returns empty object', async () => {
    mockRedis.hgetall.mockResolvedValue({})
    const req = makeReq({ name: 'missing' })
    const res = makeRes()
    const next = makeNext()
    await getEntityHandler(req, res, next)
    expect(next).toHaveBeenCalledTimes(1)
    const err = (next as jest.Mock).mock.calls[0][0]
    expect(err).toBeDefined()
    expect(err.statusCode).toBe(404)
    expect(err.message).toContain('missing')
  })

  it('calls next(notFound) when hgetall returns null', async () => {
    mockRedis.hgetall.mockResolvedValue(null)
    const req = makeReq({ name: 'ghost' })
    const res = makeRes()
    const next = makeNext()
    await getEntityHandler(req, res, next)
    expect(next).toHaveBeenCalledTimes(1)
    const err = (next as jest.Mock).mock.calls[0][0]
    expect(err.statusCode).toBe(404)
  })

  it('returns all entity fields including signature, body, devId, file, kind, updatedAt', async () => {
    const fields = {
      name: 'myFn',
      signature: 'myFn(x: number): string',
      body: 'function myFn(x) { return String(x) }',
      devId: 'devB',
      file: 'src/util.ts',
      kind: 'function',
      line: '99',
      updatedAt: '2026-04-23T12:00:00.000Z',
    }
    mockRedis.hgetall.mockResolvedValue(fields)
    const req = makeReq({ name: 'myFn' })
    const res = makeRes()
    const next = makeNext()
    await getEntityHandler(req, res, next)
    const result = (res.json as jest.Mock).mock.calls[0][0]
    expect(result.signature).toBe('myFn(x: number): string')
    expect(result.body).toBe('function myFn(x) { return String(x) }')
    expect(result.devId).toBe('devB')
    expect(result.file).toBe('src/util.ts')
    expect(result.kind).toBe('function')
    expect(result.updatedAt).toBe('2026-04-23T12:00:00.000Z')
  })

  it('calls next(err) when redis throws', async () => {
    const boom = new Error('Redis exploded')
    mockRedis.hgetall.mockRejectedValue(boom)
    const req = makeReq({ name: 'foo' })
    const res = makeRes()
    const next = makeNext()
    await getEntityHandler(req, res, next)
    expect(next).toHaveBeenCalledWith(boom)
  })
})

// ── getEntityImpactHandler ────────────────────────────────────────────────────

describe('getEntityImpactHandler', () => {
  it('calls getImpactCount with entity name from req.params.name', async () => {
    ;(getImpactCount as jest.Mock).mockResolvedValue(3)
    const req = makeReq({ name: 'myService' })
    const res = makeRes()
    const next = makeNext()
    await getEntityImpactHandler(req, res, next)
    expect(getImpactCount).toHaveBeenCalledWith('myService')
  })

  it('returns { entityName, impactCount } shape', async () => {
    ;(getImpactCount as jest.Mock).mockResolvedValue(7)
    const req = makeReq({ name: 'parseInput' })
    const res = makeRes()
    const next = makeNext()
    await getEntityImpactHandler(req, res, next)
    expect(res.json).toHaveBeenCalledWith({ entityName: 'parseInput', impactCount: 7 })
  })

  it('returns impactCount 0 correctly', async () => {
    ;(getImpactCount as jest.Mock).mockResolvedValue(0)
    const req = makeReq({ name: 'isolated' })
    const res = makeRes()
    const next = makeNext()
    await getEntityImpactHandler(req, res, next)
    const result = (res.json as jest.Mock).mock.calls[0][0]
    expect(result.impactCount).toBe(0)
  })

  it('calls next(err) on failure', async () => {
    const boom = new Error('graph failure')
    ;(getImpactCount as jest.Mock).mockRejectedValue(boom)
    const req = makeReq({ name: 'badEntity' })
    const res = makeRes()
    const next = makeNext()
    await getEntityImpactHandler(req, res, next)
    expect(next).toHaveBeenCalledWith(boom)
  })
})

// ── getEntityDependentsHandler ────────────────────────────────────────────────

describe('getEntityDependentsHandler', () => {
  it('calls getDependents with entity name', async () => {
    ;(getDependents as jest.Mock).mockResolvedValue(['depA', 'depB'])
    const req = makeReq({ name: 'core' })
    const res = makeRes()
    const next = makeNext()
    await getEntityDependentsHandler(req, res, next)
    expect(getDependents).toHaveBeenCalledWith('core')
  })

  it('returns { entityName, dependents } shape', async () => {
    ;(getDependents as jest.Mock).mockResolvedValue(['x', 'y'])
    const req = makeReq({ name: 'baseUtil' })
    const res = makeRes()
    const next = makeNext()
    await getEntityDependentsHandler(req, res, next)
    expect(res.json).toHaveBeenCalledWith({ entityName: 'baseUtil', dependents: ['x', 'y'] })
  })

  it('returns empty dependents array when none', async () => {
    ;(getDependents as jest.Mock).mockResolvedValue([])
    const req = makeReq({ name: 'leaf' })
    const res = makeRes()
    const next = makeNext()
    await getEntityDependentsHandler(req, res, next)
    const result = (res.json as jest.Mock).mock.calls[0][0]
    expect(result.dependents).toEqual([])
  })

  it('calls next(err) on failure', async () => {
    const boom = new Error('smembers failed')
    ;(getDependents as jest.Mock).mockRejectedValue(boom)
    const req = makeReq({ name: 'bad' })
    const res = makeRes()
    const next = makeNext()
    await getEntityDependentsHandler(req, res, next)
    expect(next).toHaveBeenCalledWith(boom)
  })
})

// ── getEntityClientsHandler ───────────────────────────────────────────────────

describe('getEntityClientsHandler', () => {
  it('calls getEntityClients with entity name', async () => {
    ;(getEntityClients as jest.Mock).mockResolvedValue(['devA'])
    const req = makeReq({ name: 'sharedHelper' })
    const res = makeRes()
    const next = makeNext()
    await getEntityClientsHandler(req, res, next)
    expect(getEntityClients).toHaveBeenCalledWith('sharedHelper')
  })

  it('returns { entityName, clients } shape', async () => {
    ;(getEntityClients as jest.Mock).mockResolvedValue(['devA', 'devB'])
    const req = makeReq({ name: 'auth' })
    const res = makeRes()
    const next = makeNext()
    await getEntityClientsHandler(req, res, next)
    expect(res.json).toHaveBeenCalledWith({ entityName: 'auth', clients: ['devA', 'devB'] })
  })

  it('returns empty clients array when none', async () => {
    ;(getEntityClients as jest.Mock).mockResolvedValue([])
    const req = makeReq({ name: 'unused' })
    const res = makeRes()
    const next = makeNext()
    await getEntityClientsHandler(req, res, next)
    const result = (res.json as jest.Mock).mock.calls[0][0]
    expect(result.clients).toEqual([])
  })

  it('calls next(err) on failure', async () => {
    const boom = new Error('client fetch failed')
    ;(getEntityClients as jest.Mock).mockRejectedValue(boom)
    const req = makeReq({ name: 'broken' })
    const res = makeRes()
    const next = makeNext()
    await getEntityClientsHandler(req, res, next)
    expect(next).toHaveBeenCalledWith(boom)
  })
})
