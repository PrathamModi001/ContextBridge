# Day 3 — File Watcher, Socket.IO Client, Pipeline Orchestrator

**Goal:** Client watches a workspace directory, parses changed `.ts` files, diffs against previous parse, sends `entity:diff` events to server. Sends heartbeat every 10s.

## Files Created

- `src/logger.ts` — pino logger factory
- `src/watcher.ts` — chokidar file watcher
- `src/socket.ts` — socket.io-client wrapper + heartbeat
- `src/pipeline.ts` — parse + diff + emit orchestrator
- `src/index.ts` — CLI entry point

## What Was Built

### 1. Logger (`src/logger.ts`)
Thin pino wrapper. All modules call `createLogger(name)` → child logger with module name tag. `LOG_LEVEL=silent` in tests suppresses output.

### 2. Watcher (`src/watcher.ts`)
```ts
export function createWatcher(
  workspace: string,
  onChange: ChangeCallback,
  opts: WatcherOptions = {},   // awaitWriteFinish, ignoreInitial
): chokidar.FSWatcher
```

- Watches `workspace/**/*.ts` glob (forward-slash normalized for Windows)
- Ignores `node_modules` and `.d.ts` files
- `awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 }` — waits for writes to settle before firing
- Fires `onChange(filePath)` for both `add` and `change` events
- Options exposed so tests can use lower `stabilityThreshold` for faster feedback

### 3. Socket Client (`src/socket.ts`)
```ts
export function createSocketClient(serverUrl: string, devId: string): SocketHandle
export function emitEntityDiff(emitter: Emitter, diffs: EntityDiff[]): void
```

- Connects with `auth: { devId }` and `reconnection: true`
- Sets up `setInterval` at 10s — emits `heartbeat: { devId, ts }` when `socket.connected`
- `socket.on('disconnect')` clears the interval
- Returns `{ socket, close() }` — `close()` clears interval + calls `socket.disconnect()`
- `emitEntityDiff` accepts `Emitter` interface (not raw `Socket`) — decoupled from socket.io types

### 4. Pipeline (`src/pipeline.ts`)
```ts
export interface ParserLike {
  parse(filePath: string, source: string): Entity[]
  clearCache(filePath: string): void
}

export function createPipeline(parser: ParserLike, onDiff: DiffCallback): Pipeline
```

Pipeline accepts `ParserLike` as a dependency (not creating `TSParser` internally). For each file:
1. `fs.readFileSync` → catch errors silently (log + return, state unchanged)
2. `parser.parse(filePath, source)` → `Entity[]`
3. `diffEntities(prev, next)` — prev is `Map<string, Entity[]>` keyed by path
4. Store new entities regardless of diffs
5. If diffs exist → `onDiff(filePath, diffs)`

`clearFile(path)` removes stored entities + calls `parser.clearCache` → next parse treated as fresh.

**Key design decision — DI for parser:**  
Tree-sitter's native `.node` addon, when loaded inside Jest's module registry, corrupts `tree.rootNode` across test file boundaries when `--runInBand`. Accepting `ParserLike` as a parameter means `pipeline.test.ts` never touches tree-sitter; tests inject a `jest.fn()` mock parser instead.

### 5. CLI Entry (`src/index.ts`)
Parses `--dev`, `--workspace`, `--server` args. Wires watcher → pipeline → socket. SIGINT/SIGTERM triggers `watcher.close()` + `socket.disconnect()`.

## Test Coverage

| Suite | Tests | Approach |
|-------|-------|----------|
| `watcher.test.ts` | 14 | Real FS + tmp dir, `jest.setTimeout(15s)` |
| `socket.test.ts` | 22 | `jest.mock('socket.io-client')`, `jest.useFakeTimers()` |
| `pipeline.test.ts` | 19 | Mock `ParserLike`, real tmp files for `fs.readFileSync` |
| **New total** | **52** | |

**Watcher test highlights:**
- `waitForNthCall(fn, n)` helper polls at 30ms intervals with configurable timeout
- Tests use `FAST_OPTS = { awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 25 } }`
- Verified: `.js`, `.d.ts`, `node_modules/**` do NOT trigger onChange
- Verified: pre-existing files fire `add` by default; suppressed with `ignoreInitial: true`

**Socket test highlights:**
- `MockSocket` class: `on` is `jest.fn().mockImplementation(...)` — trackable AND captures handlers in `_handlers` map so `trigger(event)` can fire them in tests
- Heartbeat: `jest.useFakeTimers()` + `jest.advanceTimersByTime(10_000)` — asserts emit count exactly
- `close()` test: advance 30s after close → 0 heartbeats emitted

**Pipeline test highlights:**
- File read error: passes missing path → no throw, no onDiff, parser not called
- Error does not wipe stored state: previous entities survive a failed read
- `clearFile` scope: only resets target file; sibling files still track their own prev state
