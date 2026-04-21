# Day 2 — TypeScript AST Parser + Entity Differ

**Goal:** Client package that parses `.ts` files into typed entities (functions, types, interfaces, classes) and diffs consecutive parses to detect signature changes.

## Packages Created

- `packages/client` — file watcher + parser + differ + Socket.IO client

## What Was Built

### 1. Types (`src/types.ts`)

```ts
export type EntityKind = 'function' | 'type' | 'interface' | 'class'

export interface Entity {
  name: string; kind: EntityKind; signature: string
  body: string; file: string; line: number
}

export interface EntityDiff {
  name: string; kind: EntityKind
  oldSig: string | null   // null = new entity
  newSig: string
  body: string; file: string; line: number
}
```

### 2. Parser (`src/parser.ts`)

Uses **tree-sitter** + **tree-sitter-typescript** to walk the AST and extract top-level declarations.

**Key decision — always full re-parse:**  
Passing `prevTree` to `parser.parse()` without calling `tree.edit()` corrupts byte offsets when source length changes. All incremental parses are full re-parses; trees are cached but not passed back.

```ts
parse(filePath: string, source: string): Entity[] {
  const tree = this.parser.parse(source)   // full parse, no prevTree
  this.previousTrees.set(filePath, tree)
  return this.extractTopLevel(tree.rootNode, filePath)
}
```

**Extraction logic (`tryExtract`):**  
Handles `export_statement` wrapper via `childForFieldName('declaration')` with fallback to `children.find()`. Then dispatches on node type:

| Node type | Extractor | Signature format |
|-----------|-----------|-----------------|
| `function_declaration` | `extractFunction` | `name(params): returnType` |
| `lexical_declaration` / `variable_declaration` | `extractArrowFunction` | same as function |
| `type_alias_declaration` | `extractType` | full normalized text |
| `interface_declaration` | `extractInterface` | full normalized text |
| `class_declaration` | `extractClass` | header only (before `{`) |

Non-arrow consts (e.g. `const MAX = 3`) → `null` (skipped).  
Only top-level nodes extracted — nested functions inside functions are ignored.

### 3. Differ (`src/differ.ts`)

```ts
export function diffEntities(prev: Entity[], next: Entity[]): EntityDiff[] {
  const prevMap = new Map(prev.map(e => [e.name, e]))
  for (const entity of next) {
    const existing = prevMap.get(entity.name)
    if (!existing)                                    // new entity → oldSig: null
    else if (existing.signature !== entity.signature) // sig changed → oldSig: prev sig
    // body-only / line-only / file-only changes → ignored
  }
}
```

Detection rules:
- **New entity**: in `next` but not in `prev` → `oldSig: null`
- **Signature change**: same name, different `signature` → emit diff
- **Deleted entity**: in `prev` but not in `next` → **not tracked** (server owns state)
- **Body-only change**: same signature → ignored (not an API contract change)

## Test Coverage

| Suite | Tests | What it covers |
|-------|-------|----------------|
| `parser.test.ts` | 40+ | all entity kinds, generics, optional params, nested fn exclusion, arrow vs non-arrow, edge cases (empty/comments/imports/re-export/export-default), incremental scenarios |
| `differ.test.ts` | 25+ | no-diff (identical/empty/body-only/line/file), new entities (all fields preserved), sig changes (param add/remove, return type, optional), mixed lists, large list (50+1), type shape |
| **Total** | **63** | |

Notable edge cases covered:
- `export { foo } from './bar'` (re-export) → no crash, no entity
- `export default 42` → no crash, no entity
- `const MAX_RETRIES = 3` → not extracted (not arrow function)
- Generic functions: `identity<T>(val: T): T` — signature preserved
- 50 unchanged + 1 new entity → only 1 diff returned
- Multi-file isolation: parses for `fileA.ts` and `fileB.ts` stay independent
