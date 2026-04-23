jest.mock('../../src/config/redis', () => ({
  getRedisClient: jest.fn(),
  connectRedis: jest.fn(),
  default: undefined,
}))

import { getConflictsHandler } from '../../src/routes/conflict.routes'
import { getRedisClient } from '../../src/config/redis'
import { Request, Response, NextFunction } from 'express'

const makeReq = () => ({}) as unknown as Request
const makeRes = () => {
  const res = { json: jest.fn(), status: jest.fn() } as unknown as Response
  ;(res.status as jest.Mock).mockReturnValue(res)
  return res
}
const makeNext = () => jest.fn() as unknown as NextFunction

const mockRedis = {
  lrange: jest.fn().mockResolvedValue([]),
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(getRedisClient as jest.Mock).mockReturnValue(mockRedis)
  mockRedis.lrange.mockResolvedValue([])
})

describe('getConflictsHandler', () => {
  it('calls lrange with conflicts:recent, 0, 99', async () => {
    await getConflictsHandler(makeReq(), makeRes(), makeNext())
    expect(mockRedis.lrange).toHaveBeenCalledWith('conflicts:recent', 0, 99)
  })

  it('returns empty array when lrange returns []', async () => {
    mockRedis.lrange.mockResolvedValue([])
    const res = makeRes()
    await getConflictsHandler(makeReq(), res, makeNext())
    expect(res.json).toHaveBeenCalledWith([])
  })

  it('returns parsed JSON objects, not raw strings', async () => {
    const conflict = { entityName: 'foo', severity: 'warning', devAId: 'devB', devBId: 'devA', oldSig: 'old', newSig: 'new', impactCount: 3 }
    mockRedis.lrange.mockResolvedValue([JSON.stringify(conflict)])
    const res = makeRes()
    await getConflictsHandler(makeReq(), res, makeNext())
    const result = (res.json as jest.Mock).mock.calls[0][0]
    expect(result[0]).toEqual(conflict)
    expect(typeof result[0]).toBe('object')
  })

  it('returns multiple conflicts correctly', async () => {
    const c1 = { entityName: 'a', severity: 'info', devAId: 'devA', devBId: 'devB', oldSig: '', newSig: 'a(): void', impactCount: 0 }
    const c2 = { entityName: 'b', severity: 'critical', devAId: 'devC', devBId: 'devD', oldSig: 'old', newSig: 'b(): void', impactCount: 15 }
    mockRedis.lrange.mockResolvedValue([JSON.stringify(c1), JSON.stringify(c2)])
    const res = makeRes()
    await getConflictsHandler(makeReq(), res, makeNext())
    const result = (res.json as jest.Mock).mock.calls[0][0]
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual(c1)
    expect(result[1]).toEqual(c2)
  })

  it('response is an array, not wrapped in an object', async () => {
    const res = makeRes()
    await getConflictsHandler(makeReq(), res, makeNext())
    const result = (res.json as jest.Mock).mock.calls[0][0]
    expect(Array.isArray(result)).toBe(true)
  })

  it('calls next(err) on malformed JSON', async () => {
    mockRedis.lrange.mockResolvedValue(['not-valid-json'])
    const next = makeNext()
    await getConflictsHandler(makeReq(), makeRes(), next)
    expect(next).toHaveBeenCalledWith(expect.any(SyntaxError))
  })

  it('calls next(err) on redis failure', async () => {
    const boom = new Error('Redis down')
    mockRedis.lrange.mockRejectedValue(boom)
    const next = makeNext()
    await getConflictsHandler(makeReq(), makeRes(), next)
    expect(next).toHaveBeenCalledWith(boom)
  })
})
