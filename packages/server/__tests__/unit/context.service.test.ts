jest.mock('../../src/config/redis', () => ({
  getRedisClient: jest.fn(),
  connectRedis: jest.fn(),
}))

import { buildSnapshot, buildMarkdownSnapshot, validateCodeUsage } from '../../src/services/context/context.service'
import { getRedisClient } from '../../src/config/redis'

const mockRedis = {
  scan: jest.fn(),
  hgetall: jest.fn(),
}

beforeEach(() => {
  ;(getRedisClient as jest.Mock).mockReturnValue(mockRedis)
})

function fakeScan(keys: string[]) {
  mockRedis.scan.mockResolvedValueOnce(['0', keys])
}

describe('buildSnapshot', () => {
  it('returns empty snapshot when no entities in Redis', async () => {
    fakeScan([])
    const snap = await buildSnapshot()
    expect(snap.entityCount).toBe(0)
    expect(snap.entities).toHaveLength(0)
    expect(snap.snapshotAt).toBeTruthy()
  })

  it('filters out sub-keys like entity:name:dependents', async () => {
    fakeScan(['entity:foo', 'entity:foo:dependents', 'entity:foo:clients', 'entity:bar'])
    mockRedis.hgetall
      .mockResolvedValueOnce({ kind: 'function', signature: 'foo()', devId: 'devA', file: 'a.ts', body: '', line: '1', updatedAt: '2024' })
      .mockResolvedValueOnce({ kind: 'function', signature: 'bar()', devId: 'devB', file: 'b.ts', body: '', line: '2', updatedAt: '2024' })
    const snap = await buildSnapshot()
    expect(snap.entityCount).toBe(2)
    expect(mockRedis.hgetall).toHaveBeenCalledTimes(2)
  })

  it('maps Redis fields to EntitySnapshot correctly', async () => {
    fakeScan(['entity:validateUser'])
    mockRedis.hgetall.mockResolvedValueOnce({
      kind: 'function',
      signature: 'validateUser(id: string): Promise<User>',
      devId: 'devA',
      file: 'auth.ts',
      body: 'async function validateUser...',
      line: '10',
      updatedAt: '2024-01-01T00:00:00Z',
    })
    const snap = await buildSnapshot()
    const e = snap.entities[0]
    expect(e.name).toBe('validateUser')
    expect(e.kind).toBe('function')
    expect(e.signature).toBe('validateUser(id: string): Promise<User>')
    expect(e.devId).toBe('devA')
    expect(e.line).toBe(10)
  })

  it('skips entities with empty hgetall result', async () => {
    fakeScan(['entity:ghost'])
    mockRedis.hgetall.mockResolvedValueOnce({})
    const snap = await buildSnapshot()
    expect(snap.entityCount).toBe(0)
  })

  it('filters by entity name when option provided', async () => {
    fakeScan(['entity:foo', 'entity:bar'])
    mockRedis.hgetall
      .mockResolvedValueOnce({ kind: 'function', signature: 'foo()', devId: 'devA', file: 'a.ts', body: '', line: '1', updatedAt: '' })
      .mockResolvedValueOnce({ kind: 'type', signature: 'bar', devId: 'devB', file: 'b.ts', body: '', line: '2', updatedAt: '' })
    const snap = await buildSnapshot({ entity: 'foo' })
    expect(snap.entityCount).toBe(1)
    expect(snap.entities[0].name).toBe('foo')
  })

  it('uses multiple scan pages', async () => {
    mockRedis.scan
      .mockResolvedValueOnce(['42', ['entity:a']])
      .mockResolvedValueOnce(['0', ['entity:b']])
    mockRedis.hgetall
      .mockResolvedValue({ kind: 'function', signature: 'f()', devId: 'd', file: 'x.ts', body: '', line: '1', updatedAt: '' })
    const snap = await buildSnapshot()
    expect(snap.entityCount).toBe(2)
  })
})

describe('buildMarkdownSnapshot', () => {
  it('includes header with snapshot time', () => {
    const snap = { snapshotAt: '2024-01-01T00:00:00Z', entityCount: 0, entities: [] }
    const md = buildMarkdownSnapshot(snap)
    expect(md).toContain('# ContextBridge Snapshot')
    expect(md).toContain('2024-01-01T00:00:00Z')
    expect(md).toContain('Entities (0 total)')
  })

  it('includes entity sections', () => {
    const snap = {
      snapshotAt: '',
      entityCount: 1,
      entities: [{
        name: 'validateUser',
        kind: 'function',
        signature: 'validateUser(id: string)',
        body: '',
        devId: 'devA',
        file: 'auth.ts',
        line: 1,
        updatedAt: '',
      }],
    }
    const md = buildMarkdownSnapshot(snap)
    expect(md).toContain('### validateUser')
    expect(md).toContain('**Kind:** function')
    expect(md).toContain('**Dev:** devA')
    expect(md).toContain('`validateUser(id: string)`')
  })

  it('includes body as typescript code block when present', () => {
    const snap = {
      snapshotAt: '',
      entityCount: 1,
      entities: [{
        name: 'foo',
        kind: 'function',
        signature: 'foo()',
        body: 'return 42',
        devId: 'dev',
        file: 'x.ts',
        line: 1,
        updatedAt: '',
      }],
    }
    const md = buildMarkdownSnapshot(snap)
    expect(md).toContain('```typescript')
    expect(md).toContain('return 42')
  })
})

describe('validateCodeUsage', () => {
  it('returns no conflicts for empty code', async () => {
    fakeScan([])
    const conflicts = await validateCodeUsage('')
    expect(conflicts).toHaveLength(0)
  })

  it('returns no conflicts when entity not in Redis', async () => {
    fakeScan(['entity:otherFn'])
    mockRedis.hgetall.mockResolvedValue({})
    const conflicts = await validateCodeUsage('validateUser(userId)')
    expect(conflicts).toHaveLength(0)
  })

  it('detects missing required argument', async () => {
    mockRedis.hgetall.mockImplementation(async (key: string) => {
      if (key === 'entity:validateUser') {
        return { kind: 'function', signature: 'validateUser(id: string, permissions: string[])', devId: 'devA' }
      }
      return {}
    })
    const conflicts = await validateCodeUsage('const r = await validateUser(userId)')
    expect(conflicts.length).toBeGreaterThan(0)
    expect(conflicts[0].entity).toBe('validateUser')
    expect(conflicts[0].severity).toBe('warning')
    expect(conflicts[0].correctedCall).toContain('validateUser(')
  })

  it('returns no conflict when arg count matches', async () => {
    mockRedis.hgetall.mockImplementation(async (key: string) => {
      if (key === 'entity:validateUser') {
        return { kind: 'function', signature: 'validateUser(id: string)', devId: 'devA' }
      }
      return {}
    })
    const conflicts = await validateCodeUsage('const r = await validateUser(userId)')
    expect(conflicts).toHaveLength(0)
  })

  it('skips non-function entities', async () => {
    mockRedis.hgetall.mockImplementation(async (key: string) => {
      if (key === 'entity:Permission') {
        return { kind: 'type', signature: 'Permission', devId: 'devA' }
      }
      return {}
    })
    const conflicts = await validateCodeUsage('const p: Permission = "read"')
    expect(conflicts).toHaveLength(0)
  })

  it('skips JavaScript keywords', async () => {
    mockRedis.hgetall.mockResolvedValue({ kind: 'function', signature: 'if()', devId: 'dev' })
    const conflicts = await validateCodeUsage('if (true) { return false }')
    expect(conflicts).toHaveLength(0)
  })

  it('deduplicates same function call', async () => {
    mockRedis.hgetall.mockImplementation(async (key: string) => {
      if (key === 'entity:foo') {
        return { kind: 'function', signature: 'foo(a: string, b: string)', devId: 'devA' }
      }
      return {}
    })
    const conflicts = await validateCodeUsage('foo(x); foo(y)')
    expect(conflicts.length).toBeLessThanOrEqual(1)
  })
})
