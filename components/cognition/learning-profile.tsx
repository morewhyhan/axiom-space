'use client'

import React from 'react'
import { useCognition } from '@/hooks/use-cognition'
import { useDashboardStats } from '@/hooks/use-dashboard'
import { useAppStore } from '@/stores/mode-store'

export default function LearningProfile() {
  const { openModal } = useAppStore()
  const { data, loading } = useCognition()
  const { stats } = useDashboardStats()

  const user = data?.user
  const thinkingPattern = data?.thinkingPattern ?? { text: '开始创建知识卡片以构建你的认知画像。', highlights: [], detail: '' }
  const strengths = data?.strengths ?? ['持续学习中']
  const growthEdges = data?.growthEdges ?? ['探索新领域']
  const timeDistribution = data?.timeDistribution ?? []
  const knowledgeStructure = data?.knowledgeStructure ?? []
  const nextActions = data?.nextActions ?? ['创建新知识卡片以开始学习之旅']
  const userName = user?.name ?? '学习者'
  const userInitial = userName.charAt(0).toUpperCase()
  const joinedAt = user?.joinedAt ? new Date(user.joinedAt).toISOString().slice(0, 10) : '—'
  const totalSessions = stats?.totalNodes ?? 0

  return (
    <aside className="side-slot visible cognition-panel flex-1 flex-col pointer-events-auto" style={{ maxWidth: 'var(--panel-xl)' }}>
      <div className="glass-panel p-5 rounded-2xl flex-1 flex flex-col overflow-y-auto no-scrollbar">
        {/* User header */}
        <div className="flex items-center gap-4 mb-4">
          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-purple-500/30 to-cyan-500/30 border border-white/10 flex items-center justify-center flex-shrink-0">
            <span className="serif text-base">{userInitial}</span>
          </div>
          <div className="flex-1">
            <div className="text-sm font-medium">{loading ? '加载中...' : userName}</div>
            <div className="mono opacity-30" style={{ fontSize: 'var(--f8)' }}>Joined {joinedAt} · {totalSessions} nodes</div>
          </div>
          <button className="mono text-purple-400/50 hover:text-purple-400" style={{ fontSize: 'var(--f8)' }} onClick={() => openModal('profile')}>FULL PROFILE →</button>
        </div>

        {/* Thinking pattern + Strengths */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="col-span-2 bg-white/5 rounded-xl p-4 border border-white/5">
            <span className="mono text-purple-400 uppercase block mb-2" style={{ fontSize: 'var(--f9)' }}>Thinking_Pattern</span>
            {loading ? (
              <p className="text-white/30 leading-relaxed" style={{ fontSize: 'var(--f10)' }}>分析中...</p>
            ) : (
              <p className="text-white/50 leading-relaxed" style={{ fontSize: 'var(--f10)' }}>
                {thinkingPattern.highlights?.length > 0
                  ? (() => {
                      let parts: React.ReactNode[] = [thinkingPattern.text]
                      for (const hl of thinkingPattern.highlights) {
                        const next: React.ReactNode[] = []
                        for (const part of parts) {
                          if (typeof part !== 'string') { next.push(part); continue }
                          const idx = part.indexOf(hl)
                          if (idx === -1) { next.push(part); continue }
                          next.push(part.slice(0, idx))
                          next.push(<span key={hl} className="text-white/80">{hl}</span>)
                          next.push(part.slice(idx + hl.length))
                        }
                        parts = next
                      }
                      return parts
                    })()
                  : thinkingPattern.text}
                {thinkingPattern.detail && <span className="text-white/30"> {thinkingPattern.detail}</span>}
              </p>
            )}
          </div>
          <div className="bg-white/5 rounded-xl p-4 border border-white/5 space-y-2">
            <div><span className="mono text-cyan-400 uppercase block mb-1" style={{ fontSize: 'var(--f8)' }}>Strengths</span>
              <div className="flex flex-wrap gap-1">
                {strengths.map(s => (
                  <span key={s} className="px-1.5 py-0.5 bg-cyan-500/10 text-cyan-300/70 mono rounded" style={{ fontSize: 'var(--f7)' }}>{s}</span>
                ))}
              </div>
            </div>
            <div><span className="mono text-pink-400 uppercase block mb-1" style={{ fontSize: 'var(--f8)' }}>Growth_Edges</span>
              <div className="flex flex-wrap gap-1">
                {growthEdges.map(g => (
                  <span key={g} className="px-1.5 py-0.5 bg-pink-500/10 text-pink-300/70 mono rounded" style={{ fontSize: 'var(--f7)' }}>{g}</span>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Time distribution */}
        <div className="glass-panel p-3 rounded-lg mb-4 bg-white/5 border border-white/5">
          <span className="mono opacity-40 uppercase block mb-2" style={{ fontSize: 'var(--f9)' }}>Time_Distribution</span>
          {loading ? (
            <div className="mono text-white/20 text-center" style={{ fontSize: 'var(--f9)' }}>加载中...</div>
          ) : timeDistribution.length > 0 ? (
            <div className={`grid gap-2`} style={{ gridTemplateColumns: `repeat(${Math.min(timeDistribution.length, 5)}, 1fr)` }}>
              {timeDistribution.slice(0, 5).map(td => (
                <div key={td.domain} className="text-center">
                  <span className="mono" style={{ fontSize: 'var(--f7)', color: td.color || 'rgba(255,255,255,0.5)' }}>{td.domain}</span>
                  <span className="mono text-white/60 block" style={{ fontSize: 'var(--f9)' }}>{td.hours}h</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="mono text-white/20 text-center" style={{ fontSize: 'var(--f9)' }}>暂无数据</div>
          )}
        </div>

        {/* Knowledge structure tree */}
        <div className="flex-1 overflow-hidden flex flex-col">
          <span className="mono opacity-40 uppercase block mb-2" style={{ fontSize: 'var(--f10)' }}>Knowledge_Structure</span>
          <div className="flex-1 overflow-y-auto no-scrollbar space-y-1 mono bg-white/5 rounded-xl p-4 border border-white/5" style={{ fontSize: 'var(--f10)' }}>
            {loading ? (
              <div className="text-white/20">加载中...</div>
            ) : knowledgeStructure.length > 0 ? (
              knowledgeStructure.map(cl => (
                <div key={cl.name}>
                  <div className="flex items-center gap-2 font-medium mt-2 first:mt-0" style={{ color: cl.color || 'rgba(168,85,247,1)' }}>
                    <span style={{ fontSize: 'var(--f8)' }}>●</span>
                    <span>{cl.name}</span>
                    <span className="mono opacity-30 ml-auto" style={{ fontSize: 'var(--f7)' }}>{Math.round(cl.progress * 100)}%</span>
                  </div>
                  {cl.children.map(child => (
                    <div key={child.name} className={`concept-tree-item ${child.status === 'active' ? 'text-cyan-400/70' : child.status === 'done' ? 'text-white/55' : 'text-white/30'}`}>
                      {child.name}
                      {child.status === 'done' && <span className="mono opacity-20 ml-1" style={{ fontSize: 'var(--f7)' }}>✓</span>}
                      {child.status === 'active' && <span className="mono text-cyan-400/50 ml-1" style={{ fontSize: 'var(--f7)' }}>← 当前</span>}
                    </div>
                  ))}
                </div>
              ))
            ) : (
              <div className="text-white/20">创建知识卡片以构建知识结构</div>
            )}
          </div>
        </div>

        {/* Next actions */}
        <div className="mt-3 bg-purple-900/10 border border-purple-500/15 p-3 rounded-xl">
          <span className="mono text-purple-400 uppercase block mb-1.5" style={{ fontSize: 'var(--f8)' }}>&gt;&gt; Next_Action</span>
          <div className="space-y-1">
            {nextActions.map(action => (
              <div key={action} className="mono text-white/60 hover:text-white cursor-pointer transition-colors" style={{ fontSize: 'var(--f10)' }} onClick={() => {
                // 导航到对应的模式
                const modeMap: Record<string, string> = {
                  'forge': 'forge',
                  '学习': 'learn',
                  'galaxy': 'galaxy',
                  '探索': 'galaxy',
                }
                const targetMode = modeMap[action] || 'forge'
                useAppStore.getState().setMode(targetMode as any)
              }}>{action}</div>
            ))}
          </div>
        </div>
      </div>
    </aside>
  )
}
