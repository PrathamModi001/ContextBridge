jest.mock('../../src/config/redis', () => ({
  getRedisClient: jest.fn(),
  connectRedis: jest.fn(),
  default: undefined,
}))

import {
  updateDependents,
  updateEntityCalls,
  getEntityCalls,
  getDependents,
  getImpactCount,
  updateClientIndex,
  getEntityClients,
  getLinksForEntities,
} from '../../src/services/graph/graph.service'
import { getRedisClient } from '../../src/config/redis'

// ── mock redis ────────────────────────────────────────────────────────────────

const mockRedis = {
  sadd: jest.fn().mockResolvedValue(1),
  del:  jest.fn().mockResolvedValue(1),
  smembers: jest.fn().mockResolvedValue([]),
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(getRedisClient as jest.Mock).mockReturnValue(mockRedis)
})

// ── updateDependents ──────────────────────────────────────────────────────────
// updateDependents(caller, calledEntities) registers caller as a dependent
// of each called entity (reverse index: entity:called:dependents += caller)

describe('updateDependents', () => {
  it('registers entityName as dependent of each called entity', async () => {
    await updateDependents('validateUser', ['findUser', 'hashPassword'])
    expect(mockRedis.sadd).toHaveBeenCalledWith('entity:findUser:dependents', 'validateUser')
    expect(mockRedis.sadd).toHaveBeenCalledWith('entity:hashPassword:dependents', 'validateUser')
    expect(mockRedis.sadd).toHaveBeenCalledTimes(2)
  })

  it('does NOT call sadd when calledEntities is empty', async () => {
    await updateDependents('validateUser', [])
    expect(mockRedis.sadd).not.toHaveBeenCalled()
  })

  it('handles single called entity', async () => {
    await updateDependents('foo', ['bar'])
    expect(mockRedis.sadd).toHaveBeenCalledWith('entity:bar:dependents', 'foo')
  })

  it('uses called entity name in Redis key (not caller name)', async () => {
    await updateDependents('caller', ['callee'])
    const key = mockRedis.sadd.mock.calls[0][0]
    expect(key).toBe('entity:callee:dependents')
    expect(mockRedis.sadd.mock.calls[0][1]).toBe('caller')
  })
})

// ── updateEntityCalls ─────────────────────────────────────────────────────────

describe('updateEntityCalls', () => {
  it('clears old calls then sets new ones', async () => {
    await updateEntityCalls('foo', ['bar', 'baz'])
    expect(mockRedis.del).toHaveBeenCalledWith('entity:foo:calls')
    expect(mockRedis.sadd).toHaveBeenCalledWith('entity:foo:calls', 'bar', 'baz')
  })

  it('clears but does not sadd when calledEntities is empty', async () => {
    await updateEntityCalls('foo', [])
    expect(mockRedis.del).toHaveBeenCalledWith('entity:foo:calls')
    expect(mockRedis.sadd).not.toHaveBeenCalled()
  })
})

// ── getEntityCalls ────────────────────────────────────────────────────────────

describe('getEntityCalls', () => {
  it('calls smembers with correct key', async () => {
    await getEntityCalls('foo')
    expect(mockRedis.smembers).toHaveBeenCalledWith('entity:foo:calls')
  })

  it('returns array from smembers', async () => {
    mockRedis.smembers.mockResolvedValueOnce(['bar', 'baz'])
    const result = await getEntityCalls('foo')
    expect(result).toEqual(['bar', 'baz'])
  })
})

// ── getLinksForEntities ───────────────────────────────────────────────────────

describe('getLinksForEntities', () => {
  it('returns empty array when entities call nothing', async () => {
    mockRedis.smembers.mockResolvedValue([])
    const links = await getLinksForEntities(['foo', 'bar'])
    expect(links).toEqual([])
  })

  it('returns source→target links from calls index', async () => {
    mockRedis.smembers.mockImplementation(async (key: string) => {
      if (key === 'entity:userService:calls') return ['validateUser']
      return []
    })
    const links = await getLinksForEntities(['userService'])
    expect(links).toEqual([{ source: 'userService', target: 'validateUser' }])
  })

  it('returns links for multiple entities', async () => {
    mockRedis.smembers.mockImplementation(async (key: string) => {
      if (key === 'entity:A:calls') return ['X', 'Y']
      if (key === 'entity:B:calls') return ['X']
      return []
    })
    const links = await getLinksForEntities(['A', 'B'])
    expect(links).toHaveLength(3)
    expect(links).toContainEqual({ source: 'A', target: 'X' })
    expect(links).toContainEqual({ source: 'A', target: 'Y' })
    expect(links).toContainEqual({ source: 'B', target: 'X' })
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
