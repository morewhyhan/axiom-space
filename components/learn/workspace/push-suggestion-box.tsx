'use client'

import { useEffect, useState } from 'react'
import { Check, Link2, PackageOpen, RefreshCcw, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button, SegmentedControl } from '@/components/ui'
import {
  useExecutePushSuggestion,
  usePushSuggestions,
  useScanPushSuggestions,
  useUpdatePushSuggestionStatus,
  type PushSuggestion,
  type PushSuggestionBoxType,
} from '@/hooks/use-learning'

type PushSuggestionBoxProps = {
  pathId?: string | null
}

const BOX_OPTIONS: Array<{ value: PushSuggestionBoxType; label: string }> = [
  { value: 'link', label: '连接' },
  { value: 'resource', label: '资源' },
]

export function PushSuggestionBox({ pathId }: PushSuggestionBoxProps) {
  const [boxType, setBoxTypeState] = useState<PushSuggestionBoxType>('link')
  const { data, loading } = usePushSuggestions({ status: 'pending', limit: 8 })
  const scan = useScanPushSuggestions()
  const execute = useExecutePushSuggestion()
  const updateStatus = useUpdatePushSuggestionStatus()
  const suggestions = data.suggestions ?? []
  const counts = data.counts as Record<string, number>
  const visible = suggestions.filter((item) => item.boxType === boxType).slice(0, 3)

  useEffect(() => {
    const stored = window.localStorage.getItem('axiom-push-box')
    if (stored === 'resource' || stored === 'link') setBoxTypeState(stored)
  }, [])

  const setBoxType = (next: PushSuggestionBoxType) => {
    if (typeof window !== 'undefined') window.localStorage.setItem('axiom-push-box', next)
    setBoxTypeState(next)
  }

  return (
    <div className="learn-push-box">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="truncate text-white/50" style={{ fontSize: 'var(--f9)' }}>
          {counts.pending ?? suggestions.length} 条待处理
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <SegmentedControl
            className="learn-create-tabs"
            itemClassName="learn-create-tab"
            value={boxType}
            onValueChange={(value) => setBoxType(value as PushSuggestionBoxType)}
            items={BOX_OPTIONS}
          />
          <Button
            variant="inline"
            disabled={scan.isPending}
            onClick={async () => {
              try {
                const result = await scan.mutateAsync({ trigger: 'manual_learning_page', scope: pathId ? { pathId } : undefined })
                toast.success(`已扫描 ${result.candidateCount} 个候选，新增 ${result.created.length} 条`)
              } catch (err) {
                toast.error(err instanceof Error ? err.message : '扫描失败')
              }
            }}
          >
            <RefreshCcw className="h-3 w-3" />
          </Button>
        </div>
      </div>

      <div className="mt-3 grid gap-2">
        {loading ? (
          <div className="h-16 animate-pulse rounded-lg bg-white/[0.035]" />
        ) : visible.length > 0 ? (
          visible.map((item) => (
            <SuggestionRow
              key={item.id}
              item={item}
              executing={execute.isPending}
              updating={updateStatus.isPending}
              onExecute={async () => {
                try {
                  await execute.mutateAsync(item.id)
                  toast.success('建议已执行')
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : '执行失败')
                }
              }}
              onReject={async () => {
                try {
                  await updateStatus.mutateAsync({ suggestionId: item.id, status: 'rejected' })
                  toast.message('已忽略这条建议')
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : '更新失败')
                }
              }}
            />
          ))
        ) : (
          <div className="rounded-lg border border-white/8 bg-white/[0.025] px-3 py-3 text-white/35" style={{ fontSize: 'var(--f9)' }}>
            当前没有待处理的{boxType === 'link' ? '连接' : '资源'}建议
          </div>
        )}
      </div>
    </div>
  )
}

function SuggestionRow({
  item,
  executing,
  updating,
  onExecute,
  onReject,
}: {
  item: PushSuggestion
  executing: boolean
  updating: boolean
  onExecute: () => void | Promise<void>
  onReject: () => void | Promise<void>
}) {
  const icon = item.boxType === 'link'
    ? <Link2 className="h-3.5 w-3.5 text-cyan-200/70" />
    : <PackageOpen className="h-3.5 w-3.5 text-amber-200/70" />
  const evidence = item.evidence?.slice(0, 3) ?? []
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-white/8 bg-white/[0.025] px-3 py-2">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {icon}
          <span className="truncate text-white/70" style={{ fontSize: 'var(--f9)' }}>{item.title}</span>
          <span className="mono shrink-0 text-white/25" style={{ fontSize: 'var(--f8)' }}>{Math.round((item.confidence || 0) * 100)}%</span>
        </div>
        <p className="mt-1 line-clamp-2 text-white/42" style={{ fontSize: 'var(--f8)' }}>
          理由：{item.reason}
        </p>
        {evidence.length > 0 && (
          <div className="mt-1 grid gap-0.5">
            {evidence.map((line, index) => (
              <p key={`${item.id}:evidence:${index}`} className="line-clamp-1 text-white/34" style={{ fontSize: 'var(--f8)' }}>
                {line}
              </p>
            ))}
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          className="rounded-lg p-1.5 text-green-200/60 hover:bg-green-300/[0.08] hover:text-green-100"
          disabled={executing}
          aria-label="执行建议"
          onClick={() => { void onExecute() }}
        >
          <Check className="h-3.5 w-3.5" />
        </Button>
        <Button
          className="rounded-lg p-1.5 text-white/32 hover:bg-white/8 hover:text-white/70"
          disabled={updating}
          aria-label="忽略建议"
          onClick={() => { void onReject() }}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  )
}
