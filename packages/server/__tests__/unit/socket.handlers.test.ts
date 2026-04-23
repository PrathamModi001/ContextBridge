jest.mock('../../src/services/conflict/conflict.detector', () => ({
  detectConflict: jest.fn().mockResolvedValue(null),
  storeConflict: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('../../src/services/graph/graph.service', () => ({
  getEntityClients: jest.fn().mockResolvedValue([]),
  getImpactCount: jest.fn().mockResolvedValue(0),
  getDependents: jest.fn().mockResolvedValue([]),
  updateDependents: jest.fn().mockResolvedValue(undefined),
  updateClientIndex: jest.fn().mockResolvedValue(undefined),
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

jest.mock('../../src/services/entity/entity.service', () => ({
  handleDiff: jest.fn().mockResolvedValue(undefined),
}))

import { handleEntityDiffEvent, handleHeartbeatEvent } from '../../src/socket'
import { handleDiff } from '../../src/services/entity/entity.service'
import { getRedisClient } from '../../src/config/redis'
import { EntityDiffPayload, ConflictPayload } from '../../src/types'
import { detectConflict, storeConflict } from '../../src/services/conflict/conflict.detector'

// ── mock redis ────────────────────────────────────────────────────────────────

const mockRedis = {
  set: jest.fn().mockResolvedValue('OK'),
  duplicate: jest.fn().mockReturnValue({
    on: jest.fn(),
    subscribe: jest.fn().mockResolvedValue(undefined),
  }),
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(getRedisClient as jest.Mock).mockReturnValue(mockRedis)
  ;(handleDiff as jest.Mock).mockResolvedValue(undefined)
  ;(detectConflict as jest.Mock).mockResolvedValue(null)
  ;(storeConflict as jest.Mock).mockResolvedValue(undefined)
})

// ── fixtures ──────────────────────────────────────────────────────────────────

function makePayload(name: string): EntityDiffPayload {
  return {
    name,
    kind: 'function',
    oldSig: null,
    newSig: `${name}(): void`,
    body: `function ${name}() {}`,
    file: 'test.ts',
    line: 1,
  }
}

// ── handleEntityDiffEvent ─────────────────────────────────────────────────────

describe('handleEntityDiffEvent', () => {
  it('calls entityService.handleDiff with devId and payload', async () => {
    const payload = [makePayload('foo')]
    await handleEntityDiffEvent('devA', payload)
    expect(handleDiff).toHaveBeenCalledWith('devA', payload)
  })

  it('passes empty array to handleDiff', async () => {
    await handleEntityDiffEvent('devA', [])
    expect(handleDiff).toHaveBeenCalledWith('devA', [])
  })

  it('passes multiple entities to handleDiff', async () => {
    const payload = [makePayload('foo'), makePayload('bar'), makePayload('baz')]
    await handleEntityDiffEvent('devX', payload)
    expect(handleDiff).toHaveBeenCalledWith('devX', payload)
  })

  it('propagates handleDiff error to caller', async () => {
    ;(handleDiff as jest.Mock).mockRejectedValue(new Error('Redis down'))
    await expect(handleEntityDiffEvent('devA', [makePayload('foo')])).rejects.toThrow('Redis down')
  })

  it('called exactly once per invocation', async () => {
    await handleEntityDiffEvent('devA', [makePayload('foo')])
    expect(handleDiff).toHaveBeenCalledTimes(1)
  })

  it('preserves all payload fields passed to handleDiff', async () => {
    const payload: EntityDiffPayload = {
      name: 'myFn',
      kind: 'interface',
      oldSig: 'myFn(): void',
      newSig: 'myFn(x: number): string',
      body: 'interface myFn { ... }',
      file: 'src/service.ts',
      line: 99,
    }
    await handleEntityDiffEvent('devB', [payload])
    expect(handleDiff).toHaveBeenCalledWith('devB', [payload])
  })
})

// ── handleHeartbeatEvent ──────────────────────────────────────────────────────

describe('handleHeartbeatEvent', () => {
  it('sets heartbeat key for devId', async () => {
    await handleHeartbeatEvent('devA')
    expect(mockRedis.set).toHaveBeenCalledWith('client:devA:heartbeat', '1', 'EX', 30)
  })

  it('uses correct devId in key', async () => {
    await handleHeartbeatEvent('devXYZ')
    const key = mockRedis.set.mock.calls[0][0]
    expect(key).toBe('client:devXYZ:heartbeat')
  })

  it('sets value to "1"', async () => {
    await handleHeartbeatEvent('devA')
    expect(mockRedis.set.mock.calls[0][1]).toBe('1')
  })

  it('uses EX 30 for TTL', async () => {
    await handleHeartbeatEvent('devA')
    const [, , exFlag, ttl] = mockRedis.set.mock.calls[0]
    expect(exFlag).toBe('EX')
    expect(ttl).toBe(30)
  })

  it('different devIds produce different keys', async () => {
    await handleHeartbeatEvent('devA')
    await handleHeartbeatEvent('devB')
    const keys = mockRedis.set.mock.calls.map((c: unknown[]) => c[0])
    expect(keys[0]).toBe('client:devA:heartbeat')
    expect(keys[1]).toBe('client:devB:heartbeat')
  })
})

// ── handleEntityDiffEvent conflict behavior ───────────────────────────────────

describe('handleEntityDiffEvent conflict behavior', () => {
  it('calls detectConflict once for a single entity payload', async () => {
    const payload = [makePayload('foo')]
    await handleEntityDiffEvent('devA', payload)
    expect(detectConflict).toHaveBeenCalledTimes(1)
  })

  it('calls detectConflict with (entity.name, devId, entity.newSig)', async () => {
    const entity = makePayload('myFn')
    await handleEntityDiffEvent('devA', [entity])
    expect(detectConflict).toHaveBeenCalledWith('myFn', 'devA', entity.newSig)
  })

  it('calls detectConflict N times for N entities in payload', async () => {
    const payload = [makePayload('a'), makePayload('b'), makePayload('c')]
    await handleEntityDiffEvent('devA', payload)
    expect(detectConflict).toHaveBeenCalledTimes(3)
  })

  it('does not call storeConflict when detectConflict returns null', async () => {
    ;(detectConflict as jest.Mock).mockResolvedValue(null)
    await handleEntityDiffEvent('devA', [makePayload('foo')])
    expect(storeConflict).not.toHaveBeenCalled()
  })

  it('calls storeConflict with the conflict when detectConflict returns a ConflictPayload', async () => {
    const conflict: ConflictPayload = {
      entityName: 'foo',
      severity: 'warning',
      devAId: 'devB',
      devBId: 'devA',
      oldSig: 'old',
      newSig: 'foo(): void',
      impactCount: 2,
    }
    ;(detectConflict as jest.Mock).mockResolvedValue(conflict)
    await handleEntityDiffEvent('devA', [makePayload('foo')])
    expect(storeConflict).toHaveBeenCalledWith(conflict)
  })

  it('returns empty array when no conflicts detected', async () => {
    ;(detectConflict as jest.Mock).mockResolvedValue(null)
    const result = await handleEntityDiffEvent('devA', [makePayload('foo')])
    expect(result).toEqual([])
  })

  it('returns array with one item when one conflict detected', async () => {
    const conflict: ConflictPayload = {
      entityName: 'foo',
      severity: 'info',
      devAId: 'devB',
      devBId: 'devA',
      oldSig: '',
      newSig: 'foo(): void',
      impactCount: 0,
    }
    ;(detectConflict as jest.Mock).mockResolvedValue(conflict)
    const result = await handleEntityDiffEvent('devA', [makePayload('foo')])
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual(conflict)
  })

  it('still calls handleDiff even when conflicts are detected', async () => {
    const conflict: ConflictPayload = {
      entityName: 'foo',
      severity: 'critical',
      devAId: 'devB',
      devBId: 'devA',
      oldSig: 'old',
      newSig: 'foo(): void',
      impactCount: 10,
    }
    ;(detectConflict as jest.Mock).mockResolvedValue(conflict)
    const payload = [makePayload('foo')]
    await handleEntityDiffEvent('devA', payload)
    expect(handleDiff).toHaveBeenCalledWith('devA', payload)
  })
})
