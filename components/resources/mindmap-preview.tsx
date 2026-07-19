'use client'

import { useMemo } from 'react'
import { layoutMindmap, parseMindmap } from './mindmap-layout'

type MindmapPreviewProps = {
  content: string
  title: string
  expanded?: boolean
  fullscreen?: boolean
}

export function MindmapPreview({ content, title, expanded = false, fullscreen = false }: MindmapPreviewProps) {
  const layout = useMemo(
    () => layoutMindmap(parseMindmap(content, title || '知识导图')),
    [content, title],
  )

  return (
    <div
      className="w-full overflow-auto rounded-xl border border-cyan-300/10 bg-[radial-gradient(circle_at_15%_15%,rgba(34,211,238,0.08),transparent_38%),rgba(2,8,16,0.56)] p-3"
      data-testid="mindmap-preview"
      data-node-count={layout.nodes.length}
    >
      <svg
        aria-label={`${title}思维导图`}
        className={`block w-full ${fullscreen ? 'min-h-[72vh]' : expanded ? 'min-h-[62vh]' : 'min-h-[360px]'}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        viewBox={`0 0 ${layout.width} ${layout.height}`}
      >
        <g aria-hidden="true">
          {layout.edges.map(({ from, to }) => {
            const startX = from.x + from.width / 2
            const endX = to.x - to.width / 2
            const controlOffset = Math.max(42, (endX - startX) * 0.46)
            return (
              <path
                d={`M ${startX} ${from.y} C ${startX + controlOffset} ${from.y}, ${endX - controlOffset} ${to.y}, ${endX} ${to.y}`}
                fill="none"
                key={`${from.id}-${to.id}`}
                stroke={to.depth === 1 ? '#67e8f9' : '#94a3b8'}
                strokeLinecap="round"
                strokeOpacity={to.depth === 1 ? 0.58 : 0.32}
                strokeWidth={to.depth === 1 ? 2.5 : 1.7}
              />
            )
          })}
        </g>

        {layout.nodes.map((node) => {
          const root = node.depth === 0
          const branch = node.depth === 1
          const textTop = node.y - ((node.lines.length - 1) * 18) / 2
          return (
            <g key={node.id} transform={`translate(${node.x} ${node.y})`}>
              <rect
                fill={root ? '#0e7490' : branch ? '#123047' : '#101923'}
                fillOpacity={root ? 0.92 : branch ? 0.84 : 0.9}
                height={node.height}
                rx={root ? 22 : 14}
                stroke={root ? '#a5f3fc' : branch ? '#67e8f9' : '#64748b'}
                strokeOpacity={root ? 0.82 : branch ? 0.48 : 0.34}
                strokeWidth={root ? 2.2 : 1.4}
                width={node.width}
                x={-node.width / 2}
                y={-node.height / 2}
              />
              <circle
                cx={-node.width / 2}
                cy="0"
                fill={root ? '#cffafe' : '#67e8f9'}
                opacity={root ? 0.95 : 0.62}
                r={root ? 5 : 3.5}
              />
              <text
                fill={root ? '#ecfeff' : '#e2e8f0'}
                fontFamily="Inter, 'PingFang SC', 'Microsoft YaHei', sans-serif"
                fontSize={root ? 16 : 14}
                fontWeight={root ? 700 : branch ? 650 : 500}
                textAnchor="middle"
              >
                {node.lines.map((line, index) => (
                  <tspan key={`${node.id}-${index}`} x="0" y={textTop - node.y + index * 18 + 5}>
                    {line}
                  </tspan>
                ))}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
