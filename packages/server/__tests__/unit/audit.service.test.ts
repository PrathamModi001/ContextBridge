jest.mock('../../src/config/postgres', () => ({
  db: { query: jest.fn() },
  connectPostgres: jest.fn(),
}))

import { getEntityHistory, getDevHistory, getRecentChanges } from '../../src/services/audit/audit.service'
import { db } from '../../src/config/postgres'

function makeRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'uuid-1',
    entity_name: 'validateUser',
    dev_id: 'devA',
    old_signature: null,
    new_signature: 'validateUser(): void',
    severity: 'info',
    kind: 'function',
    body: 'function validateUser() {}',
    file: 'auth.ts',
    line: 10,
    changed_at: new Date('2026-04-23T12:00:00Z'),
    ...overrides,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(db.query as jest.Mock).mockResolvedValue({ rows: [] })
})

describe('getEntityHistory', () => {
  it('calls db.query with SQL containing entity_name = $1', async () => {
    await getEntityHistory('validateUser')
    const sql: string = (db.query as jest.Mock).mock.calls[0][0]
    expect(sql).toContain('entity_name = $1')
  })

  it('passes entityName and limit as query params', async () => {
    await getEntityHistory('validateUser', 10)
    const params = (db.query as jest.Mock).mock.calls[0][1]
    expect(params[0]).toBe('validateUser')
    expect(params[1]).toBe(10)
  })

  it('returns mapped AuditRecord array with camelCase fields', async () => {
    ;(db.query as jest.Mock).mockResolvedValue({ rows: [makeRow()] })
    const records = await getEntityHistory('validateUser')
    expect(records).toHaveLength(1)
    expect(records[0].entityName).toBe('validateUser')
    expect(records[0].devId).toBe('devA')
    expect(records[0].newSignature).toBe('validateUser(): void')
    expect(records[0].severity).toBe('info')
    expect(records[0].kind).toBe('function')
  })

  it('changedAt is ISO string converted from Date object', async () => {
    ;(db.query as jest.Mock).mockResolvedValue({ rows: [makeRow()] })
    const records = await getEntityHistory('validateUser')
    expect(records[0].changedAt).toBe('2026-04-23T12:00:00.000Z')
  })

  it('oldSignature is null when DB row has null', async () => {
    ;(db.query as jest.Mock).mockResolvedValue({ rows: [makeRow({ old_signature: null })] })
    const records = await getEntityHistory('validateUser')
    expect(records[0].oldSignature).toBeNull()
  })

  it('uses default limit of 50 when not specified', async () => {
    await getEntityHistory('validateUser')
    const params = (db.query as jest.Mock).mock.calls[0][1]
    expect(params[1]).toBe(50)
  })

  it('caps limit at 200 when called with 500', async () => {
    await getEntityHistory('validateUser', 500)
    const params = (db.query as jest.Mock).mock.calls[0][1]
    expect(params[1]).toBe(200)
  })

  it('throws when db.query rejects', async () => {
    ;(db.query as jest.Mock).mockRejectedValue(new Error('DB error'))
    await expect(getEntityHistory('validateUser')).rejects.toThrow('DB error')
  })

  it('returns empty array when no rows found', async () => {
    ;(db.query as jest.Mock).mockResolvedValue({ rows: [] })
    const records = await getEntityHistory('validateUser')
    expect(records).toEqual([])
  })
})

describe('getDevHistory', () => {
  it('calls db.query with SQL containing dev_id = $1', async () => {
    await getDevHistory('devA')
    const sql: string = (db.query as jest.Mock).mock.calls[0][0]
    expect(sql).toContain('dev_id = $1')
  })

  it('passes devId and limit as query params', async () => {
    await getDevHistory('devA', 25)
    const params = (db.query as jest.Mock).mock.calls[0][1]
    expect(params[0]).toBe('devA')
    expect(params[1]).toBe(25)
  })

  it('returns mapped records with correct devId', async () => {
    ;(db.query as jest.Mock).mockResolvedValue({ rows: [makeRow({ dev_id: 'devB' })] })
    const records = await getDevHistory('devB')
    expect(records[0].devId).toBe('devB')
  })

  it('caps limit at 200 when called with 500', async () => {
    await getDevHistory('devA', 500)
    const params = (db.query as jest.Mock).mock.calls[0][1]
    expect(params[1]).toBe(200)
  })

  it('uses default limit of 50 when not specified', async () => {
    await getDevHistory('devA')
    const params = (db.query as jest.Mock).mock.calls[0][1]
    expect(params[1]).toBe(50)
  })

  it('throws when db.query rejects', async () => {
    ;(db.query as jest.Mock).mockRejectedValue(new Error('DB down'))
    await expect(getDevHistory('devA')).rejects.toThrow('DB down')
  })
})

describe('getRecentChanges', () => {
  it('calls db.query with SQL that has no WHERE clause', async () => {
    await getRecentChanges()
    const sql: string = (db.query as jest.Mock).mock.calls[0][0]
    expect(sql).not.toContain('WHERE')
  })

  it('passes limit as query param', async () => {
    await getRecentChanges(20)
    const params = (db.query as jest.Mock).mock.calls[0][1]
    expect(params[0]).toBe(20)
  })

  it('returns all mapped records', async () => {
    ;(db.query as jest.Mock).mockResolvedValue({
      rows: [makeRow({ entity_name: 'foo' }), makeRow({ entity_name: 'bar' })],
    })
    const records = await getRecentChanges()
    expect(records).toHaveLength(2)
    expect(records[0].entityName).toBe('foo')
    expect(records[1].entityName).toBe('bar')
  })

  it('caps limit at 200 when called with 500', async () => {
    await getRecentChanges(500)
    const params = (db.query as jest.Mock).mock.calls[0][1]
    expect(params[0]).toBe(200)
  })

  it('uses default limit of 50 when not specified', async () => {
    await getRecentChanges()
    const params = (db.query as jest.Mock).mock.calls[0][1]
    expect(params[0]).toBe(50)
  })

  it('throws when db.query rejects', async () => {
    ;(db.query as jest.Mock).mockRejectedValue(new Error('DB error'))
    await expect(getRecentChanges()).rejects.toThrow('DB error')
  })

  it('returns empty array when no rows found', async () => {
    ;(db.query as jest.Mock).mockResolvedValue({ rows: [] })
    const records = await getRecentChanges()
    expect(records).toEqual([])
  })
})
