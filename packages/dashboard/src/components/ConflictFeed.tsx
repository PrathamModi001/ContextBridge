import { useState } from 'react'
import type { ConflictEvent, Severity } from '../types'
import { devColor, devInitials } from '../utils/devColor'

const SEV: Record<Severity, { label: string; color: string; bg: string }> = {
  info:     { label: 'INFO', color: 'var(--color-cyan)',   bg: 'rgba(33,212,253,0.09)'  },
  warning:  { label: 'WARN', color: 'var(--color-orange)', bg: 'rgba(253,140,91,0.09)'  },
  critical: { label: 'CRIT', color: 'var(--color-red)',    bg: 'rgba(252,92,92,0.09)'   },
}

interface Props {
  conflicts:  ConflictEvent[]
  onResolve?: (entityName: string) => void
}

export function ConflictFeed({ conflicts, onResolve }: Props) {
  return (
    <aside
      style={{
        width: 296,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        borderLeft: '1px solid var(--color-border)',
        background: 'var(--color-surface)',
        overflow: 'hidden',
      }}
    >
      <FeedHeader count={conflicts.length} />
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
        {conflicts.length === 0
          ? <EmptyFeed />
          : conflicts.map(c => <LogEntry key={c.id} conflict={c} onResolve={onResolve} />)
        }
      </div>
    </aside>
  )
}

function FeedHeader({ count }: { count: number }) {
  return (
    <div
      style={{
        height: 40,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 14px',
        borderBottom: '1px solid var(--color-border)',
      }}
    >
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          fontWeight: 500,
          letterSpacing: '0.1em',
          color: 'var(--color-text-2)',
        }}
      >
        CONFLICT LOG
      </span>
      {count > 0 && (
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            padding: '2px 7px',
            borderRadius: 3,
            background: 'var(--color-red-d)',
            color: 'var(--color-red)',
            border: '1px solid rgba(252,92,92,0.2)',
          }}
        >
          {count}
        </span>
      )}
    </div>
  )
}

function LogEntry({ conflict, onResolve }: { conflict: ConflictEvent; onResolve?: (entityName: string) => void }) {
  const [open, setOpen] = useState(true)
  const sev    = SEV[conflict.severity]
  const colorA = devColor(conflict.devAId)
  const colorB = devColor(conflict.devBId)
  const time   = new Date(conflict.timestamp).toLocaleTimeString([], {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  })

  return (
    <div
      className="animate-conflict-in"
      style={{
        margin: '0 8px 5px',
        borderRadius: 5,
        background: 'var(--color-raised)',
        border: '1px solid var(--color-border)',
        borderLeft: `2px solid ${sev.color}`,
        overflow: 'hidden',
      }}
    >
      {/* Header row — clickable to collapse diff */}
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          padding: '8px 10px',
          cursor: 'pointer',
        }}
      >
        <SevBadge sev={sev} />
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            fontWeight: 500,
            color: 'var(--color-text)',
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {conflict.entityName}
        </span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-text-3)', flexShrink: 0 }}>
          {time}
        </span>
      </div>

      {/* Dev row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px 8px' }}>
        <DevChip devId={conflict.devAId} color={colorA} />
        <Arrow />
        <DevChip devId={conflict.devBId} color={colorB} />
        {conflict.impactCount > 0 && (
          <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 9,
            color: 'var(--color-orange)', background: 'var(--color-orange-d)',
            padding: '2px 6px', borderRadius: 3, flexShrink: 0 }}
          >
            Δ{conflict.impactCount}
          </span>
        )}
      </div>

      {/* Diff block */}
      {open && (conflict.oldSig || conflict.newSig) && (
        <DiffBlock old={conflict.oldSig} next={conflict.newSig} />
      )}

      {/* Resolve button */}
      {onResolve && (
        <div style={{ padding: '0 10px 8px', display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={() => onResolve(conflict.entityName)}
            style={{
              background: 'rgba(252,92,92,0.1)', border: '1px solid rgba(252,92,92,0.25)',
              borderRadius: 4, padding: '4px 10px',
              fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600,
              color: '#fc5c5c', cursor: 'pointer',
            }}
          >
            Resolve →
          </button>
        </div>
      )}
    </div>
  )
}

function SevBadge({ sev }: { sev: typeof SEV[Severity] }) {
  return (
    <span
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 9,
        fontWeight: 600,
        letterSpacing: '0.07em',
        padding: '2px 5px',
        borderRadius: 3,
        background: sev.bg,
        color: sev.color,
        flexShrink: 0,
      }}
    >
      {sev.label}
    </span>
  )
}

function DevChip({ devId, color }: { devId: string; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 20,
          height: 20,
          borderRadius: 4,
          background: `${color}18`,
          border: `1px solid ${color}35`,
          fontFamily: 'var(--font-mono)',
          fontSize: 9,
          fontWeight: 600,
          color,
          flexShrink: 0,
        }}
      >
        {devInitials(devId)}
      </span>
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          color: 'var(--color-text-2)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          maxWidth: 58,
        }}
      >
        {devId}
      </span>
    </div>
  )
}

function Arrow() {
  return (
    <svg width="18" height="10" viewBox="0 0 18 10" fill="none" style={{ flexShrink: 0 }}>
      <path d="M1 5h12M9 1l4 4-4 4" stroke="var(--color-text-3)" strokeWidth="1.2"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function DiffBlock({ old: oldSig, next: newSig }: { old: string; next: string }) {
  return (
    <div
      style={{
        margin: '0 10px 9px',
        borderRadius: 4,
        background: 'var(--color-base)',
        border: '1px solid var(--color-border)',
        overflow: 'hidden',
        fontFamily: 'var(--font-mono)',
        fontSize: 10,
        lineHeight: 1.55,
      }}
    >
      {oldSig && (
        <div
          style={{
            display: 'flex',
            gap: 7,
            padding: '5px 8px',
            color: '#fc8181',
            borderBottom: newSig ? '1px solid var(--color-border)' : 'none',
            wordBreak: 'break-all',
          }}
        >
          <span style={{ opacity: 0.45, flexShrink: 0 }}>−</span>
          <span>{oldSig}</span>
        </div>
      )}
      {newSig && (
        <div style={{ display: 'flex', gap: 7, padding: '5px 8px', color: '#68d391', wordBreak: 'break-all' }}>
          <span style={{ opacity: 0.45, flexShrink: 0 }}>+</span>
          <span>{newSig}</span>
        </div>
      )}
    </div>
  )
}

function EmptyFeed() {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: 180,
        gap: 9,
        opacity: 0.25,
        color: 'var(--color-text-2)',
      }}
    >
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
        <path d="M14 3L3 25h22L14 3z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M14 12v6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="14" cy="21.5" r="1" fill="currentColor" />
      </svg>
      <div style={{ textAlign: 'center', lineHeight: 1.65 }}>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>No conflicts</p>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-text-3)', marginTop: 2 }}>
          System nominal
        </p>
      </div>
    </div>
  )
}
