# Day 4 — Server Entity Registry + Graph Service + Socket Handlers

**Goal:** Server handles `entity:diff` and `heartbeat` socket events. Writes entity state to Redis. Maintains a dependency graph and client reverse index for future conflict detection.

## Files Created / Modified

- `src/services/entity/entity.service.ts` — new
- `src/services/graph/graph.service.ts` — new
- `src/socket.ts` — updated (added event handlers + TTL expiry)

## What Was Built

### 1. Entity Service (`src/services/entity/entity.service.ts`)

`handleDiff(devId, entities)` is the core write path. For each entity in the diff:

```ts
// 1. Store full entity state in Redis hash
await redis.hset(`entity:${name}`, {
  signature, body, devId, file,
  line: String(line),   // stored as string (Redis is string-only)
  kind, updatedAt: new Date().toISOString(),
})

// 2. Claim ownership lock with 15s TTL
await redis.set(`lock:${name}`, devId, 'EX', 15)

// 3. Track which entities this dev owns
await redis.sadd(`client:${devId}:entities`, name)

// 4. Fire-and-forget Postgres audit write
writeEntityChangeAsync(devId, entity)
```

`writeEntityChangeAsync` is intentionally fire-and-forget — it inserts into `entity_changes` but `.catch()`es errors so DB failures never block the Redis write path.

### 2. Graph Service (`src/services/graph/graph.service.ts`)

Tracks the dependency graph in Redis sets.

| Function | Redis key | Purpose |
|----------|-----------|---------|
| `updateDependents(entity, called[])` | `entity:{name}:dependents` | Record what `entity` calls |
| `getDependents(entity)` | `entity:{name}:dependents` | Who does this entity call? |
| `updateClientIndex(devId, names[])` | `entity:{name}:clients` | Which devs reference this entity |
| `getEntityClients(entity)` | `entity:{name}:clients` | Route push notifications |
| `getImpactCount(entity)` | BFS across dependents | Transitive impact score |

`getImpactCount` uses BFS with a `visited` set to handle cycles:
```ts
while (queue.length > 0) {
  const current = queue.shift()!
  if (visited.has(current)) continue   // cycle guard
  visited.add(current)
  const deps = await redis.smembers(`entity:${current}:dependents`)
  queue.push(...deps.filter(d => !visited.has(d)))
}
return visited.size - 1   // excludes root entity itself
```

### 3. Updated Socket (`src/socket.ts`)

Added exported handler functions for testability (called from inside socket event closures):

```ts
export async function handleEntityDiffEvent(devId, payload): Promise<void>
// → calls entityService.handleDiff; errors caught inside socket event

export async function handleHeartbeatEvent(devId): Promise<void>
// → redis.set(`client:${devId}:heartbeat`, '1', 'EX', 30)
```

Added `subscribeToKeyExpiry(io)` at the end of `initSocket`:
- Duplicates the Redis connection into a subscriber-mode client
- Listens on `__keyevent@0__:expired` (requires Redis `notify-keyspace-events Ex`)
- When `client:{devId}:heartbeat` expires: cleans up all entity hashes owned by that dev, removes dev from entity client sets, emits `client:disconnected`

## Key Design Decision — extracted handler functions

Socket event handlers live inside closures inside `io.on('connection', ...)`. To test their logic without mocking socket.io, the real logic is extracted into exported `handleEntityDiffEvent` and `handleHeartbeatEvent`. The socket event just calls these + wraps in try/catch.

## Test Coverage

| Suite | Tests | What's mocked |
|-------|-------|---------------|
| `entity.service.test.ts` | 17 | `getRedisClient`, `db.query` |
| `graph.service.test.ts` | 18 | `getRedisClient` |
| `socket.handlers.test.ts` | 11 | `getRedisClient`, `entity.service.handleDiff` |
| **New total** | **46** | |

**Notable test cases:**
- `line` stored as string (Redis is string-only — verified via `typeof fields.line === 'string'`)
- `db.query` error does not propagate (fire-and-forget confirmed)
- `getImpactCount` diamond graph: A→B, A→C, B→D, C→D → count=3 (D visited once)
- `getImpactCount` circular: A→B→A → count=1, no infinite loop
- `mockRejectedValue` test isolation: must reset mock in `beforeEach` — `clearAllMocks` clears calls but NOT implementations; implementations bleed into subsequent tests

**Bug fixed:** `mockRejectedValue` in "propagates error" test was bleeding into subsequent tests because `jest.clearAllMocks()` doesn't reset implementations. Fixed by explicitly calling `.mockResolvedValue(undefined)` on the mock in `beforeEach`.
