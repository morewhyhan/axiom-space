'use client'

import React, { useState } from 'react'
import type { LearningInsight, DimensionScore, LearningDiagnosis } from '@/types/learning-insights'
import { generateMockLearningDiagnosis } from '@/types/learning-insights'

// ── 洞察卡片 ──
function InsightCard({ insight }: { insight: LearningInsight }) {
  const [expanded, setExpanded] = useState(false)

  const typeColors: Record<string, { bg: string; border: string; icon: string }> = {
    strength: { bg: 'bg-green-500/10', border: 'border-l-green-500/40', icon: '⭐' },
    weakness: { bg: 'bg-red-500/10', border: 'border-l-red-500/40', icon: '⚠️' },
    pattern: { bg: 'bg-purple-500/10', border: 'border-l-purple-500/40', icon: '🔄' },
    recommendation: { bg: 'bg-blue-500/10', border: 'border-l-blue-500/40', icon: '💡' },
    warning: { bg: 'bg-orange-500/10', border: 'border-l-orange-500/40', icon: '🚨' }
  }

  const colors = typeColors[insight.type]

  return (
    <div
      className={`rounded-lg border-l-2 p-4 ${colors.bg} ${colors.border} cursor-pointer transition-all hover:shadow-md`}
      onClick={() => setExpanded(!expanded)}
    >
      {/* 标题行 */}
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg">{insight.icon || colors.icon}</span>
            <h4 className="font-bold text-white/90" style={{ fontSize: 'var(--f10)' }}>
              {insight.title}
            </h4>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="mono text-[8px] px-2 py-0.5 rounded bg-white/10 text-white/60">
              {insight.dimension}
            </span>
            <span className="mono text-[7px] text-white/30">
              置信度: {Math.round(insight.confidence * 100)}%
            </span>
          </div>
        </div>
        <span className="text-white/40 text-lg">{expanded ? '▼' : '▶'}</span>
      </div>

      {/* 简短描述 */}
      <p className="text-white/70 leading-relaxed mb-2" style={{ fontSize: 'var(--f9)' }}>
        {insight.description}
      </p>

      {/* 展开内容 */}
      {expanded && (
        <div className="mt-3 pt-3 border-t border-white/10 space-y-3">
          {insight.evidence.length > 0 && (
            <div>
              <span className="mono text-[8px] text-white/40 uppercase">证据</span>
              <div className="space-y-1 mt-1">
                {insight.evidence.map((ev, i) => (
                  <div key={i} className="flex gap-2 text-white/50 text-[9px]">
                    <span className="text-white/20">•</span>
                    <span>{ev}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {insight.suggestedAction && (
            <div>
              <span className="mono text-[8px] text-green-400/60 uppercase">建议行动</span>
              <p className="text-green-400/70 text-[9px] mt-1 leading-relaxed">
                {insight.suggestedAction}
              </p>
            </div>
          )}

          {insight.relatedTopic && (
            <div className="flex items-center gap-2">
              <span className="mono text-[7px] text-white/25">相关主题:</span>
              <span className="mono text-[8px] px-2 py-0.5 rounded bg-white/5 text-white/40">
                {insight.relatedTopic}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── 维度评分条 ──
function DimensionBar({ dimension }: { dimension: DimensionScore }) {
  const trendIcons = { up: '📈', down: '📉', stable: '➡️' }
  const score = dimension.score / 100

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-white/70 font-medium text-[9px]">{dimension.name}</span>
            <span className="text-xs">{trendIcons[dimension.trend]}</span>
          </div>
        </div>
        <span className="mono text-white/50 text-[9px]">{dimension.score}/100</span>
      </div>
      <div className="h-2 bg-black/40 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${
            score >= 0.7
              ? 'bg-gradient-to-r from-green-500 to-green-400'
              : score >= 0.5
                ? 'bg-gradient-to-r from-yellow-500 to-yellow-400'
                : 'bg-gradient-to-r from-red-500 to-red-400'
          }`}
          style={{ width: `${score * 100}%` }}
        />
      </div>
      <div className="flex items-center justify-between">
        <span className="mono text-[7px] text-white/20">
          置信度 {Math.round(dimension.confidence * 100)}%
        </span>
      </div>
    </div>
  )
}

// ── 主面板 ──
export default function InsightsDiagnosticPanel() {
  // TODO: 后期替换为真实数据来源
  const diagnosis = generateMockLearningDiagnosis()

  const [activeTab, setActiveTab] = useState<'overview' | 'strengths' | 'weaknesses' | 'patterns' | 'recommendations' | 'warnings'>('overview')

  const tabConfig = [
    { id: 'overview', label: '总览', color: 'text-white/60' },
    { id: 'strengths', label: `优势 (${diagnosis.strengths.length})`, color: 'text-green-400/60' },
    { id: 'weaknesses', label: `弱点 (${diagnosis.weaknesses.length})`, color: 'text-red-400/60' },
    { id: 'patterns', label: `模式 (${diagnosis.patterns.length})`, color: 'text-purple-400/60' },
    { id: 'recommendations', label: `建议 (${diagnosis.recommendations.length})`, color: 'text-blue-400/60' },
    { id: 'warnings', label: `警告 (${diagnosis.warnings.length})`, color: 'text-orange-400/60' }
  ]

  return (
    <aside
      className="side-slot visible cognition-panel flex-1 flex-col pointer-events-auto"
      style={{ maxWidth: 'var(--panel-xl)' }}
    >
      <div className="glass-panel p-5 rounded-2xl flex-1 flex flex-col overflow-hidden">
        {/* 标题 */}
        <div className="mb-4">
          <h2 className="mono text-cyan-400 font-bold" style={{ fontSize: 'var(--f10)' }}>
            AI 学习诊断
          </h2>
          <p className="mono text-white/20 mt-1" style={{ fontSize: 'var(--f8)' }}>
            基于对话分析的个性化学习洞察
          </p>
        </div>

        {/* 标签页 */}
        <div className="flex gap-1 mb-4 flex-wrap border-b border-white/5 pb-3">
          {tabConfig.map(tab => (
            <button
              key={tab.id}
              className={`mono text-[8px] px-3 py-1.5 rounded-lg transition-all ${
                activeTab === tab.id
                  ? 'bg-white/10 text-white/80'
                  : `${tab.color} hover:bg-white/5`
              }`}
              onClick={() => setActiveTab(activeTab === tab.id ? 'overview' : (tab.id as any))}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* 内容区域 */}
        <div className="flex-1 overflow-y-auto no-scrollbar space-y-3">
          {/* ── 总览标签页 ── */}
          {activeTab === 'overview' && (
            <>
              {/* 整体进度 */}
              <div className="bg-white/5 rounded-lg p-4 border border-white/10">
                <div className="flex items-center justify-between mb-2">
                  <span className="mono text-white/60 font-bold" style={{ fontSize: 'var(--f10)' }}>
                    学习综合指数
                  </span>
                  <span className="text-2xl font-bold text-cyan-400">
                    {diagnosis.overallProgress}%
                  </span>
                </div>
                <div className="h-2 bg-black/40 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-cyan-500 to-blue-500"
                    style={{ width: `${diagnosis.overallProgress}%` }}
                  />
                </div>
              </div>

              {/* 6 维评分 */}
              <div className="space-y-3">
                <h3 className="mono text-white/50 text-[9px] uppercase">6 维学习画像</h3>
                <div className="space-y-2.5">
                  {diagnosis.dimensionScores.map(dim => (
                    <DimensionBar key={dim.name} dimension={dim} />
                  ))}
                </div>
              </div>

              {/* 快速概览 */}
              <div className="grid grid-cols-3 gap-2 mt-4 pt-4 border-t border-white/10">
                <div className="text-center">
                  <div className="text-lg font-bold text-green-400">{diagnosis.strengths.length}</div>
                  <div className="mono text-[7px] text-white/30">识别优势</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold text-red-400">{diagnosis.weaknesses.length}</div>
                  <div className="mono text-[7px] text-white/30">发现弱点</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold text-blue-400">{diagnosis.recommendations.length}</div>
                  <div className="mono text-[7px] text-white/30">给出建议</div>
                </div>
              </div>
            </>
          )}

          {/* ── 其他标签页 ── */}
          {activeTab === 'strengths' && (
            <div className="space-y-2">
              {diagnosis.strengths.length > 0 ? (
                diagnosis.strengths.map(insight => <InsightCard key={insight.id} insight={insight} />)
              ) : (
                <div className="text-center py-8 text-white/30">暂无数据</div>
              )}
            </div>
          )}

          {activeTab === 'weaknesses' && (
            <div className="space-y-2">
              {diagnosis.weaknesses.length > 0 ? (
                diagnosis.weaknesses.map(insight => <InsightCard key={insight.id} insight={insight} />)
              ) : (
                <div className="text-center py-8 text-white/30">暂无数据</div>
              )}
            </div>
          )}

          {activeTab === 'patterns' && (
            <div className="space-y-2">
              {diagnosis.patterns.length > 0 ? (
                diagnosis.patterns.map(insight => <InsightCard key={insight.id} insight={insight} />)
              ) : (
                <div className="text-center py-8 text-white/30">暂无数据</div>
              )}
            </div>
          )}

          {activeTab === 'recommendations' && (
            <div className="space-y-2">
              {diagnosis.recommendations.length > 0 ? (
                diagnosis.recommendations.map(insight => <InsightCard key={insight.id} insight={insight} />)
              ) : (
                <div className="text-center py-8 text-white/30">暂无数据</div>
              )}
            </div>
          )}

          {activeTab === 'warnings' && (
            <div className="space-y-2">
              {diagnosis.warnings.length > 0 ? (
                diagnosis.warnings.map(insight => <InsightCard key={insight.id} insight={insight} />)
              ) : (
                <div className="text-center py-8 text-white/30">暂无数据</div>
              )}
            </div>
          )}
        </div>

        {/* 底部提示 */}
        <div className="mt-3 pt-3 border-t border-white/5">
          <p className="mono text-[7px] text-white/15 leading-relaxed">
            💡 这些洞察基于你与 AI 的对话分析生成，置信度通过数据充分程度动态调整。
          </p>
        </div>
      </div>
    </aside>
  )
}
