import type { DevStatus } from '../types'

const STATUS_COLORS = {
  online: 'var(--color-cb-green)',
  idle:   'var(--color-cb-amber)',
  offline:'var(--color-cb-dim)',
}

interface Props {
  devStatuses: Map<string, DevStatus>
}

export function DevPanel({ devStatuses }: Props) {
  const devs = [...devStatuses.values()]
  const onlineCount = devs.filter(d => d.connected).length

  return (
    <aside
      className="flex flex-col overflow-hidden shrink-0"
      style={{
        width: 240,
        borderRight: '1px solid var(--color-cb-border)',
        background: 'var(--color-surface)',
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 shrink-0"
        style={{ height: 44, borderBottom: '1px solid var(--color-cb-border)' }}
      >
        <span className="font-ui" style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-cb-text)' }}>
          Developers
        </span>
        <span className="font-mono" style={{ fontSize: 11, color: 'var(--color-cb-muted)' }}>
          {onlineCount}/{devs.length}
        </span>
      </div>

      {/* Dev list */}
      <div className="flex-1 overflow-y-auto py-2">
        {devs.length === 0 ? (
          <EmptyDevs />
        ) : (
          devs.map(dev => <DevCard key={dev.devId} dev={dev} />)
        )}
      </div>

      {/* Footer — version */}
      <div
        className="flex items-center justify-between px-4 shrink-0"
        style={{ height: 36, borderTop: '1px solid var(--color-cb-border)' }}
      >
        <span className="font-mono" style={{ fontSize: 10, color: 'var(--color-cb-dim)' }}>
          ContextBridge
        </span>
        <span className="font-mono" style={{ fontSize: 10, color: 'var(--color-cb-dim)' }}>
          v1.0.0
        </span>
      </div>
    </aside>
  )
}

function DevCard({ dev }: { dev: DevStatus }) {
  const isStale = Date.now() - dev.lastHeartbeat > 45_000
  const statusColor = !dev.connected
    ? STATUS_COLORS.offline
    : isStale
    ? STATUS_COLORS.idle
    : STATUS_COLORS.online

  const statusLabel = !dev.connected ? 'offline' : isStale ? 'idle' : 'online'

  return (
    <div
      className="mx-3 my-1 rounded-lg overflow-hidden"
      style={{
        background: 'var(--color-raised)',
        border: '1px solid var(--color-cb-border)',
      }}
    >
      {/* Card header */}
      <div className="flex items-center gap-2.5 px-3 pt-2.5 pb-2">
        <span
          style={{
            display: 'block',
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: statusColor,
            flexShrink: 0,
            boxShadow: dev.connected && !isStale ? `0 0 5px ${statusColor}60` : 'none',
          }}
        />
        <span
          className="font-mono flex-1 truncate"
          style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-cb-text)' }}
        >
          {dev.devId}
        </span>
        <span className="font-ui" style={{ fontSize: 10, color: statusColor }}>
          {statusLabel}
        </span>
      </div>

      {/* Last entity */}
      {dev.lastEntity && (
        <div
          className="px-3 py-1.5"
          style={{ borderTop: '1px solid var(--color-cb-border)' }}
        >
          <span className="font-ui" style={{ fontSize: 10, color: 'var(--color-cb-muted)' }}>
            Last edited
          </span>
          <p className="font-mono truncate" style={{ fontSize: 11, color: 'var(--color-cb-accent)', marginTop: 1 }}>
            {dev.lastEntity}
          </p>
        </div>
      )}

      {/* Entity badges */}
      {dev.entities.length > 0 && (
        <div
          className="px-3 pb-2.5 pt-1.5 flex flex-wrap gap-1"
          style={{ borderTop: dev.lastEntity ? '1px solid var(--color-cb-border)' : undefined }}
        >
          {dev.entities.slice(0, 6).map(e => (
            <span
              key={e}
              className="font-mono truncate"
              style={{
                fontSize: 9,
                padding: '2px 6px',
                borderRadius: 4,
                background: 'var(--color-hover)',
                color: 'var(--color-cb-muted)',
                border: '1px solid var(--color-cb-border)',
                maxWidth: 84,
              }}
            >
              {e}
            </span>
          ))}
          {dev.entities.length > 6 && (
            <span className="font-ui" style={{ fontSize: 10, color: 'var(--color-cb-dim)', alignSelf: 'center' }}>
              +{dev.entities.length - 6}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

function EmptyDevs() {
  return (
    <div className="flex flex-col items-center justify-center h-40 gap-2">
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none" opacity="0.2">
        <circle cx="14" cy="10" r="5" stroke="var(--color-cb-text)" strokeWidth="1.5" />
        <path d="M4 26c0-5.523 4.477-10 10-10s10 4.477 10 10" stroke="var(--color-cb-text)" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <span className="font-ui" style={{ fontSize: 12, color: 'var(--color-cb-dim)', textAlign: 'center', lineHeight: 1.5 }}>
        No clients connected
      </span>
    </div>
  )
}
