'use client'

import React, { useState } from 'react'
import { usePathAdjustments } from '@/hooks/use-learning'

const ADJUSTMENT_TYPES: Record<string, { label: string; color: string; icon: string }> = {
  add_review: { label: '添加复习', color: 'bg-amber-500/20 text-amber-400', icon: '📚' },
  skip_ahead: { label: '跳过进阶', color: 'bg-green-500/20 text-green-400', icon: '⚡' },
  adjust_difficulty: { label: '调整难度', color: 'bg-blue-500/20 text-blue-400', icon: '⚙️' },
  add_practice: { label: '增加练习', color: 'bg-purple-500/20 text-purple-400', icon: '✍️' },
  recommend_rest: { label: '建议休息', color: 'bg-cyan-500/20 text-cyan-400', icon: '😴' },
}

const TRIGGER_TYPES: Record<string, string> = {
  assessment_failed: '评估未通过 (<60%)',
  assessment_excellent: '评估优秀 (≥95%)',
  assessment_passed: '评估通过 (80-95%)',
  path_progressed: '路径推进新阶段',
  manual: '手动调整',
}

interface PathAdjustment {
  id: string
  pathId: string
  adjustmentId?: string
  appliedAt: number
  trigger?: 'assessment_failed' | 'assessment_excellent' | 'assessment_passed' | 'path_progressed' | 'manual'
  adjustment?: {
    type: string
    concept: string
    description: string
  }
  assessmentRef?: {
    toolName: string
    score?: number
    threshold?: number
  }
  feedback?: string
}

export default function PathAdjustmentPanel({ pathId }: { pathId?: string }) {
  const { data: adjustments, loading } = usePathAdjustments(pathId)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  if (loading) {
    return (
      <div className="glass-panel p-6 rounded-2xl animate-pulse">
        <div className="h-8 bg-white/10 rounded w-1/3 mb-4"></div>
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-12 bg-white/5 rounded"></div>
          ))}
        </div>
      </div>
    )
  }

  const historyList: PathAdjustment[] = (adjustments?.adjustmentHistory ?? []) as PathAdjustment[]

  if (historyList.length === 0) {
    return (
      <div className="glass-panel p-6 rounded-2xl text-center">
        <p className="mono text-white/40">还没有路径调整记录</p>
        <p className="mono text-white/20 text-sm mt-2">继续学习，系统会根据评估结果自动调整你的学习路径</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* 标题和统计 */}
      <div className="glass-panel p-6 rounded-2xl">
        <div className="flex items-center justify-between">
          <div>
            <span className="mono opacity-40 uppercase block text-sm mb-2">Path_Adjustments</span>
            <h2 className="text-2xl font-bold">学习路径调整</h2>
          </div>
          <div className="text-right">
            <div className="text-3xl font-bold text-green-400">{historyList.length}</div>
            <div className="mono text-white/40 text-sm">总调整次数</div>
          </div>
        </div>
      </div>

      {/* 调整历史时间线 */}
      <div className="space-y-3">
        {historyList.map((adj: PathAdjustment, idx: number) => {
          const adjustType = adj.adjustment?.type || 'add_review'
          const typeInfo = ADJUSTMENT_TYPES[adjustType] || ADJUSTMENT_TYPES.add_review
          const triggerType = adj.trigger || 'manual'
          const triggerLabel = TRIGGER_TYPES[triggerType] || '自动调整'
          const timestamp = new Date(adj.appliedAt || Date.now())
          const isExpanded = expandedId === adj.id

          return (
            <div
              key={adj.id || idx}
              className={`glass-panel p-4 rounded-xl cursor-pointer transition-all ${
                isExpanded ? 'ring-1 ring-purple-500/50' : ''
              }`}
              onClick={() => setExpandedId(isExpanded ? null : adj.id)}
            >
              {/* 调整项头部 */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3 flex-1">
                  <span className="text-xl">{typeInfo.icon}</span>
                  <div>
                    <div className={`px-3 py-1 rounded-full text-sm font-semibold inline-block ${typeInfo.color}`}>
                      {typeInfo.label}
                    </div>
                    <p className="mono text-white/30 text-xs mt-1">{adj.adjustment?.concept || 'N/A'}</p>
                  </div>
                </div>
                <div className="text-right">
                  <div className="mono text-white/40 text-xs">{triggerLabel}</div>
                  <div className="mono text-white/20 text-xs mt-1">
                    {timestamp.toLocaleString('zh-CN', {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </div>
                </div>
              </div>

              {/* 调整描述 */}
              <p className="text-white/60 text-sm mb-3">{adj.adjustment?.description}</p>

              {/* 展开的详细信息 */}
              {isExpanded && (
                <div className="pt-3 border-t border-white/10 space-y-3 animate-fade-in-up">
                  {/* 评估信息 */}
                  {adj.assessmentRef && (
                    <div className="bg-white/5 p-3 rounded">
                      <p className="mono text-white/40 text-xs mb-2">📊 评估参考:</p>
                      <div className="space-y-1">
                        <p className="mono text-white/50 text-xs">
                          工具: <span className="text-white/70">{adj.assessmentRef.toolName}</span>
                        </p>
                        {adj.assessmentRef.score !== undefined && (
                          <p className="mono text-white/50 text-xs">
                            成绩:{' '}
                            <span
                              className={
                                (adj.assessmentRef.score || 0) >= 95
                                  ? 'text-green-400'
                                  : (adj.assessmentRef.score || 0) >= 60
                                    ? 'text-yellow-400'
                                    : 'text-red-400'
                              }
                            >
                              {adj.assessmentRef.score}%
                            </span>
                          </p>
                        )}
                        {adj.assessmentRef.threshold !== undefined && (
                          <p className="mono text-white/50 text-xs">
                            阈值: <span className="text-white/70">{adj.assessmentRef.threshold}%</span>
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* 用户反馈 */}
                  {adj.feedback && (
                    <div className="bg-white/5 p-3 rounded">
                      <p className="mono text-white/40 text-xs mb-2">💬 用户反馈:</p>
                      <p className="text-white/60 text-sm">{adj.feedback}</p>
                    </div>
                  )}

                  {/* 提示信息 */}
                  {!adj.feedback && (
                    <div className="p-3 bg-blue-500/10 rounded border border-blue-500/30">
                      <p className="mono text-blue-300 text-xs">
                        💡 完成本阶段学习后，系统会根据新的评估结果继续优化你的学习路径
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* 调整统计 */}
      {historyList.length > 0 && (
        <div className="glass-panel p-4 rounded-xl grid grid-cols-2 gap-4">
          <div className="text-center">
            <div className="text-2xl font-bold text-amber-400">
              {historyList.filter((a: PathAdjustment) => a.adjustment?.type === 'add_review').length}
            </div>
            <p className="mono text-white/40 text-xs mt-1">复习调整</p>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-green-400">
              {historyList.filter((a: PathAdjustment) => a.adjustment?.type === 'skip_ahead').length}
            </div>
            <p className="mono text-white/40 text-xs mt-1">加速调整</p>
          </div>
        </div>
      )}
    </div>
  )
}
