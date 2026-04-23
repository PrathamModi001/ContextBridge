# Day 6 — REST API Routes + Docker Setup

**Goal:** Expose entity state, dependency graph, client registrations, and recent conflicts via HTTP. Full Docker setup with Redis (keyspace events enabled) and Postgres.

## Files Created / Modified

- `src/routes/entity.routes.ts` — new
- `src/routes/client.routes.ts` — new
- `src/routes/conflict.routes.ts` — new
- `src/routes/router.ts` — updated
- `Dockerfile` — new
- `docker-compose.yml` — new
- `.dockerignore` — new
- `jest.setup.ts` — updated (test env vars for integration tests)
- `__tests__/unit/entity.routes.test.ts` — new (19 tests)
- `__tests__/unit/client.routes.test.ts` — new (6 tests)
- `__tests__/unit/conflict.routes.test.ts` — new (7 tests)

## What Was Built

### 1. Route Files

All handlers exported as named functions for direct unit testing (no supertest needed):

**`entity.routes.ts`** — mounted at `/v1/entities`:
| Endpoint | Handler | Redis / Service |
|----------|---------|-----------------|
| `GET /:name` | `getEntityHandler` | `hgetall entity:{name}` → 404 if empty |
| `GET /:name/impact` | `getEntityImpactHandler` | `getImpactCount(name)` |
| `GET /:name/dependents` | `getEntityDependentsHandler` | `getDependents(name)` |
| `GET /:name/clients` | `getEntityClientsHandler` | `getEntityClients(name)` |

Key detail — `line` field stored as string in Redis, parsed to number in response:
```ts
res.json({ ...fields, line: parseInt(fields.line, 10) })
```

404 guard handles both ioredis v5 return shapes (`null` and `{}`):
```ts
if (!fields || Object.keys(fields).length === 0) return void next(notFound(...))
```

**`client.routes.ts`** — mounted at `/v1/clients`:
- `GET /:devId/entities` → `smembers client:{devId}:entities`

**`conflict.routes.ts`** — mounted at `/v1/conflicts`:
- `GET /` → `lrange conflicts:recent 0 99` → JSON.parse each element

### 2. Docker Setup

**`Dockerfile`** — multi-stage:
- Stage 1 (`builder`): `node:20-alpine`, installs deps, runs `tsc`
- Stage 2 (`production`): copies only `dist/`, installs `--omit=dev`, healthcheck via `/v1/health`

**`docker-compose.yml`** — three services with healthchecks:
```yaml
redis:
  command: redis-server --notify-keyspace-events Ex  # fixes CRITICAL audit issue
  healthcheck: redis-cli ping

postgres:
  image: postgres:16-alpine
  volumes: [pgdata]
  healthcheck: pg_isready

server:
  depends_on:
    redis: { condition: service_healthy }
    postgres: { condition: service_healthy }
```

`--notify-keyspace-events Ex` in Redis command resolves the Day 5 audit finding: keyspace notifications were disabled by default, making heartbeat TTL cleanup silently dead.

### 3. Test Strategy

Unit tests call handlers directly with mock req/res/next — no supertest or HTTP layer:
```ts
const makeReq = (params = {}) => ({ params }) as unknown as Request
const makeRes = () => ({ json: jest.fn(), status: jest.fn().mockReturnThis() }) as unknown as Response
await getEntityHandler(makeReq({ name: 'foo' }), makeRes(), makeNext())
```

Integration test (`health.test.ts`) fixed: `jest.setup.ts` now sets all required env vars with test defaults so `env.ts` doesn't throw at import time.

## Test Coverage

| Suite | Tests |
|-------|-------|
| `entity.routes.test.ts` | 19 |
| `client.routes.test.ts` | 6 |
| `conflict.routes.test.ts` | 7 |
| `integration/health.test.ts` | 10 (was failing, now fixed) |
| **Running total** | **168** |
