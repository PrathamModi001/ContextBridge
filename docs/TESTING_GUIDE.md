# ContextBridge — Manual Testing Guide

---

## Prerequisites

- Docker Desktop running
- Node.js 20+
- A Groq API key → https://console.groq.com

---

## 1. First-Time Setup

```bash
# 1. Copy env file
cp .env.example .env
```

Open `.env` and set:
```
GROQ_API_KEY=gsk_...your_key...

# Match docker-compose.yml (uses port 5433, user=contextbridge)
POSTGRES_HOST=localhost
POSTGRES_PORT=5433
POSTGRES_USER=contextbridge
POSTGRES_PASSWORD=contextbridge
POSTGRES_DB=contextbridge
```

```bash
# 2. Install dependencies
npm install
```

---

## 2. Start Infrastructure

```bash
# Start Redis + Postgres only (no server)
docker-compose up redis postgres -d
```

**Verify:**
```bash
docker ps
# should show: redis:7-alpine (0.0.0.0:6379) and postgres:16-alpine (0.0.0.0:5433)
```

---

## 3. Start Everything

Open **4 terminals**. Run one command per terminal:

```bash
# Terminal 1 — Server
npm run dev -w packages/server

# Terminal 2 — Client A (watches workspace-devA/)
npm run dev -w packages/client -- --dev=devA --workspace=./packages/demo/workspace-devA

# Terminal 3 — Client B (watches workspace-devB/)
npm run dev -w packages/client -- --dev=devB --workspace=./packages/demo/workspace-devB

# Terminal 4 — Dashboard
npm run dev -w packages/dashboard
```

Or use the one-liner (seeds workspaces automatically):

```bash
npm run demo:start
```

**Verify server is up:**
```bash
curl http://localhost:3000/v1/health
# expected: {"ok":true}
```

**Open dashboard:** http://localhost:5174

---

## 4. Start the Agent REPLs

Open 2 more terminals:

```bash
# Terminal 5
npm run dev:a       # Interactive agent for devA

# Terminal 6
npm run dev:b       # Interactive agent for devB
```

Both will connect to the server and seed their workspaces with fintech TypeScript files if empty.

**Built-in REPL commands (both agents):**

| Command | What it does |
|---------|-------------|
| `ls` | List workspace files + entities |
| `ctx` | Print live context snapshot from server |
| `reset` | Re-seed workspace to initial state |
| `flush` | Clear all server state + dashboard |
| `help` | Show available commands |
| `quit` | Disconnect and exit |

---

## Feature Tests

---

### TEST 1 — Entity Registration

**What it tests:** File watcher → parser → entity:diff → Redis → dashboard node appears

**Steps:**
1. Open dashboard (http://localhost:5174)
2. In devA terminal, type: `ls`  
   → should list files with entity names
3. In devA terminal, type any task:
   ```
   add a comment to processPayment
   ```
4. Watch dashboard → a new node for `processPayment` should appear with devA's color

**Expected:** Graph node appears within 2 seconds of the agent writing the file.

---

### TEST 2 — Live Context Snapshot

**What it tests:** GET /context/snapshot returns Markdown with all live entities

**Steps:**
1. After at least one agent has made an edit:
   ```bash
   curl http://localhost:3000/v1/context/snapshot?format=markdown
   ```
2. In devA REPL, type: `ctx`

**Expected:** Both show a Markdown block per entity with signature, file, owner, and body.

---

### TEST 3 — Conflict Detection

**What it tests:** Two devs edit the same entity → conflict event fires → dashboard shows merge editor

**Steps:**
1. In devA REPL:
   ```
   add email validation parameter to processPayment
   ```
   Wait for `[CB] entity:diff sent` message.

2. Immediately in devB REPL:
   ```
   add retry logic parameter to processPayment
   ```

**Expected:**
- Both REPL terminals print `[⚡ CONFLICT] processPayment`
- Dashboard shows conflict session in the conflict feed
- Dashboard opens merge editor with devA code on left, devB code on right

---

### TEST 4 — Blast Radius

**What it tests:** BFS traversal counts transitive dependents, severity classification

**Steps:**
```bash
curl http://localhost:3000/v1/entities/processPayment/impact
# expected: { "impactCount": N }  (N > 0 if other entities call it)

curl http://localhost:3000/v1/entities/processPayment/dependents
# expected: array of entity names that call processPayment
```

**Also visible in conflict event:** REPL prints `(blast radius: N downstream)` next to severity.

---

### TEST 5 — Conflict Resolution (3 types)

**What it tests:** The full open → resolving → resolved state machine

First trigger a conflict (TEST 3). Then in dashboard:

#### 5a — Accept A
Click **"Use A →"** to load devA's code into the merged panel, then click **"Accept Merged Version ✓"**.
- REPL terminals both print `[✓ RESOLVED]`
- devA's version written to both workspaces
- Dashboard conflict closes

#### 5b — Accept B
Trigger a new conflict. Click **"Use B →"**, then **"Accept Merged Version ✓"**.
- devB's version written to both workspaces

#### 5c — Manual Merge
Trigger a new conflict. Click **"Use A →"** or **"Use B →"** to load a base, then edit the center panel directly. Click **"Accept Merged Version ✓"**.
- Custom merged code written to both workspaces

**Verify via API after each:**
```bash
curl http://localhost:3000/v1/conflicts/sessions
# resolved sessions should not appear (status !== 'resolved')
```

---

### TEST 6 — Stale Write / Blast Cascade

**What it tests:** A 3rd write lands on an entity while a conflict session is already open

**Steps:**
1. Trigger a conflict on `processPayment` (TEST 3) — don't resolve it yet
2. In devA REPL immediately:
   ```
   add timeout to processPayment
   ```

**Expected:**
- REPL prints `[⚠ STALE WRITE] processPayment written against open conflict`
- `blast radius now: N`
- Dashboard shows incremented blast radius on the conflict session

---

### TEST 7 — Heartbeat + Disconnect Cleanup

**What it tests:** Entity locks expire when a client disconnects; ghost locks cleared

**Steps:**
1. Make sure devA has at least one entity lock (after any edit)
2. Check entity owner:
   ```bash
   curl http://localhost:3000/v1/entities/processPayment
   # devId should be "devA"
   ```
3. Kill devA REPL (Ctrl+C)
4. Wait 35 seconds (heartbeat TTL = 30s)
5. Check dashboard → devA node should disappear from the dev panel
6. Check entity:
   ```bash
   curl http://localhost:3000/v1/entities/processPayment
   # should return 404 or empty (entity cleared)
   ```

---

### TEST 8 — REST API Endpoints

Run all in sequence after some activity:

```bash
# Health
curl http://localhost:3000/v1/health

# All recent conflicts (last 100)
curl http://localhost:3000/v1/conflicts

# Open conflict sessions
curl http://localhost:3000/v1/conflicts/sessions

# Specific entity state
curl http://localhost:3000/v1/entities/validateToken

# Who calls validateToken
curl http://localhost:3000/v1/entities/validateToken/dependents

# Who uses validateToken (by devId)
curl http://localhost:3000/v1/entities/validateToken/clients

# Audit trail for entity
curl "http://localhost:3000/v1/audit/entities/validateToken?limit=10"

# Audit trail for dev
curl "http://localhost:3000/v1/audit/devs/devA?limit=10"

# Recent changes across all devs
curl "http://localhost:3000/v1/audit/recent?limit=20"

# Context snapshot (LLM-ready)
curl "http://localhost:3000/v1/context/snapshot?format=markdown"

# Validate generated code against live signatures
curl -X POST http://localhost:3000/v1/context/validate \
  -H "Content-Type: application/json" \
  -d '{"code": "processPayment(amount)"}'
# expected: conflicts[] if signature mismatch
```

---

### TEST 9 — Signature Validation

**What it tests:** Agent validates code against live signatures, re-generates if mismatch

**Steps:**
1. In devA REPL, make any edit so `processPayment` has a known signature
2. In devB REPL, type:
   ```
   write a function that calls processPayment with wrong arguments
   ```
3. Watch devB REPL output — should show `N conflict(s) found — re-generating with corrections`

**Or test the endpoint directly:**
```bash
curl -X POST http://localhost:3000/v1/context/validate \
  -H "Content-Type: application/json" \
  -d '{"code": "validateToken(email, password)"}'
# if validateToken requires (token: string) → returns conflict with correctedCall
```

---

### TEST 10 — Flush + Reset

**What it tests:** Clean slate between test runs

```bash
# Reset all server state (Redis entities, conflict history)
curl -X POST http://localhost:3000/v1/context/flush

# Or from inside any REPL:
flush
```

**In agent REPLs — reset workspace files to initial seed:**
```
reset
```

---

## Quick Smoke Test (< 5 min)

Run these in order after `npm run demo:start`:

```bash
curl http://localhost:3000/v1/health                    # server up
# open http://localhost:5174                             # dashboard loads
npm run dev:a   # in new terminal → connects, seeds, shows workspace
npm run dev:b   # in new terminal → connects
# devA> add rate limiting to processPayment
# devB> add caching to processPayment   (triggers conflict)
# resolve in dashboard
curl http://localhost:3000/v1/conflicts                 # conflict logged
curl http://localhost:3000/v1/audit/recent?limit=5      # changes recorded
```

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `[CB] Cannot reach server` in REPL | Server not running. Check Terminal 1. |
| Dashboard blank / no nodes | Clients not running. Check Terminals 2–3. |
| `GROQ_API_KEY` error | Add key to `.env` file. |
| Postgres connection refused | Check `POSTGRES_PORT=5433` in `.env` (docker uses 5433, not 5432). |
| Conflicts not clearing from dashboard | Run `flush` in REPL or `POST /v1/context/flush`. |
| Entity not appearing in graph | Wait 2s. If still missing: check client terminal for parse errors. |
| Redis keyspace events not firing | `docker-compose down && docker-compose up redis -d` — compose sets `--notify-keyspace-events Ex`. |
