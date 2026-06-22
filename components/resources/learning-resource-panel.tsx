'use client'

import { useState } from 'react'
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
  const [active, setActive] = useState<GeneratedResourceItem | null>(null)
  const visibleResources = resources

  if (loading) {
    return (
      <HudPanel as="div" className="mt-6 p-5 text-center text-sm text-white/40">
        加载资源面板...
      </HudPanel>
    )
  }

  if (visibleResources.length === 0) return null

  return (
    <>
      <div className="mt-8 border-t border-white/10 pt-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <div className="mono text-purple-400 uppercase" style={{ fontSize: 'var(--f8)' }}>Generated Resources</div>
            <div className="mt-1 text-xs text-white/35">所有生成资源都在这里预览、放大和下载</div>
          </div>
          <div className="mono text-white/25" style={{ fontSize: 'var(--f8)' }}>{visibleResources.length} items</div>
        </div>
        <div className="grid gap-4">
          {visibleResources.map((item) => {
            const Icon = RESOURCE_ICON[item.type] || FileText
            return (
              <HudPanel key={`${item.type}:${item.path}`} as="div" className="rounded-xl p-4">
                <div className="mb-3 flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/8 text-white/60">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-white/80">{item.title}</div>
                    <div className="truncate text-xs text-white/30">{item.fileName}</div>
                  </div>
                  <Button
                    className="rounded-lg p-2 text-white/45 transition-colors hover:bg-white/10 hover:text-white"
                    onClick={() => setActive(item)}
                    title="放大查看"
                  >
                    <Maximize2 className="h-4 w-4" />
                  </Button>
                  <Button
                    className="rounded-lg p-2 text-white/45 transition-colors hover:bg-white/10 hover:text-white"
                    onClick={() => downloadResource(item)}
                    title="下载"
                  >
                    <Download className="h-4 w-4" />
                  </Button>
                </div>
                <div className="mb-3 grid gap-2 rounded-lg border border-emerald-400/10 bg-emerald-400/[0.035] px-3 py-2 text-[11px] text-white/45 sm:grid-cols-3">
                  <div className="truncate">
                    <span className="text-emerald-300/75">status</span> {statusLabel(item.status)}
                  </div>
                  <div className="truncate" title={item.sourceObjectId || item.sourcePath || item.path}>
                    <span className="text-emerald-300/75">db</span> {item.sourceObjectId || item.sourcePath || item.path}
                  </div>
                  <div className="truncate" title={item.contentHash || ''}>
                    <span className="text-emerald-300/75">hash</span> {shortHash(item.contentHash)}
                  </div>
                </div>
                <div className="max-h-96 overflow-auto rounded-lg border border-white/5 bg-black/15 p-4">
                  <ResourcePreview item={item} />
                </div>
              </HudPanel>
            )
          })}
        </div>
      </div>

      {active && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-6">
          <HudPanel as="div" className="flex h-full w-full max-w-6xl flex-col overflow-hidden rounded-xl bg-[#0b0b10] p-0 shadow-2xl">
            <div className="flex items-center gap-3 border-b border-white/10 px-5 py-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-white/85">{active.title}</div>
                <div className="truncate text-xs text-white/35">{active.fileName} · {statusLabel(active.status)} · {shortHash(active.contentHash)}</div>
              </div>
              <Button
                className="rounded-lg p-2 text-white/50 transition-colors hover:bg-white/10 hover:text-white"
                onClick={() => downloadResource(active)}
                title="下载"
              >
                <Download className="h-4 w-4" />
              </Button>
              <Button
                className="rounded-lg p-2 text-white/50 transition-colors hover:bg-white/10 hover:text-white"
                onClick={() => setActive(null)}
                title="关闭"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex-1 overflow-auto p-6">
              <ResourcePreview item={active} expanded />
            </div>
          </HudPanel>
        </div>
      )}
    </>
  )
}
