import { Server as HttpServer } from 'http'
import { Server } from 'socket.io'
import { createModuleLogger } from './logger/logger'
import { getRedisClient } from './config/redis'
import * as entityService from './services/entity/entity.service'
import { EntityDiffPayload, ConflictPayload } from './types'
import { detectConflict, storeConflict } from './services/conflict/conflict.detector'
import { getEntityClients } from './services/graph/graph.service'

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
    })

    socket.on('entity:diff', async (payload: EntityDiffPayload[]) => {
      try {
        const conflicts = await handleEntityDiffEvent(devId, payload)

        for (const entity of payload) {
          io.to('room:dashboard').emit('entity:updated', {
            name: entity.name,
            devId,
            signature: entity.newSig,
            kind: entity.kind,
            file: entity.file,
            severity: 'info',
            locked: true,
          })
        }

        for (const conflict of conflicts) {
          const clients = await getEntityClients(conflict.entityName)
          const targets = new Set([...clients, conflict.devAId, devId])
          for (const clientId of targets) {
            io.to(`room:${clientId}`).emit('entity:conflict', conflict)
          }
          io.to('room:dashboard').emit('conflict:detected', conflict)
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
  try {
    const redis = getRedisClient()
    const subscriber = redis.duplicate()

    subscriber.on('message', async (_channel: string, key: string) => {
      if (!key.startsWith('client:') || !key.endsWith(':heartbeat')) return

      const parts = key.split(':')
      const devId = parts.slice(1, -1).join(':')
      try {
        const entityNames = await redis.smembers(`client:${devId}:entities`)
        for (const name of entityNames) {
          const owner = await redis.hget(`entity:${name}`, 'devId')
          if (owner === devId) await redis.del(`entity:${name}`)
          await redis.srem(`entity:${name}:clients`, devId)
        }
        await redis.del(`client:${devId}:entities`)
        server.emit('client:disconnected', { devId })
        log.info(`[cleanup] ${devId} expired — ${entityNames.length} entities cleared`)
      } catch (err) {
        log.error({ err }, 'keyspace expiry cleanup error')
      }
    })

    subscriber.subscribe('__keyevent@0__:expired').catch((err: Error) => {
      log.error({ err }, 'keyspace subscription error')
    })
  } catch (err) {
    log.error({ err }, 'failed to set up keyspace subscription')
  }
}
