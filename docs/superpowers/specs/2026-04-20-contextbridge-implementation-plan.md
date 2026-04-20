# ContextBridge — 10-Day Implementation Plan
_Date: 2026-04-20 | Ref: 2026-04-20-contextbridge-design.md_

---

## Overview

Monorepo. Five packages. One `npm run demo:start` command. TypeScript throughout, strict mode. Architecture mirrors the LMS project: `services/{feature}/controller+service+routes+validations` pattern, Pino logging, Zod validation, ApiError + global error handler, dotenv direct env access.

**Test strategy:** Jest + ts-jest. All tests are automated — `npm test` per package. No manual verification steps. Tests run at the end of each day before moving forward.

---

## Monorepo Structure

```
ContextBridge/
├── packages/
│   ├── server/
│   │   ├── src/
│   │   │   ├── index.ts                    # startServer() entry
│   │   │   ├── app.ts                      # Express app, middleware chain
│   │   │   ├── socket.ts                   # Socket.IO server setup
│   │   │   ├── config/
│   │   │   │   ├── redis.ts
│   │   │   │   ├── postgres.ts
│   │   │   │   └── env.ts
│   │   │   ├── routes/
│   │   │   │   └── router.ts               # aggregates all routes under /v1
│   │   │   ├── services/
│   │   │   │   ├── entity/
│   │   │   │   │   ├── entity.controller.ts
│   │   │   │   │   ├── entity.service.ts
│   │   │   │   │   ├── entity.routes.ts
│   │   │   │   │   └── utils/validations.ts
│   │   │   │   ├── conflict/
│   │   │   │   │   ├── conflict.service.ts
│   │   │   │   │   └── conflict.detector.ts
│   │   │   │   ├── context/
│   │   │   │   │   ├── context.controller.ts
│   │   │   │   │   ├── context.service.ts
│   │   │   │   │   └── context.routes.ts
│   │   │   │   └── graph/
│   │   │   │       └── graph.service.ts
│   │   │   ├── middlewares/
│   │   │   │   ├── errorHandler.ts
│   │   │   │   └── validateRequest.ts
│   │   │   ├── logger/
│   │   │   │   └── logger.ts
│   │   │   └── types/
│   │   │       └── index.ts
│   │   ├── __tests__/
│   │   │   ├── unit/
│   │   │   └── integration/
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   ├── client/
│   │   ├── src/
│   │   │   ├── index.ts                    # CLI entry: --dev --workspace args
│   │   │   ├── watcher.ts                  # chokidar
│   │   │   ├── parser.ts                   # tree-sitter incremental
│   │   │   ├── differ.ts                   # entity diff logic
│   │   │   ├── socket.ts                   # Socket.IO client
│   │   │   └── types.ts
│   │   ├── __tests__/
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   ├── agent/
│   │   ├── src/
│   │   │   ├── index.ts                    # CLI entry: --dev --task --mode args
│   │   │   ├── groq.ts                     # Groq API wrapper
│   │   │   ├── context.ts                  # fetches /context/snapshot
│   │   │   ├── validator.ts                # calls /validate-usage
│   │   │   ├── workspace.ts                # writes files
│   │   │   └── types.ts
│   │   ├── __tests__/
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   ├── dashboard/
│   │   ├── src/
│   │   │   ├── main.tsx
│   │   │   ├── App.tsx
│   │   │   ├── components/
│   │   │   │   ├── TopBar.tsx
│   │   │   │   ├── Graph.tsx               # D3 force graph
│   │   │   │   ├── DevPanel.tsx
│   │   │   │   ├── ConflictFeed.tsx
│   │   │   │   └── BottomBar.tsx
│   │   │   ├── hooks/
│   │   │   │   ├── useSocket.ts
│   │   │   │   └── useGraph.ts
│   │   │   └── types.ts
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   └── demo/
│       ├── src/
│       │   ├── seed.ts                     # creates workspace-devA/ workspace-devB/
│       │   └── start.ts                    # concurrently orchestrator
│       ├── workspace-devA/                 # seeded at runtime
│       ├── workspace-devB/                 # seeded at runtime
│       ├── tsconfig.json
│       └── package.json
│
├── .env.example
├── .gitignore
├── package.json                            # root — npm workspaces
└── docs/
    └── superpowers/specs/
```

---

## Environment Variables (`.env.example`)

```env
# Server
PORT=3000
NODE_ENV=development

# Redis
REDIS_URL=redis://localhost:6379

# PostgreSQL
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=contextbridge
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres

# Groq
GROQ_API_KEY=your_groq_api_key_here

# Dashboard
VITE_SERVER_URL=http://localhost:3000
```

---

## Day 1 — Monorepo + Base Server + DB Connections

**Goal:** Running Express server with Redis + Postgres connected, health endpoint, logging, error handling.

### Tasks

**Root `package.json`:**
```json
{
  "name": "contextbridge",
  "private": true,
  "workspaces": ["packages/*"],
  "scripts": {
    "dev": "concurrently -n server,client-a,client-b,dashboard ...",
    "test": "npm run test --workspaces --if-present"
  }
}
```

**`packages/server/src/config/env.ts`:**
Export typed env vars. Throw at startup if required vars missing:
```typescript
export const env = {
  port: Number(process.env.PORT) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  redisUrl: required('REDIS_URL'),
  postgres: {
    host: required('POSTGRES_HOST'),
    port: Number(process.env.POSTGRES_PORT) || 5432,
    database: required('POSTGRES_DB'),
    user: required('POSTGRES_USER'),
    password: required('POSTGRES_PASSWORD'),
  },
  groqApiKey: process.env.GROQ_API_KEY || '',
}

function required(key: string): string {
  const val = process.env[key]
  if (!val) throw new Error(`Missing required env var: ${key}`)
  return val
}
```

**`packages/server/src/config/redis.ts`:**
- ioredis client, export singleton
- Log connection status via module logger
- Export `redisClient`

**`packages/server/src/config/postgres.ts`:**
- `pg` Pool, export singleton
- Run `SELECT 1` on startup to verify connection
- Export `db`

**`packages/server/src/logger/logger.ts`:**
- Pino logger (same as LMS pattern)
- `createModuleLogger(module: string)` function returns child logger

**`packages/server/src/middlewares/errorHandler.ts`:**
```typescript
export class ApiError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message)
  }
}
export const notFound = (msg: string) => new ApiError(404, msg)
export const badRequest = (msg: string) => new ApiError(400, msg)
export const unauthorized = (msg: string) => new ApiError(401, msg)

export function globalErrorHandler(err, req, res, next) {
  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({ error: err.message })
  }
  if (err instanceof ZodError) {
    return res.status(400).json({ error: 'Validation failed', details: err.errors })
  }
  logger.error(err)
  res.status(500).json({ error: 'Internal server error' })
}
```

**`packages/server/src/app.ts`:**
- Express app setup
- Middleware: helmet, cors, json, cookie-parser
- Mount router at `/v1`
- Mount global error handler last

**`packages/server/src/index.ts`:**
```typescript
export async function startServer() {
  dotenv.config()
  await connectRedis()
  await connectPostgres()
  const httpServer = createServer(app)
  initSocket(httpServer)
  httpServer.listen(env.port, () => logger.info(`Server on :${env.port}`))
}
startServer()
```

**`packages/server/src/routes/router.ts`:**
```typescript
const router = Router()
router.get('/health', (req, res) => res.json({ status: 'ok', ts: Date.now() }))
router.use('/entity', entityRoutes)
router.use('/context', contextRoutes)
export default router
```

### Postgres Migration (run on startup)

```sql
CREATE TABLE IF NOT EXISTS entities (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  dev_id      TEXT NOT NULL,
  kind        TEXT NOT NULL,
  signature   TEXT NOT NULL,
  body        TEXT,
  file        TEXT NOT NULL,
  line        INT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS entity_changes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_name   TEXT NOT NULL,
  dev_id        TEXT NOT NULL,
  old_signature TEXT,
  new_signature TEXT NOT NULL,
  severity      TEXT NOT NULL,
  changed_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS conflicts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_name  TEXT NOT NULL,
  dev_a_id     TEXT NOT NULL,
  dev_b_id     TEXT,
  description  TEXT NOT NULL,
  severity     TEXT NOT NULL,
  impact_count INT DEFAULT 0,
  detected_at  TIMESTAMPTZ DEFAULT now(),
  resolved     BOOLEAN DEFAULT false
);
```

Run migration in `connectPostgres()` before server starts.

### Day 1 Tests

```
packages/server/__tests__/integration/health.test.ts
packages/server/__tests__/unit/env.test.ts
```

```typescript
// health.test.ts
describe('GET /v1/health', () => {
  it('returns 200 with status ok', async () => {
    const res = await request(app).get('/v1/health')
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('ok')
  })
})

// env.test.ts
describe('env config', () => {
  it('throws if REDIS_URL missing', () => {
    const old = process.env.REDIS_URL
    delete process.env.REDIS_URL
    expect(() => require('../config/env')).toThrow('Missing required env var: REDIS_URL')
    process.env.REDIS_URL = old
  })
})
```

**Run:** `cd packages/server && npm test`

---

## Day 2 — Tree-sitter Parser (client package)

**Goal:** Given a TypeScript file, extract all entities (functions, types, interfaces, classes) with their signatures and bodies. Support incremental parsing.

### Tasks

**`packages/client/package.json` deps:**
- `tree-sitter`, `tree-sitter-typescript`, `typescript`

**`packages/client/src/types.ts`:**
```typescript
export type EntityKind = 'function' | 'type' | 'interface' | 'class'

export interface Entity {
  name: string
  kind: EntityKind
  signature: string
  body: string
  file: string
  line: number
}

export interface EntityDiff {
  name: string
  kind: EntityKind
  oldSig: string | null
  newSig: string
  body: string
  file: string
  line: number
}
```

**`packages/client/src/parser.ts`:**

Core logic — incremental Tree-sitter parsing:

```typescript
import Parser from 'tree-sitter'
import TypeScript from 'tree-sitter-typescript'

export class TSParser {
  private parser: Parser
  private previousTrees: Map<string, Parser.Tree> = new Map()

  constructor() {
    this.parser = new Parser()
    this.parser.setLanguage(TypeScript.typescript)
  }

  parse(filePath: string, source: string): Entity[] {
    const prevTree = this.previousTrees.get(filePath)
    const tree = prevTree
      ? this.parser.parse(source, prevTree)   // incremental
      : this.parser.parse(source)
    this.previousTrees.set(filePath, tree)
    return this.extractEntities(tree.rootNode, source, filePath)
  }

  private extractEntities(root: Parser.SyntaxNode, source: string, file: string): Entity[] {
    const entities: Entity[] = []
    this.traverse(root, source, file, entities)
    return entities
  }

  private traverse(node: Parser.SyntaxNode, source: string, file: string, acc: Entity[]) {
    // Match: function_declaration, arrow_function (assigned), type_alias_declaration,
    // interface_declaration, class_declaration
    // Extract name, signature (params + return type), body text, start line
    // Recurse into children
    for (const child of node.children) {
      this.traverse(child, source, file, acc)
    }
  }
}
```

**`packages/client/src/differ.ts`:**
```typescript
export function diffEntities(prev: Entity[], next: Entity[]): EntityDiff[] {
  // Return diffs: new entities (oldSig=null) + changed entities (sig changed)
  // Ignore unchanged entities
}
```

### Day 2 Tests

```
packages/client/__tests__/parser.test.ts
packages/client/__tests__/differ.test.ts
```

```typescript
// parser.test.ts
const FIXTURE = `
export async function validateUser(id: string): Promise<User> {
  return db.users.find(id)
}

export type Permission = 'read' | 'write'

export interface AuthConfig {
  secret: string
  ttl: number
}
`

describe('TSParser', () => {
  const parser = new TSParser()

  it('extracts function entity', () => {
    const entities = parser.parse('auth.ts', FIXTURE)
    const fn = entities.find(e => e.name === 'validateUser')
    expect(fn).toBeDefined()
    expect(fn!.kind).toBe('function')
    expect(fn!.signature).toContain('id: string')
    expect(fn!.signature).toContain('Promise<User>')
  })

  it('extracts type entity', () => {
    const entities = parser.parse('auth.ts', FIXTURE)
    const t = entities.find(e => e.name === 'Permission')
    expect(t!.kind).toBe('type')
  })

  it('extracts interface entity', () => {
    const entities = parser.parse('auth.ts', FIXTURE)
    const i = entities.find(e => e.name === 'AuthConfig')
    expect(i!.kind).toBe('interface')
  })

  it('incremental parse detects signature change', () => {
    parser.parse('auth.ts', FIXTURE)
    const changed = FIXTURE.replace(
      'validateUser(id: string)',
      'validateUser(id: string, permissions: string[])'
    )
    const entities = parser.parse('auth.ts', changed)
    const fn = entities.find(e => e.name === 'validateUser')
    expect(fn!.signature).toContain('permissions: string[]')
  })
})

// differ.test.ts
describe('diffEntities', () => {
  it('returns empty diff for identical entities', () => {
    const entities = [{ name: 'foo', kind: 'function', signature: 'foo(): void', ... }]
    expect(diffEntities(entities, entities)).toHaveLength(0)
  })

  it('detects signature change', () => {
    const prev = [{ name: 'foo', signature: 'foo(a: string)' }]
    const next = [{ name: 'foo', signature: 'foo(a: string, b: number)' }]
    const diffs = diffEntities(prev, next)
    expect(diffs[0].oldSig).toBe('foo(a: string)')
    expect(diffs[0].newSig).toBe('foo(a: string, b: number)')
  })

  it('detects new entity (oldSig null)', () => {
    const diffs = diffEntities([], [{ name: 'bar', signature: 'bar(): void' }])
    expect(diffs[0].oldSig).toBeNull()
  })
})
```

**Run:** `cd packages/client && npm test`

---

## Day 3 — Client File Watcher + Socket.IO

**Goal:** Client watches a workspace directory, parses changed `.ts` files, diffs against previous parse, sends `entity:diff` events to server. Sends heartbeat every 10s.

### Tasks

**`packages/client/src/watcher.ts`:**
```typescript
import chokidar from 'chokidar'

export function createWatcher(workspacePath: string, onChange: (filePath: string) => void) {
  const watcher = chokidar.watch(`${workspacePath}/**/*.ts`, {
    ignoreInitial: false,    // parse existing files on startup
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 }
  })
  watcher.on('add', onChange)
  watcher.on('change', onChange)
  return watcher
}
```

**`packages/client/src/socket.ts`:**
```typescript
import { io, Socket } from 'socket.io-client'

export function createSocketClient(serverUrl: string, devId: string): Socket {
  const socket = io(serverUrl, { auth: { devId }, reconnection: true })
  socket.on('connect', () => logger.info(`[${devId}] connected to server`))
  socket.on('entity:updated', (data) => logger.info(`[PUSH] ${data.name} changed by ${data.devId}`))
  socket.on('conflict:detected', (data) => logger.warn(`[CONFLICT] ${data.entityName} — ${data.severity}`))
  socket.on('disconnect', () => logger.warn(`[${devId}] disconnected`))
  return socket
}

export function startHeartbeat(socket: Socket, devId: string) {
  setInterval(() => socket.emit('heartbeat', { devId }), 10_000)
}
```

**`packages/client/src/index.ts`:**
```typescript
// Parse CLI args: --dev=devA --workspace=./workspace-devA
// Init parser, watcher, socket
// On file change: read file → parser.parse() → differ.diff(prev, next) → socket.emit('entity:diff', diffs)
// Start heartbeat
```

### Day 3 Tests

```typescript
// watcher.test.ts — uses tmp dir, writes file, asserts onChange fires
describe('createWatcher', () => {
  it('fires onChange when ts file is created', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-'))
    const onChange = jest.fn()
    const watcher = createWatcher(dir, onChange)
    await new Promise(r => setTimeout(r, 200))
    fs.writeFileSync(path.join(dir, 'test.ts'), 'export function foo() {}')
    await new Promise(r => setTimeout(r, 300))
    expect(onChange).toHaveBeenCalled()
    watcher.close()
    fs.rmSync(dir, { recursive: true })
  })

  it('fires onChange when ts file is modified', async () => {
    // write file first, then modify, assert onChange called twice
  })
})

// index.test.ts — mock socket, assert entity:diff emitted on file change
describe('client integration', () => {
  it('emits entity:diff when file changes', async () => {
    const mockSocket = { emit: jest.fn(), on: jest.fn() }
    // inject mock socket, write ts file to tmp workspace
    // assert mockSocket.emit called with 'entity:diff'
    // assert payload contains correct entity name + newSig
  })
})
```

**Run:** `cd packages/client && npm test`

---

## Day 4 — Server Socket.IO + Redis Entity Registry

**Goal:** Server handles `entity:diff` and `heartbeat` events. Writes entity state to Redis. Maintains dependency graph and client reverse index.

### Tasks

**`packages/server/src/socket.ts`:**
```typescript
export function initSocket(httpServer: HttpServer) {
  const io = new Server(httpServer, { cors: { origin: '*' } })

  io.on('connection', (socket) => {
    const { devId } = socket.handshake.auth
    if (!devId) return socket.disconnect()

    socket.join(`room:${devId}`)
    io.emit('client:connected', { devId })
    logger.info(`[socket] ${devId} connected`)

    socket.on('entity:diff', async (data) => {
      try {
        await entityService.handleDiff(devId, data.entities)
      } catch (err) {
        logger.error(err)
      }
    })

    socket.on('heartbeat', async ({ devId }) => {
      await redisClient.set(`client:${devId}:heartbeat`, '1', 'EX', 30)
    })

    socket.on('disconnect', () => {
      io.emit('client:disconnected', { devId })
    })
  })

  // Redis keyspace notifications for TTL expiry cleanup
  subscribeToKeyExpiry(io)
}
```

**`packages/server/src/services/entity/entity.service.ts`:**
```typescript
export async function handleDiff(devId: string, entities: EntityDiffPayload[]) {
  for (const entity of entities) {
    // 1. Write to Redis HSET entity:{name} { signature, body, devId, file, line, kind, updatedAt }
    await redisClient.hSet(`entity:${entity.name}`, {
      signature: entity.newSig,
      body:      entity.body,
      devId,
      file:      entity.file,
      line:      String(entity.line),
      kind:      entity.kind,
      updatedAt: new Date().toISOString(),
    })

    // 2. Set lock:{name} TTL=15s
    await redisClient.set(`lock:${entity.name}`, devId, 'EX', 15)

    // 3. Add to client:{devId}:entities set
    await redisClient.sAdd(`client:${devId}:entities`, entity.name)

    // 4. Async-write to Postgres entity_changes
    writeEntityChangeAsync(devId, entity)
  }
}
```

**`packages/server/src/services/graph/graph.service.ts`:**
```typescript
// updateDependents(entityName, calledEntities): updates entity:{name}:dependents and entity:{name}:clients
// getDependents(entityName): returns Set of entity names that depend on this entity  
// getImpactCount(entityName): returns number of dependents transitively
// updateClientIndex(devId, calledEntityNames): updates entity:{name}:clients for push routing
```

**TTL Expiry Cleanup:**
```typescript
function subscribeToKeyExpiry(io: Server) {
  // Subscribe to __keyevent@0__:expired
  const subscriber = redisClient.duplicate()
  subscriber.subscribe('__keyevent@0__:expired', async (key) => {
    if (!key.startsWith('client:') || !key.endsWith(':heartbeat')) return
    const devId = key.split(':')[1]
    const entityNames = await redisClient.sMembers(`client:${devId}:entities`)
    for (const name of entityNames) {
      const owner = await redisClient.hGet(`entity:${name}`, 'devId')
      if (owner === devId) await redisClient.del(`entity:${name}`)
      await redisClient.sRem(`entity:${name}:clients`, devId)
    }
    await redisClient.del(`client:${devId}:entities`)
    io.emit('client:disconnected', { devId })
    logger.info(`[cleanup] ${devId} expired — ${entityNames.length} entities cleared`)
  })
}
```

### Day 4 Tests

```typescript
// entity.service.test.ts
describe('handleDiff', () => {
  beforeEach(async () => { await redisClient.flushDb() })

  it('writes entity state to Redis on diff', async () => {
    await handleDiff('devA', [{
      name: 'validateUser', kind: 'function',
      oldSig: null, newSig: 'validateUser(id: string): Promise<User>',
      body: 'async function validateUser...', file: 'auth.ts', line: 1
    }])
    const state = await redisClient.hGetAll('entity:validateUser')
    expect(state.devId).toBe('devA')
    expect(state.signature).toContain('validateUser')
  })

  it('sets lock key with 15s TTL', async () => {
    await handleDiff('devA', [{ name: 'foo', ... }])
    const ttl = await redisClient.ttl('lock:foo')
    expect(ttl).toBeGreaterThan(0)
    expect(ttl).toBeLessThanOrEqual(15)
  })

  it('adds entity to client entities set', async () => {
    await handleDiff('devA', [{ name: 'bar', ... }])
    const members = await redisClient.sMembers('client:devA:entities')
    expect(members).toContain('bar')
  })
})

// heartbeat.test.ts
describe('heartbeat', () => {
  it('sets client heartbeat key with 30s TTL', async () => {
    await redisClient.set('client:devA:heartbeat', '1', 'EX', 30)
    const ttl = await redisClient.ttl('client:devA:heartbeat')
    expect(ttl).toBeGreaterThan(25)
  })
})
```

**Run:** `cd packages/server && npm test`

---

## Day 5 — Conflict Detection + Push Notifications

**Goal:** When an entity is modified, detect if another dev owns it or has stale callers. Classify severity. Push notifications to affected clients and dashboard.

### Tasks

**`packages/server/src/services/conflict/conflict.detector.ts`:**

```typescript
export type Severity = 'critical' | 'warning' | 'info'

export function classifySeverity(oldSig: string | null, newSig: string): Severity {
  if (!oldSig) return 'info'  // new entity, no conflict possible

  const oldParams = extractParams(oldSig)
  const newParams = extractParams(newSig)

  // Critical: param removed, or required param type changed
  const removedParams = oldParams.filter(p => !newParams.find(n => n.name === p.name))
  if (removedParams.length > 0) return 'critical'

  // Critical: return type changed
  if (extractReturnType(oldSig) !== extractReturnType(newSig)) return 'critical'

  // Warning: new required param added (no default, not optional)
  const addedRequired = newParams.filter(
    p => !oldParams.find(o => o.name === p.name) && !p.optional
  )
  if (addedRequired.length > 0) return 'warning'

  // Info: new optional param added
  return 'info'
}
```

**`packages/server/src/services/conflict/conflict.service.ts`:**

```typescript
export async function detectAndBroadcast(
  devId: string,
  entity: EntityDiffPayload,
  io: Server
) {
  const existing = await redisClient.hGetAll(`entity:${entity.name}`)

  // Check if another dev owns this entity
  const isConflict = existing.devId && existing.devId !== devId

  const severity = classifySeverity(entity.oldSig, entity.newSig)

  // Get impact count from dep graph
  const dependents = await redisClient.sMembers(`entity:${entity.name}:dependents`)
  const impactCount = dependents.length

  if (isConflict) {
    const conflictPayload = {
      entityName:  entity.name,
      severity,
      devAId:      existing.devId,
      devBId:      devId,
      oldSig:      existing.signature,
      newSig:      entity.newSig,
      impactCount,
    }

    // Broadcast to dashboard room
    io.to('room:dashboard').emit('conflict:detected', conflictPayload)

    // Push to affected clients (those whose files call this entity)
    const affectedClients = await redisClient.sMembers(`entity:${entity.name}:clients`)
    for (const clientDevId of affectedClients) {
      io.to(`room:${clientDevId}`).emit('entity:updated', {
        name:    entity.name,
        devId,
        signature: entity.newSig,
        severity,
        locked:  true,
      })
    }

    // Async-write to Postgres
    writeConflictAsync(conflictPayload)
  }

  // Always broadcast entity update to dashboard
  io.to('room:dashboard').emit('entity:updated', {
    name:      entity.name,
    devId,
    signature: entity.newSig,
    locked:    true,
    severity,
  })
}
```

Integrate `detectAndBroadcast` into `entity.service.handleDiff` — called after each entity write.

### Day 5 Tests

```typescript
// conflict.detector.test.ts
describe('classifySeverity', () => {
  it('returns critical when param removed', () => {
    expect(classifySeverity('fn(id: string, role: string)', 'fn(id: string)')).toBe('critical')
  })

  it('returns warning when required param added', () => {
    expect(classifySeverity('fn(id: string)', 'fn(id: string, permissions: string[])')).toBe('warning')
  })

  it('returns info when optional param added', () => {
    expect(classifySeverity('fn(id: string)', 'fn(id: string, ttl?: number)')).toBe('info')
  })

  it('returns critical when return type changes', () => {
    expect(classifySeverity('fn(): User', 'fn(): UserV2')).toBe('critical')
  })
})

// conflict.service.test.ts
describe('detectAndBroadcast', () => {
  it('emits conflict:detected when two devs modify same entity', async () => {
    await redisClient.hSet('entity:validateUser', { devId: 'devA', signature: 'validateUser(id: string)' })
    const mockIo = { to: jest.fn().mockReturnThis(), emit: jest.fn() }

    await detectAndBroadcast('devB', {
      name: 'validateUser', oldSig: 'validateUser(id: string)',
      newSig: 'validateUser(id: string, permissions: string[])', ...
    }, mockIo as any)

    const emitted = mockIo.emit.mock.calls.find(c => c[0] === 'conflict:detected')
    expect(emitted).toBeDefined()
    expect(emitted[1].severity).toBe('warning')
    expect(emitted[1].devAId).toBe('devA')
    expect(emitted[1].devBId).toBe('devB')
  })

  it('pushes entity:updated to affected clients', async () => {
    await redisClient.sAdd('entity:validateUser:clients', 'devB')
    // assert io.to('room:devB').emit('entity:updated') was called
  })
})
```

**Run:** `cd packages/server && npm test`

---

## Day 6 — REST API

**Goal:** Three endpoints — live entity state, usage validation, context snapshot. All validated with Zod. All return typed responses.

### Tasks

**`packages/server/src/services/entity/utils/validations.ts`:**
```typescript
export const validateUsageSchema = z.object({
  body: z.object({ code: z.string().min(1).max(10_000) })
})

export const entityNameSchema = z.object({
  params: z.object({ name: z.string().min(1).max(200) })
})

export const contextQuerySchema = z.object({
  query: z.object({
    format: z.enum(['json', 'markdown']).default('json'),
    entity: z.string().optional(),
    depth:  z.coerce.number().min(1).max(5).default(2),
  })
})
```

**`packages/server/src/middlewares/validateRequest.ts`:**
Same pattern as LMS — `validateRequest(schema)` middleware, validates `body/params/query` against Zod schema.

**`GET /v1/entity/:name/live-state` — `entity.controller.ts`:**
```typescript
export async function getLiveState(req, res, next) {
  try {
    const { name } = req.params
    const state = await redisClient.hGetAll(`entity:${name}`)
    if (!Object.keys(state).length) throw notFound(`Entity '${name}' not found`)

    const locked = !!(await redisClient.exists(`lock:${name}`))
    const dependents = await redisClient.sMembers(`entity:${name}:dependents`)

    res.json({
      name, ...state,
      locked,
      hasPendingConflict: locked && state.devId !== undefined,
      impactCount: dependents.length,
    })
  } catch (err) { next(err) }
}
```

**`POST /v1/entity/validate-usage` — `entity.controller.ts`:**
```typescript
export async function validateUsage(req, res, next) {
  try {
    const { code } = req.body
    // Use TSParser to extract all entity references from the snippet
    const references = parser.extractReferences(code)
    const conflicts = []

    for (const ref of references) {
      const state = await redisClient.hGetAll(`entity:${ref.name}`)
      if (!state.signature) continue
      if (ref.callSignature !== state.signature) {
        conflicts.push({
          entity:         ref.name,
          yourSignature:  ref.callSignature,
          liveSignature:  state.signature,
          severity:       classifySeverity(ref.callSignature, state.signature),
          devId:          state.devId,
          correctedCall:  buildCorrectedCall(ref.name, state.signature, ref.args),
        })
      }
    }

    res.json({ conflicts })
  } catch (err) { next(err) }
}
```

**`GET /v1/context/snapshot` — `context.controller.ts`:**
```typescript
export async function getSnapshot(req, res, next) {
  try {
    const { format, entity, depth } = req.query

    // Get all entity keys from Redis
    const keys = await redisClient.keys('entity:*:dependents')  // use scan in production
    // For each entity, HGETALL state
    // If entity + depth provided, do BFS subgraph traversal
    // Build response

    if (format === 'markdown') {
      return res.type('text/markdown').send(buildMarkdownContext(snapshot))
    }

    res.json(snapshot)
  } catch (err) { next(err) }
}
```

**`packages/server/src/services/context/context.service.ts`:**
- `buildSnapshot(entityFilter?, depth?)` — assembles full or focused snapshot from Redis
- `buildMarkdownContext(snapshot)` — formats snapshot as LLM-ready markdown
- `bfsSubgraph(startEntity, depth, graph)` — BFS traversal for focused context

### Day 6 Tests

```typescript
// entity.routes.test.ts (supertest)
describe('GET /v1/entity/:name/live-state', () => {
  it('returns 404 for unknown entity', async () => {
    const res = await request(app).get('/v1/entity/unknown/live-state')
    expect(res.status).toBe(404)
  })

  it('returns entity state for known entity', async () => {
    await redisClient.hSet('entity:validateUser', {
      signature: 'validateUser(id: string)', devId: 'devA',
      kind: 'function', file: 'auth.ts', line: '1', updatedAt: new Date().toISOString()
    })
    const res = await request(app).get('/v1/entity/validateUser/live-state')
    expect(res.status).toBe(200)
    expect(res.body.name).toBe('validateUser')
    expect(res.body.locked).toBe(false)
  })
})

describe('POST /v1/entity/validate-usage', () => {
  it('returns 400 for missing code field', async () => {
    const res = await request(app).post('/v1/entity/validate-usage').send({})
    expect(res.status).toBe(400)
  })

  it('detects stale caller and returns correctedCall', async () => {
    await redisClient.hSet('entity:validateUser', {
      signature: 'validateUser(id: string, permissions: string[])', devId: 'devA', ...
    })
    const res = await request(app)
      .post('/v1/entity/validate-usage')
      .send({ code: 'const r = await validateUser(userId)' })
    expect(res.status).toBe(200)
    expect(res.body.conflicts).toHaveLength(1)
    expect(res.body.conflicts[0].correctedCall).toBeDefined()
    expect(res.body.conflicts[0].severity).toBe('warning')
  })

  it('returns empty conflicts for valid usage', async () => {
    await redisClient.hSet('entity:validateUser', {
      signature: 'validateUser(id: string)', devId: 'devA', ...
    })
    const res = await request(app)
      .post('/v1/entity/validate-usage')
      .send({ code: 'const r = await validateUser(userId)' })
    expect(res.body.conflicts).toHaveLength(0)
  })
})

describe('GET /v1/context/snapshot', () => {
  it('returns json snapshot by default', async () => {
    const res = await request(app).get('/v1/context/snapshot')
    expect(res.status).toBe(200)
    expect(res.body.entities).toBeDefined()
    expect(res.body.snapshotAt).toBeDefined()
  })

  it('returns markdown when format=markdown', async () => {
    const res = await request(app).get('/v1/context/snapshot?format=markdown')
    expect(res.status).toBe(200)
    expect(res.type).toContain('text')
    expect(res.text).toContain('# ContextBridge Snapshot')
  })

  it('returns focused subgraph when entity param given', async () => {
    const res = await request(app).get('/v1/context/snapshot?entity=validateUser&depth=1')
    expect(res.status).toBe(200)
    // All returned entities should be within 1 hop of validateUser
  })
})
```

**Run:** `cd packages/server && npm test`

---

## Day 7 — Postgres Audit Layer

**Goal:** All entity changes and conflicts are async-written to Postgres. Entity change history endpoint added.

### Tasks

**`packages/server/src/services/entity/entity.service.ts` — async Postgres writes:**

```typescript
async function writeEntityChangeAsync(devId: string, entity: EntityDiffPayload) {
  // Fire and forget — don't await in hot path
  db.query(
    `INSERT INTO entity_changes (entity_name, dev_id, old_signature, new_signature, severity)
     VALUES ($1, $2, $3, $4, $5)`,
    [entity.name, devId, entity.oldSig, entity.newSig, classifySeverity(entity.oldSig, entity.newSig)]
  ).catch(err => logger.error({ err }, 'Failed to write entity_change'))
}

async function writeConflictAsync(conflict: ConflictPayload) {
  db.query(
    `INSERT INTO conflicts (entity_name, dev_a_id, dev_b_id, description, severity, impact_count)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [conflict.entityName, conflict.devAId, conflict.devBId,
     `${conflict.devAId} changed ${conflict.entityName}, ${conflict.devBId} has stale callers`,
     conflict.severity, conflict.impactCount]
  ).catch(err => logger.error({ err }, 'Failed to write conflict'))
}
```

**`GET /v1/entity/:name/history`:**
```typescript
export async function getEntityHistory(req, res, next) {
  try {
    const { name } = req.params
    const { rows } = await db.query(
      `SELECT * FROM entity_changes WHERE entity_name = $1 ORDER BY changed_at DESC LIMIT 20`,
      [name]
    )
    res.json({ entity: name, history: rows })
  } catch (err) { next(err) }
}
```

**`GET /v1/conflicts`:**
```typescript
export async function getConflicts(req, res, next) {
  try {
    const { rows } = await db.query(
      `SELECT * FROM conflicts ORDER BY detected_at DESC LIMIT 50`
    )
    res.json({ conflicts: rows })
  } catch (err) { next(err) }
}
```

### Day 7 Tests

```typescript
// postgres.test.ts — integration tests against real Postgres (test DB)
describe('Postgres audit layer', () => {
  beforeEach(async () => {
    await db.query('DELETE FROM entity_changes')
    await db.query('DELETE FROM conflicts')
  })

  it('writes entity_change row on handleDiff', async () => {
    await handleDiff('devA', [{ name: 'validateUser', oldSig: null, newSig: 'validateUser(id: string)', ... }])
    await new Promise(r => setTimeout(r, 100))  // let async write complete
    const { rows } = await db.query('SELECT * FROM entity_changes WHERE entity_name = $1', ['validateUser'])
    expect(rows).toHaveLength(1)
    expect(rows[0].dev_id).toBe('devA')
    expect(rows[0].severity).toBe('info')
  })

  it('writes conflict row when conflict detected', async () => {
    await redisClient.hSet('entity:validateUser', { devId: 'devA', signature: 'validateUser(id: string)' })
    await detectAndBroadcast('devB', { name: 'validateUser', newSig: 'validateUser(id: string, p: string[])', ... }, mockIo)
    await new Promise(r => setTimeout(r, 100))
    const { rows } = await db.query('SELECT * FROM conflicts WHERE entity_name = $1', ['validateUser'])
    expect(rows).toHaveLength(1)
    expect(rows[0].severity).toBe('warning')
  })
})

// history.route.test.ts
describe('GET /v1/entity/:name/history', () => {
  it('returns last 20 changes for entity', async () => {
    await db.query(
      `INSERT INTO entity_changes (entity_name, dev_id, old_signature, new_signature, severity)
       VALUES ('validateUser', 'devA', null, 'validateUser(id: string)', 'info')`
    )
    const res = await request(app).get('/v1/entity/validateUser/history')
    expect(res.status).toBe(200)
    expect(res.body.history).toHaveLength(1)
    expect(res.body.history[0].dev_id).toBe('devA')
  })
})
```

**Run:** `cd packages/server && npm test`

---

## Day 8 — Dashboard (React + Vite + D3)

**Goal:** Full working dashboard. Real-time graph, conflict feed, developer status, mode toggle. Connected to server via Socket.IO.

### Tasks

**Setup:** `packages/dashboard` — Vite + React 18 + TypeScript + D3 v7 + socket.io-client

**`useSocket.ts`:**
```typescript
export function useSocket(serverUrl: string) {
  const [socket, setSocket] = useState<Socket | null>(null)
  useEffect(() => {
    const s = io(serverUrl)
    s.emit('join', { room: 'dashboard' })  // joins room:dashboard
    setSocket(s)
    return () => { s.disconnect() }
  }, [serverUrl])
  return socket
}
```

**`useGraph.ts`:**
```typescript
// Manages nodes + links state
// On entity:updated → upsert node
// On conflict:detected → mark edge as conflict=true
// Returns { nodes, links }
```

**Component responsibilities:**

| Component | What it renders |
|-----------|-----------------|
| `TopBar` | Logo + live chip, mode toggle (emits mode change), entity/dep/conflict/dev counts |
| `DevPanel` | Developer cards (devId, file, status, heartbeat), entity list with badges |
| `Graph` | D3 force graph — nodes (glowing circles, size=deps), edges (animated red dashes for conflicts), draggable, hover tooltip |
| `ConflictFeed` | Scrolling conflict list — severity badge, timestamp, entity, sig diff, affected devs, impact pill |
| `BottomBar` | Redis/Postgres status, WS client count, parse latency, version |

**Graph implementation notes:**
- D3 simulation inside `useEffect`, cleaned up on unmount
- Node color: `#00e87a` clean, `#ff9f0a` active, `#ff2d55` conflict
- Conflict edges: `stroke-dasharray: 5 3`, animated `stroke-dashoffset`
- Glow via SVG `feGaussianBlur` filter
- Node size = `r = 10 + dependentsCount * 2` (capped at 30)

**No automated tests for dashboard** — visual components require browser. Manual verification: open dashboard, run demo, confirm graph updates and conflicts appear.

---

## Day 9 — Agent Package + Demo Orchestration

**Goal:** Groq-powered AI agents that write TypeScript to a workspace. Demo orchestration with seed script and one-command startup.

### Tasks

**`packages/agent/src/groq.ts`:**
```typescript
import Groq from 'groq-sdk'
const client = new Groq({ apiKey: process.env.GROQ_API_KEY })

export async function generateCode(systemPrompt: string, task: string): Promise<string> {
  const completion = await client.chat.completions.create({
    model: 'llama-3.1-8b-instant',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: task }
    ],
    temperature: 0.1,   // low temp for deterministic code generation
  })
  return completion.choices[0].message.content ?? ''
}
```

**`packages/agent/src/context.ts`:**
```typescript
export async function fetchContext(serverUrl: string): Promise<string> {
  const res = await fetch(`${serverUrl}/v1/context/snapshot?format=markdown`)
  return res.text()
}

export async function validateUsage(serverUrl: string, code: string) {
  const res = await fetch(`${serverUrl}/v1/entity/validate-usage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code })
  })
  return res.json()
}
```

**`packages/agent/src/index.ts`:**
```typescript
// Parse: --dev, --task, --mode (smart|dumb, default: smart from env or arg)
// SMART mode:
//   1. fetch /context/snapshot?format=markdown
//   2. Build system prompt: "You are a TypeScript dev. Here is the live codebase:\n{context}\nAlways use the signatures above."
//   3. Call Groq with system prompt + task
//   4. Extract code block from response
//   5. Call POST /validate-usage with generated code
//   6. If conflicts: re-prompt Groq with correctedCall hints, regenerate
//   7. Write final code to workspace file
//
// DUMB mode:
//   1. Call Groq with minimal system prompt (no context)
//   2. Write generated code to workspace file (no validation)
```

**`packages/demo/src/seed.ts`:**
```typescript
// Creates workspace-devA/ and workspace-devB/ with identical baseline:
// auth.ts:
//   export async function validateUser(id: string): Promise<User> { ... }
//   export type Permission = 'read' | 'write'
//   export interface AuthConfig { secret: string; ttl: number }
//
// user.service.ts:
//   export class UserService { ... }
//   export async function getUser(id: string): Promise<User> { ... }
```

**Root `package.json` demo scripts:**
```json
{
  "scripts": {
    "demo:seed":  "ts-node packages/demo/src/seed.ts",
    "demo:start": "npm run demo:seed && concurrently -n server,client-a,client-b,dashboard \"npm run dev -w packages/server\" \"npm run dev -w packages/client -- --dev=devA --workspace=./packages/demo/workspace-devA\" \"npm run dev -w packages/client -- --dev=devB --workspace=./packages/demo/workspace-devB\" \"npm run dev -w packages/dashboard\"",
    "agent": "ts-node packages/agent/src/index.ts"
  }
}
```

**Demo terminal commands:**
```bash
# Terminal 1 — Dev A refactors
npm run agent -- --dev=devA --task="Refactor validateUser in auth.ts to accept a second parameter: permissions as string array. Update the function signature and body."

# Terminal 2 — Dev B adds callers (run ~3s later)
npm run agent -- --dev=devB --task="Add 3 new service functions in user.service.ts that each call validateUser with a userId string."

# Terminal 3 — See what any agent sees
curl http://localhost:3000/v1/context/snapshot?format=markdown
```

### Day 9 Tests

```typescript
// groq.test.ts — mock Groq client
describe('generateCode', () => {
  it('calls Groq with system prompt + task and returns content', async () => {
    const mockCreate = jest.fn().mockResolvedValue({
      choices: [{ message: { content: '```typescript\nconst x = 1\n```' } }]
    })
    // inject mock, assert called with correct model
    const result = await generateCode('system', 'task')
    expect(result).toContain('const x = 1')
  })
})

// agent.integration.test.ts — mock server endpoints
describe('agent SMART mode', () => {
  it('calls /context/snapshot before generating', async () => {
    const snapshotSpy = jest.spyOn(global, 'fetch')
    await runAgent({ dev: 'devB', task: 'add caller', mode: 'smart', serverUrl: mockServerUrl })
    expect(snapshotSpy).toHaveBeenCalledWith(expect.stringContaining('/context/snapshot'))
  })

  it('calls /validate-usage after generating', async () => {
    // mock Groq response, mock /validate-usage returning no conflicts
    // assert file is written to workspace
  })

  it('re-prompts with correctedCall when conflict found', async () => {
    // mock /validate-usage returning conflict with correctedCall
    // assert Groq called twice (first gen + re-gen)
  })
})

describe('agent DUMB mode', () => {
  it('skips /context/snapshot and /validate-usage', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch')
    await runAgent({ dev: 'devB', task: 'add caller', mode: 'dumb', serverUrl: mockServerUrl })
    expect(fetchSpy).not.toHaveBeenCalledWith(expect.stringContaining('/context/snapshot'))
  })
})
```

**Run:** `cd packages/agent && npm test`

---

## Day 10 — Integration, Hardening, Final E2E

**Goal:** Full end-to-end automated test. Security audit. Rate limiting. Clean error handling everywhere. README. All tests pass.

### Tasks

**Full E2E test (`__tests__/e2e/demo.test.ts` in root):**

```typescript
describe('ContextBridge E2E', () => {
  let server, clientA, clientB

  beforeAll(async () => {
    await seedWorkspaces()
    server  = await startServer()
    clientA = await startClient({ dev: 'devA', workspace: './workspace-devA' })
    clientB = await startClient({ dev: 'devB', workspace: './workspace-devB' })
    await waitForClientsConnected(2)
  })

  afterAll(async () => {
    await server.close()
    clientA.kill(); clientB.kill()
    await cleanWorkspaces()
  })

  it('client connects and registers with server', async () => {
    const connectedDevs = await getConnectedDevs()
    expect(connectedDevs).toContain('devA')
    expect(connectedDevs).toContain('devB')
  })

  it('file change in workspace-devA propagates to Redis', async () => {
    writeFileSync('./workspace-devA/auth.ts', MODIFIED_AUTH_TS)
    await waitFor(async () => {
      const state = await redisClient.hGetAll('entity:validateUser')
      return state.devId === 'devA'
    }, 3000)
    const state = await redisClient.hGetAll('entity:validateUser')
    expect(state.signature).toContain('permissions: string[]')
  })

  it('DUMB mode agent triggers conflict', async () => {
    const conflictEvents: any[] = []
    const dashSocket = connectAsDashboard(onConflict => conflictEvents.push(onConflict))

    await runAgent({ dev: 'devB', task: CALLER_TASK, mode: 'dumb' })
    await waitFor(() => conflictEvents.length > 0, 5000)

    expect(conflictEvents[0].entityName).toBe('validateUser')
    expect(conflictEvents[0].severity).toBe('warning')
    dashSocket.disconnect()
  })

  it('SMART mode agent resolves conflict — no conflict event fires', async () => {
    const conflictEvents: any[] = []
    const dashSocket = connectAsDashboard(onConflict => conflictEvents.push(onConflict))

    await runAgent({ dev: 'devB', task: CALLER_TASK, mode: 'smart' })
    await new Promise(r => setTimeout(r, 2000))

    expect(conflictEvents).toHaveLength(0)
    dashSocket.disconnect()
  })

  it('conflict is written to Postgres', async () => {
    const { rows } = await db.query('SELECT * FROM conflicts WHERE entity_name = $1', ['validateUser'])
    expect(rows.length).toBeGreaterThan(0)
  })

  it('GET /context/snapshot returns markdown with live entity state', async () => {
    const res = await request(app).get('/v1/context/snapshot?format=markdown')
    expect(res.text).toContain('validateUser')
    expect(res.text).toContain('permissions: string[]')
    expect(res.text).toContain('devA')
  })
})
```

**Security hardening:**

```typescript
// app.ts additions:
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'

app.use(helmet())

// Rate limit REST API: 100 req/min per IP
const apiLimiter = rateLimit({
  windowMs: 60_000,
  max: 100,
  message: { error: 'Too many requests' }
})
app.use('/v1', apiLimiter)

// Stricter limit on validate-usage (parses code server-side)
const parseLimiter = rateLimit({ windowMs: 60_000, max: 20 })
app.use('/v1/entity/validate-usage', parseLimiter)
```

**Input sanitization audit:**
- All route params validated with Zod `entityNameSchema` (max 200 chars, no special chars)
- `code` field in validate-usage: max 10,000 chars, string-only
- No `eval`, no dynamic `require`, no shell execution anywhere

**Error handling audit:**
- All Socket.IO event handlers wrapped in `try/catch` with `logger.error`
- All async Postgres writes use `.catch(err => logger.error(err))`
- No unhandled promise rejections — global `process.on('unhandledRejection')` handler in `index.ts`

**`process.on` handlers in `index.ts`:**
```typescript
process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled rejection')
})
process.on('uncaughtException', (err) => {
  logger.error({ err }, 'Uncaught exception')
  process.exit(1)
})
```

**Final test run:**
```bash
npm test --workspaces --if-present
# Expected: server (unit + integration), client (unit), agent (unit + integration) all pass
# E2E: run separately with npm run test:e2e
```

---

## Test Summary by Day

| Day | Package      | Tests |
|-----|-------------|-------|
| 1   | server       | Health endpoint 200, env var validation, Redis ping, Postgres connect |
| 2   | client       | Parser extracts function/type/interface, incremental parse detects sig change, differ detects new/changed entities |
| 3   | client       | Watcher fires on file create/modify, entity:diff emitted with correct payload |
| 4   | server       | handleDiff writes Redis, lock TTL set, client entity set updated, heartbeat refreshes TTL |
| 5   | server       | Severity classification (critical/warning/info), conflict:detected emitted on dual-dev edit, push to affected clients |
| 6   | server       | 404 for unknown entity, entity state response shape, validate-usage detects stale call + returns correctedCall, context snapshot json + markdown + focused |
| 7   | server       | Postgres entity_change row written after diff, conflict row written after conflict, history endpoint returns rows |
| 8   | dashboard    | No automated tests — visual component |
| 9   | agent        | Groq called with correct model, SMART mode calls snapshot + validate-usage, DUMB mode skips both, re-prompts on conflict |
| 10  | root (E2E)   | File change propagates to Redis, DUMB agent triggers conflict in Postgres + dashboard, SMART agent resolves conflict, markdown snapshot contains live state |

---

## Daily Run Commands

```bash
# Run all tests
npm test --workspaces --if-present

# Run specific package
cd packages/server && npm test
cd packages/client && npm test
cd packages/agent  && npm test

# Run E2E (Day 10 only — needs Redis + Postgres running)
npm run test:e2e

# Start full demo
npm run demo:start

# Trigger agents manually
npm run agent -- --dev=devA --task="Refactor validateUser in auth.ts to accept permissions as string array."
npm run agent -- --dev=devB --task="Add 3 callers of validateUser in user.service.ts."
```
