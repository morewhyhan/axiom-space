'use client'

import { useEffect, useMemo, useState } from 'react'
import { MessageSquareText, RefreshCw } from 'lucide-react'
import { useCognition, useSummarizeProfilePrompt } from '@/hooks/use-cognition'

export default function InsightsPanel() {
  const { data, loading } = useCognition()
  const summarizePrompt = useSummarizeProfilePrompt()
  const [promptText, setPromptText] = useState('')
  const [generatedAt, setGeneratedAt] = useState<string | null>(null)

  useEffect(() => {
    setPromptText(data?.promptBlock ?? '')
    setGeneratedAt(null)
  }, [data?.promptBlock])

  const statusText = useMemo(() => {
    if (summarizePrompt.isPending) return '正在汇总'
    if (generatedAt) return `已汇总 ${new Date(generatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
    if (loading) return '正在读取'
    return data?.profileLoop?.lastObservationAt ? '来自当前画像' : '等待画像证据'
  }, [data?.profileLoop?.lastObservationAt, generatedAt, loading, summarizePrompt.isPending])

  const handleSummarize = () => {
    summarizePrompt.mutate(undefined, {
      onSuccess: (result) => {
        setPromptText(result.promptBlock)
        setGeneratedAt(result.generatedAt)
      },
    })
  }

  return (
    <aside
      className="side-slot visible flex-col pointer-events-auto no-scrollbar"
      style={{ width: 'var(--panel-sm)', justifyContent: 'flex-start', padding: 'var(--panel-py) 0', overflow: 'hidden' }}
    >
      <div className="glass-panel cognition-prompt-rail flex-1 flex flex-col overflow-hidden">
        <div className="cognition-prompt-head">
          <div className="flex min-w-0 items-center gap-3">
            <MessageSquareText className="h-4 w-4 shrink-0 text-cyan-100/78" />
            <div className="min-w-0">
              <div className="font-medium text-white/78">注入提示词</div>
              <div className="mt-1 mono text-white/25" style={{ fontSize: 'var(--f7)' }}>{statusText}</div>
            </div>
          </div>
          <button
            type="button"
            className="cognition-prompt-action"
            onClick={handleSummarize}
            disabled={loading || summarizePrompt.isPending}
          >
            <RefreshCw className={summarizePrompt.isPending ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} />
            <span>总结提示词</span>
          </button>
        </div>

        <div className="cognition-prompt-body no-scrollbar">
          <section className="cognition-injection-card cognition-prompt-code-card">
            <pre>
              {loading
                ? '正在读取画像上下文...'
                : summarizePrompt.isError
                  ? `提示词汇总失败：${summarizePrompt.error.message}`
                  : promptText || '暂无可注入画像。完成一次 AI 工作台对话、主动添加画像或提交校验后，这里会显示画像上下文。'}
            </pre>
          </section>
        </div>
      </div>
    </aside>
  )
}
