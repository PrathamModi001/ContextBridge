import { createSocketClient, emitEntityDiff, Emitter } from '../src/socket'
import { EntityDiff } from '../src/types'

// ── Mock socket.io-client ────────────────────────────────────────────────────

class MockSocket {
  private _handlers: Map<string, ((...args: unknown[]) => void)[]> = new Map()

  on = jest.fn().mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
    if (!this._handlers.has(event)) this._handlers.set(event, [])
    this._handlers.get(event)!.push(handler)
    return this
  })

  emit = jest.fn()
  disconnect = jest.fn()
  connected = true

  trigger(event: string, ...args: unknown[]): void {
    for (const h of this._handlers.get(event) ?? []) h(...args)
  }
}

jest.mock('socket.io-client', () => ({
  io: jest.fn(),
}))

import { io } from 'socket.io-client'

let mockSocket: MockSocket

beforeEach(() => {
  jest.clearAllMocks()
  mockSocket = new MockSocket()
  ;(io as jest.Mock).mockReturnValue(mockSocket)
})

// ── createSocketClient ───────────────────────────────────────────────────────

describe('createSocketClient', () => {
  it('calls io() with correct server URL', () => {
    createSocketClient('http://localhost:3000', 'dev-1')
    expect(io).toHaveBeenCalledWith('http://localhost:3000', expect.any(Object))
  })

  it('passes devId in auth', () => {
    createSocketClient('http://localhost:3000', 'dev-42')
    expect(io).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ auth: { devId: 'dev-42' } }),
    )
  })

  it('enables reconnection', () => {
    createSocketClient('http://localhost:3000', 'dev-1')
    expect(io).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ reconnection: true }),
    )
  })

  it('registers connect handler', () => {
    createSocketClient('http://localhost:3000', 'dev-1')
    expect(mockSocket.on).toHaveBeenCalledWith('connect', expect.any(Function))
  })

  it('registers disconnect handler', () => {
    createSocketClient('http://localhost:3000', 'dev-1')
    expect(mockSocket.on).toHaveBeenCalledWith('disconnect', expect.any(Function))
  })

  it('registers conflict:detected handler', () => {
    createSocketClient('http://localhost:3000', 'dev-1')
    expect(mockSocket.on).toHaveBeenCalledWith('conflict:detected', expect.any(Function))
  })

  it('returns socket and close function', () => {
    const handle = createSocketClient('http://localhost:3000', 'dev-1')
    expect(handle.socket).toBeDefined()
    expect(typeof handle.close).toBe('function')
  })

  // ── Heartbeat ────────────────────────────────────────────────────────────────

  it('emits heartbeat after 10s when connected', () => {
    jest.useFakeTimers()
    try {
      createSocketClient('http://localhost:3000', 'dev-1')
      jest.advanceTimersByTime(10_000)
      expect(mockSocket.emit).toHaveBeenCalledWith(
        'heartbeat',
        expect.objectContaining({ devId: 'dev-1' }),
      )
    } finally {
      jest.useRealTimers()
    }
  })

  it('heartbeat payload includes ts timestamp', () => {
    jest.useFakeTimers()
    try {
      const before = Date.now()
      createSocketClient('http://localhost:3000', 'dev-1')
      jest.advanceTimersByTime(10_000)

      const call = mockSocket.emit.mock.calls.find(([ev]) => ev === 'heartbeat')
      expect(call).toBeDefined()
      expect(call![1].ts).toBeGreaterThanOrEqual(before)
    } finally {
      jest.useRealTimers()
    }
  })

  it('heartbeat fires 3 times after 30s', () => {
    jest.useFakeTimers()
    try {
      createSocketClient('http://localhost:3000', 'dev-1')
      jest.advanceTimersByTime(30_000)
      const beats = mockSocket.emit.mock.calls.filter(([ev]) => ev === 'heartbeat')
      expect(beats).toHaveLength(3)
    } finally {
      jest.useRealTimers()
    }
  })

  it('does NOT emit heartbeat when socket is disconnected', () => {
    jest.useFakeTimers()
    try {
      mockSocket.connected = false
      createSocketClient('http://localhost:3000', 'dev-1')
      jest.advanceTimersByTime(10_000)
      const beats = mockSocket.emit.mock.calls.filter(([ev]) => ev === 'heartbeat')
      expect(beats).toHaveLength(0)
    } finally {
      jest.useRealTimers()
    }
  })

  it('disconnect event clears heartbeat interval', () => {
    jest.useFakeTimers()
    try {
      createSocketClient('http://localhost:3000', 'dev-1')
      mockSocket.trigger('disconnect', 'transport close')

      jest.advanceTimersByTime(20_000)
      const beats = mockSocket.emit.mock.calls.filter(([ev]) => ev === 'heartbeat')
      expect(beats).toHaveLength(0)
    } finally {
      jest.useRealTimers()
    }
  })

  // ── close() ──────────────────────────────────────────────────────────────────

  it('close() calls socket.disconnect()', () => {
    const { close } = createSocketClient('http://localhost:3000', 'dev-1')
    close()
    expect(mockSocket.disconnect).toHaveBeenCalled()
  })

  it('close() stops heartbeat from firing', () => {
    jest.useFakeTimers()
    try {
      const { close } = createSocketClient('http://localhost:3000', 'dev-1')
      close()
      jest.advanceTimersByTime(30_000)
      const beats = mockSocket.emit.mock.calls.filter(([ev]) => ev === 'heartbeat')
      expect(beats).toHaveLength(0)
    } finally {
      jest.useRealTimers()
    }
  })

  it('close() called twice does not throw', () => {
    const { close } = createSocketClient('http://localhost:3000', 'dev-1')
    expect(() => { close(); close() }).not.toThrow()
  })
})

// ── emitEntityDiff ───────────────────────────────────────────────────────────

describe('emitEntityDiff', () => {
  let emitter: Emitter

  beforeEach(() => {
    emitter = { emit: jest.fn() }
  })

  it('calls emit with entity:diff event', () => {
    const diffs: EntityDiff[] = [
      { name: 'foo', kind: 'function', oldSig: null, newSig: 'foo(): void', body: '', file: 'a.ts', line: 1 },
    ]
    emitEntityDiff(emitter, diffs)
    expect(emitter.emit).toHaveBeenCalledWith('entity:diff', diffs)
  })

  it('emits empty array when no diffs', () => {
    emitEntityDiff(emitter, [])
    expect(emitter.emit).toHaveBeenCalledWith('entity:diff', [])
  })

  it('emits multiple diffs in one call', () => {
    const diffs: EntityDiff[] = [
      { name: 'foo', kind: 'function', oldSig: null, newSig: 'foo(): void', body: '', file: 'a.ts', line: 1 },
      { name: 'bar', kind: 'interface', oldSig: 'interface bar {}', newSig: 'interface bar { x: string }', body: '', file: 'a.ts', line: 5 },
    ]
    emitEntityDiff(emitter, diffs)
    expect(emitter.emit).toHaveBeenCalledWith('entity:diff', diffs)
    expect(emitter.emit).toHaveBeenCalledTimes(1)
  })

  it('preserves all EntityDiff fields in payload', () => {
    const diff: EntityDiff = {
      name: 'doThing',
      kind: 'function',
      oldSig: 'doThing(x: string)',
      newSig: 'doThing(x: string, y: number)',
      body: 'function doThing(...) {}',
      file: 'src/things.ts',
      line: 42,
    }
    emitEntityDiff(emitter, [diff])
    const emitted = (emitter.emit as jest.Mock).mock.calls[0][1]
    expect(emitted[0]).toEqual(diff)
  })

  it('emitter.emit called exactly once per emitEntityDiff call', () => {
    emitEntityDiff(emitter, [])
    emitEntityDiff(emitter, [])
    expect(emitter.emit).toHaveBeenCalledTimes(2)
  })
})
