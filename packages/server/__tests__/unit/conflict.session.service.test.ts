// Declare the shared mock redis object in module scope so the factory closure captures it.
// We use a plain object with jest.fn() values — these are created once and reused.
const mockRedisClient = {
  hset:    jest.fn().mockResolvedValue(1),
  hgetall: jest.fn().mockResolvedValue(null),
  hdel:    jest.fn().mockResolvedValue(1),
  hincrby: jest.fn().mockResolvedValue(1),
  keys:    jest.fn().mockResolvedValue([]),
}

jest.mock('../../src/config/redis', () => ({
  getRedisClient: () => mockRedisClient,
}))
jest.mock('../../src/config/postgres', () => ({ db: { query: jest.fn().mockResolvedValue({ rows: [] }) } }))

import { createSession, getSession, markResolving, resolveSession, appendStaleWrite, getOpenSessions } from '../../src/services/conflict/conflict.session.service'
import { db } from '../../src/config/postgres'

const mockHset    = mockRedisClient.hset
const mockHgetall = mockRedisClient.hgetall
const mockHdel    = mockRedisClient.hdel
const mockHincrby = mockRedisClient.hincrby
const mockKeys    = mockRedisClient.keys
const mockQuery   = db.query as jest.Mock

describe('conflict.session.service', () => {
  beforeEach(() => jest.clearAllMocks())

  it('createSession returns session with status=open and triggers Redis + Postgres writes', async () => {
    const session = await createSession(
      'validateToken', 'devA', 'devB',
      'function validateToken(token: string)', 'validateToken(token: string): Session | null',
      'function validateToken(token: string, scope: string)', 'validateToken(token: string, scope: string): Session | null',
      'auth_bypass', true,
    )
    expect(session.status).toBe('open')
    expect(session.entityName).toBe('validateToken')
    expect(session.securitySensitive).toBe(true)
    expect(session.conflictType).toBe('auth_bypass')
    expect(session.blastRadius).toBe(0)
    expect(mockHset).toHaveBeenCalledWith(
      expect.stringContaining('conflict:session:'),
      expect.objectContaining({ entityName: 'validateToken', status: 'open' }),
    )
    expect(mockHset).toHaveBeenCalledWith(
      'entity:validateToken:meta',
      expect.objectContaining({ conflictSessionId: session.id }),
    )
    expect(mockQuery).toHaveBeenCalled()
  })

  it('getSession returns null for unknown id', async () => {
    mockHgetall.mockResolvedValueOnce(null)
    const result = await getSession('nonexistent')
    expect(result).toBeNull()
  })

  it('getSession deserialises Redis hash correctly', async () => {
    mockHgetall.mockResolvedValueOnce({
      entityName: 'validateToken', devAId: 'devA', devBId: 'devB',
      devABody: 'body-a', devASig: 'sig-a', devBBody: 'body-b', devBSig: 'sig-b',
      status: 'open', detectedAt: '2026-01-01T00:00:00Z',
      blastRadius: '3', securitySensitive: '1', conflictType: 'auth_bypass',
    })
    const session = await getSession('test-id')
    expect(session?.blastRadius).toBe(3)
    expect(session?.securitySensitive).toBe(true)
  })

  it('markResolving sets status + resolvedBy', async () => {
    await markResolving('session-id', 'dashboard')
    expect(mockHset).toHaveBeenCalledWith(
      'conflict:session:session-id',
      { status: 'resolving', resolvedBy: 'dashboard' },
    )
  })

  it('appendStaleWrite increments blastRadius and writes stale_writes row', async () => {
    mockHincrby.mockResolvedValueOnce(2)
    const radius = await appendStaleWrite('session-id', 'devB', 'transfer', 'blast_cascade')
    expect(radius).toBe(2)
    expect(mockHincrby).toHaveBeenCalledWith('conflict:session:session-id', 'blastRadius', 1)
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO stale_writes'),
      expect.arrayContaining(['devB', 'transfer', 'session-id', 'blast_cascade']),
    )
  })
})
