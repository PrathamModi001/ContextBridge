export type AgentMode = 'smart' | 'dumb'

export interface AgentConfig {
  dev: string
  task: string
  mode: AgentMode
  serverUrl: string
  workspace: string
}

export interface ConflictInfo {
  entity: string
  yourSignature: string
  liveSignature: string
  severity: string
  devId: string
  correctedCall: string
}

export interface ValidationResult {
  conflicts: ConflictInfo[]
}
