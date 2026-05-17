# ContextBridge — Demo & Interview Pitch Guide

---

## The Pitch (30 seconds)

> "Modern AI coding agents like Copilot or Cursor each write code in isolation — they don't know what the other agent on your team just changed. ContextBridge is a real-time shared context layer: every agent sees every other agent's live function signatures, ownership locks, and dependency graph. When two agents conflict, we catch it at write-time — not at PR review, not at runtime — and surface a structured merge session. It's the missing coordination layer for multi-agent development."

---

## The Problem Without ContextBridge

| Scenario | Without CB | With CB |
|----------|-----------|---------|
| devA changes `processPayment(amount)` → `processPayment(amount, currency)` | devB's code still calls it with 1 arg. Breaks at runtime. | devB's agent is told the signature changed *before* it writes. |
| Two agents edit the same function simultaneously | Last write wins. First agent's work silently overwritten. | Conflict detected in milliseconds. Merge session opened. |
| Agent calls a function that was deleted yesterday | No error until deploy. | `/validate` endpoint returns conflict + corrected call. |
| Junior dev's agent calls auth function wrong | No review until PR. Auth bypass in prod. | Security-sensitive entity flagged. `auth_bypass` conflict type raised. |
| Team has 10 agents, 200 entities | No one knows who owns what. | Live dependency graph. Entity locks. Blast radius on every change. |

---

## SMART vs DUMB Mode

Toggle in the **top-right of the dashboard** (SMART / DUMB pills).

| | SMART Mode | DUMB Mode |
|--|-----------|-----------|
| **What it means** | Agents have live ContextBridge context injected into every LLM prompt | Agents write blindly — no shared context, no awareness of other agents' code |
| **Agent behavior** | Sees all live entity signatures, who owns what, what calls what | Writes based on its own workspace only |
| **Expected outcome** | Fewer conflicts, correct call signatures, respects ownership | More conflicts, stale calls, cascading blast radius |
| **Dashboard indicator** | SMART pill lit cyan | DUMB pill lit red — "DUMB MODE DAMAGE" counter appears in Dev Panel |
| **How to demo** | Normal operation | Click DUMB toggle → have both agents edit aggressively → watch damage counter climb |

**The demo arc:** Start SMART, trigger one clean conflict resolution, then switch to DUMB and trigger several — show the DevPanel "DUMB MODE DAMAGE" counter vs zero in SMART. That contrast is the pitch.

---

## Interviewer Demo Script (10 min)

### Step 0 — Setup (done before interview)
```bash
docker-compose up redis postgres -d
npm run demo:start        # seeds workspaces, starts server + clients + dashboard
# in 2 separate terminals:
npm run dev:a
npm run dev:b
```
Open http://localhost:5174 — graph should show ~10 entity nodes.

---

### Step 1 — Show the graph (1 min)

Point at the dashboard:
- **Nodes** = live TypeScript entities owned by each dev (color-coded)
- **Edges** = dependency calls (who calls whom)
- **Dev Panel** (left) = which agents are online, what they own, heartbeat
- **Conflict Feed** (right) = real-time event log

> *"Every write from an agent updates this graph in real time via Socket.IO. The graph is the shared brain."*

---

### Step 2 — Show SMART context (1 min)

In devA terminal:
```
ctx
```
Shows the live Markdown snapshot all agents get injected into their LLM prompt — signatures, owners, file paths.

> *"Before every LLM call, the agent pulls this snapshot. It knows `processPayment` is owned by devB and has signature `(amount: number, currency: string)`. It won't write a call with wrong args."*

---

### Step 3 — Trigger a conflict (2 min)

devA:
```
add email validation parameter to processPayment
```
Wait for `[CB] entity:diff sent`.

devB immediately:
```
add retry logic parameter to processPayment
```

Both terminals print `[⚡ CONFLICT] processPayment`. Dashboard:
- Conflict feed entry appears
- Merge editor opens (3-panel: devA left, merged center, devB right)
- Diff highlights show exactly which lines differ

> *"Caught in milliseconds — not at PR, not at runtime. And notice the blast radius: N entities downstream will be affected by whichever version wins."*

---

### Step 4 — Resolve (1 min)

In dashboard merge editor:
1. Click **"Use A →"** to load devA's version into center panel
2. Edit the merged panel if you want to combine both changes
3. Click **"Accept Merged Version ✓"**

Both REPL terminals print `[✓ RESOLVED]` — accepted code written back to both workspaces automatically.

> *"The accepted version propagates back to both agents' workspaces over Socket.IO. No manual copy-paste. Both agents are immediately in sync."*

---

### Step 5 — Show DUMB mode damage (2 min)

Click **DUMB** toggle in top-right. Now:

devA:
```
add rate limiting to transfer
```
devB:
```
add caching to transfer
```

Don't resolve — let them pile up. Trigger 3-4 more on different entities. Watch:
- **Conflict feed** fills up
- **DUMB MODE DAMAGE** counter in Dev Panel climbs
- Blast radius numbers grow (stale writes cascade)

Switch back to **SMART** and resolve one — counter drops.

> *"This is what a multi-agent codebase looks like without coordination. Every unresolved conflict is a potential runtime bug or security hole."*

---

### Step 6 — Show the API layer (1 min)

```bash
# Who calls processPayment and will break if its signature changes?
curl http://localhost:3000/v1/entities/processPayment/dependents

# Validate any code snippet against live signatures
curl -X POST http://localhost:3000/v1/context/validate \
  -H "Content-Type: application/json" \
  -d '{"code": "processPayment(amount)"}'
# returns: conflict + correctedCall if signature mismatch
```

> *"This REST API is how you'd plug ContextBridge into a CI pipeline — validate generated code before it ever hits a PR."*

---

### Step 7 — Reset between demos
```
# In any REPL:
reset    # restores workspace to canonical fintech seed files
flush    # clears all Redis entity state + dashboard
```

---

## Feature Test Reference

### TEST 1 — Entity Registration
File change → parser → entity:diff → Redis → dashboard node. Should appear within 2s of agent edit.

### TEST 2 — Live Context Snapshot
```bash
curl http://localhost:3000/v1/context/snapshot?format=markdown
```
Returns all live entities with signatures, owners, bodies.

### TEST 3 — Conflict Detection
Two agents edit same function → `[⚡ CONFLICT]` in both terminals + dashboard merge editor opens.

### TEST 4 — Blast Radius
```bash
curl http://localhost:3000/v1/entities/processPayment/impact
# { "impactCount": N }  — N transitive dependents affected
```

### TEST 5 — Conflict Resolution (3 types)
| Type | How | Server records |
|------|-----|----------------|
| Accept A | Click "Use A →" then submit | `type: accepted_a` |
| Accept B | Click "← Use B" then submit | `type: accepted_b` |
| Manual merge | Edit center panel then submit | `type: manual_merge` |

### TEST 6 — Stale Write / Blast Cascade
Trigger conflict, don't resolve, then have same dev edit the entity again.
REPL prints `[⚠ STALE WRITE]`. Dashboard blast radius increments.

### TEST 7 — Heartbeat + Disconnect Cleanup
Kill devA (Ctrl+C). After 30s: devA disappears from dev panel, its entity locks cleared from Redis.

### TEST 8 — Full REST API
```bash
curl http://localhost:3000/v1/health
curl http://localhost:3000/v1/conflicts
curl http://localhost:3000/v1/conflicts/sessions
curl http://localhost:3000/v1/entities/loginUser
curl http://localhost:3000/v1/entities/loginUser/dependents
curl "http://localhost:3000/v1/audit/entities/loginUser?limit=10"
curl "http://localhost:3000/v1/audit/devs/devA?limit=10"
curl "http://localhost:3000/v1/audit/recent?limit=20"
```

### TEST 9 — Signature Validation
```bash
curl -X POST http://localhost:3000/v1/context/validate \
  -H "Content-Type: application/json" \
  -d '{"code": "loginUser(email)"}'
# if loginUser(email, password) → returns conflict + correctedCall
```

### TEST 10 — Flush + Reset
```bash
curl -X POST http://localhost:3000/v1/context/flush   # clear all Redis state
# or in REPL: flush / reset
```

---

## Setup Reference

### Prerequisites
- Docker Desktop running
- Node.js 20+
- Groq API key → https://console.groq.com

### .env
```
GROQ_API_KEY=gsk_...
POSTGRES_HOST=localhost
POSTGRES_PORT=5433
POSTGRES_USER=contextbridge
POSTGRES_PASSWORD=contextbridge
POSTGRES_DB=contextbridge
```

### Start Everything
```bash
npm install
docker-compose up redis postgres -d
npm run demo:start          # server + file clients + dashboard (auto-seeds workspaces)
npm run dev:a               # devA agent REPL (new terminal)
npm run dev:b               # devB agent REPL (new terminal)
```

Dashboard: http://localhost:5174

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| No nodes on dashboard at startup | Restart `demo:start` — file watcher now starts after socket connects |
| `dev-18016` / random IDs on dashboard | Old client binary running — `demo:start` now uses env vars; restart |
| `[CB] Cannot reach server` | Server not running. Start Terminal 1 first. |
| `GROQ_API_KEY` error | Add key to `.env` |
| Postgres refused | Check `POSTGRES_PORT=5433` (docker maps 5433→5432) |
| Conflicts not clearing | Run `flush` in REPL |
