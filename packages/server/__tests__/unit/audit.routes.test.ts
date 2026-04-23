jest.mock('../../src/services/audit/audit.service', () => ({
  getEntityHistory: jest.fn().mockResolvedValue([]),
  getDevHistory: jest.fn().mockResolvedValue([]),
  getRecentChanges: jest.fn().mockResolvedValue([]),
}))

jest.mock('../../src/config/redis', () => ({
  getRedisClient: jest.fn(),
  connectRedis: jest.fn(),
  default: undefined,
}))

jest.mock('../../src/config/postgres', () => ({
  db: { query: jest.fn() },
  connectPostgres: jest.fn(),
}))

jest.mock('../../src/services/graph/graph.service', () => ({
  getImpactCount: jest.fn().mockResolvedValue(0),
  getDependents: jest.fn().mockResolvedValue([]),
  getEntityClients: jest.fn().mockResolvedValue([]),
  updateDependents: jest.fn().mockResolvedValue(undefined),
  updateClientIndex: jest.fn().mockResolvedValue(undefined),
}))

import { getEntityHistoryHandler, getDevHistoryHandler, getRecentChangesHandler } from '../../src/routes/audit.routes'
import { getEntityHistory, getDevHistory, getRecentChanges } from '../../src/services/audit/audit.service'
import { Request, Response, NextFunction } from 'express'

const makeReq = (params: Record<string, string> = {}, query: Record<string, string> = {}) =>
  ({ params, query }) as unknown as Request
const makeRes = () => {
  const res = { json: jest.fn(), status: jest.fn() } as unknown as Response
  ;(res.status as jest.Mock).mockReturnValue(res)
  return res
}
const makeNext = () => jest.fn() as unknown as NextFunction

const sampleRecord = {
  id: 'uuid-1',
  entityName: 'validateUser',
  devId: 'devA',
  oldSignature: null,
  newSignature: 'validateUser(): void',
  severity: 'info',
  kind: 'function',
  body: 'function validateUser() {}',
  file: 'auth.ts',
  line: 10,
  changedAt: '2026-04-23T12:00:00.000Z',
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(getEntityHistory as jest.Mock).mockResolvedValue([])
  ;(getDevHistory as jest.Mock).mockResolvedValue([])
  ;(getRecentChanges as jest.Mock).mockResolvedValue([])
})

// ── getEntityHistoryHandler ───────────────────────────────────────────────────

describe('getEntityHistoryHandler', () => {
  it('calls getEntityHistory with req.params.name', async () => {
    const req = makeReq({ name: 'validateUser' })
    const res = makeRes()
    const next = makeNext()
    await getEntityHistoryHandler(req, res, next)
    expect(getEntityHistory).toHaveBeenCalledWith('validateUser', 50)
  })

  it('calls getEntityHistory with default limit 50 when no query.limit', async () => {
    const req = makeReq({ name: 'myFn' }, {})
    const res = makeRes()
    const next = makeNext()
    await getEntityHistoryHandler(req, res, next)
    expect(getEntityHistory).toHaveBeenCalledWith('myFn', 50)
  })

  it('calls getEntityHistory with parsed limit from query.limit', async () => {
    const req = makeReq({ name: 'myFn' }, { limit: '10' })
    const res = makeRes()
    const next = makeNext()
    await getEntityHistoryHandler(req, res, next)
    expect(getEntityHistory).toHaveBeenCalledWith('myFn', 10)
  })

  it('limit NaN defaults to 50', async () => {
    const req = makeReq({ name: 'myFn' }, { limit: 'abc' })
    const res = makeRes()
    const next = makeNext()
    await getEntityHistoryHandler(req, res, next)
    expect(getEntityHistory).toHaveBeenCalledWith('myFn', 50)
  })

  it('limit > 200 is capped at 200', async () => {
    const req = makeReq({ name: 'myFn' }, { limit: '999' })
    const res = makeRes()
    const next = makeNext()
    await getEntityHistoryHandler(req, res, next)
    expect(getEntityHistory).toHaveBeenCalledWith('myFn', 200)
  })

  it('returns array from getEntityHistory as JSON', async () => {
    ;(getEntityHistory as jest.Mock).mockResolvedValue([sampleRecord])
    const req = makeReq({ name: 'validateUser' })
    const res = makeRes()
    const next = makeNext()
    await getEntityHistoryHandler(req, res, next)
    expect(res.json).toHaveBeenCalledWith([sampleRecord])
  })

  it('returns empty array when no records', async () => {
    ;(getEntityHistory as jest.Mock).mockResolvedValue([])
    const req = makeReq({ name: 'unknownFn' })
    const res = makeRes()
    const next = makeNext()
    await getEntityHistoryHandler(req, res, next)
    expect(res.json).toHaveBeenCalledWith([])
  })

  it('calls next(err) on failure', async () => {
    const boom = new Error('db failure')
    ;(getEntityHistory as jest.Mock).mockRejectedValue(boom)
    const req = makeReq({ name: 'crashFn' })
    const res = makeRes()
    const next = makeNext()
    await getEntityHistoryHandler(req, res, next)
    expect(next).toHaveBeenCalledWith(boom)
  })
})

// ── getDevHistoryHandler ──────────────────────────────────────────────────────

describe('getDevHistoryHandler', () => {
  it('calls getDevHistory with req.params.devId', async () => {
    const req = makeReq({ devId: 'devA' })
    const res = makeRes()
    const next = makeNext()
    await getDevHistoryHandler(req, res, next)
    expect(getDevHistory).toHaveBeenCalledWith('devA', 50)
  })

  it('calls getDevHistory with default limit 50', async () => {
    const req = makeReq({ devId: 'devB' }, {})
    const res = makeRes()
    const next = makeNext()
    await getDevHistoryHandler(req, res, next)
    expect(getDevHistory).toHaveBeenCalledWith('devB', 50)
  })

  it('returns records as JSON', async () => {
    ;(getDevHistory as jest.Mock).mockResolvedValue([sampleRecord])
    const req = makeReq({ devId: 'devA' })
    const res = makeRes()
    const next = makeNext()
    await getDevHistoryHandler(req, res, next)
    expect(res.json).toHaveBeenCalledWith([sampleRecord])
  })

  it('calls next(err) on failure', async () => {
    const boom = new Error('dev query failed')
    ;(getDevHistory as jest.Mock).mockRejectedValue(boom)
    const req = makeReq({ devId: 'devC' })
    const res = makeRes()
    const next = makeNext()
    await getDevHistoryHandler(req, res, next)
    expect(next).toHaveBeenCalledWith(boom)
  })
})

// ── getRecentChangesHandler ───────────────────────────────────────────────────

describe('getRecentChangesHandler', () => {
  it('calls getRecentChanges with default limit 50', async () => {
    const req = makeReq({}, {})
    const res = makeRes()
    const next = makeNext()
    await getRecentChangesHandler(req, res, next)
    expect(getRecentChanges).toHaveBeenCalledWith(50)
  })

  it('calls getRecentChanges with parsed limit', async () => {
    const req = makeReq({}, { limit: '25' })
    const res = makeRes()
    const next = makeNext()
    await getRecentChangesHandler(req, res, next)
    expect(getRecentChanges).toHaveBeenCalledWith(25)
  })

  it('returns records as JSON', async () => {
    ;(getRecentChanges as jest.Mock).mockResolvedValue([sampleRecord])
    const req = makeReq({}, {})
    const res = makeRes()
    const next = makeNext()
    await getRecentChangesHandler(req, res, next)
    expect(res.json).toHaveBeenCalledWith([sampleRecord])
  })

  it('returns empty array when no records', async () => {
    ;(getRecentChanges as jest.Mock).mockResolvedValue([])
    const req = makeReq({}, {})
    const res = makeRes()
    const next = makeNext()
    await getRecentChangesHandler(req, res, next)
    expect(res.json).toHaveBeenCalledWith([])
  })

  it('calls next(err) on failure', async () => {
    const boom = new Error('recent query failed')
    ;(getRecentChanges as jest.Mock).mockRejectedValue(boom)
    const req = makeReq({}, {})
    const res = makeRes()
    const next = makeNext()
    await getRecentChangesHandler(req, res, next)
    expect(next).toHaveBeenCalledWith(boom)
  })
})
