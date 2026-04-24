import { useEffect, useRef, useState } from 'react'
import * as d3 from 'd3'
import type { GraphNode, GraphLink, Severity } from '../types'

const NODE_COLOR: Record<Severity, string> = {
  info: '#00e87a',
  warning: '#f59e0b',
  critical: '#ff2d55',
}

const FILTER_ID: Record<Severity, string> = {
  info: 'glow-green',
  warning: 'glow-amber',
  critical: 'glow-red',
}

const KIND_LABEL: Record<string, string> = {
  function: 'fn',
  type: 'T',
  interface: 'I',
  class: 'C',
}

function nodeR(n: GraphNode) { return Math.min(8 + n.dependentsCount * 2, 28) }
function nodeColor(n: GraphNode) { return NODE_COLOR[n.severity] }
function nodeFilter(n: GraphNode) { return `url(#${FILTER_ID[n.severity]})` }
function srcNode(d: GraphLink) { return d.source as GraphNode }
function tgtNode(d: GraphLink) { return d.target as GraphNode }
function linkKey(d: GraphLink) {
  const s = typeof d.source === 'string' ? d.source : (d.source as GraphNode).id
  const t = typeof d.target === 'string' ? d.target : (d.target as GraphNode).id
  return `${s}→${t}`
}

interface Tooltip { x: number; y: number; node: GraphNode }
interface Props { nodes: GraphNode[]; links: GraphLink[] }

export function Graph({ nodes, links }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const simRef = useRef<d3.Simulation<GraphNode, GraphLink> | null>(null)
  const linkGRef = useRef<SVGGElement | null>(null)
  const nodeGRef = useRef<SVGGElement | null>(null)
  const simNodes = useRef<GraphNode[]>([])
  const simLinks = useRef<GraphLink[]>([])
  const [tooltip, setTooltip] = useState<Tooltip | null>(null)

  /* ─── Init SVG + simulation ─── */
  useEffect(() => {
    if (!svgRef.current) return
    const svg = d3.select(svgRef.current)
    const { width, height } = svgRef.current.getBoundingClientRect()
    svg.selectAll('*').remove()

    const defs = svg.append('defs')

    /* grid pattern */
    const pat = defs.append('pattern')
      .attr('id', 'cb-grid').attr('width', 40).attr('height', 40)
      .attr('patternUnits', 'userSpaceOnUse')
    pat.append('path').attr('d', 'M40 0 L0 0 0 40').attr('fill', 'none')
      .attr('stroke', '#1a1a2e').attr('stroke-width', 0.6)
    svg.append('rect').attr('width', '100%').attr('height', '100%').attr('fill', 'url(#cb-grid)')

    /* glow filters */
    const glow = (id: string, std: number) => {
      const f = defs.append('filter').attr('id', id)
        .attr('x', '-60%').attr('y', '-60%').attr('width', '220%').attr('height', '220%')
      f.append('feGaussianBlur').attr('stdDeviation', std).attr('result', 'blur')
      const m = f.append('feMerge')
      m.append('feMergeNode').attr('in', 'blur')
      m.append('feMergeNode').attr('in', 'SourceGraphic')
    }
    glow('glow-green', 4)
    glow('glow-amber', 4)
    glow('glow-red', 6)

    const g = svg.append('g').attr('class', 'zoom-root')
    svg.call(d3.zoom<SVGSVGElement, unknown>().scaleExtent([0.2, 5])
      .on('zoom', e => g.attr('transform', e.transform)))

    linkGRef.current = g.append('g').attr('class', 'links').node()
    nodeGRef.current = g.append('g').attr('class', 'nodes').node()

    const sim = d3.forceSimulation<GraphNode, GraphLink>()
      .force('link', d3.forceLink<GraphNode, GraphLink>().id(d => d.id).distance(130).strength(0.4))
      .force('charge', d3.forceManyBody<GraphNode>().strength(-350))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collide', d3.forceCollide<GraphNode>().radius(d => nodeR(d) + 14))

    sim.on('tick', () => {
      d3.select(linkGRef.current).selectAll<SVGLineElement, GraphLink>('line')
        .attr('x1', d => srcNode(d).x ?? 0).attr('y1', d => srcNode(d).y ?? 0)
        .attr('x2', d => tgtNode(d).x ?? 0).attr('y2', d => tgtNode(d).y ?? 0)
      d3.select(nodeGRef.current).selectAll<SVGGElement, GraphNode>('g.cb-node')
        .attr('transform', d => `translate(${d.x ?? 0},${d.y ?? 0})`)
    })

    simRef.current = sim
    return () => { sim.stop() }
  }, [])

  /* ─── Update when data changes ─── */
  useEffect(() => {
    const sim = simRef.current
    const lg = linkGRef.current
    const ng = nodeGRef.current
    if (!sim || !lg || !ng) return

    const prevById = new Map(simNodes.current.map(n => [n.id, n]))
    simNodes.current = nodes.map(n => {
      const p = prevById.get(n.id)
      return p ? Object.assign(p, n) : { ...n }
    })
    simLinks.current = links.map(l => ({ ...l }))

    /* links */
    const linkSel = d3.select(lg).selectAll<SVGLineElement, GraphLink>('line').data(simLinks.current, linkKey)
    linkSel.exit().remove()
    linkSel.enter().append('line').merge(linkSel)
      .attr('stroke', d => d.conflict ? '#ff2d55' : '#2a2a45')
      .attr('stroke-width', d => d.conflict ? 2 : 1)
      .attr('stroke-dasharray', d => d.conflict ? '6 4' : 'none')
      .attr('opacity', d => d.conflict ? 0.85 : 0.35)
      .classed('conflict-link', d => d.conflict)

    /* nodes */
    const nodeSel = d3.select(ng).selectAll<SVGGElement, GraphNode>('g.cb-node').data(simNodes.current, d => d.id)
    nodeSel.exit().transition().duration(300).attr('opacity', 0).remove()

    const enter = nodeSel.enter().append('g')
      .attr('class', 'cb-node').attr('opacity', 0).style('cursor', 'pointer')
      .call(d3.drag<SVGGElement, GraphNode>()
        .on('start', (e, d) => { if (!e.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y })
        .on('drag',  (e, d) => { d.fx = e.x; d.fy = e.y })
        .on('end',   (e, d) => { if (!e.active) sim.alphaTarget(0); d.fx = null; d.fy = null })
      )

    enter.transition().duration(400).attr('opacity', 1)
    enter.append('circle').attr('class', 'halo').attr('fill', 'none').attr('stroke-width', 1.5).attr('opacity', 0.25)
    enter.append('circle').attr('class', 'body')
    enter.append('text').attr('class', 'kind-txt')
      .attr('text-anchor', 'middle').attr('dominant-baseline', 'middle')
      .attr('font-family', 'Fira Code, monospace').attr('font-weight', '500')
      .attr('fill', '#070711').attr('pointer-events', 'none')
    enter.append('text').attr('class', 'name-txt')
      .attr('text-anchor', 'middle').attr('fill', '#c8c8e8')
      .attr('font-family', 'DM Sans, sans-serif').attr('font-size', 11)
      .attr('stroke', '#070711').attr('stroke-width', 3).attr('paint-order', 'stroke')
      .attr('pointer-events', 'none')

    enter
      .on('mouseenter', (e, d) => setTooltip({ x: (e as MouseEvent).offsetX, y: (e as MouseEvent).offsetY, node: d }))
      .on('mousemove',  e => setTooltip(p => p ? { ...p, x: (e as MouseEvent).offsetX, y: (e as MouseEvent).offsetY } : null))
      .on('mouseleave', () => setTooltip(null))

    const all = enter.merge(nodeSel as d3.Selection<SVGGElement, GraphNode, SVGGElement, unknown>)
    all.select<SVGCircleElement>('.halo').attr('r', d => nodeR(d) + 6).attr('stroke', d => nodeColor(d)).attr('filter', d => nodeFilter(d))
    all.select<SVGCircleElement>('.body').attr('r', d => nodeR(d)).attr('fill', d => nodeColor(d)).attr('filter', d => nodeFilter(d))
    all.select<SVGTextElement>('.kind-txt').attr('font-size', d => Math.max(8, nodeR(d) * 0.6)).text(d => KIND_LABEL[d.kind] ?? '?')
    all.select<SVGTextElement>('.name-txt').attr('dy', d => nodeR(d) + 14).text(d => d.name.length > 18 ? d.name.slice(0, 16) + '…' : d.name)

    sim.nodes(simNodes.current)
    ;(sim.force('link') as d3.ForceLink<GraphNode, GraphLink>).links(simLinks.current)
    sim.alpha(0.4).restart()
  }, [nodes, links])

  return (
    <div className="relative flex-1 overflow-hidden bg-base">
      {nodes.length === 0 && <EmptyState />}
      <svg ref={svgRef} className="w-full h-full" />
      {tooltip && <NodeTooltip {...tooltip} />}
    </div>
  )
}

function EmptyState() {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 pointer-events-none">
      <svg width="60" height="60" viewBox="0 0 60 60" className="opacity-[0.07]">
        <circle cx="30" cy="30" r="28" stroke="#c8c8e8" strokeWidth="1.5" fill="none" />
        <circle cx="30" cy="30" r="14" stroke="#c8c8e8" strokeWidth="1" fill="none" />
        <circle cx="30" cy="30" r="3" fill="#c8c8e8" />
        <line x1="30" y1="2" x2="30" y2="16" stroke="#c8c8e8" strokeWidth="1.5" />
        <line x1="30" y1="44" x2="30" y2="58" stroke="#c8c8e8" strokeWidth="1.5" />
        <line x1="2" y1="30" x2="16" y2="30" stroke="#c8c8e8" strokeWidth="1.5" />
        <line x1="44" y1="30" x2="58" y2="30" stroke="#c8c8e8" strokeWidth="1.5" />
      </svg>
      <p className="font-display text-[15px] font-medium text-cb-dim">Awaiting signals</p>
      <p className="font-code text-[11px] text-cb-dim">Start client watchers to populate the graph</p>
    </div>
  )
}

function NodeTooltip({ x, y, node }: Tooltip) {
  return (
    <div
      className="absolute z-10 pointer-events-none bg-raised border border-cb-border-bright rounded-lg px-3 py-2 max-w-[280px] animate-fade-slide"
      style={{ left: x + 14, top: y - 10 }}
    >
      <div className="flex items-center gap-1.5 mb-1">
        <span
          className="font-code text-[9px] px-1.5 py-px rounded tracking-wider"
          style={{ background: `${NODE_COLOR[node.severity]}20`, color: NODE_COLOR[node.severity] }}
        >
          {KIND_LABEL[node.kind]}
        </span>
        <span className="font-code text-[12px] text-cb-text font-medium">{node.name}</span>
      </div>
      <p className="font-code text-[10px] text-cb-muted break-all leading-relaxed">{node.signature || '—'}</p>
      <div className="flex gap-2.5 mt-1.5">
        <span className="font-code text-[9px] text-cb-dim">by {node.devId}</span>
        {node.locked && <span className="font-code text-[9px] text-cb-amber">LOCKED</span>}
      </div>
    </div>
  )
}
