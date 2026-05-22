'use client'

import { useState } from 'react'

export default function ForgeEditor() {
  const [editorMode, setEditorMode] = useState<'live' | 'read'>('live')
  const sampleContent = `# 耗散结构与社会熵增

## 01 定义
远离平衡态的开放系统，通过与外部环境交换物质和能量，
在内部产生负熵流，从而维持有序结构。

## 02 举例
- 城市系统：持续输入食物/能源，输出废料/产品
- 生命体：新陈代谢维持低熵有序状态
- [[贝纳德对流]]：液体加热后出现的规则六角形对流

## 03 关联
- [[热力学第二定律]] — 封闭系统熵增 vs 开放系统负熵
- [[自组织临界性]] — 复杂系统的涌现行为
- [[普利高津]] — 理论提出者

## 04 应用
用耗散结构的视角看社会：官僚体系如果不与外界交换信息，
就会趋向熵增（僵化）→ 需要开放交流和变革来维持活力。`

  return (
    <aside className="side-slot visible forge-panel flex-1 flex-col pointer-events-auto" style={{ maxWidth: 'var(--panel-xl)', minWidth: 'var(--panel-lg)' }}>
      <div className="glass-panel rounded-2xl flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex justify-between items-center px-5 py-3 border-b border-white/10">
          <div className="flex items-center gap-4">
            <span className="mono opacity-40 uppercase" style={{ fontSize: 'var(--f9)' }}>Editing</span>
            <span className="text-white/70" style={{ fontSize: 'var(--t-label)' }}>耗散结构与社会熵增</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex bg-white/5 rounded-lg p-0.5">
              <button className={`editor-mode-tab ${editorMode === 'live' ? 'active' : ''}`} onClick={() => setEditorMode('live')}>LIVE</button>
              <button className={`editor-mode-tab ${editorMode === 'read' ? 'active' : ''}`} onClick={() => setEditorMode('read')}>READ</button>
            </div>
            <button className="mono bg-pink-500/20 text-pink-300 px-3 py-1 rounded border border-pink-500/30 hover:bg-pink-500/30 transition-colors" style={{ fontSize: 'var(--f9)' }}>FORGE →</button>
          </div>
        </div>
        {/* Status bar */}
        <div className="px-5 py-2 border-b border-white/5 flex items-center gap-4">
          <div className="flex items-center gap-1.5"><span className="mono opacity-25 uppercase" style={{ fontSize: 'var(--f7)' }}>Words</span><span className="mono text-white/60" style={{ fontSize: 'var(--f9)' }}>847</span></div>
          <div className="w-px h-3 bg-white/5"></div>
          <div className="flex items-center gap-1.5"><span className="mono opacity-25 uppercase" style={{ fontSize: 'var(--f7)' }}>Links</span><span className="mono text-white/60" style={{ fontSize: 'var(--f9)' }}>21</span></div>
          <div className="w-px h-3 bg-white/5"></div>
          <div className="flex items-center gap-1.5"><span className="mono opacity-25 uppercase" style={{ fontSize: 'var(--f7)' }}>Polish</span><span className="mono text-pink-400/70" style={{ fontSize: 'var(--f8)' }}>permanent</span></div>
          <div className="w-px h-3 bg-white/5"></div>
          <div className="flex items-center gap-1.5"><span className="mono opacity-25 uppercase" style={{ fontSize: 'var(--f7)' }}>Review</span><span className="mono text-cyan-400" style={{ fontSize: 'var(--f9)' }}>0.88</span></div>
        </div>
        {/* Editor content */}
        {editorMode === 'live' ? (
          <div className="flex-1 p-0 overflow-hidden">
            <textarea className="forge-editor" defaultValue={sampleContent} />
          </div>
        ) : (
          <div className="flex-1 p-8 overflow-y-auto no-scrollbar">
            <div className="max-w-2xl mx-auto">
              <div className="mono text-purple-400 uppercase mb-2" style={{ fontSize: 'var(--f8)' }}>Permanent Card</div>
              <h1 className="serif font-bold mb-6" style={{ fontSize: 'var(--t-sub)' }}>耗散结构与社会熵增</h1>
              <h2 className="mono text-purple-400/80 uppercase mb-3" style={{ fontSize: 'var(--f10)' }}>01 定义</h2>
              <p className="leading-relaxed text-white/70 mb-6" style={{ fontSize: 'var(--t-body)' }}>远离平衡态的开放系统，通过与外部环境交换物质和能量，在内部产生负熵流，从而维持有序结构。</p>
              <h2 className="mono text-purple-400/80 uppercase mb-3" style={{ fontSize: 'var(--f10)' }}>02 举例</h2>
              <ul className="leading-relaxed text-white/70 mb-6 space-y-2 list-disc list-inside" style={{ fontSize: 'var(--t-body)' }}>
                <li>城市系统：持续输入食物/能源，输出废料/产品</li>
                <li>生命体：新陈代谢维持低熵有序状态</li>
                <li><span className="text-purple-400 underline cursor-pointer">贝纳德对流</span>：液体加热后出现的规则六角形对流</li>
              </ul>
              <h2 className="mono text-purple-400/80 uppercase mb-3" style={{ fontSize: 'var(--f10)' }}>03 关联</h2>
              <div className="leading-relaxed text-white/70 mb-6 space-y-1" style={{ fontSize: 'var(--t-body)' }}>
                <div>→ <span className="text-purple-400 underline cursor-pointer">热力学第二定律</span> — 封闭系统熵增 vs 开放系统负熵</div>
                <div>→ <span className="text-purple-400 underline cursor-pointer">自组织临界性</span> — 复杂系统的涌现行为</div>
              </div>
              <div className="flex flex-wrap gap-2 mt-8 pt-6 border-t border-white/5">
                <span className="px-2 py-0.5 bg-purple-500/15 text-purple-300 mono rounded" style={{ fontSize: 'var(--f9)' }}>Thermodynamics</span>
                <span className="px-2 py-0.5 bg-cyan-500/15 text-cyan-300 mono rounded" style={{ fontSize: 'var(--f9)' }}>Complexity</span>
              </div>
            </div>
          </div>
        )}
        {/* Forge review history */}
        <div className="px-5 py-3 border-t border-white/5">
          <details className="cursor-pointer">
            <summary className="mono opacity-30 uppercase tracking-widest hover:opacity-50 transition-opacity" style={{ fontSize: 'var(--f8)' }}>Forge_Review_History (2)</summary>
            <div className="mt-2 space-y-2">
              <div className="bg-white/5 rounded-lg p-2.5 border border-white/5">
                <div className="flex justify-between items-center mb-1">
                  <span className="mono text-cyan-400" style={{ fontSize: 'var(--f7)' }}>2026-05-18</span>
                  <span className="mono text-green-400/80" style={{ fontSize: 'var(--f7)' }}>✓ 通过</span>
                </div>
                <div className="flex gap-3 mono opacity-40" style={{ fontSize: 'var(--f7)' }}>
                  <span>定义 0.88</span><span>关联 0.79</span><span>实例 0.85</span><span>表达 0.91</span>
                </div>
                <div className="text-white/35 mt-1" style={{ fontSize: 'var(--f8)' }}>实例丰富，建议补充数学判据</div>
              </div>
              <div className="bg-white/5 rounded-lg p-2.5 border border-white/5">
                <div className="flex justify-between items-center mb-1">
                  <span className="mono text-cyan-400" style={{ fontSize: 'var(--f7)' }}>2026-05-15</span>
                  <span className="mono text-green-400/80" style={{ fontSize: 'var(--f7)' }}>✓ 通过</span>
                </div>
                <div className="flex gap-3 mono opacity-40" style={{ fontSize: 'var(--f7)' }}>
                  <span>定义 0.82</span><span>关联 0.71</span><span>实例 0.80</span><span>表达 0.88</span>
                </div>
                <div className="text-white/35 mt-1" style={{ fontSize: 'var(--f8)' }}>定义清晰，关联可以更丰富</div>
              </div>
            </div>
          </details>
        </div>
      </div>
    </aside>
  )
}
