import { useEffect, useRef, useState } from 'react'
import type { Socket } from 'socket.io-client'
import type {
  GraphNode, GraphLink, ConflictEvent, DevStatus,
  EntityUpdateEvent, ConflictPayload,
} from '../types'

interface RawLink { source: string; target: string; conflict: boolean }

export function useGraph(socket: Socket | null) {
  const [nodes, setNodes] = useState<GraphNode[]>([])
  const [links, setLinks] = useState<GraphLink[]>([])
  const [conflicts, setConflicts] = useState<ConflictEvent[]>([])
  const [devStatuses, setDevStatuses] = useState<Map<string, DevStatus>>(new Map())
  const seenConflictIds = useRef(new Set<string>())

  useEffect(() => {
    if (!socket) return

    const onEntityUpdated = (data: EntityUpdateEvent) => {
      setNodes(prev => {
        const idx = prev.findIndex(n => n.id === data.name)
        const updated: GraphNode = {
          id: data.name,
          name: data.name,
          kind: data.kind ?? 'function',
          devId: data.devId,
          signature: data.signature,
          file: data.file ?? '',
          severity: data.severity,
          locked: data.locked,
          dependentsCount: idx >= 0 ? prev[idx].dependentsCount : 0,
          x: idx >= 0 ? prev[idx].x : undefined,
          y: idx >= 0 ? prev[idx].y : undefined,
        }
        return idx >= 0 ? prev.map((n, i) => i === idx ? updated : n) : [...prev, updated]
      })

      setDevStatuses(prev => {
        const next = new Map(prev)
        const existing = next.get(data.devId) ?? {
          devId: data.devId,
          connected: true,
          lastHeartbeat: Date.now(),
          entities: [],
        }
        const entities = existing.entities.includes(data.name)
          ? existing.entities
          : [...existing.entities, data.name]
        next.set(data.devId, {
          ...existing,
          connected: true,
          lastHeartbeat: Date.now(),
          entities,
          lastEntity: data.name,
        })
        return next
      })
    }

    const onGraphLinks = (incoming: RawLink[]) => {
      setLinks(prev => {
        const byKey = new Map<string, GraphLink>()
        for (const l of prev) {
          const s = typeof l.source === 'string' ? l.source : (l.source as GraphNode).id
          const t = typeof l.target === 'string' ? l.target : (l.target as GraphNode).id
          byKey.set(`${s}→${t}`, l)
        }
        for (const l of incoming) {
          const key = `${l.source}→${l.target}`
          const existing = byKey.get(key)
          byKey.set(key, {
            source: l.source,
            target: l.target,
            conflict: l.conflict || existing?.conflict || false,
          })
        }
        return [...byKey.values()]
      })
    }

    const onConflictDetected = (data: ConflictPayload) => {
      const id = data.sessionId ?? `${data.entityName}-${data.devAId}-${data.devBId}`
      if (seenConflictIds.current.has(id)) return
      seenConflictIds.current.add(id)
      const event: ConflictEvent = {
        id,
        entityName: data.entityName,
        severity: data.severity,
        devAId: data.devAId,
        devBId: data.devBId,
        oldSig: data.oldSig ?? '',
        newSig: data.newSig,
        impactCount: data.impactCount ?? 0,
        timestamp: new Date().toISOString(),
      }
      setConflicts(prev => [event, ...prev].slice(0, 50))
      setNodes(prev => prev.map(n =>
        n.name === data.entityName ? { ...n, severity: data.severity } : n
      ))
      /* Mark links involving this entity as conflict */
      setLinks(prev => prev.map(l => {
        const s = typeof l.source === 'string' ? l.source : (l.source as GraphNode).id
        const t = typeof l.target === 'string' ? l.target : (l.target as GraphNode).id
        const involved = s === data.entityName || t === data.entityName
        return involved ? { ...l, conflict: true, severity: data.severity } : l
      }))
    }

    const onClientHeartbeat = ({ devId, ts }: { devId: string; ts: number }) => {
      setDevStatuses(prev => {
        const next = new Map(prev)
        const s = next.get(devId)
        if (s) next.set(devId, { ...s, lastHeartbeat: ts })
        return next
      })
    }

    const onConflictsCleared = () => {
      seenConflictIds.current.clear()
      setConflicts([])
    }

    const onClientConnected = ({ devId }: { devId: string }) => {
      if (devId === 'dashboard') return
      setDevStatuses(prev => {
        const next = new Map(prev)
        next.set(devId, {
          devId,
          connected: true,
          lastHeartbeat: Date.now(),
          entities: prev.get(devId)?.entities ?? [],
        })
        return next
      })
    }

    const onClientDisconnected = ({ devId }: { devId: string }) => {
      if (devId === 'dashboard') return
      setDevStatuses(prev => {
        const next = new Map(prev)
        const s = next.get(devId)
        if (s) next.set(devId, { ...s, connected: false })
        return next
      })
    }

    const onSessionOpened = (data: { sessionId: string; entityName: string }) => {
      setNodes(prev => prev.map(n =>
        n.name === data.entityName ? { ...n, conflictSessionId: data.sessionId } : n,
      ))
    }

    const onConflictResolvedForGraph = (data: { sessionId: string; entityName: string }) => {
      setNodes(prev => prev.map(n =>
        n.name === data.entityName ? { ...n, conflictSessionId: undefined, severity: 'info' } : n,
      ))
      setConflicts(prev => prev.filter(c => c.id !== data.sessionId && c.entityName !== data.entityName))
      seenConflictIds.current.delete(data.sessionId)
    }

    socket.on('entity:updated',           onEntityUpdated)
    socket.on('graph:links',              onGraphLinks)
    socket.on('conflict:detected',        onConflictDetected)
    socket.on('conflicts:cleared',        onConflictsCleared)
    socket.on('client:connected',         onClientConnected)
    socket.on('client:disconnected',      onClientDisconnected)
    socket.on('client:heartbeat',         onClientHeartbeat)
    socket.on('conflict:session:opened',  onSessionOpened)
    socket.on('conflict:resolved',        onConflictResolvedForGraph)

    return () => {
      socket.off('entity:updated',           onEntityUpdated)
      socket.off('graph:links',              onGraphLinks)
      socket.off('conflict:detected',        onConflictDetected)
      socket.off('conflicts:cleared',        onConflictsCleared)
      socket.off('client:connected',         onClientConnected)
      socket.off('client:disconnected',      onClientDisconnected)
      socket.off('client:heartbeat',         onClientHeartbeat)
      socket.off('conflict:session:opened',  onSessionOpened)
      socket.off('conflict:resolved',        onConflictResolvedForGraph)
    }
  }, [socket])

  return { nodes, links, conflicts, devStatuses }
}
