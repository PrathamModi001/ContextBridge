import { useEffect, useState } from 'react'
import type { Socket } from 'socket.io-client'
import type {
  GraphNode, GraphLink, ConflictEvent, DevStatus,
  EntityUpdateEvent, ConflictPayload,
} from '../types'

export function useGraph(socket: Socket | null) {
  const [nodes, setNodes] = useState<GraphNode[]>([])
  const [links, setLinks] = useState<GraphLink[]>([])
  const [conflicts, setConflicts] = useState<ConflictEvent[]>([])
  const [devStatuses, setDevStatuses] = useState<Map<string, DevStatus>>(new Map())

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
        next.set(data.devId, { ...existing, connected: true, lastHeartbeat: Date.now(), entities, lastEntity: data.name })
        return next
      })
    }

    const onConflictDetected = (data: ConflictPayload) => {
      const event: ConflictEvent = {
        id: `${data.entityName}-${Date.now()}`,
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

    socket.on('entity:updated', onEntityUpdated)
    socket.on('conflict:detected', onConflictDetected)
    socket.on('client:connected', onClientConnected)
    socket.on('client:disconnected', onClientDisconnected)

    return () => {
      socket.off('entity:updated', onEntityUpdated)
      socket.off('conflict:detected', onConflictDetected)
      socket.off('client:connected', onClientConnected)
      socket.off('client:disconnected', onClientDisconnected)
    }
  }, [socket])

  return { nodes, links, conflicts, devStatuses }
}
