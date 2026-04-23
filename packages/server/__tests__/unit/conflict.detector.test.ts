jest.mock('../../src/config/redis', () => ({
  getRedisClient: jest.fn(),
  connectRedis: jest.fn(),
  default: undefined,
}))

jest.mock('../../src/services/graph/graph.service', () => ({
  getImpactCount: jest.fn().mockResolvedValue(0),
  getDependents: jest.fn().mockResolvedValue([]),
  updateDependents: jest.fn().mockResolvedValue(undefined),
  updateClientIndex: jest.fn().mockResolvedValue(undefined),
  getEntityClients: jest.fn().mockResolvedValue([]),
}))

import { detectConflict, classifySeverity, storeConflict } from '../../src/services/conflict/conflict.detector'
import { getRedisClient } from '../../src/config/redis'
import { getImpactCount } from '../../src/services/graph/graph.service'

const mockRedis = {
  get: jest.fn().mockResolvedValue(null),
  hget: jest.fn().mockResolvedValue(null),
  lpush: jest.fn().mockResolvedValue(1),
  ltrim: jest.fn().mockResolvedValue('OK'),
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(getRedisClient as jest.Mock).mockReturnValue(mockRedis)
  ;(getImpactCount as jest.Mock).mockResolvedValue(0)
  mockRedis.get.mockResolvedValue(null)
  mockRedis.hget.mockResolvedValue(null)
  mockRedis.lpush.mockResolvedValue(1)
  mockRedis.ltrim.mockResolvedValue('OK')
})

describe('classifySeverity', () => {
  it('returns info for 0', () => {
    expect(classifySeverity(0)).toBe('info')
  })

  it('returns warning for 1', () => {
    expect(classifySeverity(1)).toBe('warning')
  })

  it('returns warning for 9', () => {
    expect(classifySeverity(9)).toBe('warning')
  })

  it('returns critical for 10', () => {
    expect(classifySeverity(10)).toBe('critical')
  })

  it('returns critical for 100', () => {
    expect(classifySeverity(100)).toBe('critical')
  })
})

describe('detectConflict', () => {
  it('returns null when redis.get returns null (no lock)', async () => {
    mockRedis.get.mockResolvedValue(null)
    const result = await detectConflict('myEntity', 'devA', 'sig1')
    expect(result).toBeNull()
  })

  it('returns null when lock owner equals requestingDevId', async () => {
    mockRedis.get.mockResolvedValue('devA')
    const result = await detectConflict('myEntity', 'devA', 'sig1')
    expect(result).toBeNull()
  })

  it('returns ConflictPayload when different dev owns lock', async () => {
    mockRedis.get.mockResolvedValue('devB')
    const result = await detectConflict('myEntity', 'devA', 'newSig')
    expect(result).not.toBeNull()
  })

  it('sets devAId to current lock owner', async () => {
    mockRedis.get.mockResolvedValue('devB')
    const result = await detectConflict('myEntity', 'devA', 'newSig')
    expect(result!.devAId).toBe('devB')
  })

  it('sets devBId to requestingDevId', async () => {
    mockRedis.get.mockResolvedValue('devB')
    const result = await detectConflict('myEntity', 'devA', 'newSig')
    expect(result!.devBId).toBe('devA')
  })

  it('sets oldSig from redis.hget result', async () => {
    mockRedis.get.mockResolvedValue('devB')
    mockRedis.hget.mockResolvedValue('oldSignature')
    const result = await detectConflict('myEntity', 'devA', 'newSig')
    expect(result!.oldSig).toBe('oldSignature')
  })

  it('sets newSig from the newSig parameter', async () => {
    mockRedis.get.mockResolvedValue('devB')
    const result = await detectConflict('myEntity', 'devA', 'myNewSignature')
    expect(result!.newSig).toBe('myNewSignature')
  })

  it('sets entityName from the entityName parameter', async () => {
    mockRedis.get.mockResolvedValue('devB')
    const result = await detectConflict('specificEntity', 'devA', 'sig')
    expect(result!.entityName).toBe('specificEntity')
  })

  it('sets impactCount from getImpactCount', async () => {
    mockRedis.get.mockResolvedValue('devB')
    ;(getImpactCount as jest.Mock).mockResolvedValue(5)
    const result = await detectConflict('myEntity', 'devA', 'sig')
    expect(result!.impactCount).toBe(5)
  })

  it('sets severity based on impactCount', async () => {
    mockRedis.get.mockResolvedValue('devB')
    ;(getImpactCount as jest.Mock).mockResolvedValue(10)
    const result = await detectConflict('myEntity', 'devA', 'sig')
    expect(result!.severity).toBe('critical')
  })

  it('sets oldSig to empty string when hget returns null', async () => {
    mockRedis.get.mockResolvedValue('devB')
    mockRedis.hget.mockResolvedValue(null)
    const result = await detectConflict('myEntity', 'devA', 'sig')
    expect(result!.oldSig).toBe('')
  })

  it('calls getImpactCount with the correct entityName', async () => {
    mockRedis.get.mockResolvedValue('devB')
    await detectConflict('mySpecialEntity', 'devA', 'sig')
    expect(getImpactCount).toHaveBeenCalledWith('mySpecialEntity')
  })

  it('calls redis.get with lock:{entityName}', async () => {
    mockRedis.get.mockResolvedValue(null)
    await detectConflict('myEntity', 'devA', 'sig')
    expect(mockRedis.get).toHaveBeenCalledWith('lock:myEntity')
  })

  it('calls redis.hget with entity:{entityName} and signature', async () => {
    mockRedis.get.mockResolvedValue('devB')
    await detectConflict('myEntity', 'devA', 'sig')
    expect(mockRedis.hget).toHaveBeenCalledWith('entity:myEntity', 'signature')
  })
})

describe('storeConflict', () => {
  it('calls lpush with conflicts:recent and JSON.stringify of conflict', async () => {
    const conflict = {
      entityName: 'foo',
      severity: 'warning' as const,
      devAId: 'devB',
      devBId: 'devA',
      oldSig: 'old',
      newSig: 'new',
      impactCount: 3,
    }
    await storeConflict(conflict)
    expect(mockRedis.lpush).toHaveBeenCalledWith('conflicts:recent', JSON.stringify(conflict))
  })

  it('calls ltrim with conflicts:recent, 0, 99', async () => {
    const conflict = {
      entityName: 'bar',
      severity: 'info' as const,
      devAId: 'devC',
      devBId: 'devD',
      oldSig: '',
      newSig: 'newsig',
      impactCount: 0,
    }
    await storeConflict(conflict)
    expect(mockRedis.ltrim).toHaveBeenCalledWith('conflicts:recent', 0, 99)
  })
})
