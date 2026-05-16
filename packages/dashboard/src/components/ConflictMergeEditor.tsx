import { useState, useMemo } from 'react'
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

/* Simple line diff — marks lines unique to one side */
function diffLines(
  aLines: string[],
  bLines: string[],
): { changed: boolean }[] {
  const bSet = new Set(bLines)
  return aLines.map(line => ({ changed: !bSet.has(line) }))
}

function DiffedCode({ body, otherBody, color }: { body: string; otherBody: string; color: string }) {
  const lines = body.split('\n')
  const otherLines = otherBody.split('\n')
  const diff = diffLines(lines, otherLines)

  return (
    <div
      style={{
        flex: 1, overflow: 'auto', margin: 0,
        fontFamily: 'var(--font-mono)', fontSize: 10,
        lineHeight: 1.6, whiteSpace: 'pre',
      }}
    >
      {lines.map((line, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            background: diff[i].changed ? `${color}18` : 'transparent',
            borderLeft: diff[i].changed ? `2px solid ${color}` : '2px solid transparent',
          }}
        >
          <span style={{ width: 28, flexShrink: 0, textAlign: 'right', paddingRight: 8,
            color: diff[i].changed ? color : 'var(--color-text-3)', userSelect: 'none',
            opacity: diff[i].changed ? 0.9 : 0.4, fontSize: 9 }}>
            {i + 1}
          </span>
          <span style={{ color: diff[i].changed ? 'var(--color-text)' : 'var(--color-text-2)',
            paddingLeft: 4, wordBreak: 'break-all', whiteSpace: 'pre-wrap' }}>
            {line || ' '}
          </span>
        </div>
      ))}
    </div>
  )
}

export function ConflictMergeEditor({ session, onClose, onResolved }: Props) {
  const [mergedBody, setMergedBody] = useState('')
  const [mergedSig,  setMergedSig]  = useState('')
  const [selected,   setSelected]   = useState<'a' | 'b' | 'manual' | null>(null)
  const [submitting, setSubmitting]  = useState(false)
  const [error,      setError]       = useState<string | null>(null)

  const colorA    = devColor(session.devAId)
  const colorB    = devColor(session.devBId)
  const typeLabel = CONFLICT_TYPE_LABELS[session.conflictType] ?? session.conflictType

  const resolveType = useMemo((): 'accepted_a' | 'accepted_b' | 'manual_merge' => {
    if (selected === 'a') return 'accepted_a'
    if (selected === 'b') return 'accepted_b'
    return 'manual_merge'
  }, [selected])

  function useA() {
    setMergedBody(session.devABody)
    setMergedSig(session.devASig)
    setSelected('a')
    setError(null)
  }

  function useB() {
    setMergedBody(session.devBBody)
    setMergedSig(session.devBSig)
    setSelected('b')
    setError(null)
  }

  async function submit() {
    if (!mergedBody.trim()) { setError('Merged result is empty'); return }
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`${SERVER}/v1/conflicts/sessions/${session.id}/resolve`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          type:       resolveType,
          mergedBody,
          mergedSig,
          resolvedBy: 'dashboard',
        }),
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

  const canSubmit = mergedBody.trim().length > 0 && !submitting

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
        width: 'min(95vw, 1160px)', maxHeight: '90vh',
        display: 'flex', flexDirection: 'column',
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border-hi)',
        borderTop: '2px solid #fc5c5c',
        borderRadius: 8, overflow: 'hidden',
        boxShadow: '0 24px 80px rgba(0,0,0,0.7)',
      }}>

        {/* Header */}
        <div style={{
          padding: '12px 18px', borderBottom: '1px solid var(--color-border)',
          display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
        }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 600, color: '#fc5c5c' }}>⚡</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 600, color: 'var(--color-text)' }}>
            {session.entityName}
          </span>
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 10, padding: '2px 7px', borderRadius: 3,
            background: 'rgba(252,92,92,0.1)', color: '#fc5c5c', border: '1px solid rgba(252,92,92,0.2)',
          }}>
            {typeLabel}
          </span>
          {session.securitySensitive && (
            <span style={{
              fontFamily: 'var(--font-mono)', fontSize: 10, padding: '2px 7px', borderRadius: 3,
              background: 'rgba(252,92,92,0.15)', color: '#fc5c5c', border: '1px solid rgba(252,92,92,0.3)',
            }}>
              🔒 AUTH SENSITIVE
            </span>
          )}
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-text-3)', marginLeft: 'auto' }}>
            blast radius: {session.blastRadius} downstream
          </span>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: 'var(--color-text-3)', cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: '0 4px' }}
          >×</button>
        </div>

        {/* Instruction bar */}
        <div style={{
          padding: '7px 18px', borderBottom: '1px solid var(--color-border)',
          background: 'var(--color-raised)', flexShrink: 0,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-text-3)' }}>
            Highlighted lines differ between versions.
          </span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-text-3)', marginLeft: 8 }}>
            1. Click <span style={{ color: colorA }}>Use A</span> or <span style={{ color: colorB }}>Use B</span> to load into merged panel.
            2. Edit if needed.
            3. Click <strong style={{ color: 'var(--color-text)' }}>Accept Merged Version</strong>.
          </span>
        </div>

        {/* 3-panel body */}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>

          {/* Left: devA */}
          <div style={{ width: 300, flexShrink: 0, display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--color-border)' }}>
            <PanelHeader
              devId={session.devAId}
              subtitle="current owner"
              color={colorA}
              selected={selected === 'a'}
            />
            <SigRow sig={session.devASig} />
            <DiffedCode body={session.devABody} otherBody={session.devBBody} color={colorA} />
            <div style={{ padding: '10px 12px', borderTop: '1px solid var(--color-border)', flexShrink: 0, display: 'flex', justifyContent: 'flex-end' }}>
              <ActionButton label="Use A →" color={colorA} onClick={useA} active={selected === 'a'} disabled={submitting} />
            </div>
          </div>

          {/* Center: merged */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div style={{
              padding: '8px 12px', borderBottom: '1px solid var(--color-border)',
              fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-text-2)',
              letterSpacing: '0.08em', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8,
            }}>
              MERGED RESULT
              {selected && (
                <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 3,
                  background: selected === 'a' ? `${colorA}20` : `${colorB}20`,
                  color: selected === 'a' ? colorA : colorB,
                  border: `1px solid ${selected === 'a' ? colorA : colorB}40`,
                }}>
                  {selected === 'a' ? `from ${session.devAId}` : `from ${session.devBId}`}
                </span>
              )}
              <span style={{ color: 'var(--color-text-3)', marginLeft: 'auto', fontSize: 9 }}>editable</span>
            </div>
            <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
              <input
                value={mergedSig}
                onChange={e => { setMergedSig(e.target.value); setSelected('manual') }}
                placeholder="Signature will appear here after selecting A or B"
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
              onChange={e => { setMergedBody(e.target.value); setSelected('manual') }}
              placeholder="Select A or B above, then edit here if needed…"
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
                onClick={submit}
                disabled={!canSubmit}
                style={{
                  marginLeft: 'auto',
                  background: canSubmit ? 'rgba(33,212,253,0.12)' : 'rgba(91,112,135,0.08)',
                  border: `1px solid ${canSubmit ? 'rgba(33,212,253,0.3)' : 'var(--color-border)'}`,
                  borderRadius: 5, padding: '7px 18px',
                  fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600,
                  color: canSubmit ? 'var(--color-cyan)' : 'var(--color-text-3)',
                  cursor: canSubmit ? 'pointer' : 'not-allowed',
                  transition: 'all 0.15s',
                }}
              >
                {submitting ? 'Resolving…' : 'Accept Merged Version ✓'}
              </button>
            </div>
          </div>

          {/* Right: devB */}
          <div style={{ width: 300, flexShrink: 0, display: 'flex', flexDirection: 'column', borderLeft: '1px solid var(--color-border)' }}>
            <PanelHeader
              devId={session.devBId}
              subtitle="incoming change"
              color={colorB}
              selected={selected === 'b'}
            />
            <SigRow sig={session.devBSig} />
            <DiffedCode body={session.devBBody} otherBody={session.devABody} color={colorB} />
            <div style={{ padding: '10px 12px', borderTop: '1px solid var(--color-border)', flexShrink: 0, display: 'flex', justifyContent: 'flex-start' }}>
              <ActionButton label="← Use B" color={colorB} onClick={useB} active={selected === 'b'} disabled={submitting} />
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}

function PanelHeader({ devId, subtitle, color, selected }: { devId: string; subtitle: string; color: string; selected: boolean }) {
  return (
    <div style={{
      padding: '8px 12px', borderBottom: '1px solid var(--color-border)',
      borderTop: `2px solid ${selected ? color : 'transparent'}`,
      background: selected ? `${color}08` : 'transparent',
      flexShrink: 0, transition: 'all 0.15s',
    }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600, color }}>{devId}</div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--color-text-3)', marginTop: 2 }}>{subtitle}</div>
    </div>
  )
}

function SigRow({ sig }: { sig: string }) {
  return (
    <div style={{
      padding: '6px 10px', borderBottom: '1px solid var(--color-border)',
      fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-text-2)',
      background: 'var(--color-base)', flexShrink: 0, wordBreak: 'break-all',
    }}>
      {sig || '(no signature)'}
    </div>
  )
}

function ActionButton({ label, color, onClick, active, disabled }: {
  label: string; color: string; onClick: () => void; active: boolean; disabled: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: active ? `${color}22` : `${color}10`,
        border: `1px solid ${active ? color + '70' : color + '30'}`,
        borderRadius: 5, padding: '7px 14px',
        fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600,
        color: active ? color : color + 'aa',
        cursor: disabled ? 'wait' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'all 0.15s',
      }}
    >
      {label}
    </button>
  )
}
