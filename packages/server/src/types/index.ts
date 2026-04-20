export type EntityKind = 'function' | 'type' | 'interface' | 'class'
export type Severity = 'critical' | 'warning' | 'info'

export interface EntityState {
  name: string
  kind: EntityKind
  signature: string
  body: string
  devId: string
  file: string
  line: number
  updatedAt: string
}

export interface EntityDiffPayload {
  name: string
  kind: EntityKind
  oldSig: string | null
  newSig: string
  body: string
  file: string
  line: number
}

export interface ConflictPayload {
  entityName: string
  severity: Severity
  devAId: string
  devBId: string
  oldSig: string
  newSig: string
  impactCount: number
}
