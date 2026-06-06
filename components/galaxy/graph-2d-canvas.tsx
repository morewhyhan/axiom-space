'use client'

import { useEffect, useMemo, useRef } from 'react'
import cytoscape, { type Core, type EdgeSingular, type NodeSingular } from 'cytoscape'
import fcose from 'cytoscape-fcose'
import type { GalaxyCluster, GalaxyEdge, GalaxyNode } from '@/types/galaxy'
import { useAppStore } from '@/stores/mode-store'

interface Graph2DCanvasProps {
  nodes: GalaxyNode[]
  edges: GalaxyEdge[]
  clusters: GalaxyCluster[]
  visible: boolean
}

type GraphElement =
  | {
      group: 'nodes'
      data: {
        id: string
        label: string
        type: string
        color: string
        size: number
        clusterName: string
      }
    }
  | {
      group: 'edges'
      data: {
        id: string
        source: string
        target: string
        weight: number
      }
    }

const TYPE_COLORS: Record<string, string> = {
  fleeting: '#f59e0b',
  literature: '#22d3ee',
  permanent: '#a78bfa',
}

let fcoseRegistered = false

function ensureFcoseRegistered() {
  if (fcoseRegistered) return
  cytoscape.use(fcose)
  fcoseRegistered = true
}

export default function Graph2DCanvas({ nodes, edges, clusters, visible }: Graph2DCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const cyRef = useRef<Core | null>(null)
  const selectedIdRef = useRef<string | null>(null)
  const setSelectedNode = useAppStore((s) => s.setSelectedNode)
  const hoverAttention = useAppStore((s) => s.graphHoverAttention)

  const clusterMap = useMemo(() => new Map(clusters.map((cluster) => [cluster.id, cluster])), [clusters])

  const elements = useMemo<GraphElement[]>(() => {
    const nodeIds = new Set(nodes.map((node) => node.id))
    const graphNodes: GraphElement[] = nodes.map((node) => {
      const cluster = node.clusterId ? clusterMap.get(node.clusterId) : null
      const color = node.clusterColor || cluster?.color || TYPE_COLORS[node.type] || '#94a3b8'
      const degree = edges.reduce((count, edge) => (
        edge.sourceId === node.id || edge.targetId === node.id ? count + 1 : count
      ), 0)
      return {
        group: 'nodes',
        data: {
          id: node.id,
          label: node.title || '未命名卡片',
          type: node.type,
          color,
          size: Math.min(19, 7 + Math.sqrt(degree + 1) * 2.6),
          clusterName: cluster?.name || node.clusterName || '',
        },
      }
    })

    const graphEdges: GraphElement[] = edges
      .filter((edge) => nodeIds.has(edge.sourceId) && nodeIds.has(edge.targetId))
      .map((edge) => ({
        group: 'edges',
        data: {
          id: edge.id,
          source: edge.sourceId,
          target: edge.targetId,
          weight: edge.weight || 1,
        },
      }))

    return [...graphNodes, ...graphEdges]
  }, [clusterMap, edges, nodes])

  useEffect(() => {
    if (!visible) return
    const container = containerRef.current
    if (!container) return

    ensureFcoseRegistered()

    const cy = cytoscape({
      container,
      elements,
      minZoom: 0.12,
      maxZoom: 4.5,
      wheelSensitivity: 0.18,
      textureOnViewport: true,
      hideEdgesOnViewport: elements.length > 900,
      style: [
        {
          selector: 'core',
          style: {
            'active-bg-opacity': 0,
            'selection-box-color': '#8b5cf6',
            'selection-box-opacity': 0.12,
            'selection-box-border-color': '#c4b5fd',
          },
        },
        {
          selector: 'node',
          style: {
            width: 'data(size)',
            height: 'data(size)',
            'background-color': 'data(color)',
            'border-width': 1,
            'border-color': 'rgba(255,255,255,0.26)',
            'shadow-blur': 14,
            'shadow-color': 'data(color)',
            'shadow-opacity': 0.55,
            'shadow-offset-x': 0,
            'shadow-offset-y': 0,
            label: 'data(label)',
            color: '#dce7f5',
            'font-family': 'ui-sans-serif, system-ui, sans-serif',
            'font-size': 10,
            'font-weight': 500,
            'text-opacity': 0.5,
            'text-margin-y': 9,
            'text-wrap': 'ellipsis',
            'text-max-width': 132,
            'min-zoomed-font-size': 8,
            'overlay-opacity': 0,
          },
        },
        {
          selector: 'node[type = "permanent"]',
          style: {
            width: 'mapData(size, 7, 19, 10, 24)',
            height: 'mapData(size, 7, 19, 10, 24)',
          },
        },
        {
          selector: 'edge',
          style: {
            width: 'mapData(weight, 0, 2, 0.7, 1.8)',
            'line-color': '#8fa7c7',
            opacity: 0.24,
            'curve-style': 'haystack',
            'haystack-radius': 0.18,
            'overlay-opacity': 0,
          },
        },
        {
          selector: '.focus',
          style: {
            width: 'mapData(size, 7, 19, 17, 34)',
            height: 'mapData(size, 7, 19, 17, 34)',
            'border-width': 2,
            'border-color': '#ffffff',
            'shadow-blur': 28,
            'shadow-opacity': 0.95,
            'text-opacity': 0.95,
            'font-size': 12,
            'z-index': 30,
          },
        },
        {
          selector: '.neighbor',
          style: {
            opacity: 0.92,
            'text-opacity': 0.72,
            'z-index': 20,
          },
        },
        {
          selector: 'edge.neighbor',
          style: {
            width: 2.2,
            opacity: 0.72,
            'line-color': '#dbeafe',
            'z-index': 10,
          },
        },
        {
          selector: '.dimmed',
          style: {
            opacity: 0.14,
            'text-opacity': 0,
          },
        },
        {
          selector: 'edge.dimmed',
          style: {
            opacity: 0.025,
          },
        },
        {
          selector: ':selected',
          style: {
            'border-width': 2,
            'border-color': '#ffffff',
          },
        },
      ] as any,
    })

    cyRef.current = cy

    const layout = cy.layout({
      name: 'fcose',
      quality: elements.length > 700 ? 'draft' : 'default',
      randomize: false,
      animate: true,
      animationDuration: 650,
      fit: true,
      padding: 105,
      nodeSeparation: elements.length > 700 ? 55 : 78,
      idealEdgeLength: (edge: EdgeSingular) => 84 + Math.max(0, 1.6 - Number(edge.data('weight') || 1)) * 24,
      nodeRepulsion: (node: NodeSingular) => Number(node.data('size') || 10) * 8200,
      gravity: 0.18,
      gravityRange: 2.8,
      nestingFactor: 0.1,
      numIter: elements.length > 700 ? 950 : 1800,
      tile: true,
      packComponents: true,
    } as cytoscape.LayoutOptions)

    layout.run()

    cy.ready(() => {
      cy.fit(undefined, 110)
      cy.center()
    })

    const clearFocus = () => {
      cy.elements().removeClass('focus neighbor dimmed')
    }

    const applyFocus = (node: NodeSingular) => {
      clearFocus()
      const neighborhood = node.closedNeighborhood()
      cy.elements().not(neighborhood).addClass('dimmed')
      neighborhood.addClass('neighbor')
      node.removeClass('neighbor dimmed').addClass('focus')
      selectedIdRef.current = node.id()
    }

    const selectNode = (node: NodeSingular) => {
      applyFocus(node)
      setSelectedNode({
        id: node.id(),
        title: node.data('label') || '未命名卡片',
        type: node.data('type') || 'card',
      })
      cy.animate({
        center: { eles: node },
        zoom: Math.max(cy.zoom(), 1.15),
        duration: 260,
      })
    }

    cy.on('mouseover', 'node', (event) => {
      if (!hoverAttention) return
      applyFocus(event.target as NodeSingular)
    })

    cy.on('mouseout', 'node', () => {
      if (!hoverAttention || selectedIdRef.current) return
      clearFocus()
    })

    cy.on('tap', 'node', (event) => {
      selectNode(event.target as NodeSingular)
    })

    cy.on('tap', (event) => {
      if (event.target !== cy) return
      selectedIdRef.current = null
      setSelectedNode(null)
      clearFocus()
    })

    const resizeObserver = new ResizeObserver(() => {
      cy.resize()
    })
    resizeObserver.observe(container)

    return () => {
      resizeObserver.disconnect()
      cy.destroy()
      if (cyRef.current === cy) cyRef.current = null
      selectedIdRef.current = null
    }
  }, [elements, hoverAttention, setSelectedNode, visible])

  useEffect(() => {
    if (!visible || !cyRef.current) return
    const cy = cyRef.current
    if (hoverAttention) return
    selectedIdRef.current = null
    cy.elements().removeClass('focus neighbor dimmed')
  }, [hoverAttention, visible])

  if (!visible) return null

  return (
    <div className="fixed inset-0 z-[1] bg-[#050507]">
      <div
        aria-label="2D knowledge graph"
        ref={containerRef}
        className="absolute inset-0 cursor-grab active:cursor-grabbing"
      />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(70,94,124,0.12),rgba(5,5,7,0)_54%)]" />
      <div className="pointer-events-none absolute left-6 top-6 max-w-[260px] rounded border border-white/10 bg-black/35 px-3 py-2 text-[10px] uppercase tracking-[0.18em] text-white/35 backdrop-blur-md">
        Obsidian Graph
      </div>
    </div>
  )
}
