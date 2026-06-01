'use client'

import { useState, useEffect } from 'react'
import { useDashboardStats } from '@/hooks/use-dashboard'
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
  const { stats, loading } = useDashboardStats()
  const currentVaultId = useAppStore((s) => s.currentVaultId)

  const [autoRotate, setAutoRotate] = useState(true)
  const [rotateSpeed, setRotateSpeed] = useState(0.2)
  const [bloom, setBloom] = useState(2.5)
  const [cometSpeed, setCometSpeed] = useState(1)
  const [milkyWay, setMilkyWay] = useState(true)
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
      const ar = acts.getAutoRotate?.(); if (ar !== undefined) setAutoRotate(ar);
      const sr = acts.getRotateSpeed?.(); if (sr !== undefined) setRotateSpeed(sr);
      const bl = acts.getBloom?.(); if (bl !== undefined) setBloom(bl);
      const cs = acts.getCometSpeed?.(); if (cs !== undefined) setCometSpeed(cs);
      const mw = acts.getMilkyWay?.(); if (mw !== undefined) setMilkyWay(mw);
      // Did any of the reads succeed?  Stop polling.
      if (ar !== undefined || sr !== undefined || bl !== undefined || cs !== undefined || mw !== undefined) return;
      attempts++;
      if (attempts < maxAttempts) timerId = setTimeout(poll, 200);
    };
    poll();
    return () => { if (timerId !== null) clearTimeout(timerId) }
  }, [])

  const toggleAutoRotate = () => { const v = !autoRotate; if (callCanvas('__setAutoRotate', [v])) setAutoRotate(v) }
  const handleSpeed = (e: any) => { const v = parseFloat(e.target.value); if (callCanvas('__setRotateSpeed', [v])) setRotateSpeed(v) }
  const handleBloom = (e: any) => { const v = parseFloat(e.target.value); if (callCanvas('__setBloom', [v])) setBloom(v) }
  const handleComet = (e: any) => { const v = parseFloat(e.target.value); if (callCanvas('__setCometSpeed', [v])) setCometSpeed(v) }
  const toggleMilkyWay = () => { const v = !milkyWay; if (callCanvas('__setMilkyWay', [v])) setMilkyWay(v) }
  const toggleIntEdges = () => { const v = !intEdges; if (callCanvas('__setInternalEdgesVisible', [v])) setIntEdges(v) }
  const toggleCometsVis = () => { const v = !cometsVis; if (callCanvas('__setCometsVisible', [v])) setCometsVis(v) }
  const toggleExtEdges = () => { const v = !extEdges; if (callCanvas('__setExternalEdgesVisible', [v])) setExtEdges(v) }
  const toggleType = (type: string, state: boolean, setter: any) => { const v = !state; if (callCanvas('__setNodeTypeVisible', [type, v])) setter(v) }
  const resetView = () => { callCanvas('__resetCameraView', []) }

  return (
    <aside className="side-slot visible galaxy-panel flex-col pointer-events-auto" style={{ width: 'var(--panel-sm)', justifyContent: 'flex-start', gap: 'var(--space-sections)', padding: 'var(--panel-py) 0' }}>
      <span className="mono opacity-40 uppercase tracking-widest block" style={{ fontSize: 'var(--f8)' }}>GALAXY_CONTROLS</span>
      <div className="hud-line"></div>

      <div>
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
          <button className="axiom-btn secondary w-full" style={{ fontSize: 'var(--f9)', opacity: isDefaultView ? 0.2 : 1, pointerEvents: isDefaultView ? 'none' : 'auto' }} onClick={resetView}>重置视角</button>
        </div>
      </div>

      <div className="hud-line"></div>

      <div>
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
      </div>

      <div className="hud-line"></div>

      <div>
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
      </div>

      <div className="mt-auto pt-4 border-t border-white/5 grid grid-cols-3 gap-3">
        <div><span className="mono opacity-40 uppercase tracking-widest block" style={{ fontSize: 'var(--f7)' }}>CLUSTERS</span><div className="mono text-sm text-white/90 font-bold mt-0.5">{loading ? '—' : stats?.clusters ?? 0}</div></div>
        <div><span className="mono opacity-40 uppercase tracking-widest block" style={{ fontSize: 'var(--f7)' }}>NODES</span><div className="mono text-sm text-white/90 font-bold mt-0.5">{loading ? '—' : stats?.totalNodes ?? 0}</div></div>
        <div><span className="mono opacity-40 uppercase tracking-widest block" style={{ fontSize: 'var(--f7)' }}>FPS</span><div className="mono text-sm text-cyan-400 font-bold mt-0.5" id="fps-display">—</div></div>
      </div>
    </aside>
  )
}
