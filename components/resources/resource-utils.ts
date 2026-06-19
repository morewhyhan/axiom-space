import type { GeneratedResourceItem } from './types'

export const RESOURCE_MIME: Record<string, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
  ppt: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  svg: 'image/svg+xml',
  video: 'text/html',
  document: 'text/markdown',
  code: 'text/markdown',
  mindmap: 'text/plain',
  diagram: 'text/plain',
  quiz: 'application/json',
}

export function downloadResource(item: GeneratedResourceItem) {
  if (!item.content) return
  const a = document.createElement('a')
  if (item.content.startsWith('data:')) {
    a.href = item.content
  } else {
    const blob = new Blob([item.content], { type: RESOURCE_MIME[item.type] || 'text/plain' })
    a.href = URL.createObjectURL(blob)
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }
  a.download = item.fileName || `${item.title}.${item.type}`
  a.click()
}

export function shortHash(hash?: string) {
  return hash ? hash.slice(0, 12) : 'no-hash'
}

export function statusLabel(status?: string) {
  if (status === 'ready') return 'DB ready'
  if (status === 'failed') return 'failed'
  if (status === 'pending') return 'pending'
  return status || 'ready'
}
