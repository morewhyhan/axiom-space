'use client'

import type { CSSProperties } from 'react'
import { Check, CircleAlert, FileText, Link2, Loader2, PackageOpen, RefreshCcw, ShieldCheck, Sparkles, X } from 'lucide-react'
import { toast } from '@/lib/ui-feedback'
import { Button, HudPanel } from '@/components/ui'
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

export function PushSuggestionBox({ pathId, selectedId, onSelect }: PushSuggestionBoxProps) {
  const { data, loading } = usePushSuggestions({ status: 'all', limit: 48 })
  const scan = useScanPushSuggestions()
  const suggestions = data.suggestions ?? []

  const groups = [
    {
      key: 'resource',
      label: '资源推送',
      icon: PackageOpen,
      items: suggestions.filter((item) => item.boxType === 'resource' && item.status === 'pending'),
      history: suggestions.filter((item) => item.boxType === 'resource' && item.status !== 'pending').slice(0, 6),
    },
    {
      key: 'link',
      label: '关联推送',
      icon: Link2,
      items: suggestions.filter((item) => item.boxType === 'link' && item.status === 'pending'),
      history: suggestions.filter((item) => item.boxType === 'link' && item.status !== 'pending').slice(0, 6),
    },
  ]

  return (
    <>
      {groups.map((group) => {
        const Icon = group.icon
        return (
          <div key={group.key} data-testid={`push-box-${group.key}`} className="learn-path-group">
            <div className="learn-path-group-label">
              <Icon className="h-3 w-3" />{group.label}
              <span className="ml-auto">{group.items.length}</span>
              {group.key === 'resource' && (
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
                  title="刷新两个推送箱"
                >
                  <RefreshCcw className={scan.isPending ? 'h-3 w-3 animate-spin' : 'h-3 w-3'} />
                </Button>
              )}
            </div>
            <div className="space-y-1">
              {loading ? (
                <div className="h-12 animate-pulse rounded-lg bg-white/[0.035]" />
              ) : group.items.length > 0 ? group.items.map((item) => (
                <PushSuggestionCapsule key={item.id} item={item} active={item.id === selectedId} onSelect={onSelect} />
              )) : (
                <div className="learn-push-group-empty">暂无待确认建议</div>
              )}
              {group.history.length > 0 && (
                <details data-testid={`push-history-${group.key}`} className="mt-2 border-t border-white/[0.055] pt-2">
                  <summary className="cursor-pointer select-none px-1 py-1 text-[10px] text-white/30 hover:text-white/50">
                    执行记录 {group.history.length}
                  </summary>
                  <div className="mt-1 space-y-1 opacity-75">
                    {group.history.map((item) => (
                      <PushSuggestionCapsule key={item.id} item={item} active={item.id === selectedId} onSelect={onSelect} />
                    ))}
                  </div>
                </details>
              )}
            </div>
          </div>
        )
      })}
    </>
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
  const Icon = item.boxType === 'link'
      ? Link2
      : PackageOpen
  const confidence = Math.max(0, Math.min(100, Math.round((item.confidence || 0) * 100)))
  const terminalLabel = item.status === 'executed'
    ? '已执行'
    : item.status === 'rejected'
      ? '已忽略'
      : item.status === 'accepted'
        ? '已同意'
        : null

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
        <span className="learn-path-capsule-count">{terminalLabel || `证据 ${confidence}%`}</span>
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
  const masteryVerified = suggestion.payload?.masteryVerified === true
  const passedAssessmentCount = Number(suggestion.payload?.passedAssessmentCount || 0)
  const resourcePlan = Array.isArray(suggestion.payload?.resourcePlan)
    ? suggestion.payload.resourcePlan as Array<{ kind?: string; formats?: string[] }>
    : []
  const acceptanceCriteria = Array.isArray(suggestion.payload?.acceptanceCriteria)
    ? suggestion.payload.acceptanceCriteria.map(String)
    : []
  const Icon = suggestion.boxType === 'link'
      ? Link2
      : PackageOpen
  const isTerminal = suggestion.status === 'executed' || suggestion.status === 'rejected'

  return (
    <div className="learn-push-detail">
      <HudPanel className="learn-push-detail-header">
        <div className="learn-push-detail-heading">
          <span className="learn-push-detail-icon"><Icon className="h-4 w-4" /></span>
          <div className="min-w-0">
            <div className="learn-push-detail-kicker">
              <span>{suggestion.itemType === 'resource' ? '资源推送' : suggestion.itemType === 'card' ? '资源推送' : '关联推送'}</span>
              <span className="learn-push-detail-confidence">证据 {Math.round((suggestion.confidence || 0) * 100)}%</span>
            </div>
            <h2>{suggestion.title}</h2>
            <p className="learn-push-detail-subtitle">
              {suggestion.itemType === 'resource' ? '发现一项缺失资料，确认后才会开始生成。' : suggestion.itemType === 'card' ? '发现一个缺失知识对象，确认后才会创建卡片。' : '发现两张卡片之间缺少一条可解释的关系。'}
            </p>
          </div>
        </div>
        <button type="button" className="profile-verdict-btn" onClick={onClose} title="关闭推送详情">
          <X className="h-3.5 w-3.5" />
        </button>
      </HudPanel>

      <div className="learn-push-detail-grid">
        <HudPanel className="learn-push-reason-card">
          <div className="learn-push-detail-label"><Sparkles className="h-4 w-4" />为什么现在推荐</div>
          <p>{suggestion.reason}</p>
        </HudPanel>
        <HudPanel className="learn-push-evidence-card">
          <div className="learn-push-detail-label"><ShieldCheck className="h-4 w-4" />真实证据</div>
          {evidence.length ? (
            <ul>
              {evidence.map((item, index) => <li key={`${suggestion.id}:e:${index}`}>{item}</li>)}
            </ul>
          ) : (
            <p>没有足够证据。该建议不应被执行。</p>
          )}
        </HudPanel>
        <HudPanel className="learn-push-truth-card">
          <div className="learn-push-detail-label"><CircleAlert className="h-4 w-4" />掌握声明检查</div>
          {masteryVerified ? (
            <p><strong>存在 {passedAssessmentCount} 条真实通过测验记录。</strong>只有与这些记录匹配的概念才允许标记为“测验通过”。</p>
          ) : (
            <p><strong>没有通过测验的记录。</strong>卡片、对话表达和永久笔记不等于掌握，本建议不会使用“已掌握”结论。</p>
          )}
        </HudPanel>
        <HudPanel className="learn-push-output-card">
          <div className="learn-push-detail-label"><Check className="h-4 w-4" />确认后的结果</div>
          {suggestion.itemType === 'resource' ? (
            <>
              <p>调用正式资源生成器，生成文件、写入文献节点、加入知识图谱，并自动打开右侧预览。</p>
              <div className="learn-push-formats">
                {(resourcePlan.length ? resourcePlan : [{ kind: 'explanation', formats: ['markdown'] }]).map((item, index) => (
                  <span key={`${item.kind}:${index}`}>{item.kind} · {(item.formats || []).join(' / ')}</span>
                ))}
              </div>
            </>
          ) : (
            <p>{suggestion.itemType === 'card' ? '创建缺失的真实知识卡片并写入知识图谱，不修改掌握状态。' : '在两张现有卡片之间创建真实图谱连接，不修改掌握状态。'}</p>
          )}
          {acceptanceCriteria.length > 0 && (
            <ul className="mt-3 space-y-1 text-white/55">
              {acceptanceCriteria.map((item) => <li key={item}>✓ {item}</li>)}
            </ul>
          )}
        </HudPanel>
      </div>

      <HudPanel as="div" className="learn-push-detail-actions">
        {isTerminal ? (
          <span
            data-testid="push-suggestion-terminal-status"
            className={suggestion.status === 'executed' ? 'text-emerald-300/75' : 'text-white/40'}
          >
            {suggestion.status === 'executed' ? '已由用户确认并真实执行' : '用户已忽略，本次没有执行'}
          </span>
        ) : (
          <>
            <Button
              className="learn-push-primary-action"
              disabled={execute.isPending}
              onClick={async () => {
                try {
                  await execute.mutateAsync(suggestion.id)
                  toast.success(suggestion.itemType === 'resource' ? '资源已生成，正在打开预览' : '推送已执行')
                  onClose()
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : '执行失败')
                }
              }}
            >
              {execute.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {execute.isPending ? '正在真实生成…' : suggestion.itemType === 'resource' ? '同意并生成资源' : '确认执行'}
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
          </>
        )}
        <span className="learn-push-id" title={suggestion.id}>
          <FileText className="h-3 w-3" />
          {suggestion.id}
        </span>
      </HudPanel>
    </div>
  )
}
