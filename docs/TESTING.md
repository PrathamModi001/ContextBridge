# ContextBridge — Testing Guide

How to test every layer of the application. For each test, the **Expected Output** section shows exactly what a passing run looks like. Anything that deviates is a failure.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Unit Tests](#2-unit-tests)
3. [E2E Tests](#3-e2e-tests)
4. [REST API — Manual Tests](#4-rest-api--manual-tests)
5. [WebSocket / Real-Time Flow](#5-websocket--real-time-flow)
6. [Dashboard UI Checklist](#6-dashboard-ui-checklist)
7. [Input Validation Tests](#7-input-validation-tests)
8. [Conflict Detection Flow](#8-conflict-detection-flow)
9. [Agent Mode Test](#9-agent-mode-test)
10. [Pass / Fail Quick Reference](#10-pass--fail-quick-reference)

---

## 1. Prerequisites

### Required software
| Software | Minimum version | Check |
|---|---|---|
| Node.js | 18 | `node --version` |
| npm | 9 | `npm --version` |
| Docker Desktop | any recent | `docker --version` |
| Docker Compose | v2 | `docker compose version` |

### Start infrastructure (Redis + Postgres)

```bash
# From repo root
docker compose up -d
```

**Expected output:**
```
[+] Running 3/3
 ✔ Network contextbridge_default  Created
 ✔ Container contextbridge-redis-1     Started
 ✔ Container contextbridge-postgres-1  Started
```

**Verify services are healthy:**
```bash
docker compose ps
```
Both services must show `running` (not `exited`). If Postgres shows `exited`, check logs:
```bash
docker compose logs postgres
```

> **Port note**: Postgres runs on **5433** (not 5432) to avoid conflicts with any locally-installed Postgres instance. Redis runs on **6379**.

---

## 2. Unit Tests

Runs all Jest test suites inside `packages/server`.

### Run command
```bash
npm test
```

### Expected output (passing)
```
> jest --runInBand --forceExit

 PASS  src/__tests__/services/conflict.service.test.ts
 PASS  src/__tests__/services/graph.service.test.ts
 PASS  src/__tests__/services/context.service.test.ts
 PASS  src/__tests__/services/audit.service.test.ts
 PASS  src/__tests__/middlewares/validateRequest.test.ts
 PASS  src/__tests__/routes/entity.routes.test.ts
 PASS  src/__tests__/routes/conflict.routes.test.ts
 PASS  src/__tests__/routes/context.routes.test.ts
 PASS  src/__tests__/routes/audit.routes.test.ts

Test Suites: 9 passed, 9 total
Tests:       247 passed, 247 total
Snapshots:   0 total
Time:        ~8s
```

### What to look for
- `Tests: 247 passed, 247 total` — all green, nothing skipped
- No `FAIL` lines
- No `● Test suite failed to run` (indicates a module import error, not a test failure)

### Failure example
```
 FAIL  src/__tests__/services/conflict.service.test.ts
  ● severity is critical when impactCount >= 10

    expect(received).toBe(expected)

    Expected: "critical"
    Received: "warning"
```
→ The severity threshold logic in `conflict.service.ts` is broken.

---

## 3. E2E Tests

Spins up a real server, connects three Socket.IO clients (devA, devB, dashboard), and exercises the full stack against live Redis and Postgres.

### Prerequisites
Docker services **must** be running (see §1). The test uses:
- Redis at `localhost:6379`
- Postgres at `localhost:5433`

### Run command
```bash
npm run test:e2e
```

### Expected output (passing — all 12 tests)
```
> jest --config jest.e2e.config.js

  Health
    ✓ GET /v1/health returns 200 (45 ms)

  Entity flow
    ✓ entity:diff from devA writes state to Redis (312 ms)
    ✓ GET /v1/entities/:name returns 404 for unknown entity (18 ms)

  Conflict detection
    ✓ emits conflict:detected when devB modifies devA-owned entity (423 ms)

  Context snapshot
    ✓ GET /v1/context/snapshot returns JSON with entities (55 ms)
    ✓ GET /v1/context/snapshot?format=markdown returns text/markdown (38 ms)

  Validate usage
    ✓ POST /v1/context/validate returns 400 for empty code (22 ms)
    ✓ POST /v1/context/validate detects stale caller (78 ms)

  Audit trail
    ✓ GET /v1/audit/entities/:name returns history (34 ms)
    ✓ GET /v1/audit/recent returns recent changes (28 ms)

  Input validation
    ✓ entity name longer than 200 chars returns 400 (15 ms)
    ✓ code longer than 20k chars returns 400 on validate (12 ms)

Test Suites: 1 passed, 1 total
Tests:       12 passed, 12 total
Time:        ~6s
```

### Common E2E failures and fixes

| Error | Cause | Fix |
|---|---|---|
| `Missing required env var: REDIS_URL` | env.setup.js not running | Check `jest.e2e.config.js` has `setupFiles` entry |
| `connect ECONNREFUSED 127.0.0.1:6379` | Redis not running | `docker compose up -d` |
| `connect ECONNREFUSED 127.0.0.1:5433` | Postgres not running | `docker compose up -d` |
| `password authentication failed for user "contextbridge"` | Wrong Postgres credentials | Recreate volume: `docker compose down -v && docker compose up -d` |
| `conflict:detected` test: `conflictEvents.length` is 0 | Socket.IO room join timing | Increase the 100ms sleep in `beforeAll` |

---

## 4. REST API — Manual Tests

Start the server first:
```bash
npm run dev -w packages/server
# Server starts at http://localhost:3000
```

All endpoints are under `/v1`. Use the curl commands below and compare against expected responses.

---

### 4.1 Health check

```bash
curl -s http://localhost:3000/v1/health | jq
```

**Expected (200):**
```json
{
  "status": "ok",
  "ts": 1714000000000
}
```
`ts` is a Unix millisecond timestamp — any recent number is correct.

---

### 4.2 Entity — get by name

```bash
# First seed an entity via the demo client, or use the E2E test which writes one.
# Assuming 'validateUser' exists:
curl -s http://localhost:3000/v1/entities/validateUser | jq
```

**Expected (200):**
```json
{
  "name": "validateUser",
  "kind": "function",
  "signature": "validateUser(id: string): Promise<User>",
  "devId": "devA",
  "file": "auth.ts",
  "line": 12,
  "updatedAt": "2024-04-25T10:00:00.000Z"
}
```

**Expected when entity does not exist (404):**
```json
{
  "error": "Entity 'validateUser' not found"
}
```

---

### 4.3 Entity — impact count

```bash
curl -s http://localhost:3000/v1/entities/validateUser/impact | jq
```

**Expected (200):**
```json
{
  "entityName": "validateUser",
  "impactCount": 3
}
```
`impactCount` is the number of other entities that depend on this one. 0 means no dependents.

---

### 4.4 Entity — dependents list

```bash
curl -s http://localhost:3000/v1/entities/validateUser/dependents | jq
```

**Expected (200):**
```json
{
  "entityName": "validateUser",
  "dependents": ["loginHandler", "authMiddleware"]
}
```
Empty array `[]` means no dependents tracked yet.

---

### 4.5 Entity — who is editing it

```bash
curl -s http://localhost:3000/v1/entities/validateUser/clients | jq
```

**Expected (200):**
```json
{
  "entityName": "validateUser",
  "clients": ["devA"]
}
```

---

### 4.6 Conflicts — recent list

```bash
curl -s http://localhost:3000/v1/conflicts | jq
```

**Expected (200) — empty state:**
```json
[]
```

**Expected (200) — after conflicts have fired:**
```json
[
  {
    "id": "conflict-1714000000000",
    "entityName": "validateUser",
    "devAId": "devA",
    "devBId": "devB",
    "oldSig": "validateUser(id: string): Promise<User>",
    "newSig": "validateUser(id: string, role: string): Promise<User>",
    "severity": "warning",
    "impactCount": 1,
    "timestamp": "2024-04-25T10:00:00.000Z"
  }
]
```

Severity rules:
- `"info"` — `impactCount` is 0
- `"warning"` — `impactCount` is 1–9
- `"critical"` — `impactCount` is 10 or more

---

### 4.7 Context snapshot — JSON

```bash
curl -s http://localhost:3000/v1/context/snapshot | jq
```

**Expected (200):**
```json
{
  "snapshotAt": "2024-04-25T10:00:00.000Z",
  "entities": [
    {
      "name": "validateUser",
      "kind": "function",
      "signature": "validateUser(id: string): Promise<User>",
      "devId": "devA",
      "file": "auth.ts",
      "line": 12
    }
  ],
  "totalEntities": 1
}
```

---

### 4.8 Context snapshot — Markdown

```bash
curl -s http://localhost:3000/v1/context/snapshot?format=markdown
```

**Expected (200, Content-Type: text/markdown):**
```markdown
# ContextBridge Snapshot

**Generated**: 2024-04-25T10:00:00.000Z
**Total entities**: 1

## validateUser
- **Kind**: function
- **Developer**: devA
- **File**: auth.ts:12
- **Signature**: `validateUser(id: string): Promise<User>`
```

---

### 4.9 Context snapshot — filtered by entity + depth

```bash
curl -s "http://localhost:3000/v1/context/snapshot?entity=validateUser&depth=2" | jq
```

**Expected (200):** Same shape as §4.7 but only includes `validateUser` and entities up to 2 dependency hops away.

---

### 4.10 Validate code usage

```bash
curl -s -X POST http://localhost:3000/v1/context/validate \
  -H "Content-Type: application/json" \
  -d '{"code": "const result = await validateUser(userId)"}' | jq
```

**Expected (200) — no conflicts:**
```json
{
  "conflicts": []
}
```

**Expected (200) — stale call detected (signature changed):**
```json
{
  "conflicts": [
    {
      "entity": "validateUser",
      "currentSig": "validateUser(id: string, role: string): Promise<User>",
      "calledWith": "validateUser(userId)",
      "message": "Signature mismatch: argument count changed"
    }
  ]
}
```

---

### 4.11 Audit — entity history

```bash
curl -s http://localhost:3000/v1/audit/entities/validateUser | jq
```

**Expected (200):**
```json
[
  {
    "id": 1,
    "entityName": "validateUser",
    "devId": "devA",
    "changeType": "update",
    "oldSignature": null,
    "newSignature": "validateUser(id: string): Promise<User>",
    "changedAt": "2024-04-25T10:00:00.000Z"
  }
]
```

---

### 4.12 Audit — developer history

```bash
curl -s http://localhost:3000/v1/audit/devs/devA | jq
```

**Expected (200):** Array of change records for every entity devA has ever touched.

---

### 4.13 Audit — recent changes

```bash
curl -s http://localhost:3000/v1/audit/recent | jq
```

**Expected (200):** Array of the 50 most recent changes across all developers, newest first.

---

### 4.14 Client — entities for a developer

```bash
curl -s http://localhost:3000/v1/clients/devA/entities | jq
```

**Expected (200):**
```json
{
  "devId": "devA",
  "entities": ["validateUser", "loginHandler"]
}
```

---

## 5. WebSocket / Real-Time Flow

This tests the live, end-to-end collaborative scenario: two clients editing entities, the dashboard observing.

### Start the full demo stack

```bash
npm run demo:start
```

This runs four processes concurrently:
1. **server** — Express + Socket.IO at `:3000`
2. **client-a** — devA client, watches `packages/demo/workspace-devA/`
3. **client-b** — devB client, watches `packages/demo/workspace-devB/`
4. **dashboard** — Vite dev server at `:5173`

### Expected console output (first 10 seconds)

```
[server]  ContextBridge server running on port 3000
[server]  Redis connected
[server]  Postgres connected
[client-a] Connected as devA
[client-a] Watching workspace: packages/demo/workspace-devA
[client-b] Connected as devB
[client-b] Watching workspace: packages/demo/workspace-devB
[dashboard] VITE v5.x ready in 800 ms
[dashboard]   ➜  Local: http://localhost:5173/
```

### Open the dashboard

Navigate to `http://localhost:5173` in a browser.

**Expected initial state:**
- TopBar: `WS` dot is **cyan** (connected), entity count and conflict count are 0, mode is `SMART`
- DevPanel (left): shows `devA` and `devB` with **online** status, cyan dots
- Graph (center): shows "AWAITING SIGNAL" empty state with blinking cursor
- ConflictFeed (right): shows "No conflicts / System nominal"
- BottomBar: `WS` dot cyan, ticker reads `SYSTEM NOMINAL · NO ACTIVE ENTITIES`

### After seeding fires (within ~3 seconds)

```
[client-a] entity:diff  validateUser (function)
[client-a] entity:diff  loginHandler (function)
[client-b] entity:diff  getUserProfile (function)
[client-b] entity:diff  updateUserProfile (function)
```

**Expected dashboard state:**
- Graph shows nodes for each entity, connected by dependency edges
- Each node has a colored ring matching the dev's assigned color
- DevPanel shows entity counts next to each dev name
- BottomBar shows entity count in the ticker

---

## 6. Dashboard UI Checklist

Run `npm run demo:start` and open `http://localhost:5173`. Verify each item visually.

### TopBar
- [ ] Hex icon (nested hexagons) in amber on far left
- [ ] "CTX" in muted text + "BRIDGE" in amber
- [ ] `LIVE` badge with pulsing cyan dot — only visible when connected
- [ ] Entity count stat block (amber number, `ENTITIES` label)
- [ ] Conflict count stat block (amber number, `CONFLICTS` label)
- [ ] Dev count stat block (amber number, `DEVS` label)
- [ ] Mode toggle: `SMART` shows cyan pill; click to switch to `DUMB` (red pill)
- [ ] Amber glow line along the bottom edge of the bar

### DevPanel (left sidebar)
- [ ] Header reads `PRESENCE` and shows `2/2` online count in cyan
- [ ] Each dev has a colored square avatar (color is unique per dev ID)
- [ ] Avatar has a small status dot: cyan = online, orange = idle (>45s no heartbeat), grey = offline
- [ ] Dev name, entity count, status label (`online` / `idle` / `offline`)
- [ ] Activity bar: 8 segments, filled segments match entity count
- [ ] `EDITING` label shows last-touched entity name
- [ ] Footer reads `ContextBridge v1.0.0`

### Graph (center)
- [ ] Dark background with subtle crosshatch grid
- [ ] Nodes rendered as circles with:
  - Outer colored ring (dev ownership color)
  - Fill and stroke based on severity (none = dim, info = cyan, warn = orange, crit = red)
  - Greek letter glyph inside: `λ` function, `τ` type, `ι` interface, `κ` class
  - Entity name label below
- [ ] Edges (dependency links) drawn as semi-transparent lines between nodes
- [ ] Nodes draggable — dragging one repositions it; others continue force-simulation
- [ ] Hovering a node shows a tooltip with: entity name, dev owner (colored), signature, kind, file:line, impact count
- [ ] Empty state (no entities): nested hexagon SVG + `AWAITING SIGNAL` + blinking cursor

### ConflictFeed (right sidebar)
- [ ] Header reads `CONFLICT LOG`; red badge shows count when > 0
- [ ] Each conflict card has:
  - Left colored border matching severity (cyan info / orange warn / red critical)
  - `[CRIT]` / `[WARN]` / `[INFO]` badge
  - Entity name (truncated if long)
  - Timestamp (HH:MM:SS format)
  - Two DevChip components (avatar + truncated name) with arrow between them
  - Δ{n} orange badge when impactCount > 0
  - Collapsible diff block (click header row to toggle): `-` old sig in red, `+` new sig in green
- [ ] Clicking a card header collapses/expands the diff block
- [ ] Empty state: triangle SVG + "No conflicts" + "System nominal"

### BottomBar
- [ ] `WS` label with cyan dot when connected, grey dot when disconnected
- [ ] Center: `SYSTEM NOMINAL · MONITORING N ENTITIES` when no conflicts
- [ ] Center: scrolling ticker when conflicts exist, showing `[CRIT]` / `[WARN]` / `[INFO]` + entity + devA → devB
- [ ] Ticker loops continuously and scrolls left
- [ ] Fade gradients on left and right edges of ticker
- [ ] `CB·1.0` version label on far right

---

## 7. Input Validation Tests

All of these should return `400 Bad Request` with an error body. None should return 200 or 500.

```bash
# Entity name too long (>200 chars)
curl -s -o /dev/null -w "%{http_code}" \
  "http://localhost:3000/v1/entities/$(python3 -c 'print("a"*201)')"
# Expected: 400

# Entity name empty (route won't match, returns 404 — not a validation error)
curl -s -o /dev/null -w "%{http_code}" \
  http://localhost:3000/v1/entities/
# Expected: 404

# Validate with no body
curl -s -X POST http://localhost:3000/v1/context/validate \
  -H "Content-Type: application/json" \
  -d '{}' | jq
# Expected: 400 {"error": "code field is required..."}

# Validate with empty code string
curl -s -X POST http://localhost:3000/v1/context/validate \
  -H "Content-Type: application/json" \
  -d '{"code": ""}' | jq
# Expected: 400

# Validate with code too long (>20,000 chars) — PowerShell version:
# $body = '{"code":"' + ('x' * 20001) + '"}'
# Invoke-RestMethod -Method POST -Uri http://localhost:3000/v1/context/validate -Body $body -ContentType application/json
# Expected: 400

# Snapshot with invalid format
curl -s -o /dev/null -w "%{http_code}" \
  "http://localhost:3000/v1/context/snapshot?format=xml"
# Expected: 400

# Snapshot with depth out of range
curl -s -o /dev/null -w "%{http_code}" \
  "http://localhost:3000/v1/context/snapshot?depth=99"
# Expected: 400
```

**Expected 400 response shape:**
```json
{
  "error": "Validation failed",
  "details": [
    { "path": "body.code", "message": "String must contain at most 20000 character(s)" }
  ]
}
```

---

## 8. Conflict Detection Flow

Step-by-step walkthrough of the core feature. Best done with the full demo stack running (`npm run demo:start`).

You can also trigger this manually using a Socket.IO REPL (e.g., `wscat` or the browser console on `http://localhost:5173`).

### Step 1 — devA claims an entity

devA emits `entity:diff` with a new entity `authService`:

**In browser console (with the page open at localhost:5173):**
```javascript
// This simulates what the client SDK does
const s = io('http://localhost:3000', { auth: { devId: 'devA' } })
s.emit('entity:diff', [{
  name: 'authService',
  kind: 'function',
  oldSig: null,
  newSig: 'authService(token: string): boolean',
  body: 'function authService(token) { return verify(token) }',
  file: 'auth.ts',
  line: 5
}])
```

**Expected dashboard state:**
- New node `authService` appears in the Graph with devA's color ring
- DevPanel: devA's entity count increments, `EDITING authService` label appears
- BottomBar counter updates

### Step 2 — devB modifies the same entity

```javascript
const s2 = io('http://localhost:3000', { auth: { devId: 'devB' } })
s2.emit('entity:diff', [{
  name: 'authService',
  kind: 'function',
  oldSig: 'authService(token: string): boolean',
  newSig: 'authService(token: string, options: AuthOptions): boolean',
  body: 'function authService(token, options) { return verify(token, options) }',
  file: 'auth.ts',
  line: 5
}])
```

**Expected dashboard state within ~400ms:**
- ConflictFeed: new `[INFO]` or `[WARN]` card appears at the top for `authService`
  - devA chip → devB chip with arrow
  - Diff block: `− authService(token: string): boolean` (red) / `+ authService(token: string, options: AuthOptions): boolean` (green)
- BottomBar: ticker now scrolls showing this conflict
- TopBar: conflict count badge increments

### Step 3 — REST API confirms the conflict

```bash
curl -s http://localhost:3000/v1/conflicts | jq '.[0]'
```

**Expected:**
```json
{
  "id": "conflict-...",
  "entityName": "authService",
  "devAId": "devA",
  "devBId": "devB",
  "severity": "info",
  "impactCount": 0,
  "oldSig": "authService(token: string): boolean",
  "newSig": "authService(token: string, options: AuthOptions): boolean"
}
```

### Step 4 — Audit trail confirms the change

```bash
curl -s http://localhost:3000/v1/audit/entities/authService | jq
```

**Expected:** Array with at least two entries — the original create and the subsequent update.

---

## 9. Agent Mode Test

The agent reads the context snapshot and posts analysis back to the server. Requires a valid `GROQ_API_KEY` in your environment.

```bash
export GROQ_API_KEY=your_key_here
npm run agent
```

### Expected output

```
[agent] Starting ContextBridge agent (mode: smart)
[agent] Fetching context snapshot from http://localhost:3000/v1/context/snapshot
[agent] Snapshot received: 4 entities
[agent] Sending to Groq (llama-3.1-70b-versatile)...
[agent] Analysis complete. Broadcasting to dashboard.
```

**Expected dashboard state:** The TopBar mode indicator and any agent annotations the server broadcasts via Socket.IO.

If `GROQ_API_KEY` is missing or invalid, the agent exits immediately with:
```
[agent] Error: GROQ_API_KEY not set — exiting
```
This is expected behavior when the key is absent.

---

## 10. Pass / Fail Quick Reference

### Unit tests
| What you see | Verdict |
|---|---|
| `Tests: 247 passed, 247 total` | ✅ Pass |
| Any `FAIL` block or `Tests: X failed` | ❌ Fail |
| `Test suite failed to run` | ❌ Import/config error |

### E2E tests
| What you see | Verdict |
|---|---|
| `Tests: 12 passed, 12 total` | ✅ Pass |
| `connect ECONNREFUSED :6379` | ❌ Redis not running |
| `connect ECONNREFUSED :5433` | ❌ Postgres not running |
| `password authentication failed` | ❌ Wrong credentials / need `docker compose down -v` |
| `0 events received` in conflict test | ❌ Socket.IO room join timing issue |

### REST API
| Response | Verdict |
|---|---|
| HTTP 200 + expected JSON shape | ✅ Pass |
| HTTP 400 for invalid inputs | ✅ Pass (by design) |
| HTTP 500 or `{"error":"Internal server error"}` | ❌ Fail |
| HTTP 200 but missing required fields | ❌ Fail |

### Dashboard UI
| What you see | Verdict |
|---|---|
| WS dot is cyan | ✅ Connected |
| WS dot is grey | ❌ Not connected (check server is running on :3000) |
| Nodes appear when entities are emitted | ✅ Pass |
| Graph is blank after seeding | ❌ `entity:diff` socket handler or D3 rendering broken |
| Conflict cards appear after devB edits | ✅ Pass |
| No conflict card after step 2 of §8 | ❌ Conflict detection or Socket.IO emission broken |
| Ticker scrolls in BottomBar | ✅ Pass |
| Ticker frozen or overflowing | ❌ CSS animation (`ticker-scroll`) not applied |
