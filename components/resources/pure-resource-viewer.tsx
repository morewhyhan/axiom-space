'use client'

import { useEffect, useMemo, useState } from 'react'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui'
import { ResourcePreview } from './resource-preview'
import { downloadResource } from './resource-utils'
import type { GeneratedResourceItem } from './types'

export function PureResourceViewer({ resources, fullscreen = false }: { resources: GeneratedResourceItem[]; fullscreen?: boolean }) {
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const active = useMemo(() => {
    if (resources.length === 0) return null
    return resources.find((item) => attachmentKey(item) === activeKey) ?? resources[0]
  }, [activeKey, resources])

  useEffect(() => {
    if (resources.length === 0) {
      setActiveKey(null)
      return
    }
    if (!activeKey || !resources.some((item) => attachmentKey(item) === activeKey)) {
      setActiveKey(attachmentKey(resources[0]))
    }
  }, [activeKey, resources])

  if (!active) return null

  return (
    <div className={`flex min-h-full flex-col ${fullscreen ? 'h-full' : ''}`}>
      <div className="mb-3 flex items-center justify-end gap-2">
        {resources.length > 1 && resources.map((item) => (
          <Button
            key={attachmentKey(item)}
            className={`rounded-md border px-3 py-1.5 text-[10px] uppercase ${
              attachmentKey(item) === attachmentKey(active)
                ? 'border-cyan-300/40 bg-cyan-300/10 text-cyan-100'
                : 'border-white/10 bg-white/[0.025] text-white/45 hover:text-white/70'
            }`}
            onClick={() => setActiveKey(attachmentKey(item))}
          >
            {item.format || item.type}
          </Button>
        ))}
        <Button
          className="rounded-md border border-white/10 bg-white/[0.025] p-2 text-white/50 hover:text-white"
          onClick={() => downloadResource(active)}
          title="下载当前格式"
        >
          <Download className="h-4 w-4" />
        </Button>
      </div>
      <div className={`min-h-0 flex-1 ${fullscreen ? 'resource-preview-fullscreen' : ''}`}>
        <ResourcePreview item={active} expanded pure fullscreen={fullscreen} />
      </div>
    </div>
  )
}

function attachmentKey(item: GeneratedResourceItem) {
  return `${item.kind || item.type}:${item.format || item.type}:${item.path || item.fileName}`
}
