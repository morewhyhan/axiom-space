'use client'

import { useState, useEffect } from 'react'
import { useDashboardStats } from '@/hooks/use-dashboard'
import { useAppStore } from '@/stores/mode-store'
import { toast } from 'sonner'

/** Call a Three.js canvas bridge function; warn the user if the canvas hasn't mounted yet. */
function callCanvas<T extends (...args: any[]) => any>(name: string, args: Parameters<T>): boolean {
  const fn = (window as any)[name] as T | undefined
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

  useEffect(() => {
    const init = () => {
      const ar = (window as any).__getAutoRotate?.(); if (ar !== undefined) setAutoRotate(ar);
      const sr = (window as any).__getRotateSpeed?.(); if (sr !== undefined) setRotateSpeed(sr);
      const bl = (window as any).__getBloom?.(); if (bl !== undefined) setBloom(bl);
      const cs = (window as any).__getCometSpeed?.(); if (cs !== undefined) setCometSpeed(cs);
      const mw = (window as any).__getMilkyWay?.(); if (mw !== undefined) setMilkyWay(mw);
    };
    setTimeout(init, 800);
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
    <aside className="side-slot visible galaxy-panel flex-col pointer-events-auto" style={{ width: 'var(--panel-sm)', justifyContent: 'space-between' }}>
      <span className="mono opacity-25 uppercase tracking-widest" style={{ fontSize: 'var(--f8)' }}>GALAXY_CONTROLS</span>

      <div>
        <span className="mono opacity-20 uppercase block mb-2.5" style={{ fontSize: 'var(--f7)' }}>ORBIT</span>
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <span className="mono text-white/50" style={{ fontSize: 'var(--f9)' }}>自动旋转</span>
            <button className={`orbit-toggle ${autoRotate ? 'orbit-toggle-on' : ''}`} onClick={toggleAutoRotate}>
              <span className={`orbit-toggle-dot ${autoRotate ? 'orbit-toggle-dot-on' : ''}`} />
            </button>
          </div>
          <div>
            <div className="flex justify-between mono mb-1" style={{ fontSize: 'var(--f9)' }}><span className="opacity-40">旋转速度</span><span className="opacity-50">{rotateSpeed.toFixed(1)}</span></div>
            <input type="range" min="0" max="2" step="0.1" value={rotateSpeed} onChange={handleSpeed} className="orbit-slider" />
          </div>
          <button className="axiom-btn secondary w-full" style={{ fontSize: 'var(--f9)' }} onClick={resetView}>重置视角</button>
        </div>
      </div>

      <div className="hud-line"></div>

      <div>
        <span className="mono opacity-20 uppercase block mb-2.5" style={{ fontSize: 'var(--f7)' }}>VISUAL</span>
        <div className="space-y-3">
          <div>
            <div className="flex justify-between mono mb-1" style={{ fontSize: 'var(--f9)' }}><span className="opacity-40">BLOOM</span><span className="opacity-50">{bloom.toFixed(1)}</span></div>
            <input type="range" min="0" max="2.5" step="0.1" value={bloom} onChange={handleBloom} className="orbit-slider" />
          </div>
          <div>
            <div className="flex justify-between mono mb-1" style={{ fontSize: 'var(--f9)' }}><span className="opacity-40">COMET SPEED</span><span className="opacity-50">{cometSpeed.toFixed(1)}</span></div>
            <input type="range" min="0" max="3" step="0.1" value={cometSpeed} onChange={handleComet} className="orbit-slider" />
          </div>
          <div className="flex justify-between items-center">
            <span className="mono text-white/50" style={{ fontSize: 'var(--f9)' }}>彗星</span>
            <button className={`orbit-toggle ${cometsVis ? 'orbit-toggle-on' : ''}`} onClick={toggleCometsVis}>
              <span className={`orbit-toggle-dot ${cometsVis ? 'orbit-toggle-dot-on' : ''}`} />
            </button>
          </div>
          <div className="flex justify-between items-center">
            <span className="mono text-white/50" style={{ fontSize: 'var(--f9)' }}>银河带</span>
            <button className={`orbit-toggle ${milkyWay ? 'orbit-toggle-on' : ''}`} onClick={toggleMilkyWay}>
              <span className={`orbit-toggle-dot ${milkyWay ? 'orbit-toggle-dot-on' : ''}`} />
            </button>
          </div>
          <div className="flex justify-between items-center">
            <span className="mono text-white/50" style={{ fontSize: 'var(--f9)' }}>内部连线</span>
            <button className={`orbit-toggle ${intEdges ? 'orbit-toggle-on' : ''}`} onClick={toggleIntEdges}>
              <span className={`orbit-toggle-dot ${intEdges ? 'orbit-toggle-dot-on' : ''}`} />
            </button>
          </div>
          <div className="flex justify-between items-center">
            <span className="mono text-white/50" style={{ fontSize: 'var(--f9)' }}>外部连线</span>
            <button className={`orbit-toggle ${extEdges ? 'orbit-toggle-on' : ''}`} onClick={toggleExtEdges}>
              <span className={`orbit-toggle-dot ${extEdges ? 'orbit-toggle-dot-on' : ''}`} />
            </button>
          </div>
        </div>
      </div>

      <div className="hud-line"></div>

      <div>
        <span className="mono opacity-20 uppercase block mb-2.5" style={{ fontSize: 'var(--f7)' }}>FILTER</span>
        <div className="space-y-2">
          <label className="flex items-center justify-between cursor-pointer" onClick={() => toggleType('permanent', filterPerm, setFilterPerm)}>
            <span className="mono text-purple-400" style={{ fontSize: 'var(--f10)' }}>◆ 永久</span>
            <button className={`orbit-toggle ${filterPerm ? 'orbit-toggle-on' : ''}`}><span className={`orbit-toggle-dot ${filterPerm ? 'orbit-toggle-dot-on' : ''}`} /></button>
          </label>
          <label className="flex items-center justify-between cursor-pointer" onClick={() => toggleType('fleeting', filterFleet, setFilterFleet)}>
            <span className="mono text-cyan-400" style={{ fontSize: 'var(--f10)' }}>◇ 灵感</span>
            <button className={`orbit-toggle ${filterFleet ? 'orbit-toggle-on' : ''}`}><span className={`orbit-toggle-dot ${filterFleet ? 'orbit-toggle-dot-on' : ''}`} /></button>
          </label>
          <label className="flex items-center justify-between cursor-pointer" onClick={() => toggleType('literature', filterLit, setFilterLit)}>
            <span className="mono text-pink-400" style={{ fontSize: 'var(--f10)' }}>○ 文献</span>
            <button className={`orbit-toggle ${filterLit ? 'orbit-toggle-on' : ''}`}><span className={`orbit-toggle-dot ${filterLit ? 'orbit-toggle-dot-on' : ''}`} /></button>
          </label>
        </div>
      </div>

      <div className="hud-line"></div>

      <div className="grid grid-cols-3 gap-3">
        <div><span className="mono opacity-30 uppercase tracking-widest block" style={{ fontSize: 'var(--f7)' }}>CLUSTERS</span><div className="mono text-sm text-white font-bold mt-0.5">{loading ? '—' : stats?.clusters ?? 0}</div></div>
        <div><span className="mono opacity-30 uppercase tracking-widest block" style={{ fontSize: 'var(--f7)' }}>NODES</span><div className="mono text-sm text-white font-bold mt-0.5">{loading ? '—' : stats?.totalNodes ?? 0}</div></div>
        <div><span className="mono opacity-30 uppercase tracking-widest block" style={{ fontSize: 'var(--f7)' }}>FPS</span><div className="mono text-sm text-white font-bold mt-0.5" id="fps-display">—</div></div>
      </div>
    </aside>
  )
}
