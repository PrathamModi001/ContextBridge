import { getRedisClient } from '../../config/redis'

export async function updateDependents(entityName: string, calledEntities: string[]): Promise<void> {
  if (calledEntities.length === 0) return
  const redis = getRedisClient()
  await redis.sadd(`entity:${entityName}:dependents`, ...calledEntities)
}

export async function getDependents(entityName: string): Promise<string[]> {
  return getRedisClient().smembers(`entity:${entityName}:dependents`)
}

export async function getImpactCount(entityName: string): Promise<number> {
  const redis = getRedisClient()
  const visited = new Set<string>()
  const queue: string[] = [entityName]

  while (queue.length > 0) {
    const current = queue.shift()!
    if (visited.has(current)) continue
    visited.add(current)
    const deps = await redis.smembers(`entity:${current}:dependents`)
    for (const d of deps) {
      if (!visited.has(d)) queue.push(d)
    }
  }

  return visited.size - 1
}

export async function updateClientIndex(devId: string, calledEntityNames: string[]): Promise<void> {
  if (calledEntityNames.length === 0) return
  const redis = getRedisClient()
  for (const name of calledEntityNames) {
    await redis.sadd(`entity:${name}:clients`, devId)
  }
}

export async function getEntityClients(entityName: string): Promise<string[]> {
  return getRedisClient().smembers(`entity:${entityName}:clients`)
}
