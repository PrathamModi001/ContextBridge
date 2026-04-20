import { Server as HttpServer } from 'http'
import { Server } from 'socket.io'
import { createModuleLogger } from './logger/logger'

const log = createModuleLogger('socket')

let io: Server

export function getIo(): Server {
  return io
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

    socket.on('disconnect', () => {
      log.warn(`[socket] ${devId} disconnected`)
      io.emit('client:disconnected', { devId })
    })
  })

  return io
}
