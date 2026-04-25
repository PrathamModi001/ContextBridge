import type { AgentMode } from '../types'

interface Props {
  connected: boolean
  entityCount: number
  conflictCount: number
  devCount: number
  mode: AgentMode
  onModeToggle: () => void
}

export function TopBar({ connected, entityCount, conflictCount, devCount, mode, onModeToggle }: Props) {
  return (
    <header
      className="shrink-0 flex items-center gap-0 select-none"
      style={{
        height: 52,
        borderBottom: '1px solid var(--color-cb-border)',
        background: 'var(--color-surface)',
      }}
    >
      {/* Logo */}
      <div
        className="flex items-center gap-3 px-5"
        style={{ borderRight: '1px solid var(--color-cb-border)', height: '100%' }}
      >
        <LogoMark />
        <span
          className="font-display"
          style={{ fontSize: 16, fontWeight: 800, color: 'var(--color-cb-text)', letterSpacing: '-0.02em' }}
        >
          ContextBridge
        </span>
        <LiveChip connected={connected} />
      </div>

      {/* Stats */}
      <div className="flex items-center gap-px flex-1 px-4">
        <Stat label="Entities" value={entityCount} />
        <StatDivider />
        <Stat label="Conflicts" value={conflictCount} danger={conflictCount > 0} />
        <StatDivider />
        <Stat label="Devs" value={devCount} />
      </div>

      {/* Mode toggle */}
      <div
        className="flex items-center gap-3 px-5"
        style={{ borderLeft: '1px solid var(--color-cb-border)', height: '100%' }}
      >
        <span className="font-ui" style={{ fontSize: 12, color: 'var(--color-cb-muted)' }}>
          Agent mode
        </span>
        <ModeToggle mode={mode} onToggle={onModeToggle} />
      </div>
    </header>
  )
}

function LogoMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
      <circle cx="10" cy="10" r="9" stroke="var(--color-cb-accent)" strokeWidth="1.5" opacity="0.3" />
      <circle cx="10" cy="10" r="4" fill="var(--color-cb-accent)" opacity="0.9" />
      <line x1="10" y1="1" x2="10" y2="5.5" stroke="var(--color-cb-accent)" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="10" y1="14.5" x2="10" y2="19" stroke="var(--color-cb-accent)" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="1" y1="10" x2="5.5" y2="10" stroke="var(--color-cb-accent)" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="14.5" y1="10" x2="19" y2="10" stroke="var(--color-cb-accent)" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function LiveChip({ connected }: { connected: boolean }) {
  return (
    <div
      className="flex items-center gap-1.5 px-2 py-1 rounded-full"
      style={{
        background: connected ? 'var(--color-cb-green-dim)' : 'transparent',
        border: `1px solid ${connected ? 'oklch(71% 0.17 153 / 0.2)' : 'var(--color-cb-border)'}`,
      }}
    >
      <span
        className={connected ? 'animate-live-pulse' : ''}
        style={{
          display: 'block',
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: connected ? 'var(--color-cb-green)' : 'var(--color-cb-dim)',
        }}
      />
      <span
        className="font-mono"
        style={{ fontSize: 10, color: connected ? 'var(--color-cb-green)' : 'var(--color-cb-dim)', letterSpacing: '0.04em' }}
      >
        {connected ? 'live' : 'offline'}
      </span>
    </div>
  )
}

function Stat({ label, value, danger }: { label: string; value: number; danger?: boolean }) {
  return (
    <div className="flex items-baseline gap-2 px-4">
      <span
        className="font-ui tabular-nums"
        style={{ fontSize: 22, fontWeight: 600, color: danger ? 'var(--color-cb-red)' : 'var(--color-cb-text)', letterSpacing: '-0.02em', lineHeight: 1 }}
      >
        {value}
      </span>
      <span className="font-ui" style={{ fontSize: 12, color: 'var(--color-cb-muted)' }}>
        {label}
      </span>
    </div>
  )
}

function StatDivider() {
  return (
    <div style={{ width: 1, height: 20, background: 'var(--color-cb-border)', margin: '0 4px' }} />
  )
}

function ModeToggle({ mode, onToggle }: { mode: AgentMode; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className="flex items-center rounded-lg overflow-hidden"
      style={{
        border: '1px solid var(--color-cb-border)',
        background: 'var(--color-raised)',
        padding: 3,
        gap: 2,
        cursor: 'pointer',
      }}
      title={`Switch to ${mode === 'smart' ? 'dumb' : 'smart'} mode`}
    >
      <TogglePill label="Smart" active={mode === 'smart'} activeColor="var(--color-cb-green)" />
      <TogglePill label="Dumb" active={mode === 'dumb'} activeColor="var(--color-cb-red)" />
    </button>
  )
}

function TogglePill({ label, active, activeColor }: { label: string; active: boolean; activeColor: string }) {
  return (
    <span
      className="font-ui"
      style={{
        padding: '3px 10px',
        borderRadius: 6,
        fontSize: 12,
        fontWeight: 500,
        background: active ? activeColor : 'transparent',
        color: active ? (label === 'Smart' ? '#0d0c0b' : '#fff') : 'var(--color-cb-muted)',
        transition: 'background 0.15s, color 0.15s',
      }}
    >
      {label}
    </span>
  )
}
