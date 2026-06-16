'use client'

import { useEffect, useState, type ChangeEvent } from 'react'
import { toast } from 'sonner'
import { useGalaxyData, useCreateCluster, useUpdateCluster, useDeleteCluster } from '@/hooks/use-galaxy'
import { useAppStore, useGalaxyActions, type GraphLayoutMode } from '@/stores/mode-store'

const LAYOUTS: Array<{ mode: GraphLayoutMode; label: string; code: string }> = [
  { mode: 'galaxy', label: '星系总览', code: 'MAP' },
  { mode: 'flat', label: '关系平面', code: 'NET' },
  { mode: 'concentric', label: '邻域展开', code: 'HOP' },
  { mode: 'evidence', label: '证据支撑', code: 'RAG' },
]

type CanvasAction = (...args: unknown[]) => unknown

function callCanvas(name: string, args: unknown[] = []): boolean {
  const storeName = name.replace(/^__/, '')
  const actions = useGalaxyActions.getState().actions as Record<string, CanvasAction | undefined>
  const fn = actions[storeName]
  if (typeof fn !== 'function') {
    toast.error('Galaxy 画布尚未就绪，请稍后再试')
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
  const createCluster = useCreateCluster()
  const updateCluster = useUpdateCluster()
  const deleteCluster = useDeleteCluster()
  const openModal = useAppStore((s) => s.openModal)
  const layoutMode = useAppStore((s) => s.graphLayoutMode)
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
  const [newClusterName, setNewClusterName] = useState('')
  const [editingClusterId, setEditingClusterId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')

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
    return () => { if (timerId) clearTimeout(timerId) }
  }, [setHoverAttention, setLayoutMode])

  const setCanvasLayout = (mode: GraphLayoutMode) => {
    setLayoutMode(mode)
    callCanvas('__setLayoutMode', [mode])
  }

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

  const handleCreateCluster = async () => {
    const name = newClusterName.trim()
    if (!name) return
    try {
      await createCluster.mutateAsync({ name })
      setNewClusterName('')
      toast.success(`星团「${name}」已创建`)
    } catch {
      toast.error('创建星团失败')
    }
  }

  const handleRenameCluster = async (id: string) => {
    const name = editingName.trim()
    if (!name) return
    try {
      await updateCluster.mutateAsync({ id, name })
      setEditingClusterId(null)
      setEditingName('')
    } catch {
      toast.error('重命名失败')
    }
  }

  const handleDeleteCluster = async (id: string, name: string) => {
    if (!confirm(`确定删除星团「${name}」？星团内的卡片将变为游离节点。`)) return
    try {
      await deleteCluster.mutateAsync(id)
      toast.success(`星团「${name}」已删除`)
    } catch {
      toast.error('删除星团失败')
    }
  }

  const clusters = galaxyData?.clusters ?? []
  const nodes = galaxyData?.nodes ?? []
  const edges = galaxyData?.edges ?? []
  const orphanCount = nodes.filter((node) => !node.clusterId).length

  return (
    <aside
      className="side-slot visible galaxy-panel flex-col pointer-events-auto no-scrollbar"
      style={{ width: '340px', justifyContent: 'space-between', gap: '12px', padding: 'var(--panel-py) 0', overflow: 'hidden' }}
    >
      <section className="glass-panel rounded-2xl px-4 py-4">
        <div className="mono text-cyan-300/75 uppercase tracking-[0.22em]" style={{ fontSize: 'var(--f8)' }}>GALAXY_VIEW</div>
        <div className="mt-1 text-white/28" style={{ fontSize: 'var(--f8)' }}>知识星团 · 关系总览 · 学习路径</div>
      </section>

      <section className="glass-panel rounded-2xl px-4 py-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="mono text-white/34 uppercase" style={{ fontSize: 'var(--f7)' }}>VIEW_MODE</span>
          <span className="mono text-white/18" style={{ fontSize: 'var(--f8)' }}>{nodes.length} nodes</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {LAYOUTS.map((item) => {
            const active = item.mode === layoutMode
            return (
              <button
                key={item.mode}
                className={[
                  'rounded-lg border px-3 py-2 text-left transition-colors',
                  active
                    ? 'border-cyan-300/35 bg-cyan-300/[0.075] text-cyan-100'
                    : 'border-white/8 bg-white/[0.018] text-white/42 hover:border-white/14 hover:bg-white/[0.035] hover:text-white/68',
                ].join(' ')}
                onClick={() => setCanvasLayout(item.mode)}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="mono" style={{ fontSize: 'var(--f9)' }}>{item.label}</span>
                  <span className="mono text-white/20" style={{ fontSize: 'var(--f10)' }}>{item.code}</span>
                </div>
              </button>
            )
          })}
        </div>
      </section>

      <section className="glass-panel rounded-2xl px-4 py-4">
        <span className="mono text-white/34 uppercase block mb-3" style={{ fontSize: 'var(--f7)' }}>NAVIGATION</span>
        <div className="grid grid-cols-2 gap-2">
          <button className="axiom-btn secondary border-white/10 bg-white/[0.025]" style={{ fontSize: 'var(--f9)' }} onClick={resetView}>重置视角</button>
          <button className="axiom-btn secondary border-white/10 bg-white/[0.025]" style={{ fontSize: 'var(--f9)' }} onClick={fitSelection}>适配关系</button>
          <button className="axiom-btn secondary border-white/10 bg-white/[0.025]" style={{ fontSize: 'var(--f9)' }} onClick={() => openModal('search')}>搜索节点</button>
          <button className="axiom-btn secondary border-white/10 bg-white/[0.025]" style={{ fontSize: 'var(--f9)' }} onClick={() => openModal('importtext')}>导入资料</button>
        </div>
      </section>

      <section className="glass-panel rounded-2xl px-4 py-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="mono text-white/34 uppercase" style={{ fontSize: 'var(--f7)' }}>FILTER</span>
          <span className="mono text-white/18" style={{ fontSize: 'var(--f8)' }}>{edges.length} links</span>
        </div>
        <div className="space-y-2.5">
          <FilterRow color="bg-purple-400" label="PERM — 永久知识" active={filterPerm} onClick={() => toggleType('permanent', filterPerm, setFilterPerm)} />
          <FilterRow color="bg-cyan-400" label="FLEE — 灵感草稿" active={filterFleet} onClick={() => toggleType('fleeting', filterFleet, setFilterFleet)} />
          <FilterRow color="bg-pink-400" label="LIT — 文献证据" active={filterLit} onClick={() => toggleType('literature', filterLit, setFilterLit)} />
        </div>
      </section>

      <section className="glass-panel min-h-0 flex-1 overflow-y-auto no-scrollbar rounded-2xl px-4 py-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="mono text-white/34 uppercase" style={{ fontSize: 'var(--f7)' }}>CLUSTERS</span>
          <span className="mono text-white/18" style={{ fontSize: 'var(--f8)' }}>{clusters.length} groups · {orphanCount} orphan</span>
        </div>
        <div className="mb-3 flex items-center gap-2">
          <input
            className="flex-1 rounded-lg border border-white/8 bg-white/[0.025] px-3 py-2 mono text-white/72 outline-none transition-colors placeholder:text-white/16 focus:border-cyan-300/28"
            style={{ fontSize: 'var(--f9)' }}
            placeholder="新建星团..."
            value={newClusterName}
            onChange={(event) => setNewClusterName(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') handleCreateCluster() }}
          />
          <button
            className="rounded-lg border border-cyan-300/20 bg-cyan-300/[0.06] px-3 py-2 mono text-cyan-100/70 hover:bg-cyan-300/[0.1] disabled:opacity-20"
            style={{ fontSize: 'var(--f9)' }}
            disabled={!newClusterName.trim() || createCluster.isPending}
            onClick={handleCreateCluster}
          >创建</button>
        </div>
        <div className="space-y-1.5">
          {clusters.length === 0 && <div className="mono text-white/22" style={{ fontSize: 'var(--f9)' }}>暂无星团，导入或沉淀卡片后自动生成。</div>}
          {clusters.map((cluster) => (
            <div key={cluster.id} className="group rounded-lg border border-white/6 bg-white/[0.016] px-3 py-2 hover:bg-white/[0.032]">
              {editingClusterId === cluster.id ? (
                <input
                  className="w-full rounded border border-cyan-300/30 bg-black/30 px-2 py-1 mono text-white outline-none"
                  style={{ fontSize: 'var(--f9)' }}
                  value={editingName}
                  onChange={(event) => setEditingName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') handleRenameCluster(cluster.id)
                    if (event.key === 'Escape') setEditingClusterId(null)
                  }}
                  autoFocus
                />
              ) : (
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-white/68" style={{ fontSize: 'var(--f9)' }}>{cluster.name}</div>
                    <div className="mono text-white/18" style={{ fontSize: 'var(--f10)' }}>CONSTELLATION</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <button className="mono text-white/28 hover:text-cyan-200" style={{ fontSize: 'var(--f10)' }} onClick={() => { setEditingClusterId(cluster.id); setEditingName(cluster.name) }}>改名</button>
                    <button className="mono text-white/24 hover:text-pink-200" style={{ fontSize: 'var(--f10)' }} onClick={() => handleDeleteCluster(cluster.id, cluster.name)}>删除</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      <details className="glass-panel rounded-2xl px-4 py-3">
        <summary className="cursor-pointer mono text-white/30 uppercase" style={{ fontSize: 'var(--f8)' }}>ADVANCED_RENDER</summary>
        <div className="mt-3 space-y-3">
          <SwitchRow label="自动旋转" active={autoRotate} onClick={toggleAutoRotate} />
          <SwitchRow label="悬停聚焦" active={hoverAttention} onClick={toggleHoverAttention} />
          <SwitchRow label="内部连线" active={internalEdges} onClick={toggleInternalEdges} />
          <SwitchRow label="外部连线" active={externalEdges} onClick={toggleExternalEdges} />
          <div>
            <div className="mb-1.5 flex justify-between mono" style={{ fontSize: 'var(--f9)' }}>
              <span className="text-white/30">BLOOM</span>
              <span className="text-white/45">{bloom.toFixed(1)}</span>
            </div>
            <input type="range" min="0" max="1.6" step="0.1" value={bloom} onChange={handleBloom} className="orbit-slider cursor-pointer" />
          </div>
        </div>
      </details>
    </aside>
  )
}

function FilterRow({ color, label, active, onClick }: { color: string; label: string; active: boolean; onClick: () => void }) {
  return (
    <button className="flex w-full items-center justify-between gap-3 rounded-lg px-1 py-1.5 text-left hover:bg-white/[0.025]" onClick={onClick}>
      <span className="flex min-w-0 items-center gap-2.5">
        <span className={`h-2 w-2 rounded-full ${color} shadow-[0_0_8px_rgba(255,255,255,0.18)]`} />
        <span className="mono truncate text-white/52" style={{ fontSize: 'var(--f9)' }}>{label}</span>
      </span>
      <span className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-cyan-300' : 'bg-white/12'}`} />
    </button>
  )
}

function SwitchRow({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button className="flex w-full items-center justify-between group" onClick={onClick}>
      <span className="mono text-white/44 group-hover:text-white/68" style={{ fontSize: 'var(--f9)' }}>{label}</span>
      <span className={`orbit-toggle ${active ? 'orbit-toggle-on' : ''}`}>
        <span className={`orbit-toggle-dot ${active ? 'orbit-toggle-dot-on' : ''}`} />
      </span>
    </button>
  )
}
