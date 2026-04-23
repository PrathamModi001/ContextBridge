import { getRedisClient } from '../../config/redis'
import { db } from '../../config/postgres'
import { EntityDiffPayload } from '../../types'
import { createModuleLogger } from '../../logger/logger'

const log = createModuleLogger('entity-service')

export async function handleDiff(devId: string, entities: EntityDiffPayload[]): Promise<void> {
  const redis = getRedisClient()

  for (const entity of entities) {
    await redis.hset(`entity:${entity.name}`, {
      signature: entity.newSig,
      body: entity.body,
      devId,
      file: entity.file,
      line: String(entity.line),
      kind: entity.kind,
      updatedAt: new Date().toISOString(),
    })

    await redis.set(`lock:${entity.name}`, devId, 'EX', 15)
    await redis.sadd(`client:${devId}:entities`, entity.name)

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
