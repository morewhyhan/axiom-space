'use client'

export default function CognitiveRadar() {
  return (
    <aside className="side-slot visible cognition-panel flex-col pointer-events-auto gap-4" style={{ width: 'var(--panel-sm)' }}>
      <div className="glass-panel p-5 rounded-2xl">
        <span className="mono opacity-40 uppercase block mb-4" style={{ fontSize: 'var(--f10)' }}>Cognitive_Radar</span>
        <div className="flex justify-center mb-4">
          <svg width="180" height="180" viewBox="0 0 200 200">
            <polygon points="100,20 173,55 173,145 100,180 27,145 27,55" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="1"/>
            <polygon points="100,45 155,70 155,130 100,155 45,130 45,70" fill="none" stroke="rgba(255,255,255,0.03)" strokeWidth="1"/>
            <polygon points="100,30 160,65 145,135 100,165 40,125 45,60" fill="rgba(168,85,247,0.12)" stroke="rgba(168,85,247,0.6)" strokeWidth="1.5"/>
            <text x="100" y="14" textAnchor="middle" fill="rgba(255,255,255,0.35)" fontSize="7" fontFamily="JetBrains Mono">深度</text>
            <text x="183" y="55" textAnchor="start" fill="rgba(255,255,255,0.35)" fontSize="7" fontFamily="JetBrains Mono">广度</text>
            <text x="183" y="148" textAnchor="start" fill="rgba(255,255,255,0.35)" fontSize="7" fontFamily="JetBrains Mono">关联</text>
            <text x="100" y="196" textAnchor="middle" fill="rgba(255,255,255,0.35)" fontSize="7" fontFamily="JetBrains Mono">表达</text>
            <text x="17" y="148" textAnchor="end" fill="rgba(255,255,255,0.35)" fontSize="7" fontFamily="JetBrains Mono">应用</text>
            <text x="17" y="55" textAnchor="end" fill="rgba(255,255,255,0.35)" fontSize="7" fontFamily="JetBrains Mono">批判</text>
          </svg>
        </div>
        <div className="hud-line mb-3"></div>
        <div className="space-y-2">
          <div><div className="flex justify-between mono mb-0.5" style={{ fontSize: 'var(--f8)' }}><span className="opacity-35">理解深度</span><span className="text-purple-400">0.85</span></div><div className="cognition-skill-bar"><div className="cognition-skill-fill bg-purple-500" style={{ width: '85%' }}></div></div></div>
          <div><div className="flex justify-between mono mb-0.5" style={{ fontSize: 'var(--f8)' }}><span className="opacity-35">知识广度</span><span className="text-cyan-400">0.72</span></div><div className="cognition-skill-bar"><div className="cognition-skill-fill bg-cyan-400" style={{ width: '72%' }}></div></div></div>
          <div><div className="flex justify-between mono mb-0.5" style={{ fontSize: 'var(--f8)' }}><span className="opacity-35">关联能力</span><span className="text-pink-400">0.68</span></div><div className="cognition-skill-bar"><div className="cognition-skill-fill bg-pink-400" style={{ width: '68%' }}></div></div></div>
          <div><div className="flex justify-between mono mb-0.5" style={{ fontSize: 'var(--f8)' }}><span className="opacity-35">表达清晰度</span><span className="text-purple-400">0.91</span></div><div className="cognition-skill-bar"><div className="cognition-skill-fill bg-purple-400" style={{ width: '91%' }}></div></div></div>
        </div>
      </div>
      <div className="glass-panel p-4 rounded-2xl">
        <span className="mono opacity-40 uppercase block mb-3" style={{ fontSize: 'var(--f10)' }}>Learning_Stats</span>
        <div className="grid grid-cols-2 gap-3">
          <div className="text-center"><span className="serif font-bold text-purple-400" style={{ fontSize: 'var(--t-title)' }}>13</span><span className="mono opacity-25 block" style={{ fontSize: 'var(--f7)' }}>天连续</span></div>
          <div className="text-center"><span className="serif font-bold text-cyan-400" style={{ fontSize: 'var(--t-title)' }}>47</span><span className="mono opacity-25 block" style={{ fontSize: 'var(--f7)' }}>已掌握</span></div>
          <div className="text-center"><span className="serif font-bold text-pink-400" style={{ fontSize: 'var(--t-title)' }}>8</span><span className="mono opacity-25 block" style={{ fontSize: 'var(--f7)' }}>待复习</span></div>
          <div className="text-center"><span className="serif font-bold text-white/50" style={{ fontSize: 'var(--t-title)' }}>156</span><span className="mono opacity-25 block" style={{ fontSize: 'var(--f7)' }}>对话轮次</span></div>
        </div>
      </div>
      <div className="glass-panel p-4 rounded-2xl">
        <span className="mono opacity-40 uppercase block mb-2" style={{ fontSize: 'var(--f10)' }}>Active_Skills</span>
        <div className="flex flex-wrap gap-1.5">
          <span className="px-2 py-1 bg-purple-500/10 mono rounded text-purple-300/70" style={{ fontSize: 'var(--f8)' }}>费曼技巧</span>
          <span className="px-2 py-1 bg-white/5 mono rounded text-white/40" style={{ fontSize: 'var(--f8)' }}>系统思维</span>
          <span className="px-2 py-1 bg-white/5 mono rounded text-white/40" style={{ fontSize: 'var(--f8)' }}>概念映射</span>
          <span className="px-2 py-1 bg-cyan-500/10 mono rounded text-cyan-300/70" style={{ fontSize: 'var(--f8)' }}>苏格拉底提问</span>
        </div>
      </div>
    </aside>
  )
}
