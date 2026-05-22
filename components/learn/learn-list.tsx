'use client'

import { useState } from 'react'

const mockSteps = [
  { index: 1, name: '热力学第二定律', status: 'done', desc: '理解封闭系统的熵增原理', mastery: 92 },
  { index: 2, name: '熵', status: 'done', desc: '掌握熵的统计力学定义', mastery: 85 },
  { index: 3, name: '耗散结构', status: 'active', desc: '开放系统的负熵流与有序结构', mastery: 60 },
  { index: 4, name: '负熵流', status: 'pending', desc: '理解 Prigogine 理论核心', mastery: 0 },
  { index: 5, name: '自组织临界性', status: 'pending', desc: '复杂系统的涌现行为', mastery: 0 },
  { index: 6, name: '涌现', status: 'pending', desc: '从微观到宏观的质变', mastery: 0 },
  { index: 7, name: '信息熵', status: 'pending', desc: 'Shannon 信息理论的桥梁', mastery: 0 },
  { index: 8, name: '系统思维', status: 'pending', desc: '跨域关联与整体视角', mastery: 0 },
]

export default function LearnList() {
  const [currentStep, setCurrentStep] = useState(2)
  const doneCount = mockSteps.filter(s => s.status === 'done').length
  const totalSteps = mockSteps.length
  const progress = Math.round((doneCount / totalSteps) * 100)

  return (
    <aside className="side-slot visible learn-panel flex-1 flex-col pointer-events-auto" style={{ maxWidth: 'var(--panel-xl)' }}>
      <div className="glass-panel p-5 rounded-2xl flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex justify-between items-center mb-4">
          <span className="mono text-red-400 uppercase tracking-widest" style={{ fontSize: 'var(--f9)' }}>Path_Plan</span>
          <div className="flex items-center gap-2">
            <span className="mono opacity-30" style={{ fontSize: 'var(--f8)' }}>{doneCount}/{totalSteps}</span>
          </div>
        </div>

        {/* Progress bar */}
        <div className="mb-4">
          <div className="flex justify-between mb-1">
            <span className="mono opacity-25 uppercase" style={{ fontSize: 'var(--f7)' }}>Progress</span>
            <span className="mono text-red-400" style={{ fontSize: 'var(--f8)' }}>{progress}%</span>
          </div>
          <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all duration-500" style={{ width: `${progress}%`, background: 'linear-gradient(90deg, #ff2244, #ff6688)' }}></div>
          </div>
        </div>

        {/* Step list */}
        <div className="flex-1 overflow-y-auto no-scrollbar space-y-1">
          {mockSteps.map((step) => (
            <div
              key={step.index}
              className={`flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
                step.status === 'active' ? 'bg-red-500/10 border border-red-500/20' :
                step.status === 'done' ? 'bg-white/3' : 'hover:bg-white/3'
              }`}
              onClick={() => {
                if (step.status !== 'done') {
                  setCurrentStep(step.index - 1)
                }
              }}
            >
              {/* Step indicator */}
              <div className="flex-shrink-0 mt-0.5">
                {step.status === 'done' ? (
                  <div className="w-6 h-6 rounded-full bg-green-500/20 border border-green-500/30 flex items-center justify-center">
                    <span style={{ fontSize: 'var(--f7)', color: '#34d399' }}>✓</span>
                  </div>
                ) : step.status === 'active' ? (
                  <div className="w-6 h-6 rounded-full bg-red-500/20 border border-red-500/40 flex items-center justify-center">
                    <span className="mono font-bold" style={{ fontSize: 'var(--f7)', color: '#ff4466' }}>{step.index}</span>
                  </div>
                ) : (
                  <div className="w-6 h-6 rounded-full bg-white/5 border border-white/10 flex items-center justify-center">
                    <span className="mono opacity-30" style={{ fontSize: 'var(--f7)' }}>{step.index}</span>
                  </div>
                )}
              </div>

              {/* Step content */}
              <div className="flex-1 min-w-0">
                <div className="flex justify-between items-center">
                  <span className={`font-medium truncate ${step.status === 'done' ? 'text-white/50' : step.status === 'active' ? 'text-white/80' : 'text-white/40'}`} style={{ fontSize: 'var(--t-label)' }}>{step.name}</span>
                  {step.mastery > 0 && (
                    <span className={`mono flex-shrink-0 ml-2 ${step.mastery >= 80 ? 'text-green-400/70' : step.mastery >= 50 ? 'text-yellow-400/70' : 'text-red-400/50'}`} style={{ fontSize: 'var(--f7)' }}>{step.mastery}%</span>
                  )}
                </div>
                <span className="mono opacity-25 block mt-0.5 truncate" style={{ fontSize: 'var(--f7)' }}>{step.desc}</span>
                {step.status === 'active' && (
                  <div className="mt-2">
                    <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                      <div className="h-full bg-red-500/50 rounded-full" style={{ width: `${step.mastery}%` }}></div>
                    </div>
                  </div>
                )}
              </div>

              {/* Connector line (not on last item) */}
            </div>
          ))}
        </div>

        {/* Bottom actions */}
        <div className="mt-3 pt-3 border-t border-white/5">
          <div className="flex gap-2">
            <button className="axiom-btn flex-1 text-center" style={{ background: 'rgba(255,34,68,0.15)', borderColor: 'rgba(255,34,68,0.3)', color: '#ff4466', fontSize: 'var(--f8)' }} onClick={() => {
              const w = window as unknown as Record<string, unknown>
              if (w.__toggleLearningPath) (w.__toggleLearningPath as () => void)()
            }}>在星系中查看路径</button>
            <button className="axiom-btn" style={{ fontSize: 'var(--f8)' }} onClick={() => {
              const w = window as unknown as Record<string, unknown>
              if (w.__toggleLearningPath) {
                if (!(w.__isLearningPathVisible as () => boolean)()) {
                  (w.__toggleLearningPath as () => void)()
                }
              }
            }}>重置</button>
          </div>
        </div>
      </div>
    </aside>
  )
}
