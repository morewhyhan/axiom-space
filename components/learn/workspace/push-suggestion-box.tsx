'use client'

import type { CSSProperties } from 'react'
import { Check, FileText, Link2, PackageOpen, RefreshCcw, Route, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui'
import {
  useExecutePushSuggestion,
  usePushSuggestions,
  useScanPushSuggestions,
  useUpdatePushSuggestionStatus,
  type PushSuggestion,
} from '@/hooks/use-learning'

type PushSuggestionBoxProps = {
  pathId?: string | null
  selectedId?: string | null
  onSelect: (item: PushSuggestion) => void
}

const BOX_GROUPS = [
  { key: 'link', label: '连接', icon: Link2 },
  { key: 'resource', label: '资源', icon: PackageOpen },
  { key: 'task_group', label: '任务组', icon: Route },
] as const

export function PushSuggestionBox({ pathId, selectedId, onSelect }: PushSuggestionBoxProps) {
  const { data, loading } = usePushSuggestions({ status: 'pending', limit: 24 })
  const scan = useScanPushSuggestions()
  const suggestions = data.suggestions ?? []
  const counts = data.counts as Partial<Record<string, number>> | undefined
  const pendingCount = counts?.pending ?? suggestions.length

  return (
    <div className="learn-push-box">
      <div className="learn-push-box-head">
        <span>{pendingCount} 条待处理</span>
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
          title="刷新推送箱"
        >
          <RefreshCcw className={scan.isPending ? 'h-3 w-3 animate-spin' : 'h-3 w-3'} />
        </Button>
      </div>

      <div className="learn-push-groups">
        {loading ? (
          <div className="h-16 animate-pulse rounded-lg bg-white/[0.035]" />
        ) : suggestions.length > 0 ? (
          BOX_GROUPS.map((group) => {
            const Icon = group.icon
            const items = suggestions.filter((item) =>
              group.key === 'task_group'
                ? item.itemType === 'task_group'
                : item.boxType === group.key && item.itemType !== 'task_group',
            )
            if (!items.length) return null
            return (
              <div key={group.key} className="learn-push-group">
                <div className="learn-push-group-label"><Icon className="h-3 w-3" />{group.label}</div>
                <div className="space-y-1">
                  {items.slice(0, 5).map((item) => (
                    <PushSuggestionCapsule
                      key={item.id}
                      item={item}
                      active={item.id === selectedId}
                      onSelect={onSelect}
                    />
                  ))}
                </div>
              </div>
            )
          })
        ) : (
          <div className="rounded-lg border border-white/8 bg-white/[0.025] px-3 py-3 text-white/35" style={{ fontSize: 'var(--f9)' }}>
            当前没有待处理推送
          </div>
        )}
      </div>
    </div>
  )
}

function PushSuggestionCapsule({
  item,
  active,
  onSelect,
}: {
  item: PushSuggestion
  active: boolean
  onSelect: (item: PushSuggestion) => void
}) {
  const Icon = item.itemType === 'task_group'
    ? Route
    : item.boxType === 'link'
      ? Link2
      : PackageOpen
  const confidence = Math.max(0, Math.min(100, Math.round((item.confidence || 0) * 100)))

  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      className={`learn-path-capsule learn-push-capsule${active ? ' active' : ''}`}
      style={{ '--path-progress': `${confidence}%` } as CSSProperties}
    >
      <span className={`learn-path-capsule-dot${active ? ' active' : ''}`} />
      <span className="learn-path-capsule-main">
        <span className="learn-path-capsule-name">
          <Icon className="mr-1.5 inline h-3 w-3 opacity-70" />
          {item.title}
        </span>
        <span className="learn-path-capsule-meta">
          <span>{item.itemType}</span>
          <span>{item.trigger}</span>
        </span>
      </span>
      <span className="learn-path-capsule-count">{confidence}%</span>
    </button>
  )
}

export function PushSuggestionDetailPanel({
  suggestion,
  onClose,
}: {
  suggestion: PushSuggestion
  onClose: () => void
}) {
  const execute = useExecutePushSuggestion()
  const updateStatus = useUpdatePushSuggestionStatus()
  const evidence = suggestion.evidence?.slice(0, 8) ?? []
  const payloadEntries = Object.entries(suggestion.payload ?? {}).slice(0, 8)
  const Icon = suggestion.itemType === 'task_group'
    ? Route
    : suggestion.boxType === 'link'
      ? Link2
      : PackageOpen

  return (
    <div className="learn-push-detail">
      <div className="learn-push-detail-header">
        <div className="min-w-0">
          <div className="learn-push-detail-kicker">
            <Icon className="h-3.5 w-3.5" />
            {suggestion.boxType} / {suggestion.itemType} / {Math.round((suggestion.confidence || 0) * 100)}%
          </div>
          <h2>{suggestion.title}</h2>
        </div>
        <button type="button" className="profile-verdict-btn" onClick={onClose} title="关闭推送详情">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="learn-push-detail-grid">
        <section>
          <div className="learn-push-detail-label">推荐理由</div>
          <p>{suggestion.reason}</p>
        </section>
        <section>
          <div className="learn-push-detail-label">证据</div>
          {evidence.length ? (
            <ul>
              {evidence.map((item, index) => <li key={`${suggestion.id}:e:${index}`}>{item}</li>)}
            </ul>
          ) : (
            <p>暂无额外证据文本。</p>
          )}
        </section>
        <section>
          <div className="learn-push-detail-label">可保存对象</div>
          <p>
            这条推送已经写入数据库：可以是连接、资源、卡片或任务组。执行后会继续进入学习路径、图谱或资源记录。
          </p>
        </section>
        <section>
          <div className="learn-push-detail-label">数据载荷</div>
          {payloadEntries.length ? (
            <div className="learn-push-payload">
              {payloadEntries.map(([key, value]) => (
                <div key={key}>
                  <span>{key}</span>
                  <code>{typeof value === 'string' ? value : JSON.stringify(value)}</code>
                </div>
              ))}
            </div>
          ) : (
            <p>无附加载荷。</p>
          )}
        </section>
      </div>

      <div className="learn-push-detail-actions">
        <Button
          className="rounded-lg px-3 py-2 text-green-100/75 hover:bg-green-300/[0.08]"
          disabled={execute.isPending}
          onClick={async () => {
            try {
              await execute.mutateAsync(suggestion.id)
              toast.success('推送已执行')
              onClose()
            } catch (err) {
              toast.error(err instanceof Error ? err.message : '执行失败')
            }
          }}
        >
          <Check className="h-3.5 w-3.5" /> 执行
        </Button>
        <Button
          className="rounded-lg px-3 py-2 text-white/45 hover:bg-white/8"
          disabled={updateStatus.isPending}
          onClick={async () => {
            try {
              await updateStatus.mutateAsync({ suggestionId: suggestion.id, status: 'rejected' })
              toast.message('已忽略这条推送')
              onClose()
            } catch (err) {
              toast.error(err instanceof Error ? err.message : '更新失败')
            }
          }}
        >
          <X className="h-3.5 w-3.5" /> 忽略
        </Button>
        <span className="ml-auto inline-flex items-center gap-1.5 text-white/28" style={{ fontSize: 'var(--f8)' }}>
          <FileText className="h-3 w-3" />
          {suggestion.id}
        </span>
      </div>
    </div>
  )
}
