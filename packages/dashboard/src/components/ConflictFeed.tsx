import type { ConflictEvent, Severity } from '../types'

const SEV_CLASSES: Record<Severity, { badge: string; border: string; badgeText: string }> = {
  info:     { badge: 'bg-cb-green/10 text-cb-green',    border: 'border-l-cb-green',  badgeText: 'INFO' },
  warning:  { badge: 'bg-cb-amber/10 text-cb-amber',    border: 'border-l-cb-amber',  badgeText: 'WARNING' },
  critical: { badge: 'bg-cb-red/10 text-cb-red',        border: 'border-l-cb-red',    badgeText: 'CRITICAL' },
}

interface Props {
  conflicts: ConflictEvent[]
}

export function ConflictFeed({ conflicts }: Props) {
  return (
    <aside className="w-80 border-l border-cb-border bg-surface flex flex-col overflow-hidden shrink-0">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-cb-border">
        <span className="font-code text-[10px] tracking-widest text-cb-dim">CONFLICT FEED</span>
        {conflicts.length > 0 && (
          <span className="ml-auto font-code text-[10px] px-1.5 py-px rounded-full bg-cb-red/10 text-cb-red">
            {conflicts.length}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto py-1.5">
        {conflicts.length === 0 ? (
          <p className="px-5 py-10 text-center font-code text-[11px] text-cb-dim leading-loose">
            No conflicts detected
          </p>
        ) : (
          conflicts.map(c => <ConflictCard key={c.id} conflict={c} />)
        )}
      </div>
    </aside>
  )
}

function ConflictCard({ conflict }: { conflict: ConflictEvent }) {
  const s = SEV_CLASSES[conflict.severity]
  const time = new Date(conflict.timestamp).toLocaleTimeString([], {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })

  return (
    <div className={`mx-2 my-1 rounded-lg bg-raised border border-cb-border border-l-[3px] ${s.border} overflow-hidden ${conflict.severity === 'critical' ? 'animate-conflict-glow' : 'animate-fade-slide'}`}>
      {/* Header */}
      <div className="flex items-center gap-2 px-2.5 pt-2 pb-1.5">
        <span className={`font-code text-[9px] px-1.5 py-0.5 rounded font-medium tracking-wider ${s.badge}`}>
          {s.badgeText}
        </span>
        <span className="font-code text-[11px] text-cb-text font-medium flex-1 truncate">
          {conflict.entityName}
        </span>
        <span className="font-code text-[9px] text-cb-dim">{time}</span>
      </div>

      {/* Devs */}
      <div className="flex items-center gap-1.5 px-2.5 pb-1.5 font-code text-[10px]">
        <span className="text-cb-green">{conflict.devAId}</span>
        <span className="text-cb-dim">↔</span>
        <span className="text-cb-red">{conflict.devBId}</span>
        {conflict.impactCount > 0 && (
          <>
            <span className="flex-1" />
            <span className="px-1.5 py-px rounded bg-cb-amber/10 text-cb-amber text-[9px]">
              {conflict.impactCount} dep{conflict.impactCount !== 1 ? 's' : ''}
            </span>
          </>
        )}
      </div>

      {/* Sig diff */}
      {(conflict.oldSig || conflict.newSig) && (
        <div className="mx-2.5 mb-2 rounded bg-base border border-cb-border overflow-hidden">
          {conflict.oldSig && (
            <div className="px-2 py-1 font-code text-[9px] text-[#ff6b6b] border-b border-cb-border break-all leading-relaxed">
              − {conflict.oldSig}
            </div>
          )}
          {conflict.newSig && (
            <div className="px-2 py-1 font-code text-[9px] text-[#6bffb8] break-all leading-relaxed">
              + {conflict.newSig}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
