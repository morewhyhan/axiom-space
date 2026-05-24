'use client'

import { useState, useEffect } from 'react'
import { useLearningPaths } from '@/hooks/use-learning'

export default function LearnList() {
  const { data, loading } = useLearningPaths()
  const paths = data?.paths ?? []
  const activePathId = data?.activePath

  // Track current selected path
  const [currentPathId, setCurrentPathId] = useState<string | null>(activePathId)

  useEffect(() => {
    if (activePathId && !currentPathId) setCurrentPathId(activePathId)
  }, [activePathId, currentPathId])

  const currentPath = paths.find(p => p.id === currentPathId) ?? paths[0]
  const steps = currentPath?.steps ?? []
  const doneCount = currentPath?.doneCount ?? 0
  const totalSteps = currentPath?.totalCount ?? 0
  const progress = currentPath?.progress ?? 0

  return (
    <aside className="side-slot visible learn-panel flex-1 flex-col pointer-events-auto" style={{ maxWidth: 'var(--panel-xl)' }}>
      <div className="glass-panel p-5 rounded-2xl flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex justify-between items-center mb-4">
          <span className="mono text-red-400 uppercase tracking-widest" style={{ fontSize: 'var(--f9)' }}>Path_Plan</span>
          <div className="flex items-center gap-2">
            {/* Path selector */}
            {paths.length > 1 && (
              <select
                className="bg-white/5 border border-white/10 rounded px-2 py-1 mono text-white/60 outline-none cursor-pointer"
                style={{ fontSize: 'var(--f8)' }}
                value={currentPathId ?? ''}
                onChange={e => setCurrentPathId(e.target.value)}
              >
                {paths.map(p => (
                  <option key={p.id} value={p.id} style={{ background: '#111' }}>{p.name}</option>
                ))}
              </select>
            )}
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
          {loading ? (
            <div className="flex-1 flex items-center justify-center py-8">
              <div className="mono text-white/30" style={{ fontSize: 'var(--f10)' }}>加载学习路径...</div>
            </div>
          ) : steps.length > 0 ? (
            steps.map((step) => (
              <div
                key={step.id}
                className={`flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
                  step.status === 'active' ? 'bg-red-500/10 border border-red-500/20' :
                  step.status === 'done' ? 'bg-white/3' : 'hover:bg-white/3'
                }`}
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
              </div>
            ))
          ) : (
            <div className="flex-1 flex items-center justify-center py-8">
              <div className="text-center">
                <div className="mono text-white/20" style={{ fontSize: 'var(--f10)' }}>暂无学习路径</div>
                <div className="mono text-white/15 mt-1" style={{ fontSize: 'var(--f8)' }}>创建知识卡片后，路径将自动生成</div>
              </div>
            </div>
          )}
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
            }}>显示路径</button>
          </div>
        </div>
      </div>
    </aside>
  )
}
