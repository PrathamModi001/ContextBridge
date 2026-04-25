import { getRedisClient } from '../../config/redis'

/**
 * entity:{called}:dependents = set of entity names that call `called`
 * (reverse index: who depends on me)
 */
export async function updateDependents(entityName: string, calledEntities: string[]): Promise<void> {
  if (calledEntities.length === 0) return
  const redis = getRedisClient()
  for (const called of calledEntities) {
    await redis.sadd(`entity:${called}:dependents`, entityName)
  }
}

/** entity:{name}:calls = forward index: what this entity calls */
export async function updateEntityCalls(entityName: string, calledEntities: string[]): Promise<void> {
  const redis = getRedisClient()
  await redis.del(`entity:${entityName}:calls`)
  if (calledEntities.length > 0) {
    await redis.sadd(`entity:${entityName}:calls`, ...calledEntities)
  }
}

export async function getEntityCalls(entityName: string): Promise<string[]> {
  return getRedisClient().smembers(`entity:${entityName}:calls`)
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

/** Build graph edges for the given entity names from the forward-calls index. */
export async function getLinksForEntities(
  entityNames: string[],
): Promise<Array<{ source: string; target: string }>> {
  const links: Array<{ source: string; target: string }> = []
  for (const name of entityNames) {
    const calls = await getEntityCalls(name)
    for (const called of calls) {
      links.push({ source: name, target: called })
    }
  }
  return links
}
