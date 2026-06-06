'use client'

import { useState, useEffect } from 'react'
import { useGalaxyData, useCreateCluster, useUpdateCluster, useDeleteCluster, useAssignCardCluster } from '@/hooks/use-galaxy'
import { useAppStore, useGalaxyActions } from '@/stores/mode-store'
import { toast } from 'sonner'

/** Call a Three.js canvas bridge function; warn the user if the canvas hasn't mounted yet. */
function callCanvas<T extends (...args: any[]) => any>(name: string, args: Parameters<T>): boolean {
  const storeName = name.replace(/^__/, '')
  const fn = useGalaxyActions.getState().actions[storeName] as T | undefined
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
  const assignCard = useAssignCardCluster()

  const [autoRotate, setAutoRotate] = useState(true)
  const [rotateSpeed, setRotateSpeed] = useState(0.2)
  const [bloom, setBloom] = useState(1.4)
  const [cometSpeed, setCometSpeed] = useState(1)
  const [milkyWay, setMilkyWay] = useState(true)
  const hoverAttention = useAppStore((s) => s.graphHoverAttention)
  const setHoverAttention = useAppStore((s) => s.setGraphHoverAttention)
  const projectionMode = useAppStore((s) => s.graphProjectionMode)
  const setProjectionMode = useAppStore((s) => s.setGraphProjectionMode)
  const neighborhoodOnly = useAppStore((s) => s.graphNeighborhoodOnly)
  const setNeighborhoodOnly = useAppStore((s) => s.setGraphNeighborhoodOnly)
  const hideIsolated = useAppStore((s) => s.graphHideIsolated)
  const setHideIsolated = useAppStore((s) => s.setGraphHideIsolated)
  const [intEdges, setIntEdges] = useState(false)
  const [extEdges, setExtEdges] = useState(false)
  const [cometsVis, setCometsVis] = useState(true)
  const [filterPerm, setFilterPerm] = useState(true)
  const [filterFleet, setFilterFleet] = useState(true)
  const [filterLit, setFilterLit] = useState(true)
  const [isDefaultView, setIsDefaultView] = useState(true)

  // Track whether camera has moved from default by observing the DOM class
  // on #reset-view-btn, which the 3D canvas toggles when a node is focused
  useEffect(() => {
    const btn = document.getElementById('reset-view-btn')
    if (!btn) return

    const check = () => setIsDefaultView(!btn.classList.contains('visible'))
    check()

    const observer = new MutationObserver(check)
    observer.observe(btn, { attributes: true, attributeFilter: ['class'] })

    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    let attempts = 0
    const maxAttempts = 15
    let timerId: ReturnType<typeof setTimeout> | null = null
    const poll = () => {
      const acts = useGalaxyActions.getState().actions
      const ar = acts.getAutoRotate?.() as boolean | undefined; if (ar !== undefined) setAutoRotate(ar);
      const sr = acts.getRotateSpeed?.() as number | undefined; if (sr !== undefined) setRotateSpeed(sr);
      const bl = acts.getBloom?.() as number | undefined; if (bl !== undefined) setBloom(bl);
      const cs = acts.getCometSpeed?.() as number | undefined; if (cs !== undefined) setCometSpeed(cs);
      const mw = acts.getMilkyWay?.() as boolean | undefined; if (mw !== undefined) setMilkyWay(mw);
      const ha = acts.getHoverAttention?.() as boolean | undefined; if (ha !== undefined) setHoverAttention(ha);
      const pm = acts.getProjectionMode?.() as '3d' | '2d' | undefined; if (pm !== undefined) setProjectionMode(pm);
      // Did any of the reads succeed?  Stop polling.
      if (ar !== undefined || sr !== undefined || bl !== undefined || cs !== undefined || mw !== undefined || ha !== undefined || pm !== undefined) return;
      attempts++;
      if (attempts < maxAttempts) timerId = setTimeout(poll, 200);
    };
    poll();
    return () => { if (timerId !== null) clearTimeout(timerId) }
  }, [setHoverAttention, setProjectionMode])

  const toggleAutoRotate = () => { const v = !autoRotate; if (callCanvas('__setAutoRotate', [v])) setAutoRotate(v) }
  const handleSpeed = (e: any) => { const v = parseFloat(e.target.value); if (callCanvas('__setRotateSpeed', [v])) setRotateSpeed(v) }
  const handleBloom = (e: any) => { const v = parseFloat(e.target.value); if (callCanvas('__setBloom', [v])) setBloom(v) }
  const handleComet = (e: any) => { const v = parseFloat(e.target.value); if (callCanvas('__setCometSpeed', [v])) setCometSpeed(v) }
  const toggleMilkyWay = () => { const v = !milkyWay; if (callCanvas('__setMilkyWay', [v])) setMilkyWay(v) }
  const toggleHoverAttention = () => {
    const v = !hoverAttention
    setHoverAttention(v)
    callCanvas('__setHoverAttention', [v])
  }
  const toggleProjectionMode = () => {
    const v = projectionMode === '3d' ? '2d' : '3d'
    setProjectionMode(v)
    callCanvas('__setProjectionMode', [v])
  }
  const toggleNeighborhoodOnly = () => setNeighborhoodOnly(!neighborhoodOnly)
  const toggleHideIsolated = () => setHideIsolated(!hideIsolated)
  const toggleIntEdges = () => { const v = !intEdges; if (projectionMode === '2d' || callCanvas('__setInternalEdgesVisible', [v])) setIntEdges(v) }
  const toggleCometsVis = () => { const v = !cometsVis; if (projectionMode === '2d' || callCanvas('__setCometsVisible', [v])) setCometsVis(v) }
  const toggleExtEdges = () => { const v = !extEdges; if (projectionMode === '2d' || callCanvas('__setExternalEdgesVisible', [v])) setExtEdges(v) }
  const toggleType = (type: string, state: boolean, setter: any) => { const v = !state; if (callCanvas('__setNodeTypeVisible', [type, v])) setter(v) }
  const resetView = () => {
    if (callCanvas('__resetCameraView', [])) setProjectionMode('3d')
  }
  const fitSelection = () => { callCanvas('__fitSelection', []) }

  // ── Cluster management state ──
  const [newClusterName, setNewClusterName] = useState('')
  const [editingClusterId, setEditingClusterId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [assigningCardId, setAssigningCardId] = useState<string | null>(null)

  const handleCreateCluster = async () => {
    const name = newClusterName.trim()
    if (!name) return
    try {
      await createCluster.mutateAsync({ name })
      setNewClusterName('')
      toast.success(`星团「${name}」已创建`)
    } catch { toast.error('创建星团失败') }
  }

  const handleRenameCluster = async (id: string) => {
    const name = editingName.trim()
    if (!name) return
    try {
      await updateCluster.mutateAsync({ id, name })
      setEditingClusterId(null)
      setEditingName('')
    } catch { toast.error('重命名失败') }
  }

  const handleDeleteCluster = async (id: string, name: string) => {
    if (!confirm(`确定删除星团「${name}」？星团内的卡片将变为游离节点。`)) return
    try {
      await deleteCluster.mutateAsync(id)
      toast.success(`星团「${name}」已删除`)
    } catch { toast.error('删除星团失败') }
  }

  const handleAssignCard = async (cardId: string, clusterId: string) => {
    try {
      await assignCard.mutateAsync({ cardId, clusterId })
      setAssigningCardId(null)
      toast.success('卡片已归入星团')
    } catch { toast.error('分配失败') }
  }

  const clusters = galaxyData?.clusters ?? []
  const allNodes = galaxyData?.nodes ?? []
  const unattachedNodes = allNodes.filter(n => !n.clusterId)

  return (
    <aside
      className="side-slot visible galaxy-panel flex-col pointer-events-auto no-scrollbar"
      style={{ width: 'var(--panel-sm)', justifyContent: 'flex-start', gap: '10px', padding: 'var(--panel-py) 0', overflow: 'hidden' }}
    >
      <section className="rounded-2xl border border-white/8 bg-white/[0.012] px-3 py-3">
        <span className="mono opacity-40 uppercase tracking-widest block" style={{ fontSize: 'var(--f8)' }}>GALAXY_CONTROLS</span>
      </section>

      <section className="rounded-2xl border border-white/8 bg-white/[0.012] px-3 py-3">
        <span className="mono opacity-30 uppercase block mb-3" style={{ fontSize: 'var(--f7)' }}>ORBIT</span>
        <div className="space-y-4">
          <div className="flex justify-between items-center group cursor-pointer" onClick={toggleAutoRotate}>
            <span className="mono text-white/60 group-hover:text-white transition-colors" style={{ fontSize: 'var(--f9)' }}>自动旋转</span>
            <button className={`orbit-toggle ${autoRotate ? 'orbit-toggle-on' : ''}`}>
              <span className={`orbit-toggle-dot ${autoRotate ? 'orbit-toggle-dot-on' : ''}`} />
            </button>
          </div>
          <div>
            <div className="flex justify-between mono mb-1.5" style={{ fontSize: 'var(--f9)' }}><span className="opacity-40">旋转速度</span><span className="opacity-60">{rotateSpeed.toFixed(1)}</span></div>
            <input type="range" min="0" max="2" step="0.1" value={rotateSpeed} onChange={handleSpeed} className="orbit-slider cursor-pointer" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button className="axiom-btn secondary w-full border-white/10 bg-white/[0.025]" style={{ fontSize: 'var(--f9)', opacity: isDefaultView ? 0.2 : 1, pointerEvents: isDefaultView ? 'none' : 'auto' }} onClick={resetView}>重置视角</button>
            <button className="axiom-btn secondary w-full border-white/10 bg-white/[0.025]" style={{ fontSize: 'var(--f9)', opacity: isDefaultView ? 0.2 : 1, pointerEvents: isDefaultView ? 'none' : 'auto' }} onClick={fitSelection}>适配关系</button>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-white/8 bg-white/[0.012] px-3 py-3">
        <span className="mono opacity-30 uppercase block mb-3" style={{ fontSize: 'var(--f7)' }}>VISUAL</span>
        <div className="space-y-4">
          <div>
            <div className="flex justify-between mono mb-1.5" style={{ fontSize: 'var(--f9)' }}><span className="opacity-40">BLOOM</span><span className="opacity-60">{bloom.toFixed(1)}</span></div>
            <input type="range" min="0" max="2.5" step="0.1" value={bloom} onChange={handleBloom} className="orbit-slider cursor-pointer" />
          </div>
          <div>
            <div className="flex justify-between mono mb-1.5" style={{ fontSize: 'var(--f9)' }}><span className="opacity-40">COMET SPEED</span><span className="opacity-60">{cometSpeed.toFixed(1)}</span></div>
            <input type="range" min="0" max="3" step="0.1" value={cometSpeed} onChange={handleComet} className="orbit-slider cursor-pointer" />
          </div>
          {[
            { label: '悬停聚焦', val: hoverAttention, fn: toggleHoverAttention },
            { label: projectionMode === '3d' ? '3D 星系' : '2D 图谱', val: projectionMode === '2d', fn: toggleProjectionMode },
            { label: '只看邻域', val: neighborhoodOnly, fn: toggleNeighborhoodOnly },
            { label: '隐藏孤点', val: hideIsolated, fn: toggleHideIsolated },
            { label: '彗星', val: cometsVis, fn: toggleCometsVis },
            { label: '银河带', val: milkyWay, fn: toggleMilkyWay },
            { label: '内部连线', val: intEdges, fn: toggleIntEdges },
            { label: '外部连线', val: extEdges, fn: toggleExtEdges },
          ].map((item) => (
            <div key={item.label} className="flex justify-between items-center group cursor-pointer" onClick={item.fn}>
              <span className="mono text-white/60 group-hover:text-white transition-colors" style={{ fontSize: 'var(--f9)' }}>{item.label}</span>
              <button className={`orbit-toggle ${item.val ? 'orbit-toggle-on' : ''}`}>
                <span className={`orbit-toggle-dot ${item.val ? 'orbit-toggle-dot-on' : ''}`} />
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-white/8 bg-white/[0.012] px-3 py-3">
        <span className="mono opacity-30 uppercase block mb-3" style={{ fontSize: 'var(--f7)' }}>FILTER</span>
        <div className="space-y-3">
          <label className="flex items-center justify-between cursor-pointer group" onClick={() => toggleType('permanent', filterPerm, setFilterPerm)}>
            <span className="mono text-purple-400/80 group-hover:text-purple-300 transition-colors" style={{ fontSize: 'var(--f10)' }}>◆ 永久</span>
            <button className={`orbit-toggle ${filterPerm ? 'orbit-toggle-on' : ''}`}><span className={`orbit-toggle-dot ${filterPerm ? 'orbit-toggle-dot-on' : ''}`} /></button>
          </label>
          <label className="flex items-center justify-between cursor-pointer group" onClick={() => toggleType('fleeting', filterFleet, setFilterFleet)}>
            <span className="mono text-cyan-400/80 group-hover:text-cyan-300 transition-colors" style={{ fontSize: 'var(--f10)' }}>◇ 灵感</span>
            <button className={`orbit-toggle ${filterFleet ? 'orbit-toggle-on' : ''}`}><span className={`orbit-toggle-dot ${filterFleet ? 'orbit-toggle-dot-on' : ''}`} /></button>
          </label>
          <label className="flex items-center justify-between cursor-pointer group" onClick={() => toggleType('literature', filterLit, setFilterLit)}>
            <span className="mono text-pink-400/80 group-hover:text-pink-300 transition-colors" style={{ fontSize: 'var(--f10)' }}>○ 文献</span>
            <button className={`orbit-toggle ${filterLit ? 'orbit-toggle-on' : ''}`}><span className={`orbit-toggle-dot ${filterLit ? 'orbit-toggle-dot-on' : ''}`} /></button>
          </label>
        </div>
      </section>

      {/* ── 星团管理 ── */}
      <section className="min-h-0 flex-1 overflow-y-auto no-scrollbar rounded-2xl border border-white/8 bg-white/[0.012] px-3 py-3">
        <div className="flex items-center justify-between mb-3">
          <span className="mono opacity-30 uppercase" style={{ fontSize: 'var(--f7)' }}>星团管理</span>
          <span className="mono text-white/20 text-[8px]">{clusters.length} 个</span>
        </div>

        {/* New cluster */}
        <div className="flex items-center gap-2 mb-3">
          <input
            className="flex-1 bg-white/[0.025] border border-white/10 rounded px-2 py-1 text-white/80 text-[10px] mono outline-none focus:border-purple-500/40"
            placeholder="新星团名称"
            value={newClusterName}
            onChange={e => setNewClusterName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleCreateCluster() }}
          />
          <button
            className="mono text-[9px] px-2 py-1 rounded bg-pink-500/12 border border-pink-500/24 text-pink-200/80 hover:bg-pink-500/18 disabled:opacity-20"
            disabled={!newClusterName.trim() || createCluster.isPending}
            onClick={handleCreateCluster}
          >创建</button>
        </div>

        {/* Cluster list */}
        <div className="space-y-1">
          {clusters.map(cl => (
            <div key={cl.id} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-white/5 group">
              {editingClusterId === cl.id ? (
                <input
                  className="flex-1 bg-white/10 border border-purple-500/40 rounded px-1.5 py-0.5 text-white text-[10px] mono outline-none"
                  value={editingName}
                  onChange={e => setEditingName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleRenameCluster(cl.id)
                    if (e.key === 'Escape') { setEditingClusterId(null); setEditingName('') }
                  }}
                  autoFocus
                />
              ) : (
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: cl.color }} />
                  <span className="mono text-white/70 truncate text-[10px]">{cl.name}</span>
                  <span className="mono text-white/15 shrink-0 text-[8px]">{cl.cardCount}</span>
                </div>
              )}
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                <button className="text-white/20 hover:text-white/60 text-[9px] px-1" onClick={() => { setEditingClusterId(cl.id); setEditingName(cl.name) }} title="重命名">✎</button>
                <button className="text-red-400/30 hover:text-red-400 text-[9px] px-1" onClick={() => handleDeleteCluster(cl.id, cl.name)} title="删除星团">✕</button>
              </div>
            </div>
          ))}
        </div>

        {/* ── 游离节点 ── */}
        {unattachedNodes.length > 0 && (
          <>
            <div className="my-3 h-px bg-white/6"></div>
            <span className="mono opacity-30 uppercase block mb-2" style={{ fontSize: 'var(--f7)' }}>
              游离节点
              <span className="text-white/20 ml-1 text-[8px]">{unattachedNodes.length}</span>
            </span>
            <div className="space-y-1 max-h-[200px] overflow-y-auto no-scrollbar">
              {unattachedNodes.slice(0, 30).map(node => (
                <div key={node.id} className="flex items-center justify-between py-1 px-2 rounded hover:bg-white/5 group">
                  <span className="mono text-white/40 truncate text-[9px] flex-1 min-w-0">
                    {node.type === 'permanent' ? '◆' : node.type === 'literature' ? '○' : '◇'} {node.title}
                  </span>
                  {assigningCardId === node.id ? (
                    <select
                      className="bg-black/60 border border-purple-500/40 rounded px-1 py-0.5 text-white text-[8px] mono outline-none max-w-[90px]"
                      onChange={e => { if (e.target.value) handleAssignCard(node.id, e.target.value) }}
                      onBlur={() => setAssigningCardId(null)}
                      autoFocus
                    >
                      <option value="">星团...</option>
                      {clusters.map(cl => (<option key={cl.id} value={cl.id}>{cl.name}</option>))}
                    </select>
                  ) : (
                    <button
                      className="mono text-[8px] text-purple-400/60 hover:text-purple-400 opacity-0 group-hover:opacity-100 transition-opacity px-1 shrink-0"
                      onClick={() => setAssigningCardId(node.id)}
                    >→ 分配</button>
                  )}
                </div>
              ))}
              {unattachedNodes.length > 30 && (
                <div className="mono text-white/15 text-[8px] text-center py-1">还有 {unattachedNodes.length - 30} 个...</div>
              )}
            </div>
          </>
        )}
      </section>

      {/* ── Stats footer ── */}
      <section className="grid shrink-0 grid-cols-3 gap-3 rounded-2xl border border-white/8 bg-white/[0.012] px-3 py-3">
        <div><span className="mono opacity-40 uppercase tracking-widest block" style={{ fontSize: 'var(--f7)' }}>NODES</span><div className="mono text-sm text-white/90 font-bold mt-0.5">{allNodes.length}</div></div>
        <div><span className="mono opacity-40 uppercase tracking-widest block" style={{ fontSize: 'var(--f7)' }}>FREE</span><div className="mono text-sm text-pink-400 font-bold mt-0.5">{unattachedNodes.length}</div></div>
        <div><span className="mono opacity-40 uppercase tracking-widest block" style={{ fontSize: 'var(--f7)' }}>FPS</span><div className="mono text-sm text-cyan-400 font-bold mt-0.5" id="fps-display">—</div></div>
      </section>
    </aside>
  )
}
