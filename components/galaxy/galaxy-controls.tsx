'use client'

import { useState } from 'react'

export default function GalaxyControls() {
  const [charge, setCharge] = useState(-80)
  const [dist, setDist] = useState(45)
  const [bloom, setBloom] = useState(15)
  const [glow, setGlow] = useState(10)
  const [density, setDensity] = useState(80)
  const [comet, setComet] = useState(10)
  const [rotate, setRotate] = useState(true)
  const [milkyWay, setMilkyWay] = useState(true)
  const [grid, setGrid] = useState(false)
  const [flat, setFlat] = useState(false)

  return (
    <aside className="side-slot visible galaxy-panel flex-col pointer-events-auto" style={{ width: 'var(--panel-sm)', justifyContent: 'space-between' }}>
      <span className="mono opacity-25 uppercase tracking-widest" style={{ fontSize: 'var(--f8)' }}>GALAXY_CONTROLS</span>

      <div>
        <span className="mono opacity-20 uppercase block mb-2.5" style={{ fontSize: 'var(--f7)' }}>PHYSICS</span>
        <div className="space-y-3">
          <div>
            <div className="flex justify-between mono mb-1" style={{ fontSize: 'var(--f9)' }}><span className="opacity-40">CHARGE</span><span className="opacity-50">{charge}</span></div>
            <input type="range" min="-200" max="-5" value={charge} className="phys-slider" onChange={e => setCharge(Number(e.target.value))} />
          </div>
          <div>
            <div className="flex justify-between mono mb-1" style={{ fontSize: 'var(--f9)' }}><span className="opacity-40">LINK DISTANCE</span><span className="opacity-50">{dist}</span></div>
            <input type="range" min="5" max="100" value={dist} className="phys-slider" onChange={e => setDist(Number(e.target.value))} />
          </div>
          <div>
            <div className="flex justify-between mono mb-1" style={{ fontSize: 'var(--f9)' }}><span className="opacity-40">AUTO ROTATE</span></div>
            <div className={`toggle-track ${rotate ? 'on' : ''}`} onClick={() => setRotate(!rotate)}><div className="toggle-knob"></div></div>
          </div>
        </div>
      </div>

      <div className="hud-line"></div>

      <div>
        <span className="mono opacity-20 uppercase block mb-2.5" style={{ fontSize: 'var(--f7)' }}>VISUAL</span>
        <div className="space-y-3">
          <div>
            <div className="flex justify-between mono mb-1" style={{ fontSize: 'var(--f9)' }}><span className="opacity-40">BLOOM</span><span className="opacity-50">{(bloom / 10).toFixed(1)}</span></div>
            <input type="range" min="0" max="30" value={bloom} className="phys-slider" onChange={e => setBloom(Number(e.target.value))} />
          </div>
          <div>
            <div className="flex justify-between mono mb-1" style={{ fontSize: 'var(--f9)' }}><span className="opacity-40">GLOW SIZE</span><span className="opacity-50">{glow}</span></div>
            <input type="range" min="2" max="20" value={glow} className="phys-slider" onChange={e => setGlow(Number(e.target.value))} />
          </div>
          <div>
            <div className="flex justify-between mono mb-1" style={{ fontSize: 'var(--f9)' }}><span className="opacity-40">NODE DENSITY</span><span className="opacity-50">{density}</span></div>
            <input type="range" min="10" max="150" value={density} className="phys-slider" onChange={e => setDensity(Number(e.target.value))} />
          </div>
          <div>
            <div className="flex justify-between mono mb-1" style={{ fontSize: 'var(--f9)' }}><span className="opacity-40">COMET SPEED</span><span className="opacity-50">{(comet / 10).toFixed(1)}</span></div>
            <input type="range" min="0" max="30" value={comet} className="phys-slider" onChange={e => setComet(Number(e.target.value))} />
          </div>
          <div>
            <div className="flex justify-between mono mb-1" style={{ fontSize: 'var(--f9)' }}><span className="opacity-40">MILKY WAY</span></div>
            <div className={`toggle-track ${milkyWay ? 'on' : ''}`} onClick={() => setMilkyWay(!milkyWay)}><div className="toggle-knob"></div></div>
          </div>
          <div>
            <div className="flex justify-between mono mb-1" style={{ fontSize: 'var(--f9)' }}><span className="opacity-40">GRID</span></div>
            <div className={`toggle-track ${grid ? 'on' : ''}`} onClick={() => setGrid(!grid)}><div className="toggle-knob"></div></div>
          </div>
          <div>
            <div className="flex justify-between mono mb-1" style={{ fontSize: 'var(--f9)' }}><span className="opacity-40">FLAT LAYOUT</span></div>
            <div className={`toggle-track ${flat ? 'on' : ''}`} onClick={() => setFlat(!flat)}><div className="toggle-knob"></div></div>
          </div>
        </div>
      </div>

      <div className="hud-line"></div>

      <div className="grid grid-cols-3 gap-3">
        <div><span className="mono opacity-30 uppercase tracking-widest block" style={{ fontSize: 'var(--f7)' }}>CLUSTERS</span><div className="mono text-sm text-white font-bold mt-0.5">6</div></div>
        <div><span className="mono opacity-30 uppercase tracking-widest block" style={{ fontSize: 'var(--f7)' }}>NODES</span><div className="mono text-sm text-white font-bold mt-0.5">481</div></div>
        <div><span className="mono opacity-30 uppercase tracking-widest block" style={{ fontSize: 'var(--f7)' }}>FPS</span><div className="mono text-sm text-white font-bold mt-0.5" id="fps-display">60</div></div>
      </div>
    </aside>
  )
}
