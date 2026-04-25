import type { ConflictEvent } from '../types'
import { devColor } from '../utils/devColor'

interface Props {
  connected: boolean
  entityCount: number
  conflictCount: number
  conflicts: ConflictEvent[]
}

const SEV_COLOR: Record<string, string> = {
  info:     'var(--color-cyan)',
  warning:  'var(--color-orange)',
  critical: 'var(--color-red)',
}

export function BottomBar({ connected, entityCount, conflictCount, conflicts }: Props) {
  return (
    <footer
      style={{
        height: 34,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        borderTop: '1px solid var(--color-border)',
        background: 'var(--color-surface)',
        overflow: 'hidden',
        fontFamily: 'IBM Plex Mono, monospace',
        fontSize: 10,
      }}
    >
      {/* WS status */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '0 14px',
          borderRight: '1px solid var(--color-border)',
          height: '100%',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            display: 'block',
            width: 5,
            height: 5,
            borderRadius: '50%',
            background: connected ? 'var(--color-cyan)' : 'var(--color-text-3)',
            flexShrink: 0,
          }}
        />
        <span style={{ color: 'var(--color-text-2)', letterSpacing: '0.05em' }}>WS</span>
      </div>

      {/* Ticker / nominal */}
      <div style={{ flex: 1, overflow: 'hidden', padding: '0 10px', display: 'flex', alignItems: 'center' }}>
        {conflicts.length > 0 ? (
          <Ticker conflicts={conflicts} />
        ) : (
          <NominalLine entityCount={entityCount} conflictCount={conflictCount} />
        )}
      </div>

      {/* Version */}
      <div
        style={{
          padding: '0 14px',
          borderLeft: '1px solid var(--color-border)',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          flexShrink: 0,
        }}
      >
        <span style={{ color: 'var(--color-text-3)', letterSpacing: '0.04em' }}>CB·1.0</span>
      </div>
    </footer>
  )
}

function NominalLine({ entityCount, conflictCount }: { entityCount: number; conflictCount: number }) {
  void conflictCount
  return (
    <span style={{ color: 'var(--color-text-3)', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>
      SYSTEM NOMINAL
      {entityCount > 0
        ? ` · MONITORING ${entityCount} ${entityCount === 1 ? 'ENTITY' : 'ENTITIES'}`
        : ' · NO ACTIVE CONFLICTS'}
    </span>
  )
}

function Ticker({ conflicts }: { conflicts: ConflictEvent[] }) {
  const doubled  = [...conflicts, ...conflicts]
  const duration = Math.max(10, conflicts.length * 6)

  return (
    <div style={{ overflow: 'hidden', width: '100%', position: 'relative' }}>
      {/* Fade edges */}
      <div style={{
        position: 'absolute', left: 0, top: 0, bottom: 0, width: 20,
        background: 'linear-gradient(to right, var(--color-surface), transparent)',
        zIndex: 1, pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute', right: 0, top: 0, bottom: 0, width: 20,
        background: 'linear-gradient(to left, var(--color-surface), transparent)',
        zIndex: 1, pointerEvents: 'none',
      }} />

      <div
        style={{
          display: 'inline-flex',
          gap: 0,
          whiteSpace: 'nowrap',
          animation: `ticker-scroll ${duration}s linear infinite`,
          willChange: 'transform',
        }}
      >
        {doubled.map((c, i) => <TickerItem key={i} conflict={c} />)}
      </div>
    </div>
  )
}

function TickerItem({ conflict }: { conflict: ConflictEvent }) {
  const sevColor  = SEV_COLOR[conflict.severity] ?? 'var(--color-text-2)'
  const colorA    = devColor(conflict.devAId)
  const colorB    = devColor(conflict.devBId)
  const time      = new Date(conflict.timestamp).toLocaleTimeString([], {
    hour: '2-digit', minute: '2-digit', hour12: false,
  })

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, paddingRight: 28 }}>
      {/* Time */}
      <span style={{ color: 'var(--color-text-3)', fontSize: 9 }}>{time}</span>

      {/* Severity */}
      <span style={{ color: sevColor, fontWeight: 600, letterSpacing: '0.04em' }}>
        [{conflict.severity.slice(0, 4).toUpperCase()}]
      </span>

      {/* Entity */}
      <span style={{ color: 'var(--color-text-2)' }}>{conflict.entityName}</span>

      {/* Dev A → Dev B */}
      <span style={{ color: colorA, fontSize: 9 }}>{conflict.devAId}</span>
      <span style={{ color: 'var(--color-text-3)' }}>→</span>
      <span style={{ color: colorB, fontSize: 9 }}>{conflict.devBId}</span>

      {/* Dot separator */}
      <span style={{ color: 'var(--color-text-3)', margin: '0 4px' }}>·</span>
    </span>
  )
}
