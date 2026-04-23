# Day 7 — Postgres Audit Layer

**Goal:** Full audit trail in `entity_changes` — add missing columns (`kind`, `body`, `file`, `line`), wire them into the entity write path, expose history via REST endpoints.

## Files Created / Modified

- `src/config/postgres.ts` — updated (schema migration expanded)
- `src/services/entity/entity.service.ts` — updated (9-column INSERT)
- `src/services/audit/audit.service.ts` — new
- `src/routes/audit.routes.ts` — new
- `src/routes/router.ts` — updated (`/audit` registered)
- `__tests__/unit/audit.service.test.ts` — new (21 tests)
- `__tests__/unit/audit.routes.test.ts` — new (17 tests)
- `__tests__/unit/entity.service.test.ts` — updated (5 new tests)

## What Was Built

### 1. Schema Migration

Added idempotent `ALTER TABLE` statements to the MIGRATION string in `postgres.ts`:

```sql
ALTER TABLE entity_changes ADD COLUMN IF NOT EXISTS kind TEXT;
ALTER TABLE entity_changes ADD COLUMN IF NOT EXISTS body TEXT;
ALTER TABLE entity_changes ADD COLUMN IF NOT EXISTS file TEXT;
ALTER TABLE entity_changes ADD COLUMN IF NOT EXISTS line INT;
```

`IF NOT EXISTS` makes re-runs safe on existing databases.

### 2. Updated Write Path (`entity.service.ts`)

`writeEntityChangeAsync` now writes all entity fields:

```ts
db.query(
  `INSERT INTO entity_changes
     (entity_name, dev_id, old_signature, new_signature, severity, kind, body, file, line)
   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
  [entity.name, devId, entity.oldSig, entity.newSig, 'info',
   entity.kind, entity.body, entity.file, entity.line],
)
```

Still fire-and-forget — DB failures logged but never block the Redis write path.

### 3. Audit Service (`src/services/audit/audit.service.ts`)

| Function | SQL | Default limit |
|----------|-----|---------------|
| `getEntityHistory(name, limit)` | `WHERE entity_name = $1 ORDER BY changed_at DESC LIMIT $2` | 50 |
| `getDevHistory(devId, limit)` | `WHERE dev_id = $1 ORDER BY changed_at DESC LIMIT $2` | 50 |
| `getRecentChanges(limit)` | `ORDER BY changed_at DESC LIMIT $1` | 50 |

All three: cap limit at 200, re-throw errors (unlike fire-and-forget write path).

`rowToRecord` maps DB snake_case → camelCase `AuditRecord`. Key detail:
```ts
changedAt: (row.changed_at as Date).toISOString()
```
`pg` returns `TIMESTAMPTZ` as a JS `Date` object — must call `.toISOString()` explicitly.

### 4. Audit Routes (`src/routes/audit.routes.ts`)

Mounted at `/v1/audit`:

| Endpoint | Handler |
|----------|---------|
| `GET /entities/:name?limit=N` | `getEntityHistoryHandler` |
| `GET /devs/:devId?limit=N` | `getDevHistoryHandler` |
| `GET /recent?limit=N` | `getRecentChangesHandler` |

`parseLimit` helper (shared across all handlers):
```ts
function parseLimit(raw: unknown): number {
  const n = parseInt(raw as string, 10)
  return isNaN(n) || n < 1 ? 50 : Math.min(n, 200)
}
```
NaN and negative values → 50. Values > 200 → capped at 200.

## Test Coverage

| Suite | Tests | What's Tested |
|-------|-------|---------------|
| `audit.service.test.ts` | 21 | SQL content, param forwarding, field mapping (camelCase), ISO date, null handling, default/capped limits, error propagation, empty results |
| `audit.routes.test.ts` | 17 | Param forwarding to service, limit parsing (default/parsed/NaN/capped), JSON response, next(err) on failure |
| `entity.service.test.ts` | +5 | args[4]–[8]: severity='info', kind, body, file, line in db.query call |
| **Running total** | **212** | |
