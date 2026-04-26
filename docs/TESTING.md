# ContextBridge — Testing Guide

Two AI agents (devA, devB) work on a shared fintech codebase. When devB writes over devA's entity, a conflict fires. The dashboard shows a 3-panel merge editor. Accepted code pushes to both agents' workspaces.

---

## 1. Prerequisites

| Software | Version | Check |
|---|---|---|
| Node.js | 20+ | `node --version` |
| npm | 9+ | `npm --version` |
| Docker Desktop | any | `docker --version` |
| GROQ_API_KEY | — | needed for agent LLM calls |

### Infrastructure

```bash
docker compose up -d
```

Redis on `localhost:6379`, Postgres on `localhost:5433`.

### Environment

Copy `.env.example` to `.env` at repo root and fill in:

```
REDIS_URL=redis://localhost:6379
POSTGRES_HOST=localhost
POSTGRES_PORT=5433
POSTGRES_DB=contextbridge
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
GROQ_API_KEY=gsk_...
PORT=3000
CB_SERVER=http://localhost:3000
VITE_SERVER_URL=http://localhost:3000
```

---

## 2. Unit Tests

```bash
npm test -w packages/server
```

**Expected:** All tests pass. Look for no `FAIL` blocks.

The server has unit tests for:
- `conflict.session.service` — session lifecycle, blast radius, resolve guards
- `conflict.detector` — `detectConflictType`, `isSecuritySensitive`, auth bypass detection
- `context.service` — snapshot building

---

## 3. Start the Full Stack

Open **4 terminals**:

**Terminal 1 — Server**
```bash
npm run dev -w packages/server
```
Expected:
```
[server] ContextBridge server running on port 3000
[server] Redis connected
[server] PostgreSQL connected
[server] Migrations applied
```

**Terminal 2 — Dashboard**
```bash
npm run dev -w packages/dashboard
```
Expected: Vite dev server at `http://localhost:5174`

**Terminal 3 — devA agent**
```bash
npx ts-node packages/agent/src/interactive.ts devA
```
Expected:
```
╔══════════════════════════════╗
║  ContextBridge Agent — devA  ║
╚══════════════════════════════╝
✓ Connected to server
✓ Workspace seeded: 10 files (auth.service.ts, account.service.ts, ...)
devA >
```

**Terminal 4 — devB agent**
```bash
npx ts-node packages/agent/src/interactive.ts devB
```

---

## 4. Dashboard Initial State

Open `http://localhost:5174`.

**What you should see:**
- TopBar: `WS` dot **cyan** (connected). Entity count 0. `SMART` mode pill.
- DevPanel (left): `devA ● ONLINE` and `devB ● ONLINE`
- Graph (center): empty "AWAITING SIGNAL" state
- ConflictFeed (right): "No conflicts / System nominal"

---

## 5. SMART Mode Demo — No Conflicts

This shows ContextBridge working correctly. The LLM fetches live context before writing.

**In devA terminal, type:**
```
add scope validation to validateToken
```

**Expected devA terminal output:**
```
↳ Fetching context snapshot...
↳ Sending to LLM (llama-3.3-70b-versatile)...
↳ Writing: auth.service.ts

✓ EDIT  auth.service.ts
  validateToken(token: string, requiredScope: string[]): Session | null

↓ entity:diff  validateToken (function)  auth.service.ts
```

**Expected dashboard:**
- Graph: `validateToken` node appears with devA's cyan ring
- DevPanel: devA entity count increments

**In devB terminal, type:**
```
add transfer logic calling validateToken
```

**Expected devB terminal output** (smart mode — LLM sees the updated signature):
```
↳ Fetching context snapshot...
↳ LLM sees validateToken(token: string, requiredScope: string[]): Session | null
↳ Writing: transaction.service.ts

✓ EDIT  transaction.service.ts
  transfer(fromAccountId: string, toAccountId: string, amount: number, token: string): Promise<Transaction>

↓ entity:diff  transfer (function)  transaction.service.ts
```

**No conflict fires** — devB's LLM used the correct signature.

---

## 6. DUMB Mode Demo — Conflict + Merge Editor

This shows the damage when AI agents ignore ContextBridge.

**Step 1:** In the dashboard, click the mode toggle from `SMART` → `DUMB` (turns red).

**Step 2:** In devA terminal, type:
```
add scope validation to validateToken
```
devA changes `validateToken(token: string)` → `validateToken(token: string, requiredScope: string[])`.

**Step 3:** In devB terminal, type:
```
add payment processing that calls validateToken
```

**Expected devB terminal output** (dumb mode — LLM uses stale signature):
```
↳ Writing with STALE context (dumb mode)...

✓ EDIT  payment.service.ts

↓ entity:diff  processPayment (function)  payment.service.ts

⚡ CONFLICT  validateToken  🔒 SECURITY SENSITIVE
  owner:    devA
  modifier: devB
  severity: CRITICAL  (blast radius: N downstream)
  type:     auth_bypass
  → resolve at dashboard: http://localhost:5174

  Open conflicts this session: 1  Stale writes: 0
```

**Expected dashboard:**
- Graph: `validateToken` node turns **red** with pulsing ring
- ConflictFeed: new `[CRIT]` entry for `validateToken` with "Resolve →" button
- DevPanel devB section: **DUMB MODE DAMAGE** box appears showing `1 conflict  ΔN downstream`

**Step 4:** Continue writing in devB — type anything that touches a dependent entity:
```
add account freezing that uses validateToken
```

**Expected devB terminal:**
```
⚠ STALE WRITE  freezeAccount written against open conflict
  blast radius now: 2 downstream functions affected
  Stale writes this session: 1
```

Dashboard blast radius counter updates live.

---

## 7. Resolve a Conflict via Merge Editor

**Method A — Click conflict node in graph:**
Click the red pulsing `validateToken` node.

**Method B — Click "Resolve →" in ConflictFeed.**

**Expected:** 3-panel merge editor opens:

```
┌─────────────────────────────────────────────────────────────┐
│  ⚡ CONFLICT  validateToken  [🔒 AUTH BYPASS]  [🔒 AUTH SENSITIVE] │
│  blast radius: 2 downstream                              ×  │
├──────────────────┬──────────────────┬──────────────────────┤
│  devA (owner)    │  MERGED RESULT   │  devB (incoming)     │
│  ──────────────  │  (editable)      │  ──────────────────  │
│  [full code]     │  [textarea]      │  [full code]         │
│                  │                  │                        │
│  [Accept A →]    │                  │  [← Accept B]         │
├──────────────────┴──────────────────┴──────────────────────┤
│                              [Accept Merged Version]        │
└─────────────────────────────────────────────────────────────┘
```

**To resolve:**

**Option A — Accept devA's version (recommended for auth_bypass):**
Click `Accept A →`.

**Option B — Accept devB's version:**
Click `← Accept B`.

**Option C — Manual merge:**
Edit the center textarea → click `Accept Merged Version`.

---

## 8. After Resolution

**Expected outcomes:**

**Both agent terminals** show:
```
✓ RESOLVED  validateToken — accepted version written to auth.service.ts
  Remaining open conflicts: 0
```

**Dashboard:**
- Graph: `validateToken` node ring goes back to **cyan/normal** (no longer red)
- ConflictFeed: session removed (or archived)
- DevPanel devB: DUMB MODE DAMAGE counter resets

**Workspace files:** `workspace-devA/auth.service.ts` and `workspace-devB/auth.service.ts` both contain the accepted version.

---

## 9. REST API Spot Checks

With server running:

```bash
# Open conflict sessions
curl http://localhost:3000/v1/conflicts/sessions | jq

# Get specific session
curl http://localhost:3000/v1/conflicts/sessions/<id> | jq

# Recent conflicts (Redis)
curl http://localhost:3000/v1/conflicts | jq

# Context snapshot (what smart mode LLM sees)
curl "http://localhost:3000/v1/context/snapshot?format=markdown"

# Health
curl http://localhost:3000/v1/health
```

---

## 10. What Means What

| Dashboard element | Meaning |
|---|---|
| Cyan node ring | devA owns this entity |
| Amber node ring | devB owns this entity |
| Red pulsing ring | Open conflict on this entity |
| Node size | Proportional to blast radius |
| `DUMB MODE DAMAGE` box | devB has active conflicts + downstream breakage |
| `🔒 SECURITY SENSITIVE` in merge editor | The conflicted function is in the auth path |
| `auth_bypass` conflict type | devB wrote stale code over an auth function — financial transactions may be unprotected |
| `blast_cascade` conflict type | devB's write depends on an entity already in conflict |

---

## 11. Common Failures

| Symptom | Cause | Fix |
|---|---|---|
| Agent can't start — `GROQ_API_KEY not set` | Missing env var | Add to `.env` |
| Dashboard WS dot grey | Server not running | Start server first |
| Graph empty after agent connects | `entity:diff` not emitted | Check agent seed ran: type `ls` in agent terminal |
| Conflict fires but no merge editor opens | Click on the red node | Or use "Resolve →" button in ConflictFeed |
| `✓ RESOLVED` shows but file not updated | `file` field was empty on entity | Ensure agents emitted `file` in their `entity:diff` payloads |
| Build fails on agent | `FINTECH_FILES` import | Check `packages/demo/src/fintech-seed.ts` exists |
| Postgres migration error | Old schema conflict | `docker compose down -v && docker compose up -d` |

---

## 12. Workspace Layout

```
workspace-devA/          ← devA's local copy
  auth.service.ts        ← validateToken, requireScope, createSession, ...
  account.service.ts     ← getAccount, createAccount, freezeAccount, ...
  transaction.service.ts ← transfer, deposit, withdraw, ...
  payment.service.ts     ← chargeCard, refund, validatePaymentMethod, ...
  fraud.service.ts       ← scoreRisk, flagTransaction, blockAccount, ...
  kyc.service.ts         ← verifyIdentity, checkCompliance, requireKYC, ...
  audit.service.ts       ← logTransaction, generateReport, ...
  notification.service.ts← alertFraud, sendReceipt, ...
  db.ts                  ← query, transaction, withRetry, ...
  types.ts               ← Account, Transaction, Payment, Session, ...

workspace-devB/          ← identical initial copy, diverges as devB writes
  (same files)
```

**Natural conflict**: devA hardens `validateToken(token)` → `validateToken(token, requiredScope[])`. devB's dumb LLM writes 4 payment functions calling old `validateToken(token)` → auth bypass on financial transactions.
