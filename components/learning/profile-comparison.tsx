'use client'

import React, { useState } from 'react'
import { useEducationProfile } from '@/hooks/use-learning'
import type { EducationProfile, DimensionScore } from '@/hooks/use-learning'

// 6维颜色映射
const DIMENSION_COLORS: Record<string, { bg: string; text: string; bar: string }> = {
  depth: { bg: 'from-purple-500/10 to-purple-600/10', text: 'text-purple-400', bar: 'bg-purple-500' },
  breadth: { bg: 'from-cyan-500/10 to-cyan-600/10', text: 'text-cyan-400', bar: 'bg-cyan-500' },
  connection: { bg: 'from-pink-500/10 to-pink-600/10', text: 'text-pink-400', bar: 'bg-pink-500' },
  expression: { bg: 'from-amber-500/10 to-amber-600/10', text: 'text-amber-400', bar: 'bg-amber-500' },
  application: { bg: 'from-green-500/10 to-green-600/10', text: 'text-green-400', bar: 'bg-green-500' },
  learning_pace: { bg: 'from-blue-500/10 to-blue-600/10', text: 'text-blue-400', bar: 'bg-blue-500' },
}

const DIMENSION_NAMES: Record<string, string> = {
  depth: '深度',
  breadth: '广度',
  connection: '联接',
  expression: '表达',
  application: '应用',
  learning_pace: '节奏',
}

const DIMENSION_DESCRIPTIONS: Record<string, string> = {
  depth: '概念理解的深度和细致程度',
  breadth: '涉及知识领域的广度',
  connection: '不同知识之间的联系能力',
  expression: '表达想法的清晰度',
  application: '实际应用和问题解决能力',
  learning_pace: '学习的频率和习惯',
}

export default function ProfileComparison() {
  const { profile, loading } = useEducationProfile()
  const [expandedDim, setExpandedDim] = useState<string | null>(null)

  if (loading) {
    return (
      <div className="glass-panel p-6 rounded-2xl animate-pulse">
        <div className="h-8 bg-white/10 rounded w-1/3 mb-4"></div>
        <div className="space-y-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-12 bg-white/5 rounded"></div>
          ))}
        </div>
      </div>
    )
  }

  if (!profile || !profile.dimensions) {
    return (
      <div className="glass-panel p-6 rounded-2xl">
        <p className="mono text-white/40 text-center">教育画像数据加载中...</p>
      </div>
    )
  }

  const dimensions: EducationProfile['dimensions'] = profile.dimensions
  const dimList = Object.entries(dimensions).filter(([key]) => key in DIMENSION_NAMES)
  const avgScore = dimList.length > 0 ? dimList.reduce((sum, [, val]: [string, DimensionScore]) => sum + (val.score || 0), 0) / dimList.length : 0

  // 6维雷达图数据
  const radarData = dimList.map(([key, val]: [string, DimensionScore]) => ({
    name: DIMENSION_NAMES[key],
    score: val.score || 0,
    confidence: val.confidence || 0,
  }))

  const radarPoints = radarData.map((d, i) => {
    const angle = (Math.PI * 2 * i) / radarData.length - Math.PI / 2
    const r = 20 + (d.score || 0) * 0.7
    return { x: 100 + r * Math.cos(angle), y: 100 + r * Math.sin(angle), ...d }
  })

  return (
    <div className="space-y-4">
      {/* 标题和统计 */}
      <div className="glass-panel p-6 rounded-2xl">
        <div className="flex items-center justify-between mb-4">
          <div>
            <span className="mono opacity-40 uppercase block text-sm mb-2">Education_Profile</span>
            <h2 className="text-2xl font-bold">6维学习画像</h2>
          </div>
          <div className="text-right">
            <div className="text-3xl font-bold text-purple-400">{Math.round(avgScore)}</div>
            <div className="mono text-white/40 text-sm">平均分</div>
          </div>
        </div>

        {/* 更新时间 */}
        {profile.updatedAt && (
          <p className="mono text-white/30 text-sm">
            最后更新于 {new Date(profile.updatedAt).toLocaleString('zh-CN')}
          </p>
        )}
      </div>

      {/* 6维雷达图 */}
      <div className="glass-panel p-6 rounded-2xl">
        <div className="flex justify-center mb-6">
          <svg width="240" height="240" viewBox="0 0 200 200" className="drop-shadow-lg">
            {/* 背景网格 */}
            {[20, 40, 60, 80, 100].map((r) => (
              <circle key={`grid-${r}`} cx="100" cy="100" r={r} fill="none" stroke="rgba(255,255,255,0.03)" strokeWidth="0.5" />
            ))}

            {/* 轴线 */}
            {radarData.map((_, i) => {
              const angle = (Math.PI * 2 * i) / radarData.length - Math.PI / 2
              const x = 100 + 100 * Math.cos(angle)
              const y = 100 + 100 * Math.sin(angle)
              return (
                <line key={`axis-${i}`} x1="100" y1="100" x2={x} y2={y} stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" />
              )
            })}

            {/* 数据多边形 */}
            <polygon
              points={radarPoints.map((p) => `${p.x},${p.y}`).join(' ')}
              fill="rgba(168,85,247,0.15)"
              stroke="rgba(168,85,247,0.7)"
              strokeWidth="1.5"
            />

            {/* 维度标签 */}
            {radarPoints.map((p, i) => {
              const angle = (Math.PI * 2 * i) / radarData.length - Math.PI / 2
              const labelR = 115
              const lx = 100 + labelR * Math.cos(angle)
              const ly = 100 + labelR * Math.sin(angle)
              const color = Object.values(DIMENSION_COLORS)[i]?.text || 'fill-white/50'
              return (
                <text
                  key={`label-${i}`}
                  x={lx}
                  y={ly}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className={color}
                  fontSize="10"
                  fontFamily="JetBrains Mono"
                >
                  {p.name}
                </text>
              )
            })}

            {/* 数据点 */}
            {radarPoints.map((p, i) => (
              <circle
                key={`point-${i}`}
                cx={p.x}
                cy={p.y}
                r="3"
                fill="rgba(168,85,247,0.8)"
                stroke="rgba(255,255,255,0.3)"
                strokeWidth="0.5"
              />
            ))}
          </svg>
        </div>
      </div>

      {/* 6维详细数据 */}
      <div className="space-y-3">
        {dimList.map(([key, val]: [string, DimensionScore], idx) => {
          const colors = DIMENSION_COLORS[key] || DIMENSION_COLORS.depth
          const isLowConfidence = (val.confidence || 0) < 0.5
          const displayScore = val.score || 0

          return (
            <div
              key={key}
              className={`glass-panel p-4 rounded-xl cursor-pointer transition-all ${
                expandedDim === key ? 'ring-1 ring-purple-500/50' : ''
              }`}
              onClick={() => setExpandedDim(expandedDim === key ? null : key)}
            >
              {/* 维度头部 */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3 flex-1">
                  <div className={`w-2 h-2 rounded-full ${colors.bar}`}></div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={`font-semibold ${colors.text}`}>{DIMENSION_NAMES[key]}</span>
                      {isLowConfidence && (
                        <span className="mono text-white/30 text-xs px-2 py-1 bg-white/5 rounded">信度低</span>
                      )}
                    </div>
                    <p className="mono text-white/40 text-xs mt-1">{DIMENSION_DESCRIPTIONS[key]}</p>
                  </div>
                </div>
                <div className="text-right">
                  <div className={`text-lg font-bold ${colors.text}`}>{displayScore.toFixed(1)}</div>
                  <div className="mono text-white/30 text-xs">信度 {(val.confidence * 100).toFixed(0)}%</div>
                </div>
              </div>

              {/* 进度条 */}
              <div className="h-2 bg-white/5 rounded-full overflow-hidden mb-3">
                <div
                  className={`h-full ${colors.bar} transition-all duration-500`}
                  style={{ width: `${Math.min(displayScore, 100)}%` }}
                ></div>
              </div>

              {/* 展开的详细信息 */}
              {expandedDim === key && (
                <div className="pt-3 border-t border-white/10 space-y-2 animate-fade-in-up">
                  {val.evidence && Array.isArray(val.evidence) && val.evidence.length > 0 && (
                    <div>
                      <p className="mono text-white/40 text-xs mb-2">评估依据:</p>
                      <ul className="space-y-1">
                        {val.evidence.slice(0, 3).map((evidence: string, i: number) => (
                          <li key={i} className="mono text-white/30 text-xs">
                            • {evidence}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {isLowConfidence && (
                    <div className="mt-3 p-3 bg-amber-500/10 rounded border border-amber-500/30">
                      <p className="mono text-amber-300 text-xs">
                        💡 数据还不足够，继续学习能帮助我们更准确地了解你在这个维度的水平
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* 更新历史 */}
      {profile.updateHistory && profile.updateHistory.length > 0 && (
        <div className="glass-panel p-4 rounded-xl">
          <p className="mono text-white/40 text-xs mb-3 uppercase">最近更新</p>
          <div className="space-y-2">
            {profile.updateHistory.slice(-3).map((hist: { timestamp: number; trigger: string; dimensionsUpdated: string[] }, i: number) => (
              <div key={i} className="flex items-center justify-between text-xs">
                <span className="mono text-white/30">
                  {new Date(hist.timestamp).toLocaleString('zh-CN', {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
                <span className="text-white/40">{hist.dimensionsUpdated.join(', ')}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
