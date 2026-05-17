import Redis from 'ioredis'
import { getRedisClient } from '../../config/redis'
import { db } from '../../config/postgres'
import { EntityDiffPayload } from '../../types'
import { createModuleLogger } from '../../logger/logger'
import { updateDependents, updateClientIndex, updateEntityCalls } from '../graph/graph.service'
import { BUILTIN_IDENTIFIERS } from '../../utils/identifiers'

const log = createModuleLogger('entity-service')

function extractCalls(body: string): string[] {
  const callPattern = /\b([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g
  const candidates  = new Set<string>()
  let match: RegExpExecArray | null
  while ((match = callPattern.exec(body)) !== null) {
    const name = match[1]
    if (!BUILTIN_IDENTIFIERS.has(name) && name.length > 1) candidates.add(name)
  }
  return [...candidates]
}

async function knownEntityCalls(redis: Redis, body: string): Promise<string[]> {
  const candidates = extractCalls(body)
  if (candidates.length === 0) return []
  const known: string[] = []
  for (const name of candidates) {
    const exists = await redis.exists(`entity:${name}`)
    if (exists) known.push(name)
  }
  return known
}

/** Returns the conflictSessionId for an entity if one is open, otherwise null. */
export async function getEntityConflictSession(entityName: string): Promise<string | null> {
  const redis = getRedisClient()
  const sessionId = await redis.hget(`entity:${entityName}:meta`, 'conflictSessionId')
  return sessionId ?? null
}

export async function handleDiff(devId: string, entities: EntityDiffPayload[]): Promise<void> {
  const redis = getRedisClient()

  for (const entity of entities) {
    await redis.hset(`entity:${entity.name}`, {
      signature: entity.newSig,
      body:      entity.body,
      devId,
      file:      entity.file,
      line:      String(entity.line),
      kind:      entity.kind,
      updatedAt: new Date().toISOString(),
    })

    await redis.set(`lock:${entity.name}`, devId, 'EX', 300)
    await redis.sadd(`client:${devId}:entities`, entity.name)

    const calledNames = await knownEntityCalls(redis, entity.body ?? '')
    if (calledNames.length > 0) {
      await updateEntityCalls(entity.name, calledNames)
      await updateDependents(entity.name, calledNames)
      await updateClientIndex(devId, calledNames)
    }

    writeEntityChangeAsync(devId, entity)
  }
}

function writeEntityChangeAsync(devId: string, entity: EntityDiffPayload): void {
  db.query(
    `INSERT INTO entity_changes
       (entity_name, dev_id, old_signature, new_signature, severity, kind, body, file, line)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [entity.name, devId, entity.oldSig, entity.newSig, 'info',
     entity.kind, entity.body, entity.file, entity.line],
  ).catch((err: Error) => log.error({ err }, 'failed to write entity change'))
}
