# Day 5 — Conflict Detection Service + Socket Push Notifications

**Goal:** Detect when two devs edit the same entity simultaneously. Classify severity by dependency impact. Push `entity:conflict` events to all affected clients via Socket.IO rooms.

## Files Created / Modified

- `src/services/conflict/conflict.detector.ts` — new
- `src/socket.ts` — updated (conflict detection + critical audit fixes)
- `__tests__/unit/conflict.detector.test.ts` — new (17 tests)
- `__tests__/unit/socket.handlers.test.ts` — updated (8 new conflict tests)

## What Was Built

### 1. Conflict Detector (`src/services/conflict/conflict.detector.ts`)

Three exported functions:

**`detectConflict(entityName, requestingDevId, newSig)`** — core detection:
```ts
const currentOwner = await redis.get(`lock:${entityName}`)
if (!currentOwner || currentOwner === requestingDevId) return null

const [oldSig, impactCount] = await Promise.all([
  redis.hget(`entity:${entityName}`, 'signature'),
  getImpactCount(entityName),
])
return { entityName, severity, devAId: currentOwner, devBId: requestingDevId, oldSig: oldSig ?? '', newSig, impactCount }
```

Checks `lock:{name}` key before `handleDiff` overwrites it — guarantees detection window.

**`classifySeverity(impactCount)`**:
| Impact | Severity |
|--------|----------|
| 0 | `info` |
| 1–9 | `warning` |
| ≥10 | `critical` |

Uses existing `Severity` type from `types/index.ts`.

**`storeConflict(conflict)`** — persists to Redis for REST access:
```ts
await redis.lpush('conflicts:recent', JSON.stringify(conflict))
await redis.ltrim('conflicts:recent', 0, 99)  // cap at 100
```

### 2. Updated Socket (`src/socket.ts`)

`handleEntityDiffEvent` now returns `Promise<ConflictPayload[]>`:

```ts
export async function handleEntityDiffEvent(devId, payload): Promise<ConflictPayload[]> {
  const conflicts: ConflictPayload[] = []
  for (const entity of payload) {
    const conflict = await detectConflict(entity.name, devId, entity.newSig)
    if (conflict) { conflicts.push(conflict); await storeConflict(conflict) }
  }
  await entityService.handleDiff(devId, payload)
  return conflicts
}
```

The socket event handler emits to affected rooms:
```ts
const clients = await getEntityClients(conflict.entityName)
const targets = new Set([...clients, conflict.devAId, devId])
for (const clientId of targets) io.to(`room:${clientId}`).emit('entity:conflict', conflict)
```

### 3. Audit Fixes Applied

**CRITICAL — devId extraction bug:**
```ts
// Before (wrong for devIds containing ':')
const devId = key.split(':')[1]

// After (correct)
const parts = key.split(':')
const devId = parts.slice(1, -1).join(':')
```

**CRITICAL — heartbeat devId spoofing:**
```ts
// Before (any client could refresh another client's heartbeat)
socket.on('heartbeat', async ({ devId: hbDevId }) => handleHeartbeatEvent(hbDevId ?? devId))

// After (always use authenticated devId)
socket.on('heartbeat', async () => handleHeartbeatEvent(devId))
```

## Test Coverage

| Suite | Tests | What's Tested |
|-------|-------|---------------|
| `conflict.detector.test.ts` | 17 | classifySeverity thresholds, detectConflict null paths, ConflictPayload fields, storeConflict Redis calls |
| `socket.handlers.test.ts` (new) | +8 | detectConflict called N times for N entities, storeConflict conditional, return value shape |
| **Running total** | **168** | |

**Notable test cases:**
- `detectConflict` returns null when lock is absent OR same dev — both paths verified
- `oldSig` is `''` (not null) when `hget` returns null — explicit null coalescing tested
- Conflict array returned from `handleEntityDiffEvent` — return type change covered
- `handleDiff` still called even when conflicts detected — regression guard
