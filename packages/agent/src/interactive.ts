import * as readline from 'readline'
import * as fs from 'fs'
import * as path from 'path'
import { io, type Socket } from 'socket.io-client'
import Groq from 'groq-sdk'
import dotenv from 'dotenv'

dotenv.config({ path: path.resolve(process.cwd(), '.env') })

// ─── ANSI ─────────────────────────────────────────────────────────────────────
const C = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  cyan:   '\x1b[36m',
  amber:  '\x1b[33m',
  green:  '\x1b[32m',
  red:    '\x1b[31m',
  orange: '\x1b[38;5;208m',
  blue:   '\x1b[34m',
  gray:   '\x1b[90m',
  white:  '\x1b[97m',
}

// ─── Config ───────────────────────────────────────────────────────────────────
const DEV_ID    = process.argv[2] || 'devA'
const DEV_COLOR = DEV_ID === 'devA' ? C.cyan : C.amber
const SERVER    = process.env.CB_SERVER ?? 'http://localhost:3000'
const WORKSPACE = path.resolve(process.cwd(), `packages/demo/workspace-${DEV_ID}`)
const MODEL     = process.env.DEFAULT_LLM ?? 'llama-3.3-70b-versatile'

// ─── Utils ────────────────────────────────────────────────────────────────────
function tag(label: string, color: string) {
  return `${color}${C.bold}[${label}]${C.reset}`
}

function readWorkspace(): { filename: string; content: string }[] {
  if (!fs.existsSync(WORKSPACE)) return []
  return fs.readdirSync(WORKSPACE)
    .filter(f => f.endsWith('.ts'))
    .sort()
    .map(f => ({ filename: f, content: fs.readFileSync(path.join(WORKSPACE, f), 'utf8') }))
}

function printWorkspaceInfo() {
  const files = readWorkspace()
  if (files.length === 0) {
    console.log(`${C.gray}  Workspace is empty — run: npm run demo:seed${C.reset}\n`)
    return
  }
  console.log(`${C.gray}  Workspace:${C.reset}`)
  for (const { filename, content } of files) {
    const entities = (content.match(/^export\s+(async\s+)?function\s+\w+|^export\s+class\s+\w+|^export\s+(interface|type)\s+\w+/gm) ?? [])
      .map(e => e.replace(/^export\s+(async\s+)?/, '').split(/\s+/)[1])
    const entityStr = entities.length > 0
      ? ` ${C.gray}→ ${entities.slice(0, 4).join(', ')}${entities.length > 4 ? ` +${entities.length - 4}` : ''}${C.reset}`
      : ''
    console.log(`  ${DEV_COLOR}·${C.reset} ${C.white}${filename}${C.reset}${entityStr}`)
  }
  console.log()
}

async function fetchContext(): Promise<string> {
  try {
    const res = await fetch(`${SERVER}/v1/context/snapshot?format=markdown`)
    if (!res.ok) return '(server returned error — is the server running?)'
    return await res.text()
  } catch {
    return '(could not reach server at ' + SERVER + ')'
  }
}

// ─── LLM ──────────────────────────────────────────────────────────────────────
function buildSystem(filesText: string, context: string): string {
  return `You are ${DEV_ID}, a TypeScript developer on a team monitored by ContextBridge.

=== YOUR WORKSPACE FILES ===
${filesText}

=== LIVE CODEBASE CONTEXT (entities owned by all developers) ===
${context}

When the user asks you to make a code change, respond in EXACTLY this format — no text before or after:

ENTITY: <the primary function/class/interface name you modified>
KIND: <function|class|interface|type>
FILE: <filename in the workspace, e.g. auth.ts>
OLD_SIG: <old signature, or null if this is a new entity>
NEW_SIG: <new complete signature including return type>

\`\`\`typescript
<COMPLETE content of the modified file — the WHOLE file, not just the changed part>
\`\`\`

Rules:
- Return ONLY the structured format above — no prose, no explanation
- The code block MUST be the entire file content
- Do NOT import from files not in the workspace
- Write clean, valid, idiomatic TypeScript`
}

interface ParsedEdit {
  entity: string
  kind:   string
  file:   string
  oldSig: string | null
  newSig: string | null
  code:   string
}

function parseResponse(raw: string): ParsedEdit | null {
  const get = (key: string) => raw.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))?.[1]?.trim()
  const codeMatch = raw.match(/```(?:typescript|ts)?\s*\n([\s\S]*?)```/)
  const entity = get('ENTITY')
  const file   = get('FILE')
  if (!entity || !file || !codeMatch) return null
  const oldSig = get('OLD_SIG')
  return {
    entity,
    kind:   get('KIND') ?? 'function',
    file,
    oldSig: !oldSig || oldSig.toLowerCase() === 'null' ? null : oldSig,
    newSig: get('NEW_SIG') ?? null,
    code:   codeMatch[1].trim(),
  }
}

function writeEdit(edit: ParsedEdit): void {
  const filePath = path.resolve(WORKSPACE, edit.file)
  const boundary = WORKSPACE.endsWith(path.sep) ? WORKSPACE : WORKSPACE + path.sep
  if (!filePath.startsWith(boundary)) throw new Error('Path traversal blocked')
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, edit.code + '\n', 'utf8')
}

// ─── Seed ─────────────────────────────────────────────────────────────────────
function seedWorkspace(): void {
  const AUTH = `export async function validateUser(id: string): Promise<{ id: string; name: string }> {
  return { id, name: 'user' }
}

export async function loginUser(email: string, password: string): Promise<{ token: string } | null> {
  if (!email || !password) return null
  return { token: 'jwt-token-placeholder' }
}

export function hashPassword(password: string): string {
  return Buffer.from(password).toString('base64')
}

export type Permission = 'read' | 'write' | 'admin'

export interface AuthConfig {
  secret: string
  ttl:    number
  maxAttempts?: number
}
`

  const USER_SVC = `import { validateUser, type Permission } from './auth'

export class UserService {
  async getUser(id: string) {
    return validateUser(id)
  }

  async createUser(email: string, name: string) {
    return { id: Math.random().toString(36).slice(2), email, name }
  }

  async updateUser(id: string, data: Partial<{ name: string; email: string }>) {
    const user = await validateUser(id)
    return { ...user, ...data }
  }

  async checkPermission(userId: string, _permission: Permission): Promise<boolean> {
    const user = await validateUser(userId)
    return !!user
  }
}

export async function getUser(id: string): Promise<{ id: string; name: string }> {
  return validateUser(id)
}
`

  const API = `import { UserService } from './user.service'

const svc = new UserService()

export async function getUserProfile(userId: string) {
  return svc.getUser(userId)
}

export async function updateProfile(userId: string, data: { name?: string; email?: string }) {
  return svc.updateUser(userId, data)
}

export async function searchUsers(query: string): Promise<{ id: string; name: string }[]> {
  void query
  return []
}
`

  const FILES: Record<string, string> = {
    'auth.ts':         AUTH,
    'user.service.ts': USER_SVC,
    'api.ts':          API,
  }

  fs.mkdirSync(WORKSPACE, { recursive: true })
  for (const [name, content] of Object.entries(FILES)) {
    fs.writeFileSync(path.join(WORKSPACE, name), content, 'utf8')
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  if (!process.env.GROQ_API_KEY) {
    console.error(`\n${C.red}${C.bold}Missing GROQ_API_KEY${C.reset}`)
    console.error(`Add it to your .env file:  GROQ_API_KEY=gsk_...`)
    process.exit(1)
  }

  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })

  // ── Banner ─────────────────────────────────────────────────────────────────
  console.clear()
  console.log(`${DEV_COLOR}${C.bold}`)
  console.log('  ╔═══════════════════════════════════════════════════╗')
  console.log(`  ║  ContextBridge  ·  ${DEV_ID.padEnd(8)} ·  Coding Agent   ║`)
  console.log('  ╚═══════════════════════════════════════════════════╝')
  console.log(C.reset)
  console.log(`${C.gray}  server:    ${SERVER}${C.reset}`)
  console.log(`${C.gray}  workspace: ${WORKSPACE}${C.reset}`)
  console.log(`${C.gray}  model:     ${MODEL}${C.reset}`)
  console.log()

  // ── Seed if workspace is empty ─────────────────────────────────────────────
  if (!fs.existsSync(WORKSPACE) || fs.readdirSync(WORKSPACE).filter(f => f.endsWith('.ts')).length === 0) {
    console.log(`${tag('INIT', C.gray)} Seeding workspace...`)
    seedWorkspace()
    console.log(`${tag('INIT', C.green)} Workspace ready\n`)
  }

  // ── Socket ─────────────────────────────────────────────────────────────────
  let conflictSound = false
  const socket: Socket = io(SERVER, {
    auth: { devId: DEV_ID },
    reconnection: true,
    reconnectionDelay: 2000,
  })

  socket.on('connect', () => {
    console.log(`${tag('CB', C.green)} Connected as ${DEV_COLOR}${C.bold}${DEV_ID}${C.reset}`)
    console.log()
    printWorkspaceInfo()
    showHints()
    rl.prompt()
  })

  socket.on('connect_error', () => {
    if (!conflictSound) {
      console.log(`${tag('CB', C.red)} Cannot reach server at ${SERVER} — retrying...`)
      console.log(`${C.gray}  Make sure the server is running: npm run dev -w packages/server${C.reset}\n`)
      conflictSound = true
    }
  })

  socket.on('disconnect', (reason: string) => {
    console.log(`\n${tag('CB', C.red)} Disconnected (${reason})\n`)
  })

  socket.on('conflict:detected', (payload: Record<string, unknown>) => {
    const sev = String(payload.severity ?? 'info')
    const sevColor = sev === 'critical' ? C.red : sev === 'warning' ? C.orange : C.cyan
    const impact = Number(payload.impactCount ?? 0)
    console.log()
    console.log(`${tag('⚡ CONFLICT', C.red)} ${C.bold}${String(payload.entityName)}${C.reset}`)
    console.log(`  ${C.gray}owner:${C.reset}    ${DEV_COLOR}${String(payload.devAId)}${C.reset}`)
    console.log(`  ${C.gray}modifier:${C.reset} ${C.amber}${String(payload.devBId)}${C.reset}`)
    console.log(`  ${C.gray}severity:${C.reset} ${sevColor}${C.bold}${sev}${C.reset}${impact > 0 ? `  ${C.gray}(${impact} dependent${impact !== 1 ? 's' : ''} affected)${C.reset}` : ''}`)
    console.log(`  ${C.gray}→ dashboard: http://localhost:5173${C.reset}`)
    console.log()
    rl.prompt()
  })

  // ── Readline ───────────────────────────────────────────────────────────────
  const rl = readline.createInterface({
    input:    process.stdin,
    output:   process.stdout,
    prompt:   `${DEV_COLOR}${C.bold}${DEV_ID}${C.reset} ${C.gray}▸${C.reset} `,
    terminal: true,
  })

  function showHints() {
    console.log(`${C.gray}  Type a task in plain English, e.g.:${C.reset}`)
    console.log(`${C.gray}  "add email validation to validateUser"${C.reset}`)
    console.log(`${C.gray}  "add rate limiting to loginUser"${C.reset}`)
    console.log(`${C.gray}  Special: ${C.white}ls${C.gray}  ctx  reset  quit${C.reset}`)
    console.log()
  }

  rl.on('line', async (line: string) => {
    const cmd = line.trim()
    if (!cmd) { rl.prompt(); return }

    // ── Built-in commands ────────────────────────────────────────────────────
    if (cmd === 'quit' || cmd === 'exit') {
      console.log(`${C.gray}Disconnecting...${C.reset}`)
      socket.disconnect()
      rl.close()
      process.exit(0)
    }

    if (cmd === 'ls') {
      printWorkspaceInfo()
      rl.prompt()
      return
    }

    if (cmd === 'ctx') {
      console.log(`${tag('CB', C.cyan)} Fetching live context...`)
      const ctx = await fetchContext()
      console.log()
      console.log(ctx)
      console.log()
      rl.prompt()
      return
    }

    if (cmd === 'reset') {
      seedWorkspace()
      console.log(`${tag('INIT', C.green)} Workspace reset to initial state\n`)
      printWorkspaceInfo()
      rl.prompt()
      return
    }

    if (cmd === 'help') {
      showHints()
      rl.prompt()
      return
    }

    // ── LLM task ─────────────────────────────────────────────────────────────
    const files = readWorkspace()
    if (files.length === 0) {
      console.log(`${C.red}Workspace is empty. Run: reset${C.reset}\n`)
      rl.prompt()
      return
    }

    const filesText = files.map(f => `=== ${f.filename} ===\n${f.content}`).join('\n\n')

    console.log()
    console.log(`${tag('LLM', C.blue)} ${C.gray}${MODEL} — thinking...${C.reset}`)

    let context = '(no active entities yet)'
    try { context = await fetchContext() } catch { /* non-fatal */ }

    let raw: string
    try {
      const completion = await groq.chat.completions.create({
        model: MODEL,
        messages: [
          { role: 'system', content: buildSystem(filesText, context) },
          { role: 'user',   content: cmd },
        ],
        temperature: 0.1,
        max_tokens:  2048,
      })
      raw = completion.choices[0]?.message?.content ?? ''
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.log(`${tag('LLM', C.red)} API error: ${msg}\n`)
      rl.prompt()
      return
    }

    const edit = parseResponse(raw)
    if (!edit) {
      console.log(`${tag('LLM', C.red)} Could not parse response — try rephrasing your task`)
      console.log(`${C.gray}First 300 chars of raw response:${C.reset}`)
      console.log(C.gray + raw.slice(0, 300) + C.reset + '\n')
      rl.prompt()
      return
    }

    try {
      writeEdit(edit)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.log(`${tag('FS', C.red)} Write failed: ${msg}\n`)
      rl.prompt()
      return
    }

    // ── Emit entity:diff ──────────────────────────────────────────────────────
    socket.emit('entity:diff', [{
      name:   edit.entity,
      kind:   edit.kind,
      oldSig: edit.oldSig ?? '',
      newSig: edit.newSig ?? edit.entity,
      body:   edit.code.slice(0, 500),
      file:   edit.file,
      line:   1,
    }])

    console.log(`${tag('LLM', C.green)} ${C.white}${C.bold}${edit.entity}${C.reset} → ${edit.file}`)
    if (edit.oldSig) {
      console.log(`  ${C.red}−${C.reset} ${C.gray}${edit.oldSig}${C.reset}`)
    }
    if (edit.newSig) {
      console.log(`  ${C.green}+${C.reset} ${edit.newSig}`)
    }
    console.log(`${tag('CB', C.cyan)} entity:diff sent  (watching for conflicts...)`)
    console.log()

    rl.prompt()
  })

  rl.on('close', () => {
    socket.disconnect()
    process.exit(0)
  })
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
