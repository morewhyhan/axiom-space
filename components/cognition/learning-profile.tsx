'use client'

import { useAppStore } from '@/stores/mode-store'

export default function LearningProfile() {
  const { openModal } = useAppStore()

  return (
    <aside className="side-slot visible cognition-panel flex-1 flex-col pointer-events-auto" style={{ maxWidth: 'var(--panel-xl)' }}>
      <div className="glass-panel p-5 rounded-2xl flex-1 flex flex-col overflow-y-auto no-scrollbar">
        {/* User header */}
        <div className="flex items-center gap-4 mb-4">
          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-purple-500/30 to-cyan-500/30 border border-white/10 flex items-center justify-center flex-shrink-0">
            <span className="serif text-base">W</span>
          </div>
          <div className="flex-1">
            <div className="text-sm font-medium">学习者 #041</div>
            <div className="mono opacity-30" style={{ fontSize: 'var(--f8)' }}>Joined 2026-03-15 · 42 sessions · 13 天连续</div>
          </div>
          <button className="mono text-purple-400/50 hover:text-purple-400" style={{ fontSize: 'var(--f8)' }} onClick={() => openModal('profile')}>FULL PROFILE →</button>
        </div>

        {/* Thinking pattern + Strengths */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="col-span-2 bg-white/5 rounded-xl p-4 border border-white/5">
            <span className="mono text-purple-400 uppercase block mb-2" style={{ fontSize: 'var(--f9)' }}>Thinking_Pattern</span>
            <p className="text-white/50 leading-relaxed" style={{ fontSize: 'var(--f10)' }}>倾向于通过<span className="text-white/80">类比和跨域关联</span>来理解新概念。在「复杂系统」领域表现出较强的系统性思维，但在「信息论」中容易停留在定义层面，缺少深层推演。</p>
          </div>
          <div className="bg-white/5 rounded-xl p-4 border border-white/5 space-y-2">
            <div><span className="mono text-cyan-400 uppercase block mb-1" style={{ fontSize: 'var(--f8)' }}>Strengths</span>
              <div className="flex flex-wrap gap-1">
                <span className="px-1.5 py-0.5 bg-cyan-500/10 text-cyan-300/70 mono rounded" style={{ fontSize: 'var(--f7)' }}>跨域关联</span>
                <span className="px-1.5 py-0.5 bg-cyan-500/10 text-cyan-300/70 mono rounded" style={{ fontSize: 'var(--f7)' }}>表达清晰</span>
                <span className="px-1.5 py-0.5 bg-cyan-500/10 text-cyan-300/70 mono rounded" style={{ fontSize: 'var(--f7)' }}>实例构建</span>
              </div>
            </div>
            <div><span className="mono text-pink-400 uppercase block mb-1" style={{ fontSize: 'var(--f8)' }}>Growth_Edges</span>
              <div className="flex flex-wrap gap-1">
                <span className="px-1.5 py-0.5 bg-pink-500/10 text-pink-300/70 mono rounded" style={{ fontSize: 'var(--f7)' }}>数学推导</span>
                <span className="px-1.5 py-0.5 bg-pink-500/10 text-pink-300/70 mono rounded" style={{ fontSize: 'var(--f7)' }}>批判性验证</span>
              </div>
            </div>
          </div>
        </div>

        {/* Time distribution */}
        <div className="glass-panel p-3 rounded-lg mb-4 bg-white/5 border border-white/5">
          <span className="mono opacity-40 uppercase block mb-2" style={{ fontSize: 'var(--f9)' }}>Time_Distribution</span>
          <div className="grid grid-cols-5 gap-2">
            <div className="text-center"><span className="mono text-purple-300/80" style={{ fontSize: 'var(--f7)' }}>热力学</span><span className="mono text-white/60 block" style={{ fontSize: 'var(--f9)' }}>34h</span></div>
            <div className="text-center"><span className="mono text-cyan-300/80" style={{ fontSize: 'var(--f7)' }}>复杂系统</span><span className="mono text-white/60 block" style={{ fontSize: 'var(--f9)' }}>22h</span></div>
            <div className="text-center"><span className="mono text-pink-300/80" style={{ fontSize: 'var(--f7)' }}>信息论</span><span className="mono text-white/60 block" style={{ fontSize: 'var(--f9)' }}>18h</span></div>
            <div className="text-center"><span className="mono opacity-50" style={{ fontSize: 'var(--f7)' }}>社会学</span><span className="mono text-white/60 block" style={{ fontSize: 'var(--f9)' }}>12h</span></div>
            <div className="text-center"><span className="mono opacity-50" style={{ fontSize: 'var(--f7)' }}>生物学</span><span className="mono text-white/60 block" style={{ fontSize: 'var(--f9)' }}>8h</span></div>
          </div>
        </div>

        {/* Knowledge structure tree */}
        <div className="flex-1 overflow-hidden flex flex-col">
          <span className="mono opacity-40 uppercase block mb-2" style={{ fontSize: 'var(--f10)' }}>Knowledge_Structure</span>
          <div className="flex-1 overflow-y-auto no-scrollbar space-y-1 mono bg-white/5 rounded-xl p-4 border border-white/5" style={{ fontSize: 'var(--f10)' }}>
            <div className="flex items-center gap-2 text-purple-400 font-medium"><span style={{ fontSize: 'var(--f8)' }}>●</span> 耗散结构 <span className="mono opacity-30 ml-auto" style={{ fontSize: 'var(--f7)' }}>85%</span></div>
            <div className="concept-tree-item text-white/55">热力学第二定律 <span className="mono opacity-20 ml-1" style={{ fontSize: 'var(--f7)' }}>✓</span></div>
            <div className="concept-tree-item text-white/55">熵</div>
            <div className="concept-tree-item text-cyan-400/70">负熵流 <span className="mono text-cyan-400/50 ml-1" style={{ fontSize: 'var(--f7)' }}>← 当前</span></div>
            <div className="concept-tree-item text-white/30">信息熵</div>
            <div className="flex items-center gap-2 text-purple-400 font-medium mt-3"><span style={{ fontSize: 'var(--f8)' }}>●</span> 复杂系统 <span className="mono opacity-30 ml-auto" style={{ fontSize: 'var(--f7)' }}>72%</span></div>
            <div className="concept-tree-item text-white/55">涌现</div>
            <div className="concept-tree-item text-cyan-400/70">自组织临界性</div>
            <div className="concept-tree-item text-white/30">贝纳德对流</div>
            <div className="flex items-center gap-2 text-white/30 font-medium mt-3"><span className="opacity-40" style={{ fontSize: 'var(--f8)' }}>○</span> 信息论 <span className="mono opacity-20 ml-auto" style={{ fontSize: 'var(--f7)' }}>15%</span></div>
            <div className="concept-tree-item text-white/20">香农熵</div>
            <div className="concept-tree-item text-white/20">信道容量</div>
          </div>
        </div>

        {/* Next actions */}
        <div className="mt-3 bg-purple-900/10 border border-purple-500/15 p-3 rounded-xl">
          <span className="mono text-purple-400 uppercase block mb-1.5" style={{ fontSize: 'var(--f8)' }}>&gt;&gt; Next_Action</span>
          <div className="space-y-1">
            <div className="mono text-white/60 hover:text-white cursor-pointer transition-colors" style={{ fontSize: 'var(--f10)' }}>巩固「信息熵」数学基础 — 完成信息论分支</div>
            <div className="mono text-white/60 hover:text-white cursor-pointer transition-colors" style={{ fontSize: 'var(--f10)' }}>关联「耗散结构」→「社会学」 — 建立跨域连接</div>
          </div>
        </div>
      </div>
    </aside>
  )
}
