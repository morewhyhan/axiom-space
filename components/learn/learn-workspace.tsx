'use client'

import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { toast } from 'sonner'
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Circle,
  Clock3,
  ExternalLink,
  FileText,
  Layers3,
  Loader2,
  Plus,
  Route,
  Sparkles,
  Target,
} from 'lucide-react'
import { useLearningPaths, useGeneratePath, useDeletePath, useImportDocument, useExecuteStep, useUpdateStepProgress, useArchivePath } from '@/hooks/use-learning'
import type { LearningPath, LearningStep } from '@/hooks/use-learning'
import { useAppStore } from '@/stores/mode-store'
import { useAgentStore } from '@/stores/agent-store'

type CreateMode = 'ai' | 'material'
type PathFilter = 'active' | 'all' | 'archived'

const AI_GENERATION_STAGES = [
  { label: '理解学习目标', desc: '识别这是单一概念还是复合课程目标' },
  { label: '拆解知识模块', desc: '把主题拆成星团、任务组和前置关系' },
  { label: '匹配已有知识库', desc: '复用已有卡片，避免重复创建' },
  { label: '生成任务路径', desc: '创建可推进的学习步骤和理解卡' },
  { label: '写入知识图谱', desc: '生成星团、卡片和关系边' },
]

const DOCUMENT_IMPORT_STAGES = [
  { label: '解析资料内容', desc: '识别标题、来源、章节和核心概念' },
  { label: '匹配星团', desc: '判断资料属于已有主题还是新主题' },
  { label: '抽取灵感草稿', desc: '把资料拆成可打磨的灵感卡片' },
  { label: '生成学习路径', desc: '把概念编排成可推进的任务组' },
  { label: '同步知识图谱', desc: '写入卡片、星团和关联边' },
]

function formatTime(value?: string) {
  if (!value) return '刚刚'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '刚刚'
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

function getNextStep(steps: LearningStep[]) {
  return steps.find((step) => step.status === 'available' || step.status === 'learning') ?? steps[0] ?? null
}

function isArchivedPath(path: LearningPath) {
  return path.status === 'archived'
}

function isUnassignedTaskPath(path: LearningPath) {
  return path.source === 'unassigned' || path.id === '__unassigned_tasks__' || path.id === '__fleeting_inbox__'
}

function statusMeta(step: LearningStep) {
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

function cardTypeLabel(type?: string | null) {
  if (type === 'permanent') return '永久知识卡'
  if (type === 'literature') return '文献资料'
  return '灵感草稿'
}

function canOpenStep(step: LearningStep) {
  return step.status !== 'locked'
}

function GenerationStatusHint({ stage }: { stage: { label: string; desc: string } }) {
  return (
    <div className="learn-generation-hint">
      <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-cyan-100/80" />
      <div className="min-w-0">
        <div className="mono text-[10px] text-white/62">AI 正在{stage.label}...</div>
        <div className="mt-0.5 text-white/38" style={{ fontSize: 'var(--f8)' }}>
          {stage.desc}
        </div>
      </div>
    </div>
  )
}

function EmptyLearnPanel({
  title,
  desc,
  onCreate,
  onImport,
}: {
  title: string
  desc: string
  onCreate?: () => void
  onImport?: () => void
}) {
  return (
    <div className="learn-empty-panel glass-panel">
      <div className="learn-empty-orbit" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div className="learn-empty-icon">
        <Route className="h-5 w-5" />
      </div>
      <div className="learn-empty-kicker">PATH WORKSPACE</div>
      <h3>{title}</h3>
      <p>{desc}</p>
      {(onCreate || onImport) && (
        <div className="learn-empty-actions">
          {onCreate && (
            <button onClick={onCreate}>
              <Sparkles className="h-3.5 w-3.5" />
              生成路径
            </button>
          )}
          {onImport && (
            <button onClick={onImport}>
              <FileText className="h-3.5 w-3.5" />
              导入资料
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default function LearnWorkspace() {
  const { data, loading, refetch } = useLearningPaths()
  const generatePath = useGeneratePath()
  const deletePath = useDeletePath()
  const archivePath = useArchivePath()
  const importDocument = useImportDocument()
  const executeStep = useExecuteStep()
  const updateProgress = useUpdateStepProgress()
  const agentSessionId = useAgentStore((s) => s.sessionId)

  const selectedPathId = useAppStore((s) => s.selectedPathId)
  const setSelectedPathId = useAppStore((s) => s.setSelectedPathId)
  const activeLearningStepId = useAppStore((s) => s.activeLearningStepId)
  const setActiveLearningStepId = useAppStore((s) => s.setActiveLearningStepId)
  const setSelectedNode = useAppStore((s) => s.setSelectedNode)
  const setMode = useAppStore((s) => s.setMode)

  const paths = useMemo(() => data?.paths ?? [], [data?.paths])
  const [createPanelOpen, setCreatePanelOpen] = useState(false)
  const [createMode, setCreateMode] = useState<CreateMode>('ai')
  const [topic, setTopic] = useState('')
  const [level, setLevel] = useState<'beginner' | 'intermediate' | 'advanced'>('beginner')
  const [documentText, setDocumentText] = useState('')
  const [pathMaterial, setPathMaterial] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pathFilter, setPathFilter] = useState<PathFilter>('active')
  const [stepSessionIds, setStepSessionIds] = useState<Record<string, string>>({})
  const isGenerating = generatePath.isPending || importDocument.isPending
  const generationStages = createMode === 'material' ? DOCUMENT_IMPORT_STAGES : AI_GENERATION_STAGES
  const [generationStageIndex, setGenerationStageIndex] = useState(0)
  const currentGenerationStage = generationStages[generationStageIndex] ?? generationStages[0]

  useEffect(() => {
    if (!isGenerating) {
      setGenerationStageIndex(0)
      return
    }
    setGenerationStageIndex(0)
    const id = setInterval(() => {
      setGenerationStageIndex((index) => Math.min(index + 1, generationStages.length - 1))
    }, 2400)
    return () => clearInterval(id)
  }, [generationStages.length, isGenerating])

  useEffect(() => {
    if (data?.activePath && !selectedPathId) {
      setSelectedPathId(data.activePath)
    }
  }, [data?.activePath, selectedPathId, setSelectedPathId])

  const currentPath = useMemo(
    () => paths.find((path) => path.id === selectedPathId)
      ?? paths.find((path) => path.id === data?.activePath && !isArchivedPath(path))
      ?? paths.find((path) => !isArchivedPath(path))
      ?? paths[0]
      ?? null,
    [data?.activePath, paths, selectedPathId],
  )

  const currentSteps = useMemo(() => currentPath?.steps ?? [], [currentPath?.steps])
  const currentStep = useMemo(() => {
    if (!currentSteps.length) return null
    return currentSteps.find((step) => step.id === activeLearningStepId) ?? getNextStep(currentSteps)
  }, [activeLearningStepId, currentSteps])

  useEffect(() => {
    if (!currentPath) {
      setActiveLearningStepId(null)
      return
    }
    const next = getNextStep(currentSteps)
    if (!currentSteps.some((step) => step.id === activeLearningStepId)) {
      setActiveLearningStepId(next?.id ?? null)
    }
  }, [activeLearningStepId, currentPath, currentSteps, setActiveLearningStepId])

  const groupedSteps = useMemo(() => {
    const groups = currentSteps.reduce<Record<string, LearningStep[]>>((acc, step) => {
      const chapter = step.chapter?.trim() || '未分章'
      if (!acc[chapter]) acc[chapter] = []
      acc[chapter].push(step)
      return acc
    }, {})
    return Object.entries(groups)
  }, [currentSteps])

  const pathBuckets = useMemo(() => {
    const visible = paths.filter((path) => {
      if (pathFilter === 'all') return true
      return pathFilter === 'archived' ? isArchivedPath(path) : !isArchivedPath(path)
    })
    const inbox = visible.filter(isUnassignedTaskPath)
    const active = visible.filter((path) => !isUnassignedTaskPath(path) && path.progress > 0 && path.progress < 100)
    const queued = visible.filter((path) => !isUnassignedTaskPath(path) && path.progress === 0)
    const done = visible.filter((path) => !isUnassignedTaskPath(path) && path.progress >= 100)
    return { inbox, active, queued, done, visible }
  }, [pathFilter, paths])

  useEffect(() => {
    if (paths.length === 0) return
    if (selectedPathId && paths.some((path) => path.id === selectedPathId)) return
    const fallback = data?.activePath
      ?? paths.find((path) => !isArchivedPath(path))?.id
      ?? paths[0]?.id
      ?? null
    if (fallback) setSelectedPathId(fallback)
  }, [data?.activePath, paths, selectedPathId, setSelectedPathId])

  const isEmpty = !loading && paths.length === 0
  const allDone = !!currentSteps.length && currentSteps.every((step) => step.status === 'completed' || step.status === 'mastered')
  const totalDone = currentSteps.filter((step) => step.status === 'completed' || step.status === 'mastered').length
  const totalProgress = currentSteps.length ? Math.round((totalDone / currentSteps.length) * 100) : 0
  const sparsePath = !!currentPath && groupedSteps.length <= 1
  const emptyStepArea = !currentPath || groupedSteps.length === 0

  const handleSelectPath = (path: LearningPath) => {
    setSelectedPathId(path.id)
    setActiveLearningStepId(getNextStep(path.steps)?.id ?? null)
  }

  const openStepInForge = async (step: LearningStep) => {
    if (!currentPath) return
    if (!canOpenStep(step)) {
      toast.error(step.lockedReason || '需要先完成前置任务')
      return
    }
    if (isUnassignedTaskPath(currentPath)) {
      const cardId = step.cardId
      if (!cardId) {
        toast.error('这张灵感草稿缺少有效 ID')
        return
      }
      const cardTitle = step.cardTitle || step.name
      const cardType = step.cardType || 'fleeting'
      setActiveLearningStepId(step.id)
      setSelectedNode({ id: cardId, title: cardTitle, type: cardType })
      await useAgentStore.getState().openCardThread({ id: cardId, title: cardTitle, type: cardType })
      setMode('forge')
      toast.message('已打开 AI 工作台打磨灵感草稿', { description: cardTitle })
      return
    }
    try {
      setActiveLearningStepId(step.id)
      const result = await executeStep.mutateAsync({ pathId: currentPath.id, stepId: step.id })
      if (result.pathId) setSelectedPathId(result.pathId)
      if (result.stepId) setActiveLearningStepId(result.stepId)
      setStepSessionIds((prev) => ({ ...prev, [result.stepId || step.id]: result.id }))
      const cardId = result?.cardId ?? step.cardId ?? null
      if (!cardId) {
        toast.error('当前任务还没有理解卡，无法打开 AI 工作台')
        return
      }
      setSelectedNode({
        id: cardId,
        title: result.cardTitle || step.cardTitle || step.name,
        type: result.cardType || 'fleeting',
      })
      await useAgentStore.getState().loadSessions()
      await useAgentStore.getState().switchSession(result.id)
      setMode('forge')
      toast.message('已打开 AI 工作台打磨当前任务', { description: step.name })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '无法打开任务')
    }
  }

  const handleMarkComplete = async (step: LearningStep) => {
    if (!currentPath) return
    try {
      const result = await updateProgress.mutateAsync({
        pathId: currentPath.id,
        stepId: step.id,
        status: 'completed',
        sessionId: stepSessionIds[step.id] ?? agentSessionId ?? undefined,
      })
      if (result.evaluation) {
        if (result.evaluation.passed) {
          toast.success(`「${step.name}」已掌握，可继续发起卡片升级`)
        } else {
          toast.error(result.evaluation.feedback || `「${step.name}」尚未通过评估，请继续学习`)
        }
      } else {
        toast.message(`「${step.name}」已更新`, { description: '已更新进度' })
      }
      if (result.cardUpgraded) {
        refetch()
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '更新失败')
    }
  }

  const handleGeneratePath = async () => {
    if (!topic.trim()) return
    setError(null)
    try {
      const path = await generatePath.mutateAsync({
        topic: topic.trim(),
        level,
        mode: 'full',
        material: pathMaterial.trim() || undefined,
      })
      setSelectedPathId(path.id)
      setActiveLearningStepId(getNextStep(path.steps)?.id ?? null)
      setTopic('')
      setPathMaterial('')
      setCreatePanelOpen(false)
      const createdCount = path.createdPathCount ?? path.paths?.length ?? 1
      toast.success(createdCount > 1 ? `已创建 ${createdCount} 条学习路径` : '学习路径已创建')
    } catch (err) {
      const message = err instanceof Error ? err.message : '生成失败'
      setError(message)
      toast.error(message)
    }
  }

  const handleImportDocument = async () => {
    if (!documentText.trim()) return
    if (!topic.trim()) {
      toast.error('请先填写资料所属主题，系统会据此匹配已有星团')
      return
    }
    setError(null)
    try {
      const result = await importDocument.mutateAsync({
        document: documentText,
        topic: topic.trim(),
        sourceTitle: topic.trim(),
      })
      setDocumentText('')
      if (result.pathId) {
        setSelectedPathId(result.pathId)
      }
      setCreatePanelOpen(false)
      toast.success('资料已导入并转成路径')
    } catch (err) {
      const message = err instanceof Error ? err.message : '导入失败'
      setError(message)
      toast.error(message)
    }
  }

  const handleDeletePath = async (pathId: string) => {
    if (pathId === '__unassigned_tasks__' || pathId === '__fleeting_inbox__') return
    const path = paths.find((item) => item.id === pathId)
    if (!window.confirm(`确定删除「${path?.name || '这条路径'}」？相关学习线程也会一起移除。`)) return
    try {
      await deletePath.mutateAsync(pathId)
      if (selectedPathId === pathId) {
        const fallback = paths.find((path) => path.id !== pathId)?.id ?? null
        setSelectedPathId(fallback)
        setActiveLearningStepId(null)
      }
      toast.message('路径已删除')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败')
    }
  }

  const handleArchivePath = async (path: LearningPath, archived: boolean) => {
    if (isUnassignedTaskPath(path)) return
    try {
      await archivePath.mutateAsync({ pathId: path.id, archived })
      if (selectedPathId === path.id && archived) {
        const fallback = paths.find((item) => item.id !== path.id && !isArchivedPath(item))?.id ?? null
        setSelectedPathId(fallback)
        setActiveLearningStepId(null)
      }
      toast.message(archived ? '学习路径已归档' : '学习路径已恢复')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '更新归档状态失败')
    }
  }

  const renderPathCapsule = (path: LearningPath, active: boolean) => {
    const done = path.progress >= 100 || isArchivedPath(path)
    const progress = Math.max(0, Math.min(100, Math.round(path.progress || 0)))
    const age = formatTime(path.updatedAt ?? path.createdAt)
    return (
      <button
        key={path.id}
        type="button"
        onClick={() => handleSelectPath(path)}
        className={`learn-path-capsule${active ? ' active' : ''}${done ? ' done' : ''}${path.progress > 0 && !done ? ' in-progress' : ''}`}
        style={{ '--path-progress': `${progress}%` } as CSSProperties}
      >
        <span className={`learn-path-capsule-dot${done ? ' done' : active ? ' active' : ''}`} />
        <span className="learn-path-capsule-main">
          <span className="learn-path-capsule-name">{path.name}</span>
          <span className="learn-path-capsule-meta">
            <span>{age}</span>
            <span>{path.difficulty || 'path'}</span>
          </span>
        </span>
        <span className="learn-path-capsule-count">{path.doneCount}/{path.totalCount}</span>
      </button>
    )
  }

  return (
    <div className="learn-workspace">
      <div className="learn-orbit-grid">
        <aside className="learn-path-sidebar">
          <div className="learn-filter-dock">
              {[
                { id: 'active' as const, label: '进行中' },
                { id: 'all' as const, label: '全部' },
                { id: 'archived' as const, label: '归档' },
              ].map((item) => (
                <button
                  key={item.id}
                  className={`learn-filter-pill${pathFilter === item.id ? ' active' : ''}`}
                  onClick={() => setPathFilter(item.id)}
                >
                  {item.label}
                </button>
              ))}
          </div>

          <div className="learn-path-scroll no-scrollbar">
            {loading ? (
              <div className="learn-empty-state">路径加载中...</div>
            ) : isEmpty ? (
              <div className="learn-empty-state">
                <div>还没有学习路径</div>
                <span>输入主题或导入资料</span>
              </div>
            ) : pathBuckets.visible.length === 0 ? (
              <div className="learn-empty-state">
                {pathFilter === 'archived' ? '暂无已归档路径' : '暂无符合筛选的路径'}
              </div>
            ) : (
              <div className="learn-path-groups">
                {pathBuckets.inbox.length > 0 && (
                  <div className="learn-path-group">
                    <div className="learn-path-group-label"><Layers3 className="h-3 w-3" />草稿箱</div>
                    <div className="space-y-1">
                      {pathBuckets.inbox.map((path) => renderPathCapsule(path, path.id === currentPath?.id))}
                    </div>
                  </div>
                )}
                {(pathBuckets.active.length > 0 || pathBuckets.queued.length > 0) && (
                  <div className="learn-path-group">
                    <div className="learn-path-group-label"><Route className="h-3 w-3" />学习路径</div>
                    <div className="space-y-1">
                      {pathBuckets.active.map((path) => renderPathCapsule(path, path.id === currentPath?.id))}
                      {pathBuckets.queued.map((path) => renderPathCapsule(path, path.id === currentPath?.id))}
                    </div>
                  </div>
                )}
                {pathBuckets.done.length > 0 && (
                  <div className="learn-path-group">
                    <div className="learn-path-group-label"><CheckCircle2 className="h-3 w-3" />
                      {pathFilter === 'archived' ? '已归档' : '已完成'}
                    </div>
                    <div className="space-y-1">
                      {pathBuckets.done.map((path) => renderPathCapsule(path, path.id === currentPath?.id))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="learn-create-shell">
            {!createPanelOpen ? (
              <button
                className="learn-create-button"
                onClick={() => setCreatePanelOpen(true)}
              >
                <Plus className="h-3 w-3" />
                新任务
              </button>
            ) : (
              <div className="learn-create-panel">
                <div className="learn-create-tabs">
                  {[
                    { id: 'ai' as const, label: 'AI' },
                    { id: 'material' as const, label: '导入' },
                  ].map((item) => (
                    <button
                      key={item.id}
                      className={`learn-create-tab${createMode === item.id ? ' active' : ''}`}
                      onClick={() => setCreateMode(item.id)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
                <input
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder={createMode === 'material' ? '匹配星团主题' : '主题/课程/概念'}
                  className="learn-input"
                />
                {createMode === 'ai' ? (
                  <>
                    <textarea
                      value={pathMaterial}
                      onChange={(e) => setPathMaterial(e.target.value)}
                      rows={3}
                      placeholder="补充目标、资料或限制（可选）"
                      className="learn-input learn-textarea"
                    />
                    <div className="learn-level-grid">
                      {(['beginner', 'intermediate', 'advanced'] as const).map((item) => (
                        <button
                          key={item}
                          onClick={() => setLevel(item)}
                          className={`learn-level-pill${level === item ? ' active' : ''}`}
                        >
                          {item === 'beginner' ? '基础' : item === 'intermediate' ? '进阶' : '高级'}
                        </button>
                      ))}
                    </div>
                    <button
                      onClick={handleGeneratePath}
                      disabled={generatePath.isPending || !topic.trim()}
                      className="learn-submit-button"
                    >
                      <Sparkles className="h-3 w-3" />
                      {generatePath.isPending ? currentGenerationStage.label : '生成路径'}
                    </button>
                    {generatePath.isPending && <GenerationStatusHint stage={currentGenerationStage} />}
                  </>
                ) : (
                  <>
                    <textarea
                      value={documentText}
                      onChange={(e) => setDocumentText(e.target.value)}
                      rows={4}
                      placeholder="粘贴资料全文"
                      className="learn-input learn-textarea"
                    />
                    <button
                      onClick={handleImportDocument}
                      disabled={importDocument.isPending || !documentText.trim() || !topic.trim()}
                      className="learn-submit-button"
                    >
                      <FileText className="h-3 w-3" />
                      {importDocument.isPending ? currentGenerationStage.label : '导入并生成'}
                    </button>
                    {importDocument.isPending && <GenerationStatusHint stage={currentGenerationStage} />}
                  </>
                )}
                {error && (
                  <div className="learn-form-error">{error}</div>
                )}
                <button
                  className="learn-collapse-button"
                  onClick={() => { setCreatePanelOpen(false); setError(null) }}
                >
                  收起
                </button>
              </div>
            )}
          </div>
        </aside>

        <section className={`learn-detail${!currentPath ? ' empty' : ''}${sparsePath ? ' sparse' : ''}`}>
          {currentPath && (
            <section
              className="learn-route-header glass-panel"
              style={{ '--path-progress': `${totalProgress}%` } as CSSProperties}
            >
              <div>
                <div className="learn-route-main">
                  <div className="learn-route-emblem">
                    <Route className="h-4 w-4" />
                  </div>
                  <div className="learn-route-copy">
                    <div className="learn-route-eyebrow">
                      <Target className="h-3 w-3" />
                      PATH ORCHESTRATION
                    </div>
                    <div className="learn-route-title-row">
                      <h2>{currentPath.name}</h2>
                      <span className="learn-route-count">{totalDone}/{currentSteps.length} steps</span>
                    </div>
                    {currentPath.description && (
                      <p className="learn-route-description">{currentPath.description}</p>
                    )}
                  </div>
                  <div className="learn-route-actions">
                    {allDone && (
                      <span className="learn-route-chip done">已完成</span>
                    )}
                    {!isUnassignedTaskPath(currentPath) && (
                      <>
                        <button
                          className="learn-route-action"
                          onClick={() => handleArchivePath(currentPath, !isArchivedPath(currentPath))}
                        >
                          {isArchivedPath(currentPath) ? '恢复' : '归档'}
                        </button>
                        <button
                          className="learn-route-action danger"
                          onClick={() => handleDeletePath(currentPath.id)}
                        >
                          删除
                        </button>
                      </>
                    )}
                  </div>
                </div>

                <div className="learn-progress-row">
                  <div className="learn-progress-track">
                    <div className="learn-progress-fill" />
                  </div>
                  <span>{totalProgress}%</span>
                </div>
              </div>
            </section>
          )}

          <div className={`learn-step-scroll no-scrollbar${sparsePath ? ' sparse' : ''}${emptyStepArea ? ' empty' : ''}`}>
            {currentPath ? (
              groupedSteps.length > 0 ? (
                <div className={`learn-chapter-stack${sparsePath ? ' sparse' : ''}`}>
                  {groupedSteps.map(([chapter, steps], chapterIndex) => {
                    const chapterDone = steps.filter((step) => step.status === 'completed' || step.status === 'mastered').length
                    const chapterNext = getNextStep(steps)
                    return (
                      <section
                        key={chapter}
                        className="learn-chapter-card glass-panel"
                        style={{ '--chapter-delay': `${chapterIndex * 46}ms` } as CSSProperties}
                      >
                        <div className="learn-chapter-head">
                          <div>
                            <span className={`learn-chapter-dot ${chapterDone === steps.length ? 'done' : chapterNext ? 'active' : ''}`} />
                            <h3>{chapter}</h3>
                          </div>
                          <span>{chapterDone}/{steps.length}</span>
                        </div>

                        <div className="learn-step-list">
                          {steps.map((step) => {
                            const meta = statusMeta(step)
                            const selected = step.id === currentStep?.id
                            const done = step.status === 'completed' || step.status === 'mastered'
                            const sessionId = stepSessionIds[step.id]
                            return (
                              <div
                                key={step.id}
                                onClick={() => setActiveLearningStepId(step.id)}
                                className={`learn-step-card${selected ? ' selected' : ''}${done ? ' done' : ''}`}
                                style={{ '--step-delay': `${Math.min(step.index, 10) * 18}ms` } as CSSProperties}
                              >
                                <div className="learn-step-content">
                                  <span className={`learn-step-orb ${meta.state}`}>
                                    {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5" />}
                                  </span>
                                  <div className="learn-step-copy">
                                    <div className="learn-step-title-row">
                                      <h4>{step.name}</h4>
                                      <span className={`learn-step-badge ${meta.state}`}>
                                        <span className={meta.bar} />
                                        <span className={meta.tone}>{meta.label}</span>
                                      </span>
                                    </div>
                                    {step.desc && (
                                      <p>{step.desc}</p>
                                    )}
                                    <div className="learn-step-meta">
                                      {step.estimatedMinutes && <span><Clock3 className="h-3 w-3" />{step.estimatedMinutes} min</span>}
                                      {step.cardType && <span><BookOpen className="h-3 w-3" />{cardTypeLabel(step.cardType)}</span>}
                                      {step.concept && <span>{step.concept}</span>}
                                    </div>
                                  </div>
                                  <div className="learn-step-actions">
                                    {canOpenStep(step) && (
                                      <button
                                        onClick={(e) => { e.stopPropagation(); void openStepInForge(step) }}
                                        className="learn-step-action"
                                      >
                                        <ExternalLink className="h-3 w-3" />
                                        AI 工作台
                                      </button>
                                    )}
                                    {sessionId && (
                                      <button
                                        onClick={(e) => { e.stopPropagation(); void openStepInForge(step) }}
                                        className="learn-step-action"
                                      >
                                        <ArrowRight className="h-3 w-3" />
                                        继续
                                      </button>
                                    )}
                                    {(step.status === 'learning' || step.status === 'available') && (
                                      <button
                                        onClick={(e) => { e.stopPropagation(); handleMarkComplete(step) }}
                                        className="learn-step-action complete"
                                      >
                                        <CheckCircle2 className="h-3 w-3" />
                                        完成
                                      </button>
                                    )}
                                  </div>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </section>
                    )
                  })}
                </div>
              ) : (
                <EmptyLearnPanel
                  title="这条路径还没有任务"
                  desc="路径已经建立，但还没有可推进的步骤。可以重新导入资料，或从主题生成新的任务结构。"
                  onCreate={() => { setCreateMode('ai'); setCreatePanelOpen(true) }}
                  onImport={() => { setCreateMode('material'); setCreatePanelOpen(true) }}
                />
              )
            ) : (
              <EmptyLearnPanel
                title="当前还没有学习路径"
                desc="输入一个主题，或导入一份资料，AXIOM 会把它整理成可以推进的任务路径。"
                onCreate={() => { setCreateMode('ai'); setCreatePanelOpen(true) }}
                onImport={() => { setCreateMode('material'); setCreatePanelOpen(true) }}
              />
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
