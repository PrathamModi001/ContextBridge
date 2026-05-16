# dashboard — Real-Time Visualization

**Single responsibility:** Visualize the live entity graph, show conflict events, and provide a merge editor for conflict resolution.

---

## File Map

```
packages/dashboard/src/
├── main.tsx                          ← React root mount
├── App.tsx                           ← layout, socket connection, state wiring
│
├── components/
│   ├── Graph.tsx                     ← D3 force-directed graph (nodes = entities, edges = calls)
│   ├── ConflictFeed.tsx              ← scrollable list of detected conflicts
│   ├── ConflictMergeEditor.tsx       ← 3-panel merge editor (A | merged | B)
│   ├── DevPanel.tsx                  ← connected developers sidebar
│   ├── TopBar.tsx                    ← title + status bar
│   └── BottomBar.tsx                 ← entity count + conflict count
│
├── hooks/
│   ├── useSocket.ts                  ← Socket.IO connection + room join
│   ├── useGraph.ts                   ← entity nodes + graph links state
│   └── useConflictSessions.ts        ← conflict session list + blast radius tracking
│
├── types.ts                          ← GraphNode, GraphLink, ConflictSession, etc.
├── utils/devColor.ts                 ← stable color per devId (hash → hsl)
└── index.css                         ← global styles
```

---

## Layout

```
┌─────────────────────────────────────────────────────┐
│  TopBar  (ContextBridge | status)                   │
├────────────────────┬────────────────────────────────┤
│                    │                                │
│   Graph.tsx        │   ConflictFeed.tsx             │
│   D3 force graph   │   latest conflict events       │
│   nodes + edges    │   with resolve button          │
│                    │                                │
│                    ├────────────────────────────────┤
│                    │   ConflictMergeEditor.tsx       │
│                    │   (when session selected)       │
│                    │   devA code | merged | devB     │
├────────────────────┴────────────────────────────────┤
│  DevPanel (online devs)  |  BottomBar (counters)    │
└─────────────────────────────────────────────────────┘
```

---

## D3 Graph (Graph.tsx)

Two React `useEffect`s — one for initial SVG setup, one for data updates:

```
Effect 1 (runs once on mount):
  → create SVG, force simulation, zoom behavior
  → bind drag handlers
  → store refs for link/node/label selections

Effect 2 (runs when nodes/links change):
  → D3 join: .data().enter().exit().merge()
  → update positions on simulation tick
  → re-heat simulation: simulation.alphaTarget(0.3).restart()
  → node color = devColor(node.devId)
  → node size = larger for 'class', smaller for 'type'
  → conflict nodes pulse red (CSS animation class)
```

Split into two effects so node positions are preserved across React re-renders — `simulation.nodes()` keeps velocity/position state, only the data binding is updated.

---

## Socket → State Flow

```
Socket.IO event          Hook               State update
──────────────────────────────────────────────────────────
entity:updated      →  useGraph         →  nodes map updated
graph:links         →  useGraph         →  links array updated
conflict:detected   →  useConflictSess  →  feed item added
conflict:session:   →  useConflictSess  →  session added to list
  opened
conflict:session:   →  useConflictSess  →  session status = resolving
  resolving
conflict:resolved   →  useConflictSess  →  session removed from list
conflict:blast:     →  useConflictSess  →  session blastRadius++
  update
client:connected    →  App.tsx          →  devPanel shows dev online
client:disconnected →  App.tsx          →  devPanel removes dev
client:heartbeat    →  App.tsx          →  pulse indicator
```

---

## Conflict Merge Editor (ConflictMergeEditor.tsx)

Three-panel layout for an active conflict session:

```
┌──────────────┬──────────────────┬──────────────┐
│  Dev A code  │   Merged result  │  Dev B code  │
│  (read only) │   (editable)     │  (read only) │
│              │                  │              │
│  devASig     │  ← type here     │  devBSig     │
│  devABody    │                  │  devBBody    │
└──────────────┴──────────────────┴──────────────┘
  [Accept A]    [Submit Merge]     [Accept B]
```

Resolution types:
- **Accept A** → `POST /conflicts/sessions/:id/resolve` with `type: accepted_a`
- **Accept B** → same with `type: accepted_b`
- **Submit Merge** → same with `type: manual_merge, mergedBody, mergedSig`

After resolution: server emits `conflict:accepted` to both agent rooms, agents write accepted code to file.

---

## Dashboard Snapshot on Connect

When the dashboard socket joins `room:dashboard`, the server replays current state:
1. `client:connected` for every currently connected dev
2. `entity:updated` for every entity in Redis
3. `graph:links` for all known edges
4. Last 10 `conflict:detected` events (reversed so newest is last)
5. `conflict:session:opened` for every non-resolved session

This means the dashboard is always current even if it connects mid-session.
