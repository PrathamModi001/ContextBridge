import { useEffect, useRef, useState } from 'react'
import * as d3 from 'd3'
import type { GraphNode, GraphLink, Severity } from '../types'

const NODE_FILL: Record<Severity, string> = {
  info:     '#3dd68c',
  warning:  '#f0a400',
  critical: '#ff4444',
}

const NODE_STROKE: Record<Severity, string> = {
  info:     '#2ab570',
  warning:  '#c88600',
  critical: '#cc2222',
}

const KIND_SYMBOL: Record<string, string> = {
  function:  'fn',
  type:      'T',
  interface: 'I',
  class:     'C',
}

function nodeRadius(n: GraphNode) { return Math.min(10 + n.dependentsCount * 2.5, 26) }
function srcNode(d: GraphLink)    { return d.source as GraphNode }
function tgtNode(d: GraphLink)    { return d.target as GraphNode }
function linkKey(d: GraphLink) {
  const s = typeof d.source === 'string' ? d.source : (d.source as GraphNode).id
  const t = typeof d.target === 'string' ? d.target : (d.target as GraphNode).id
  return `${s}→${t}`
}

interface Tooltip { x: number; y: number; node: GraphNode }
interface Props { nodes: GraphNode[]; links: GraphLink[] }

export function Graph({ nodes, links }: Props) {
  const svgRef  = useRef<SVGSVGElement>(null)
  const simRef  = useRef<d3.Simulation<GraphNode, GraphLink> | null>(null)
  const lgRef   = useRef<SVGGElement | null>(null)
  const ngRef   = useRef<SVGGElement | null>(null)
  const sNodes  = useRef<GraphNode[]>([])
  const sLinks  = useRef<GraphLink[]>([])
  const [tooltip, setTooltip] = useState<Tooltip | null>(null)

  /* ── Init SVG ── */
  useEffect(() => {
    if (!svgRef.current) return
    const svg = d3.select(svgRef.current)
    const { width, height } = svgRef.current.getBoundingClientRect()
    svg.selectAll('*').remove()

    const defs = svg.append('defs')

    /* warm dot-grid background */
    const pat = defs.append('pattern')
      .attr('id', 'cb-dots').attr('width', 28).attr('height', 28)
      .attr('patternUnits', 'userSpaceOnUse')
    pat.append('circle').attr('cx', 14).attr('cy', 14).attr('r', 0.75)
      .attr('fill', '#2c2924').attr('opacity', 0.7)

    svg.append('rect').attr('width', '100%').attr('height', '100%')
      .attr('fill', 'url(#cb-dots)')

    /* conflict glow filter */
    const cf = defs.append('filter').attr('id', 'conflict-glow')
      .attr('x', '-80%').attr('y', '-80%').attr('width', '260%').attr('height', '260%')
    cf.append('feGaussianBlur').attr('stdDeviation', 5).attr('result', 'blur')
    const cm = cf.append('feMerge')
    cm.append('feMergeNode').attr('in', 'blur')
    cm.append('feMergeNode').attr('in', 'SourceGraphic')

    /* arrowhead marker */
    defs.append('marker')
      .attr('id', 'arrow').attr('viewBox', '0 -4 8 8')
      .attr('refX', 14).attr('refY', 0)
      .attr('markerWidth', 5).attr('markerHeight', 5)
      .attr('orient', 'auto')
      .append('path').attr('d', 'M0,-4L8,0L0,4').attr('fill', '#3d3933').attr('opacity', 0.6)

    defs.append('marker')
      .attr('id', 'arrow-conflict').attr('viewBox', '0 -4 8 8')
      .attr('refX', 14).attr('refY', 0)
      .attr('markerWidth', 5).attr('markerHeight', 5)
      .attr('orient', 'auto')
      .append('path').attr('d', 'M0,-4L8,0L0,4').attr('fill', '#ff4444').attr('opacity', 0.7)

    const g = svg.append('g').attr('class', 'zoom-root')
    svg.call(
      d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.15, 6])
        .on('zoom', e => g.attr('transform', e.transform))
    )

    lgRef.current = g.append('g').attr('class', 'links').node()
    ngRef.current = g.append('g').attr('class', 'nodes').node()

    const sim = d3.forceSimulation<GraphNode, GraphLink>()
      .force('link', d3.forceLink<GraphNode, GraphLink>().id(d => d.id).distance(110).strength(0.35))
      .force('charge', d3.forceManyBody<GraphNode>().strength(-320))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collide', d3.forceCollide<GraphNode>().radius(d => nodeRadius(d) + 18))

    sim.on('tick', () => {
      d3.select(lgRef.current).selectAll<SVGLineElement, GraphLink>('line')
        .attr('x1', d => srcNode(d).x ?? 0)
        .attr('y1', d => srcNode(d).y ?? 0)
        .attr('x2', d => tgtNode(d).x ?? 0)
        .attr('y2', d => tgtNode(d).y ?? 0)

      d3.select(ngRef.current).selectAll<SVGGElement, GraphNode>('g.cb-node')
        .attr('transform', d => `translate(${d.x ?? 0},${d.y ?? 0})`)
    })

    simRef.current = sim
    return () => { sim.stop() }
  }, [])

  /* ── Update data ── */
  useEffect(() => {
    const sim = simRef.current
    const lg = lgRef.current
    const ng = ngRef.current
    if (!sim || !lg || !ng) return

    const byId = new Map(sNodes.current.map(n => [n.id, n]))
    sNodes.current = nodes.map(n => {
      const p = byId.get(n.id)
      return p ? Object.assign(p, n) : { ...n }
    })
    sLinks.current = links.map(l => ({ ...l }))

    /* links */
    const lSel = d3.select(lg).selectAll<SVGLineElement, GraphLink>('line')
      .data(sLinks.current, linkKey)
    lSel.exit().remove()
    lSel.enter().append('line').merge(lSel)
      .attr('stroke', d => d.conflict ? '#ff4444' : '#3d3933')
      .attr('stroke-width', d => d.conflict ? 1.5 : 1)
      .attr('stroke-dasharray', d => d.conflict ? '5 4' : 'none')
      .attr('opacity', d => d.conflict ? 0.75 : 0.4)
      .attr('marker-end', d => d.conflict ? 'url(#arrow-conflict)' : 'url(#arrow)')
      .classed('conflict-link', d => d.conflict)

    /* nodes */
    const nSel = d3.select(ng).selectAll<SVGGElement, GraphNode>('g.cb-node')
      .data(sNodes.current, d => d.id)
    nSel.exit().transition().duration(250).attr('opacity', 0).remove()

    const enter = nSel.enter().append('g')
      .attr('class', 'cb-node').attr('opacity', 0).style('cursor', 'pointer')
      .call(
        d3.drag<SVGGElement, GraphNode>()
          .on('start', (e, d) => { if (!e.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y })
          .on('drag',  (e, d) => { d.fx = e.x; d.fy = e.y })
          .on('end',   (e, d) => { if (!e.active) sim.alphaTarget(0); d.fx = null; d.fy = null })
      )

    enter.transition().duration(350).attr('opacity', 1)

    /* outer ring — only for conflict nodes */
    enter.append('circle').attr('class', 'pulse-ring')
      .attr('fill', 'none').attr('stroke-width', 1).attr('opacity', 0)

    /* main body */
    enter.append('circle').attr('class', 'body').attr('stroke-width', 1.5)

    /* kind label inside */
    enter.append('text').attr('class', 'kind-lbl')
      .attr('text-anchor', 'middle').attr('dominant-baseline', 'middle')
      .attr('font-family', 'JetBrains Mono, monospace').attr('font-weight', '500')
      .attr('pointer-events', 'none')

    /* name label below */
    enter.append('text').attr('class', 'name-lbl')
      .attr('text-anchor', 'middle')
      .attr('font-family', 'DM Sans, sans-serif')
      .attr('font-size', 11)
      .attr('fill', '#877f73')
      .attr('stroke', '#0d0c0b').attr('stroke-width', 3).attr('paint-order', 'stroke')
      .attr('pointer-events', 'none')

    enter
      .on('mouseenter', (e, d) => setTooltip({ x: (e as MouseEvent).offsetX, y: (e as MouseEvent).offsetY, node: d }))
      .on('mousemove',  (e)    => setTooltip(p => p ? { ...p, x: (e as MouseEvent).offsetX, y: (e as MouseEvent).offsetY } : null))
      .on('mouseleave', ()     => setTooltip(null))

    const all = enter.merge(nSel as d3.Selection<SVGGElement, GraphNode, SVGGElement, unknown>)

    all.select<SVGCircleElement>('.pulse-ring')
      .attr('r', d => nodeRadius(d) + 7)
      .attr('stroke', d => NODE_FILL[d.severity])
      .attr('opacity', d => d.severity === 'critical' ? 0.2 : 0)

    all.select<SVGCircleElement>('.body')
      .attr('r', d => nodeRadius(d))
      .attr('fill', d => NODE_FILL[d.severity])
      .attr('stroke', d => NODE_STROKE[d.severity])
      .attr('filter', d => d.severity === 'critical' ? 'url(#conflict-glow)' : 'none')

    all.select<SVGTextElement>('.kind-lbl')
      .attr('font-size', d => Math.max(8, nodeRadius(d) * 0.55))
      .attr('fill', d => d.severity === 'info' ? '#0d0c0b' : '#fff')
      .text(d => KIND_SYMBOL[d.kind] ?? '?')

    all.select<SVGTextElement>('.name-lbl')
      .attr('dy', d => nodeRadius(d) + 15)
      .text(d => d.name.length > 20 ? d.name.slice(0, 18) + '…' : d.name)

    sim.nodes(sNodes.current)
    ;(sim.force('link') as d3.ForceLink<GraphNode, GraphLink>).links(sLinks.current)
    sim.alpha(0.4).restart()
  }, [nodes, links])

  return (
    <div className="relative flex-1 overflow-hidden" style={{ background: 'var(--color-base)' }}>
      {nodes.length === 0 && <EmptyState />}
      <svg ref={svgRef} className="w-full h-full" />
      {tooltip && <NodeTooltip {...tooltip} />}
    </div>
  )
}

function EmptyState() {
  return (
    <div
      className="absolute inset-0 flex flex-col items-center justify-center gap-3 pointer-events-none"
      style={{ opacity: 0.18 }}
    >
      <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
        <circle cx="32" cy="32" r="28" stroke="var(--color-cb-text)" strokeWidth="1" />
        <circle cx="32" cy="32" r="14" stroke="var(--color-cb-text)" strokeWidth="1" strokeDasharray="4 3" />
        <circle cx="32" cy="32" r="3" fill="var(--color-cb-text)" />
        <line x1="32" y1="4" x2="32" y2="18" stroke="var(--color-cb-text)" strokeWidth="1" />
        <line x1="32" y1="46" x2="32" y2="60" stroke="var(--color-cb-text)" strokeWidth="1" />
        <line x1="4" y1="32" x2="18" y2="32" stroke="var(--color-cb-text)" strokeWidth="1" />
        <line x1="46" y1="32" x2="60" y2="32" stroke="var(--color-cb-text)" strokeWidth="1" />
      </svg>
      <div className="text-center">
        <p className="font-ui" style={{ fontSize: 14, fontWeight: 500, color: 'var(--color-cb-text)' }}>
          Awaiting signals
        </p>
        <p className="font-ui" style={{ fontSize: 12, color: 'var(--color-cb-muted)', marginTop: 4 }}>
          Start client watchers to populate the graph
        </p>
      </div>
    </div>
  )
}

function NodeTooltip({ x, y, node }: Tooltip) {
  const fill = NODE_FILL[node.severity]
  return (
    <div
      className="cb-tooltip absolute z-10 pointer-events-none animate-slide-in"
      style={{
        left: x + 16, top: y - 8,
        background: 'var(--color-raised)',
        border: '1px solid var(--color-cb-border-bright)',
        borderRadius: 10,
        padding: '10px 12px',
        maxWidth: 260,
        boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
      }}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <span
          className="font-mono shrink-0"
          style={{
            fontSize: 9, fontWeight: 500,
            padding: '2px 6px', borderRadius: 4,
            background: `${fill}18`, color: fill,
          }}
        >
          {KIND_SYMBOL[node.kind]}
        </span>
        <span className="font-mono" style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-cb-text)' }}>
          {node.name}
        </span>
        {node.locked && (
          <span className="font-ui ml-auto" style={{ fontSize: 9, color: 'var(--color-cb-amber)' }}>
            locked
          </span>
        )}
      </div>
      {node.signature && (
        <p className="font-mono break-all" style={{ fontSize: 10, color: 'var(--color-cb-muted)', lineHeight: 1.5, marginBottom: 6 }}>
          {node.signature}
        </p>
      )}
      <div className="flex items-center gap-3">
        <span className="font-ui" style={{ fontSize: 10, color: 'var(--color-cb-dim)' }}>
          by {node.devId}
        </span>
        {node.dependentsCount > 0 && (
          <span className="font-ui" style={{ fontSize: 10, color: 'var(--color-cb-muted)' }}>
            {node.dependentsCount} dependent{node.dependentsCount !== 1 ? 's' : ''}
          </span>
        )}
      </div>
    </div>
  )
}
