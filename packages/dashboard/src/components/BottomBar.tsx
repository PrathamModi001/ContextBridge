interface Props {
  connected: boolean
  entityCount: number
  conflictCount: number
}

export function BottomBar({ connected, entityCount, conflictCount }: Props) {
  return (
    <footer className="h-9 border-t border-cb-border bg-surface flex items-center px-4 gap-5 shrink-0">
      <Item label="WS" value={connected ? 'connected' : 'disconnected'} color={connected ? 'text-cb-green' : 'text-cb-red'} />
      <div className="w-px h-4 bg-cb-border" />
      <Item label="ENTITIES" value={String(entityCount)} />
      <Item label="CONFLICTS" value={String(conflictCount)} color={conflictCount > 0 ? 'text-cb-red' : undefined} />
      <div className="flex-1" />
      <span className="font-code text-[10px] text-cb-dim">ContextBridge v1.0.0</span>
    </footer>
  )
}

function Item({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="font-code text-[9px] text-cb-dim tracking-widest">{label}</span>
      <span className={`font-code text-[10px] transition-colors ${color ?? 'text-cb-muted'}`}>{value}</span>
    </div>
  )
}
