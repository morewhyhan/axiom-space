import type { LearningPath, LearningStep } from '@/hooks/use-learning'
import type { CreateMode, GenerationStage, PathFilter } from './types'

export const AI_GENERATION_STAGES: GenerationStage[] = [
  { label: '理解学习目标', desc: '识别这是单一概念还是复合课程目标' },
  { label: '拆解知识模块', desc: '把主题拆成星团、任务组和前置关系' },
  { label: '匹配已有知识库', desc: '复用已有卡片，避免重复创建' },
  { label: '生成任务路径', desc: '创建可推进的学习步骤和理解卡' },
  { label: '写入知识图谱', desc: '生成星团、卡片和关系边' },
]

export const DOCUMENT_IMPORT_STAGES: GenerationStage[] = [
  { label: '解析资料内容', desc: '识别标题、来源、章节和核心概念' },
  { label: '匹配星团', desc: '判断资料属于已有主题还是新主题' },
  { label: '抽取灵感草稿', desc: '把资料拆成可打磨的灵感卡片' },
  { label: '生成学习路径', desc: '把概念编排成可推进的任务组' },
  { label: '同步知识图谱', desc: '写入卡片、星团和关联边' },
]

export const PATH_FILTER_OPTIONS: Array<{ value: PathFilter; label: string }> = [
  { value: 'active', label: '进行中' },
  { value: 'all', label: '全部' },
  { value: 'archived', label: '归档' },
]

export const CREATE_MODE_OPTIONS: Array<{ value: CreateMode; label: string }> = [
  { value: 'ai', label: 'AI' },
  { value: 'material', label: '导入' },
]

export const LEVEL_OPTIONS: Array<{ value: 'beginner' | 'intermediate' | 'advanced'; label: string }> = [
  { value: 'beginner', label: '基础' },
  { value: 'intermediate', label: '进阶' },
  { value: 'advanced', label: '高级' },
]

export function formatTime(value?: string) {
  if (!value) return '刚刚'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '刚刚'
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

export function getNextStep(steps: LearningStep[]) {
  return steps.find((step) => step.status === 'available' || step.status === 'learning') ?? steps[0] ?? null
}

export function isArchivedPath(path: LearningPath) {
  return path.status === 'archived'
}

export function isUnassignedTaskPath(path: LearningPath) {
  return path.source === 'unassigned' || path.id === '__unassigned_tasks__' || path.id === '__fleeting_inbox__'
}

export function statusMeta(step: LearningStep) {
  if (step.status === 'mastered') {
    return { label: '已掌握', tone: 'text-green-300', bar: 'bg-green-400', border: 'border-green-500/30', state: 'done' }
  }
  if (step.status === 'completed') {
    return { label: '任务已完成', tone: 'text-green-300', bar: 'bg-green-400', border: 'border-green-500/30', state: 'done' }
  }
  if (step.status === 'learning') {
    return { label: '学习中', tone: 'text-cyan-300', bar: 'bg-cyan-400', border: 'border-cyan-500/30', state: 'active' }
  }
  if (step.status === 'available') {
    return { label: '可开始', tone: 'text-cyan-200', bar: 'bg-cyan-300', border: 'border-cyan-300/25', state: 'ready' }
  }
  return { label: '前置未满足', tone: 'text-white/34', bar: 'bg-white/20', border: 'border-white/10', state: 'locked' }
}

export function cardTypeLabel(type?: string | null) {
  if (type === 'permanent') return '永久知识卡'
  if (type === 'literature') return '文献资料'
  return '灵感草稿'
}

export function canOpenStep(step: LearningStep) {
  return step.status !== 'locked'
}
