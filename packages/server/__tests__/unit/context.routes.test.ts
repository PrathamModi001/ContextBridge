jest.mock('../../src/services/context/context.service', () => ({
  buildSnapshot: jest.fn(),
  buildMarkdownSnapshot: jest.fn(),
  validateCodeUsage: jest.fn(),
}))

import { getSnapshotHandler, validateUsageHandler } from '../../src/routes/context.routes'
import { buildSnapshot, buildMarkdownSnapshot, validateCodeUsage } from '../../src/services/context/context.service'
import { Request, Response, NextFunction } from 'express'

const makeNext = () => jest.fn() as unknown as NextFunction

function makeReq(overrides: Partial<Request> = {}): Request {
  return { query: {}, body: {}, params: {}, ...overrides } as unknown as Request
}

function makeRes() {
  const res: Partial<Response> = {
    json: jest.fn(),
    status: jest.fn().mockReturnThis() as unknown as Response['status'],
    type: jest.fn().mockReturnThis() as unknown as Response['type'],
    send: jest.fn(),
  }
  return res as unknown as Response
}

const mockBuildSnapshot = buildSnapshot as jest.MockedFunction<typeof buildSnapshot>
const mockBuildMarkdown = buildMarkdownSnapshot as jest.MockedFunction<typeof buildMarkdownSnapshot>
const mockValidateUsage = validateCodeUsage as jest.MockedFunction<typeof validateCodeUsage>

const FAKE_SNAPSHOT = { snapshotAt: '2024', entityCount: 2, entities: [] }

describe('getSnapshotHandler', () => {
  it('returns JSON snapshot by default', async () => {
    mockBuildSnapshot.mockResolvedValueOnce(FAKE_SNAPSHOT)
    const req = makeReq({ query: {} })
    const res = makeRes()
    await getSnapshotHandler(req, res, makeNext())
    expect(res.json).toHaveBeenCalledWith(FAKE_SNAPSHOT)
  })

  it('returns markdown when format=markdown', async () => {
    mockBuildSnapshot.mockResolvedValueOnce(FAKE_SNAPSHOT)
    mockBuildMarkdown.mockReturnValueOnce('# ContextBridge Snapshot')
    const req = makeReq({ query: { format: 'markdown' } })
    const res = makeRes()
    await getSnapshotHandler(req, res, makeNext())
    expect(res.type).toHaveBeenCalledWith('text/markdown')
    expect(res.send).toHaveBeenCalledWith('# ContextBridge Snapshot')
  })

  it('passes entity filter to buildSnapshot', async () => {
    mockBuildSnapshot.mockResolvedValueOnce(FAKE_SNAPSHOT)
    const req = makeReq({ query: { entity: 'validateUser', depth: '2' } })
    const res = makeRes()
    await getSnapshotHandler(req, res, makeNext())
    expect(mockBuildSnapshot).toHaveBeenCalledWith({ entity: 'validateUser', depth: 2 })
  })

  it('calls next(err) on failure', async () => {
    const err = new Error('Redis down')
    mockBuildSnapshot.mockRejectedValueOnce(err)
    const next = makeNext()
    await getSnapshotHandler(makeReq(), makeRes(), next)
    expect(next).toHaveBeenCalledWith(err)
  })

  it('returns 400 when depth is not a valid integer', async () => {
    const next = makeNext()
    await getSnapshotHandler(makeReq({ query: { depth: 'abc' } }), makeRes(), next)
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }))
  })
})

describe('validateUsageHandler', () => {
  it('returns conflicts for submitted code', async () => {
    const conflicts = [{ entity: 'foo', yourSignature: 'foo()', liveSignature: 'foo(a: string)', severity: 'warning', devId: 'devA', correctedCall: 'foo(a)' }]
    mockValidateUsage.mockResolvedValueOnce(conflicts)
    const req = makeReq({ body: { code: 'foo()' } })
    const res = makeRes()
    await validateUsageHandler(req, res, makeNext())
    expect(res.json).toHaveBeenCalledWith({ conflicts })
  })

  it('returns 400 when code is missing', async () => {
    const next = makeNext()
    await validateUsageHandler(makeReq({ body: {} }), makeRes(), next)
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }))
  })

  it('returns 400 when code is empty string', async () => {
    const next = makeNext()
    await validateUsageHandler(makeReq({ body: { code: '   ' } }), makeRes(), next)
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }))
  })

  it('returns 400 when code exceeds 20k chars', async () => {
    const next = makeNext()
    await validateUsageHandler(makeReq({ body: { code: 'x'.repeat(20_001) } }), makeRes(), next)
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }))
  })

  it('returns 400 when code is not a string', async () => {
    const next = makeNext()
    await validateUsageHandler(makeReq({ body: { code: 42 } }), makeRes(), next)
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }))
  })

  it('calls next(err) on service failure', async () => {
    mockValidateUsage.mockRejectedValueOnce(new Error('Redis error'))
    const next = makeNext()
    await validateUsageHandler(makeReq({ body: { code: 'const x = 1' } }), makeRes(), next)
    expect(next).toHaveBeenCalledWith(expect.any(Error))
  })

  it('returns empty conflicts for valid code', async () => {
    mockValidateUsage.mockResolvedValueOnce([])
    const req = makeReq({ body: { code: 'const x = 1' } })
    const res = makeRes()
    await validateUsageHandler(req, res, makeNext())
    expect(res.json).toHaveBeenCalledWith({ conflicts: [] })
  })
})
