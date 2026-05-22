'use client'

import { useAppStore } from '@/stores/mode-store'

export default function GalaxyFilter() {
  const { openModal } = useAppStore()

  return (
    <aside className="side-slot visible galaxy-panel flex-col pointer-events-auto" style={{ width: 'var(--panel-sm)', justifyContent: 'space-between' }}>
      <span className="mono opacity-25 uppercase tracking-widest" style={{ fontSize: 'var(--f8)' }}>GALAXY_FILTER</span>

      <div>
        <span className="mono opacity-20 uppercase block mb-2.5" style={{ fontSize: 'var(--f7)' }}>FILTER</span>
        <div className="space-y-2">
          <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" defaultChecked className="accent-purple-500" /><span className="mono text-purple-400" style={{ fontSize: 'var(--f10)' }}>永久</span><span className="mono opacity-25 ml-auto" style={{ fontSize: 'var(--f8)' }}>156</span></label>
          <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" defaultChecked className="accent-cyan-500" /><span className="mono text-cyan-400" style={{ fontSize: 'var(--f10)' }}>灵感</span><span className="mono opacity-25 ml-auto" style={{ fontSize: 'var(--f8)' }}>89</span></label>
          <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" defaultChecked className="accent-pink-500" /><span className="mono text-pink-400" style={{ fontSize: 'var(--f10)' }}>文献</span><span className="mono opacity-25 ml-auto" style={{ fontSize: 'var(--f8)' }}>133</span></label>
        </div>
      </div>

      <div className="hud-line"></div>

      <div>
        <span className="mono opacity-20 uppercase block mb-2.5" style={{ fontSize: 'var(--f7)' }}>SCOPE</span>
        <div className="flex items-center justify-between"><span className="mono opacity-40" style={{ fontSize: 'var(--f9)' }}>领域</span>
          <select className="bg-white/5 border border-white/10 rounded px-2 py-1 mono text-white/50 outline-none cursor-pointer" style={{ fontSize: 'var(--f9)' }}>
            <option>全部</option><option>热力学</option><option>复杂系统</option><option>信息论</option>
          </select>
        </div>
        <div className="mt-2 flex gap-3">
          <label className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" className="accent-purple-500" /><span className="mono opacity-50" style={{ fontSize: 'var(--f8)' }}>未连接</span></label>
          <label className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" defaultChecked className="accent-cyan-500" /><span className="mono opacity-50" style={{ fontSize: 'var(--f8)' }}>邻接高亮</span></label>
        </div>
      </div>

      <div className="hud-line"></div>

      <div>
        <span className="mono opacity-20 uppercase block mb-2.5" style={{ fontSize: 'var(--f7)' }}>SEARCH</span>
        <div className="flex items-center gap-2 bg-white/5 px-3 py-2 rounded-lg border border-white/5 cursor-pointer" onClick={() => openModal('search')}>
          <span className="opacity-30 mono" style={{ fontSize: 'var(--t-label)' }}>⌘K</span>
          <span className="mono opacity-25" style={{ fontSize: 'var(--t-label)' }}>搜索节点...</span>
        </div>
      </div>

      <div className="hud-line"></div>

      <div>
        <span className="mono opacity-20 uppercase block mb-2.5" style={{ fontSize: 'var(--f7)' }}>LEGEND</span>
        <div className="space-y-2">
          <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-purple-400"></span><span className="mono opacity-40" style={{ fontSize: 'var(--f9)' }}>PERM — 永久知识</span></div>
          <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-cyan-400"></span><span className="mono opacity-40" style={{ fontSize: 'var(--f9)' }}>FLEE — 灵感</span></div>
          <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-pink-400"></span><span className="mono opacity-40" style={{ fontSize: 'var(--f9)' }}>LIT — 文献</span></div>
        </div>
      </div>

      <div className="hud-line"></div>

      <div className="flex justify-between"><span className="mono opacity-30" style={{ fontSize: 'var(--f10)' }}>可视区域</span><span className="mono text-white/50" style={{ fontSize: 'var(--f10)' }}>42 节点 · 118 边</span></div>
    </aside>
  )
}
