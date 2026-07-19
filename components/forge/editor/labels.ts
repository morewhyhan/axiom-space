import type { QualityIssue, RagCardStatusValue } from './types'

const CARD_TYPE_LABELS: Record<string, string> = {
  fleeting: '◇ 灵感草稿',
  literature: '○ 文献资料',
  permanent: '◆ 永久知识',
}

export function cardTypeLabel(type: string | undefined) {
  if (!type) return '◇ 灵感草稿'
  return CARD_TYPE_LABELS[type] ?? type
}

export function cardTypeTone(type: string | undefined) {
  if (type === 'permanent') return 'text-purple-400/70'
  if (type === 'literature') return 'text-pink-400/70'
  if (type === 'fleeting') return 'text-cyan-400/70'
  return 'text-emerald-300/70'
}

export function ragStatusLabel(status: RagCardStatusValue | undefined) {
  if (status === 'indexed') return '已可语义搜索'
  if (status === 'indexing') return '正在建立语义索引'
  if (status === 'failed') return '同步失败'
  if (status === 'disabled') return '未启用'
  return '等待语义索引'
}

export function ragStatusTone(status: RagCardStatusValue | undefined) {
  if (status === 'indexed') return 'text-emerald-300/75'
  if (status === 'indexing') return 'text-cyan-300/75'
  if (status === 'failed') return 'text-red-300/80'
  if (status === 'disabled') return 'text-white/30'
  return 'text-amber-300/70'
}

export function qualityDimensionLabel(dimension: QualityIssue['dimension']) {
  if (dimension === 'clarity') return '清晰'
  if (dimension === 'accuracy') return '准确'
  return '必要'
}
