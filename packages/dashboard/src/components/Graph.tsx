import { useEffect, useRef, useState } from 'react'
import * as d3 from 'd3'
import type { GraphNode, GraphLink, Severity } from '../types'
import { devColor } from '../utils/devColor'

/* ── Severity → node stroke/fill ── */
const SEV_STROKE: Record<Severity, string> = {
  info:     'rgba(91,112,135,0.3)',
  warning:  '#fd8c5b',
  critical: '#fc5c5c',
}
const SEV_FILL: Record<Severity, string> = {
  info:     '#0c1020',
  warning:  '#1c1208',
  critical: '#1c0808',
}

/* ── Kind → Greek symbol ── */
const KIND_GLYPH: Record<string, string> = {
  function:  'λ',
  type:      'τ',
  interface: 'ι',
  class:     'κ',
}

function nodeR(n: GraphNode) { return Math.min(11 + n.dependentsCount * 2.5, 28) }
function src(d: GraphLink)   { return d.source as GraphNode }
function tgt(d: GraphLink)   { return d.target as GraphNode }
function lKey(d: GraphLink) {
  const s = typeof d.source === 'string' ? d.source : (d.source as GraphNode).id
  const t = typeof d.target === 'string' ? d.target : (d.target as GraphNode).id
  return `${s}→${t}`
}

interface TipState { x: number; y: number; node: GraphNode }
interface Props    { nodes: GraphNode[]; links: GraphLink[]; onNodeClick?: (entityName: string) => void }

export function Graph({ nodes, links, onNodeClick }: Props) {
  const svgRef  = useRef<SVGSVGElement>(null)
  const simRef  = useRef<d3.Simulation<GraphNode, GraphLink> | null>(null)
  const lgRef   = useRef<SVGGElement | null>(null)
  const ngRef   = useRef<SVGGElement | null>(null)
  const sNodes  = useRef<GraphNode[]>([])
  const sLinks  = useRef<GraphLink[]>([])
  const [tip, setTip] = useState<TipState | null>(null)

  /* ── Build SVG once ── */
  useEffect(() => {
    if (!svgRef.current) return
    const svg = d3.select(svgRef.current)
    const { width, height } = svgRef.current.getBoundingClientRect()
    svg.selectAll('*').remove()

    const defs = svg.append('defs')

    /* Crosshatch grid */
    const grid = defs.append('pattern')
      .attr('id', 'cb-grid').attr('width', 40).attr('height', 40)
      .attr('patternUnits', 'userSpaceOnUse')
    grid.append('path')
      .attr('d', 'M 40 0 L 0 0 0 40')
      .attr('fill', 'none')
      .attr('stroke', 'rgba(51,65,85,0.22)')
      .attr('stroke-width', '0.5')

    svg.append('rect').attr('width', '100%').attr('height', '100%')
      .attr('fill', 'url(#cb-grid)')

    /* Critical glow filter */
    const glowF = defs.append('filter').attr('id', 'cb-glow')
      .attr('x', '-80%').attr('y', '-80%').attr('width', '260%').attr('height', '260%')
    glowF.append('feGaussianBlur').attr('stdDeviation', '4').attr('result', 'blur')
    const mg = glowF.append('feMerge')
    mg.append('feMergeNode').attr('in', 'blur')
    mg.append('feMergeNode').attr('in', 'SourceGraphic')

    /* Arrow — normal */
    defs.append('marker')
      .attr('id', 'arr').attr('viewBox', '0 -4 8 8')
      .attr('refX', 18).attr('refY', 0)
      .attr('markerWidth', 5).attr('markerHeight', 5).attr('orient', 'auto')
      .append('path').attr('d', 'M0,-4L8,0L0,4')
      .attr('fill', 'rgba(51,65,85,0.55)')

    /* Arrow — conflict */
    defs.append('marker')
      .attr('id', 'arr-c').attr('viewBox', '0 -4 8 8')
      .attr('refX', 18).attr('refY', 0)
      .attr('markerWidth', 5).attr('markerHeight', 5).attr('orient', 'auto')
      .append('path').attr('d', 'M0,-4L8,0L0,4')
      .attr('fill', '#fc5c5c').attr('opacity', '0.8')

    const g = svg.append('g').attr('class', 'root')
    svg.call(
      d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.08, 8])
        .on('zoom', e => g.attr('transform', e.transform))
    )

    lgRef.current = g.append('g').attr('class', 'links').node()
    ngRef.current = g.append('g').attr('class', 'nodes').node()

    const sim = d3.forceSimulation<GraphNode, GraphLink>()
      .force('link',      d3.forceLink<GraphNode, GraphLink>().id(d => d.id).distance(125).strength(0.3))
      .force('charge',    d3.forceManyBody<GraphNode>().strength(-360))
      .force('center',    d3.forceCenter(width / 2, height / 2))
      .force('collide',   d3.forceCollide<GraphNode>().radius(d => nodeR(d) + 22))
      .force('cluster-x', d3.forceX<GraphNode>(d => {
        if (d.severity === 'critical') return width / 2
        const devIds = ['devA', 'devB']
        const idx    = devIds.indexOf(d.devId)
        if (idx === -1) return width / 2
        return idx === 0 ? width * 0.35 : width * 0.65
      }).strength(0.06))
      .force('cluster-y', d3.forceY<GraphNode>(height / 2).strength(0.03))

    sim.on('tick', () => {
      d3.select(lgRef.current).selectAll<SVGLineElement, GraphLink>('line')
        .attr('x1', d => src(d).x ?? 0).attr('y1', d => src(d).y ?? 0)
        .attr('x2', d => tgt(d).x ?? 0).attr('y2', d => tgt(d).y ?? 0)
      d3.select(ngRef.current).selectAll<SVGGElement, GraphNode>('g.cb-node')
        .attr('transform', d => `translate(${d.x ?? 0},${d.y ?? 0})`)
    })

    simRef.current = sim
    return () => { sim.stop() }
  }, [])

  /* ── Update on data change ── */
  useEffect(() => {
    const sim = simRef.current, lg = lgRef.current, ng = ngRef.current
    if (!sim || !lg || !ng) return

    const byId = new Map(sNodes.current.map(n => [n.id, n]))
    sNodes.current = nodes.map(n => {
      const p = byId.get(n.id)
      return p ? Object.assign(p, n) : { ...n }
    })
    sLinks.current = links.map(l => ({ ...l }))

    /* — Links — */
    const lSel = d3.select(lg).selectAll<SVGLineElement, GraphLink>('line')
      .data(sLinks.current, lKey)
    lSel.exit().remove()
    lSel.enter().append('line').merge(lSel)
      .attr('stroke',            d => d.conflict ? '#fc5c5c' : 'rgba(51,65,85,0.55)')
      .attr('stroke-width',      d => d.conflict ? 1.5 : 1)
      .attr('stroke-dasharray',  d => d.conflict ? '5 4' : 'none')
      .attr('opacity',           d => d.conflict ? 0.8 : 0.55)
      .attr('marker-end',        d => d.conflict ? 'url(#arr-c)' : 'url(#arr)')
      .classed('dash-link',      d => d.conflict)

    /* — Nodes — */
    const nSel = d3.select(ng).selectAll<SVGGElement, GraphNode>('g.cb-node')
      .data(sNodes.current, d => d.id)
    nSel.exit().transition().duration(200).attr('opacity', 0).remove()

    const enter = nSel.enter().append('g')
      .attr('class', 'cb-node')
      .attr('opacity', 0)
      .style('cursor', 'pointer')
      .call(
        d3.drag<SVGGElement, GraphNode>()
          .on('start', (e, d) => { if (!e.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y })
          .on('drag',  (e, d) => { d.fx = e.x; d.fy = e.y })
          .on('end',   (e, d) => { if (!e.active) sim.alphaTarget(0); d.fx = null; d.fy = null })
      )

    enter.transition().duration(380).attr('opacity', 1)

    /* Dev ownership ring */
    enter.append('circle').attr('class', 'dev-ring')
      .attr('fill', 'none').attr('stroke-width', 1.5)

    /* Node body */
    enter.append('circle').attr('class', 'body')
      .attr('stroke-width', 1.5)

    /* Kind glyph (Greek letter) */
    enter.append('text').attr('class', 'glyph')
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'middle')
      .attr('font-family', 'IBM Plex Mono, monospace')
      .attr('pointer-events', 'none')

    /* Name label below node */
    enter.append('text').attr('class', 'name')
      .attr('text-anchor', 'middle')
      .attr('font-family', 'IBM Plex Mono, monospace')
      .attr('font-size', 10)
      .attr('fill', 'rgba(91,112,135,0.85)')
      .attr('stroke', '#060a11')
      .attr('stroke-width', 3)
      .attr('paint-order', 'stroke')
      .attr('pointer-events', 'none')

    enter
      .on('mouseenter', (e, d) => setTip({ x: (e as MouseEvent).offsetX, y: (e as MouseEvent).offsetY, node: d }))
      .on('mousemove',  e     => setTip(p => p ? { ...p, x: (e as MouseEvent).offsetX, y: (e as MouseEvent).offsetY } : null))
      .on('mouseleave', ()    => setTip(null))
      .on('click', (_e, d) => {
        if (onNodeClick) onNodeClick(d.name)
      })

    const all = enter.merge(nSel as d3.Selection<SVGGElement, GraphNode, SVGGElement, unknown>)

    all.style('cursor', d => d.conflictSessionId ? 'pointer' : 'grab')

    /* Dev ring — color = dev ownership */
    all.select<SVGCircleElement>('.dev-ring')
      .attr('r',            d => nodeR(d) + 5)
      .attr('stroke',       d => d.conflictSessionId ? '#fc5c5c' : devColor(d.devId))
      .attr('opacity',      d => d.conflictSessionId ? 0.9 : d.severity === 'critical' ? 0.7 : 0.35)
      .attr('stroke-width', d => d.conflictSessionId ? 2 : 1.5)

    /* Body — fill tinted by severity, border = severity */
    all.select<SVGCircleElement>('.body')
      .attr('r',      d => nodeR(d))
      .attr('fill',   d => SEV_FILL[d.severity])
      .attr('stroke', d => SEV_STROKE[d.severity])
      .attr('filter', d => d.severity === 'critical' ? 'url(#cb-glow)' : 'none')

    /* Greek-letter glyph colored by dev owner */
    all.select<SVGTextElement>('.glyph')
      .attr('font-size', d => Math.max(10, nodeR(d) * 0.68))
      .attr('fill',      d => devColor(d.devId))
      .attr('opacity',   0.85)
      .text(d => KIND_GLYPH[d.kind] ?? '?')

    all.select<SVGTextElement>('.name')
      .attr('dy', d => nodeR(d) + 16)
      .text(d => d.name.length > 18 ? d.name.slice(0, 16) + '…' : d.name)

    sim.nodes(sNodes.current)
    ;(sim.force('link') as d3.ForceLink<GraphNode, GraphLink>).links(sLinks.current)
    sim.alpha(0.4).restart()
  }, [nodes, links])

  return (
    <div style={{ flex: 1, position: 'relative', overflow: 'hidden', background: 'var(--color-base)' }}>
      {nodes.length === 0 && <EmptyState />}
      <svg ref={svgRef} style={{ width: '100%', height: '100%' }} />
      {tip && <NodeTooltip tip={tip} />}
    </div>
  )
}

/* ── Empty state ── */
function EmptyState() {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        pointerEvents: 'none',
        opacity: 0.2,
        color: 'var(--color-text-2)',
      }}
    >
      <svg width="60" height="60" viewBox="0 0 60 60" fill="none">
        <polygon
          points="30,4 53,17 53,43 30,56 7,43 7,17"
          stroke="currentColor" strokeWidth="1"
        />
        <polygon
          points="30,16 42,23 42,37 30,44 18,37 18,23"
          stroke="currentColor" strokeWidth="1" strokeDasharray="3 2"
        />
        <circle cx="30" cy="30" r="3.5" fill="currentColor" />
      </svg>
      <div style={{ textAlign: 'center', lineHeight: 1.65 }}>
        <p style={{ fontFamily: 'IBM Plex Mono', fontSize: 12, fontWeight: 500, letterSpacing: '0.06em', marginBottom: 5 }}>
          AWAITING SIGNAL
        </p>
        <p style={{ fontFamily: 'IBM Plex Mono', fontSize: 11, opacity: 0.65 }}>
          Start client watchers to populate the graph
          <span className="animate-blink" style={{ marginLeft: 2 }}>_</span>
        </p>
      </div>
    </div>
  )
}

/* ── Tooltip ── */
function NodeTooltip({ tip }: { tip: TipState }) {
  const { x, y, node } = tip
  const color     = devColor(node.devId)
  const sevColor  = SEV_STROKE[node.severity]
  const glyph     = KIND_GLYPH[node.kind] ?? '?'

  return (
    <div
      className="animate-slide-down"
      style={{
        position: 'absolute',
        left: x + 16,
        top: Math.max(8, y - 12),
        zIndex: 10,
        pointerEvents: 'none',
        fontFamily: 'IBM Plex Mono, monospace',
        background: 'var(--color-raised)',
        border: '1px solid var(--color-border-hi)',
        borderTop: `2px solid ${color}`,
        borderRadius: 7,
        padding: '12px 14px',
        maxWidth: 290,
        boxShadow: '0 12px 40px rgba(0,0,0,0.65), 0 2px 8px rgba(0,0,0,0.4)',
      }}
    >
      {/* Title row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 9 }}>
        <span
          style={{
            width: 26,
            height: 26,
            borderRadius: 5,
            background: `${color}15`,
            border: `1px solid ${color}35`,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 14,
            color,
            flexShrink: 0,
          }}
        >
          {glyph}
        </span>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)', flex: 1 }}>
          {node.name}
        </span>
        {node.severity !== 'info' && (
          <span
            style={{
              fontSize: 9,
              letterSpacing: '0.08em',
              padding: '2px 6px',
              borderRadius: 3,
              background: `${sevColor}18`,
              color: sevColor,
              flexShrink: 0,
            }}
          >
            {node.severity.toUpperCase()}
          </span>
        )}
      </div>

      {/* Signature */}
      {node.signature && (
        <div
          style={{
            fontSize: 10,
            color: 'var(--color-text-2)',
            lineHeight: 1.6,
            marginBottom: 10,
            wordBreak: 'break-all',
            padding: '7px 9px',
            background: 'var(--color-base)',
            borderRadius: 4,
            border: '1px solid var(--color-border)',
          }}
        >
          {node.signature}
        </div>
      )}

      {/* Meta grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 8,
          borderTop: '1px solid var(--color-border)',
          paddingTop: 9,
        }}
      >
        <MetaCell label="OWNER"  value={node.devId}                       color={color} />
        <MetaCell label="DEPS"   value={String(node.dependentsCount)}      />
        <MetaCell label="FILE"   value={node.file || '—'}                  truncate />
      </div>
    </div>
  )
}

function MetaCell({ label, value, color, truncate }: {
  label: string; value: string; color?: string; truncate?: boolean
}) {
  return (
    <div>
      <div style={{ fontSize: 9, letterSpacing: '0.08em', color: 'var(--color-text-3)', marginBottom: 3 }}>
        {label}
      </div>
      <div
        style={{
          fontSize: 10,
          fontWeight: 500,
          color: color ?? 'var(--color-text-2)',
          overflow: truncate ? 'hidden' : undefined,
          textOverflow: truncate ? 'ellipsis' : undefined,
          whiteSpace: truncate ? 'nowrap' : undefined,
        }}
      >
        {value}
      </div>
    </div>
  )
}
