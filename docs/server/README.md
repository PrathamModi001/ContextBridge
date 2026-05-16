# server — Central Hub

**Single responsibility:** Receive entity diffs, maintain the live registry, detect conflicts, serve REST + WebSocket.

---

## File Map

```
packages/server/src/
├── index.ts                    ← entry point: HTTP server + Socket.IO init
├── app.ts                      ← Express app: middleware, routes, rate limiting
├── socket.ts                   ← all WebSocket logic (events, conflict pipeline, cleanup)
├── types/index.ts              ← shared types (EntityKind, ConflictSession, etc.)
│
├── config/
│   ├── env.ts                  ← env var parsing + validation
│   ├── redis.ts                ← lazy ioredis connection
│   └── postgres.ts             ← pg Pool + schema init on startup
│
├── logger/logger.ts            ← pino + per-module child loggers
│
├── middlewares/
│   ├── errorHandler.ts         ← global handler (ApiError, ZodError, SyntaxError)
│   └── validateRequest.ts      ← Zod schema middleware
│
├── routes/
│   ├── router.ts               ← mounts all sub-routers under /v1
│   ├── entity.routes.ts        ← GET /entities/:name and subpaths
│   ├── conflict.routes.ts      ← GET/POST /conflicts and /sessions
│   ├── context.routes.ts       ← GET /context/snapshot, POST /validate, POST /flush
│   ├── audit.routes.ts         ← GET /audit/entities, /devs, /recent
│   └── client.routes.ts        ← GET /clients (connected devs)
│
└── services/
    ├── entity/entity.service.ts          ← read/write entity state in Redis
    ├── conflict/
    │   ├── conflict.detector.ts          ← detectConflict, detectConflictType, isSecuritySensitive
    │   └── conflict.session.service.ts   ← session lifecycle (create → resolving → resolved)
    ├── graph/graph.service.ts            ← BFS blast radius, dependency graph edges
    ├── context/context.service.ts        ← Markdown snapshot builder, signature validator
    └── audit/audit.service.ts            ← Postgres query for change history
```

---

## Redis Data Model

```
entity:{name}               HASH   signature, body, devId, kind, file, line, updatedAt
entity:{name}:meta          HASH   conflictSessionId  (only present during open conflict)
entity:{name}:dependents    SET    entities that call this one  (reverse index)
entity:{name}:calls         SET    entities this one calls      (forward index)
entity:{name}:clients       SET    devIds that use this entity
client:{devId}:entities     SET    entities owned by this dev
client:{devId}:heartbeat    STRING TTL=30s  → expiry triggers automatic cleanup
lock:{name}                 STRING devId owning the write lock; TTL=300s
conflict:session:{id}       HASH   full ConflictSession fields
conflicts:recent            LIST   last 100 conflict JSON blobs (ltrim)
```

---

## Conflict Session State Machine

```
            createSession()
                  │
         ┌────────▼────────┐
         │      open       │  conflict detected, merge editor shown
         └────────┬────────┘
                  │ route: validates status='open'
                  │ markResolving(sessionId, resolvedBy)
         ┌────────▼────────┐
         │   resolving     │  merge in progress
         └────────┬────────┘
                  │ resolveSession() validates status='resolving'  ← bug fix
                  │ writes Redis + Postgres, emits conflict:accepted
         ┌────────▼────────┐
         │    resolved     │  terminal — no further transitions
         └─────────────────┘

  Stale write path (3rd dev edits while conflict is open):
    appendStaleWrite() → increments blastRadius in Redis, logs to Postgres stale_writes
    emits conflict:blast:update → dashboard + dev room
```

---

## BFS Blast Radius Algorithm

```
getImpactCount(entityName):
  visited = {}
  queue   = [entityName]

  while queue not empty:
    current = queue.shift()
    if current in visited → skip
    visited.add(current)
    for each dep in redis.smembers(entity:{current}:dependents):
      if dep not visited → queue.push(dep)

  return visited.size - 1   // exclude root

Complexity: O(V + E)  — V = entities, E = dependency edges
Cycle safe: visited set prevents infinite loops
```

---

## Conflict Detection Rules

| Condition | Result |
|-----------|--------|
| No lock on entity | Free — no conflict |
| Lock owner === incoming dev | Same dev — no conflict |
| Lock owned by different dev | **Conflict detected** |

**Conflict type classification:**

| Type | Trigger |
|------|---------|
| `auth_bypass` | Entity name matches auth/permission/token keywords |
| `type_violation` | Entity kind is `type` or `interface` |
| `signature_drift` | Param count changed |
| `ghost_call` | Anything else |
| `blast_cascade` | Stale write while session already open |

**Severity:**

| Blast radius | Security sensitive | Severity |
|---|---|---|
| — | yes | `critical` |
| ≥ 10 | — | `critical` |
| 1–9 | — | `warning` |
| 0 | — | `info` |

---

## Keyspace Expiry Cleanup

When `client:{devId}:heartbeat` expires (client disconnects silently):

```
Redis keyspace event: __keyevent@0__:expired
  → parse devId from key
  → smembers client:{devId}:entities
  → for each entity:
      if redis.hget(entity:{name}, devId) === devId → del entity:{name}
      srem entity:{name}:clients devId
  → del client:{devId}:entities
  → emit client:disconnected to all sockets
```

Prevents ghost locks from blocking other developers indefinitely.
