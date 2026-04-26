import { useState } from 'react'
import type { ConflictSession } from '../types'
import { devColor } from '../utils/devColor'

const SERVER = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3000'

interface Props {
  session:    ConflictSession
  onClose:    () => void
  onResolved: (sessionId: string) => void
}

const CONFLICT_TYPE_LABELS: Record<string, string> = {
  auth_bypass:     '🔒 AUTH BYPASS',
  type_violation:  '⚠ TYPE VIOLATION',
  ghost_call:      '💀 GHOST CALL',
  signature_drift: 'SIG DRIFT',
  blast_cascade:   '💥 BLAST CASCADE',
}

export function ConflictMergeEditor({ session, onClose, onResolved }: Props) {
  const [mergedBody, setMergedBody] = useState(session.devABody)
  const [mergedSig,  setMergedSig]  = useState(session.devASig)
  const [submitting, setSubmitting] = useState(false)
  const [error,      setError]      = useState<string | null>(null)

  const colorA    = devColor(session.devAId)
  const colorB    = devColor(session.devBId)
  const typeLabel = CONFLICT_TYPE_LABELS[session.conflictType] ?? session.conflictType

  async function submit(type: 'accepted_a' | 'accepted_b' | 'manual_merge', body: string, sig: string) {
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`${SERVER}/v1/conflicts/sessions/${session.id}/resolve`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ type, mergedBody: body, mergedSig: sig, resolvedBy: 'dashboard' }),
      })
      if (!res.ok) {
        const data = await res.json() as { error?: string }
        throw new Error(data.error ?? 'Server error')
      }
      onResolved(session.id)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to resolve')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 50,
        background: 'rgba(6,10,17,0.88)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backdropFilter: 'blur(4px)',
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        width: 'min(95vw, 1100px)', maxHeight: '90vh',
        display: 'flex', flexDirection: 'column',
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border-hi)',
        borderTop: '2px solid #fc5c5c',
        borderRadius: 8,
        overflow: 'hidden',
        boxShadow: '0 24px 80px rgba(0,0,0,0.7)',
      }}>
        {/* Header */}
        <div style={{
          padding: '12px 18px', borderBottom: '1px solid var(--color-border)',
          display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
        }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 600, color: '#fc5c5c' }}>
            ⚡ CONFLICT
          </span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 600, color: 'var(--color-text)' }}>
            {session.entityName}
          </span>
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 10, padding: '2px 7px',
            borderRadius: 3, background: 'rgba(252,92,92,0.1)',
            color: '#fc5c5c', border: '1px solid rgba(252,92,92,0.2)',
          }}>
            {typeLabel}
          </span>
          {session.securitySensitive && (
            <span style={{
              fontFamily: 'var(--font-mono)', fontSize: 10, padding: '2px 7px',
              borderRadius: 3, background: 'rgba(252,92,92,0.15)',
              color: '#fc5c5c', border: '1px solid rgba(252,92,92,0.3)',
            }}>
              🔒 AUTH SENSITIVE
            </span>
          )}
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-text-3)', marginLeft: 'auto' }}>
            blast radius: {session.blastRadius} downstream
          </span>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none', color: 'var(--color-text-3)',
              cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: '0 4px',
            }}
          >×</button>
        </div>

        {/* 3-panel body */}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>
          {/* Left: devA */}
          <Panel
            title={session.devAId}
            subtitle="current owner"
            color={colorA}
            sig={session.devASig}
            body={session.devABody}
            actionLabel="Accept A →"
            actionColor={colorA}
            onAction={() => submit('accepted_a', session.devABody, session.devASig)}
            disabled={submitting}
          />

          {/* Center: merged */}
          <div style={{
            flex: 1, display: 'flex', flexDirection: 'column',
            borderLeft: '1px solid var(--color-border)',
            borderRight: '1px solid var(--color-border)',
          }}>
            <div style={{
              padding: '8px 12px', borderBottom: '1px solid var(--color-border)',
              fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-text-2)',
              letterSpacing: '0.08em', flexShrink: 0,
            }}>
              MERGED RESULT
              <span style={{ color: 'var(--color-text-3)', marginLeft: 8 }}>editable</span>
            </div>
            <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
              <input
                value={mergedSig}
                onChange={e => setMergedSig(e.target.value)}
                placeholder="Merged signature"
                style={{
                  width: '100%', background: 'var(--color-base)',
                  border: '1px solid var(--color-border)', borderRadius: 4,
                  padding: '6px 8px', fontFamily: 'var(--font-mono)', fontSize: 11,
                  color: 'var(--color-text)', outline: 'none', boxSizing: 'border-box',
                }}
              />
            </div>
            <textarea
              value={mergedBody}
              onChange={e => setMergedBody(e.target.value)}
              style={{
                flex: 1, resize: 'none', background: 'var(--color-base)',
                border: 'none', outline: 'none', padding: '12px',
                fontFamily: 'var(--font-mono)', fontSize: 11,
                color: 'var(--color-text)', lineHeight: 1.6,
              }}
            />
            <div style={{
              padding: '10px 12px', borderTop: '1px solid var(--color-border)',
              display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
            }}>
              {error && (
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#fc5c5c', flex: 1 }}>
                  {error}
                </span>
              )}
              <button
                onClick={() => submit('manual_merge', mergedBody, mergedSig)}
                disabled={submitting || !mergedBody.trim()}
                style={{
                  marginLeft: 'auto',
                  background: 'rgba(91,112,135,0.15)', border: '1px solid var(--color-border)',
                  borderRadius: 5, padding: '7px 16px',
                  fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600,
                  color: 'var(--color-text)', cursor: submitting ? 'wait' : 'pointer',
                  opacity: submitting ? 0.6 : 1,
                }}
              >
                {submitting ? 'Resolving…' : 'Accept Merged Version'}
              </button>
            </div>
          </div>

          {/* Right: devB */}
          <Panel
            title={session.devBId}
            subtitle="incoming change"
            color={colorB}
            sig={session.devBSig}
            body={session.devBBody}
            actionLabel="← Accept B"
            actionColor={colorB}
            onAction={() => submit('accepted_b', session.devBBody, session.devBSig)}
            disabled={submitting}
            reverse
          />
        </div>
      </div>
    </div>
  )
}

interface PanelProps {
  title:       string
  subtitle:    string
  color:       string
  sig:         string
  body:        string
  actionLabel: string
  actionColor: string
  onAction:    () => void
  disabled:    boolean
  reverse?:    boolean
}

function Panel({ title, subtitle, color, sig, body, actionLabel, actionColor, onAction, disabled, reverse }: PanelProps) {
  return (
    <div style={{ width: 300, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{
        padding: '8px 12px', borderBottom: '1px solid var(--color-border)',
        borderTop: `2px solid ${color}`, flexShrink: 0,
      }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600, color }}>
          {title}
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--color-text-3)', marginTop: 2 }}>
          {subtitle}
        </div>
      </div>
      <div style={{
        padding: '6px 10px', borderBottom: '1px solid var(--color-border)',
        fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-text-2)',
        background: 'var(--color-base)', flexShrink: 0, wordBreak: 'break-all',
      }}>
        {sig || '(no signature)'}
      </div>
      <pre style={{
        flex: 1, overflow: 'auto', margin: 0,
        padding: '12px', fontFamily: 'var(--font-mono)', fontSize: 10,
        color: 'var(--color-text-2)', lineHeight: 1.55, background: 'transparent',
        whiteSpace: 'pre-wrap', wordBreak: 'break-all',
      }}>
        {body || '(no body)'}
      </pre>
      <div style={{
        padding: '10px 12px', borderTop: '1px solid var(--color-border)',
        display: 'flex', justifyContent: reverse ? 'flex-start' : 'flex-end', flexShrink: 0,
      }}>
        <button
          onClick={onAction}
          disabled={disabled}
          style={{
            background: `${actionColor}18`, border: `1px solid ${actionColor}40`,
            borderRadius: 5, padding: '7px 14px',
            fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600,
            color: actionColor, cursor: disabled ? 'wait' : 'pointer',
            opacity: disabled ? 0.5 : 1,
          }}
        >
          {actionLabel}
        </button>
      </div>
    </div>
  )
}
