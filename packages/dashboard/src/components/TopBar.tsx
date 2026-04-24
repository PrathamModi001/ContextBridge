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
    <header className="flex items-center gap-6 px-5 h-14 border-b border-cb-border bg-surface shrink-0 select-none">
      {/* Logo */}
      <div className="flex items-center gap-2.5">
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
          <circle cx="11" cy="11" r="10" stroke="#00e87a" strokeWidth="1.5" opacity="0.4" />
          <circle cx="11" cy="11" r="5" fill="#00e87a" opacity="0.9" />
          <line x1="11" y1="1" x2="11" y2="6" stroke="#00e87a" strokeWidth="1.5" />
          <line x1="11" y1="16" x2="11" y2="21" stroke="#00e87a" strokeWidth="1.5" />
          <line x1="1" y1="11" x2="6" y2="11" stroke="#00e87a" strokeWidth="1.5" />
          <line x1="16" y1="11" x2="21" y2="11" stroke="#00e87a" strokeWidth="1.5" />
        </svg>
        <span className="font-display text-base font-semibold tracking-tight text-cb-text">
          ContextBridge
        </span>
      </div>

      {/* Live indicator */}
      <div className="flex items-center gap-1.5">
        <div
          className={`w-[7px] h-[7px] rounded-full ${connected ? 'bg-cb-green animate-pulse-dot' : 'bg-cb-dim'}`}
          style={connected ? { boxShadow: '0 0 6px #00e87a' } : undefined}
        />
        <span className={`font-code text-[11px] tracking-widest ${connected ? 'text-cb-green' : 'text-cb-dim'}`}>
          {connected ? 'LIVE' : 'OFFLINE'}
        </span>
      </div>

      <div className="w-px h-5 bg-cb-border" />

      {/* Stats */}
      <div className="flex gap-5">
        <Stat label="ENTITIES" value={entityCount} />
        <Stat label="CONFLICTS" value={conflictCount} alert={conflictCount > 0} />
        <Stat label="DEVS" value={devCount} />
      </div>

      <div className="flex-1" />

      {/* Mode toggle */}
      <div className="flex items-center gap-2.5">
        <span className="font-code text-[10px] tracking-widest text-cb-muted">AGENT MODE</span>
        <button
          onClick={onModeToggle}
          className="flex items-center bg-raised border border-cb-border-bright rounded-full p-1 gap-0.5 cursor-pointer"
        >
          <Pill label="SMART" active={mode === 'smart'} color="green" />
          <Pill label="DUMB" active={mode === 'dumb'} color="red" />
        </button>
      </div>
    </header>
  )
}

function Stat({ label, value, alert }: { label: string; value: number; alert?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-code text-[9px] tracking-widest text-cb-dim">{label}</span>
      <span className={`font-code text-lg font-medium leading-none transition-colors ${alert ? 'text-cb-red' : 'text-cb-text'}`}>
        {value}
      </span>
    </div>
  )
}

function Pill({ label, active, color }: { label: string; active: boolean; color: 'green' | 'red' }) {
  const bg = active ? (color === 'green' ? 'bg-cb-green' : 'bg-cb-red') : 'bg-transparent'
  const text = active ? 'text-base' : 'text-cb-muted'
  return (
    <span className={`px-2.5 py-0.5 rounded-[14px] font-code text-[10px] font-medium tracking-widest transition-all ${bg} ${text}`}>
      {label}
    </span>
  )
}
