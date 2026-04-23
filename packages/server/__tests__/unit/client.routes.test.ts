jest.mock('../../src/config/redis', () => ({
  getRedisClient: jest.fn(),
  connectRedis: jest.fn(),
  default: undefined,
}))

import { getClientEntitiesHandler } from '../../src/routes/client.routes'
import { getRedisClient } from '../../src/config/redis'
import { Request, Response, NextFunction } from 'express'

const makeReq = (params: Record<string, string> = {}) => ({ params }) as unknown as Request
const makeRes = () => {
  const res = { json: jest.fn(), status: jest.fn() } as unknown as Response
  ;(res.status as jest.Mock).mockReturnValue(res)
  return res
}
const makeNext = () => jest.fn() as unknown as NextFunction

const mockRedis = {
  smembers: jest.fn().mockResolvedValue([]),
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(getRedisClient as jest.Mock).mockReturnValue(mockRedis)
  mockRedis.smembers.mockResolvedValue([])
})

describe('getClientEntitiesHandler', () => {
  it('calls smembers with client:{devId}:entities', async () => {
    const req = makeReq({ devId: 'devA' })
    await getClientEntitiesHandler(req, makeRes(), makeNext())
    expect(mockRedis.smembers).toHaveBeenCalledWith('client:devA:entities')
  })

  it('returns { devId, entities } shape', async () => {
    mockRedis.smembers.mockResolvedValue(['foo', 'bar'])
    const req = makeReq({ devId: 'devB' })
    const res = makeRes()
    await getClientEntitiesHandler(req, res, makeNext())
    expect(res.json).toHaveBeenCalledWith({ devId: 'devB', entities: ['foo', 'bar'] })
  })

  it('returns empty entities array when smembers returns []', async () => {
    mockRedis.smembers.mockResolvedValue([])
    const req = makeReq({ devId: 'devC' })
    const res = makeRes()
    await getClientEntitiesHandler(req, res, makeNext())
    const result = (res.json as jest.Mock).mock.calls[0][0]
    expect(result.entities).toEqual([])
  })

  it('uses correct devId from req.params in response', async () => {
    const req = makeReq({ devId: 'alice' })
    const res = makeRes()
    await getClientEntitiesHandler(req, res, makeNext())
    const result = (res.json as jest.Mock).mock.calls[0][0]
    expect(result.devId).toBe('alice')
  })

  it('entities list populated correctly when smembers returns values', async () => {
    mockRedis.smembers.mockResolvedValue(['validateUser', 'hashPassword', 'findUser'])
    const req = makeReq({ devId: 'devX' })
    const res = makeRes()
    await getClientEntitiesHandler(req, res, makeNext())
    const result = (res.json as jest.Mock).mock.calls[0][0]
    expect(result.entities).toEqual(['validateUser', 'hashPassword', 'findUser'])
    expect(result.entities).toHaveLength(3)
  })

  it('calls next(err) on redis failure', async () => {
    const boom = new Error('Redis down')
    mockRedis.smembers.mockRejectedValue(boom)
    const req = makeReq({ devId: 'devA' })
    const next = makeNext()
    await getClientEntitiesHandler(req, makeRes(), next)
    expect(next).toHaveBeenCalledWith(boom)
  })
})
