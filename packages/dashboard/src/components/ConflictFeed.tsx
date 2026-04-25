import type { ConflictEvent, Severity } from '../types'

const SEV: Record<Severity, { color: string; label: string; bg: string }> = {
  info:     { color: 'var(--color-cb-green)', bg: 'var(--color-cb-green-dim)', label: 'Info' },
  warning:  { color: 'var(--color-cb-amber)', bg: 'var(--color-cb-amber-dim)', label: 'Warning' },
  critical: { color: 'var(--color-cb-red)',   bg: 'var(--color-cb-red-dim)',   label: 'Critical' },
}

interface Props {
  conflicts: ConflictEvent[]
}

export function ConflictFeed({ conflicts }: Props) {
  return (
    <aside
      className="flex flex-col overflow-hidden shrink-0"
      style={{
        width: 304,
        borderLeft: '1px solid var(--color-cb-border)',
        background: 'var(--color-surface)',
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 shrink-0"
        style={{ height: 44, borderBottom: '1px solid var(--color-cb-border)' }}
      >
        <span className="font-ui" style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-cb-text)' }}>
          Conflict log
        </span>
        {conflicts.length > 0 && (
          <span
            className="font-mono"
            style={{
              fontSize: 10,
              padding: '2px 7px',
              borderRadius: 20,
              background: 'var(--color-cb-red-dim)',
              color: 'var(--color-cb-red)',
              border: '1px solid oklch(59% 0.22 25 / 0.2)',
            }}
          >
            {conflicts.length}
          </span>
        )}
      </div>

      {/* Events */}
      <div className="flex-1 overflow-y-auto">
        {conflicts.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="py-2">
            {conflicts.map(c => <ConflictRow key={c.id} conflict={c} />)}
          </div>
        )}
      </div>
    </aside>
  )
}

function ConflictRow({ conflict }: { conflict: ConflictEvent }) {
  const sev = SEV[conflict.severity]
  const time = new Date(conflict.timestamp).toLocaleTimeString([], {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  })
  const isCritical = conflict.severity === 'critical'

  return (
    <div
      className={`mx-2 my-1.5 rounded-lg overflow-hidden ${isCritical ? 'animate-conflict' : 'animate-slide-in'}`}
      style={{
        background: 'var(--color-raised)',
        border: `1px solid var(--color-cb-border)`,
        borderLeft: `3px solid ${sev.color}`,
      }}
    >
      {/* Row header */}
      <div className="flex items-center gap-2 px-3 pt-2.5 pb-1.5">
        <span
          className="font-ui shrink-0"
          style={{
            fontSize: 10,
            fontWeight: 600,
            padding: '1px 6px',
            borderRadius: 4,
            background: sev.bg,
            color: sev.color,
          }}
        >
          {sev.label}
        </span>
        <span
          className="font-mono flex-1 truncate"
          style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-cb-text)' }}
        >
          {conflict.entityName}
        </span>
        <span className="font-mono shrink-0" style={{ fontSize: 10, color: 'var(--color-cb-muted)' }}>
          {time}
        </span>
      </div>

      {/* Devs + impact */}
      <div className="flex items-center gap-1 px-3 pb-2">
        <span className="font-mono" style={{ fontSize: 11, color: 'var(--color-cb-green)' }}>
          {conflict.devAId}
        </span>
        <span className="font-ui" style={{ fontSize: 11, color: 'var(--color-cb-dim)', marginInline: 2 }}>↔</span>
        <span className="font-mono" style={{ fontSize: 11, color: 'var(--color-cb-red)' }}>
          {conflict.devBId}
        </span>
        {conflict.impactCount > 0 && (
          <>
            <span className="flex-1" />
            <span
              className="font-ui"
              style={{
                fontSize: 10,
                padding: '1px 6px',
                borderRadius: 4,
                background: 'var(--color-cb-amber-dim)',
                color: 'var(--color-cb-amber)',
              }}
            >
              {conflict.impactCount} dep{conflict.impactCount !== 1 ? 's' : ''}
            </span>
          </>
        )}
      </div>

      {/* Signature diff */}
      {(conflict.oldSig || conflict.newSig) && (
        <div
          className="mx-3 mb-2.5 rounded overflow-hidden"
          style={{
            background: 'var(--color-base)',
            border: '1px solid var(--color-cb-border)',
          }}
        >
          {conflict.oldSig && (
            <div
              className="font-mono break-all leading-relaxed"
              style={{
                fontSize: 10,
                padding: '5px 8px',
                color: '#ff8080',
                borderBottom: '1px solid var(--color-cb-border)',
              }}
            >
              <span style={{ opacity: 0.5, marginRight: 4 }}>−</span>{conflict.oldSig}
            </div>
          )}
          {conflict.newSig && (
            <div
              className="font-mono break-all leading-relaxed"
              style={{ fontSize: 10, padding: '5px 8px', color: '#6ef0a8' }}
            >
              <span style={{ opacity: 0.5, marginRight: 4 }}>+</span>{conflict.newSig}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-48 gap-2.5">
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none" opacity="0.15">
        <path d="M16 3L3 28h26L16 3z" stroke="var(--color-cb-text)" strokeWidth="1.5" strokeLinejoin="round" />
        <line x1="16" y1="13" x2="16" y2="20" stroke="var(--color-cb-text)" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="16" cy="24" r="1" fill="var(--color-cb-text)" />
      </svg>
      <div className="text-center">
        <p className="font-ui" style={{ fontSize: 12, color: 'var(--color-cb-muted)' }}>No conflicts detected</p>
        <p className="font-ui" style={{ fontSize: 11, color: 'var(--color-cb-dim)', marginTop: 3 }}>System nominal</p>
      </div>
    </div>
  )
}
