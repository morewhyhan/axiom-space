'use client'

import { useEffect, useState, type ChangeEvent, type ReactNode } from 'react'
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

  const [autoRotate, setAutoRotate] = useState(true)
  const [bloom, setBloom] = useState(0.8)
  const [internalEdges, setInternalEdges] = useState(false)
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
      if (ar !== undefined) setAutoRotate(ar)
      if (bl !== undefined) setBloom(bl)
      if (ha !== undefined) setHoverAttention(ha)
      if (lm !== undefined) setLayoutMode(lm)
      if (ar !== undefined || bl !== undefined || ha !== undefined || lm !== undefined) return
      attempts += 1
      if (attempts < maxAttempts) timerId = setTimeout(poll, 200)
    }
    poll()
    return () => {
      if (timerId) clearTimeout(timerId)
    }
  }, [setHoverAttention, setLayoutMode])

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

  const toggleInternalEdges = () => {
    const value = !internalEdges
    if (callCanvas('__setInternalEdgesVisible', [value])) setInternalEdges(value)
  }

  const toggleExternalEdges = () => {
    const value = !externalEdges
    if (callCanvas('__setExternalEdgesVisible', [value])) setExternalEdges(value)
  }

  const handleBloom = (event: ChangeEvent<HTMLInputElement>) => {
    const value = Number(event.target.value)
    if (callCanvas('__setBloom', [value])) setBloom(value)
  }

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
      <HudCard>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="mono text-cyan-200/65 uppercase tracking-[0.2em]" style={{ fontSize: 'var(--f8)' }}>GRAPH HUD</div>
            <div className="mt-1 text-white/72" style={{ fontSize: 'var(--f9)' }}>知识图谱</div>
          </div>
          <div className="grid grid-cols-2 gap-2 text-right">
            <TinyStat label="节点" value={nodes.length} />
            <TinyStat label="连接" value={edges.length} />
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <MiniAction icon={<Search className="h-3.5 w-3.5" />} label="搜索" onClick={() => openModal('search')} />
          <MiniAction icon={<ArrowDownToLine className="h-3.5 w-3.5" />} label="导入" onClick={() => openModal('importtext')} />
        </div>
      </HudCard>

      <HudCard>
        <HudTitle icon={<Eye className="h-3.5 w-3.5" />} label="节点筛选" meta={`${nodes.length}`} />
        <div className="mt-3 space-y-1.5">
          <FilterRow color="bg-purple-400" label="永久知识" active={filterPerm} onClick={() => toggleType('permanent', filterPerm, setFilterPerm)} />
          <FilterRow color="bg-cyan-400" label="灵感草稿" active={filterFleet} onClick={() => toggleType('fleeting', filterFleet, setFilterFleet)} />
          <FilterRow color="bg-pink-400" label="文献证据" active={filterLit} onClick={() => toggleType('literature', filterLit, setFilterLit)} />
        </div>
      </HudCard>

      <HudCard>
        <HudTitle icon={<Focus className="h-3.5 w-3.5" />} label="视角" />
        <div className="mt-3 grid grid-cols-2 gap-2">
          <MiniAction icon={<RotateCw className="h-3.5 w-3.5" />} label="重置" onClick={resetView} />
          <MiniAction icon={<Maximize2 className="h-3.5 w-3.5" />} label="适配" onClick={fitSelection} />
        </div>
      </HudCard>

      <HudCard>
        <HudTitle icon={<SlidersHorizontal className="h-3.5 w-3.5" />} label="显示" />
        <div className="mt-3 space-y-3">
          <SwitchRow label="自动旋转" active={autoRotate} onClick={toggleAutoRotate} />
          <SwitchRow label="悬停聚焦" active={hoverAttention} onClick={toggleHoverAttention} />
          <SwitchRow label="内部连线" active={internalEdges} onClick={toggleInternalEdges} />
          <SwitchRow label="跨域连线" active={externalEdges} onClick={toggleExternalEdges} />
          <div>
            <div className="mb-1.5 flex justify-between mono" style={{ fontSize: 'var(--f9)' }}>
              <span className="text-white/34">光晕</span>
              <span className="text-white/45">{bloom.toFixed(1)}</span>
            </div>
            <input type="range" min="0" max="1.6" step="0.1" value={bloom} onChange={handleBloom} className="orbit-slider cursor-pointer" />
          </div>
        </div>
      </HudCard>
    </aside>
  )
}

function HudCard({ children }: { children: ReactNode }) {
  return (
    <section className="glass-panel rounded-2xl border-white/10 bg-black/[0.42] px-4 py-3 shadow-[0_18px_58px_rgba(0,0,0,0.24)]">
      {children}
    </section>
  )
}

function HudTitle({ icon, label, meta }: { icon: ReactNode; label: string; meta?: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 text-white/55">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/8 bg-white/[0.025] text-cyan-200/70">
          {icon}
        </span>
        <span className="mono uppercase tracking-[0.14em]" style={{ fontSize: 'var(--f8)' }}>{label}</span>
      </div>
      {meta ? <span className="mono text-white/20" style={{ fontSize: 'var(--f9)' }}>{meta}</span> : null}
    </div>
  )
}

function TinyStat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="mono text-white/22" style={{ fontSize: 'var(--f10)' }}>{label}</div>
      <div className="mono text-white/70 leading-none" style={{ fontSize: 'var(--f8)' }}>{value}</div>
    </div>
  )
}

function MiniAction({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      className="flex h-9 items-center justify-center gap-2 rounded-xl border border-white/8 bg-white/[0.025] text-white/48 transition-colors hover:border-cyan-200/18 hover:bg-cyan-200/[0.055] hover:text-cyan-100/[0.82]"
      onClick={onClick}
    >
      {icon}
      <span style={{ fontSize: 'var(--f9)' }}>{label}</span>
    </button>
  )
}

function FilterRow({ color, label, active, onClick }: { color: string; label: string; active: boolean; onClick: () => void }) {
  return (
    <button className="flex w-full items-center justify-between gap-3 rounded-lg px-1.5 py-1.5 text-left transition-colors hover:bg-white/[0.025]" onClick={onClick}>
      <span className="flex min-w-0 items-center gap-2.5">
        <span className={`h-2 w-2 rounded-full ${color} shadow-[0_0_8px_rgba(255,255,255,0.18)]`} />
        <span className="truncate text-white/[0.58]" style={{ fontSize: 'var(--f9)' }}>{label}</span>
      </span>
      <span className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-cyan-300' : 'bg-white/12'}`} />
    </button>
  )
}

function SwitchRow({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button className="flex w-full items-center justify-between group" onClick={onClick}>
      <span className="text-white/50 group-hover:text-white/72" style={{ fontSize: 'var(--f9)' }}>{label}</span>
      <span className={`orbit-toggle ${active ? 'orbit-toggle-on' : ''}`}>
        <span className={`orbit-toggle-dot ${active ? 'orbit-toggle-dot-on' : ''}`} />
      </span>
    </button>
  )
}
