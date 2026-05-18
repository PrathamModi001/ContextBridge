# ContextBridge — Interview Pitch & Demo Guide

---

## The 30-Second Pitch

> "Modern AI coding agents — Copilot, Cursor, custom LLM pipelines — each operate in isolation. They don't know what the other agent on your team just changed. ContextBridge is a real-time shared context layer: every agent sees every other agent's live function signatures, ownership locks, and dependency graph. When two agents conflict, we catch it at write-time — not at PR review, not at runtime — and surface a structured merge session with blast-radius analysis. It's the missing coordination layer for multi-agent development."

---

## The Problem Without ContextBridge

| What happens | Without CB | With CB |
|---|---|---|
| devA changes `processPayment(amount)` → `processPayment(amount, currency)` | devB's agent still calls it with 1 arg. Silent failure at runtime. | devB gets the new signature injected into its LLM prompt *before* it writes. |
| Two agents edit the same function at the same time | Last write wins. First agent's work silently overwritten. No one knows. | Conflict detected in milliseconds. Merge session opened. Both agents notified. |
| Agent calls a deleted function | No error until deploy. Possibly days later. | `/validate` endpoint returns conflict + corrected call before the code is committed. |
| Agent writes to an auth function with wrong call pattern | Slips through review. Auth bypass in prod. | `auth_bypass` conflict type raised. Security-sensitive flag shown. Dashboard escalates. |
| 5 agents, 200 shared functions | No one knows who owns what. Blast radius is unknown. | Live dependency graph. Entity locks. BFS blast-radius count on every change. Audit trail in Postgres. |

**Core insight:** Git catches conflicts at merge time. ContextBridge catches them at *write* time — when it's cheapest to fix.

---

## SMART vs DUMB Mode

Toggle in the **top-right of the dashboard** (SMART / DUMB pills).

| | SMART Mode | DUMB Mode |
|--|---|---|
| **What it means** | Agent LLM prompts include live context: all entity signatures, owners, call graph | Agent writes with only its own local workspace — blind to what other agents own |
| **Context injected** | Yes — full `GET /v1/context/snapshot` markdown per LLM call | No shared context |
| **Expected behavior** | Correct call signatures, respects ownership, fewer conflicts | Stale calls, cascading conflicts, accumulating blast radius |
| **Dashboard indicator** | SMART pill lit cyan | DUMB pill lit red. "DUMB MODE DAMAGE" counter appears in Dev Panel |
| **Demo use** | Normal operation | Click DUMB → trigger several conflicts quickly → show damage counter climb |

**The demo arc:** Run SMART → trigger one clean conflict → resolve it → switch DUMB → trigger three more without resolving → the contrast sells itself.

---

## 10-Minute Demo Script

### Before the interview (setup, hidden from interviewer)

```bash
docker-compose up redis postgres -d
npm run demo:start          # server + file watchers + dashboard (auto-seeds workspaces)
# two separate terminals:
npm run dev:a
npm run dev:b
```

Open http://localhost:5174 — graph should show entity nodes from workspace files.

---

### Minute 1 — Orient the interviewer

Point at the dashboard:

- **Graph (center)** — each node is a live TypeScript entity. Color = owning agent. Edges = who calls whom.
- **Dev Panel (left)** — which agents are online, heartbeat, what they own, conflict damage count.
- **Conflict Feed (right)** — real-time stream of conflict events with severity and blast radius.
- **Top bar** — entity count, conflict count, active dev count, SMART/DUMB toggle.

> *"Every write from any agent updates this graph in real time over WebSockets. No polling. The graph is the shared brain."*

---

### Minute 2 — Show SMART context (the key differentiator)

In devA terminal:
```
ctx
```

Output: Markdown snapshot of all live entities — signatures, owners, file paths, bodies.

> *"Before every LLM call, the agent pulls this snapshot from the server and injects it as system prompt context. It knows `validateToken` is owned by devB and has signature `(token: string): Session | null`. It won't write a call with wrong args."*

---

### Minute 3-4 — Trigger a conflict

devA terminal:
```
add email validation parameter to processPayment
```
Wait for `[CB] entity:diff sent`.

devB terminal immediately:
```
add retry logic parameter to processPayment
```

**What they see:**
- Both terminals print `[⚡ CONFLICT] processPayment` with severity and blast radius
- Conflict Feed entry appears on dashboard
- Merge editor opens: devA's version left, merged center (editable), devB's version right
- Diff highlighting shows exactly which lines changed

> *"Caught in milliseconds. Both agents are notified simultaneously. And notice the blast radius — N functions downstream will be affected by whichever version wins. That number is computed by BFS traversal of the reverse dependency graph."*

---

### Minute 5 — Resolve and show propagation

In dashboard merge editor:
1. Click **"Use A →"** — loads devA's code into center merged panel
2. Optionally edit the center panel to combine both changes (manual merge)
3. Click **"Accept Merged Version ✓"**

Both terminals print `[✓ RESOLVED] processPayment — accepted version written to payment.service.ts`

> *"The accepted version propagates back to both agents' workspaces over WebSocket. No copy-paste. Both agents are in sync immediately. The conflict is removed from the dashboard and the entity node returns to normal severity."*

---

### Minute 6-7 — Show DUMB mode damage

Click **DUMB** toggle in top-right.

devA terminal:
```
add rate limiting to transfer
```
devB terminal:
```
add caching to transfer
```

Don't resolve. Trigger 2-3 more on different entities. Watch:
- Conflict feed fills up
- **DUMB MODE DAMAGE** counter in Dev Panel climbs
- Blast radius numbers compound (stale writes cascade)

Switch back to **SMART**, resolve one — counter drops.

> *"This is what multi-agent codebases look like without coordination. Each unresolved conflict is a potential runtime bug, a silent overwrite, or a security hole sitting undetected until PR or production."*

---

### Minute 8 — Show the API (CI/CD angle)

```bash
# Who calls processPayment? These break if its signature changes.
curl http://localhost:3000/v1/entities/processPayment/dependents

# Validate any generated code against live signatures before it hits a PR
curl -X POST http://localhost:3000/v1/context/validate \
  -H "Content-Type: application/json" \
  -d '{"code": "processPayment(amount)"}'
# returns: conflict + correctedCall if arg count mismatch

# Full audit trail — every entity change, every dev, timestamped
curl "http://localhost:3000/v1/audit/recent?limit=10"
```

> *"This REST API is the integration point for CI pipelines — validate LLM-generated code before it's committed. The audit trail in Postgres gives you a full history of who changed what and when, which matters for compliance in fintech."*

---

### Minute 9 — Security angle (if relevant to the role)

Trigger a conflict on `validateToken` or `createSession`:

```
# devA
add IP allowlist check to validateToken

# devB immediately
add scope bypass for admin to validateToken
```

Watch dashboard: conflict type shows **`auth_bypass`**. Dashboard header shows **🔒 AUTH SENSITIVE**.

> *"ContextBridge classifies conflict types — `auth_bypass`, `type_violation`, `signature_drift`. When an auth entity is involved, the system flags it as security-sensitive so the merge reviewer knows to treat it differently."*

---

### Minute 10 — Reset between demos

```
# In any REPL:
reset    # restores workspace to original 10 fintech seed files
flush    # clears all Redis entity state + dashboard graph
```

---

## Anticipated Interview Questions

**Q: Why not just use Git for conflict detection?**
> Git detects conflicts at merge time — after both agents have already written incompatible code, possibly hours or days later. ContextBridge catches conflicts at write time, when the fix is a single merge decision rather than a debugging session.

**Q: How does the agent know about other agents' code?**
> Before every LLM call, the agent fetches `GET /v1/context/snapshot?format=markdown` from the server. This snapshot includes every entity's current signature, body, owning developer, and file path. It's injected as the system prompt context, so the LLM writes with full awareness of the shared codebase state.

**Q: What's the blast radius?**
> When a function's signature changes, every function that calls it potentially breaks. Blast radius is computed by BFS traversal of the reverse dependency graph starting from the changed entity. A change to `processPayment` that has `chargeCard → processPayment → validatePaymentMethod` in the call graph would show blast radius 2.

**Q: How do entity locks work?**
> When an agent writes to an entity, the server sets a Redis lock (`lock:{entityName}`) with TTL 300s and assigns ownership. If another agent tries to write the same entity, the server detects the conflict by checking who holds the lock vs who is sending the new diff. Locks refresh on every heartbeat (10s interval) while the agent is active. When an agent disconnects, its heartbeat key expires (TTL 30s), triggering Redis keyspace events that clean up the entity registry.

**Q: Why Redis and not just in-memory?**
> Multiple server instances can share state. Redis is also the right tool for TTL-based expiry (heartbeats, locks, grace periods) without needing a background job. Postgres handles the durable audit trail since it needs to survive Redis flushes.

**Q: What's DUMB mode actually doing?**
> In DUMB mode, the dashboard toggles a visual state showing what would happen if agents had no shared context. The mode toggle emits `mode:change` over Socket.IO. In a full implementation, this would signal agents to stop fetching context before each LLM call — simulating agents working in isolation. The "DUMB MODE DAMAGE" counter in the Dev Panel tracks accumulated unresolved conflicts and stale writes during the demo.

**Q: How does this scale beyond 2 agents?**
> The architecture is N-agent capable. Each agent connects as a named Socket.IO client (`room:{devId}`). The dependency graph, lock system, and conflict detection all work with any number of concurrent agents. The blast radius BFS is cycle-safe (visited Set). The main practical limit is Redis throughput for entity reads on each diff event, which is trivially high for typical team sizes.
