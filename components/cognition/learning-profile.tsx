'use client'

import React, { useState } from 'react'
import { useCognition } from '@/hooks/use-cognition'
import { useDashboardStats } from '@/hooks/use-dashboard'
import { useAppStore } from '@/stores/mode-store'
import type { Mode } from '@/stores/mode-store'

const DIM_LABELS: Record<string, string> = {
  depth: '理解深度',
  breadth: '知识广度',
  connection: '关联能力',
  expression: '表达清晰度',
  application: '应用能力',
}

export default function LearningProfile() {
  const openModal = useAppStore((s) => s.openModal)
  const { data, loading } = useCognition()
  const { stats } = useDashboardStats()
  const [timeDistCollapsed, setTimeDistCollapsed] = useState(true)

  const dimensions = data?.dimensions ?? { depth: 0, breadth: 0, connection: 0, expression: 0, application: 0 }
  const cognitionStats = data?.stats ?? { streakDays: 0, mastered: 0, pendingReview: 0, chatRounds: 0 }
  const skills = data?.skills ?? []
  const thinkingPattern = data?.thinkingPattern
  const strengths = data?.strengths ?? []
  const growthEdges = data?.growthEdges ?? []
  const timeDistribution = data?.timeDistribution ?? []
  const knowledgeStructure = data?.knowledgeStructure ?? []
  const nextActions = data?.nextActions ?? []
  const totalCards = cognitionStats.mastered + cognitionStats.pendingReview
  const isEmpty = totalCards === 0

  return (
    <aside className="side-slot visible cognition-panel flex-1 flex-col pointer-events-auto" style={{ maxWidth: 'var(--panel-xl)' }}>
      <div className="glass-panel p-5 rounded-2xl flex-1 flex flex-col overflow-y-auto no-scrollbar">
        {/* ── 认知维度 ── */}
        <div className="mb-4 bg-white/5 rounded-xl p-3 border border-white/5">
          <span className="mono opacity-40 uppercase block mb-2" style={{ fontSize: 'var(--f9)' }}>认知维度</span>
          <div className="space-y-2">
            {Object.entries(dimensions).map(([key, value]) => {
              const pct = Math.round((value as number) * 100)
              const barColor = pct >= 60 ? 'from-cyan-500/60 to-cyan-400/40' : pct >= 30 ? 'from-purple-500/50 to-purple-400/30' : 'from-white/10 to-white/5'
              return (
                <div key={key} className="flex items-center gap-2">
                  <span className="mono text-white/40 w-16 text-right flex-shrink-0" style={{ fontSize: 'var(--f8)' }}>
                    {DIM_LABELS[key] || key}
                  </span>
                  <div className="flex-1 h-2 bg-black/30 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full bg-gradient-to-r ${barColor} transition-all duration-700`}
                      style={{ width: `${Math.max(pct, 5)}%` }}
                    />
                  </div>
                  <span className="mono text-white/30 w-8 text-right" style={{ fontSize: 'var(--f8)' }}>{pct}%</span>
                </div>
              )
            })}
          </div>
        </div>

        {/* ── 学习状态 ── */}
        {!isEmpty && (
          <div className="mb-4 bg-white/5 rounded-xl p-3 border border-white/5">
            <span className="mono opacity-40 uppercase block mb-2" style={{ fontSize: 'var(--f9)' }}>学习状态</span>
            {thinkingPattern && (
              <p className="text-white/60 leading-relaxed" style={{ fontSize: 'var(--f10)' }}>
                {thinkingPattern.detail || thinkingPattern.text}
              </p>
            )}
            {strengths.length > 0 && strengths[0] !== '持续学习中' && (
              <div className="flex flex-wrap gap-1 mt-2">
                <span className="mono text-cyan-400/60 mr-1" style={{ fontSize: 'var(--f8)' }}>擅长:</span>
                {strengths.map(s => (
                  <span key={s} className="px-1.5 py-0.5 bg-cyan-500/10 text-cyan-300/70 mono rounded" style={{ fontSize: 'var(--f7)' }}>{s}</span>
                ))}
              </div>
            )}
            {growthEdges.length > 0 && growthEdges[0] !== '探索新领域' && (
              <div className="flex flex-wrap gap-1 mt-1">
                <span className="mono text-pink-400/60 mr-1" style={{ fontSize: 'var(--f8)' }}>提升方向:</span>
                {growthEdges.map(g => (
                  <span key={g} className="px-1.5 py-0.5 bg-pink-500/10 text-pink-300/70 mono rounded" style={{ fontSize: 'var(--f7)' }}>{g}</span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── 知识域分布 ── */}
        {timeDistribution.length > 0 && (
          <div className="glass-panel p-3 rounded-lg mb-4 bg-white/5 border border-white/5">
            <button
              className="flex items-center justify-between w-full"
              onClick={() => setTimeDistCollapsed(v => !v)}
            >
              <span className="mono opacity-40 uppercase" style={{ fontSize: 'var(--f9)' }}>知识域分布</span>
              <span className="mono text-white/20 transition-transform" style={{ fontSize: 'var(--f9)', transform: timeDistCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}>▼</span>
            </button>
            {!timeDistCollapsed && (
              <div className="space-y-1.5 mt-2">
                {timeDistribution.slice(0, 6).map(td => {
                  const maxHours = Math.max(...timeDistribution.map(t => t.hours), 1)
                  const barW = Math.max((td.hours / maxHours) * 100, 8)
                  return (
                    <div key={td.domain} className="flex items-center gap-2">
                      <span className="mono text-white/50 w-20 truncate text-right" style={{ fontSize: 'var(--f8)' }}>{td.domain}</span>
                      <div className="flex-1 h-2 bg-black/30 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-700"
                          style={{ width: `${barW}%`, backgroundColor: td.color || 'rgba(168,85,247,0.5)' }}
                        />
                      </div>
                      <span className="mono text-white/30 w-10" style={{ fontSize: 'var(--f8)' }}>{td.hours}h</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* ── 知识结构 ── */}
        <div className="flex-1 overflow-hidden flex flex-col">
          <span className="mono opacity-40 uppercase block mb-2" style={{ fontSize: 'var(--f10)' }}>知识结构</span>
          <div className="flex-1 overflow-y-auto no-scrollbar space-y-1 mono bg-white/5 rounded-xl p-4 border border-white/5" style={{ fontSize: 'var(--f10)' }}>
            {loading ? (
              <div className="text-white/20">加载中...</div>
            ) : isEmpty ? (
              <div className="text-white/25 leading-relaxed">
                还没有知识卡片。<br /><br />
                在 Forge 中与 AI 对话，创建你的第一张知识卡片。
              </div>
            ) : knowledgeStructure.length > 0 ? (
              knowledgeStructure.map(cl => (
                <div key={cl.name}>
                  <div className="flex items-center gap-2 font-medium mt-2 first:mt-0" style={{ color: cl.color || 'rgba(168,85,247,1)' }}>
                    <span style={{ fontSize: 'var(--f8)' }}>●</span>
                    <span>{cl.name}</span>
                    <span className="mono opacity-30 ml-auto" style={{ fontSize: 'var(--f7)' }}>{Math.round(cl.progress * 100)}%</span>
                  </div>
                  {cl.children.map((child: any) => (
                    <div key={child.name} className={`concept-tree-item ${child.status === 'active' ? 'text-cyan-400/70' : child.status === 'done' ? 'text-white/55' : 'text-white/30'}`}>
                      {child.name}
                      {child.status === 'done' && <span className="mono opacity-20 ml-1" style={{ fontSize: 'var(--f7)' }}>✓</span>}
                      {child.status === 'active' && <span className="mono text-cyan-400/50 ml-1" style={{ fontSize: 'var(--f7)' }}>学习中</span>}
                    </div>
                  ))}
                </div>
              ))
            ) : (
              <div className="text-white/20">创建知识卡片以构建知识结构</div>
            )}
          </div>
        </div>

        {/* ── 下一步 ── */}
        <div className="mt-3 bg-purple-900/10 border border-purple-500/15 p-3 rounded-xl">
          <span className="mono text-purple-400 uppercase block mb-1.5" style={{ fontSize: 'var(--f8)' }}>建议下一步</span>
          <div className="space-y-1">
            {isEmpty ? (
              <div
                className="mono text-white/60 hover:text-white cursor-pointer transition-colors"
                style={{ fontSize: 'var(--f10)' }}
                onClick={() => useAppStore.getState().setMode('forge')}
              >
                在 Forge 中与 AI 对话，创建第一张知识卡片
              </div>
            ) : nextActions.length > 0 ? (
              nextActions.map((action: string) => (
                <div key={action} className="mono text-white/60 hover:text-white cursor-pointer transition-colors" style={{ fontSize: 'var(--f10)' }} onClick={() => {
                  const actionLower = action.toLowerCase()
                  let targetMode: Mode = 'forge'
                  if (actionLower.includes('学习') || actionLower.includes('路径') || actionLower.includes('path')) {
                    targetMode = 'learn'
                  } else if (actionLower.includes('星系') || actionLower.includes('图谱') || actionLower.includes('关联') || actionLower.includes('网络')) {
                    targetMode = 'galaxy'
                  }
                  useAppStore.getState().setMode(targetMode)
                }}>{action}</div>
              ))
            ) : (
              <div className="mono text-white/40" style={{ fontSize: 'var(--f10)' }}>知识星系健康运行中</div>
            )}
          </div>
        </div>
      </div>
    </aside>
  )
}
