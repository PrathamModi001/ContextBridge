import type { AgentMode } from '../types'

interface Props {
  connected: boolean
  entityCount: number
  conflictCount: number
  devCount: number
  mode: AgentMode
  onModeToggle: () => void
}

const M: React.CSSProperties = { fontFamily: 'var(--font-mono)' }

export function TopBar({ connected, entityCount, conflictCount, devCount, mode, onModeToggle }: Props) {
  return (
    <header
      style={{
        height: 44,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        background: 'var(--color-surface)',
        borderBottom: '1px solid var(--color-border-hi)',
        boxShadow: '0 1px 0 rgba(245,166,35,0.05), 0 1px 16px rgba(0,0,0,0.4)',
        userSelect: 'none',
      }}
    >
      {/* Logo */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '0 20px',
          borderRight: '1px solid var(--color-border)',
          height: '100%',
          flexShrink: 0,
        }}
      >
        <HexIcon />
        <span style={{ ...M, fontSize: 13, fontWeight: 600, letterSpacing: '0.07em', color: 'var(--color-text)' }}>
          CTX<span style={{ color: 'var(--color-amber)' }}>BRIDGE</span>
        </span>
        <LiveBadge connected={connected} />
      </div>

      {/* Stats */}
      <div style={{ display: 'flex', alignItems: 'center', flex: 1, height: '100%', padding: '0 6px' }}>
        <StatBlock label="ENTITIES" value={entityCount} />
        <Divider />
        <StatBlock label="DEVS" value={devCount} />
        <Divider />
        <StatBlock
          label="CONFLICTS"
          value={conflictCount}
          warn={conflictCount > 0}
        />
      </div>

      {/* Mode toggle */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '0 18px',
          borderLeft: '1px solid var(--color-border)',
          height: '100%',
          flexShrink: 0,
        }}
      >
        <span style={{ ...M, fontSize: 10, letterSpacing: '0.08em', color: 'var(--color-text-3)' }}>
          MODE
        </span>
        <ModeToggle mode={mode} onToggle={onModeToggle} />
      </div>
    </header>
  )
}

function HexIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
      <polygon
        points="10,1.5 17.9,5.75 17.9,14.25 10,18.5 2.1,14.25 2.1,5.75"
        fill="none"
        stroke="var(--color-amber)"
        strokeWidth="1.3"
        opacity="0.65"
      />
      <polygon
        points="10,5.5 14.6,8 14.6,13 10,15.5 5.4,13 5.4,8"
        fill="var(--color-amber)"
        opacity="0.18"
      />
      <circle cx="10" cy="10" r="2" fill="var(--color-amber)" opacity="0.9" />
    </svg>
  )
}

function LiveBadge({ connected }: { connected: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        padding: '2px 8px',
        borderRadius: 3,
        background: connected ? 'rgba(33,212,253,0.07)' : 'transparent',
        border: `1px solid ${connected ? 'rgba(33,212,253,0.22)' : 'var(--color-border)'}`,
      }}
    >
      <span
        className={connected ? 'animate-live-pulse' : ''}
        style={{
          display: 'block',
          width: 5,
          height: 5,
          borderRadius: '50%',
          background: connected ? 'var(--color-cyan)' : 'var(--color-text-3)',
          flexShrink: 0,
        }}
      />
      <span
        style={{
          ...M,
          fontSize: 10,
          fontWeight: 500,
          letterSpacing: '0.1em',
          color: connected ? 'var(--color-cyan)' : 'var(--color-text-3)',
        }}
      >
        {connected ? 'LIVE' : 'OFF'}
      </span>
    </div>
  )
}

function StatBlock({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 7, padding: '0 18px' }}>
      <span
        style={{
          ...M,
          fontSize: 10,
          color: 'var(--color-text-3)',
          letterSpacing: '0.07em',
        }}
      >
        {label}
      </span>
      <span
        style={{
          ...M,
          fontSize: 22,
          fontWeight: 600,
          letterSpacing: '-0.02em',
          lineHeight: 1,
          color: warn ? 'var(--color-red)' : 'var(--color-amber)',
          transition: 'color 0.25s',
          tabularNums: true,
        } as React.CSSProperties}
      >
        {value}
      </span>
    </div>
  )
}

function Divider() {
  return (
    <div style={{ width: 1, height: 18, background: 'var(--color-border)', flexShrink: 0 }} />
  )
}

function ModeToggle({ mode, onToggle }: { mode: AgentMode; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      title={`Switch to ${mode === 'smart' ? 'dumb' : 'smart'} mode`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        background: 'var(--color-raised)',
        border: '1px solid var(--color-border-hi)',
        borderRadius: 4,
        padding: 3,
        cursor: 'pointer',
        fontFamily: 'var(--font-mono)',
      }}
    >
      <Pill label="SMART" active={mode === 'smart'} activeColor="var(--color-cyan)" />
      <Pill label="DUMB"  active={mode === 'dumb'}  activeColor="var(--color-red)"  />
    </button>
  )
}

function Pill({ label, active, activeColor }: { label: string; active: boolean; activeColor: string }) {
  return (
    <span
      style={{
        padding: '3px 10px',
        borderRadius: 3,
        fontSize: 10,
        fontWeight: 500,
        letterSpacing: '0.07em',
        background: active ? activeColor : 'transparent',
        color: active ? '#060a11' : 'var(--color-text-3)',
        transition: 'background 0.15s, color 0.15s',
        fontFamily: 'var(--font-mono)',
      }}
    >
      {label}
    </span>
  )
}
