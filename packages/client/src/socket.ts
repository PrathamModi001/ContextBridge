import { io, Socket } from 'socket.io-client'
import { EntityDiff } from './types'
import { createLogger } from './logger'

const log = createLogger('socket')

export interface Emitter {
  emit(event: string, data: unknown): void
}

export interface SocketHandle {
  socket: Socket
  close: () => void
}

export function createSocketClient(serverUrl: string, devId: string): SocketHandle {
  const socket = io(serverUrl, {
    auth: { devId },
    reconnection: true,
    reconnectionDelay: 1000,
  })

  socket.on('connect', () => {
    log.info({ devId }, 'connected to server')
  })

  socket.on('conflict:detected', (payload: unknown) => {
    log.warn({ payload }, 'conflict detected')
  })

  const heartbeatTimer = setInterval(() => {
    if (socket.connected) {
      socket.emit('heartbeat', { devId, ts: Date.now() })
    }
  }, 10_000)

  socket.on('disconnect', (reason: string) => {
    log.warn({ reason }, 'disconnected from server')
    clearInterval(heartbeatTimer)
  })

  return {
    socket,
    close() {
      clearInterval(heartbeatTimer)
      socket.disconnect()
    },
  }
}

export function emitEntityDiff(emitter: Emitter, diffs: EntityDiff[]): void {
  emitter.emit('entity:diff', diffs)
}
