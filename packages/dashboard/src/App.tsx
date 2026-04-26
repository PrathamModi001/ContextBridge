import { useState } from 'react'
import { useSocket } from './hooks/useSocket'
import { useGraph } from './hooks/useGraph'
import { useConflictSessions } from './hooks/useConflictSessions'
import { TopBar } from './components/TopBar'
import { DevPanel } from './components/DevPanel'
import { Graph } from './components/Graph'
import { ConflictFeed } from './components/ConflictFeed'
import { BottomBar } from './components/BottomBar'
import { ConflictMergeEditor } from './components/ConflictMergeEditor'
import type { AgentMode, ConflictSession } from './types'

export function App() {
  const { socket, connected } = useSocket()
  const { nodes, links, conflicts, devStatuses } = useGraph(socket)
  const { getSessionForEntity, getDamageStats } = useConflictSessions(socket)
  const [mode, setMode] = useState<AgentMode>('smart')
  const [activeSession, setActiveSession] = useState<ConflictSession | null>(null)

  const devCount = [...devStatuses.values()].filter(d => d.connected).length

  function toggleMode() {
    const next: AgentMode = mode === 'smart' ? 'dumb' : 'smart'
    setMode(next)
    socket?.emit('mode:change', { mode: next })
  }

  function handleNodeClick(entityName: string) {
    const session = getSessionForEntity(entityName)
    if (session) setActiveSession(session)
  }

  function handleResolveFromFeed(entityName: string) {
    const session = getSessionForEntity(entityName)
    if (session) setActiveSession(session)
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ background: 'var(--color-base)' }}>
      <TopBar
        connected={connected}
        entityCount={nodes.length}
        conflictCount={conflicts.length}
        devCount={devCount}
        mode={mode}
        onModeToggle={toggleMode}
      />
      <div className="flex flex-1 overflow-hidden">
        <DevPanel devStatuses={devStatuses} getDamageStats={getDamageStats} />
        <Graph nodes={nodes} links={links} onNodeClick={handleNodeClick} />
        <ConflictFeed conflicts={conflicts} onResolve={handleResolveFromFeed} />
      </div>
      <BottomBar connected={connected} entityCount={nodes.length} conflictCount={conflicts.length} conflicts={conflicts} />
      {activeSession !== null && (
        <ConflictMergeEditor
          session={activeSession}
          onClose={() => setActiveSession(null)}
          onResolved={(_sessionId) => setActiveSession(null)}
        />
      )}
    </div>
  )
}
