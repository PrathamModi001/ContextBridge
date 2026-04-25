# ContextBridge

Real-time shared context layer for AI coding agents. When two developers (or two AI agents) edit the same TypeScript codebase simultaneously, ContextBridge tracks live entity state, detects signature conflicts the moment they happen, and pushes alerts to every affected consumer—before anyone generates broken code.

---

## The Problem

AI coding assistants (Cursor, Copilot, Claude Code) snapshot the codebase at query time. In a shared codebase, Dev A's AI doesn't know Dev B changed `validateUser(id)` to `validateUser(id, permissions[])` five minutes ago. The result: generated code with stale callers, broken builds, and conflicts that surface at review time instead of write time.

## How It Works

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
             │
      ┌──────┴──────┐
   REST API      WebSocket
GET /entities   push conflict
POST /validate  alerts to all
             │
        [dashboard]
     D3 force graph · conflict feed
     developer status · mode toggle
             │
     [agent-A]     [agent-B]
     Groq LLM      Groq LLM
     writes code   queries server first
```

Each client watches its workspace with `chokidar`, parses changed `.ts` files incrementally with `tree-sitter`, and streams semantic diffs (`entity:diff`) to the server over Socket.IO. The server writes entity state to Redis, classifies any breaking change, and pushes alerts to every connected client whose watched files call the changed entity.

Any AI agent—Claude, OpenAI, Qwen—can call `GET /v1/context/snapshot?format=markdown` before starting work and get the full live codebase context in a single LLM-ready block.

---

## Packages

| Package | Responsibility |
|---------|----------------|
| `server` | Express + Socket.IO. Entity registry, dep graph, conflict detection, REST API, audit trail. |
| `client` | Chokidar + Tree-sitter. Streams semantic diffs to server, receives push alerts. |
| `agent` | Groq LLM wrapper. Smart mode fetches live context before generating; dumb mode doesn't. |
| `dashboard` | React + Vite + D3. Real-time entity graph, conflict feed, developer status. |
| `demo` | Seeds workspaces, orchestrates all processes. |

---

## Quickstart

### Prerequisites

- Node 20+
- Docker (for Redis + Postgres)

### 1. Start infrastructure

```bash
docker-compose up -d
```

### 2. Configure environment

```bash
cp .env.example .env
# Add your GROQ_API_KEY — get one free at console.groq.com
```

### 3. Install dependencies

```bash
npm install
```

### 4. Run the full demo

```bash
npm run demo:start
```

This seeds two workspaces, starts the server, two file watchers, and the dashboard (at `http://localhost:5173`).

---

## Demo

With the demo running, open two more terminals:

**Terminal 1 — Dev A refactors a function:**
```bash
npm run agent -- --dev=devA --task="Refactor validateUser in auth.ts to accept a second parameter: permissions as string array."
```

**Terminal 2 — Dev B adds callers (~3 seconds later):**
```bash
npm run agent -- --dev=devB --task="Add 3 service functions in user.service.ts that each call validateUser with a userId string."
```

**SMART mode (default):** Agent B fetches the live context snapshot first, sees the new signature, generates correct code. No conflict fires.

**DUMB mode (toggle in dashboard):** Agent B skips the context check, generates code with the old signature, writes it — a conflict fires, the graph edge turns red, and the conflict feed updates in real time.

---

## REST API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/v1/health` | Health check |
| `GET` | `/v1/entities/:name` | Live entity state from Redis |
| `GET` | `/v1/entities/:name/impact` | Transitive impact count |
| `GET` | `/v1/context/snapshot` | Full context snapshot (`?format=markdown&entity=X&depth=2`) |
| `POST` | `/v1/context/validate` | Validate a code snippet against live signatures |
| `GET` | `/v1/audit/entities/:name` | Entity change history |
| `GET` | `/v1/audit/devs/:devId` | Dev activity history |
| `GET` | `/v1/audit/recent` | Recent changes across all entities |
| `GET` | `/v1/conflicts` | Conflict history from Postgres |

### Context snapshot example

```bash
# What any agent sees before writing
curl http://localhost:3000/v1/context/snapshot?format=markdown

# Focused: everything related to validateUser (2 hops)
curl "http://localhost:3000/v1/context/snapshot?entity=validateUser&depth=2&format=markdown"
```

The markdown output can be pasted directly into any LLM interface—making the shared context story immediately demonstrable without integration work.

### Validate usage example

```bash
curl -X POST http://localhost:3000/v1/context/validate \
  -H "Content-Type: application/json" \
  -d '{"code": "const r = await validateUser(userId)"}'
```

```json
{
  "conflicts": [{
    "entity": "validateUser",
    "yourSignature": "validateUser(id: string)",
    "liveSignature": "validateUser(id: string, permissions: string[])",
    "severity": "warning",
    "devId": "devA",
    "correctedCall": "validateUser(userId, permissions)"
  }]
}
```

---

## WebSocket Events

| Direction | Event | Payload |
|-----------|-------|---------|
| client → server | `entity:diff` | `{ entities: [{ name, kind, oldSig, newSig, body, file, line }] }` |
| client → server | `heartbeat` | `{ devId }` |
| server → client | `conflict:detected` | `{ entityName, severity, devAId, devBId, impactCount, oldSig, newSig }` |
| server → client | `entity:updated` | `{ name, devId, signature, locked, severity }` |
| server → client | `client:connected` | `{ devId }` |
| server → client | `client:disconnected` | `{ devId }` |

---

## Conflict Severity

| Severity | Condition |
|----------|-----------|
| `critical` | Parameter removed, return type changed, required param type changed |
| `warning` | New required parameter added — all existing callers break |
| `info` | New optional parameter added — existing callers still work |

---

## Tests

```bash
# All unit + integration tests
npm test

# E2E (requires Redis + Postgres via docker-compose)
npm run test:e2e
```

---

## Tech Stack

| Layer | Choice |
|-------|--------|
| Language | TypeScript (strict) throughout |
| Server | Node 20, Express, Socket.IO |
| Parser | tree-sitter + tree-sitter-typescript |
| File watcher | chokidar |
| Hot state | Redis (ioredis) |
| Audit trail | PostgreSQL (node-postgres) |
| LLM | Groq — llama-3.1-8b-instant |
| Dashboard | React 18 + Vite + D3 v7 |
| Monorepo | npm workspaces + concurrently |

---

## Environment Variables

```env
PORT=3000
NODE_ENV=development
REDIS_URL=redis://localhost:6379
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=contextbridge
POSTGRES_USER=postgres
POSTGRES_PASSWORD=contextbridge
GROQ_API_KEY=your_key_here
VITE_SERVER_URL=http://localhost:3000
```
