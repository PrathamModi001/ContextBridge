import { randomUUID } from 'crypto'
import { getRedisClient } from '../../config/redis'
import { db } from '../../config/postgres'
import { ConflictSession, ConflictType, Resolution } from '../../types'
import { createModuleLogger } from '../../logger/logger'

const log = createModuleLogger('conflict-session')

export async function createSession(
  entityName:        string,
  devAId:            string,
  devBId:            string,
  devABody:          string,
  devASig:           string,
  devBBody:          string,
  devBSig:           string,
  conflictType:      ConflictType,
  securitySensitive: boolean,
): Promise<ConflictSession> {
  const id  = randomUUID()
  const now = new Date().toISOString()

  const session: ConflictSession = {
    id, entityName,
    devAId, devBId, devABody, devASig, devBBody, devBSig,
    status: 'open', detectedAt: now,
    blastRadius: 0, securitySensitive, conflictType,
  }

  const redis = getRedisClient()
  await redis.hset(`conflict:session:${id}`, {
    ...session,
    blastRadius:       '0',
    securitySensitive: securitySensitive ? '1' : '0',
  })
  await redis.hset(`entity:${entityName}:meta`, { conflictSessionId: id })

  db.query(
    `INSERT INTO conflicts
       (id, entity_name, dev_a_id, dev_b_id, description, severity,
        dev_a_body, dev_b_body, conflict_type, security_sensitive,
        conflict_session_id, blast_radius, detected_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [id, entityName, devAId, devBId,
     `${conflictType} on ${entityName}`,
     securitySensitive ? 'critical' : 'warning',
     devABody, devBBody, conflictType, securitySensitive, id, 0, now],
  ).catch((err: Error) => log.error({ err }, 'failed to persist conflict session'))

  return session
}

export async function getSession(sessionId: string): Promise<ConflictSession | null> {
  const redis = getRedisClient()
  const data  = await redis.hgetall(`conflict:session:${sessionId}`)
  if (!data?.entityName) return null
  return {
    id:                sessionId,
    entityName:        data.entityName,
    devAId:            data.devAId,
    devBId:            data.devBId,
    devABody:          data.devABody ?? '',
    devASig:           data.devASig  ?? '',
    devBBody:          data.devBBody ?? '',
    devBSig:           data.devBSig  ?? '',
    status:            data.status as ConflictSession['status'],
    detectedAt:        data.detectedAt,
    resolvedAt:        data.resolvedAt,
    resolvedBy:        data.resolvedBy,
    resolutionType:    data.resolutionType as ConflictSession['resolutionType'],
    mergedBody:        data.mergedBody,
    mergedSig:         data.mergedSig,
    blastRadius:       parseInt(data.blastRadius ?? '0', 10),
    securitySensitive: data.securitySensitive === '1',
    conflictType:      data.conflictType as ConflictType,
  }
}

export async function markResolving(sessionId: string, resolvedBy: string): Promise<void> {
  await getRedisClient().hset(`conflict:session:${sessionId}`, { status: 'resolving', resolvedBy })
}

export async function resolveSession(
  sessionId: string,
  resolution: Resolution,
): Promise<ConflictSession> {
  const redis = getRedisClient()
  const now   = new Date().toISOString()

  if (resolution.type === 'manual_merge' && (!resolution.mergedBody || !resolution.mergedSig)) {
    throw new Error('manual_merge resolution requires mergedBody and mergedSig')
  }

  const session = await getSession(sessionId)
  if (!session) throw new Error(`Session ${sessionId} not found`)
  if (session.status !== 'resolving') throw new Error(`Session ${sessionId} cannot be resolved from state '${session.status}'`)

  const mergedBody = resolution.mergedBody ?? (resolution.type === 'accepted_a' ? session.devABody : session.devBBody)
  const mergedSig  = resolution.mergedSig  ?? (resolution.type === 'accepted_a' ? session.devASig  : session.devBSig)

  await redis.hset(`conflict:session:${sessionId}`, {
    status:         'resolved',
    resolvedAt:     now,
    resolvedBy:     resolution.resolvedBy,
    resolutionType: resolution.type,
    mergedBody,
    mergedSig,
  })

  await redis.hdel(`entity:${session.entityName}:meta`, 'conflictSessionId')
  await redis.hset(`entity:${session.entityName}`, {
    signature: mergedSig,
    body:      mergedBody,
    devId:     resolution.resolvedBy,
    updatedAt: now,
  })

  db.query(
    `UPDATE conflicts
        SET resolved = true, resolution_type = $1, resolved_by = $2,
            resolved_at = $3, merged_body = $4, merged_sig = $5
      WHERE conflict_session_id = $6`,
    [resolution.type, resolution.resolvedBy, now, mergedBody, mergedSig, sessionId],
  ).catch((err: Error) => log.error({ err }, 'failed to update conflict resolution'))

  return { ...session, status: 'resolved', resolvedAt: now, resolutionType: resolution.type, mergedBody, mergedSig }
}

export async function appendStaleWrite(
  sessionId:    string,
  devId:        string,
  entityName:   string,
  conflictType: ConflictType,
): Promise<number> {
  const blastRadius = await getRedisClient().hincrby(
    `conflict:session:${sessionId}`, 'blastRadius', 1,
  )

  db.query(
    `INSERT INTO stale_writes (dev_id, entity_name, conflict_session_id, conflict_type)
     VALUES ($1, $2, $3, $4)`,
    [devId, entityName, sessionId, conflictType],
  ).catch((err: Error) => log.error({ err }, 'failed to persist stale write'))

  return blastRadius
}

export async function getOpenSessions(): Promise<ConflictSession[]> {
  const redis   = getRedisClient()
  const keys    = await redis.keys('conflict:session:*')
  const results = await Promise.all(
    keys.map(k => getSession(k.replace('conflict:session:', ''))),
  )
  return results.filter((s): s is ConflictSession => s !== null && s.status !== 'resolved')
}
