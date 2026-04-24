import { getRedisClient } from '../../config/redis'
import { createModuleLogger } from '../../logger/logger'

const log = createModuleLogger('context-service')

export interface EntitySnapshot {
  name: string
  kind: string
  signature: string
  body: string
  devId: string
  file: string
  line: number
  updatedAt: string
}

export interface ContextSnapshot {
  snapshotAt: string
  entityCount: number
  entities: EntitySnapshot[]
}

export interface ConflictInfo {
  entity: string
  yourSignature: string
  liveSignature: string
  severity: string
  devId: string
  correctedCall: string
}

/* ─── helpers ─── */

const KEYWORDS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'function', 'class',
  'return', 'new', 'await', 'typeof', 'instanceof', 'void', 'delete',
  'throw', 'yield', 'async', 'export', 'import', 'const', 'let', 'var',
  'require', 'console', 'process', 'setTimeout', 'clearTimeout',
  'setInterval', 'clearInterval', 'Promise', 'Array', 'Object', 'JSON',
  'Math', 'Date', 'Error', 'Map', 'Set', 'String', 'Number', 'Boolean',
])

function extractFunctionCalls(code: string): { name: string; args: string[]; argCount: number }[] {
  const seen = new Set<string>()
  const calls: { name: string; args: string[]; argCount: number }[] = []
  const regex = /\b([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(([^)]*)\)/g
  let match
  while ((match = regex.exec(code)) !== null) {
    const name = match[1]
    if (KEYWORDS.has(name) || seen.has(name)) continue
    seen.add(name)
    const argsStr = match[2].trim()
    const args = argsStr ? argsStr.split(',').map(a => a.trim()).filter(Boolean) : []
    calls.push({ name, args, argCount: args.length })
  }
  return calls
}

function countRequiredParams(signature: string): number {
  const m = signature.match(/\(([^)]*)\)/)
  if (!m || !m[1].trim()) return 0
  return m[1].split(',').map(p => p.trim()).filter(p => p && !p.includes('?')).length
}

function countTotalParams(signature: string): number {
  const m = signature.match(/\(([^)]*)\)/)
  if (!m || !m[1].trim()) return 0
  return m[1].split(',').map(p => p.trim()).filter(Boolean).length
}

function buildCorrectedCall(name: string, signature: string): string {
  const m = signature.match(/\(([^)]*)\)/)
  if (!m) return `${name}(...)`
  const params = m[1].split(',').map(p => {
    const clean = p.trim()
    const paramName = clean.split(/[?:]/)[0].trim()
    const paramType = clean.includes(':') ? clean.split(':').slice(1).join(':').trim() : ''
    return paramName || paramType || 'arg'
  }).filter(Boolean)
  return `${name}(${params.join(', ')})`
}

/* ─── public API ─── */

export async function buildSnapshot(options?: { entity?: string; depth?: number }): Promise<ContextSnapshot> {
  const redis = getRedisClient()
  const allKeys: string[] = []

  let cursor = '0'
  do {
    const [next, batch] = await redis.scan(cursor, 'MATCH', 'entity:*', 'COUNT', 100)
    cursor = next
    allKeys.push(...(batch as string[]).filter((k: string) => k.split(':').length === 2))
  } while (cursor !== '0')

  const entities: EntitySnapshot[] = []
  for (const key of allKeys) {
    try {
      const fields = await redis.hgetall(key)
      if (!fields || Object.keys(fields).length === 0) continue
      entities.push({
        name: key.replace('entity:', ''),
        kind: fields.kind ?? 'unknown',
        signature: fields.signature ?? '',
        body: fields.body ?? '',
        devId: fields.devId ?? '',
        file: fields.file ?? '',
        line: parseInt(fields.line ?? '0', 10),
        updatedAt: fields.updatedAt ?? '',
      })
    } catch (err) {
      log.warn({ err, key }, 'failed to read entity')
    }
  }

  const filtered = options?.entity
    ? entities.filter(e => e.name === options.entity)
    : entities

  return {
    snapshotAt: new Date().toISOString(),
    entityCount: filtered.length,
    entities: filtered,
  }
}

export function buildMarkdownSnapshot(snapshot: ContextSnapshot): string {
  const lines: string[] = [
    `# ContextBridge Snapshot`,
    `_Generated at: ${snapshot.snapshotAt}_`,
    ``,
    `## Entities (${snapshot.entityCount} total)`,
    ``,
  ]

  for (const e of snapshot.entities) {
    lines.push(`### ${e.name}`)
    lines.push(`- **Kind:** ${e.kind}`)
    lines.push(`- **Dev:** ${e.devId || '(none)'}`)
    lines.push(`- **File:** ${e.file || '(unknown)'}`)
    lines.push(`- **Signature:** \`${e.signature}\``)
    if (e.body) {
      lines.push(`- **Body:**`)
      lines.push(`  \`\`\`typescript`)
      e.body.split('\n').forEach(l => lines.push(`  ${l}`))
      lines.push(`  \`\`\``)
    }
    lines.push(``)
  }

  return lines.join('\n')
}

export async function validateCodeUsage(code: string): Promise<ConflictInfo[]> {
  const redis = getRedisClient()
  const calls = extractFunctionCalls(code)
  const conflicts: ConflictInfo[] = []

  for (const call of calls) {
    const state = await redis.hgetall(`entity:${call.name}`)
    if (!state || Object.keys(state).length === 0) continue
    if (state.kind !== 'function') continue

    const required = countRequiredParams(state.signature)
    const total = countTotalParams(state.signature)

    if (call.argCount < required) {
      conflicts.push({
        entity: call.name,
        yourSignature: `${call.name}(${call.args.join(', ')})`,
        liveSignature: state.signature,
        severity: 'warning',
        devId: state.devId ?? '',
        correctedCall: buildCorrectedCall(call.name, state.signature),
      })
    } else if (call.argCount > total && total > 0) {
      conflicts.push({
        entity: call.name,
        yourSignature: `${call.name}(${call.args.join(', ')})`,
        liveSignature: state.signature,
        severity: 'info',
        devId: state.devId ?? '',
        correctedCall: buildCorrectedCall(call.name, state.signature),
      })
    }
  }

  return conflicts
}
