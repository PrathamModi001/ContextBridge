# Day 1 — Server Foundation

**Goal:** Express server with middleware stack, Redis + Postgres connections, Socket.IO stub, config/env validation, full unit + integration test coverage.

## Packages Created

- `packages/server` — Express API server
- Root `package.json` with npm workspaces (`packages/*`)

## What Was Built

### 1. Environment Config (`src/config/env.ts`)
Validates all required env vars at startup. Throws on missing required vars; provides defaults for optional ones.

```ts
function required(key: string): string {
  const val = process.env[key]
  if (!val) throw new Error(`Missing required env var: ${key}`)
  return val
}
export const env = { port, nodeEnv, redisUrl, postgres: { host, port, database, user, password }, groqApiKey }
```

Required: `REDIS_URL`, `POSTGRES_HOST`, `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`  
Optional with defaults: `PORT=3000`, `NODE_ENV=development`, `GROQ_API_KEY=''`, `POSTGRES_PORT=5432`

### 2. Redis (`src/config/redis.ts`)
ioredis singleton with `lazyConnect: true`. `connectRedis()` calls `client.connect()` explicitly at startup.

### 3. Postgres (`src/config/postgres.ts`)
pg Pool singleton. `connectPostgres()` runs `SELECT 1` health check then migration SQL:
- `entities` — tracks current entity state per dev
- `entity_changes` — append-only audit log
- `conflicts` — active conflicts with severity

### 4. Middleware

**`ApiError`** — typed HTTP errors with factory helpers:
```ts
export class ApiError extends Error {
  constructor(public statusCode: number, message: string) { ... }
}
export const notFound = (msg: string) => new ApiError(404, msg)
export const badRequest = (msg: string) => new ApiError(400, msg)
export const unauthorized = (msg: string) => new ApiError(401, msg)
```

**`globalErrorHandler`** — handles ApiError, ZodError (→ 400 with details), SyntaxError (malformed JSON → 400), fallback 500.

**`validateRequest`** — Zod schema validation for body/params/query. Calls `next(zodError)` on failure; schema fields are optional so you only validate what you need.

### 5. Express App (`src/app.ts`)
```
helmet → cors → express.json → cookieParser → /v1 router → 404 catch-all → globalErrorHandler
```

### 6. Socket.IO Stub (`src/socket.ts`)
`initSocket(httpServer)` — client connects with `devId`, joins `room:${devId}`, emits `client:connected`. Handles `join` event for `room:dashboard`.

### 7. Health Route
`GET /v1/health` → `{ status: 'ok', ts: Date.now() }`

## Test Coverage

| Suite | Tests | What it covers |
|-------|-------|----------------|
| `env.test.ts` | 10 | Each required var missing throws, optional var defaults |
| `errorHandler.test.ts` | 15 | ApiError construction, factory helpers, all handler branches |
| `validateRequest.test.ts` | 16 | body/params/query, coercion, defaults, multi-schema |
| `health.test.ts` (integration) | 10 | 200+body, headers, helmet, POST→404, malformed JSON→400 |
| **Total** | **51** | |

Key pattern: env tests set **all** required vars in `beforeEach` via `DEFAULTS` object, then delete the target var — avoids cross-test pollution from dotenv module cache.

## Infra

- `jest.config.js`: `ts-jest`, `--runInBand --forceExit`, `setupFiles` sets `LOG_LEVEL=silent`
- Logger: pino with `createModuleLogger(module)` returning child logger; silenced in tests
