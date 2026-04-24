import type { DevStatus } from '../types'

interface Props {
  devStatuses: Map<string, DevStatus>
}

export function DevPanel({ devStatuses }: Props) {
  const devs = [...devStatuses.values()]
  const online = devs.filter(d => d.connected).length

  return (
    <aside className="w-60 border-r border-cb-border bg-surface flex flex-col overflow-hidden shrink-0">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-cb-border">
        <span className="font-code text-[10px] tracking-widest text-cb-dim">DEVELOPERS</span>
        <span className="ml-auto font-code text-[11px] text-cb-muted">{online}/{devs.length}</span>
      </div>

      <div className="flex-1 overflow-auto py-2">
        {devs.length === 0 ? (
          <p className="px-4 py-8 text-center font-code text-[11px] text-cb-dim leading-loose">
            No clients<br />connected
          </p>
        ) : (
          devs.map(dev => <DevCard key={dev.devId} dev={dev} />)
        )}
      </div>
    </aside>
  )
}

function DevCard({ dev }: { dev: DevStatus }) {
  const isStale = Date.now() - dev.lastHeartbeat > 45_000
  const statusColor = !dev.connected ? '#3a3a5a' : isStale ? '#f59e0b' : '#00e87a'
  const statusLabel = !dev.connected ? 'OFF' : isStale ? 'IDLE' : 'ON'

  return (
    <div className="mx-2 my-1 p-2.5 rounded-lg bg-raised border border-cb-border">
      <div className="flex items-center gap-2 mb-1.5">
        <div
          className="w-2 h-2 rounded-full shrink-0"
          style={{
            background: statusColor,
            boxShadow: dev.connected && !isStale ? `0 0 6px ${statusColor}` : 'none',
          }}
        />
        <span className="font-code text-[12px] font-medium text-cb-text flex-1 truncate">
          {dev.devId}
        </span>
        <span className="font-code text-[9px]" style={{ color: statusColor }}>
          {statusLabel}
        </span>
      </div>

      {dev.lastEntity && (
        <p className="font-code text-[10px] text-cb-muted truncate mb-1">↳ {dev.lastEntity}</p>
      )}

      {dev.entities.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1">
          {dev.entities.slice(0, 8).map(e => (
            <span key={e} className="font-code text-[9px] px-1.5 py-px rounded bg-hover text-cb-muted max-w-[72px] truncate">
              {e}
            </span>
          ))}
          {dev.entities.length > 8 && (
            <span className="font-code text-[9px] text-cb-dim px-1">+{dev.entities.length - 8}</span>
          )}
        </div>
      )}
    </div>
  )
}
