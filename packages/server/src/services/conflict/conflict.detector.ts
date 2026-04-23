import { getRedisClient } from '../../config/redis'
import { getImpactCount } from '../graph/graph.service'
import { ConflictPayload, Severity } from '../../types'

export function classifySeverity(impactCount: number): Severity {
  if (impactCount >= 10) return 'critical'
  if (impactCount >= 1) return 'warning'
  return 'info'
}

export async function detectConflict(
  entityName: string,
  requestingDevId: string,
  newSig: string,
): Promise<ConflictPayload | null> {
  const redis = getRedisClient()
  const currentOwner = await redis.get(`lock:${entityName}`)
  if (!currentOwner || currentOwner === requestingDevId) return null

  const [oldSig, impactCount] = await Promise.all([
    redis.hget(`entity:${entityName}`, 'signature'),
    getImpactCount(entityName),
  ])

  return {
    entityName,
    severity: classifySeverity(impactCount),
    devAId: currentOwner,
    devBId: requestingDevId,
    oldSig: oldSig ?? '',
    newSig,
    impactCount,
  }
}

export async function storeConflict(conflict: ConflictPayload): Promise<void> {
  const redis = getRedisClient()
  await redis.lpush('conflicts:recent', JSON.stringify(conflict))
  await redis.ltrim('conflicts:recent', 0, 99)
}
