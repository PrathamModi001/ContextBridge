import { useState } from 'react'
import { useSocket } from './hooks/useSocket'
import { useGraph } from './hooks/useGraph'
import { TopBar } from './components/TopBar'
import { DevPanel } from './components/DevPanel'
import { Graph } from './components/Graph'
import { ConflictFeed } from './components/ConflictFeed'
import { BottomBar } from './components/BottomBar'
import type { AgentMode } from './types'

export function App() {
  const { socket, connected } = useSocket()
  const { nodes, links, conflicts, devStatuses } = useGraph(socket)
  const [mode, setMode] = useState<AgentMode>('smart')

  const devCount = [...devStatuses.values()].filter(d => d.connected).length

  function toggleMode() {
    const next: AgentMode = mode === 'smart' ? 'dumb' : 'smart'
    setMode(next)
    socket?.emit('mode:change', { mode: next })
  }

  return (
    <div className="flex flex-col h-screen bg-base overflow-hidden">
      <TopBar
        connected={connected}
        entityCount={nodes.length}
        conflictCount={conflicts.length}
        devCount={devCount}
        mode={mode}
        onModeToggle={toggleMode}
      />
      <div className="flex flex-1 overflow-hidden">
        <DevPanel devStatuses={devStatuses} />
        <Graph nodes={nodes} links={links} />
        <ConflictFeed conflicts={conflicts} />
      </div>
      <BottomBar
        connected={connected}
        entityCount={nodes.length}
        conflictCount={conflicts.length}
      />
    </div>
  )
}
