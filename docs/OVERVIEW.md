# ContextBridge — System Overview

## What It Does

Multi-developer AI coding sessions break because each AI agent only sees the local snapshot of the codebase. Dev A's agent generates code using `validateUser(id)` while Dev B already changed it to `validateUser(id, permissions[])`. Code compiles locally. Fails at runtime. ContextBridge fixes this.

**Core idea:** One shared, live entity registry. Every developer's file watcher writes to it in real time. Every AI agent reads from it before generating code.

---

## The 5 Packages

```
┌─────────────────────────────────────────────────────────┐
│                    developer machines                    │
│                                                         │
│  workspace-devA/          workspace-devB/               │
│  ├── auth.ts              ├── auth.ts                   │
│  └── users.ts             └── users.ts                  │
│       │ chokidar               │ chokidar                │
│       ▼                       ▼                         │
│  ┌─────────┐            ┌─────────┐                     │
│  │ CLIENT  │            │ CLIENT  │  watches files,     │
│  │ pkg     │            │ pkg     │  parses AST,        │
│  └────┬────┘            └────┬────┘  diffs entities     │
│       │ entity:diff (WS)     │                          │
└───────┼─────────────────────┼──────────────────────────┘
        │                     │
        ▼                     ▼
┌───────────────────────────────────────────────────────┐
│                  SERVER  :3000                        │
│                                                       │
│  ┌──────────┐  ┌─────────┐  ┌───────────────────┐    │
│  │  Redis   │  │Postgres │  │  Socket.IO broker  │    │
│  │ entity   │  │conflict │  │  REST API          │    │
│  │ registry │  │sessions │  │  BFS graph         │    │
│  └──────────┘  └─────────┘  └───────────────────┘    │
└────────────────────────┬──────────────────────────────┘
                         │ WebSocket events
              ┌──────────┴──────────┐
              │                     │
        ┌─────▼─────┐        ┌──────▼──────┐
        │  AGENT    │        │  DASHBOARD  │
        │  pkg      │        │  pkg        │
        │  Groq LLM │        │  React + D3 │
        └───────────┘        └─────────────┘
```

| Package | Role | Key Tech |
|---------|------|----------|
| `client` | Watch files → parse AST → diff entities → stream to server | chokidar, tree-sitter |
| `server` | Entity registry, conflict detection, graph, REST + WebSocket | Express, Redis, Postgres, Socket.IO |
| `agent` | Fetch live context → generate code → validate signatures | Groq SDK |
| `dashboard` | Real-time visualization of entities, graph, conflicts | React 18, D3 v7, Socket.IO |
| `demo` | Seed two workspaces with realistic TypeScript files | Node scripts |

---

## End-to-End Data Flow

### Normal Edit (no conflict)

```
1. Dev saves auth.ts
2. chokidar fires → client reads file
3. TSParser extracts entities (functions, types, interfaces, classes)
4. differ compares prev vs new → produces EntityDiff[]
5. Socket.IO sends  entity:diff  to server
6. Server stores entity in Redis (hset entity:{name})
7. Server updates dependency graph (sadd entity:{x}:dependents)
8. Server emits  entity:updated  → dashboard re-renders node
```

### Conflict Detected

```
1. Dev B's entity:diff arrives for "validateUser"
2. Server checks Redis: lock:{validateUser} = devA  ← already owned
3. detectConflict() returns { devAId, severity, impactCount }
4. detectConflictType() classifies: signature_drift | auth_bypass | type_violation | ghost_call | blast_cascade
5. createSession() writes ConflictSession to Redis + Postgres
6. Server emits:
   - entity:conflict  → both devA and devB rooms (their agents)
   - conflict:session:opened  → dashboard
   - conflict:detected  → dashboard feed
7. BFS runs from "validateUser" → counts transitive dependents
8. Severity = critical if blast radius ≥ 10, or isSecuritySensitive()
```

### Conflict Resolution

```
1. Dashboard user clicks Accept A / Accept B / Manual Merge
2. POST /v1/conflicts/sessions/:id/resolve
3. Route: validates status = 'open', calls markResolving() → status = 'resolving'
4. resolveSession() validates status = 'resolving', writes resolution to Redis + Postgres
5. Server emits conflict:accepted → both agent rooms (with file path + accepted body)
6. Agent writes accepted code back to workspace file
7. Server emits conflict:resolved + entity:updated → dashboard
```

### Stale Write (conflict already open)

```
1. Dev C edits same entity while conflict session is open
2. Server detects open session ID on entity:meta
3. appendStaleWrite() increments blastRadius in Redis + logs to Postgres
4. Server emits conflict:blast:update → dashboard and dev C's room
```

---

## Entity Types

The Tree-sitter parser extracts 4 structural kinds from TypeScript files:

| Kind | Example | What's tracked |
|------|---------|----------------|
| `function` | `function doAuth(id: string): User` | name, params, return type, full body |
| `function` (arrow) | `const doAuth = (id: string): User =>` | same, via variable_declarator |
| `type` | `type UserId = string \| number` | full text normalized |
| `interface` | `interface AuthPayload { ... }` | full text normalized |
| `class` | `class AuthService extends Base` | header only (excludes body) |

Conflict types (5 categories):

| Conflict Type | Meaning |
|---------------|---------|
| `signature_drift` | Param count or types changed |
| `auth_bypass` | Entity name contains auth/permission keywords |
| `type_violation` | Return type changed |
| `ghost_call` | Entity called that no longer exists |
| `blast_cascade` | Stale write while conflict is open |

---

## REST API

Base URL: `http://localhost:3000/v1`

| Method | Path | Returns |
|--------|------|---------|
| GET | `/health` | `{ ok: true }` |
| GET | `/entities/:name` | Entity state from Redis |
| GET | `/entities/:name/impact` | Blast radius count (BFS) |
| GET | `/entities/:name/dependents` | Who calls this entity |
| GET | `/entities/:name/clients` | Dev IDs using this entity |
| GET | `/conflicts` | Last 100 conflicts (Redis list) |
| GET | `/conflicts/sessions` | All non-resolved sessions |
| GET | `/conflicts/sessions/:id` | Single session |
| POST | `/conflicts/sessions/:id/resolve` | Accept A/B or manual merge |
| GET | `/context/snapshot` | Full Markdown context block (LLM input) |
| POST | `/context/validate` | Check code against live signatures |
| POST | `/context/flush` | Clear all entity state |
| GET | `/audit/entities/:name` | Change history for an entity |
| GET | `/audit/devs/:devId` | All changes by a developer |
| GET | `/audit/recent` | Latest N changes |

---

## WebSocket Events

### Client → Server

| Event | Payload | Purpose |
|-------|---------|---------|
| `entity:diff` | `EntityDiffPayload[]` | Stream parsed file changes |
| `heartbeat` | — | Renew entity lock TTLs (30s) |
| `join` | `{ room }` | Join `room:dashboard` or `room:{devId}` |

### Server → Client

| Event | Who receives | Purpose |
|-------|-------------|---------|
| `entity:updated` | dashboard | Node re-renders with new sig/owner |
| `entity:conflict` | devA + devB rooms | Alert agents to conflict |
| `conflict:session:opened` | dashboard | Show merge editor |
| `conflict:session:resolving` | dashboard | Show "resolving…" state |
| `conflict:resolved` | dashboard | Close merge editor |
| `conflict:accepted` | devA + devB rooms | Write accepted code to file |
| `conflict:blast:update` | dashboard + dev room | Increment blast radius counter |
| `conflict:detected` | dashboard | Add to conflict feed |
| `graph:links` | dashboard | Draw D3 edges |
| `client:connected` | all | Show dev as online |
| `client:disconnected` | all | Show dev as offline |
| `client:heartbeat` | dashboard | Pulse indicator |

---

## Key Design Decisions

| Decision | Why |
|----------|-----|
| **Tree-sitter over regex** | Regex breaks on nested generics, multi-line types, decorators. Tree-sitter produces a full CST — handles all valid TypeScript. |
| **Redis for entity state** | Sub-millisecond reads for entity lookups, built-in TTL for lock expiry, SET data structures for graph edges, pub/sub for keyspace events. |
| **Postgres for conflicts** | Conflict sessions need ACID guarantees and durable audit trail. Redis is the hot path; Postgres is the record of truth. |
| **Socket.IO over polling** | Push model — no latency between file save and dashboard update. Rooms allow targeted delivery (devA gets only its conflicts). |
| **Monorepo** | Shared `types/index.ts` across all packages. `EntityDiffPayload` defined once, used by client and server without duplication. |
| **Full AST re-parse per save** | Incremental tree-sitter parsing requires explicit `tree.edit()` calls with byte offsets. Wrong offsets = wrong AST. Full parse on each save is correct and fast enough for typical file sizes. |
