'use client'

import type { ResourceProgressItem } from '@/stores/agent-store'
import { HudPanel } from '@/components/ui'
import { client } from '@/lib/api-client'
import { toast } from '@/lib/ui-feedback'
import { useAppStore } from '@/stores/mode-store'

const RESOURCE_STATUS_LABEL: Record<string, string> = {
  queued: '等待',
  generating: '生成中',
  validating: '校验',
  saving: '保存',
  ready: '可预览',
  rendering: '渲染',
  completed: '完成',
  failed: '失败',
}

export function ResourceProgressPanel({ items }: { items: ResourceProgressItem[] }) {
  const currentVaultId = useAppStore((s) => s.currentVaultId)
  if (items.length === 0) return null
  const topic = items.find((item) => item.topic)?.topic || '学习资料'
  const primaryItems = items.filter((item) => item.resourceType !== 'video-mp4')
  const progressItems = primaryItems.length > 0 ? primaryItems : items
  const doneCount = progressItems.filter((item) => item.status === 'ready' || item.status === 'completed').length
  const failedCount = items.filter((item) => item.status === 'failed').length
  const overall = Math.round(progressItems.reduce((sum, item) => sum + Math.max(0, Math.min(100, item.progress || 0)), 0) / progressItems.length)

  return (
    <HudPanel
      as="div"
      data-testid="resource-progress-panel"
      data-progress={overall}
      className="mt-3 overflow-hidden rounded-xl border-cyan-500/15 bg-cyan-500/[0.04] p-0"
    >
      <div className="border-b border-white/5 px-3 py-2">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="mono text-cyan-300/80 uppercase" style={{ fontSize: 'var(--f8)' }}>Resource Generation</div>
            <div className="mt-0.5 truncate text-white/75" style={{ fontSize: 'var(--f10)' }}>正在生成「{topic}」</div>
          </div>
          <div className="mono text-white/35" style={{ fontSize: 'var(--f8)' }}>
            {failedCount > 0 ? `${failedCount} failed` : `${doneCount}/${progressItems.length}`}
          </div>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/8">
          <div
            className="h-full rounded-full bg-cyan-300/70 transition-all duration-500"
            style={{ width: `${overall}%` }}
          />
        </div>
      </div>
      <div className="divide-y divide-white/5">
        {items.map((item) => {
          const isFailed = item.status === 'failed'
          const isDone = item.status === 'ready' || item.status === 'completed'
          const canOpen = isDone && !!item.path
          return (
            <button
              key={item.id || `${item.workflowId || item.sourceSessionId || item.topic}:${item.resourceType}:${item.label}`}
              type="button"
              data-testid="resource-progress-item"
              data-resource-type={item.resourceType}
              data-resource-status={item.status}
              className={`block w-full px-3 py-2 text-left transition-colors ${
                canOpen ? 'cursor-pointer hover:bg-white/[0.045]' : 'cursor-default'
              }`}
              disabled={!canOpen}
              onClick={() => {
                if (!item.path) return
                void openResourceTarget(item.path, currentVaultId)
              }}
              title={canOpen ? '打开这个资源' : undefined}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`h-1.5 w-1.5 rounded-full ${isFailed ? 'bg-red-400' : isDone ? 'bg-emerald-400' : 'bg-cyan-300 animate-pulse'}`} />
                    <span className="truncate text-white/70" style={{ fontSize: 'var(--f10)' }}>{item.label}</span>
                    {item.fileName && <span className="mono truncate text-white/25" style={{ fontSize: 'var(--f8)' }}>{item.fileName}</span>}
                  </div>
                  <div className={`mt-1 truncate ${isFailed ? 'text-red-300/75' : 'text-white/35'}`} style={{ fontSize: 'var(--f8)' }}>
                    {item.error || item.message}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className={`mono ${isFailed ? 'text-red-300/80' : isDone ? 'text-emerald-300/80' : 'text-cyan-300/75'}`} style={{ fontSize: 'var(--f8)' }}>
                    {RESOURCE_STATUS_LABEL[item.status] || item.status}
                  </div>
                  <div className="mono text-white/25" style={{ fontSize: 'var(--f7)' }}>{Math.round(item.progress || 0)}%</div>
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </HudPanel>
  )
}

async function openResourceTarget(path: string, vaultId: string | null) {
  try {
    const res = await (client.api.vault['resource-target'].$get as (args: {
      query: { path: string; vid?: string }
    }) => Promise<Response>)({ query: { path, vid: vaultId || undefined } })
    const data = await res.json() as {
      success?: boolean
      error?: string
      card?: { id: string; title: string | null; type: string } | null
    }
    if (!res.ok || !data.success || !data.card) {
      throw new Error(data.error || '没有找到可打开的资源卡')
    }
    const app = useAppStore.getState()
    app.setSelectedNode({
      id: data.card.id,
      title: data.card.title || '生成资源',
      type: data.card.type || 'literature',
    })
    app.setRightPanelView('read')
    if (!app.panelLayout.right.includes('editor')) {
      app.setPanelLayout({
        left: app.panelLayout.left,
        right: [...app.panelLayout.right, 'editor'],
      })
    }
  } catch (err) {
    toast.error(err instanceof Error ? err.message : '打开资源失败')
  }
}
