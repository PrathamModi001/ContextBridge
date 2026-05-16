# agent — LLM Coding Assistant

**Single responsibility:** Generate TypeScript code using live codebase context, validate output against live signatures, write result to workspace.

---

## File Map

```
packages/agent/src/
├── index.ts        ← CLI entry: parses args, calls runAgent() or interactive mode
├── agent.ts        ← core SMART/DUMB orchestration loop
├── context.ts      ← fetchContext() and validateUsage() — talks to server REST API
├── groq.ts         ← Groq SDK wrapper: generateCode(), extractCodeBlock()
├── workspace.ts    ← writeToWorkspace(), inferFilename()
├── interactive.ts  ← REPL loop for interactive demo sessions
└── types.ts        ← AgentConfig, ValidationResult
```

---

## SMART vs DUMB Mode

```
SMART mode (default)                    DUMB mode
────────────────────                    ─────────
1. GET /context/snapshot                1. No context fetch
   → Markdown of all live entities         
2. Build system prompt with context     2. Generic system prompt
3. Groq: generate code (70B model)      3. Groq: generate code (8B model)
4. POST /context/validate               4. Write to workspace
   → check signatures in generated code    (done — faster, but produces conflicts)
5. If conflicts → re-generate once
   with specific corrections appended
6. POST /context/validate again
   → warn if still failing
7. Write to workspace
```

---

## Two-Round Re-generation

When SMART mode detects signature mismatches after first generation:

```
conflicts = [
  { entity: "validateUser",
    yourSignature: "validateUser(id)",
    liveSignature: "validateUser(id, permissions[])",
    correctedCall: "validateUser(userId, userPermissions)" }
]

correctedTask = original_task + "\n\nFIX THESE:\n• validateUser: ..."
→ re-send to Groq with same system context
→ validate again
→ warn if still failing (best-effort, proceed anyway)
```

---

## System Prompts

**SMART system prompt injects:**
```
Here is the current live state of all entities across all developers:

## validateUser
- Kind: function
- Signature: `validateUser(id: string, permissions: string[]): Promise<User>`
...

CRITICAL RULES:
- Use exact signatures above. Never wrong argument counts.
- Output only TypeScript in a single ```typescript block.
```

**DUMB system prompt:** Just "Generate clean TypeScript. Output in a ```typescript block."

---

## Signature Validator

`POST /context/validate` — server compares function calls in generated code against live entity signatures:

```
regex: /\b([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g
→ extract all function call names from code
→ for each call: compare arg count against live signature
→ flag: missing required params (warning)
→ flag: extra params (info)
→ return correctedCall suggestion
```

---

## Workspace Write

`writeToWorkspace(workspace, filename, code)`:
- Resolves path relative to workspace root
- Creates file with generated TypeScript
- Path validated against workspace root (no path traversal)

`inferFilename(task)`:
- Extracts noun from task string (e.g., "create auth service" → `auth-service.ts`)
- Falls back to `generated.ts`
