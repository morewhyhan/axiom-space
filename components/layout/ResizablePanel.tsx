'use client'

/**
 * ResizablePanel — wraps any panel with a drag handle for resizing
 * and a draggable header for repositioning between zones.
 */

import { useRef, useCallback, useState, type ReactNode } from 'react'
import { useAppStore, type PanelId, type PanelZone } from '@/stores/mode-store'

interface Props {
  id: PanelId
  children: ReactNode
  zone: PanelZone
  minWidth?: number
  maxWidth?: number
  onMovePanel?: (panel: PanelId, toZone: PanelZone) => void
}

export default function ResizablePanel({ id, children, zone, minWidth = 200, maxWidth = 800 }: Props) {
  const panelSizes = useAppStore((s) => s.panelSizes)
  const setPanelSize = useAppStore((s) => s.setPanelSize)
  const movePanel = useAppStore((s) => s.movePanel)
  const panelLayout = useAppStore((s) => s.panelLayout)
  const [dragging, setDragging] = useState(false)
  const startRef = useRef({ x: 0, startSize: 0 })
  const dragRef = useRef<HTMLDivElement>(null)

  const width = panelSizes[id] ?? 340

  // ── Resize handler ──
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    startRef.current = { x: e.clientX, startSize: width }
    setDragging(true)

    const onMove = (ev: MouseEvent) => {
      const delta = zone === 'left' ? ev.clientX - startRef.current.x : -(ev.clientX - startRef.current.x)
      const newSize = startRef.current.startSize + delta
      setPanelSize(id, Math.max(minWidth, Math.min(maxWidth, newSize)))
    }
    const onUp = () => { setDragging(false); document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [id, width, zone, minWidth, maxWidth, setPanelSize])

  // ── Drag to rezone ──
  const handleDragStart = useCallback((e: React.DragEvent) => {
    e.dataTransfer.setData('text/plain', JSON.stringify({ panelId: id, fromZone: zone }))
    e.dataTransfer.effectAllowed = 'move'
  }, [id, zone])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    try {
      const data = JSON.parse(e.dataTransfer.getData('text/plain'))
      if (data.panelId && data.panelId !== id) {
        // Another panel dropped on this panel's zone — move it here
        movePanel(data.panelId, zone, panelLayout[zone].indexOf(id) + (data.fromZone === zone ? 0 : 0))
      }
    } catch {}
  }, [id, zone, movePanel, panelLayout])

  // ── Move between zones ──
  const otherZone: PanelZone = zone === 'left' ? 'right' : 'left'
  const zoneName = zone === 'left' ? '左侧' : '右侧'

  const panelNames: Record<PanelId, string> = {
    fileTree: '资料',
    sessionList: '历史',
    editor: '编辑',
  }

  return (
    <div
      className={`resizable-panel resizable-panel-${zone} resizable-panel-${id} relative flex flex-col self-stretch ${dragging ? 'select-none' : ''}`}
      style={{ width, minWidth, maxWidth, flexShrink: 0 }}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {children}

      {/* Resize handle — right edge for left panels, left edge for right panels */}
      <div
        ref={dragRef}
        className={`absolute top-0 bottom-0 ${zone === 'left' ? '-right-1' : '-left-1'} w-2 cursor-col-resize z-20 group`}
        onMouseDown={handleMouseDown}
      >
        <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-0.5 bg-white/0 group-hover:bg-white/20 group-active:bg-purple-400/50 transition-colors" />
      </div>

      {/* Move zone handle — top-right corner */}
      {/* <div
        draggable
        onDragStart={handleDragStart}
        className="absolute top-0 right-0 w-6 h-6 flex items-center justify-center cursor-grab active:cursor-grabbing z-20 opacity-0 group-hover:opacity-100 transition-opacity"
        title={`拖拽到${otherZone === 'left' ? '左' : '右'}侧`}
      >
        <span className="mono text-white/30 hover:text-white/60 text-[9px]">⠿</span>
      </div> */}
    </div>
  )
}
