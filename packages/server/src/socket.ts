import { Server as HttpServer } from 'http'
import { Server, Socket } from 'socket.io'
import { createModuleLogger } from './logger/logger'
import { getRedisClient } from './config/redis'
import * as entityService from './services/entity/entity.service'
import { EntityDiffPayload, EnrichedConflictPayload, Resolution } from './types'
import { detectConflict, detectConflictType, isSecuritySensitive, storeConflict } from './services/conflict/conflict.detector'
import { createSession, getSession, resolveSession, appendStaleWrite, getOpenSessions } from './services/conflict/conflict.session.service'
import { getEntityClients, getLinksForEntities } from './services/graph/graph.service'

const log = createModuleLogger('socket')

let io: Server

function sessionPayload(session: import('./types').ConflictSession) {
  return {
    sessionId:         session.id,
    entityName:        session.entityName,
    devAId:            session.devAId,
    devBId:            session.devBId,
    devASig:           session.devASig,
    devBSig:           session.devBSig,
    devABody:          session.devABody,
    devBBody:          session.devBBody,
    blastRadius:       session.blastRadius,
    securitySensitive: session.securitySensitive,
    conflictType:      session.conflictType,
    detectedAt:        session.detectedAt,
  }
}

export function getIo(): Server { return io }

export async function handleEntityDiffEvent(
  devId:   string,
  payload: EntityDiffPayload[],
): Promise<void> {
  const redis = getRedisClient()

  const needsDiff: EntityDiffPayload[] = []

  for (const entity of payload) {
    /* ── Skip conflict detection during post-resolution grace period ── */
    const recentlyResolved = await redis.get(`resolved:${entity.name}`)
    if (recentlyResolved) {
      needsDiff.push(entity)
      continue
    }

    const openSessionId = await entityService.getEntityConflictSession(entity.name)

    if (openSessionId) {
      /* ── Stale write: entity already has open conflict session ── */
      const session = await getSession(openSessionId)
      if (session) {
        const blastRadius = await appendStaleWrite(
          openSessionId, devId, entity.name,
          detectConflictType(entity.name, session.devASig, entity.newSig, entity.kind),
        )
        const blastPayload = {
          sessionId:      openSessionId,
          blastRadius,
          newStaleEntity: entity.name,
          devId,
        }
        io.to('room:dashboard').emit('conflict:blast:update', blastPayload)
        io.to(`room:${devId}`).emit('conflict:blast:update', blastPayload)
      }
    } else {
      /* ── Check for new conflict ── */
      const conflict = await detectConflict(entity.name, devId, entity.newSig)
      if (conflict) {
        const devABody = await redis.hget(`entity:${entity.name}`, 'body') ?? ''
        const devASig  = await redis.hget(`entity:${entity.name}`, 'signature') ?? ''
        const conflictType      = detectConflictType(entity.name, devASig, entity.newSig, entity.kind)
        const securitySensitive = isSecuritySensitive(entity.name)

        const session = await createSession(
          entity.name,
          conflict.devAId, devId,
          devABody, devASig,
          entity.body, entity.newSig,
          conflictType, securitySensitive,
        )

        const enriched: EnrichedConflictPayload = {
          ...conflict,
          sessionId: session.id,
          conflictType,
          securitySensitive,
          devABody,
          devBBody: entity.body,
        }

        await storeConflict(conflict)

        const clients = await getEntityClients(entity.name)
        const targets = new Set([...clients, conflict.devAId, devId])
        for (const clientId of targets) {
          io.to(`room:${clientId}`).emit('entity:conflict', enriched)
        }
        io.to('room:dashboard').emit('conflict:session:opened', sessionPayload(session))
        io.to('room:dashboard').emit('conflict:detected', enriched)
        io.to('room:dashboard').emit('graph:links', [
          { source: devId, target: entity.name, conflict: true },
        ])
      }
    }

    needsDiff.push(entity)
  }

  if (needsDiff.length > 0) await entityService.handleDiff(devId, needsDiff)
}

export async function resolveConflictSession(
  sessionId:  string,
  resolution: Resolution,
): Promise<void> {
  if (!io) throw new Error('Socket server not initialized')
  const session = await resolveSession(sessionId, resolution)
  const redis = getRedisClient()
  await redis.del(`lock:${session.entityName}`)
  await redis.set(`resolved:${session.entityName}`, '1', 'EX', 10)

  const acceptedBody = session.mergedBody ?? ''
  const acceptedSig  = session.mergedSig  ?? ''

  /* Look up the entity's file path from Redis */
  const entityFile = await getRedisClient().hget(`entity:${session.entityName}`, 'file') ?? ''

  /* Push accepted version to both agents */
  for (const agentDevId of [session.devAId, session.devBId]) {
    io.to(`room:${agentDevId}`).emit('conflict:accepted', {
      entityName: session.entityName,
      body:       acceptedBody,
      sig:        acceptedSig,
      file:       entityFile,
    })
  }

  io.to('room:dashboard').emit('conflict:resolved', {
    sessionId,
    entityName:     session.entityName,
    resolutionType: resolution.type,
    resolvedBy:     resolution.resolvedBy,
  })

  /* Use Redis fields for accurate kind + file in entity:updated */
  const entityKind = await getRedisClient().hget(`entity:${session.entityName}`, 'kind') ?? 'function'
  io.to('room:dashboard').emit('entity:updated', {
    name:      session.entityName,
    devId:     resolution.resolvedBy,
    signature: acceptedSig,
    kind:      entityKind,
    file:      entityFile,
    severity:  'info' as const,
    locked:    false,
  })
}

export async function handleHeartbeatEvent(devId: string): Promise<void> {
  await getRedisClient().set(`client:${devId}:heartbeat`, '1', 'EX', 30)
}

async function sendDashboardSnapshot(socket: Socket): Promise<void> {
  try {
    for (const [, s] of io.sockets.sockets) {
      const auth = s.handshake.auth as { devId?: string }
      if (auth.devId && auth.devId !== 'dashboard') {
        socket.emit('client:connected', { devId: auth.devId })
      }
    }

    const redis      = getRedisClient()
    const entityKeys = await redis.keys('entity:*')
    const seen       = new Set<string>()

    for (const key of entityKeys) {
      if (key.includes(':meta') || key.includes(':dependents') ||
          key.includes(':clients') || key.includes(':calls')) continue
      const name = key.replace('entity:', '')
      if (seen.has(name)) continue
      seen.add(name)
      const fields = await redis.hgetall(key)
      if (!fields?.signature) continue
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

    const rawConflicts = await redis.lrange('conflicts:recent', 0, 9)
    for (const raw of [...rawConflicts].reverse()) {
      try { socket.emit('conflict:detected', JSON.parse(raw)) } catch { /* skip */ }
    }

    /* Replay open conflict sessions */
    const openSessions = await getOpenSessions()
    for (const session of openSessions) {
      socket.emit('conflict:session:opened', sessionPayload(session))
    }
  } catch (err) {
    log.error({ err }, 'failed to send dashboard snapshot')
  }
}

export function initSocket(httpServer: HttpServer): Server {
  io = new Server(httpServer, { cors: { origin: '*' } })

  io.on('connection', (socket) => {
    const { devId } = socket.handshake.auth as { devId?: string }
    if (!devId) { socket.disconnect(); return }

    socket.join(`room:${devId}`)
    io.emit('client:connected', { devId })
    log.info(`[socket] ${devId} connected`)

    socket.on('join', ({ room }: { room: string }) => {
      socket.join(`room:${room}`)
      log.info(`[socket] ${devId} joined room:${room}`)
      if (room === 'dashboard') {
        sendDashboardSnapshot(socket).catch(err =>
          log.error({ err }, 'snapshot send error'),
        )
      }
    })

    socket.on('entity:diff', async (payload: EntityDiffPayload[]) => {
      log.info({ devId, count: payload.length }, '[entity:diff] received')
      try {
        await handleEntityDiffEvent(devId, payload)
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
        const links = await getLinksForEntities(payload.map(e => e.name))
        if (links.length > 0) {
          io.to('room:dashboard').emit('graph:links', links.map(l => ({ ...l, conflict: false })))
        }
      } catch (err) {
        log.error({ err }, 'entity:diff handler error')
      }
    })

    socket.on('heartbeat', async () => {
      try {
        await handleHeartbeatEvent(devId)
        io.to('room:dashboard').emit('client:heartbeat', { devId, ts: Date.now() })
        const redis = getRedisClient()
        const owned = await redis.smembers(`client:${devId}:entities`)
        for (const name of owned) {
          const currentOwner = await redis.get(`lock:${name}`)
          if (currentOwner === devId) await redis.expire(`lock:${name}`, 300)
        }
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
  redis.config('SET', 'notify-keyspace-events', 'Ex').catch((err: Error) =>
    log.warn({ err }, 'could not set keyspace-events config'),
  )
  try {
    const subscriber = redis.duplicate()
    subscriber.connect().then(() => {
      subscriber.on('message', async (_channel: string, key: string) => {
        if (!key.startsWith('client:') || !key.endsWith(':heartbeat')) return
        const parts        = key.split(':')
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
    }).catch((err: Error) => log.error({ err }, 'keyspace subscription error'))
  } catch (err) {
    log.error({ err }, 'failed to set up keyspace subscription')
  }
}
