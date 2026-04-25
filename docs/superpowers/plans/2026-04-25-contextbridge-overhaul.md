# ContextBridge Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Overhaul ContextBridge to support conflict session state machines, a fintech workspace seed, manual merge editor in the dashboard, per-dev entity ownership tracking, blast radius calculation, and full Postgres audit trail for conflicts.

**Architecture:** Approach C+B — per-dev entity versioning in Redis during conflicts, conflict session state machine (open → resolving → resolved) owns the full lifecycle, dashboard merge editor submits resolutions that are pushed to both agents via socket.

**Tech Stack:** Node 20, TypeScript, Express, Socket.IO, Redis (ioredis), PostgreSQL (pg), React 18, Vite, D3 v7, Groq SDK

**Spec:** `docs/superpowers/specs/2026-04-25-contextbridge-overhaul-design.md`

---

## File Map

### Server — new files
- `packages/server/src/services/conflict/conflict.session.service.ts` — ConflictSession CRUD (Redis + Postgres)

### Server — modified files
- `packages/server/src/config/postgres.ts` — add migration columns + stale_writes table
- `packages/server/src/types/index.ts` — add ConflictType, ConflictSession, Resolution, EnrichedConflictPayload
- `packages/server/src/services/conflict/conflict.detector.ts` — add detectConflictType, isSecuritySensitive
- `packages/server/src/services/entity/entity.service.ts` — check open conflict session on diff
- `packages/server/src/socket.ts` — new session flow, new socket events, conflict:accepted push
- `packages/server/src/routes/conflict.routes.ts` — add session endpoints
- `packages/server/src/routes/router.ts` — no change needed (conflicts already mounted)

### Agent — new files
- `packages/demo/src/fintech-seed.ts` — 10-file fintech workspace, ~50 entities

### Agent — modified files
- `packages/agent/src/interactive.ts` — import seed, handle conflict:session:opened / conflict:accepted, stale write counter

### Dashboard — new files
- `packages/dashboard/src/hooks/useConflictSessions.ts` — manages ConflictSession state from socket
- `packages/dashboard/src/components/ConflictMergeEditor.tsx` — 3-panel merge editor modal

### Dashboard — modified files
- `packages/dashboard/src/types.ts` — add ConflictSession, ConflictType, StaleWriteEvent
- `packages/dashboard/src/hooks/useGraph.ts` — handle conflict:session:opened, conflict:blast:update, conflict:resolved
- `packages/dashboard/src/components/Graph.tsx` — add onNodeClick prop, conflict node cursor
- `packages/dashboard/src/components/DevPanel.tsx` — per-dev damage counter (stale writes, open conflicts, blast radius)
- `packages/dashboard/src/components/ConflictFeed.tsx` — "Resolve" button opens merge editor
- `packages/dashboard/src/App.tsx` — wire useConflictSessions, ConflictMergeEditor, handleNodeClick

---

## Phase 1: Foundation

### Task 1: Postgres migration + server types

**Files:**
- Modify: `packages/server/src/config/postgres.ts`
- Modify: `packages/server/src/types/index.ts`

- [ ] **Step 1: Add migration to postgres.ts**

Open `packages/server/src/config/postgres.ts`. Append to the `MIGRATION` string (after the existing `ALTER TABLE entity_changes` lines):

```typescript
  ALTER TABLE conflicts ADD COLUMN IF NOT EXISTS conflict_type       TEXT DEFAULT 'signature_drift';
  ALTER TABLE conflicts ADD COLUMN IF NOT EXISTS blast_radius        INT  DEFAULT 0;
  ALTER TABLE conflicts ADD COLUMN IF NOT EXISTS security_sensitive  BOOLEAN DEFAULT false;
  ALTER TABLE conflicts ADD COLUMN IF NOT EXISTS conflict_session_id UUID;
  ALTER TABLE conflicts ADD COLUMN IF NOT EXISTS dev_a_body          TEXT;
  ALTER TABLE conflicts ADD COLUMN IF NOT EXISTS dev_b_body          TEXT;
  ALTER TABLE conflicts ADD COLUMN IF NOT EXISTS merged_body         TEXT;
  ALTER TABLE conflicts ADD COLUMN IF NOT EXISTS merged_sig          TEXT;
  ALTER TABLE conflicts ADD COLUMN IF NOT EXISTS resolution_type     TEXT;
  ALTER TABLE conflicts ADD COLUMN IF NOT EXISTS resolved_by         TEXT;
  ALTER TABLE conflicts ADD COLUMN IF NOT EXISTS resolved_at         TIMESTAMPTZ;
  ALTER TABLE conflicts ADD COLUMN IF NOT EXISTS triggering_change_id UUID;

  CREATE TABLE IF NOT EXISTS stale_writes (
    id                  UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    dev_id              TEXT    NOT NULL,
    entity_name         TEXT    NOT NULL,
    conflict_session_id UUID,
    written_at          TIMESTAMPTZ DEFAULT now(),
    conflict_type       TEXT    NOT NULL
  );
```

- [ ] **Step 2: Add new types to server types**

Replace the contents of `packages/server/src/types/index.ts` with:

```typescript
export type EntityKind  = 'function' | 'type' | 'interface' | 'class'
export type Severity    = 'critical' | 'warning' | 'info'
export type ConflictType =
  | 'signature_drift'
  | 'ghost_call'
  | 'auth_bypass'
  | 'type_violation'
  | 'blast_cascade'

export interface EntityState {
  name:      string
  kind:      EntityKind
  signature: string
  body:      string
  devId:     string
  file:      string
  line:      number
  updatedAt: string
}

export interface EntityDiffPayload {
  name:   string
  kind:   EntityKind
  oldSig: string | null
  newSig: string
  body:   string
  file:   string
  line:   number
}

export interface ConflictPayload {
  entityName:  string
  severity:    Severity
  devAId:      string
  devBId:      string
  oldSig:      string
  newSig:      string
  impactCount: number
}

export interface EnrichedConflictPayload extends ConflictPayload {
  sessionId:         string
  conflictType:      ConflictType
  securitySensitive: boolean
  devABody:          string
  devBBody:          string
}

export interface ConflictSession {
  id:              string
  entityName:      string
  devAId:          string
  devBId:          string
  devABody:        string
  devASig:         string
  devBBody:        string
  devBSig:         string
  status:          'open' | 'resolving' | 'resolved'
  detectedAt:      string
  resolvedAt?:     string
  resolvedBy?:     string
  resolutionType?: 'accepted_a' | 'accepted_b' | 'manual_merge'
  mergedBody?:     string
  mergedSig?:      string
  blastRadius:     number
  securitySensitive: boolean
  conflictType:    ConflictType
}

export interface Resolution {
  type:        'accepted_a' | 'accepted_b' | 'manual_merge'
  mergedBody:  string
  mergedSig:   string
  resolvedBy:  string
}
```

- [ ] **Step 3: Start server and confirm migrations run without error**

```bash
npm run dev -w packages/server
```

Expected: `PostgreSQL connected`, `Migrations applied` in logs. No errors about duplicate columns (IF NOT EXISTS handles reruns).

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/config/postgres.ts packages/server/src/types/index.ts
git commit -m "feat: add conflict session + stale_writes migration, expand server types"
```

---

### Task 2: Conflict session service

**Files:**
- Create: `packages/server/src/services/conflict/conflict.session.service.ts`
- Create: `packages/server/__tests__/unit/conflict.session.service.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/server/__tests__/unit/conflict.session.service.test.ts`:

```typescript
import { createSession, getSession, markResolving, resolveSession, appendStaleWrite, getOpenSessions } from '../../src/services/conflict/conflict.session.service'

const mockHset   = jest.fn().mockResolvedValue(1)
const mockHgetall = jest.fn()
const mockHdel   = jest.fn().mockResolvedValue(1)
const mockHincrby = jest.fn().mockResolvedValue(1)
const mockKeys   = jest.fn().mockResolvedValue([])
const mockQuery  = jest.fn().mockResolvedValue({ rows: [] })

jest.mock('../../src/config/redis', () => ({
  getRedisClient: () => ({
    hset: mockHset,
    hgetall: mockHgetall,
    hdel: mockHdel,
    hincrby: mockHincrby,
    keys: mockKeys,
  }),
}))
jest.mock('../../src/config/postgres', () => ({ db: { query: mockQuery } }))

describe('conflict.session.service', () => {
  beforeEach(() => jest.clearAllMocks())

  it('createSession returns session with status=open and triggers Redis + Postgres writes', async () => {
    const session = await createSession(
      'validateToken', 'devA', 'devB',
      'function validateToken(token: string)', 'validateToken(token: string): Session | null',
      'function validateToken(token: string, scope: string)', 'validateToken(token: string, scope: string): Session | null',
      'auth_bypass', true,
    )
    expect(session.status).toBe('open')
    expect(session.entityName).toBe('validateToken')
    expect(session.securitySensitive).toBe(true)
    expect(session.conflictType).toBe('auth_bypass')
    expect(session.blastRadius).toBe(0)
    expect(mockHset).toHaveBeenCalledWith(
      expect.stringContaining('conflict:session:'),
      expect.objectContaining({ entityName: 'validateToken', status: 'open' }),
    )
    expect(mockHset).toHaveBeenCalledWith(
      'entity:validateToken:meta',
      expect.objectContaining({ conflictSessionId: session.id }),
    )
    expect(mockQuery).toHaveBeenCalled()
  })

  it('getSession returns null for unknown id', async () => {
    mockHgetall.mockResolvedValueOnce(null)
    const result = await getSession('nonexistent')
    expect(result).toBeNull()
  })

  it('getSession deserialises Redis hash correctly', async () => {
    mockHgetall.mockResolvedValueOnce({
      entityName: 'validateToken', devAId: 'devA', devBId: 'devB',
      devABody: 'body-a', devASig: 'sig-a', devBBody: 'body-b', devBSig: 'sig-b',
      status: 'open', detectedAt: '2026-01-01T00:00:00Z',
      blastRadius: '3', securitySensitive: '1', conflictType: 'auth_bypass',
    })
    const session = await getSession('test-id')
    expect(session?.blastRadius).toBe(3)
    expect(session?.securitySensitive).toBe(true)
  })

  it('markResolving sets status + resolvedBy', async () => {
    await markResolving('session-id', 'dashboard')
    expect(mockHset).toHaveBeenCalledWith(
      'conflict:session:session-id',
      { status: 'resolving', resolvedBy: 'dashboard' },
    )
  })

  it('appendStaleWrite increments blastRadius and writes stale_writes row', async () => {
    mockHincrby.mockResolvedValueOnce(2)
    const radius = await appendStaleWrite('session-id', 'devB', 'transfer', 'blast_cascade')
    expect(radius).toBe(2)
    expect(mockHincrby).toHaveBeenCalledWith('conflict:session:session-id', 'blastRadius', 1)
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO stale_writes'),
      expect.arrayContaining(['devB', 'transfer', 'session-id', 'blast_cascade']),
    )
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -w packages/server -- --testPathPattern=conflict.session.service --no-coverage
```

Expected: FAIL — `Cannot find module '../../src/services/conflict/conflict.session.service'`

- [ ] **Step 3: Implement conflict.session.service.ts**

Create `packages/server/src/services/conflict/conflict.session.service.ts`:

```typescript
import { randomUUID } from 'crypto'
import { getRedisClient } from '../../config/redis'
import { db } from '../../config/postgres'
import { ConflictSession, ConflictType, Resolution } from '../../types'
import { createModuleLogger } from '../../logger/logger'

const log = createModuleLogger('conflict-session')

export async function createSession(
  entityName:        string,
  devAId:            string,
  devBId:            string,
  devABody:          string,
  devASig:           string,
  devBBody:          string,
  devBSig:           string,
  conflictType:      ConflictType,
  securitySensitive: boolean,
): Promise<ConflictSession> {
  const id  = randomUUID()
  const now = new Date().toISOString()

  const session: ConflictSession = {
    id, entityName,
    devAId, devBId, devABody, devASig, devBBody, devBSig,
    status: 'open', detectedAt: now,
    blastRadius: 0, securitySensitive, conflictType,
  }

  const redis = getRedisClient()
  await redis.hset(`conflict:session:${id}`, {
    ...session,
    blastRadius:       '0',
    securitySensitive: securitySensitive ? '1' : '0',
  })
  await redis.hset(`entity:${entityName}:meta`, { conflictSessionId: id })

  db.query(
    `INSERT INTO conflicts
       (id, entity_name, dev_a_id, dev_b_id, description, severity,
        dev_a_body, dev_b_body, conflict_type, security_sensitive,
        conflict_session_id, blast_radius, detected_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [id, entityName, devAId, devBId,
     `${conflictType} on ${entityName}`,
     securitySensitive ? 'critical' : 'warning',
     devABody, devBBody, conflictType, securitySensitive, id, 0, now],
  ).catch((err: Error) => log.error({ err }, 'failed to persist conflict session'))

  return session
}

export async function getSession(sessionId: string): Promise<ConflictSession | null> {
  const redis = getRedisClient()
  const data  = await redis.hgetall(`conflict:session:${sessionId}`)
  if (!data?.entityName) return null
  return {
    id:                sessionId,
    entityName:        data.entityName,
    devAId:            data.devAId,
    devBId:            data.devBId,
    devABody:          data.devABody ?? '',
    devASig:           data.devASig  ?? '',
    devBBody:          data.devBBody ?? '',
    devBSig:           data.devBSig  ?? '',
    status:            data.status as ConflictSession['status'],
    detectedAt:        data.detectedAt,
    resolvedAt:        data.resolvedAt,
    resolvedBy:        data.resolvedBy,
    resolutionType:    data.resolutionType as ConflictSession['resolutionType'],
    mergedBody:        data.mergedBody,
    mergedSig:         data.mergedSig,
    blastRadius:       parseInt(data.blastRadius ?? '0', 10),
    securitySensitive: data.securitySensitive === '1',
    conflictType:      data.conflictType as ConflictType,
  }
}

export async function markResolving(sessionId: string, resolvedBy: string): Promise<void> {
  await getRedisClient().hset(`conflict:session:${sessionId}`, { status: 'resolving', resolvedBy })
}

export async function resolveSession(
  sessionId: string,
  resolution: Resolution,
): Promise<ConflictSession> {
  const redis = getRedisClient()
  const now   = new Date().toISOString()

  await redis.hset(`conflict:session:${sessionId}`, {
    status:         'resolved',
    resolvedAt:     now,
    resolvedBy:     resolution.resolvedBy,
    resolutionType: resolution.type,
    mergedBody:     resolution.mergedBody,
    mergedSig:      resolution.mergedSig,
  })

  const session = await getSession(sessionId)
  if (!session) throw new Error(`Session ${sessionId} not found`)

  await redis.hdel(`entity:${session.entityName}:meta`, 'conflictSessionId')
  await redis.hset(`entity:${session.entityName}`, {
    signature: resolution.mergedSig,
    body:      resolution.mergedBody,
    devId:     resolution.resolvedBy,
    updatedAt: now,
  })

  db.query(
    `UPDATE conflicts
        SET resolved = true, resolution_type = $1, resolved_by = $2,
            resolved_at = $3, merged_body = $4, merged_sig = $5
      WHERE conflict_session_id = $6`,
    [resolution.type, resolution.resolvedBy, now,
     resolution.mergedBody, resolution.mergedSig, sessionId],
  ).catch((err: Error) => log.error({ err }, 'failed to update conflict resolution'))

  return { ...session, status: 'resolved', resolvedAt: now, ...resolution }
}

export async function appendStaleWrite(
  sessionId:    string,
  devId:        string,
  entityName:   string,
  conflictType: ConflictType,
): Promise<number> {
  const blastRadius = await getRedisClient().hincrby(
    `conflict:session:${sessionId}`, 'blastRadius', 1,
  )

  db.query(
    `INSERT INTO stale_writes (dev_id, entity_name, conflict_session_id, conflict_type)
     VALUES ($1, $2, $3, $4)`,
    [devId, entityName, sessionId, conflictType],
  ).catch((err: Error) => log.error({ err }, 'failed to persist stale write'))

  return blastRadius
}

export async function getOpenSessions(): Promise<ConflictSession[]> {
  const redis   = getRedisClient()
  const keys    = await redis.keys('conflict:session:*')
  const results = await Promise.all(
    keys.map(k => getSession(k.replace('conflict:session:', ''))),
  )
  return results.filter((s): s is ConflictSession => s !== null && s.status !== 'resolved')
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test -w packages/server -- --testPathPattern=conflict.session.service --no-coverage
```

Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/conflict/conflict.session.service.ts \
        packages/server/__tests__/unit/conflict.session.service.test.ts
git commit -m "feat: conflict session service — create, get, resolve, blast radius"
```

---

### Task 3: Conflict detector overhaul

**Files:**
- Modify: `packages/server/src/services/conflict/conflict.detector.ts`
- Modify: `packages/server/__tests__/unit/conflict.detector.test.ts`

- [ ] **Step 1: Write new failing tests**

Open `packages/server/__tests__/unit/conflict.detector.test.ts` and add these tests (keep existing ones):

```typescript
import { detectConflictType, isSecuritySensitive } from '../../src/services/conflict/conflict.detector'

describe('detectConflictType', () => {
  it('returns auth_bypass for validateToken', () => {
    expect(detectConflictType('validateToken', 'old', 'new', 'function')).toBe('auth_bypass')
  })
  it('returns auth_bypass for requireScope', () => {
    expect(detectConflictType('requireScope', 'old', 'new', 'function')).toBe('auth_bypass')
  })
  it('returns type_violation for interface entity', () => {
    expect(detectConflictType('Account', 'old', 'new', 'interface')).toBe('type_violation')
  })
  it('returns type_violation for type entity', () => {
    expect(detectConflictType('Transaction', 'old', 'new', 'type')).toBe('type_violation')
  })
  it('returns signature_drift for regular function', () => {
    expect(detectConflictType('transfer', 'old', 'new', 'function')).toBe('signature_drift')
  })
})

describe('isSecuritySensitive', () => {
  it('returns true for validateToken', () => {
    expect(isSecuritySensitive('validateToken')).toBe(true)
  })
  it('returns true for requireKYC', () => {
    expect(isSecuritySensitive('requireKYC')).toBe(true)
  })
  it('returns false for transfer', () => {
    expect(isSecuritySensitive('transfer')).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -w packages/server -- --testPathPattern=conflict.detector --no-coverage
```

Expected: FAIL — `detectConflictType is not a function`

- [ ] **Step 3: Add detectConflictType and isSecuritySensitive to conflict.detector.ts**

Replace the full contents of `packages/server/src/services/conflict/conflict.detector.ts`:

```typescript
import { getRedisClient } from '../../config/redis'
import { getImpactCount } from '../graph/graph.service'
import { ConflictPayload, ConflictType, EntityKind, Severity } from '../../types'

const AUTH_PATH = /^(validateToken|requireScope|requirePermission|checkPermission|verifyIdentity|requireKYC|checkCompliance|createSession|revokeToken|refreshToken)$/

export function classifySeverity(impactCount: number): Severity {
  if (impactCount >= 10) return 'critical'
  if (impactCount >= 1)  return 'warning'
  return 'info'
}

export function detectConflictType(
  entityName: string,
  _oldSig:    string,
  _newSig:    string,
  kind:       EntityKind | string,
): ConflictType {
  if (AUTH_PATH.test(entityName))                        return 'auth_bypass'
  if (kind === 'interface' || kind === 'type')           return 'type_violation'
  return 'signature_drift'
}

export function isSecuritySensitive(entityName: string): boolean {
  return AUTH_PATH.test(entityName)
}

export async function detectConflict(
  entityName:      string,
  requestingDevId: string,
  newSig:          string,
): Promise<ConflictPayload | null> {
  const redis        = getRedisClient()
  const currentOwner = await redis.get(`lock:${entityName}`)
  if (!currentOwner || currentOwner === requestingDevId) return null

  const [oldSig, impactCount] = await Promise.all([
    redis.hget(`entity:${entityName}`, 'signature'),
    getImpactCount(entityName),
  ])

  return {
    entityName,
    severity:    classifySeverity(impactCount),
    devAId:      currentOwner,
    devBId:      requestingDevId,
    oldSig:      oldSig ?? '',
    newSig,
    impactCount,
  }
}

export async function storeConflict(conflict: ConflictPayload): Promise<void> {
  const redis = getRedisClient()
  await redis.lpush('conflicts:recent', JSON.stringify(conflict))
  await redis.ltrim('conflicts:recent', 0, 99)
}
```

- [ ] **Step 4: Run all detector tests**

```bash
npm test -w packages/server -- --testPathPattern=conflict.detector --no-coverage
```

Expected: PASS (all tests including new ones)

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/conflict/conflict.detector.ts \
        packages/server/__tests__/unit/conflict.detector.test.ts
git commit -m "feat: conflict type detection — auth_bypass, type_violation, isSecuritySensitive"
```

---

## Phase 2: Core Wiring

### Task 4: Entity service — stale write detection

**Files:**
- Modify: `packages/server/src/services/entity/entity.service.ts`

- [ ] **Step 1: Modify handleDiff to read entity meta before writing**

The entity service needs to expose whether each entity has an open conflict session, so socket.ts can decide between "new conflict" vs "stale write on existing session". Add a new exported function:

Replace `packages/server/src/services/entity/entity.service.ts` with:

```typescript
import Redis from 'ioredis'
import { getRedisClient } from '../../config/redis'
import { db } from '../../config/postgres'
import { EntityDiffPayload } from '../../types'
import { createModuleLogger } from '../../logger/logger'
import { updateDependents, updateClientIndex, updateEntityCalls } from '../graph/graph.service'

const log = createModuleLogger('entity-service')

const BUILTIN_IDENTIFIERS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'instanceof', 'in', 'of',
  'new', 'delete', 'throw', 'await', 'async', 'function', 'class', 'const', 'let', 'var',
  'console', 'Math', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Promise', 'Error',
  'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'parseInt', 'parseFloat',
  'isNaN', 'isFinite', 'JSON', 'Date', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Symbol',
  'describe', 'it', 'test', 'expect', 'beforeAll', 'afterAll', 'beforeEach', 'afterEach',
  'require', 'exports', 'module', 'process', 'Buffer', 'global', 'undefined', 'null',
  'super', 'this', 'void', 'try', 'then', 'catch', 'finally', 'push', 'pop', 'map',
  'filter', 'reduce', 'find', 'forEach', 'slice', 'splice', 'join', 'split', 'includes',
  'log', 'error', 'warn', 'info', 'debug',
])

function extractCalls(body: string): string[] {
  const callPattern = /\b([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g
  const candidates  = new Set<string>()
  let match: RegExpExecArray | null
  while ((match = callPattern.exec(body)) !== null) {
    const name = match[1]
    if (!BUILTIN_IDENTIFIERS.has(name) && name.length > 1) candidates.add(name)
  }
  return [...candidates]
}

async function knownEntityCalls(redis: Redis, body: string): Promise<string[]> {
  const candidates = extractCalls(body)
  if (candidates.length === 0) return []
  const known: string[] = []
  for (const name of candidates) {
    const exists = await redis.exists(`entity:${name}`)
    if (exists) known.push(name)
  }
  return known
}

/** Returns the conflictSessionId for an entity if one is open, otherwise null. */
export async function getEntityConflictSession(entityName: string): Promise<string | null> {
  const redis = getRedisClient()
  const sessionId = await redis.hget(`entity:${entityName}:meta`, 'conflictSessionId')
  return sessionId ?? null
}

export async function handleDiff(devId: string, entities: EntityDiffPayload[]): Promise<void> {
  const redis = getRedisClient()

  for (const entity of entities) {
    await redis.hset(`entity:${entity.name}`, {
      signature: entity.newSig,
      body:      entity.body,
      devId,
      file:      entity.file,
      line:      String(entity.line),
      kind:      entity.kind,
      updatedAt: new Date().toISOString(),
    })

    await redis.set(`lock:${entity.name}`, devId, 'EX', 300)
    await redis.sadd(`client:${devId}:entities`, entity.name)

    const calledNames = await knownEntityCalls(redis, entity.body ?? '')
    if (calledNames.length > 0) {
      await updateEntityCalls(entity.name, calledNames)
      await updateDependents(entity.name, calledNames)
      await updateClientIndex(devId, calledNames)
    }

    writeEntityChangeAsync(devId, entity)
  }
}

function writeEntityChangeAsync(devId: string, entity: EntityDiffPayload): void {
  db.query(
    `INSERT INTO entity_changes
       (entity_name, dev_id, old_signature, new_signature, severity, kind, body, file, line)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [entity.name, devId, entity.oldSig, entity.newSig, 'info',
     entity.kind, entity.body, entity.file, entity.line],
  ).catch((err: Error) => log.error({ err }, 'failed to write entity change'))
}
```

- [ ] **Step 2: Run existing entity service tests to confirm no regression**

```bash
npm test -w packages/server -- --testPathPattern=context.service --no-coverage
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/services/entity/entity.service.ts
git commit -m "feat: entity service — expose getEntityConflictSession for stale write detection"
```

---

### Task 5: Socket.ts — conflict session flow + new events

**Files:**
- Modify: `packages/server/src/socket.ts`

- [ ] **Step 1: Replace handleEntityDiffEvent and entity:diff handler in socket.ts**

Replace the full contents of `packages/server/src/socket.ts`:

```typescript
import { Server as HttpServer } from 'http'
import { Server, Socket } from 'socket.io'
import { createModuleLogger } from './logger/logger'
import { getRedisClient } from './config/redis'
import * as entityService from './services/entity/entity.service'
import { EntityDiffPayload, ConflictPayload, EnrichedConflictPayload, Resolution } from './types'
import { detectConflict, detectConflictType, isSecuritySensitive, storeConflict } from './services/conflict/conflict.detector'
import { createSession, getSession, markResolving, resolveSession, appendStaleWrite, getOpenSessions } from './services/conflict/conflict.session.service'
import { getEntityClients, getLinksForEntities } from './services/graph/graph.service'

const log = createModuleLogger('socket')

let io: Server

export function getIo(): Server { return io }

export async function handleEntityDiffEvent(
  devId:   string,
  payload: EntityDiffPayload[],
): Promise<(ConflictPayload | EnrichedConflictPayload)[]> {
  const redis     = getRedisClient()
  const conflicts: (ConflictPayload | EnrichedConflictPayload)[] = []

  for (const entity of payload) {
    const openSessionId = await entityService.getEntityConflictSession(entity.name)

    if (openSessionId) {
      /* ── Stale write: entity already has open conflict session ── */
      const session = await getSession(openSessionId)
      if (session) {
        const blastRadius = await appendStaleWrite(
          openSessionId, devId, entity.name,
          detectConflictType(entity.name, session.devASig, entity.newSig, entity.kind),
        )
        io.to('room:dashboard').emit('conflict:blast:update', {
          sessionId:      openSessionId,
          blastRadius,
          newStaleEntity: entity.name,
          devId,
        })
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

        conflicts.push(enriched)
        await storeConflict(conflict)

        const clients = await getEntityClients(entity.name)
        const targets = new Set([...clients, conflict.devAId, devId])
        for (const clientId of targets) {
          io.to(`room:${clientId}`).emit('entity:conflict', enriched)
        }
        io.to('room:dashboard').emit('conflict:session:opened', {
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
        })
        io.to('room:dashboard').emit('conflict:detected', enriched)
        io.to('room:dashboard').emit('graph:links', [
          { source: devId, target: entity.name, conflict: true },
        ])
      }
    }
  }

  await entityService.handleDiff(devId, payload)
  return conflicts
}

export async function resolveConflictSession(
  sessionId:  string,
  resolution: Resolution,
): Promise<void> {
  const session = await resolveSession(sessionId, resolution)

  const acceptedBody = resolution.mergedBody
  const acceptedSig  = resolution.mergedSig

  /* Push accepted version to both agents */
  for (const agentDevId of [session.devAId, session.devBId]) {
    io.to(`room:${agentDevId}`).emit('conflict:accepted', {
      entityName: session.entityName,
      body:       acceptedBody,
      sig:        acceptedSig,
      file:       '',          // agents look up file from their workspace
    })
  }

  io.to('room:dashboard').emit('conflict:resolved', {
    sessionId,
    entityName:     session.entityName,
    resolutionType: resolution.type,
    resolvedBy:     resolution.resolvedBy,
  })
  io.to('room:dashboard').emit('entity:updated', {
    name:      session.entityName,
    devId:     resolution.resolvedBy,
    signature: acceptedSig,
    kind:      'function',
    file:      '',
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
      socket.emit('conflict:session:opened', {
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
      })
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
```

- [ ] **Step 2: Run server — confirm it starts without TypeScript errors**

```bash
npm run build -w packages/server
```

Expected: no type errors

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/socket.ts
git commit -m "feat: socket — conflict session flow, blast radius updates, conflict:accepted push"
```

---

### Task 6: REST endpoints for conflict sessions

**Files:**
- Modify: `packages/server/src/routes/conflict.routes.ts`

- [ ] **Step 1: Replace conflict.routes.ts**

```typescript
import { Router, Request, Response, NextFunction } from 'express'
import { getRedisClient } from '../config/redis'
import { getOpenSessions, getSession, markResolving } from '../services/conflict/conflict.session.service'
import { resolveConflictSession } from '../socket'
import { Resolution } from '../types'

export async function getConflictsHandler(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const raw       = await getRedisClient().lrange('conflicts:recent', 0, 99)
    const conflicts = raw.map((s: string) => JSON.parse(s) as unknown)
    res.json(conflicts)
  } catch (err) { next(err) }
}

export async function getSessionsHandler(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(await getOpenSessions())
  } catch (err) { next(err) }
}

export async function getSessionHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const session = await getSession(req.params.id)
    if (!session) { res.status(404).json({ error: 'Session not found' }); return }
    res.json(session)
  } catch (err) { next(err) }
}

export async function resolveSessionHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { type, mergedBody, mergedSig, resolvedBy } = req.body as Partial<Resolution>
    if (!type || !mergedBody || !mergedSig || !resolvedBy) {
      res.status(400).json({ error: 'type, mergedBody, mergedSig, resolvedBy required' }); return
    }
    if (!['accepted_a', 'accepted_b', 'manual_merge'].includes(type)) {
      res.status(400).json({ error: 'type must be accepted_a | accepted_b | manual_merge' }); return
    }

    const session = await getSession(req.params.id)
    if (!session) { res.status(404).json({ error: 'Session not found' }); return }
    if (session.status === 'resolved') { res.status(409).json({ error: 'Already resolved' }); return }

    await markResolving(req.params.id, resolvedBy)
    await resolveConflictSession(req.params.id, { type, mergedBody, mergedSig, resolvedBy })
    res.json({ ok: true })
  } catch (err) { next(err) }
}

const router = Router()
router.get('/',                getConflictsHandler)
router.get('/sessions',        getSessionsHandler)
router.get('/sessions/:id',    getSessionHandler)
router.post('/sessions/:id/resolve', resolveSessionHandler)
export default router
```

- [ ] **Step 2: Smoke test the endpoints manually**

Start the server (`npm run dev -w packages/server`). With no active sessions:

```bash
curl http://localhost:3000/v1/conflicts/sessions
```

Expected: `[]`

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/routes/conflict.routes.ts
git commit -m "feat: conflict routes — GET /sessions, GET /sessions/:id, POST /sessions/:id/resolve"
```

---

## Phase 3: Agent

### Task 7: Fintech seed

**Files:**
- Create: `packages/demo/src/fintech-seed.ts`

- [ ] **Step 1: Create fintech-seed.ts**

Create `packages/demo/src/fintech-seed.ts`:

```typescript
export const FINTECH_FILES: Record<string, string> = {
  'types.ts': `export interface Account {
  id: string; userId: string; accountNumber: string
  balance: number; currency: 'USD' | 'EUR' | 'GBP'
  status: 'active' | 'frozen' | 'closed' | 'pending_kyc'
  kycVerified: boolean; dailyLimit: number
  createdAt: Date; updatedAt: Date
}
export interface Transaction {
  id: string; fromAccountId: string; toAccountId: string
  amount: number; currency: string
  type: 'transfer' | 'deposit' | 'withdrawal' | 'fee' | 'refund'
  status: 'pending' | 'completed' | 'failed' | 'reversed'
  description: string; metadata: Record<string, unknown>
  processedAt: Date | null; createdAt: Date
}
export interface Payment {
  id: string; accountId: string; amount: number; currency: string
  method: 'card' | 'bank_transfer' | 'crypto'
  status: 'pending' | 'authorized' | 'captured' | 'failed' | 'refunded'
  processorId: string; processorResponse: Record<string, unknown>; createdAt: Date
}
export interface Session {
  id: string; userId: string; token: string; scope: string[]
  expiresAt: Date; createdAt: Date; revoked: boolean
}
export interface KYCRecord {
  userId: string
  status: 'pending' | 'approved' | 'rejected' | 'expired'
  verifiedAt: Date | null; documents: string[]
  riskLevel: 'low' | 'medium' | 'high'
}
export interface RiskScore {
  transactionId: string; score: number; factors: string[]
  recommendation: 'allow' | 'review' | 'block'
}
export interface AuditLog {
  id: string; action: string; actorId: string
  targetId: string; targetType: string
  metadata: Record<string, unknown>; timestamp: Date
}
`,

  'auth.service.ts': `import { Session } from './types'
const sessions = new Map<string, Session>()

export function validateToken(token: string): Session | null {
  const session = [...sessions.values()].find(s => s.token === token)
  if (!session || session.revoked || session.expiresAt < new Date()) return null
  return session
}
export function requireScope(session: Session, requiredScope: string): boolean {
  return session.scope.includes(requiredScope)
}
export async function createSession(userId: string, scope: string[]): Promise<Session> {
  const session: Session = {
    id: Math.random().toString(36).slice(2), userId,
    token: Buffer.from(\`\${userId}:\${Date.now()}:\${Math.random()}\`).toString('base64url'),
    scope, expiresAt: new Date(Date.now() + 86_400_000),
    createdAt: new Date(), revoked: false,
  }
  sessions.set(session.id, session)
  return session
}
export async function revokeToken(token: string): Promise<void> {
  const s = [...sessions.values()].find(s => s.token === token)
  if (s) sessions.set(s.id, { ...s, revoked: true })
}
export async function refreshToken(token: string): Promise<Session | null> {
  const old = validateToken(token)
  if (!old) return null
  await revokeToken(token)
  return createSession(old.userId, old.scope)
}
`,

  'account.service.ts': `import { Account } from './types'
import { validateToken, requireScope } from './auth.service'
import { logTransaction } from './audit.service'
import { checkCompliance } from './kyc.service'
const accounts = new Map<string, Account>()

export async function getAccount(accountId: string, token: string): Promise<Account | null> {
  const session = validateToken(token)
  if (!session) throw new Error('Unauthorized')
  return accounts.get(accountId) ?? null
}
export async function getBalance(accountId: string, token: string): Promise<number> {
  const account = await getAccount(accountId, token)
  if (!account) throw new Error('Account not found')
  return account.balance
}
export async function createAccount(userId: string, currency: Account['currency'], token: string): Promise<Account> {
  const session = validateToken(token)
  if (!session || !requireScope(session, 'accounts:write')) throw new Error('Forbidden')
  if (!await checkCompliance(userId)) throw new Error('KYC required')
  const account: Account = {
    id: Math.random().toString(36).slice(2), userId,
    accountNumber: \`ACC\${Date.now()}\`, balance: 0, currency,
    status: 'active', kycVerified: true, dailyLimit: 10_000,
    createdAt: new Date(), updatedAt: new Date(),
  }
  accounts.set(account.id, account)
  await logTransaction('account.created', userId, account.id, 'account', {})
  return account
}
export async function freezeAccount(accountId: string, reason: string, token: string): Promise<void> {
  const session = validateToken(token)
  if (!session || !requireScope(session, 'accounts:admin')) throw new Error('Forbidden')
  const account = accounts.get(accountId)
  if (!account) throw new Error('Account not found')
  accounts.set(accountId, { ...account, status: 'frozen', updatedAt: new Date() })
  await logTransaction('account.frozen', session.userId, accountId, 'account', { reason })
}
export async function updateAccountLimits(accountId: string, dailyLimit: number, token: string): Promise<Account> {
  const session = validateToken(token)
  if (!session || !requireScope(session, 'accounts:admin')) throw new Error('Forbidden')
  const account = accounts.get(accountId)
  if (!account) throw new Error('Account not found')
  const updated = { ...account, dailyLimit, updatedAt: new Date() }
  accounts.set(accountId, updated)
  return updated
}
`,

  'transaction.service.ts': `import { Transaction } from './types'
import { validateToken, requireScope } from './auth.service'
import { getAccount } from './account.service'
import { scoreRisk } from './fraud.service'
import { logTransaction } from './audit.service'
import { sendReceipt } from './notification.service'
const transactions = new Map<string, Transaction>()

export async function transfer(fromAccountId: string, toAccountId: string, amount: number, token: string): Promise<Transaction> {
  const session = validateToken(token)
  if (!session || !requireScope(session, 'transactions:write')) throw new Error('Forbidden')
  const [from, to] = await Promise.all([getAccount(fromAccountId, token), getAccount(toAccountId, token)])
  if (!from || !to) throw new Error('Account not found')
  if (from.status !== 'active') throw new Error('Account unavailable')
  if (from.balance < amount) throw new Error('Insufficient funds')
  if (amount > from.dailyLimit) throw new Error('Exceeds daily limit')
  const tx: Transaction = {
    id: Math.random().toString(36).slice(2),
    fromAccountId, toAccountId, amount, currency: from.currency,
    type: 'transfer', status: 'pending', description: \`Transfer to \${toAccountId}\`,
    metadata: {}, processedAt: null, createdAt: new Date(),
  }
  const risk = await scoreRisk(tx)
  if (risk.recommendation === 'block') throw new Error('Transaction blocked: fraud risk')
  transactions.set(tx.id, { ...tx, status: 'completed', processedAt: new Date() })
  await logTransaction('transfer.completed', session.userId, tx.id, 'transaction', { amount })
  await sendReceipt(session.userId, tx.id, amount)
  return transactions.get(tx.id)!
}
export async function deposit(accountId: string, amount: number, token: string): Promise<Transaction> {
  const session = validateToken(token)
  if (!session || !requireScope(session, 'transactions:write')) throw new Error('Forbidden')
  const account = await getAccount(accountId, token)
  if (!account) throw new Error('Account not found')
  const tx: Transaction = {
    id: Math.random().toString(36).slice(2), fromAccountId: 'external', toAccountId: accountId,
    amount, currency: account.currency, type: 'deposit', status: 'completed',
    description: 'Deposit', metadata: {}, processedAt: new Date(), createdAt: new Date(),
  }
  transactions.set(tx.id, tx)
  await logTransaction('deposit.completed', session.userId, tx.id, 'transaction', { amount })
  return tx
}
export async function withdraw(accountId: string, amount: number, token: string): Promise<Transaction> {
  const session = validateToken(token)
  if (!session || !requireScope(session, 'transactions:write')) throw new Error('Forbidden')
  const account = await getAccount(accountId, token)
  if (!account || account.balance < amount) throw new Error('Insufficient funds')
  const tx: Transaction = {
    id: Math.random().toString(36).slice(2), fromAccountId: accountId, toAccountId: 'external',
    amount, currency: account.currency, type: 'withdrawal', status: 'completed',
    description: 'Withdrawal', metadata: {}, processedAt: new Date(), createdAt: new Date(),
  }
  transactions.set(tx.id, tx)
  await logTransaction('withdrawal.completed', session.userId, tx.id, 'transaction', { amount })
  return tx
}
export async function getTransactionHistory(accountId: string, token: string): Promise<Transaction[]> {
  const session = validateToken(token)
  if (!session) throw new Error('Unauthorized')
  return [...transactions.values()].filter(t => t.fromAccountId === accountId || t.toAccountId === accountId)
}
export async function validateTransactionLimit(accountId: string, amount: number, token: string): Promise<boolean> {
  const account = await getAccount(accountId, token)
  if (!account) return false
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const spent = [...transactions.values()]
    .filter(t => t.fromAccountId === accountId && t.createdAt >= today && t.status === 'completed')
    .reduce((s, t) => s + t.amount, 0)
  return spent + amount <= account.dailyLimit
}
`,

  'payment.service.ts': `import { Payment } from './types'
import { validateToken, requireScope } from './auth.service'
import { getAccount } from './account.service'
import { scoreRisk } from './fraud.service'
import { logTransaction } from './audit.service'
import { notifyPaymentFailed } from './notification.service'
const payments = new Map<string, Payment>()

export async function chargeCard(accountId: string, amount: number, cardToken: string, authToken: string): Promise<Payment> {
  const session = validateToken(authToken)
  if (!session || !requireScope(session, 'payments:write')) throw new Error('Forbidden')
  const account = await getAccount(accountId, authToken)
  if (!account || account.status !== 'active') throw new Error('Account unavailable')
  const payment: Payment = {
    id: Math.random().toString(36).slice(2), accountId, amount,
    currency: account.currency, method: 'card', status: 'pending',
    processorId: \`proc_\${Math.random().toString(36).slice(2)}\`,
    processorResponse: {}, createdAt: new Date(),
  }
  const fakeTx = { id: payment.id, fromAccountId: accountId, toAccountId: 'processor', amount, currency: account.currency, type: 'fee' as const, status: 'pending' as const, description: '', metadata: {}, processedAt: null, createdAt: new Date() }
  const risk = await scoreRisk(fakeTx)
  if (risk.recommendation === 'block') {
    payments.set(payment.id, { ...payment, status: 'failed' })
    await notifyPaymentFailed(session.userId, payment.id, 'Fraud risk')
    throw new Error('Payment blocked')
  }
  payments.set(payment.id, { ...payment, status: 'captured', processorResponse: { authorized: true } })
  await logTransaction('payment.captured', session.userId, payment.id, 'payment', { amount })
  return payments.get(payment.id)!
}
export async function refund(paymentId: string, authToken: string): Promise<Payment> {
  const session = validateToken(authToken)
  if (!session || !requireScope(session, 'payments:write')) throw new Error('Forbidden')
  const payment = payments.get(paymentId)
  if (!payment || payment.status !== 'captured') throw new Error('Not refundable')
  const refunded = { ...payment, status: 'refunded' as const }
  payments.set(paymentId, refunded)
  await logTransaction('payment.refunded', session.userId, paymentId, 'payment', {})
  return refunded
}
export async function validatePaymentMethod(cardToken: string, authToken: string): Promise<boolean> {
  const session = validateToken(authToken)
  if (!session) throw new Error('Unauthorized')
  return cardToken.startsWith('tok_') && cardToken.length > 10
}
export async function processWebhook(processorId: string, event: Record<string, unknown>): Promise<void> {
  const payment = [...payments.values()].find(p => p.processorId === processorId)
  if (!payment) return
  if (event.type === 'payment.failed') payments.set(payment.id, { ...payment, status: 'failed', processorResponse: event })
}
export async function createPaymentIntent(accountId: string, amount: number, currency: string, authToken: string): Promise<{ intentId: string; clientSecret: string }> {
  const session = validateToken(authToken)
  if (!session || !requireScope(session, 'payments:write')) throw new Error('Forbidden')
  return { intentId: \`pi_\${Math.random().toString(36).slice(2)}\`, clientSecret: \`secret_\${Math.random().toString(36).slice(2)}\` }
}
`,

  'fraud.service.ts': `import { Transaction, RiskScore } from './types'
import { logTransaction } from './audit.service'
import { alertFraud } from './notification.service'
const blocked   = new Set<string>()
const flagged   = new Set<string>()

export async function scoreRisk(transaction: Transaction): Promise<RiskScore> {
  const factors: string[] = []; let score = 0
  if (transaction.amount > 5_000)  { score += 30; factors.push('high_amount') }
  if (transaction.amount > 10_000) { score += 30; factors.push('very_high_amount') }
  if (blocked.has(transaction.fromAccountId)) { score += 50; factors.push('blocked_account') }
  if (flagged.has(transaction.fromAccountId)) { score += 20; factors.push('flagged_account') }
  const recommendation: RiskScore['recommendation'] = score >= 70 ? 'block' : score >= 40 ? 'review' : 'allow'
  return { transactionId: transaction.id, score, factors, recommendation }
}
export async function flagTransaction(transactionId: string, reason: string): Promise<void> {
  flagged.add(transactionId)
  await logTransaction('fraud.flagged', 'system', transactionId, 'transaction', { reason })
  await alertFraud('compliance-team', transactionId, reason)
}
export async function blockAccount(accountId: string, reason: string): Promise<void> {
  blocked.add(accountId)
  await logTransaction('account.blocked', 'system', accountId, 'account', { reason })
  await alertFraud('compliance-team', accountId, \`Blocked: \${reason}\`)
}
export async function reviewFraudAlert(alertId: string, decision: 'clear' | 'escalate'): Promise<void> {
  await logTransaction('fraud.reviewed', 'compliance', alertId, 'alert', { decision })
  if (decision === 'clear') flagged.delete(alertId)
}
export async function updateRiskModel(thresholds: { highAmount: number; veryHighAmount: number }): Promise<void> {
  await logTransaction('risk.model.updated', 'system', 'global', 'config', thresholds)
}
`,

  'kyc.service.ts': `import { KYCRecord } from './types'
import { logTransaction } from './audit.service'
const records = new Map<string, KYCRecord>()

export async function verifyIdentity(userId: string, documents: string[]): Promise<KYCRecord> {
  const record: KYCRecord = { userId, status: 'pending', verifiedAt: null, documents, riskLevel: 'low' }
  records.set(userId, record)
  await logTransaction('kyc.submitted', userId, userId, 'kyc', { documentCount: documents.length })
  return record
}
export async function checkCompliance(userId: string): Promise<boolean> {
  return records.get(userId)?.status === 'approved' ?? false
}
export async function updateKYCStatus(userId: string, status: KYCRecord['status'], riskLevel: KYCRecord['riskLevel']): Promise<KYCRecord> {
  const existing = records.get(userId)
  if (!existing) throw new Error('KYC record not found')
  const updated: KYCRecord = { ...existing, status, riskLevel, verifiedAt: status === 'approved' ? new Date() : existing.verifiedAt }
  records.set(userId, updated)
  await logTransaction('kyc.status.updated', 'compliance', userId, 'kyc', { status, riskLevel })
  return updated
}
export async function requireKYC(userId: string): Promise<void> {
  if (!await checkCompliance(userId)) throw new Error(\`User \${userId} must complete KYC\`)
}
`,

  'audit.service.ts': `import { AuditLog } from './types'
const logs: AuditLog[] = []

export async function logTransaction(action: string, actorId: string, targetId: string, targetType: string, metadata: Record<string, unknown>): Promise<AuditLog> {
  const log: AuditLog = { id: Math.random().toString(36).slice(2), action, actorId, targetId, targetType, metadata, timestamp: new Date() }
  logs.push(log)
  return log
}
export async function generateReport(fromDate: Date, toDate: Date): Promise<AuditLog[]> {
  return logs.filter(l => l.timestamp >= fromDate && l.timestamp <= toDate)
}
export async function flagSuspicious(logId: string): Promise<void> {
  const log = logs.find(l => l.id === logId)
  if (log) log.metadata = { ...log.metadata, flagged: true, flaggedAt: new Date() }
}
export async function getAuditTrail(targetId: string): Promise<AuditLog[]> {
  return logs.filter(l => l.targetId === targetId).sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
}
`,

  'notification.service.ts': `export async function alertFraud(recipientId: string, transactionId: string, reason: string): Promise<void> {
  console.log(\`[FRAUD ALERT] \${recipientId}: \${transactionId} — \${reason}\`)
}
export async function sendReceipt(userId: string, transactionId: string, amount: number): Promise<void> {
  console.log(\`[RECEIPT] \${userId}: \${transactionId} — $\${amount}\`)
}
export async function notifyAccountFreeze(userId: string, accountId: string, reason: string): Promise<void> {
  console.log(\`[ACCOUNT FROZEN] \${userId}: \${accountId} — \${reason}\`)
}
export async function notifyPaymentFailed(userId: string, paymentId: string, reason: string): Promise<void> {
  console.log(\`[PAYMENT FAILED] \${userId}: \${paymentId} — \${reason}\`)
}
`,

  'db.ts': `export async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  void sql; void params; return []
}
export async function transaction<T>(fn: () => Promise<T>): Promise<T> { return fn() }
export async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let last: Error | null = null
  for (let i = 0; i < maxAttempts; i++) { try { return await fn() } catch (e) { last = e as Error } }
  throw last
}
export async function withAuditLog<T>(action: string, actorId: string, fn: () => Promise<T>): Promise<T> {
  const result = await fn()
  console.log(\`[AUDIT] \${action} by \${actorId}\`)
  return result
}
`,
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/demo/src/fintech-seed.ts
git commit -m "feat: fintech workspace seed — 10 files, ~50 entities, cross-module deps (auth, payments, fraud, kyc)"
```

---

### Task 8: Agent — import seed, handle conflict:accepted, show blast radius

**Files:**
- Modify: `packages/agent/src/interactive.ts`

- [ ] **Step 1: Replace seedWorkspace() function and add conflict handlers**

In `packages/agent/src/interactive.ts`, make the following changes:

**1. Add import at top of file (after existing imports):**
```typescript
import { FINTECH_FILES } from '../../demo/src/fintech-seed'
```

**2. Replace the `seedWorkspace()` function (currently at line ~147) with:**
```typescript
function seedWorkspace(): void {
  fs.mkdirSync(WORKSPACE, { recursive: true })
  for (const [name, content] of Object.entries(FINTECH_FILES)) {
    fs.writeFileSync(path.join(WORKSPACE, name), content, 'utf8')
  }
}
```

**3. Add stale write counter near the other state declarations (after `let conflictSound = false`):**
```typescript
let staleWriteCount = 0
let openConflicts   = 0
```

**4. Replace the `socket.on('conflict:detected', ...)` handler with these two handlers:**
```typescript
socket.on('conflict:detected', (payload: Record<string, unknown>) => {
  const sev      = String(payload.severity ?? 'info')
  const sevColor = sev === 'critical' ? C.red : sev === 'warning' ? C.orange : C.cyan
  const impact   = Number(payload.impactCount ?? 0)
  const isSecure = Boolean(payload.securitySensitive)
  openConflicts++
  console.log()
  console.log(`${tag('⚡ CONFLICT', C.red)} ${C.bold}${String(payload.entityName)}${C.reset}${isSecure ? ` ${C.red}🔒 SECURITY SENSITIVE${C.reset}` : ''}`)
  console.log(`  ${C.gray}owner:${C.reset}    ${C.cyan}${String(payload.devAId)}${C.reset}`)
  console.log(`  ${C.gray}modifier:${C.reset} ${C.amber}${String(payload.devBId)}${C.reset}`)
  console.log(`  ${C.gray}severity:${C.reset} ${sevColor}${C.bold}${sev}${C.reset}${impact > 0 ? `  ${C.gray}(blast radius: ${impact} downstream)${C.reset}` : ''}`)
  console.log(`  ${C.gray}type:${C.reset}     ${String(payload.conflictType ?? 'signature_drift')}`)
  console.log(`  ${C.gray}→ resolve at dashboard: http://localhost:5174${C.reset}`)
  console.log()
  console.log(`  ${C.amber}${C.bold}Open conflicts this session: ${openConflicts}  Stale writes: ${staleWriteCount}${C.reset}`)
  console.log()
  rl.prompt()
})

socket.on('conflict:blast:update', (payload: Record<string, unknown>) => {
  staleWriteCount++
  console.log()
  console.log(`${tag('⚠ STALE WRITE', C.amber)} ${C.bold}${String(payload.newStaleEntity)}${C.reset} written against open conflict`)
  console.log(`  ${C.gray}blast radius now: ${C.bold}${C.red}${payload.blastRadius}${C.reset} ${C.gray}downstream functions affected${C.reset}`)
  console.log(`  ${C.amber}Stale writes this session: ${staleWriteCount}${C.reset}`)
  console.log()
  rl.prompt()
})

socket.on('conflict:accepted', (payload: Record<string, unknown>) => {
  const entityName = String(payload.entityName)
  const body       = String(payload.body ?? '')
  const file       = String(payload.file  ?? '')
  openConflicts    = Math.max(0, openConflicts - 1)

  if (body && file) {
    const filePath   = path.resolve(WORKSPACE, file)
    const boundary   = WORKSPACE.endsWith(path.sep) ? WORKSPACE : WORKSPACE + path.sep
    if (filePath.startsWith(boundary)) {
      fs.writeFileSync(filePath, body + '\n', 'utf8')
      console.log()
      console.log(`${tag('✓ RESOLVED', C.green)} ${C.bold}${entityName}${C.reset} — accepted version written to ${file}`)
      /* Re-emit entity:diff so server reflects resolved state */
      socket.emit('entity:diff', [{
        name: entityName, kind: 'function',
        oldSig: '', newSig: entityName, body: body.slice(0, 500),
        file, line: 1,
      }])
    }
  } else {
    console.log()
    console.log(`${tag('✓ RESOLVED', C.green)} ${C.bold}${entityName}${C.reset} conflict resolved on server`)
  }
  console.log(`  ${C.gray}Remaining open conflicts: ${openConflicts}${C.reset}`)
  console.log()
  rl.prompt()
})
```

- [ ] **Step 2: Test seed by running the agent**

```bash
npm run agent devA
```

Type `ls` in the agent prompt.

Expected: shows 10 files (types.ts, auth.service.ts, account.service.ts, transaction.service.ts, payment.service.ts, fraud.service.ts, kyc.service.ts, audit.service.ts, notification.service.ts, db.ts)

- [ ] **Step 3: Commit**

```bash
git add packages/agent/src/interactive.ts packages/demo/src/fintech-seed.ts
git commit -m "feat: agent — fintech seed, conflict:accepted file overwrite, blast radius display"
```

---

## Phase 4: Dashboard

### Task 9: Dashboard types + useConflictSessions hook

**Files:**
- Modify: `packages/dashboard/src/types.ts`
- Create: `packages/dashboard/src/hooks/useConflictSessions.ts`

- [ ] **Step 1: Add ConflictSession types to dashboard types.ts**

Append to `packages/dashboard/src/types.ts`:

```typescript
export type ConflictType =
  | 'signature_drift'
  | 'ghost_call'
  | 'auth_bypass'
  | 'type_violation'
  | 'blast_cascade'

export interface ConflictSession {
  id:                string
  entityName:        string
  devAId:            string
  devBId:            string
  devABody:          string
  devASig:           string
  devBBody:          string
  devBSig:           string
  status:            'open' | 'resolving' | 'resolved'
  detectedAt:        string
  blastRadius:       number
  securitySensitive: boolean
  conflictType:      ConflictType
  resolvedBy?:       string
  resolutionType?:   'accepted_a' | 'accepted_b' | 'manual_merge'
}

export interface BlastUpdateEvent {
  sessionId:      string
  blastRadius:    number
  newStaleEntity: string
  devId:          string
}

export interface ConflictResolvedEvent {
  sessionId:      string
  entityName:     string
  resolutionType: 'accepted_a' | 'accepted_b' | 'manual_merge'
  resolvedBy:     string
}
```

Also add `conflictSessionId?: string` to the `GraphNode` interface:

```typescript
export interface GraphNode {
  id:                string
  name:              string
  kind:              EntityKind
  devId:             string
  signature:         string
  file:              string
  severity:          Severity
  locked:            boolean
  dependentsCount:   number
  conflictSessionId?: string   // ← add this
  /* D3 simulation fields */
  x?: number; y?: number; vx?: number; vy?: number; fx?: number | null; fy?: number | null
}
```

- [ ] **Step 2: Create useConflictSessions.ts**

Create `packages/dashboard/src/hooks/useConflictSessions.ts`:

```typescript
import { useEffect, useState } from 'react'
import type { Socket } from 'socket.io-client'
import type { ConflictSession, BlastUpdateEvent, ConflictResolvedEvent } from '../types'

interface SessionOpenedPayload {
  sessionId: string; entityName: string
  devAId: string; devBId: string
  devASig: string; devBSig: string
  devABody: string; devBBody: string
  blastRadius: number; securitySensitive: boolean
  conflictType: ConflictSession['conflictType']
}

export function useConflictSessions(socket: Socket | null) {
  const [sessions, setSessions] = useState<Map<string, ConflictSession>>(new Map())

  useEffect(() => {
    if (!socket) return

    const onOpened = (data: SessionOpenedPayload) => {
      setSessions(prev => {
        const next = new Map(prev)
        next.set(data.sessionId, {
          id:                data.sessionId,
          entityName:        data.entityName,
          devAId:            data.devAId,
          devBId:            data.devBId,
          devABody:          data.devABody,
          devASig:           data.devASig,
          devBBody:          data.devBBody,
          devBSig:           data.devBSig,
          status:            'open',
          detectedAt:        new Date().toISOString(),
          blastRadius:       data.blastRadius,
          securitySensitive: data.securitySensitive,
          conflictType:      data.conflictType,
        })
        return next
      })
    }

    const onBlastUpdate = (data: BlastUpdateEvent) => {
      setSessions(prev => {
        const next    = new Map(prev)
        const session = next.get(data.sessionId)
        if (session) next.set(data.sessionId, { ...session, blastRadius: data.blastRadius })
        return next
      })
    }

    const onResolving = ({ sessionId, resolvedBy }: { sessionId: string; resolvedBy: string }) => {
      setSessions(prev => {
        const next    = new Map(prev)
        const session = next.get(sessionId)
        if (session) next.set(sessionId, { ...session, status: 'resolving', resolvedBy })
        return next
      })
    }

    const onResolved = (data: ConflictResolvedEvent) => {
      setSessions(prev => {
        const next = new Map(prev)
        next.delete(data.sessionId)
        return next
      })
    }

    socket.on('conflict:session:opened',    onOpened)
    socket.on('conflict:blast:update',      onBlastUpdate)
    socket.on('conflict:session:resolving', onResolving)
    socket.on('conflict:resolved',          onResolved)

    return () => {
      socket.off('conflict:session:opened',    onOpened)
      socket.off('conflict:blast:update',      onBlastUpdate)
      socket.off('conflict:session:resolving', onResolving)
      socket.off('conflict:resolved',          onResolved)
    }
  }, [socket])

  /** Find open session for a given entity name */
  function getSessionForEntity(entityName: string): ConflictSession | undefined {
    return [...sessions.values()].find(s => s.entityName === entityName && s.status !== 'resolved')
  }

  /** Damage stats per dev for display in DevPanel */
  function getDamageStats(devId: string): { openConflicts: number; totalBlastRadius: number } {
    let openConflicts = 0
    let totalBlastRadius = 0
    for (const s of sessions.values()) {
      if (s.devBId === devId && s.status !== 'resolved') {
        openConflicts++
        totalBlastRadius += s.blastRadius
      }
    }
    return { openConflicts, totalBlastRadius }
  }

  return { sessions, getSessionForEntity, getDamageStats }
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npm run build -w packages/dashboard
```

Expected: no type errors

- [ ] **Step 4: Commit**

```bash
git add packages/dashboard/src/types.ts packages/dashboard/src/hooks/useConflictSessions.ts
git commit -m "feat: dashboard — ConflictSession types, useConflictSessions hook"
```

---

### Task 10: Graph — dev clustering + conflict node click

**Files:**
- Modify: `packages/dashboard/src/components/Graph.tsx`

- [ ] **Step 1: Add onNodeClick prop and dev clustering forces**

Make the following targeted changes to `packages/dashboard/src/components/Graph.tsx`:

**1. Update the Props interface:**
```typescript
interface Props {
  nodes:       GraphNode[]
  links:       GraphLink[]
  onNodeClick?: (entityName: string) => void
}
```

**2. Update function signature:**
```typescript
export function Graph({ nodes, links, onNodeClick }: Props) {
```

**3. In the "Build SVG once" useEffect, add two clustering forces to the simulation (after the existing `.force('collide', ...)` line):**
```typescript
    sim
      .force('link',    d3.forceLink<GraphNode, GraphLink>().id(d => d.id).distance(125).strength(0.3))
      .force('charge',  d3.forceManyBody<GraphNode>().strength(-360))
      .force('center',  d3.forceCenter(width / 2, height / 2))
      .force('collide', d3.forceCollide<GraphNode>().radius(d => nodeR(d) + 22))
      .force('cluster-x', d3.forceX<GraphNode>((_d) => {
        // devs cluster left/right; conflict nodes stay center
        return width / 2
      }).strength(0))  // placeholder — updated per-tick below
```

Actually the cleanest approach for dev clustering is a weak forceX per node. Replace the simulation setup in the "Build SVG once" useEffect with:

```typescript
    const sim = d3.forceSimulation<GraphNode, GraphLink>()
      .force('link',      d3.forceLink<GraphNode, GraphLink>().id(d => d.id).distance(125).strength(0.3))
      .force('charge',    d3.forceManyBody<GraphNode>().strength(-360))
      .force('center',    d3.forceCenter(width / 2, height / 2))
      .force('collide',   d3.forceCollide<GraphNode>().radius(d => nodeR(d) + 22))
      .force('cluster-x', d3.forceX<GraphNode>(d => {
        if (d.severity === 'critical') return width / 2
        const devIds = ['devA', 'devB']
        const idx    = devIds.indexOf(d.devId)
        if (idx === -1) return width / 2
        return idx === 0 ? width * 0.35 : width * 0.65
      }).strength(0.06))
      .force('cluster-y', d3.forceY<GraphNode>(height / 2).strength(0.03))
```

**4. Add click handler to nodes. In the `enter` block, after the `.on('mouseleave', ...)` handler, add:**
```typescript
    enter
      .on('click', (_e, d) => {
        if (onNodeClick) onNodeClick(d.name)
      })
```

**5. Update node cursor for conflict nodes. In the `all` section (after `all.select<SVGCircleElement>('.dev-ring')`), update the body cursor:**
```typescript
    all
      .style('cursor', d => d.conflictSessionId ? 'pointer' : 'grab')
```

**6. Add conflict ring pulse for nodes with open sessions. After `all.select<SVGCircleElement>('.body')...` block, add:**
```typescript
    /* Pulse ring for nodes with open conflict session */
    all.select<SVGCircleElement>('.dev-ring')
      .attr('r',            d => nodeR(d) + 5)
      .attr('stroke',       d => d.conflictSessionId ? '#fc5c5c' : devColor(d.devId))
      .attr('opacity',      d => d.conflictSessionId ? 0.9 : d.severity === 'critical' ? 0.7 : 0.35)
      .attr('stroke-width', d => d.conflictSessionId ? 2 : 1.5)
```

Also update the `enter.append('circle').attr('class', 'dev-ring')` body to not set stroke (it's set in the `all` block above).

- [ ] **Step 2: Update useGraph to set conflictSessionId on nodes**

In `packages/dashboard/src/hooks/useGraph.ts`, update `onEntityUpdated` to accept and pass through `conflictSessionId`. Since this comes from the `conflict:session:opened` event rather than `entity:updated`, we handle it in a separate handler.

Add a new event handler inside the useEffect (after onClientDisconnected):

```typescript
    const onSessionOpened = (data: { sessionId: string; entityName: string }) => {
      setNodes(prev => prev.map(n =>
        n.name === data.entityName ? { ...n, conflictSessionId: data.sessionId } : n,
      ))
    }

    const onConflictResolvedForGraph = (data: { entityName: string }) => {
      setNodes(prev => prev.map(n =>
        n.name === data.entityName ? { ...n, conflictSessionId: undefined, severity: 'info' } : n,
      ))
    }
```

And register/deregister them:
```typescript
    socket.on('conflict:session:opened', onSessionOpened)
    socket.on('conflict:resolved',       onConflictResolvedForGraph)
    // ...in cleanup:
    socket.off('conflict:session:opened', onSessionOpened)
    socket.off('conflict:resolved',       onConflictResolvedForGraph)
```

- [ ] **Step 3: Build dashboard to verify no type errors**

```bash
npm run build -w packages/dashboard
```

- [ ] **Step 4: Commit**

```bash
git add packages/dashboard/src/components/Graph.tsx \
        packages/dashboard/src/hooks/useGraph.ts
git commit -m "feat: graph — dev clustering forces, conflict node click, session pulse ring"
```

---

### Task 11: DevPanel damage counter

**Files:**
- Modify: `packages/dashboard/src/components/DevPanel.tsx`

- [ ] **Step 1: Read current DevPanel.tsx to understand its structure**

Read `packages/dashboard/src/components/DevPanel.tsx` fully before editing.

- [ ] **Step 2: Add damage stats props and display**

Update the Props interface to accept a damage stats function, and render the counter for each dev:

The DevPanel currently receives `devStatuses: Map<string, DevStatus>`. Add `getDamageStats: (devId: string) => { openConflicts: number; totalBlastRadius: number }` to props.

For each dev card, add below the existing entity list:

```typescript
const damage = getDamageStats(status.devId)
// Render only if there's damage:
{(damage.openConflicts > 0 || damage.totalBlastRadius > 0) && (
  <div style={{
    marginTop: 6, padding: '5px 8px',
    background: 'rgba(252,92,92,0.07)',
    border: '1px solid rgba(252,92,92,0.18)',
    borderRadius: 4,
    fontFamily: 'var(--font-mono)',
  }}>
    <div style={{ fontSize: 9, color: 'var(--color-text-3)', letterSpacing: '0.08em', marginBottom: 4 }}>
      DUMB MODE DAMAGE
    </div>
    <div style={{ display: 'flex', gap: 10 }}>
      <span style={{ fontSize: 10, color: '#fc5c5c' }}>
        {damage.openConflicts} conflict{damage.openConflicts !== 1 ? 's' : ''}
      </span>
      <span style={{ fontSize: 10, color: '#fd8c5b' }}>
        Δ{damage.totalBlastRadius} downstream
      </span>
    </div>
  </div>
)}
```

- [ ] **Step 3: Build and verify**

```bash
npm run build -w packages/dashboard
```

- [ ] **Step 4: Commit**

```bash
git add packages/dashboard/src/components/DevPanel.tsx
git commit -m "feat: dev panel — dumb mode damage counter (open conflicts, blast radius)"
```

---

### Task 12: ConflictMergeEditor + App.tsx wiring

**Files:**
- Create: `packages/dashboard/src/components/ConflictMergeEditor.tsx`
- Modify: `packages/dashboard/src/components/ConflictFeed.tsx`
- Modify: `packages/dashboard/src/App.tsx`

- [ ] **Step 1: Create ConflictMergeEditor.tsx**

Create `packages/dashboard/src/components/ConflictMergeEditor.tsx`:

```typescript
import { useState } from 'react'
import type { ConflictSession } from '../types'
import { devColor } from '../utils/devColor'

const SERVER = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3000'

interface Props {
  session:  ConflictSession
  onClose:  () => void
  onResolved: (sessionId: string) => void
}

const CONFLICT_TYPE_LABELS: Record<string, string> = {
  auth_bypass:     '🔒 AUTH BYPASS',
  type_violation:  '⚠ TYPE VIOLATION',
  ghost_call:      '💀 GHOST CALL',
  signature_drift: 'SIG DRIFT',
  blast_cascade:   '💥 BLAST CASCADE',
}

export function ConflictMergeEditor({ session, onClose, onResolved }: Props) {
  const [mergedBody, setMergedBody] = useState(session.devABody)
  const [mergedSig,  setMergedSig]  = useState(session.devASig)
  const [submitting, setSubmitting] = useState(false)
  const [error,      setError]      = useState<string | null>(null)

  const colorA = devColor(session.devAId)
  const colorB = devColor(session.devBId)
  const typeLabel = CONFLICT_TYPE_LABELS[session.conflictType] ?? session.conflictType

  async function submit(type: 'accepted_a' | 'accepted_b' | 'manual_merge', body: string, sig: string) {
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`${SERVER}/v1/conflicts/sessions/${session.id}/resolve`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ type, mergedBody: body, mergedSig: sig, resolvedBy: 'dashboard' }),
      })
      if (!res.ok) {
        const data = await res.json() as { error?: string }
        throw new Error(data.error ?? 'Server error')
      }
      onResolved(session.id)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to resolve')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    /* Overlay */
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 50,
        background: 'rgba(6,10,17,0.88)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backdropFilter: 'blur(4px)',
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        width: 'min(95vw, 1100px)', maxHeight: '90vh',
        display: 'flex', flexDirection: 'column',
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border-hi)',
        borderTop: `2px solid #fc5c5c`,
        borderRadius: 8,
        overflow: 'hidden',
        boxShadow: '0 24px 80px rgba(0,0,0,0.7)',
      }}>
        {/* Header */}
        <div style={{
          padding: '12px 18px', borderBottom: '1px solid var(--color-border)',
          display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
        }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 600, color: '#fc5c5c' }}>
            ⚡ CONFLICT
          </span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 600, color: 'var(--color-text)' }}>
            {session.entityName}
          </span>
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 10, padding: '2px 7px',
            borderRadius: 3, background: 'rgba(252,92,92,0.1)',
            color: '#fc5c5c', border: '1px solid rgba(252,92,92,0.2)',
          }}>
            {typeLabel}
          </span>
          {session.securitySensitive && (
            <span style={{
              fontFamily: 'var(--font-mono)', fontSize: 10, padding: '2px 7px',
              borderRadius: 3, background: 'rgba(252,92,92,0.15)',
              color: '#fc5c5c', border: '1px solid rgba(252,92,92,0.3)',
            }}>
              🔒 AUTH SENSITIVE
            </span>
          )}
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-text-3)', marginLeft: 'auto' }}>
            blast radius: {session.blastRadius} downstream
          </span>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none', color: 'var(--color-text-3)',
              cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: '0 4px',
            }}
          >×</button>
        </div>

        {/* 3-panel body */}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>
          {/* Left: devA */}
          <Panel
            title={session.devAId}
            subtitle="current owner"
            color={colorA}
            sig={session.devASig}
            body={session.devABody}
            actionLabel="Accept A →"
            actionColor={colorA}
            onAction={() => submit('accepted_a', session.devABody, session.devASig)}
            disabled={submitting}
          />

          {/* Center: merged */}
          <div style={{
            flex: 1, display: 'flex', flexDirection: 'column',
            borderLeft: '1px solid var(--color-border)',
            borderRight: '1px solid var(--color-border)',
          }}>
            <div style={{
              padding: '8px 12px', borderBottom: '1px solid var(--color-border)',
              fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-text-2)',
              letterSpacing: '0.08em', flexShrink: 0,
            }}>
              MERGED RESULT
              <span style={{ color: 'var(--color-text-3)', marginLeft: 8 }}>editable</span>
            </div>
            <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
              <input
                value={mergedSig}
                onChange={e => setMergedSig(e.target.value)}
                placeholder="Merged signature"
                style={{
                  width: '100%', background: 'var(--color-base)',
                  border: '1px solid var(--color-border)', borderRadius: 4,
                  padding: '6px 8px', fontFamily: 'var(--font-mono)', fontSize: 11,
                  color: 'var(--color-text)', outline: 'none', boxSizing: 'border-box',
                }}
              />
            </div>
            <textarea
              value={mergedBody}
              onChange={e => setMergedBody(e.target.value)}
              style={{
                flex: 1, resize: 'none', background: 'var(--color-base)',
                border: 'none', outline: 'none', padding: '12px',
                fontFamily: 'var(--font-mono)', fontSize: 11,
                color: 'var(--color-text)', lineHeight: 1.6,
              }}
            />
            <div style={{
              padding: '10px 12px', borderTop: '1px solid var(--color-border)',
              display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
            }}>
              {error && (
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#fc5c5c', flex: 1 }}>
                  {error}
                </span>
              )}
              <button
                onClick={() => submit('manual_merge', mergedBody, mergedSig)}
                disabled={submitting || !mergedBody.trim()}
                style={{
                  marginLeft: 'auto',
                  background: 'rgba(91,112,135,0.15)', border: '1px solid var(--color-border)',
                  borderRadius: 5, padding: '7px 16px',
                  fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600,
                  color: 'var(--color-text)', cursor: submitting ? 'wait' : 'pointer',
                  opacity: submitting ? 0.6 : 1,
                }}
              >
                {submitting ? 'Resolving…' : 'Accept Merged Version'}
              </button>
            </div>
          </div>

          {/* Right: devB */}
          <Panel
            title={session.devBId}
            subtitle="incoming change"
            color={colorB}
            sig={session.devBSig}
            body={session.devBBody}
            actionLabel="← Accept B"
            actionColor={colorB}
            onAction={() => submit('accepted_b', session.devBBody, session.devBSig)}
            disabled={submitting}
            reverse
          />
        </div>
      </div>
    </div>
  )
}

interface PanelProps {
  title:       string
  subtitle:    string
  color:       string
  sig:         string
  body:        string
  actionLabel: string
  actionColor: string
  onAction:    () => void
  disabled:    boolean
  reverse?:    boolean
}

function Panel({ title, subtitle, color, sig, body, actionLabel, actionColor, onAction, disabled, reverse }: PanelProps) {
  return (
    <div style={{ width: 300, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{
        padding: '8px 12px', borderBottom: '1px solid var(--color-border)',
        borderTop: `2px solid ${color}`, flexShrink: 0,
      }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600, color }}>
          {title}
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--color-text-3)', marginTop: 2 }}>
          {subtitle}
        </div>
      </div>
      <div style={{
        padding: '6px 10px', borderBottom: '1px solid var(--color-border)',
        fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-text-2)',
        background: 'var(--color-base)', flexShrink: 0, wordBreak: 'break-all',
      }}>
        {sig || '(no signature)'}
      </div>
      <pre style={{
        flex: 1, overflow: 'auto', margin: 0,
        padding: '12px', fontFamily: 'var(--font-mono)', fontSize: 10,
        color: 'var(--color-text-2)', lineHeight: 1.55, background: 'transparent',
        whiteSpace: 'pre-wrap', wordBreak: 'break-all',
      }}>
        {body || '(no body)'}
      </pre>
      <div style={{
        padding: '10px 12px', borderTop: '1px solid var(--color-border)',
        display: 'flex', justifyContent: reverse ? 'flex-start' : 'flex-end', flexShrink: 0,
      }}>
        <button
          onClick={onAction}
          disabled={disabled}
          style={{
            background: `${actionColor}18`, border: `1px solid ${actionColor}40`,
            borderRadius: 5, padding: '7px 14px',
            fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600,
            color: actionColor, cursor: disabled ? 'wait' : 'pointer',
            opacity: disabled ? 0.5 : 1,
          }}
        >
          {actionLabel}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Add "Resolve" button to ConflictFeed**

In `packages/dashboard/src/components/ConflictFeed.tsx`, update `Props` and `LogEntry` to accept an `onResolve` callback:

```typescript
// Update Props:
interface Props {
  conflicts:  ConflictEvent[]
  onResolve?: (entityName: string) => void
}

// Update ConflictFeed:
export function ConflictFeed({ conflicts, onResolve }: Props) {
  // ... existing code
  // Pass onResolve to LogEntry:
  conflicts.map(c => <LogEntry key={c.id} conflict={c} onResolve={onResolve} />)
}

// Update LogEntry props + add resolve button inside the dev row div:
function LogEntry({ conflict, onResolve }: { conflict: ConflictEvent; onResolve?: (entityName: string) => void }) {
  // ... existing code
  // Add below the DiffBlock:
  {onResolve && (
    <div style={{ padding: '0 10px 8px', display: 'flex', justifyContent: 'flex-end' }}>
      <button
        onClick={() => onResolve(conflict.entityName)}
        style={{
          background: 'rgba(252,92,92,0.1)', border: '1px solid rgba(252,92,92,0.25)',
          borderRadius: 4, padding: '4px 10px',
          fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600,
          color: '#fc5c5c', cursor: 'pointer',
        }}
      >
        Resolve →
      </button>
    </div>
  )}
}
```

- [ ] **Step 3: Wire everything in App.tsx**

Replace `packages/dashboard/src/App.tsx` with:

```typescript
import { useState } from 'react'
import { useSocket } from './hooks/useSocket'
import { useGraph } from './hooks/useGraph'
import { useConflictSessions } from './hooks/useConflictSessions'
import { TopBar } from './components/TopBar'
import { DevPanel } from './components/DevPanel'
import { Graph } from './components/Graph'
import { ConflictFeed } from './components/ConflictFeed'
import { BottomBar } from './components/BottomBar'
import { ConflictMergeEditor } from './components/ConflictMergeEditor'
import type { AgentMode, ConflictSession } from './types'

export function App() {
  const { socket, connected }                    = useSocket()
  const { nodes, links, conflicts, devStatuses } = useGraph(socket)
  const { sessions, getSessionForEntity, getDamageStats } = useConflictSessions(socket)
  const [mode, setMode]                          = useState<AgentMode>('smart')
  const [activeSession, setActiveSession]        = useState<ConflictSession | null>(null)

  const devCount = [...devStatuses.values()].filter(d => d.connected).length

  function toggleMode() {
    const next: AgentMode = mode === 'smart' ? 'dumb' : 'smart'
    setMode(next)
    socket?.emit('mode:change', { mode: next })
  }

  function handleNodeClick(entityName: string) {
    const session = getSessionForEntity(entityName)
    if (session) setActiveSession(session)
  }

  function handleResolveFromFeed(entityName: string) {
    const session = getSessionForEntity(entityName)
    if (session) setActiveSession(session)
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ background: 'var(--color-base)' }}>
      <TopBar
        connected={connected}
        entityCount={nodes.length}
        conflictCount={conflicts.length}
        devCount={devCount}
        mode={mode}
        onModeToggle={toggleMode}
      />
      <div className="flex flex-1 overflow-hidden">
        <DevPanel devStatuses={devStatuses} getDamageStats={getDamageStats} />
        <Graph nodes={nodes} links={links} onNodeClick={handleNodeClick} />
        <ConflictFeed conflicts={conflicts} onResolve={handleResolveFromFeed} />
      </div>
      <BottomBar
        connected={connected}
        entityCount={nodes.length}
        conflictCount={conflicts.length}
        conflicts={conflicts}
      />
      {activeSession && (
        <ConflictMergeEditor
          session={activeSession}
          onClose={() => setActiveSession(null)}
          onResolved={() => setActiveSession(null)}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 4: Build dashboard — confirm no type errors**

```bash
npm run build -w packages/dashboard
```

Expected: clean build

- [ ] **Step 5: Start full stack and run through the demo manually**

```bash
# Terminal 1
npm run dev -w packages/server

# Terminal 2
npm run dev -w packages/dashboard

# Terminal 3 — devA agent
npx ts-node packages/agent/src/interactive.ts devA

# Terminal 4 — devB agent
npx ts-node packages/agent/src/interactive.ts devB
```

**Demo flow to verify:**
1. In devA terminal: type `add scope validation to validateToken`
2. Observe: entity:diff flows to server, graph shows `validateToken` node with cyan ring
3. In devB terminal (dumb mode enabled in dashboard): type `add transfer logic that calls validateToken`
4. Observe:
   - Dashboard graph: `validateToken` node turns red + pulsing ring
   - Conflict feed: new CRIT entry with "Resolve →" button
   - DevB agent terminal: shows `⚡ CONFLICT` banner + security sensitive flag
5. Click `validateToken` node in graph OR click "Resolve →" in feed
6. Observe: ConflictMergeEditor opens with devA code left, devB code right, editable center
7. Click "Accept A →"
8. Observe:
   - Modal closes
   - Graph node goes green
   - Both agent terminals show `✓ RESOLVED: validateToken`

- [ ] **Step 6: Commit**

```bash
git add packages/dashboard/src/components/ConflictMergeEditor.tsx \
        packages/dashboard/src/components/ConflictFeed.tsx \
        packages/dashboard/src/App.tsx
git commit -m "feat: dashboard — ConflictMergeEditor 3-panel, resolve button in feed, App wiring"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| Conflict session state machine (open→resolving→resolved) | Task 2, 5 |
| Both bodies stored in Redis + Postgres | Task 2 |
| `conflict_type`, `blast_radius`, `security_sensitive` in Postgres | Task 1 |
| `stale_writes` table | Task 1 |
| Auth path detection (auth_bypass) | Task 3 |
| Blast radius increments on stale write | Task 2, 5 |
| `conflict:session:opened` socket event | Task 5 |
| `conflict:blast:update` socket event | Task 5 |
| `conflict:accepted` push to both agents | Task 5 |
| REST GET/POST /conflicts/sessions/:id | Task 6 |
| Fintech 10-file seed | Task 7 |
| Agent overwrites file on conflict:accepted | Task 8 |
| Agent shows blast radius + stale write counter | Task 8 |
| Dev-clustered graph (A left, B right) | Task 10 |
| Conflict node clickable → merge editor | Task 10, 12 |
| DevPanel damage counter | Task 11 |
| 3-panel merge editor (Accept A / B / manual) | Task 12 |
| Editor opens from conflict feed "Resolve →" | Task 12 |
| Resolution pushes to both agents → file overwrite | Task 5, 8 |

All spec requirements covered. No TBDs or placeholders.
