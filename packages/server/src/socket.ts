import { Server as HttpServer } from 'http'
import { Server, Socket } from 'socket.io'
import { createModuleLogger } from './logger/logger'
import { getRedisClient } from './config/redis'
import * as entityService from './services/entity/entity.service'
import { EntityDiffPayload, ConflictPayload } from './types'
import { detectConflict, storeConflict } from './services/conflict/conflict.detector'
import { getEntityClients, getLinksForEntities } from './services/graph/graph.service'

const log = createModuleLogger('socket')

let io: Server

export function getIo(): Server {
  return io
}

export async function handleEntityDiffEvent(
  devId: string,
  payload: EntityDiffPayload[],
): Promise<ConflictPayload[]> {
  const conflicts: ConflictPayload[] = []
  for (const entity of payload) {
    const conflict = await detectConflict(entity.name, devId, entity.newSig)
    if (conflict) {
      conflicts.push(conflict)
      await storeConflict(conflict)
    }
  }
  await entityService.handleDiff(devId, payload)
  return conflicts
}

export async function handleHeartbeatEvent(devId: string): Promise<void> {
  await getRedisClient().set(`client:${devId}:heartbeat`, '1', 'EX', 30)
}

async function sendDashboardSnapshot(socket: Socket): Promise<void> {
  try {
    const redis = getRedisClient()
    const entityKeys = await redis.keys('entity:*')
    const seen = new Set<string>()

    for (const key of entityKeys) {
      if (key.includes(':dependents') || key.includes(':clients') || key.includes(':calls')) continue
      const name = key.replace('entity:', '')
      if (seen.has(name)) continue
      seen.add(name)

      const fields = await redis.hgetall(key)
      if (!fields || !fields.signature) continue

      socket.emit('entity:updated', {
        name,
        devId:     fields.devId ?? 'unknown',
        signature: fields.signature,
        kind:      fields.kind ?? 'function',
        file:      fields.file ?? '',
        severity:  'info' as const,
        locked:    false,
      })
    }

    const entityNames = [...seen]
    if (entityNames.length > 0) {
      const links = await getLinksForEntities(entityNames)
      if (links.length > 0) {
        socket.emit('graph:links', links.map(l => ({ ...l, conflict: false })))
      }
    }
  } catch (err) {
    log.error({ err }, 'failed to send dashboard snapshot')
  }
}

export function initSocket(httpServer: HttpServer): Server {
  io = new Server(httpServer, {
    cors: { origin: '*' },
  })

  io.on('connection', (socket) => {
    const { devId } = socket.handshake.auth as { devId?: string }
    if (!devId) {
      socket.disconnect()
      return
    }

    socket.join(`room:${devId}`)
    io.emit('client:connected', { devId })
    log.info(`[socket] ${devId} connected`)

    socket.on('join', ({ room }: { room: string }) => {
      socket.join(`room:${room}`)
      log.info(`[socket] ${devId} joined room:${room}`)

      if (room === 'dashboard') {
        sendDashboardSnapshot(socket).catch(err =>
          log.error({ err }, 'snapshot send error')
        )
      }
    })

    socket.on('entity:diff', async (payload: EntityDiffPayload[]) => {
      try {
        const conflicts = await handleEntityDiffEvent(devId, payload)

        for (const entity of payload) {
          io.to('room:dashboard').emit('entity:updated', {
            name:      entity.name,
            devId,
            signature: entity.newSig,
            kind:      entity.kind,
            file:      entity.file,
            severity:  'info' as const,
            locked:    true,
          })
        }

        /* Emit graph edges so dashboard can render links */
        const entityNames = payload.map(e => e.name)
        const links = await getLinksForEntities(entityNames)
        if (links.length > 0) {
          io.to('room:dashboard').emit('graph:links', links.map(l => ({ ...l, conflict: false })))
        }

        for (const conflict of conflicts) {
          const clients = await getEntityClients(conflict.entityName)
          const targets = new Set([...clients, conflict.devAId, devId])
          for (const clientId of targets) {
            io.to(`room:${clientId}`).emit('entity:conflict', conflict)
          }
          io.to('room:dashboard').emit('conflict:detected', {
            ...conflict,
            /* mark edges involving the conflicting entity as conflict links */
          })

          /* Update link severity for conflicting entity */
          io.to('room:dashboard').emit('graph:links', [
            { source: conflict.devBId, target: conflict.entityName, conflict: true },
          ])
        }
      } catch (err) {
        log.error({ err }, 'entity:diff handler error')
      }
    })

    socket.on('heartbeat', async () => {
      try {
        await handleHeartbeatEvent(devId)
      } catch (err) {
        log.error({ err }, 'heartbeat handler error')
      }
    })

    socket.on('disconnect', () => {
      log.warn(`[socket] ${devId} disconnected`)
      io.emit('client:disconnected', { devId })
    })
  })

  subscribeToKeyExpiry(io)

  return io
}

function subscribeToKeyExpiry(server: Server): void {
  const redis = getRedisClient()

  /* Enable keyspace expiry notifications */
  redis.config('SET', 'notify-keyspace-events', 'Ex').catch((err: Error) =>
    log.warn({ err }, 'could not set keyspace-events config (read-only Redis?)')
  )

  try {
    const subscriber = redis.duplicate()

    /* Explicit connect required when lazyConnect: true */
    subscriber.connect().then(() => {
      subscriber.on('message', async (_channel: string, key: string) => {
        if (!key.startsWith('client:') || !key.endsWith(':heartbeat')) return

        const parts = key.split(':')
        const expiredDevId = parts.slice(1, -1).join(':')
        try {
          const entityNames = await redis.smembers(`client:${expiredDevId}:entities`)
          for (const name of entityNames) {
            const owner = await redis.hget(`entity:${name}`, 'devId')
            if (owner === expiredDevId) await redis.del(`entity:${name}`)
            await redis.srem(`entity:${name}:clients`, expiredDevId)
          }
          await redis.del(`client:${expiredDevId}:entities`)
          server.emit('client:disconnected', { devId: expiredDevId })
          log.info(`[cleanup] ${expiredDevId} expired — ${entityNames.length} entities cleared`)
        } catch (err) {
          log.error({ err }, 'keyspace expiry cleanup error')
        }
      })

      return subscriber.subscribe('__keyevent@0__:expired')
    }).catch((err: Error) => {
      log.error({ err }, 'keyspace subscription error')
    })
  } catch (err) {
    log.error({ err }, 'failed to set up keyspace subscription')
  }
}
