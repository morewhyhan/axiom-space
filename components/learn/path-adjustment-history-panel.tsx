'use client'

import React, { useState } from 'react'
import type { EnhancedLearningPath, PathAdjustmentEvent, PathProgressForecast } from '@/types/learning-paths'
import { generateMockEnhancedLearningPath } from '@/types/learning-paths'

// ── 调整事件卡片 ──
function AdjustmentEventCard({ event }: { event: PathAdjustmentEvent }) {
  const [expanded, setExpanded] = useState(false)

  const typeInfo: Record<string, { icon: string; label: string; color: string }> = {
    add_review: { icon: '📚', label: '添加复习', color: 'text-blue-400' },
    skip_ahead: { icon: '⏭️', label: '跳过前进', color: 'text-green-400' },
    adjust_difficulty: { icon: '⚙️', label: '调整难度', color: 'text-yellow-400' },
    add_resource: { icon: '📝', label: '补充资源', color: 'text-purple-400' }
  }

  const info = typeInfo[event.type]
  const date = new Date(event.timestamp)
  const dateStr = date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })

  return (
    <div
      className="rounded-lg border border-white/10 p-3 cursor-pointer transition-all hover:bg-white/[0.05]"
      onClick={() => setExpanded(!expanded)}
    >
      {/* 标题行 */}
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg">{info.icon}</span>
            <h4 className="font-bold text-white/90" style={{ fontSize: 'var(--f10)' }}>
              {info.label}
            </h4>
            <span className={`mono text-[7px] ${info.color}`}>
              {event.reason}
            </span>
          </div>
          <span className="mono text-[8px] text-white/30">{dateStr}</span>
        </div>
        <span className="text-white/40">{expanded ? '▼' : '▶'}</span>
      </div>

      {/* 简短摘要 */}
      <p className="text-white/60 text-[9px] leading-relaxed mb-2 line-clamp-2">
        {event.explanation}
      </p>

      {/* 展开详情 */}
      {expanded && (
        <div className="mt-3 pt-3 border-t border-white/10 space-y-3">
          {/* 完整解释 */}
          <div>
            <span className="mono text-[8px] text-white/40 uppercase">AI 解释</span>
            <p className="text-white/50 text-[8px] mt-1 leading-relaxed">
              {event.explanation}
            </p>
          </div>

          {/* 受影响的步骤 */}
          {event.affectedSteps.length > 0 && (
            <div>
              <span className="mono text-[8px] text-white/40 uppercase">受影响的步骤</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {event.affectedSteps.map(step => (
                  <span
                    key={step}
                    className="mono text-[7px] px-1.5 py-0.5 rounded bg-white/10 text-white/60"
                  >
                    {step}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* 补充资源 */}
          {event.resourcesAdded && event.resourcesAdded.length > 0 && (
            <div>
              <span className="mono text-[8px] text-cyan-400/60 uppercase">推送的资源</span>
              <div className="space-y-1 mt-1">
                {event.resourcesAdded.map((res, i) => (
                  <div key={i} className="flex items-start gap-2 text-[8px]">
                    <span className="text-cyan-400/40">•</span>
                    <div>
                      <div className="text-cyan-400/60">{res.title}</div>
                      <span className="mono text-white/20">{res.type}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── 进度预测面板 ──
function ProgressForecastPanel({ forecast }: { forecast: PathProgressForecast }) {
  const daysRemaining = Math.ceil(
    (forecast.estimatedCompletionDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000)
  )

  const progressColor =
    forecast.progressPercentage >= 70
      ? 'from-green-500 to-green-400'
      : forecast.progressPercentage >= 40
        ? 'from-yellow-500 to-yellow-400'
        : 'from-blue-500 to-blue-400'

  return (
    <div className="bg-white/5 rounded-lg p-4 border border-white/10 space-y-3">
      {/* 进度条 */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="mono text-white/60 font-bold" style={{ fontSize: 'var(--f10)' }}>
            学习进度
          </span>
          <span className="mono text-white/40 text-[9px]">
            {forecast.completedSteps}/{forecast.totalSteps}
          </span>
        </div>
        <div className="h-2 bg-black/40 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full bg-gradient-to-r ${progressColor} transition-all duration-700`}
            style={{ width: `${forecast.progressPercentage}%` }}
          />
        </div>
        <div className="flex items-center justify-between mt-1.5">
          <span className="mono text-[8px] text-white/30">
            {forecast.progressPercentage}% 完成
          </span>
          <span className="mono text-[8px] text-white/30">
            🔥 {forecast.learningStreak} 天连续学习
          </span>
        </div>
      </div>

      {/* 时间预测 */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-black/30 rounded-lg p-2.5">
          <div className="mono text-[7px] text-white/40 mb-1 uppercase">预计完成</div>
          <div className="text-white/80 font-bold text-[11px]">
            {daysRemaining > 0 ? `${daysRemaining} 天` : '即将完成'}
          </div>
          <div className="mono text-[7px] text-white/30 mt-0.5">
            {forecast.estimatedCompletionDate.toLocaleDateString('zh-CN')}
          </div>
        </div>
        <div className="bg-black/30 rounded-lg p-2.5">
          <div className="mono text-[7px] text-white/40 mb-1 uppercase">日均学习</div>
          <div className="text-white/80 font-bold text-[11px]">
            {Math.round(forecast.averageDailyMinutes)} 分钟
          </div>
          <div className="mono text-[7px] text-white/30 mt-0.5">
            近 7 天平均
          </div>
        </div>
      </div>

      {/* 学习进度细节 */}
      <div>
        <div className="grid grid-cols-3 gap-1 text-[8px]">
          <div className="text-center p-2 bg-black/30 rounded-lg">
            <div className="text-cyan-400 font-bold">{forecast.timeSpentMinutes}</div>
            <div className="text-white/40 mt-0.5">已学习</div>
          </div>
          <div className="text-center p-2 bg-black/30 rounded-lg">
            <div className="text-yellow-400 font-bold">{forecast.estimatedRemainingMinutes}</div>
            <div className="text-white/40 mt-0.5">预计剩余</div>
          </div>
          <div className="text-center p-2 bg-black/30 rounded-lg">
            <div className="text-green-400 font-bold">{forecast.estimatedTotalMinutes}</div>
            <div className="text-white/40 mt-0.5">总时长</div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── 主调整历史面板 ──
export default function PathAdjustmentHistoryPanel() {
  // TODO: 后期替换为真实数据来源
  const path = generateMockEnhancedLearningPath()

  const [showForecast, setShowForecast] = useState(true)
  const [showHistory, setShowHistory] = useState(true)

  return (
    <div className="space-y-3">
      {/* 进度预测 */}
      {showForecast && (
        <>
          <div className="flex items-center justify-between px-1 mb-2">
            <span className="mono text-white/60 font-bold text-[10px] uppercase">进度预测</span>
            <button
              className="mono text-[8px] text-white/20 hover:text-white/40"
              onClick={() => setShowForecast(!showForecast)}
            >
              {showForecast ? '隐藏' : '显示'}
            </button>
          </div>
          <ProgressForecastPanel forecast={path.progress} />
        </>
      )}

      {/* 调整历史 */}
      {showHistory && (
        <>
          <div className="flex items-center justify-between px-1 mt-4 mb-2">
            <span className="mono text-white/60 font-bold text-[10px] uppercase">
              调整历史 ({path.adjustmentHistory.length})
            </span>
            <button
              className="mono text-[8px] text-white/20 hover:text-white/40"
              onClick={() => setShowHistory(!showHistory)}
            >
              {showHistory ? '隐藏' : '显示'}
            </button>
          </div>
          <div className="space-y-2">
            {path.adjustmentHistory.length > 0 ? (
              path.adjustmentHistory.map(event => (
                <AdjustmentEventCard key={event.id} event={event} />
              ))
            ) : (
              <div className="text-center py-6 text-white/30 text-[9px]">
                还没有调整历史
              </div>
            )}
          </div>
        </>
      )}

      {/* 底部提示 */}
      <div className="mt-4 pt-3 border-t border-white/5">
        <p className="mono text-[7px] text-white/15 leading-relaxed">
          💡 AI 会根据你的评估结果、学习进度、学习强度等多个维度自动调整路径，确保最优的学习效果。所有调整都有详细的解释，帮助你理解"为什么"。
        </p>
      </div>
    </div>
  )
}
