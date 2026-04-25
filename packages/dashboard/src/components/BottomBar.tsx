interface Props {
  connected: boolean
  entityCount: number
  conflictCount: number
}

export function BottomBar({ connected, entityCount, conflictCount }: Props) {
  return (
    <footer
      className="shrink-0 flex items-center gap-5 px-4"
      style={{
        height: 34,
        borderTop: '1px solid var(--color-cb-border)',
        background: 'var(--color-surface)',
      }}
    >
      <StatusDot label="WebSocket" active={connected} />
      <div style={{ width: 1, height: 14, background: 'var(--color-cb-border)' }} />
      <span className="font-mono" style={{ fontSize: 10, color: 'var(--color-cb-dim)' }}>
        {entityCount} entities · {conflictCount} conflict{conflictCount !== 1 ? 's' : ''}
      </span>
      <div className="flex-1" />
      <span className="font-mono" style={{ fontSize: 10, color: 'var(--color-cb-dim)' }}>
        ContextBridge v1.0.0
      </span>
    </footer>
  )
}

function StatusDot({ label, active }: { label: string; active: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        style={{
          display: 'block',
          width: 5,
          height: 5,
          borderRadius: '50%',
          background: active ? 'var(--color-cb-green)' : 'var(--color-cb-dim)',
        }}
      />
      <span className="font-ui" style={{ fontSize: 10, color: 'var(--color-cb-muted)' }}>
        {label}
      </span>
    </div>
  )
}
