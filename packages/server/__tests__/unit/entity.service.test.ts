// Mock before any imports so env.ts is never evaluated
jest.mock('../../src/config/redis', () => ({
  getRedisClient: jest.fn(),
  connectRedis: jest.fn(),
  default: undefined,
}))

jest.mock('../../src/config/postgres', () => ({
  db: { query: jest.fn() },
  connectPostgres: jest.fn(),
}))

import { handleDiff } from '../../src/services/entity/entity.service'
import { getRedisClient } from '../../src/config/redis'
import { db } from '../../src/config/postgres'
import { EntityDiffPayload } from '../../src/types'

// ── shared mock redis ────────────────────────────────────────────────────────

const mockRedis = {
  hset: jest.fn().mockResolvedValue(1),
  set: jest.fn().mockResolvedValue('OK'),
  sadd: jest.fn().mockResolvedValue(1),
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(getRedisClient as jest.Mock).mockReturnValue(mockRedis)
  ;(db.query as jest.Mock).mockResolvedValue({ rows: [] })
})

// ── fixtures ─────────────────────────────────────────────────────────────────

function makePayload(overrides: Partial<EntityDiffPayload> = {}): EntityDiffPayload {
  return {
    name: 'validateUser',
    kind: 'function',
    oldSig: null,
    newSig: 'validateUser(id: string): Promise<User>',
    body: 'async function validateUser(id: string) { return db.find(id) }',
    file: 'auth.ts',
    line: 10,
    ...overrides,
  }
}

// ── handleDiff ────────────────────────────────────────────────────────────────

describe('handleDiff', () => {
  it('writes entity hash to Redis with key entity:{name}', async () => {
    await handleDiff('devA', [makePayload({ name: 'validateUser' })])
    expect(mockRedis.hset).toHaveBeenCalledWith('entity:validateUser', expect.any(Object))
  })

  it('hash contains correct signature (newSig)', async () => {
    await handleDiff('devA', [makePayload({ newSig: 'validateUser(id: string): Promise<User>' })])
    const fields = mockRedis.hset.mock.calls[0][1]
    expect(fields.signature).toBe('validateUser(id: string): Promise<User>')
  })

  it('hash contains correct body', async () => {
    const body = 'async function validateUser(id) { return db.find(id) }'
    await handleDiff('devA', [makePayload({ body })])
    const fields = mockRedis.hset.mock.calls[0][1]
    expect(fields.body).toBe(body)
  })

  it('hash contains devId', async () => {
    await handleDiff('devA', [makePayload()])
    const fields = mockRedis.hset.mock.calls[0][1]
    expect(fields.devId).toBe('devA')
  })

  it('hash contains file', async () => {
    await handleDiff('devA', [makePayload({ file: 'src/auth/service.ts' })])
    const fields = mockRedis.hset.mock.calls[0][1]
    expect(fields.file).toBe('src/auth/service.ts')
  })

  it('hash stores line as string', async () => {
    await handleDiff('devA', [makePayload({ line: 42 })])
    const fields = mockRedis.hset.mock.calls[0][1]
    expect(fields.line).toBe('42')
    expect(typeof fields.line).toBe('string')
  })

  it('hash contains kind', async () => {
    await handleDiff('devA', [makePayload({ kind: 'interface' })])
    const fields = mockRedis.hset.mock.calls[0][1]
    expect(fields.kind).toBe('interface')
  })

  it('hash contains updatedAt as valid ISO string', async () => {
    const before = Date.now()
    await handleDiff('devA', [makePayload()])
    const fields = mockRedis.hset.mock.calls[0][1]
    expect(() => new Date(fields.updatedAt)).not.toThrow()
    expect(new Date(fields.updatedAt).getTime()).toBeGreaterThanOrEqual(before)
  })

  it('sets lock key with devId value and EX 15', async () => {
    await handleDiff('devA', [makePayload({ name: 'foo' })])
    expect(mockRedis.set).toHaveBeenCalledWith('lock:foo', 'devA', 'EX', 15)
  })

  it('adds entity name to client entities set', async () => {
    await handleDiff('devA', [makePayload({ name: 'bar' })])
    expect(mockRedis.sadd).toHaveBeenCalledWith('client:devA:entities', 'bar')
  })

  it('processes multiple entities in order', async () => {
    const entities = [
      makePayload({ name: 'foo' }),
      makePayload({ name: 'bar' }),
      makePayload({ name: 'baz' }),
    ]
    await handleDiff('devA', entities)
    expect(mockRedis.hset).toHaveBeenCalledTimes(3)
    expect(mockRedis.set).toHaveBeenCalledTimes(3)
    expect(mockRedis.sadd).toHaveBeenCalledTimes(3)
  })

  it('does nothing when entities array is empty', async () => {
    await handleDiff('devA', [])
    expect(mockRedis.hset).not.toHaveBeenCalled()
    expect(mockRedis.set).not.toHaveBeenCalled()
    expect(mockRedis.sadd).not.toHaveBeenCalled()
  })

  it('calls db.query for Postgres audit write', async () => {
    await handleDiff('devA', [makePayload()])
    expect(db.query).toHaveBeenCalledTimes(1)
  })

  it('db.query receives entity name, devId, oldSig, newSig', async () => {
    await handleDiff('devA', [makePayload({ name: 'myFn', oldSig: 'myFn(): void', newSig: 'myFn(x: number): void' })])
    const args = (db.query as jest.Mock).mock.calls[0][1]
    expect(args[0]).toBe('myFn')    // entity_name
    expect(args[1]).toBe('devA')    // dev_id
    expect(args[2]).toBe('myFn(): void')    // old_signature
    expect(args[3]).toBe('myFn(x: number): void')    // new_signature
  })

  it('db.query error does not propagate to caller', async () => {
    ;(db.query as jest.Mock).mockRejectedValue(new Error('DB down'))
    await expect(handleDiff('devA', [makePayload()])).resolves.not.toThrow()
  })

  it('each entity in multi-entity diff gets its own audit record', async () => {
    await handleDiff('devA', [makePayload({ name: 'foo' }), makePayload({ name: 'bar' })])
    expect(db.query).toHaveBeenCalledTimes(2)
  })

  it('new entity with null oldSig passed to db.query correctly', async () => {
    await handleDiff('devA', [makePayload({ oldSig: null })])
    const args = (db.query as jest.Mock).mock.calls[0][1]
    expect(args[2]).toBeNull()
  })

  it('db.query receives severity as info', async () => {
    await handleDiff('devA', [makePayload()])
    const args = (db.query as jest.Mock).mock.calls[0][1]
    expect(args[4]).toBe('info')
  })

  it('db.query receives entity kind', async () => {
    await handleDiff('devA', [makePayload({ kind: 'interface' })])
    const args = (db.query as jest.Mock).mock.calls[0][1]
    expect(args[5]).toBe('interface')
  })

  it('db.query receives entity body', async () => {
    const body = 'function foo() { return 1 }'
    await handleDiff('devA', [makePayload({ body })])
    const args = (db.query as jest.Mock).mock.calls[0][1]
    expect(args[6]).toBe(body)
  })

  it('db.query receives entity file', async () => {
    await handleDiff('devA', [makePayload({ file: 'src/auth.ts' })])
    const args = (db.query as jest.Mock).mock.calls[0][1]
    expect(args[7]).toBe('src/auth.ts')
  })

  it('db.query receives entity line as number', async () => {
    await handleDiff('devA', [makePayload({ line: 42 })])
    const args = (db.query as jest.Mock).mock.calls[0][1]
    expect(args[8]).toBe(42)
  })
})
