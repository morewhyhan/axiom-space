'use client'

import { toast } from 'sonner'
import {
  Check,
  FilePlus2,
  GitBranch,
  Layers3,
  Link2,
  Loader2,
  RefreshCw,
  X,
} from 'lucide-react'
import {
  useExecutePushSuggestion,
  usePushSuggestions,
  useScanPushSuggestions,
  useUpdatePushSuggestionStatus,
  type PushSuggestion,
  type PushSuggestionBoxType,
} from '@/hooks/use-learning'

const BOXES: Array<{
  type: PushSuggestionBoxType
  title: string
  icon: typeof Link2
  tone: string
}> = [
  { type: 'link', title: '连接推送', icon: GitBranch, tone: 'text-cyan-200 border-cyan-500/25 bg-cyan-500/8' },
  { type: 'resource', title: '资源与任务', icon: Layers3, tone: 'text-purple-200 border-purple-500/25 bg-purple-500/8' },
]

function itemLabel(item: PushSuggestion) {
  if (item.itemType === 'link') return '节点连接'
  if (item.itemType === 'card') return '新卡片'
  if (item.itemType === 'task_group') return '任务组'
  return '补充资源'
}

function itemIcon(item: PushSuggestion) {
  if (item.itemType === 'link') return Link2
  if (item.itemType === 'task_group') return Layers3
  return FilePlus2
}

function formatConfidence(value: number) {
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`
}

function payloadSummary(item: PushSuggestion) {
  const payload = item.payload || {}
  const source = typeof payload.sourceTitle === 'string' ? payload.sourceTitle : ''
  const target = typeof payload.targetTitle === 'string' ? payload.targetTitle : ''
  const format = typeof payload.suggestedFormat === 'string' ? payload.suggestedFormat : ''
  const area = typeof payload.targetArea === 'string' ? payload.targetArea : ''
  if (source && target) return `${source} -> ${target}`
  if (area) return area
  if (format) return format
  return item.trigger
}

function SuggestionItem({
  item,
  disabled,
  onExecute,
  onReject,
}: {
  item: PushSuggestion
  disabled: boolean
  onExecute: (item: PushSuggestion) => void
  onReject: (item: PushSuggestion) => void
}) {
  const Icon = itemIcon(item)
  return (
    <div className="rounded-xl border border-white/8 bg-black/20 px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <Icon className="h-3.5 w-3.5 shrink-0 text-white/45" />
            <div className="truncate font-medium text-white/80" style={{ fontSize: 'var(--f9)' }}>
              {item.title}
            </div>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] mono text-white/25">
            <span>{itemLabel(item)}</span>
            <span>{formatConfidence(item.confidence)}</span>
            <span className="truncate">{payloadSummary(item)}</span>
          </div>
        </div>
      </div>

      <div className="mt-2 line-clamp-2 text-white/30" style={{ fontSize: 'var(--f8)' }}>
        {item.reason}
      </div>

      {item.evidence.length > 0 && (
        <div className="mt-2 rounded-lg border border-white/6 bg-white/[0.02] px-2 py-2">
          <div className="mono text-[10px] text-white/20">依据</div>
          <div className="mt-1 space-y-1">
            {item.evidence.slice(0, 2).map((evidence, index) => (
              <div key={`${item.id}-${index}`} className="line-clamp-1 text-white/25" style={{ fontSize: 'var(--f8)' }}>
                {evidence}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onExecute(item)}
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-green-500/25 bg-green-500/10 px-2 py-2 text-[10px] mono text-green-200 transition-colors hover:bg-green-500/15 disabled:opacity-40"
        >
          <Check className="h-3 w-3" />
          执行
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onReject(item)}
          className="inline-flex items-center justify-center rounded-lg border border-white/10 px-2 py-2 text-white/35 transition-colors hover:border-red-400/25 hover:text-red-200 disabled:opacity-40"
          title="忽略"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    </div>
  )
}

function PushBox({ type, title, icon: Icon, tone }: (typeof BOXES)[number]) {
  const { data, loading, error, refetch } = usePushSuggestions({ boxType: type, status: 'pending', limit: 8 })
  const scan = useScanPushSuggestions()
  const execute = useExecutePushSuggestion()
  const updateStatus = useUpdatePushSuggestionStatus()
  const busy = scan.isPending || execute.isPending || updateStatus.isPending

  const handleScan = async () => {
    try {
      const result = await scan.mutateAsync({ trigger: 'manual_refresh', scope: { boxType: type } })
      await refetch()
      toast.message(result.created.length > 0 ? `新增 ${result.created.length} 条推送` : '已刷新推送箱')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '推送扫描失败')
    }
  }

  const handleExecute = async (item: PushSuggestion) => {
    try {
      await execute.mutateAsync(item.id)
      toast.success('推送已执行')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '执行失败')
    }
  }

  const handleReject = async (item: PushSuggestion) => {
    try {
      await updateStatus.mutateAsync({ suggestionId: item.id, status: 'rejected' })
      toast.message('已忽略这条推送')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '更新失败')
    }
  }

  return (
    <div className={`rounded-2xl border px-3 py-3 ${tone}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Icon className="h-3.5 w-3.5 shrink-0" />
          <span className="mono truncate text-[10px]">{title}</span>
          <span className="mono rounded-full border border-white/10 px-1.5 py-0.5 text-[10px] text-white/30">
            {data.suggestions.length}
          </span>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={handleScan}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-white/10 text-white/35 hover:border-white/20 hover:text-white/70 disabled:opacity-40"
          title="刷新推送"
        >
          {scan.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        </button>
      </div>

      <div className="mt-3 space-y-2">
        {loading ? (
          <div className="rounded-xl border border-white/8 bg-black/20 px-3 py-5 text-center mono text-[10px] text-white/25">
            加载中...
          </div>
        ) : error ? (
          <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-3 text-[10px] text-red-200">
            {error}
          </div>
        ) : data.suggestions.length === 0 ? (
          <div className="rounded-xl border border-white/8 bg-black/20 px-3 py-5 text-center">
            <div className="mono text-[10px] text-white/25">暂无待处理推送</div>
          </div>
        ) : (
          data.suggestions.slice(0, 4).map((item) => (
            <SuggestionItem
              key={item.id}
              item={item}
              disabled={busy}
              onExecute={handleExecute}
              onReject={handleReject}
            />
          ))
        )}
      </div>
    </div>
  )
}

export function PushSuggestionBoxes() {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="mono text-[10px] text-white/35">推送箱</span>
      </div>
      {BOXES.map((box) => (
        <PushBox key={box.type} {...box} />
      ))}
    </div>
  )
}
