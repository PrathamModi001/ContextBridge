# ContextBridge — Design Spec
_Date: 2026-04-20_

---

## Problem

AI coding assistants (Cursor, Copilot) snapshot the codebase at query time. In a team, Developer B's AI generates code against stale state — it doesn't know Developer A changed `validateUser(id)` to `validateUser(id, permissions[])` 10 minutes ago. ContextBridge is the layer that keeps the AI's picture of reality current.

---

## Scope

**Demo-grade.** Not production-deployed. Goal: a compelling, interactive demo showing real conflict detection with two AI agents writing TypeScript simultaneously. Buildable in ~1 week.

**TypeScript-only** parsing for this version.

---

## Architecture

Five packages in one monorepo, started with a single command.

```
workspace-devA/          workspace-devB/
     │                        │
  [client-A]             [client-B]
chokidar + Tree-sitter   chokidar + Tree-sitter
     │    Socket.IO            │
     └──────────┬──────────────┘
           [server]
        entity registry (Redis)
        dependency graph (Redis)
        history / audit (Postgres)
        TTL / heartbeat
             │
      ┌──────┴──────┐
   REST API      WebSocket
GET /entity     push conflict
POST /validate  alerts to clients
             │
        [dashboard]
     React + Vite + D3
     force graph · conflict feed
     developer status · mode toggle
             │
     [agent-A]     [agent-B]
     Groq LLM      Groq LLM
     writes code   queries server first
     to devA ws    then writes to devB ws
```

### Packages

| Package     | Responsibility |
|-------------|----------------|
| `server`    | Express + Socket.IO. Entity registry, dependency graph, REST API, conflict detection, push notifications. |
| `client`    | Chokidar file watcher + Tree-sitter parser. Streams semantic diffs to server. Receives push conflict alerts. |
| `agent`     | Groq LLM wrapper. Given a task + devId, generates TypeScript and writes to its workspace. |
| `dashboard` | React + Vite + D3 force graph. Real-time entity graph, conflict feed, developer status, mode toggle. |
| `demo`      | Orchestrator. Seeds workspaces, starts all processes. Documents the two manual terminal prompts. |

---

## Data Model

### Redis (hot layer — live state)

```
entity:{name}              Hash  { signature, body, devId, file, line, kind, updatedAt }
entity:{name}:dependents   Set   of entity names that call/use this entity
entity:{name}:clients      Set   of devIds whose watched files call this entity (for push)
lock:{name}                Key   TTL=15s — set when entity is actively being edited
client:{devId}:heartbeat   Key   TTL=30s — expires = client offline, states cleared
client:{devId}:entities    Set   of entity names owned by this devId (for cleanup)
```

When a client disconnects, its `heartbeat` TTL expires. The server subscribes to Redis keyspace notifications (`KEg` — generic commands on expired keys). On `client:{devId}:heartbeat` expiry, the server reads `client:{devId}:entities`, deletes each corresponding `entity:{name}` key owned by that devId, and removes the devId from all `entity:{name}:clients` sets. The last Postgres-persisted version becomes the source of truth.

### PostgreSQL (cold layer — history/audit)

```sql
entities (
  id          UUID PRIMARY KEY,
  name        TEXT NOT NULL,
  dev_id      TEXT NOT NULL,
  kind        TEXT NOT NULL,        -- 'function' | 'type' | 'interface' | 'class'
  signature   TEXT NOT NULL,
  body        TEXT,                 -- full source text of the entity
  file        TEXT NOT NULL,
  line        INT,
  created_at  TIMESTAMPTZ DEFAULT now()
)

entity_changes (
  id            UUID PRIMARY KEY,
  entity_name   TEXT NOT NULL,
  dev_id        TEXT NOT NULL,
  old_signature TEXT,
  new_signature TEXT NOT NULL,
  severity      TEXT NOT NULL,      -- 'critical' | 'warning' | 'info'
  changed_at    TIMESTAMPTZ DEFAULT now()
)

conflicts (
  id           UUID PRIMARY KEY,
  entity_name  TEXT NOT NULL,
  dev_a_id     TEXT NOT NULL,
  dev_b_id     TEXT,
  description  TEXT NOT NULL,
  severity     TEXT NOT NULL,
  impact_count INT DEFAULT 0,       -- number of dependents affected
  detected_at  TIMESTAMPTZ DEFAULT now(),
  resolved     BOOLEAN DEFAULT false
)
```

All entity changes write to Redis immediately (synchronous), Postgres async (fire-and-forget with retry).

---

## Data Flow

```
1. Developer edits file in their workspace
2. chokidar fires onChange(filePath, content)
3. Tree-sitter incremental parse (previous tree + changed byte range → <10ms)
4. Extract changed entities: { name, kind, oldSig, newSig }
5. Client sends diff over Socket.IO to server
6. Server:
   a. Writes new state to Redis HSET entity:{name}
   b. Sets lock:{name} with 15s TTL
   c. Updates entity:{name}:dependents set
   d. Classifies severity (see below)
   e. Traverses dep graph → finds all affected consumers
   f. Async-writes to Postgres entity_changes
   g. If conflict: inserts to Postgres conflicts, broadcasts via Socket.IO
7. Push notification fires to ALL connected clients whose watched files
   call the changed entity — they receive { entityName, newSig, severity }
8. Dashboard receives same conflict event → updates graph + conflict feed
```

---

## Breaking Change Severity

Determined by comparing old and new signature AST nodes:

| Severity   | Condition |
|------------|-----------|
| `critical` | Parameter removed, return type changed incompatibly, export removed, type union member removed |
| `warning`  | New required parameter added (all existing callers break) |
| `info`     | New optional parameter added (existing callers still work) |

Severity is included in every push notification, REST response, and Postgres row.

---

## REST API

### `GET /entity/:name/live-state`

Returns the current live state of an entity from Redis.

**Response:**
```json
{
  "name": "validateUser",
  "kind": "function",
  "signature": "validateUser(id: string, permissions: string[]): Promise<User>",
  "devId": "devA",
  "file": "auth.ts",
  "line": 14,
  "updatedAt": "2026-04-20T12:34:07Z",
  "locked": true,
  "hasPendingConflict": true,
  "impactCount": 5
}
```

### `POST /validate-usage`

Takes a code snippet, extracts all function/type references using Tree-sitter, checks each against Redis live state.

**Request:**
```json
{ "code": "const result = await validateUser(userId);" }
```

**Response:**
```json
{
  "conflicts": [
    {
      "entity": "validateUser",
      "yourSignature": "validateUser(id: string)",
      "liveSignature": "validateUser(id: string, permissions: string[])",
      "severity": "warning",
      "devId": "devA",
      "correctedCall": "validateUser(userId, permissions)"
    }
  ]
}
```

The `correctedCall` field lets AI agents self-correct without a second round-trip.

### WebSocket Events (Socket.IO)

| Event (server → client)   | Payload |
|---------------------------|---------|
| `entity:updated`          | `{ name, devId, signature, locked }` |
| `conflict:detected`       | `{ entityName, severity, devAId, devBId, impactCount, oldSig, newSig }` |
| `client:connected`        | `{ devId, workspacePath }` |
| `client:disconnected`     | `{ devId }` |

| Event (client → server)   | Payload |
|---------------------------|---------|
| `entity:diff`             | `{ devId, entities: [{ name, kind, oldSig, newSig, body, file, line }] }` |
| `heartbeat`               | `{ devId }` |

> `body` is the full source text of the entity (function implementation, type definition, class body). Stored in Redis alongside the signature. Required for the Shared Context API.

---

## Dashboard

**Stack:** React + Vite + D3 v7 + Socket.IO client.

**Aesthetic:** Dark Matter — ultra-dark bg (#07070f), electric green (#00e87a) for healthy state, hard red (#ff2d55) for conflicts, amber (#ff9f0a) for warnings. Oxanium font for UI, JetBrains Mono for all code values. Dot-grid background.

**Layout (3-column):**

```
┌─ TOP BAR ─────────────────────────────────────────────┐
│ ● ContextBridge LIVE    [DUMB ○──● SMART]   stats     │
├─ LEFT (230px) ──┬─ CENTER ──────────┬─ RIGHT (272px) ─┤
│ Developers      │                   │ Conflict Feed   │
│  ● devA editing │  D3 force graph   │ [CRITICAL] ...  │
│  ● devB conflict│  entities = nodes │ [WARNING]  ...  │
│                 │  deps = edges     │ [INFO]     ...  │
│ Entities        │  conflict = red   │                 │
│  validateUser 🔴│  animated dashes  │                 │
│  AuthService ●  │                   │                 │
│  ...            │                   │                 │
├─ BOTTOM BAR ──────────────────────────────────────────┤
│ Redis ● Postgres ● WS: 2 clients    parse:8ms  v1.0.0 │
└───────────────────────────────────────────────────────┘
```

**Graph behavior:**
- Node size = number of dependents (impact radius)
- Node color: green (clean) / amber (active/locked) / red (conflict)
- Conflict edges: animated dashed red lines with arrow markers
- Nodes have a glow filter; conflict nodes have an outer pulse ring
- Draggable nodes (D3 drag)
- Hover tooltip: entity name, kind, deps, status, owning dev

**Conflict feed:**
- Newest conflict at top, slides in with a flash animation
- Left border color = severity color
- Shows: severity badge, timestamp, entity name, old→new sig diff, affected devs, impact count pill
- Auto-updates via Socket.IO

**Mode toggle:**
- Sliding pill: DUMB (red, pill left) ↔ SMART (green, pill right)
- Passed to agent runner to decide whether Agent B queries `/entity/:name/live-state` before writing

---

## Demo Flow

### Setup
```bash
npm run demo:start
# Starts: server, Redis, Postgres, dashboard, client-A, client-B
# Seeds workspace-devA/ and workspace-devB/ with identical baseline TS files:
#   auth.ts      — validateUser(id: string): Promise<User>
#   user.service.ts — three placeholder functions
```

### Trigger Dev A (Terminal 1)
```bash
npm run agent -- \
  --dev=devA \
  --task="Refactor validateUser in auth.ts to accept a second parameter: permissions as string array. Update the function signature and body."
```

Agent A → Groq → generates new `auth.ts` → writes to `workspace-devA/` → client-A parses → streams diff → server updates Redis → sets lock → broadcasts `entity:updated` + push notification to client-B.

### Trigger Dev B (Terminal 2, ~3s later)
```bash
npm run agent -- \
  --dev=devB \
  --task="Add 3 new service functions in user.service.ts that each call validateUser with a userId string."
```

**SMART mode (default):**
Agent B → calls `GET /entity/validateUser/live-state` → sees new signature + `locked:true` → calls `POST /validate-usage` with draft snippet → receives `correctedCall` → Groq generates correct code → writes to `workspace-devB/`. No conflict fires.

**DUMB mode (toggle in dashboard):**
Agent B skips ContextBridge query → generates code with old signature → writes to `workspace-devB/` → client-B parses → server detects conflict → `conflict:detected` fires → dashboard graph edge turns red, conflict feed updates, push notification fires to client-B.

---

## Shared Context API

**The second selling point.** Any AI agent — Claude, OpenAI, Qwen — calls one endpoint before starting work and gets the full live codebase context. Switch agents mid-session: the new agent calls the same endpoint, gets identical state. No re-explaining. No stale snapshots.

The dependency graph already exists. This is a new read path that serializes it into LLM-consumable form.

### `GET /context/snapshot?format=json|markdown&entity=&depth=2`

- `format=json` — machine-readable, for programmatic agent use
- `format=markdown` — drop directly into any LLM system prompt
- `entity` (optional) — focal entity name; returns subgraph instead of full graph
- `depth` (optional, default 2) — hop count from focal entity

**JSON response:**
```json
{
  "snapshotAt": "2026-04-20T12:34:07Z",
  "activeDevs": [
    { "devId": "devA", "file": "auth.ts", "status": "editing" },
    { "devId": "devB", "file": "user.service.ts", "status": "conflict" }
  ],
  "entities": [
    {
      "name": "validateUser",
      "kind": "function",
      "signature": "validateUser(id: string, permissions: string[]): Promise<User>",
      "body": "async function validateUser(id: string, permissions: string[]) { ... }",
      "file": "auth.ts",
      "line": 14,
      "devId": "devA",
      "locked": true,
      "hasPendingConflict": true,
      "dependents": ["AuthService", "UserService", "loginUser"],
      "dependencies": ["Permission"]
    }
  ],
  "conflicts": [
    {
      "entity": "validateUser",
      "severity": "critical",
      "devAId": "devA",
      "devBId": "devB",
      "oldSig": "validateUser(id: string)",
      "newSig": "validateUser(id: string, permissions: string[])",
      "impactCount": 5
    }
  ],
  "graph": {
    "edges": [
      { "from": "AuthService", "to": "validateUser" },
      { "from": "UserService", "to": "validateUser" }
    ]
  }
}
```

**Markdown response** (paste directly into any LLM system prompt):
```markdown
# ContextBridge Snapshot — 2026-04-20T12:34:07Z

## Active Developers
- devA — editing auth.ts (validateUser 🔴 LOCKED)
- devB — watching user.service.ts ⚡ conflict detected

## Live Entities

### `validateUser` (function) — auth.ts:14 [devA · LOCKED · CRITICAL CONFLICT]
**Signature:** `validateUser(id: string, permissions: string[]): Promise<User>`
**Dependents:** AuthService, UserService, loginUser (5 total affected)
**Body:**
\`\`\`typescript
async function validateUser(id: string, permissions: string[]): Promise<User> {
  // implementation
}
\`\`\`

### `AuthService` (class) — auth.ts:1 [devA · ACTIVE]
...

## Active Conflicts
- [CRITICAL] validateUser — devA changed signature, devB has 3 stale callers

## Dependency Graph
validateUser  ←  AuthService, UserService, loginUser
AuthService   ←  loginUser
UserService   ←  getUser, updateUser
```

### Focused Context (subgraph query)

```bash
GET /context/snapshot?entity=validateUser&depth=2&format=markdown
```

Returns only validateUser + everything within 2 hops. Used when an agent is working on a specific area — smaller context window footprint, higher relevance.

### Agent Integration

Every agent call prepends the context snapshot to the Groq system prompt:

```
[SYSTEM]
You are a TypeScript developer working on a shared codebase.
Here is the current live state of the codebase from ContextBridge:

{/context/snapshot?format=markdown response}

Your task: {user task}
Always use the signatures above — they are the live truth.
```

This is the mechanism by which switching agents preserves context. Claude → OpenAI → Qwen: each gets the same markdown block, same live state.

### Demo Extension

A third terminal shows the context handoff:

```bash
# See what any agent sees before it writes
curl http://localhost:3000/context/snapshot?format=markdown

# Focused: everything related to validateUser
curl "http://localhost:3000/context/snapshot?entity=validateUser&depth=2&format=markdown"
```

The markdown output can be pasted directly into ChatGPT, Claude.ai, or any other LLM interface — making the "AI-agnostic shared context" story immediately demonstrable without any integration work.

---

## Entity Lock + Push Notifications

**Lock:** When client-A streams a diff for entity X, server sets `lock:{X}` (Redis, 15s TTL). Dashboard shows `LOCKED` badge on that entity. Other clients see the lock in `/entity/:name/live-state` response before writing.

**Push:** Server maintains a reverse index: entity → which clients have files that call it. On any entity change, server pushes `entity:updated` to all affected clients via their Socket.IO room (`room:{devId}`). Clients log the warning to their terminal.

---

## Staleness / TTL Policy

- Client sends `heartbeat` event every 10s.
- Server sets `client:{devId}:heartbeat` key with 30s TTL on each heartbeat.
- On TTL expiry (client offline): cleanup job removes all `entity:*` keys owned by that devId; last Postgres-persisted version becomes the source of truth.
- Conflict states: never auto-expire. Must be explicitly resolved (future feature).

---

## Conflict Resolution Policy

- **Recency wins:** most recently modified version is "live."
- **Simultaneous edits:** both marked as conflicting; server flags `hasPendingConflict: true` on both entity states. Neither is authoritative until one client backs off.

---

## Tech Stack

| Layer        | Choice |
|--------------|--------|
| Language     | TypeScript throughout |
| Server       | Node.js, Express, Socket.IO |
| Parser       | tree-sitter + tree-sitter-typescript |
| File watcher | chokidar |
| Hot DB       | Redis (ioredis) |
| Cold DB      | PostgreSQL (pg / node-postgres) |
| LLM          | Groq API — llama-3.1-8b-instant (free, ~500 tok/s) |
| Dashboard    | React 18 + Vite + D3 v7 + Socket.IO client |
| Monorepo     | npm workspaces + concurrently |
| Runtime      | Node 20 LTS |

---

## What ContextBridge Is NOT

- Not a merge conflict resolver (Git handles committed conflicts)
- Not a replacement for Copilot/Cursor (it's infrastructure they sit on)
- Not a code review tool (no quality judgement, only state accuracy)
- Not multi-language in this version (TypeScript only)
