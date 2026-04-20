export type EntityKind = 'function' | 'type' | 'interface' | 'class'

export interface Entity {
  name: string
  kind: EntityKind
  signature: string
  body: string
  file: string
  line: number
}

export interface EntityDiff {
  name: string
  kind: EntityKind
  oldSig: string | null
  newSig: string
  body: string
  file: string
  line: number
}
