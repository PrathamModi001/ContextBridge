import Redis from 'ioredis'
import { env } from './env'
import { createModuleLogger } from '../logger/logger'

const log = createModuleLogger('redis')

let redisClient: Redis

export function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = new Redis(env.redisUrl, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: true,
    })

    redisClient.on('ready', () => log.info('Redis connected'))
    redisClient.on('error', (err) => log.error({ err }, 'Redis error'))
    redisClient.on('close', () => log.warn('Redis connection closed'))
  }
  return redisClient
}

export async function connectRedis(): Promise<void> {
  const client = getRedisClient()
  await client.connect()
}

export { redisClient as default }
