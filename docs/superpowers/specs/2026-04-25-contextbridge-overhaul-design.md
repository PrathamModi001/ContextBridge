# ContextBridge — Overhaul Design Spec
_Date: 2026-04-25_

---

## Core Concept (North Star)

ContextBridge exists to let **two developers use AI coding agents on shared code without stepping on each other.** The moment one dev's AI changes a shared contract, the other dev's AI must know — before it writes broken code.

The SMART/DUMB mode toggle is the entire demo:
- **SMART**: agent queries ContextBridge before writing → zero conflicts, correct code
- **DUMB**: agent ignores ContextBridge → stale writes cascade → financial endpoints left unprotected

---

## Domain: Fintech / Payments API

Chosen because consequences are quantifiable in dollars. Auth bypass on a todo list is abstract. Auth bypass on `processPayment` is visceral.

```
workspace-devX/
  auth.service.ts         validateToken, createSession, requireScope, revokeToken, refreshToken
  account.service.ts      getAccount, createAccount, freezeAccount, getBalance, updateAccountLimits
  transaction.service.ts  transfer, deposit, withdraw, getTransactionHistory, validateTransactionLimit
  payment.service.ts      chargeCard, refund, validatePaymentMethod, processWebhook, createPaymentIntent
  fraud.service.ts        scoreRisk, flagTransaction, blockAccount, reviewFraudAlert, updateRiskModel
  kyc.service.ts          verifyIdentity, checkCompliance, updateKYCStatus, requireKYC
  audit.service.ts        logTransaction, generateReport, flagSuspicious, getAuditTrail
  notification.service.ts alertFraud, sendReceipt, notifyAccountFreeze, notifyPaymentFailed
  types.ts                Account, Transaction, Payment, KYCRecord, AuditLog, RiskScore, Session interfaces
  db.ts                   query, transaction, withRetry, withAuditLog
```

**DevA focus**: `auth.service`, `kyc.service`, `types.ts` — security contracts
**DevB focus**: `transaction.service`, `payment.service`, `fraud.service` — money movement

**Natural conflict**: DevA hardens `validateToken(token)` → `validateToken(token, requiredScope[])` as compliance fix. DevB's dumb LLM writes 4 payment/transfer functions calling old `validateToken(token)` → auth bypass on financial transactions.

---

## Architecture: Approach C + B

**B — Per-dev entity versioning**: Redis stores devA and devB bodies independently during conflict. No last-writer-wins data loss.

**C — Conflict session state machine**: When conflict fires, create a `ConflictSession` object. All resolution flows through it. Clean state: `open → resolving → resolved`. Full audit trail in Postgres.

---

## Data Model

### Redis Schema (overhaul)

```
entity:{name}:dev:{devId}     Hash  { signature, body, file, line, kind, updatedAt }
entity:{name}:meta            Hash  { latestDevId, lockedBy, lockedAt, conflictSessionId }
entity:{name}:dependents      Set
entity:{name}:clients         Set

conflict:session:{id}         Hash  {
                                      entityName, devAId, devBId,
                                      devABody, devASig,
                                      devBBody, devBSig,
                                      status,           -- open | resolving | resolved
                                      detectedAt, resolvedAt,
                                      resolvedBy, resolutionType,
                                      mergedBody, blastRadius,
                                      securitySensitive, conflictType
                                    }

client:{devId}:heartbeat      Key   TTL=30s
client:{devId}:entities       Set
```

Key rule: `conflictSessionId` on entity meta → dashboard knows to open merge editor when node clicked.

### Postgres Schema Additions

```sql
-- Extend conflicts table
ALTER TABLE conflicts ADD COLUMN conflict_type       TEXT DEFAULT 'signature_drift';
  -- signature_drift | ghost_call | auth_bypass | type_violation | blast_cascade
ALTER TABLE conflicts ADD COLUMN blast_radius        INT DEFAULT 0;
ALTER TABLE conflicts ADD COLUMN security_sensitive  BOOLEAN DEFAULT false;
ALTER TABLE conflicts ADD COLUMN conflict_session_id UUID;
ALTER TABLE conflicts ADD COLUMN dev_a_body          TEXT;
ALTER TABLE conflicts ADD COLUMN dev_b_body          TEXT;
ALTER TABLE conflicts ADD COLUMN merged_body         TEXT;
ALTER TABLE conflicts ADD COLUMN resolution_type     TEXT;
  -- accepted_a | accepted_b | manual_merge
ALTER TABLE conflicts ADD COLUMN resolved_by         TEXT;
ALTER TABLE conflicts ADD COLUMN resolved_at         TIMESTAMPTZ;
ALTER TABLE conflicts ADD COLUMN triggering_change_id UUID
  REFERENCES entity_changes(id) ON DELETE SET NULL;

-- Dumb mode damage tracking
CREATE TABLE stale_writes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dev_id              TEXT NOT NULL,
  entity_name         TEXT NOT NULL,
  conflict_session_id UUID REFERENCES conflicts(conflict_session_id),
  written_at          TIMESTAMPTZ DEFAULT now(),
  conflict_type       TEXT NOT NULL
);
```

---

## Conflict Session State Machine

```
devB writes entity already locked by devA
              │
              ▼
        ┌─────────────┐
        │    OPEN     │  session created, both bodies stored
        │             │  socket → conflict:session:opened
        └──────┬──────┘
               │
   ┌───────────┼─────────────────┐
   │                             │
dashboard opens            more dumb writes
merge editor               → stale_writes row
   │                       → blastRadius++
   ▼                       → conflict:blast:update
┌──────────────────┐
│    RESOLVING     │  dashboard emits conflict:resolve:start
│                  │  badge shown to all devs
└────────┬─────────┘
         │
  Accept A / Accept B / Manual Merge
         │
         ▼
┌──────────────────┐
│    RESOLVED      │  resolution written to Postgres
│                  │  accepted body → pushed to BOTH agents
└────────┬─────────┘  lock cleared, conflictSessionId = null
         │
  both agents: conflict:accepted { entityName, body, file }
  → overwrite file on disk
  → emit entity:diff with resolved body
  → graph clears: red → green
```

### State Transitions

| Transition | Trigger | Side Effects |
|---|---|---|
| `→ OPEN` | devB diff hits locked entity | Create session, store bodies, emit `conflict:session:opened`, write Postgres |
| `→ RESOLVING` | Dashboard opens merge editor | Emit `conflict:session:resolving` |
| `→ RESOLVED` | User submits resolution | Write Postgres, push body to both agents, clear lock, emit `conflict:resolved` |
| `OPEN + new write` | devB keeps writing (dumb mode) | `stale_writes` row, `blast_radius++`, emit `conflict:blast:update` |

---

## Conflict Types & Detection

| Type | Condition | Severity |
|---|---|---|
| `signature_drift` | Param added/removed/type changed | warning/critical |
| `ghost_call` | Entity deleted/renamed, still called by devB | critical |
| `auth_bypass` | Changed entity is in auth path (validateToken, requireScope, requirePermission) | critical + security_sensitive=true |
| `type_violation` | Shared interface field added/removed | critical |
| `blast_cascade` | New write depends on already-conflicting entity | warning |

**Blast radius calc**: On each devB write in dumb mode, server walks dep graph forward from the written entity, counts downstream callers with stale deps. Stored as `blast_radius` on the conflict session.

**Auth path detection**: Entities matching patterns `validateToken|requireScope|requirePermission|checkPermission|verifyIdentity|requireKYC` flagged `security_sensitive=true`.

---

## Backend Changes

### New / Changed Services

**`conflict.session.service.ts`** (new)
```typescript
createSession(entityName, devAId, devBId, devABody, devASig, devBBody, devBSig): Promise<ConflictSession>
getSession(sessionId): Promise<ConflictSession | null>
markResolving(sessionId, resolvedBy): Promise<void>
resolveSession(sessionId, resolution: Resolution): Promise<void>
  // Resolution = { type: 'accepted_a'|'accepted_b'|'manual_merge', mergedBody, mergedSig, resolvedBy }
appendStaleWrite(sessionId, devId, entityName, conflictType): Promise<void>
```

**`entity.service.ts`** (modified)
- `handleDiff` writes to `entity:{name}:dev:{devId}` instead of `entity:{name}`
- Checks `entity:{name}:meta` for existing `conflictSessionId` before writing
- Calls blast radius calc on write if open session exists

**`conflict.detector.ts`** (modified)
- Detects conflict type (not just presence)
- Checks auth path patterns → sets `security_sensitive`
- Returns enriched `ConflictPayload` with `conflictType`, `securitySensitive`

### New REST Endpoints

```
GET  /v1/conflicts/sessions              List open conflict sessions
GET  /v1/conflicts/sessions/:id          Get session detail (both bodies, blast radius)
POST /v1/conflicts/sessions/:id/resolve  Submit resolution
  Body: { type: 'accepted_a'|'accepted_b'|'manual_merge', mergedBody?, mergedSig?, resolvedBy }
GET  /v1/conflicts/history               Postgres: resolved conflicts with full audit trail
```

### New Socket Events

| Event | Direction | Payload |
|---|---|---|
| `conflict:session:opened` | server→dashboard | `{ sessionId, entityName, devAId, devBId, devASig, devBSig, devABody, devBBody, blastRadius, securitySensitive, conflictType }` |
| `conflict:blast:update` | server→dashboard | `{ sessionId, blastRadius, newStaleEntity }` |
| `conflict:session:resolving` | server→all | `{ sessionId, resolvedBy }` |
| `conflict:resolved` | server→all | `{ sessionId, entityName, resolutionType, resolvedBy }` |
| `conflict:accepted` | server→agent room | `{ entityName, body, file, sig }` |

---

## Agent Changes (`interactive.ts`)

### Seed: Fintech workspace (~50 entities, 10 files)
Replace current 4-file seed with full fintech backend. Both `workspace-devA` and `workspace-devB` seeded identically on `reset`.

### Dumb mode awareness
Agent receives `conflict:session:opened` and `conflict:blast:update` socket events:
- Shows: `⚡ CONFLICT: validateToken — blast radius: 4 functions affected`
- Shows stale write count: `⚠ STALE WRITES THIS SESSION: 3`
- Does NOT block — keeps accepting tasks (this is the point)
- On `conflict:accepted`: overwrites file, emits `entity:diff` with resolved body, logs `✓ RESOLVED: validateToken — accepted devA version`

### Smart mode (unchanged behavior, improved)
Pre-task: fetches `/v1/context/snapshot?format=markdown` → feeds to LLM system prompt. LLM sees live signatures → writes correct code → no conflict.

---

## Dashboard Changes

### Graph: Dev-clustered + color-coded (Approach A+B mix)

- Node color = dev owner: cyan = devA, amber = devB, red = conflict (overrides)
- D3 force simulation: add weak charge between nodes of same dev → natural clustering without hard partition
- Conflict nodes: pulsing red ring, size proportional to blast radius
- Node click on conflicting entity → opens merge editor modal (if `conflictSessionId` set)
- DevPanel: per-dev entity list (name, kind, file) — sorted by last updated

### Merge Editor Modal (new component: `ConflictMergeEditor.tsx`)

```
┌─────────────────────────────────────────────────────────────────────┐
│  ⚡ CONFLICT: validateToken                    [auth_bypass] 🔒      │
│  blast radius: 4 · security sensitive · detected 2m ago             │
├────────────────────────┬──────────────────────┬─────────────────────┤
│  devA (owner)          │  MERGED RESULT        │  devB (incoming)    │
│  ─────────────────     │  ─────────────────    │  ─────────────────  │
│  [full code body]      │  [editable textarea]  │  [full code body]   │
│                        │                       │                     │
│  [Accept A →]          │                       │  [← Accept B]       │
├────────────────────────┴──────────────────────┴─────────────────────┤
│  [Cancel]                                    [Accept Merged Version] │
└─────────────────────────────────────────────────────────────────────┘
```

- Default merged textarea = devA body (owner wins by default)
- "Accept A" / "Accept B" buttons populate merged textarea + immediately submit
- "Accept Merged Version" submits whatever is in the textarea as `manual_merge`
- On submit: POST `/v1/conflicts/sessions/:id/resolve` → server pushes to both agents

### Dumb Mode Damage Counter (new UI element in DevPanel)

When devB has open sessions:
```
devB  ●  ONLINE
  stale writes: 4        ← amber counter, increments live
  open conflicts: 2      ← red counter
  blast radius total: 7  ← total downstream broken
```

Resets to zero on session resolved.

---

## What Gets Stored in Postgres (Summary)

| Table | What | Why |
|---|---|---|
| `entity_changes` | Every entity write, old+new sig, body, dev | Full edit history, FK source for conflicts |
| `conflicts` | Every conflict: type, blast_radius, security_sensitive, both bodies, resolution | Audit trail, demo receipt, "damage report" |
| `stale_writes` | Every dumb-mode write against stale context | Quantify the damage: "5 minutes of dumb mode = N stale writes" |

Redis stays as hot cache only. Postgres is the source of truth for history.

---

## What ContextBridge Is (Refined)

Not a merge tool. Not a linter. Not a code review tool.

**ContextBridge is the shared memory layer between AI agents on a team.** It ensures every agent sees the same live codebase state before writing. Without it, AI agents on the same team are blind to each other — and in a fintech codebase, that blindness creates exploitable security regressions in minutes.

---

## What's NOT in Scope

- Multi-language support (TypeScript only)
- Git integration (no commits, no PRs)
- Production deployment (demo-grade)
- More than 2 simultaneous developers
- AI-auto-resolution (manual only in dashboard — the human stays in the loop)
