jest.mock('../../src/config/redis', () => ({
  getRedisClient: jest.fn(),
  connectRedis: jest.fn(),
  default: undefined,
}))

import {
  updateDependents,
  getDependents,
  getImpactCount,
  updateClientIndex,
  getEntityClients,
} from '../../src/services/graph/graph.service'
import { getRedisClient } from '../../src/config/redis'

// ── mock redis ────────────────────────────────────────────────────────────────

const mockRedis = {
  sadd: jest.fn().mockResolvedValue(1),
  smembers: jest.fn().mockResolvedValue([]),
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(getRedisClient as jest.Mock).mockReturnValue(mockRedis)
})

// ── updateDependents ──────────────────────────────────────────────────────────

describe('updateDependents', () => {
  it('calls sadd with correct key', async () => {
    await updateDependents('validateUser', ['findUser', 'hashPassword'])
    expect(mockRedis.sadd).toHaveBeenCalledWith(
      'entity:validateUser:dependents',
      'findUser',
      'hashPassword',
    )
  })

  it('does NOT call sadd when calledEntities is empty', async () => {
    await updateDependents('validateUser', [])
    expect(mockRedis.sadd).not.toHaveBeenCalled()
  })

  it('handles single dependent', async () => {
    await updateDependents('foo', ['bar'])
    expect(mockRedis.sadd).toHaveBeenCalledWith('entity:foo:dependents', 'bar')
  })

  it('uses entity name in Redis key', async () => {
    await updateDependents('mySpecialFn', ['dep'])
    const key = mockRedis.sadd.mock.calls[0][0]
    expect(key).toBe('entity:mySpecialFn:dependents')
  })
})

// ── getDependents ─────────────────────────────────────────────────────────────

describe('getDependents', () => {
  it('calls smembers with correct key', async () => {
    await getDependents('validateUser')
    expect(mockRedis.smembers).toHaveBeenCalledWith('entity:validateUser:dependents')
  })

  it('returns array from smembers', async () => {
    mockRedis.smembers.mockResolvedValue(['findUser', 'hashPassword'])
    const result = await getDependents('validateUser')
    expect(result).toEqual(['findUser', 'hashPassword'])
  })

  it('returns empty array when no dependents', async () => {
    mockRedis.smembers.mockResolvedValue([])
    const result = await getDependents('leaf')
    expect(result).toEqual([])
  })
})

// ── getImpactCount ────────────────────────────────────────────────────────────

describe('getImpactCount', () => {
  it('returns 0 when entity has no dependents', async () => {
    mockRedis.smembers.mockResolvedValue([])
    expect(await getImpactCount('foo')).toBe(0)
  })

  it('returns 1 when entity has one direct dependent', async () => {
    mockRedis.smembers.mockImplementation(async (key: string) => {
      if (key === 'entity:foo:dependents') return ['bar']
      return []
    })
    expect(await getImpactCount('foo')).toBe(1)
  })

  it('returns 2 for linear chain A→B→C (A impacts B and C)', async () => {
    mockRedis.smembers.mockImplementation(async (key: string) => {
      if (key === 'entity:A:dependents') return ['B']
      if (key === 'entity:B:dependents') return ['C']
      return []
    })
    expect(await getImpactCount('A')).toBe(2)
  })

  it('returns correct count for diamond: A→B, A→C, B→D, C→D', async () => {
    mockRedis.smembers.mockImplementation(async (key: string) => {
      if (key === 'entity:A:dependents') return ['B', 'C']
      if (key === 'entity:B:dependents') return ['D']
      if (key === 'entity:C:dependents') return ['D']
      return []
    })
    // A visits B, C, D — count = 3
    expect(await getImpactCount('A')).toBe(3)
  })

  it('handles circular dependencies without infinite loop', async () => {
    mockRedis.smembers.mockImplementation(async (key: string) => {
      if (key === 'entity:A:dependents') return ['B']
      if (key === 'entity:B:dependents') return ['A']
      return []
    })
    const result = await getImpactCount('A')
    expect(result).toBe(1)  // only B, cycle A→B→A stops at visited
  })

  it('excludes the root entity itself from count', async () => {
    mockRedis.smembers.mockResolvedValue([])
    const count = await getImpactCount('standalone')
    expect(count).toBe(0)
  })
})

// ── updateClientIndex ─────────────────────────────────────────────────────────

describe('updateClientIndex', () => {
  it('calls sadd for each entity name', async () => {
    await updateClientIndex('devA', ['foo', 'bar'])
    expect(mockRedis.sadd).toHaveBeenCalledWith('entity:foo:clients', 'devA')
    expect(mockRedis.sadd).toHaveBeenCalledWith('entity:bar:clients', 'devA')
    expect(mockRedis.sadd).toHaveBeenCalledTimes(2)
  })

  it('does NOT call sadd when calledEntityNames is empty', async () => {
    await updateClientIndex('devA', [])
    expect(mockRedis.sadd).not.toHaveBeenCalled()
  })

  it('uses correct devId in set member', async () => {
    await updateClientIndex('devXYZ', ['myFn'])
    expect(mockRedis.sadd).toHaveBeenCalledWith('entity:myFn:clients', 'devXYZ')
  })

  it('handles single entity', async () => {
    await updateClientIndex('devA', ['singleFn'])
    expect(mockRedis.sadd).toHaveBeenCalledTimes(1)
  })
})

// ── getEntityClients ──────────────────────────────────────────────────────────

describe('getEntityClients', () => {
  it('calls smembers with correct clients key', async () => {
    await getEntityClients('validateUser')
    expect(mockRedis.smembers).toHaveBeenCalledWith('entity:validateUser:clients')
  })

  it('returns list of client devIds', async () => {
    mockRedis.smembers.mockResolvedValue(['devA', 'devB'])
    const result = await getEntityClients('sharedFn')
    expect(result).toEqual(['devA', 'devB'])
  })

  it('returns empty array when no clients', async () => {
    mockRedis.smembers.mockResolvedValue([])
    const result = await getEntityClients('unusedFn')
    expect(result).toEqual([])
  })
})
