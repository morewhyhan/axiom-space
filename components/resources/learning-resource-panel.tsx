'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BookOpen,
  Code2,
  Download,
  FileText,
  Image as ImageIcon,
  ListChecks,
  Maximize2,
  Network,
  Play,
  Presentation,
  X,
} from 'lucide-react'
import { Button, HudPanel } from '@/components/ui'
import { ResourcePreview } from './resource-preview'
import { downloadResource, shortHash, statusLabel } from './resource-utils'
import type { GeneratedResourceItem } from './types'

type LearningResourcePanelProps = {
  resources: GeneratedResourceItem[]
  loading?: boolean
}

const RESOURCE_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  document: BookOpen,
  mindmap: Network,
  diagram: Network,
  quiz: ListChecks,
  code: Code2,
  svg: ImageIcon,
  video: Play,
  docx: FileText,
  pdf: FileText,
  ppt: Presentation,
}

export function LearningResourcePanel({ resources, loading }: LearningResourcePanelProps) {
  const layoutRef = useRef<HTMLDivElement | null>(null)
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [activeAttachmentKey, setActiveAttachmentKey] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<GeneratedResourceItem | null>(null)
  const [stackedLayout, setStackedLayout] = useState(true)
  const resourceGroups = useMemo(() => {
    const groups = new Map<string, GeneratedResourceItem[]>()
    for (const item of resources) {
      const key = item.kind || item.type
      groups.set(key, [...(groups.get(key) ?? []), item])
    }
    return [...groups.entries()].map(([key, items]) => ({ key, items }))
  }, [resources])
  const activeGroup = useMemo(() => {
    if (resourceGroups.length === 0) return null
    return resourceGroups.find((group) => group.key === activeKey) ?? resourceGroups[0]
  }, [activeKey, resourceGroups])
  const active = useMemo(() => {
    if (!activeGroup) return null
    return activeGroup.items.find((item) => attachmentKey(item) === activeAttachmentKey) ?? activeGroup.items[0]
  }, [activeAttachmentKey, activeGroup])

  useEffect(() => {
    if (resourceGroups.length === 0) {
      setActiveKey(null)
      return
    }
    if (!activeKey || !resourceGroups.some((group) => group.key === activeKey)) {
      setActiveKey(resourceGroups[0].key)
    }
  }, [activeKey, resourceGroups])

  useEffect(() => {
    if (!activeGroup) return
    if (!activeAttachmentKey || !activeGroup.items.some((item) => attachmentKey(item) === activeAttachmentKey)) {
      setActiveAttachmentKey(attachmentKey(activeGroup.items[0]))
    }
  }, [activeAttachmentKey, activeGroup])

  useEffect(() => {
    const element = layoutRef.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const update = (width: number) => setStackedLayout(width < 720)
    update(element.getBoundingClientRect().width)
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) update(entry.contentRect.width)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  if (loading) {
    return (
      <HudPanel as="div" className="mt-6 p-5 text-center text-sm text-white/40">
        加载资源面板...
      </HudPanel>
    )
  }

  if (resourceGroups.length === 0) return null

  return (
    <>
      <div className="mt-8 border-t border-white/10 pt-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <div className="mono text-purple-400 uppercase" style={{ fontSize: 'var(--f8)' }}>Generated Resources</div>
            <div className="mt-1 text-xs text-white/35">左侧选择单个资源，右侧单独预览、放大和下载</div>
          </div>
          <div className="mono text-white/25" style={{ fontSize: 'var(--f8)' }}>{resourceGroups.length} resources · {resources.length} formats</div>
        </div>
        <div
          ref={layoutRef}
          data-testid="learning-resource-layout"
          data-layout={stackedLayout ? 'stacked' : 'split'}
          className="grid gap-4"
          style={{
            gridTemplateColumns: stackedLayout
              ? 'minmax(0, 1fr)'
              : 'minmax(220px, 0.85fr) minmax(0, 1.65fr)',
          }}
        >
          <div
            className="grid content-start gap-2"
            style={{
              gridTemplateColumns: stackedLayout
                ? 'repeat(auto-fit, minmax(min(100%, 150px), 1fr))'
                : 'minmax(0, 1fr)',
            }}
          >
            {resourceGroups.map((group) => {
              const item = group.items[0]
              const Icon = RESOURCE_ICON[item.type] || FileText
              const selected = activeGroup?.key === group.key
              return (
                <button
                  key={group.key}
                  type="button"
                  className={`group rounded-xl border p-3 text-left transition-colors ${
                    selected
                      ? 'border-emerald-300/30 bg-emerald-300/[0.08]'
                      : 'border-white/8 bg-white/[0.025] hover:border-white/16 hover:bg-white/[0.055]'
                  }`}
                  onClick={() => setActiveKey(group.key)}
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/8 text-white/60">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-white/80">{item.title}</div>
                      <div className="truncate text-xs text-white/30">{group.items.map((attachment) => attachment.format || attachment.type).join(' · ')}</div>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-1 text-[10px] text-white/35">
                    <div className="truncate"><span className="text-emerald-300/75">status</span> {statusLabel(item.status)}</div>
                    <div className="truncate"><span className="text-emerald-300/75">formats</span> {group.items.length}</div>
                  </div>
                </button>
              )
            })}
          </div>

          <HudPanel as="div" className="min-h-[520px] rounded-xl p-4">
            {active && (
              <>
                <div className="mb-3 flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-white/85">{active.title}</div>
                    <div className="truncate text-xs text-white/35">
                      {active.fileName} · {statusLabel(active.status)} · {shortHash(active.contentHash)}
                    </div>
                  </div>
                  <Button
                    className="rounded-lg p-2 text-white/45 transition-colors hover:bg-white/10 hover:text-white"
                    onClick={() => setExpanded(active)}
                    title="放大查看"
                  >
                    <Maximize2 className="h-4 w-4" />
                  </Button>
                  <Button
                    className="rounded-lg p-2 text-white/45 transition-colors hover:bg-white/10 hover:text-white"
                    onClick={() => downloadResource(active)}
                    title="下载"
                  >
                    <Download className="h-4 w-4" />
                  </Button>
                </div>
                <div className="mb-3 grid gap-2 rounded-lg border border-emerald-400/10 bg-emerald-400/[0.035] px-3 py-2 text-[11px] text-white/45 sm:grid-cols-3">
                  <div className="truncate" title={active.sourceObjectId || active.sourcePath || active.path}>
                    <span className="text-emerald-300/75">db</span> {active.sourceObjectId || active.sourcePath || active.path}
                  </div>
                  <div className="truncate" title={active.contentHash || ''}>
                    <span className="text-emerald-300/75">hash</span> {shortHash(active.contentHash)}
                  </div>
                  <div className="truncate" title={active.generatedAt || ''}>
                    <span className="text-emerald-300/75">generated</span> {active.generatedAt ? new Date(active.generatedAt).toLocaleString() : 'unknown'}
                  </div>
                </div>
                {activeGroup && activeGroup.items.length > 1 && (
                  <div className="mb-3 flex flex-wrap gap-2">
                    {activeGroup.items.map((attachment) => (
                      <Button
                        key={attachmentKey(attachment)}
                        className={`rounded-md border px-2.5 py-1 text-[10px] uppercase ${
                          attachmentKey(attachment) === attachmentKey(active)
                            ? 'border-emerald-300/35 bg-emerald-300/10 text-emerald-200'
                            : 'border-white/10 bg-white/[0.03] text-white/45'
                        }`}
                        onClick={() => setActiveAttachmentKey(attachmentKey(attachment))}
                      >
                        {attachment.format || attachment.type}
                      </Button>
                    ))}
                  </div>
                )}
                <div className="resource-preview-pane max-h-[68vh] overflow-auto rounded-lg border border-white/5 bg-black/15 p-4">
                  <ResourcePreview item={active} />
                </div>
              </>
            )}
          </HudPanel>
        </div>
      </div>

      {expanded && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-6">
          <HudPanel as="div" className="flex h-full w-full max-w-6xl flex-col overflow-hidden rounded-xl bg-[#0b0b10] p-0 shadow-2xl">
            <div className="flex items-center gap-3 border-b border-white/10 px-5 py-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-white/85">{expanded.title}</div>
                <div className="truncate text-xs text-white/35">{expanded.fileName} · {statusLabel(expanded.status)} · {shortHash(expanded.contentHash)}</div>
              </div>
              <Button
                className="rounded-lg p-2 text-white/50 transition-colors hover:bg-white/10 hover:text-white"
                onClick={() => downloadResource(expanded)}
                title="下载"
              >
                <Download className="h-4 w-4" />
              </Button>
              <Button
                className="rounded-lg p-2 text-white/50 transition-colors hover:bg-white/10 hover:text-white"
                onClick={() => setExpanded(null)}
                title="关闭"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex-1 overflow-auto p-6">
              <ResourcePreview item={expanded} expanded />
            </div>
          </HudPanel>
        </div>
      )}
    </>
  )
}

function attachmentKey(item: GeneratedResourceItem) {
  return `${item.type}:${item.path || item.fileName}`
}
