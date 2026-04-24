import { useEffect, useState } from 'react'
import { io, Socket } from 'socket.io-client'

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? ''

export function useSocket() {
  const [socket, setSocket] = useState<Socket | null>(null)
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    const s = io(SERVER_URL, {
      auth: { devId: 'dashboard' },
      transports: ['websocket', 'polling'],
    })

    s.on('connect', () => {
      setConnected(true)
      s.emit('join', { room: 'dashboard' })
    })

    s.on('disconnect', () => setConnected(false))

    setSocket(s)

    return () => { s.disconnect() }
  }, [])

  return { socket, connected }
}
