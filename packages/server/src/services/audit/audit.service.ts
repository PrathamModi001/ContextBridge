import { db } from '../../config/postgres'
import { createModuleLogger } from '../../logger/logger'

const log = createModuleLogger('audit-service')

export interface AuditRecord {
  id: string
  entityName: string
  devId: string
  oldSignature: string | null
  newSignature: string
  severity: string
  kind: string | null
  body: string | null
  file: string | null
  line: number | null
  changedAt: string
}

function rowToRecord(row: Record<string, unknown>): AuditRecord {
  return {
    id: row.id as string,
    entityName: row.entity_name as string,
    devId: row.dev_id as string,
    oldSignature: row.old_signature as string | null,
    newSignature: row.new_signature as string,
    severity: row.severity as string,
    kind: row.kind as string | null,
    body: row.body as string | null,
    file: row.file as string | null,
    line: row.line as number | null,
    changedAt: (row.changed_at as Date).toISOString(),
  }
}

export async function getEntityHistory(entityName: string, limit = 50): Promise<AuditRecord[]> {
  const cap = Math.min(limit, 200)
  try {
    const result = await db.query(
      `SELECT * FROM entity_changes WHERE entity_name = $1 ORDER BY changed_at DESC LIMIT $2`,
      [entityName, cap],
    )
    return result.rows.map(rowToRecord)
  } catch (err) {
    log.error({ err }, 'getEntityHistory failed')
    throw err
  }
}

export async function getDevHistory(devId: string, limit = 50): Promise<AuditRecord[]> {
  const cap = Math.min(limit, 200)
  try {
    const result = await db.query(
      `SELECT * FROM entity_changes WHERE dev_id = $1 ORDER BY changed_at DESC LIMIT $2`,
      [devId, cap],
    )
    return result.rows.map(rowToRecord)
  } catch (err) {
    log.error({ err }, 'getDevHistory failed')
    throw err
  }
}

export async function getRecentChanges(limit = 50): Promise<AuditRecord[]> {
  const cap = Math.min(limit, 200)
  try {
    const result = await db.query(
      `SELECT * FROM entity_changes ORDER BY changed_at DESC LIMIT $1`,
      [cap],
    )
    return result.rows.map(rowToRecord)
  } catch (err) {
    log.error({ err }, 'getRecentChanges failed')
    throw err
  }
}
