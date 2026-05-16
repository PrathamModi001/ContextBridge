# ContextBridge — Interview Prep

30 questions an interviewer will ask. Each includes the ideal answer from actual code and the follow-up.

---

## 1. System Design & Architecture

**Q1: Why did you use Redis instead of just Postgres for entity state?**

Entity reads happen on every `entity:diff` event — potentially hundreds per second. Redis hash reads (`hget`, `hgetall`) are sub-millisecond. Postgres round-trips are 1–10ms with connection pooling and add query parsing overhead. The entity registry is hot-path data. Postgres is used only for durable conflict audit — write-once, read rarely.

*Follow-up: What happens if Redis goes down?*
All entity operations fail — there's no fallback. A production version would add a read-through cache with Postgres as the source of truth.

---

**Q2: Why Socket.IO over HTTP polling for real-time updates?**

Polling adds artificial latency (minimum = poll interval) and burns server resources on empty responses. Socket.IO pushes events the moment they occur. When Dev B's file save causes a conflict, Dev A's dashboard updates in under 100ms — not on the next poll. Also, Socket.IO rooms allow targeted delivery: only the affected devs receive `entity:conflict`, not everyone.

*Follow-up: What's the overhead of maintaining persistent WebSocket connections?*
Each connection holds ~40KB of memory in Node.js. At 50 developers that's 2MB — negligible. At 5000 developers you'd need to shard across Socket.IO nodes with Redis adapter.

---

**Q3: How does the monorepo structure help you?**

`EntityDiffPayload` is defined once in `packages/server/src/types/index.ts`. The client package emits it; the server receives it. No type drift, no separate type packages to version. An atomic commit can update both the client emit shape and the server handler in one PR.

*Follow-up: What's the downside?*
Builds are coupled — a TypeScript error in `dashboard` blocks the entire `npm run build`. In a large team you'd use Nx or Turborepo to scope builds to changed packages.

---

**Q4: Why do you persist conflicts to Postgres if Redis already has them?**

Redis is the live state store. Its conflict list (`conflicts:recent`) is capped at 100 entries and is lost on restart. Postgres is the audit trail — permanent, queryable, survives restarts. The `audit` routes query Postgres for historical analysis. This is the write-through pattern: hot state in Redis, durable record in Postgres.

*Follow-up: What about the race condition between Redis and Postgres writes?*
The Postgres writes are fire-and-forget (`.catch()` logs errors). If Postgres is down, the system keeps working — conflicts are still detected and broadcast. The Postgres write is best-effort for the audit trail, not required for correctness.

---

**Q5: How does the dashboard always show current state even if it connects late?**

`sendDashboardSnapshot()` runs when the dashboard socket joins `room:dashboard`. It replays: all entity states from Redis, all graph edges, last 10 conflicts, and all open sessions. The dashboard starts cold and immediately gets a full snapshot. This is the same pattern event-sourced systems use for "catch-up subscriptions."

*Follow-up: What if there are 10,000 entities? This is O(N) on connect.*
Correct — it would be slow. Production fix: paginate the snapshot or use a Redis `SCAN` cursor with batching, and only send entities active in the last N minutes.

---

## 2. Data Structures & Algorithms

**Q6: Walk me through the BFS blast-radius algorithm.**

```
getImpactCount(entityName):
  visited = Set
  queue   = [entityName]

  while queue not empty:
    current = dequeue
    if current in visited → skip
    visited.add(current)
    dependents = redis.smembers(entity:{current}:dependents)
    push unvisited dependents to queue

  return visited.size - 1
```

`entity:{name}:dependents` is a Redis SET of entities that call this entity. We traverse the reverse dependency graph — starting from the changed entity, expanding to everything that depends on it transitively. The visited set prevents infinite loops for circular dependencies. Final count excludes the root entity itself.

*Follow-up: What's the time complexity?*
O(V + E) — V vertices (entities), E edges (dependency relationships). Same as standard BFS on a graph. All edge reads are Redis SET membership operations, O(1) per check.

---

**Q7: How do you represent the dependency graph? Why not an adjacency list in memory?**

Two Redis SETs per entity:
- `entity:{name}:dependents` — who calls this entity (reverse edges)
- `entity:{name}:calls` — what this entity calls (forward edges)

In-memory adjacency lists would work but lose state on server restart and don't survive across multiple server instances. Redis SETs persist across restarts and are naturally shared between processes. `sadd` and `smembers` are O(1)/O(N) respectively.

*Follow-up: How do you update the graph when an entity is deleted?*
`pipeline.clearFile()` on the client sends diffs with `newSig = ''`. The server's entity service removes the entity's key and calls `srem` to remove it from any `dependents` sets it was in.

---

**Q8: How does the differ work? What edge cases does it handle?**

`diffEntities(prev: Entity[], next: Entity[])`:
1. Build a map of prev entities by name
2. For each entity in next: if name not in prev → `added`; if signature changed → `modified`
3. For each entity in prev: if name not in next → `deleted`

Edge cases:
- **Renamed entity**: appears as one `deleted` + one `added` (no rename tracking — by design, treated as two separate entities)
- **Body-only change** (no signature change): emitted as `modified` because the body hash changes even if signature is the same
- **File deleted**: watcher fires `unlink` → `pipeline.clearFile()` → prev state cleared

*Follow-up: What if two entities in the same file are renamed simultaneously?*
Both get emitted as delete + add. The server will release the old lock and create a new entity. Any pending conflict on the old name becomes orphaned in Redis until TTL expiry.

---

## 3. Distributed Systems & Concurrency

**Q9: How do you prevent two developers from both thinking they own an entity?**

Entity ownership is a Redis STRING key: `lock:{entityName}` with TTL=300s. `SET lock:{entityName} {devId} NX EX 300` — SET only if Not eXists. The first writer wins. Subsequent writers see the existing key and trigger conflict detection.

*Follow-up: What about the time between TTL expiry and the next write? Can there be a race?*
Yes — Redis TTL expiry is not instantaneous at the application level. Two writers could both `GET lock:X`, see it expired, and both try `SET NX`. Redis SET NX is atomic — only one succeeds. The other gets a conflict. This is correct behavior.

---

**Q10: What's the race condition in the conflict resolution flow and how did you fix it?**

The route does:
1. `GET session` → check `status === 'open'`
2. `markResolving()` → `hset status: 'resolving'`
3. `resolveSession()`

Two concurrent POST requests could both pass step 1 before either completes step 2, then both call `resolveSession`. The fix: `resolveSession` now validates `status === 'resolving'` after fetching the session. If status is not `resolving`, it throws. The second concurrent request gets an error response.

*Follow-up: Is this fully race-condition-free?*
No — two requests could still both call `markResolving` before `resolveSession` runs. A fully safe solution uses a Redis Lua script to atomically check-and-set in one operation.

---

**Q11: How does the heartbeat mechanism prevent ghost locks?**

Every client sends a `heartbeat` event every 20s. The server sets `client:{devId}:heartbeat` with TTL=30s. On heartbeat, it also extends `lock:{entityName}` TTL for every entity the dev owns. If the client disconnects silently (crash, network drop), the heartbeat stops, the TTL expires, Redis fires a keyspace expiry event (`__keyevent@0__:expired`), and the server cleans up all owned entities and broadcasts `client:disconnected`.

*Follow-up: What if the keyspace event never fires (Redis misconfiguration)?*
The `lock:{name}` TTL still expires (300s). Entity state (`entity:{name}`) will persist as stale but the lock will release. The client state set won't be cleaned up — a minor memory leak until server restart.

---

## 4. TypeScript & Language-Level

**Q12: Why Tree-sitter instead of the TypeScript compiler API?**

The TS compiler API (ts.createSourceFile) is synchronous, can be slow on large files, and requires TypeScript to be installed as a dependency. Tree-sitter is language-agnostic and significantly faster for structural extraction. It also handles partial/broken files that the TS compiler would reject — useful when a developer is mid-edit and saves an invalid file.

*Follow-up: Why not regex?*
Regex breaks on nested generics (`Map<string, Array<User | null>>`), multi-line signatures, and decorator syntax. Tree-sitter produces a proper CST that handles all valid TypeScript constructs.

---

**Q13: Why do you full-re-parse on every save instead of using tree-sitter's incremental mode?**

Tree-sitter incremental parsing requires calling `tree.edit()` with exact byte offset ranges for each change. To compute those, you'd need to diff the raw source strings character by character before parsing — more complexity than just re-parsing. Full re-parse on a 500-line file takes ~2ms. For typical file sizes, this is fast enough.

*Follow-up: When would you switch to incremental?*
Files over 5000 lines where full re-parse takes >10ms. At that point, tracking edits via character offsets (or using a rope data structure) pays off.

---

**Q14: How does the parser handle `export const fn = () => ...`?**

```
export_statement
  └── declaration
        └── lexical_declaration
              └── variable_declarator
                    ├── name: "fn"
                    └── value: arrow_function
```

`tryExtract` first unwraps `export_statement` to get the inner declaration. Then `extractArrowFunction` iterates the `lexical_declaration`'s children looking for `variable_declarator` nodes. If the value is an `arrow_function`, it extracts the name from the declarator and params/return type from the arrow function node.

*Follow-up: What about `export default function() {...}`?* (anonymous)
`childForFieldName('name')` returns null → `extractFunction` returns null → entity is skipped. Anonymous exports are not tracked.

---

## 5. Databases

**Q15: Walk me through the Postgres schema for conflicts.**

```sql
conflicts (
  id                UUID PRIMARY KEY,
  entity_name       TEXT,
  dev_a_id          TEXT,
  dev_b_id          TEXT,
  description       TEXT,
  severity          TEXT,       -- critical | warning | info
  dev_a_body        TEXT,
  dev_b_body        TEXT,
  conflict_type     TEXT,       -- signature_drift | auth_bypass | ...
  security_sensitive BOOLEAN,
  conflict_session_id UUID,
  blast_radius      INT,
  detected_at       TIMESTAMPTZ,
  resolved          BOOLEAN DEFAULT false,
  resolution_type   TEXT,       -- accepted_a | accepted_b | manual_merge
  resolved_by       TEXT,
  resolved_at       TIMESTAMPTZ,
  merged_body       TEXT,
  merged_sig        TEXT
)

stale_writes (
  id                SERIAL PRIMARY KEY,
  dev_id            TEXT,
  entity_name       TEXT,
  conflict_session_id UUID REFERENCES conflicts(conflict_session_id),
  conflict_type     TEXT,
  written_at        TIMESTAMPTZ DEFAULT NOW()
)
```

*Follow-up: What indexes would you add for production?*
`CREATE INDEX ON conflicts (entity_name, detected_at DESC)` for entity audit queries. `CREATE INDEX ON conflicts (dev_a_id, dev_b_id)` for per-dev history. `CREATE INDEX ON conflicts (resolved, detected_at)` for open conflict listing.

---

**Q16: Why is the Postgres write fire-and-forget?**

The critical path is Redis → conflict detection → Socket.IO emit. Adding a Postgres await would add 5–20ms to every entity diff event. The audit record is best-effort — if Postgres is temporarily down, conflicts are still detected and broadcast. The log captures the error. A production system would use a write queue (BullMQ) to guarantee delivery.

*Follow-up: What data could you lose with fire-and-forget?*
The audit record for that specific conflict. The conflict itself is still fully handled and tracked in Redis. You lose historical reporting, not correctness.

---

## 6. Scalability & Production-Readiness

**Q17: What breaks first when you scale to 100 developers?**

`sendDashboardSnapshot()` does `redis.keys('entity:*')` which is O(N) and blocks the Redis event loop. At 10,000 entities this becomes slow enough to cause timeouts. Fix: replace with `redis.scan()` cursor pattern.

The second bottleneck: `getOpenSessions()` does `redis.keys('conflict:session:*')` — same problem. Fix: maintain a Redis SET of active session IDs.

*Follow-up: What about the Socket.IO server itself?*
Single Node.js process, single Socket.IO server. At 1000+ persistent connections you'd need multiple server instances with the Socket.IO Redis adapter to share room state.

---

**Q18: How would you add horizontal scaling (multiple server instances)?**

1. Add `@socket.io/redis-adapter` — all server instances share room membership via Redis pub/sub
2. Replace `redis.keys()` with `redis.scan()` cursor
3. Replace `lock:{name}` SET NX with a Lua script for atomic check-and-set
4. Add a load balancer with sticky sessions for WebSocket connections (or use `@socket.io/cluster-adapter`)

*Follow-up: What about the Postgres connection pool?*
Each instance has `max: 20` connections. At 10 instances that's 200 connections — within Postgres default limit (100). Would need PgBouncer for connection pooling at larger scale.

---

**Q19: The sub-100ms latency claim — what exactly is sub-100ms?**

- `GET /entities/:name` → Redis hgetall → ~1–5ms ✓
- `GET /entities/:name/impact` → BFS over Redis SETs → ~5–20ms for typical graphs ✓
- `entity:diff` processing → lock check + entity write + emit → ~10–30ms ✓
- `GET /context/snapshot` → full entity scan → **50–200ms** at 1000+ entities ✗

The snapshot endpoint can exceed 100ms under load. Everything else is comfortably sub-100ms.

*Follow-up: How would you fix the snapshot latency?*
Pre-compute and cache the markdown snapshot on each `entity:updated` event. Invalidate on any write. Cache in Redis as a single STRING. Snapshot serve time drops to a single `GET` → ~1ms.

---

**Q20: What's missing for a production deployment?**

| Missing | Impact |
|---------|--------|
| Redis cluster/sentinel | Single point of failure |
| Distributed locking (Lua atomics) | Race condition on concurrent resolves |
| Request tracing (X-Trace-ID) | Can't debug multi-step flows |
| WebSocket rate limiting per dev | One client can spam `entity:diff` |
| Postgres transactions for resolution | Partial failure leaves inconsistent state |
| Health check for Redis + Postgres | Load balancer can't detect degraded state |

*Follow-up: Which would you fix first?*
Distributed locking — it's the only one that causes incorrect behavior (not just operational pain).

---

## 7. AI/LLM Integration

**Q21: How does the context snapshot get formatted for LLM consumption?**

```markdown
## validateUser
- **Kind**: function
- **File**: src/auth.ts:42
- **Owner**: devA
- **Signature**: `validateUser(id: string, permissions: string[]): Promise<User>`
- **Body**:
```typescript
async function validateUser(...) { ... }
```

One block per entity. The agent injects this as the system prompt. The LLM sees exact current signatures and generates code that matches them.

*Follow-up: Why Markdown and not JSON?*
LLMs trained on code have seen Markdown in README files, docstrings, and documentation far more than structured JSON schemas for code context. Markdown reads naturally in context and tokens are used more efficiently on prose than on JSON punctuation.

---

**Q22: How does signature validation work after code generation?**

```
POST /context/validate { code: "...generated TypeScript..." }

1. Regex extracts all function call names from code
2. For each call: look up entity in Redis
3. Count required params in live signature
4. Count args in the generated call
5. If mismatch → add to conflicts[] with correctedCall suggestion
6. Return { conflicts: [...] }
```

The agent gets back specific mismatches with corrected calls. If conflicts exist, it re-generates once with the corrections appended to the prompt.

*Follow-up: Does this catch type mismatches, not just arity mismatches?*
No — only argument count is checked, not types. Full type checking would require running `tsc` on the generated code against the live type definitions, which would be significantly slower.

---

**Q23: What's the difference between SMART and DUMB agent mode?**

| | SMART | DUMB |
|--|-------|------|
| Context fetch | Yes — full Markdown snapshot | No |
| Model | 70B (llama-3.1-70b-versatile) | 8B (llama-3.1-8b-instant) |
| Validation | Two rounds | None |
| Conflict likelihood | Low (knows live state) | High (generates blind) |
| Cost | Higher tokens + API cost | Cheaper |
| Use case | Real multi-dev work | Demo: trigger conflicts |

DUMB mode is used in demos to intentionally create conflicts — one agent generates without context, producing stale signatures that the server catches immediately.

*Follow-up: What if even the 70B model can't fix the mismatch in two rounds?*
The agent logs a warning and proceeds with best-effort code. The client will still detect the conflict when the file is saved — conflict resolution happens at the file-save level regardless of what the agent outputs.

---

**Q24: How would you add multi-language support (Python, Go)?**

Tree-sitter has grammars for 100+ languages. The parser would:
1. Detect file extension → select grammar (`tree-sitter-python`, `tree-sitter-go`)
2. Map language-specific AST node types to the same 4 entity kinds
3. Everything else (Redis, conflict detection, Socket.IO) stays unchanged

The entity model is language-agnostic: `{ name, kind, signature, body, file, line }`. Only the parser changes.

*Follow-up: What's the hardest part of adding Python?*
Python functions have no explicit return types by default. Signature extraction would need to include type annotations if present, or fall back to just `name(params)` without return type. Consistency with TypeScript signatures (which always include return type) requires careful normalization.

---

**Q25: Why use Groq instead of OpenAI?**

Groq runs LLaMA models on custom LPU (Language Processing Unit) hardware. Inference speed is 10–20x faster than OpenAI's API for the same model size. For a real-time demo where you need code generated in under 2 seconds, Groq's ~500 token/sec output vs OpenAI's ~50 token/sec makes the demo feel responsive.

*Follow-up: What would you need to change to switch to Claude or GPT-4?*
Only `packages/agent/src/groq.ts` — swap the SDK client and model names. The rest of the agent pipeline (prompt construction, extraction, validation) is model-agnostic.

---

## Bonus: Quick-Fire Questions

**Q26: Why `awaitWriteFinish: 100ms` in chokidar?**
Editors like VS Code write files in multiple chunks. Without stabilization, chokidar fires mid-write and Tree-sitter sees partial TypeScript — invalid syntax, wrong AST. 100ms of quiet ensures the full file is on disk before parsing.

**Q27: Why does `getSession()` normalize boolean fields from Redis?**
Redis stores everything as strings. `hset` writes `"1"` for true, `"0"` for false. Without explicit parsing, `securitySensitive` would be the string `"1"` — which is truthy but not `=== true`. The mapper converts: `data.securitySensitive === '1'`.

**Q28: Why does the class extractor only capture the header, not the full body?**
A class body can be thousands of lines. Storing the full body in Redis for every class would bloat memory. The signature (class header including extends/implements) is sufficient to detect drift. The full body is only stored for functions where the implementation matters for validation.

**Q29: Why use pino instead of console.log?**
pino outputs structured JSON logs with sub-millisecond timestamps. In production, these feed into log aggregators (Datadog, CloudWatch) where you can query `level: error` across all instances. `console.log` is unstructured text — impossible to query at scale.

**Q30: What would you add to make this genuinely production-ready in 2 weeks?**
1. Redis Lua script for atomic lock acquire (fix race condition)
2. `redis.scan()` to replace `redis.keys()` (fix O(N) blocking)
3. X-Trace-ID middleware + propagate through service calls (observability)
4. Per-dev WebSocket rate limiting on `entity:diff` (abuse prevention)
5. Postgres transaction wrapping the resolve flow (consistency)
6. `/health/detailed` endpoint checking Redis ping + Postgres query time

*Follow-up: Why those 6 specifically?*
Items 1–2 fix correctness and performance. Items 3–6 fix operability. A system that works correctly but can't be debugged or monitored in production isn't production-ready.
