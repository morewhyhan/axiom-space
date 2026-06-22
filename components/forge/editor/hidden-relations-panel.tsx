'use client'

import { GitBranch, Loader2, Sparkles } from 'lucide-react'
import { Button, HudPanel } from '@/components/ui'
import type { HiddenRelationSuggestion } from './types'

type HiddenRelationsPanelProps = {
  suggestions: HiddenRelationSuggestion[]
  loading: boolean
  applyingId: string | null
  disabled?: boolean
  error?: string | null
  meta?: {
    vectorCandidates: number
    indexedCards: number
    scannedCards: number
  } | null
  onDiscover: () => void | Promise<void>
  onApply: (suggestion: HiddenRelationSuggestion) => void | Promise<void>
  onOpenTarget: (suggestion: HiddenRelationSuggestion) => void | Promise<void>
}

const RELATION_LABELS: Record<string, string> = {
  contains: '包含',
  prerequisite: '前置',
  derived: '推导',
  supports: '支持',
  contradicts: '矛盾',
  wikilink: '链接',
  related: '相关',
}

export function HiddenRelationsPanel({
  suggestions,
  loading,
  applyingId,
  disabled,
  error,
  meta,
  onDiscover,
  onApply,
  onOpenTarget,
}: HiddenRelationsPanelProps) {
  return (
    <div className="border-b border-white/5 bg-cyan-400/[0.02]">
      <div className="flex items-center justify-between gap-3 px-5 py-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5 text-cyan-200/70" />
            <span className="mono uppercase text-cyan-200/70" style={{ fontSize: 'var(--f8)' }}>
              隐藏关联
            </span>
            {meta && (
              <span className="mono text-white/26" style={{ fontSize: 'var(--f8)' }}>
                向量候选 {meta.vectorCandidates} · 已索引 {meta.indexedCards}
              </span>
            )}
          </div>
          {error && (
            <div className="mt-1 truncate text-amber-200/60" style={{ fontSize: 'var(--f8)' }}>
              {error}
            </div>
          )}
        </div>
        <Button
          className="mono inline-flex shrink-0 items-center gap-1.5 rounded border border-cyan-300/15 px-2.5 py-1 text-cyan-100/70 hover:bg-cyan-400/10 disabled:cursor-not-allowed disabled:opacity-40"
          style={{ fontSize: 'var(--f8)' }}
          disabled={disabled || loading}
          onClick={() => { void onDiscover() }}
          title="用向量数据库召回语义相近卡片，再由 AI 判定关系"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GitBranch className="h-3.5 w-3.5" />}
          {loading ? '发现中' : '向量发现'}
        </Button>
      </div>

      {suggestions.length > 0 && (
        <div className="grid grid-cols-1 gap-2 px-5 pb-3 xl:grid-cols-2">
          {suggestions.map((suggestion) => (
            <HudPanel key={suggestion.id} as="div" className="rounded-lg p-2">
              <div className="flex min-w-0 items-center justify-between gap-2">
                <Button
                  className="min-w-0 truncate text-left text-white/72 hover:text-white"
                  style={{ fontSize: 'var(--f9)' }}
                  onClick={() => { void onOpenTarget(suggestion) }}
                  title={suggestion.targetTitle}
                >
                  {suggestion.targetTitle}
                </Button>
                <span className="mono shrink-0 rounded border border-cyan-300/10 px-1.5 py-0.5 text-cyan-100/55" style={{ fontSize: 'var(--f8)' }}>
                  {RELATION_LABELS[suggestion.relationType] || suggestion.relationType}
                </span>
              </div>
              <div className="mt-1 line-clamp-2 text-white/36" style={{ fontSize: 'var(--f8)' }}>
                {suggestion.reason}
              </div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="mono truncate text-white/26" style={{ fontSize: 'var(--f8)' }}>
                  {(suggestion.strength * 100).toFixed(0)}% · {suggestion.reviewStatus === 'llm' ? 'AI 已判定' : '向量候选'}
                </span>
                <Button
                  className="mono shrink-0 rounded border border-emerald-300/15 px-2 py-0.5 text-emerald-200/65 hover:bg-emerald-400/10 disabled:cursor-not-allowed disabled:opacity-40"
                  style={{ fontSize: 'var(--f8)' }}
                  disabled={applyingId === suggestion.id}
                  onClick={() => { void onApply(suggestion) }}
                >
                  {applyingId === suggestion.id ? '写入中' : '写入图谱'}
                </Button>
              </div>
            </HudPanel>
          ))}
        </div>
      )}
    </div>
  )
}
