export type EntityKind  = 'function' | 'type' | 'interface' | 'class'
export type Severity    = 'critical' | 'warning' | 'info'
export type ConflictType =
  | 'signature_drift'
  | 'ghost_call'
  | 'auth_bypass'
  | 'type_violation'
  | 'blast_cascade'

export interface EntityState {
  name:      string
  kind:      EntityKind
  signature: string
  body:      string
  devId:     string
  file:      string
  line:      number
  updatedAt: string
}

export interface EntityDiffPayload {
  name:   string
  kind:   EntityKind
  oldSig: string | null
  newSig: string
  body:   string
  file:   string
  line:   number
}

export interface ConflictPayload {
  entityName:  string
  severity:    Severity
  devAId:      string
  devBId:      string
  oldSig:      string
  newSig:      string
  impactCount: number
}

export interface EnrichedConflictPayload extends ConflictPayload {
  sessionId:         string
  conflictType:      ConflictType
  securitySensitive: boolean
  devABody:          string
  devBBody:          string
}

export interface ConflictSession {
  id:              string
  entityName:      string
  devAId:          string
  devBId:          string
  devABody:        string
  devASig:         string
  devBBody:        string
  devBSig:         string
  status:          'open' | 'resolving' | 'resolved'
  detectedAt:      string
  resolvedAt?:     string
  resolvedBy?:     string
  resolutionType?: 'accepted_a' | 'accepted_b' | 'manual_merge'
  mergedBody?:     string
  mergedSig?:      string
  blastRadius:     number
  securitySensitive: boolean
  conflictType:    ConflictType
}

export interface Resolution {
  type:        'accepted_a' | 'accepted_b' | 'manual_merge'
  mergedBody:  string
  mergedSig:   string
  resolvedBy:  string
}
