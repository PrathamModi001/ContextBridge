import type { DevStatus } from '../types'
import { devColor, devInitials } from '../utils/devColor'

interface Props {
  devStatuses: Map<string, DevStatus>
  getDamageStats: (devId: string) => { openConflicts: number; totalBlastRadius: number }
}

export function DevPanel({ devStatuses, getDamageStats }: Props) {
  const devs = [...devStatuses.values()]
  const online = devs.filter(d => d.connected).length

  return (
    <aside
      style={{
        width: 232,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        borderRight: '1px solid var(--color-border)',
        background: 'var(--color-surface)',
        overflow: 'hidden',
      }}
    >
      <PanelHeader online={online} total={devs.length} />
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 10px' }}>
        {devs.length === 0 ? <EmptyState /> : devs.map(d => <DevCard key={d.devId} dev={d} getDamageStats={getDamageStats} />)}
      </div>
      <PanelFooter />
    </aside>
  )
}

function PanelHeader({ online, total }: { online: number; total: number }) {
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
        PRESENCE
      </span>
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          color: online > 0 ? 'var(--color-cyan)' : 'var(--color-text-3)',
        }}
      >
        {online}/{total}
      </span>
    </div>
  )
}

function PanelFooter() {
  return (
    <div
      style={{
        height: 32,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        padding: '0 14px',
        borderTop: '1px solid var(--color-border)',
      }}
    >
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-text-3)' }}>
        ContextBridge v1.0.0
      </span>
    </div>
  )
}

function DevCard({ dev, getDamageStats }: { dev: DevStatus; getDamageStats: (devId: string) => { openConflicts: number; totalBlastRadius: number } }) {
  const color = devColor(dev.devId)
  const initials = devInitials(dev.devId)
  const isStale = Date.now() - dev.lastHeartbeat > 45_000
  const isOnline = dev.connected && !isStale

  const statusColor = isOnline
    ? 'var(--color-cyan)'
    : dev.connected
    ? 'var(--color-orange)'
    : 'var(--color-text-3)'

  const statusLabel = isOnline ? 'online' : dev.connected ? 'idle' : 'offline'

  /* Activity bars — filled segments per entity count, max 8 */
  const MAX = 8
  const filled = Math.min(dev.entities.length, MAX)
  const empty  = MAX - filled

  return (
    <div
      className="animate-slide-in"
      style={{
        marginBottom: 6,
        padding: '11px 12px',
        borderRadius: 6,
        background: 'var(--color-raised)',
        border: '1px solid var(--color-border)',
        borderLeft: `2px solid ${isOnline ? color : 'var(--color-border)'}`,
        transition: 'border-color 0.35s',
      }}
    >
      {/* Avatar + name + status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <div
          style={{
            position: 'relative',
            width: 32,
            height: 32,
            borderRadius: 7,
            background: `${color}16`,
            border: `1px solid ${color}30`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            fontWeight: 600,
            color,
            flexShrink: 0,
          }}
        >
          {initials}
          {/* Status dot */}
          <span
            style={{
              position: 'absolute',
              bottom: -2,
              right: -2,
              width: 9,
              height: 9,
              borderRadius: '50%',
              background: statusColor,
              border: '1.5px solid var(--color-raised)',
            }}
          />
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                fontWeight: 500,
                color: 'var(--color-text)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                flex: 1,
              }}
            >
              {dev.devId}
            </span>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 9,
                letterSpacing: '0.06em',
                color: statusColor,
                flexShrink: 0,
              }}
            >
              {statusLabel}
            </span>
          </div>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-text-3)' }}>
            {dev.entities.length} {dev.entities.length === 1 ? 'entity' : 'entities'}
          </span>
        </div>
      </div>

      {/* Activity bar */}
      {dev.entities.length > 0 && (
        <div style={{ marginTop: 10, display: 'flex', gap: 3 }}>
          {Array.from({ length: filled }).map((_, i) => (
            <div
              key={`f${i}`}
              style={{
                height: 3,
                flex: 1,
                borderRadius: 2,
                background: color,
                opacity: 0.35 + (i / MAX) * 0.65,
              }}
            />
          ))}
          {Array.from({ length: empty }).map((_, i) => (
            <div
              key={`e${i}`}
              style={{ height: 3, flex: 1, borderRadius: 2, background: 'var(--color-border-hi)' }}
            />
          ))}
        </div>
      )}

      {/* Last edited entity */}
      {dev.lastEntity && (
        <div style={{ marginTop: 9, display: 'flex', alignItems: 'center', gap: 5 }}>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 9,
              letterSpacing: '0.06em',
              color: 'var(--color-text-3)',
              flexShrink: 0,
            }}
          >
            EDITING
          </span>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              color,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1,
            }}
          >
            {dev.lastEntity}
          </span>
        </div>
      )}

      {/* Damage counter */}
      {(() => {
        const damage = getDamageStats(dev.devId)
        return (damage.openConflicts > 0 || damage.totalBlastRadius > 0) && (
          <div style={{
            marginTop: 6, padding: '5px 8px',
            background: 'rgba(252,92,92,0.07)',
            border: '1px solid rgba(252,92,92,0.18)',
            borderRadius: 4,
            fontFamily: 'var(--font-mono)',
          }}>
            <div style={{ fontSize: 9, color: 'var(--color-text-3)', letterSpacing: '0.08em', marginBottom: 4 }}>
              DUMB MODE DAMAGE
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <span style={{ fontSize: 10, color: '#fc5c5c' }}>
                {damage.openConflicts} conflict{damage.openConflicts !== 1 ? 's' : ''}
              </span>
              <span style={{ fontSize: 10, color: '#fd8c5b' }}>
                Δ{damage.totalBlastRadius} downstream
              </span>
            </div>
          </div>
        )
      })()}
    </div>
  )
}

function EmptyState() {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: 140,
        gap: 10,
        opacity: 0.25,
        color: 'var(--color-text-2)',
      }}
    >
      <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
        <circle cx="18" cy="13" r="6" stroke="currentColor" strokeWidth="1.5" />
        <path d="M5 34c0-7.18 5.82-13 13-13s13 5.82 13 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, textAlign: 'center', lineHeight: 1.6 }}>
        No developers<br />connected
      </span>
    </div>
  )
}
