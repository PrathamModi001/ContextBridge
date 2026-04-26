import { useEffect, useState } from 'react'
import type { Socket } from 'socket.io-client'
import type { ConflictSession, BlastUpdateEvent, ConflictResolvedEvent } from '../types'

interface SessionOpenedPayload {
  sessionId: string; entityName: string
  devAId: string; devBId: string
  devASig: string; devBSig: string
  devABody: string; devBBody: string
  blastRadius: number; securitySensitive: boolean
  conflictType: ConflictSession['conflictType']
}

export function useConflictSessions(socket: Socket | null) {
  const [sessions, setSessions] = useState<Map<string, ConflictSession>>(new Map())

  useEffect(() => {
    if (!socket) return

    const onOpened = (data: SessionOpenedPayload) => {
      setSessions(prev => {
        const next = new Map(prev)
        next.set(data.sessionId, {
          id:                data.sessionId,
          entityName:        data.entityName,
          devAId:            data.devAId,
          devBId:            data.devBId,
          devABody:          data.devABody,
          devASig:           data.devASig,
          devBBody:          data.devBBody,
          devBSig:           data.devBSig,
          status:            'open',
          detectedAt:        new Date().toISOString(),
          blastRadius:       data.blastRadius,
          securitySensitive: data.securitySensitive,
          conflictType:      data.conflictType,
        })
        return next
      })
    }

    const onBlastUpdate = (data: BlastUpdateEvent) => {
      setSessions(prev => {
        const next    = new Map(prev)
        const session = next.get(data.sessionId)
        if (session) next.set(data.sessionId, { ...session, blastRadius: data.blastRadius })
        return next
      })
    }

    const onResolving = ({ sessionId, resolvedBy }: { sessionId: string; resolvedBy: string }) => {
      setSessions(prev => {
        const next    = new Map(prev)
        const session = next.get(sessionId)
        if (session) next.set(sessionId, { ...session, status: 'resolving', resolvedBy })
        return next
      })
    }

    const onResolved = (data: ConflictResolvedEvent) => {
      setSessions(prev => {
        const next = new Map(prev)
        next.delete(data.sessionId)
        return next
      })
    }

    socket.on('conflict:session:opened',    onOpened)
    socket.on('conflict:blast:update',      onBlastUpdate)
    socket.on('conflict:session:resolving', onResolving)
    socket.on('conflict:resolved',          onResolved)

    return () => {
      socket.off('conflict:session:opened',    onOpened)
      socket.off('conflict:blast:update',      onBlastUpdate)
      socket.off('conflict:session:resolving', onResolving)
      socket.off('conflict:resolved',          onResolved)
    }
  }, [socket])

  function getSessionForEntity(entityName: string): ConflictSession | undefined {
    return [...sessions.values()].find(s => s.entityName === entityName && s.status !== 'resolved')
  }

  function getDamageStats(devId: string): { openConflicts: number; totalBlastRadius: number } {
    let openConflicts = 0
    let totalBlastRadius = 0
    for (const s of sessions.values()) {
      if (s.devBId === devId && s.status !== 'resolved') {
        openConflicts++
        totalBlastRadius += s.blastRadius
      }
    }
    return { openConflicts, totalBlastRadius }
  }

  return { sessions, getSessionForEntity, getDamageStats }
}
