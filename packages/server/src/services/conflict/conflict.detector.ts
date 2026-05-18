import { getRedisClient } from '../../config/redis'
import { getImpactCount } from '../graph/graph.service'
import { ConflictPayload, ConflictType, EntityKind, Severity } from '../../types'

const AUTH_PATH = /^(validateToken|requireScope|requirePermission|checkPermission|verifyIdentity|requireKYC|checkCompliance|createSession|revokeToken|refreshToken)$/

export function classifySeverity(impactCount: number): Severity {
  if (impactCount >= 10) return 'critical'
  if (impactCount >= 1)  return 'warning'
  return 'info'
}

export function detectConflictType(
  entityName: string,
  _oldSig:    string,
  _newSig:    string,
  kind:       EntityKind | string,
): ConflictType {
  if (AUTH_PATH.test(entityName))                 return 'auth_bypass'
  if (kind === 'interface' || kind === 'type')    return 'type_violation'
  return 'signature_drift'
}

export function isSecuritySensitive(entityName: string): boolean {
  return AUTH_PATH.test(entityName)
}

export async function detectConflict(
  entityName:      string,
  requestingDevId: string,
  newSig:          string,
): Promise<ConflictPayload | null> {
  const redis        = getRedisClient()
  const currentOwner = await redis.get(`lock:${entityName}`)
  if (!currentOwner || currentOwner === requestingDevId) return null

  const [oldSig, impactCount] = await Promise.all([
    redis.hget(`entity:${entityName}`, 'signature'),
    getImpactCount(entityName),
  ])

  if (oldSig && oldSig === newSig) return null

  return {
    entityName,
    severity:    classifySeverity(impactCount),
    devAId:      currentOwner,
    devBId:      requestingDevId,
    oldSig:      oldSig ?? '',
    newSig,
    impactCount,
  }
}

export async function storeConflict(conflict: ConflictPayload): Promise<void> {
  const redis = getRedisClient()
  await redis.lpush('conflicts:recent', JSON.stringify(conflict))
  await redis.ltrim('conflicts:recent', 0, 99)
}
