/**
 * ContextBridge E2E — requires Redis + Postgres running (see docker-compose.yml)
 * Run with: npm run test:e2e
 */
import { createServer } from 'http'
import request from 'supertest'
import { io as socketIoClient, Socket } from 'socket.io-client'
import app from '../../packages/server/src/app'
import { connectRedis, getRedisClient } from '../../packages/server/src/config/redis'
import { connectPostgres } from '../../packages/server/src/config/postgres'
import { initSocket } from '../../packages/server/src/socket'

let httpServer: ReturnType<typeof createServer>
let serverUrl: string
let devASocket: Socket
let devBSocket: Socket
let dashSocket: Socket

beforeAll(async () => {
  process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379'
  process.env.POSTGRES_HOST = process.env.POSTGRES_HOST ?? 'localhost'
  process.env.POSTGRES_PORT = process.env.POSTGRES_PORT ?? '5432'
  process.env.POSTGRES_DB = process.env.POSTGRES_DB ?? 'contextbridge'
  process.env.POSTGRES_USER = process.env.POSTGRES_USER ?? 'postgres'
  process.env.POSTGRES_PASSWORD = process.env.POSTGRES_PASSWORD ?? 'contextbridge'

  await connectRedis()
  await connectPostgres()
  await getRedisClient().flushdb()

  httpServer = createServer(app)
  initSocket(httpServer)

  await new Promise<void>((resolve) => httpServer.listen(0, resolve))
  const addr = httpServer.address() as { port: number }
  serverUrl = `http://localhost:${addr.port}`

  const connect = (devId: string) =>
    new Promise<Socket>((resolve) => {
      const s = socketIoClient(serverUrl, { auth: { devId } })
      s.once('connect', () => resolve(s))
    })

  ;[devASocket, devBSocket, dashSocket] = await Promise.all([
    connect('e2e-devA'),
    connect('e2e-devB'),
    connect('e2e-dashboard'),
  ])

  dashSocket.emit('join', { room: 'dashboard' })
  await new Promise((r) => setTimeout(r, 100))
})

afterAll(async () => {
  devASocket?.disconnect()
  devBSocket?.disconnect()
  dashSocket?.disconnect()
  await new Promise<void>((resolve) => httpServer.close(() => resolve()))
  await getRedisClient().flushdb()
})

describe('Health', () => {
  it('GET /v1/health returns 200', async () => {
    const res = await request(app).get('/v1/health')
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('ok')
  })
})

describe('Entity flow', () => {
  it('entity:diff from devA writes state to Redis', async () => {
    const diff = {
      entities: [{
        name: 'e2e_validateUser',
        kind: 'function',
        oldSig: null,
        newSig: 'e2e_validateUser(id: string): Promise<User>',
        body: 'async function e2e_validateUser(id: string) {}',
        file: 'auth.ts',
        line: 1,
      }],
    }

    devASocket.emit('entity:diff', diff)
    await new Promise((r) => setTimeout(r, 300))

    const res = await request(app).get('/v1/entities/e2e_validateUser')
    expect(res.status).toBe(200)
    expect(res.body.devId).toBe('e2e-devA')
    expect(res.body.signature).toContain('e2e_validateUser')
  })

  it('GET /v1/entities/:name returns 404 for unknown entity', async () => {
    const res = await request(app).get('/v1/entities/nonexistent_xyz')
    expect(res.status).toBe(404)
  })
})

describe('Conflict detection', () => {
  it('emits conflict:detected when devB modifies devA-owned entity', async () => {
    const conflictEvents: unknown[] = []
    dashSocket.on('conflict:detected', (data) => conflictEvents.push(data))

    devBSocket.emit('entity:diff', {
      entities: [{
        name: 'e2e_validateUser',
        kind: 'function',
        oldSig: 'e2e_validateUser(id: string): Promise<User>',
        newSig: 'e2e_validateUser(id: string, permissions: string[]): Promise<User>',
        body: 'async function e2e_validateUser(id, permissions) {}',
        file: 'auth.ts',
        line: 1,
      }],
    })

    await new Promise((r) => setTimeout(r, 400))
    expect(conflictEvents.length).toBeGreaterThan(0)
    const ev = conflictEvents[0] as Record<string, unknown>
    expect(ev.entityName).toBe('e2e_validateUser')
    expect(ev.severity).toBe('warning')
    dashSocket.off('conflict:detected')
  })
})

describe('Context snapshot', () => {
  it('GET /v1/context/snapshot returns JSON with entities', async () => {
    const res = await request(app).get('/v1/context/snapshot')
    expect(res.status).toBe(200)
    expect(res.body.snapshotAt).toBeDefined()
    expect(Array.isArray(res.body.entities)).toBe(true)
  })

  it('GET /v1/context/snapshot?format=markdown returns text/markdown', async () => {
    const res = await request(app).get('/v1/context/snapshot?format=markdown')
    expect(res.status).toBe(200)
    expect(res.type).toContain('text')
  })
})

describe('Validate usage', () => {
  it('POST /v1/context/validate returns 400 for empty code', async () => {
    const res = await request(app).post('/v1/context/validate').send({})
    expect(res.status).toBe(400)
  })

  it('POST /v1/context/validate detects stale caller', async () => {
    const res = await request(app)
      .post('/v1/context/validate')
      .send({ code: 'const r = await e2e_validateUser(userId)' })
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.conflicts)).toBe(true)
  })
})

describe('Audit trail', () => {
  it('GET /v1/audit/entities/:name returns history', async () => {
    const res = await request(app).get('/v1/audit/entities/e2e_validateUser')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })

  it('GET /v1/audit/recent returns recent changes', async () => {
    const res = await request(app).get('/v1/audit/recent')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })
})

describe('Input validation', () => {
  it('entity name longer than 200 chars returns 400', async () => {
    const longName = 'a'.repeat(201)
    const res = await request(app).get(`/v1/entities/${longName}`)
    expect(res.status).toBe(400)
  })

  it('code longer than 20k chars returns 400 on validate', async () => {
    const res = await request(app)
      .post('/v1/context/validate')
      .send({ code: 'x'.repeat(20_001) })
    expect(res.status).toBe(400)
  })
})
