'use client'

import { useEffect, useState, type ChangeEvent } from 'react'
import {
  ArrowDownToLine,
  Eye,
  Focus,
  Maximize2,
  RotateCw,
  Search,
  SlidersHorizontal,
} from 'lucide-react'
import { toast } from 'sonner'
import { useGalaxyData } from '@/hooks/use-galaxy'
import { useAppStore, useGalaxyActions, type GraphLayoutMode } from '@/stores/mode-store'
import {
  GalaxyFilterRow,
  GalaxyHudAction,
  GalaxyHudCard,
  GalaxyHudStat,
  GalaxyHudTitle,
  GalaxySwitchRow,
} from './hud'

type CanvasAction = (...args: unknown[]) => unknown

function callCanvas(name: string, args: unknown[] = []): boolean {
  const storeName = name.replace(/^__/, '')
  const actions = useGalaxyActions.getState().actions as Record<string, CanvasAction | undefined>
  const fn = actions[storeName]
  if (typeof fn !== 'function') {
    toast.error('知识图谱画布尚未就绪，请稍后再试')
    return false
  }
  try {
    fn(...args)
    return true
  } catch (err) {
    console.warn(`[GalaxyControls] ${name} failed:`, err)
    toast.error(`操作失败: ${(err as Error)?.message || name}`)
    return false
  }
}

export default function GalaxyControls() {
  const { data: galaxyData } = useGalaxyData()
  const openModal = useAppStore((s) => s.openModal)
  const setLayoutMode = useAppStore((s) => s.setGraphLayoutMode)
  const hoverAttention = useAppStore((s) => s.graphHoverAttention)
  const setHoverAttention = useAppStore((s) => s.setGraphHoverAttention)
  const semanticClusterLens = useAppStore((s) => s.graphSemanticClusterLens)
  const setSemanticClusterLens = useAppStore((s) => s.setGraphSemanticClusterLens)
  const forceMotion = useAppStore((s) => s.graphForceMotion)
  const setForceMotion = useAppStore((s) => s.setGraphForceMotion)

  const [autoRotate, setAutoRotate] = useState(true)
  const [bloom, setBloom] = useState(0.8)
  const [externalEdges, setExternalEdges] = useState(false)
  const [filterPerm, setFilterPerm] = useState(true)
  const [filterFleet, setFilterFleet] = useState(true)
  const [filterLit, setFilterLit] = useState(true)

  useEffect(() => {
    let attempts = 0
    const maxAttempts = 12
    let timerId: ReturnType<typeof setTimeout> | null = null
    const poll = () => {
      const actions = useGalaxyActions.getState().actions
      const ar = actions.getAutoRotate?.() as boolean | undefined
      const bl = actions.getBloom?.() as number | undefined
      const ha = actions.getHoverAttention?.() as boolean | undefined
      const lm = actions.getLayoutMode?.() as GraphLayoutMode | undefined
      const semanticLens = actions.getSemanticClusterLens?.() as boolean | undefined
      const force = actions.getForceMotion?.() as boolean | undefined
      if (ar !== undefined) setAutoRotate(ar)
      if (bl !== undefined) setBloom(bl)
      if (ha !== undefined) setHoverAttention(ha)
      if (lm !== undefined) setLayoutMode(lm)
      if (semanticLens !== undefined) setSemanticClusterLens(semanticLens)
      if (force !== undefined) setForceMotion(force)
      if (ar !== undefined || bl !== undefined || ha !== undefined || lm !== undefined || semanticLens !== undefined || force !== undefined) return
      attempts += 1
      if (attempts < maxAttempts) timerId = setTimeout(poll, 200)
    }
    poll()
    return () => {
      if (timerId) clearTimeout(timerId)
    }
  }, [setForceMotion, setHoverAttention, setLayoutMode, setSemanticClusterLens])

  const resetView = () => callCanvas('__resetCameraView')
  const fitSelection = () => callCanvas('__fitSelection')

  const toggleAutoRotate = () => {
    const value = !autoRotate
    if (callCanvas('__setAutoRotate', [value])) setAutoRotate(value)
  }

  const toggleHoverAttention = () => {
    const value = !hoverAttention
    setHoverAttention(value)
    callCanvas('__setHoverAttention', [value])
  }

  const toggleExternalEdges = () => {
    const value = !externalEdges
    if (callCanvas('__setExternalEdgesVisible', [value])) setExternalEdges(value)
  }

  const handleBloom = (event: ChangeEvent<HTMLInputElement>) => {
    const value = Number(event.target.value)
    if (callCanvas('__setBloom', [value])) setBloom(value)
  }

  const showOrphans = () => callCanvas('__showOrphansOnly')
  const showAllNodes = () => callCanvas('__showAllNodes')

  const toggleType = (type: string, current: boolean, setCurrent: (value: boolean) => void) => {
    const value = !current
    if (callCanvas('__setNodeTypeVisible', [type, value])) setCurrent(value)
  }

  const nodes = galaxyData?.nodes ?? []
  const edges = galaxyData?.edges ?? []

  return (
    <aside
      className="side-slot visible galaxy-panel galaxy-hud flex-col pointer-events-auto no-scrollbar"
      style={{
        width: '292px',
        alignSelf: 'flex-start',
        justifyContent: 'flex-start',
        gap: '10px',
        maxHeight: 'calc(100% - 18px)',
        overflowY: 'auto',
        padding: 'var(--panel-py) 0 0',
      }}
    >
      <GalaxyHudCard>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="mono text-cyan-200/65 uppercase tracking-[0.2em]" style={{ fontSize: 'var(--f8)' }}>GRAPH HUD</div>
            <div className="mt-1 text-white/72" style={{ fontSize: 'var(--f9)' }}>知识图谱</div>
          </div>
          <div className="grid grid-cols-2 gap-2 text-right">
            <GalaxyHudStat label="节点" value={nodes.length} />
            <GalaxyHudStat label="连接" value={edges.length} />
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <GalaxyHudAction icon={<Search className="h-3.5 w-3.5" />} label="搜索" onClick={() => openModal('search')} />
          <GalaxyHudAction icon={<ArrowDownToLine className="h-3.5 w-3.5" />} label="新建" onClick={() => openModal('newcard')} />
        </div>
      </GalaxyHudCard>

      <GalaxyHudCard>
        <GalaxyHudTitle icon={<Eye className="h-3.5 w-3.5" />} label="节点筛选" meta={`${nodes.length}`} />
        <div className="mt-3 space-y-1.5">
          <GalaxyFilterRow color="bg-purple-400" label="永久知识" active={filterPerm} onClick={() => toggleType('permanent', filterPerm, setFilterPerm)} />
          <GalaxyFilterRow color="bg-cyan-400" label="灵感草稿" active={filterFleet} onClick={() => toggleType('fleeting', filterFleet, setFilterFleet)} />
          <GalaxyFilterRow color="bg-pink-400" label="文献证据" active={filterLit} onClick={() => toggleType('literature', filterLit, setFilterLit)} />
        </div>
      </GalaxyHudCard>

      <GalaxyHudCard>
        <GalaxyHudTitle icon={<Focus className="h-3.5 w-3.5" />} label="视角" />
        <div className="mt-3 grid grid-cols-2 gap-2">
          <GalaxyHudAction icon={<RotateCw className="h-3.5 w-3.5" />} label="重置" onClick={resetView} />
          <GalaxyHudAction icon={<Maximize2 className="h-3.5 w-3.5" />} label="适配" onClick={fitSelection} />
          <GalaxyHudAction icon={<Eye className="h-3.5 w-3.5" />} label="孤立" onClick={showOrphans} />
          <GalaxyHudAction icon={<Eye className="h-3.5 w-3.5" />} label="全部" onClick={showAllNodes} />
        </div>
      </GalaxyHudCard>

      <GalaxyHudCard>
        <GalaxyHudTitle icon={<SlidersHorizontal className="h-3.5 w-3.5" />} label="显示" />
        <div className="mt-3 space-y-3">
          <GalaxySwitchRow label="自动旋转" active={autoRotate} onClick={toggleAutoRotate} />
          <GalaxySwitchRow label="悬停聚焦" active={hoverAttention} onClick={toggleHoverAttention} />
          <GalaxySwitchRow label="跨域连线" active={externalEdges} onClick={toggleExternalEdges} />
          <div>
            <div className="mb-1.5 flex justify-between mono" style={{ fontSize: 'var(--f9)' }}>
              <span className="text-white/34">光晕</span>
              <span className="text-white/45">{bloom.toFixed(1)}</span>
            </div>
            <input type="range" min="0" max="1.6" step="0.1" value={bloom} onChange={handleBloom} className="orbit-slider cursor-pointer" />
          </div>
        </div>
      </GalaxyHudCard>
    </aside>
  )
}
