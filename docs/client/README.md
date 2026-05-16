# client — File Watcher + AST Parser

**Single responsibility:** Watch TypeScript files, parse them into semantic entities, diff against previous state, stream changes to server.

---

## File Map

```
packages/client/src/
├── index.ts       ← entry point: wires watcher → pipeline → socket
├── watcher.ts     ← chokidar file watcher
├── parser.ts      ← Tree-sitter AST parser (TSParser class)
├── differ.ts      ← entity-level diff (old vs new entity arrays)
├── pipeline.ts    ← stateful per-file processing (parse → diff → callback)
├── socket.ts      ← Socket.IO client (connects, emits entity:diff, heartbeat)
├── types.ts       ← Entity, EntityDiff, EntityKind
└── logger.ts      ← pino child logger
```

---

## Data Flow

```
file saved
    │
    ▼
watcher.ts  (chokidar, awaitWriteFinish: 100ms)
    │  filePath
    ▼
pipeline.ts  processFile(filePath)
    │  fs.readFileSync → source string
    ▼
parser.ts  TSParser.parse(filePath, source)
    │  Entity[]  (name, kind, signature, body, file, line)
    ▼
differ.ts  diffEntities(prev, next)
    │  EntityDiff[]  (added | modified | deleted)
    ▼
socket.ts  emit('entity:diff', diffs)
    │
    ▼
server  ← receives EntityDiffPayload[]
```

---

## Tree-sitter Parser

Parses the full AST on every save (no incremental mode — byte offsets require explicit `tree.edit()` calls which aren't tracked here).

**What it extracts:**

```
export_statement
    └── declaration  ← unwrapped and handled as the inner node

function_declaration           → extractFunction()
lexical_declaration            → extractArrowFunction()   (only if value is arrow_function)
variable_declaration           → extractArrowFunction()
type_alias_declaration         → extractType()
interface_declaration          → extractInterface()
class_declaration              → extractClass()
```

**Signature format per kind:**

| Kind | Signature |
|------|-----------|
| `function` | `name(params): returnType` |
| `function` (arrow) | `name(params): returnType` |
| `type` | full text, whitespace normalized |
| `interface` | full text, whitespace normalized |
| `class` | header only — text up to body node start |

---

## Differ

Compares previous and next `Entity[]` arrays by name:

```
modified  →  entity in both prev and next, signature changed
added     →  entity in next but not in prev
deleted   →  entity in prev but not in next
```

Deleted entities are sent to server with `newSig = ''` so the server can clean up the lock and entity state.

---

## Watcher

- Uses `chokidar` with `awaitWriteFinish: { stabilityThreshold: 100 }` — waits for 100ms of no writes before firing. Prevents partial-file reads mid-save.
- Watches `**/*.ts` and `**/*.tsx`, ignores `node_modules` and `dist`.
- On `add` and `change`: calls `pipeline.processFile()`
- On `unlink`: calls `pipeline.clearFile()` — removes per-file entity state

---

## Socket Client

- Connects with `auth: { devId }` so server can route events to the right room
- Sends `heartbeat` every 20s to renew entity lock TTLs
- Listens for `conflict:accepted` — when server resolves a conflict, writes the accepted body back to the workspace file at the path returned in the event
