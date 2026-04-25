# ContextBridge — Live Demo Guide

Two developers, two terminals, one shared codebase. Type natural-language tasks to an LLM. When both devs edit the same function, ContextBridge catches the conflict in real time.

---

## Setup (one-time)

```bash
# 1. Start Redis + Postgres
docker compose up -d

# 2. Add your Groq key to .env
echo "GROQ_API_KEY=gsk_your_key_here" >> .env
```

---

## Running the Demo

### Terminal 1 — Server + Dashboard

```bash
npm run demo:infra
```

Open **http://localhost:5173** in a browser. You'll see the ContextBridge dashboard: empty graph, two dev slots in the PRESENCE panel, no conflicts.

---

### Terminal 2 — Developer A

```bash
npm run dev:a
```

You'll see a prompt:

```
  ╔═══════════════════════════════════════════════════╗
  ║  ContextBridge  ·  devA     ·  Coding Agent   ║
  ╚═══════════════════════════════════════════════════╝

[CB] Connected as devA

  Workspace:
  · auth.ts          → validateUser, loginUser, hashPassword
  · user.service.ts  → UserService, getUser
  · api.ts           → getUserProfile, updateProfile, searchUsers

devA ▸ _
```

---

### Terminal 3 — Developer B

```bash
npm run dev:b
```

Same interface, connected as `devB`.

---

## Triggering a Conflict

The key: **both devs edit the same function**. Start with something safe, then collide.

### Step 1 — devA makes a change (no conflict yet)

In **Terminal 2**:
```
devA ▸ add input validation to validateUser — reject empty id
```

Watch the dashboard: a new node `validateUser` appears in the graph with devA's color ring.

---

### Step 2 — devB edits a different function (still no conflict)

In **Terminal 3**:
```
devB ▸ add pagination support to searchUsers
```

Dashboard: `searchUsers` node appears with devB's color.

---

### Step 3 — devB touches devA's entity (conflict!)

In **Terminal 3**:
```
devB ▸ add rate limiting to validateUser — max 5 calls per second
```

Both terminals show the conflict alert:

**Terminal 2 (devA):**
```
[⚡ CONFLICT] validateUser
  owner:    devA
  modifier: devB
  severity: info  (0 dependents)
  → dashboard: http://localhost:5173
```

**Dashboard:** New conflict card in the CONFLICT LOG panel. The BottomBar ticker starts scrolling the conflict. The graph node for `validateUser` changes color to reflect the conflict severity.

---

## More Conflict Scenarios

### High-impact conflict (warning severity)

Have devA modify `validateUser`. Since `UserService.getUser` and `getUserProfile` both call it, it has dependents — so the severity will be `warning`.

```
devA ▸ change validateUser to also accept an options object with a cache flag
devB ▸ change validateUser to return null instead of throwing when user is not found
```

### Class modification

```
devA ▸ add a deleteUser method to UserService
devB ▸ add a bulkDelete method to UserService
```

---

## REPL Commands

| Command | What it does |
|---|---|
| `ls` | List workspace files and the entities in each |
| `ctx` | Show the live ContextBridge context — all entities tracked across all devs |
| `reset` | Reset workspace files to the initial seed state |
| `quit` | Disconnect and exit |
| Any other text | Sent to Groq → LLM edits workspace → entity:diff emitted |

---

## What the Dashboard Shows

| Panel | What to look at |
|---|---|
| **Graph** (center) | Each node = one tracked entity. Colored ring = owning dev. Hover for signature tooltip. |
| **PRESENCE** (left) | devA and devB online status, entity counts, last-edited entity |
| **CONFLICT LOG** (right) | One card per conflict. `[CRIT]`/`[WARN]`/`[INFO]` badge. Diff block showing old → new sig. |
| **BottomBar** | Scrolling ticker of conflicts. WS dot = connection status. |
| **TopBar** | Live entity + conflict counts. SMART/DUMB mode toggle. |

---

## How It Works (one paragraph)

Each interactive agent connects to the ContextBridge server as a named developer. When you type a task, Groq's LLM reads the workspace files and the live codebase context, then returns the modified file plus entity metadata (name, old signature, new signature). The agent writes the file and emits an `entity:diff` event via Socket.IO. The server stores entity ownership in Redis and runs conflict detection: if the entity is already owned by a different dev, it fires `conflict:detected` to all connected dashboard clients. The React dashboard listens on the same WebSocket and renders the conflict in real time — graph update, conflict card, ticker scroll — all within ~400ms of the second dev's edit.
