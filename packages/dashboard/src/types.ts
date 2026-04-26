export type Severity = 'critical' | 'warning' | 'info'
export type EntityKind = 'function' | 'type' | 'interface' | 'class'
export type AgentMode = 'smart' | 'dumb'

export interface GraphNode {
  id: string
  name: string
  kind: EntityKind
  devId: string
  signature: string
  file: string
  severity: Severity
  locked: boolean
  dependentsCount: number
  conflictSessionId?: string
  /* D3 simulation fields */
  x?: number
  y?: number
  vx?: number
  vy?: number
  fx?: number | null
  fy?: number | null
}

export interface GraphLink {
  source: string | GraphNode
  target: string | GraphNode
  conflict: boolean
  severity?: Severity
  /* D3 simulation index */
  index?: number
}

export interface ConflictEvent {
  id:         string
  entityName: string
  severity:   Severity
  devAId:     string
  devBId:     string
  oldSig:     string
  newSig:     string
  impactCount: number
  timestamp:  string
}

export interface DevStatus {
  devId: string
  connected: boolean
  lastHeartbeat: number
  entities: string[]
  lastEntity?: string
}

export interface EntityUpdateEvent {
  name: string
  devId: string
  signature: string
  kind?: EntityKind
  file?: string
  severity: Severity
  locked: boolean
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

export type ConflictType =
  | 'signature_drift'
  | 'ghost_call'
  | 'auth_bypass'
  | 'type_violation'
  | 'blast_cascade'

export interface ConflictSession {
  id:                string
  entityName:        string
  devAId:            string
  devBId:            string
  devABody:          string
  devASig:           string
  devBBody:          string
  devBSig:           string
  status:            'open' | 'resolving' | 'resolved'
  detectedAt:        string
  blastRadius:       number
  securitySensitive: boolean
  conflictType:      ConflictType
  resolvedBy?:       string
  resolutionType?:   'accepted_a' | 'accepted_b' | 'manual_merge'
}

export interface BlastUpdateEvent {
  sessionId:      string
  blastRadius:    number
  newStaleEntity: string
  devId:          string
}

export interface ConflictResolvedEvent {
  sessionId:      string
  entityName:     string
  resolutionType: 'accepted_a' | 'accepted_b' | 'manual_merge'
  resolvedBy:     string
}
