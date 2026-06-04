'use client'

import { useEffect, useMemo, useState } from 'react'
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
  Plus,
  Route,
  Sparkles,
  Target,
} from 'lucide-react'
import { useLearningPaths, useGeneratePath, useDeletePath, useImportDocument, useExecuteStep, useUpdateStepProgress } from '@/hooks/use-learning'
import type { LearningPath, LearningStep } from '@/hooks/use-learning'
import { useAppStore } from '@/stores/mode-store'
import { useAgentStore } from '@/stores/agent-store'

type CreateMode = 'ai' | 'material'

function formatTime(value?: string) {
  if (!value) return '刚刚'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '刚刚'
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

function getNextStep(steps: LearningStep[]) {
  return steps.find((step) => step.status === 'available' || step.status === 'learning') ?? steps[0] ?? null
}

function statusMeta(step: LearningStep) {
  if (step.status === 'mastered' || step.status === 'completed') {
    return { label: '已完成', tone: 'text-green-300', bar: 'bg-green-400', border: 'border-green-500/30' }
  }
  if (step.status === 'learning') {
    return { label: '处理中', tone: 'text-cyan-300', bar: 'bg-cyan-400', border: 'border-cyan-500/30' }
  }
  if (step.status === 'available') {
    return { label: '可进入', tone: 'text-purple-300', bar: 'bg-purple-400', border: 'border-purple-500/30' }
  }
  return { label: '待解锁', tone: 'text-white/25', bar: 'bg-white/20', border: 'border-white/10' }
}

export default function LearnWorkspace() {
  const { data, loading, refetch } = useLearningPaths()
  const generatePath = useGeneratePath()
  const deletePath = useDeletePath()
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

  const paths = data?.paths ?? []
  const [createMode, setCreateMode] = useState<CreateMode>('ai')
  const [topic, setTopic] = useState('')
  const [level, setLevel] = useState<'beginner' | 'intermediate' | 'advanced'>('beginner')
  const [documentText, setDocumentText] = useState('')
  const [pathMaterial, setPathMaterial] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [selectedSection, setSelectedSection] = useState<'active' | 'queued' | 'done'>('active')

  useEffect(() => {
    if (data?.activePath && !selectedPathId) {
      setSelectedPathId(data.activePath)
    }
  }, [data?.activePath, selectedPathId, setSelectedPathId])

  const currentPath = useMemo(
    () => paths.find((path) => path.id === selectedPathId) ?? paths.find((path) => path.id === data?.activePath) ?? paths[0] ?? null,
    [data?.activePath, paths, selectedPathId],
  )

  const currentSteps = currentPath?.steps ?? []
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
    const active = paths.filter((path) => path.progress > 0 && path.progress < 100)
    const queued = paths.filter((path) => path.progress === 0)
    const done = paths.filter((path) => path.progress >= 100)
    return { active, queued, done }
  }, [paths])

  useEffect(() => {
    if (paths.length === 0) return
    if (selectedPathId && paths.some((path) => path.id === selectedPathId)) return
    const fallback = data?.activePath ?? paths[0]?.id ?? null
    if (fallback) setSelectedPathId(fallback)
  }, [data?.activePath, paths, selectedPathId, setSelectedPathId])

  const isEmpty = !loading && paths.length === 0
  const allDone = !!currentSteps.length && currentSteps.every((step) => step.status === 'completed' || step.status === 'mastered')
  const totalDone = currentSteps.filter((step) => step.status === 'completed' || step.status === 'mastered').length
  const totalProgress = currentSteps.length ? Math.round((totalDone / currentSteps.length) * 100) : 0
  const nextStep = getNextStep(currentSteps)

  const handleSelectPath = (path: LearningPath) => {
    setSelectedPathId(path.id)
    setActiveLearningStepId(getNextStep(path.steps)?.id ?? null)
  }

  const openStepInForge = async (step: LearningStep) => {
    if (!currentPath) return
    try {
      setActiveLearningStepId(step.id)
      let cardId = step.cardId ?? null
      if (!cardId) {
        const result = await executeStep.mutateAsync({ pathId: currentPath.id, stepId: step.id })
        cardId = result?.cardId ?? null
      }
      setSelectedNode({
        id: cardId ?? step.id,
        title: step.name,
        type: 'fleeting',
      })
      setMode('forge')
      toast.message('已打开 Forge 处理当前任务', { description: step.name })
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
        sessionId: agentSessionId ?? undefined,
      })
      if (result.evaluation?.passed) {
        toast.success(`「${step.name}」已完成，卡片已升级为永久知识`)
      } else {
        toast.message(`「${step.name}」已完成`, { description: result.evaluation?.feedback || '已更新进度' })
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
      toast.success('学习路径已创建')
    } catch (err) {
      const message = err instanceof Error ? err.message : '生成失败'
      setError(message)
      toast.error(message)
    }
  }

  const handleImportDocument = async () => {
    if (!documentText.trim()) return
    setError(null)
    try {
      const result = await importDocument.mutateAsync({
        document: documentText,
        topic: topic.trim() || '导入资料',
        sourceTitle: topic.trim() || undefined,
      })
      setDocumentText('')
      if (result.pathId) {
        setSelectedPathId(result.pathId)
      }
      toast.success('资料已导入并转成路径')
    } catch (err) {
      const message = err instanceof Error ? err.message : '导入失败'
      setError(message)
      toast.error(message)
    }
  }

  const handleDeletePath = async (pathId: string) => {
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

  const renderPathCard = (path: LearningPath, active: boolean) => {
    const done = path.progress >= 100
    const next = getNextStep(path.steps)
    return (
      <div
        key={path.id}
        role="button"
        tabIndex={0}
        onClick={() => handleSelectPath(path)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            handleSelectPath(path)
          }
        }}
        className={`w-full rounded-2xl border px-4 py-4 text-left transition-all cursor-pointer ${
          active
            ? 'border-purple-500/40 bg-purple-500/10 shadow-[0_0_24px_rgba(168,85,247,0.08)]'
            : 'border-white/8 bg-white/[0.03] hover:border-white/15 hover:bg-white/[0.05]'
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${done ? 'bg-green-400' : active ? 'bg-purple-400' : 'bg-white/20'}`} />
              <div className="truncate font-semibold text-white/90" style={{ fontSize: 'var(--f10)' }}>
                {path.name}
              </div>
            </div>
            <div className="mt-1 line-clamp-2 text-white/30" style={{ fontSize: 'var(--f8)' }}>
              {path.description || '系统会把导入资料拆成卡片任务，并按路径推进到 Forge。'}
            </div>
          </div>
          <button
            type="button"
            className="shrink-0 rounded-lg border border-white/10 px-2 py-1 text-[10px] text-white/40 hover:text-white/70 hover:border-white/20"
            onClick={(e) => {
              e.stopPropagation()
              handleDeletePath(path.id)
            }}
          >
            删除
          </button>
        </div>
        <div className="mt-3 flex items-center justify-between text-[10px]">
          <span className="mono text-white/25">{path.source || 'learning'} · {formatTime(path.createdAt)}</span>
          <span className="mono text-white/35">{path.doneCount}/{path.totalCount}</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/40">
          <div
            className={`h-full rounded-full ${done ? 'bg-green-400' : 'bg-gradient-to-r from-purple-400 to-cyan-400'}`}
            style={{ width: `${path.progress}%` }}
          />
        </div>
        <div className="mt-2 flex items-center justify-between text-[10px]">
          <span className={`mono ${done ? 'text-green-300' : 'text-purple-300'}`}>{done ? '已完成' : next ? `下一步：${next.name}` : '等待推进'}</span>
          <span className="mono text-white/20">路径任务</span>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full min-h-0 overflow-hidden">
      <div className="grid h-full min-h-0 grid-cols-[360px_minmax(0,1fr)_360px] gap-[var(--gap-grid)]">
        {/* Left: path library */}
        <aside className="glass-panel rounded-2xl overflow-hidden border-purple-500/20 shadow-[0_0_32px_rgba(168,85,247,0.06)] flex flex-col min-h-0">
          <div className="border-b border-white/5 px-5 py-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <Route className="h-4 w-4 text-purple-300" />
                  <span className="mono text-purple-300" style={{ fontSize: 'var(--f10)' }}>PATH LIBRARY</span>
                </div>
                <div className="mt-1 text-white/30" style={{ fontSize: 'var(--f8)' }}>
                  导入资料，拆成路径，再逐张送进 Forge
                </div>
              </div>
              <button
                className="rounded-lg border border-purple-500/30 bg-purple-500/10 px-3 py-1.5 text-[10px] text-purple-200 hover:bg-purple-500/15"
                onClick={() => setCreateMode(createMode === 'ai' ? 'material' : 'ai')}
              >
                <Plus className="mr-1 inline h-3 w-3" />
                新任务
              </button>
            </div>
          </div>

          <div className="border-b border-white/5 px-5 py-4 space-y-3">
            <div className="flex gap-2 rounded-xl bg-black/25 p-1">
              {[
                { id: 'ai' as const, label: 'AI 生成' },
                { id: 'material' as const, label: '导入资料' },
              ].map((item) => (
                <button
                  key={item.id}
                  className={`flex-1 rounded-lg px-3 py-2 text-[10px] mono transition-colors ${
                    createMode === item.id ? 'bg-purple-500/15 text-purple-200' : 'text-white/30 hover:text-white/60'
                  }`}
                  onClick={() => setCreateMode(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="主题 / 课程 / 概念"
              className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-white/85 outline-none placeholder:text-white/20 focus:border-purple-500/40"
              style={{ fontSize: 'var(--f9)' }}
            />

            {createMode === 'ai' ? (
              <>
                <div className="grid grid-cols-3 gap-2">
                  {(['beginner', 'intermediate', 'advanced'] as const).map((item) => (
                    <button
                      key={item}
                      onClick={() => setLevel(item)}
                      className={`rounded-lg border px-2 py-2 text-[10px] mono transition-colors ${
                        level === item ? 'border-purple-500/35 bg-purple-500/10 text-purple-200' : 'border-white/10 text-white/30 hover:text-white/60'
                      }`}
                    >
                      {item === 'beginner' ? '基础' : item === 'intermediate' ? '进阶' : '高级'}
                    </button>
                  ))}
                </div>

                <textarea
                  value={pathMaterial}
                  onChange={(e) => setPathMaterial(e.target.value)}
                  rows={5}
                  placeholder="可选：补充背景资料、目录、笔记或课程摘要"
                  className="w-full resize-none rounded-xl border border-white/10 bg-black/25 px-4 py-3 text-white/75 outline-none placeholder:text-white/20 focus:border-purple-500/35"
                  style={{ fontSize: 'var(--f9)' }}
                />

                <button
                  onClick={handleGeneratePath}
                  disabled={generatePath.isPending || !topic.trim()}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-purple-500/35 bg-purple-500/15 px-4 py-3 text-[10px] mono text-purple-200 transition-colors hover:bg-purple-500/20 disabled:opacity-40"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  {generatePath.isPending ? '生成路径中...' : '生成学习路径'}
                </button>
              </>
            ) : (
              <>
                <textarea
                  value={documentText}
                  onChange={(e) => setDocumentText(e.target.value)}
                  rows={8}
                  placeholder="粘贴学习资料全文，系统会自动抽取概念、生成节点和路径"
                  className="w-full resize-none rounded-xl border border-white/10 bg-black/25 px-4 py-3 text-white/75 outline-none placeholder:text-white/20 focus:border-cyan-500/35"
                  style={{ fontSize: 'var(--f9)' }}
                />
                <button
                  onClick={handleImportDocument}
                  disabled={importDocument.isPending || !documentText.trim()}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-cyan-500/35 bg-cyan-500/10 px-4 py-3 text-[10px] mono text-cyan-200 transition-colors hover:bg-cyan-500/15 disabled:opacity-40"
                >
                  <FileText className="h-3.5 w-3.5" />
                  {importDocument.isPending ? '导入解析中...' : '导入资料并建路径'}
                </button>
              </>
            )}

            {error && <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-[10px] mono text-red-200">{error}</div>}
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar px-4 py-4">
            {loading ? (
              <div className="rounded-2xl border border-white/5 bg-white/[0.02] px-4 py-10 text-center text-white/20 mono" style={{ fontSize: 'var(--f9)' }}>
                路径加载中...
              </div>
            ) : isEmpty ? (
              <div className="rounded-2xl border border-white/5 bg-white/[0.02] px-4 py-10 text-center">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03] text-white/25">
                  <Layers3 className="h-5 w-5" />
                </div>
                <div className="font-semibold text-white/70" style={{ fontSize: 'var(--f10)' }}>还没有学习路径</div>
                <div className="mt-1 text-white/20" style={{ fontSize: 'var(--f8)' }}>
                  导入一份资料，系统会把它拆成路径任务
                </div>
              </div>
            ) : (
              <div className="space-y-5">
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="mono text-[10px] text-purple-300/80">进行中</span>
                    <span className="mono text-[10px] text-white/25">{pathBuckets.active.length}</span>
                  </div>
                  <div className="space-y-2">
                    {pathBuckets.active.map((path) => renderPathCard(path, path.id === currentPath?.id))}
                  </div>
                </div>
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="mono text-[10px] text-cyan-300/80">待推进</span>
                    <span className="mono text-[10px] text-white/25">{pathBuckets.queued.length}</span>
                  </div>
                  <div className="space-y-2">
                    {pathBuckets.queued.map((path) => renderPathCard(path, path.id === currentPath?.id))}
                  </div>
                </div>
                <div>
                  <button
                    className="mb-2 flex w-full items-center justify-between text-left"
                    onClick={() => setSelectedSection((value) => (value === 'done' ? 'active' : 'done'))}
                  >
                    <span className="mono text-[10px] text-green-300/80">已完成</span>
                    <span className="mono text-[10px] text-white/25">{pathBuckets.done.length}</span>
                  </button>
                  {selectedSection === 'done' && (
                    <div className="space-y-2">
                      {pathBuckets.done.map((path) => renderPathCard(path, path.id === currentPath?.id))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </aside>

        {/* Center: route map */}
        <section className="glass-panel rounded-2xl overflow-hidden border-purple-500/20 shadow-[0_0_40px_rgba(168,85,247,0.05)] flex min-h-0 flex-col">
          <div className="border-b border-white/5 px-6 py-5">
            {currentPath ? (
              <>
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Target className="h-4 w-4 text-pink-300" />
                      <span className="mono text-pink-300" style={{ fontSize: 'var(--f10)' }}>LEARNING ROUTE</span>
                      {allDone && (
                        <span className="rounded-full border border-green-500/30 bg-green-500/10 px-2 py-0.5 text-[10px] mono text-green-300">
                          路径已完成
                        </span>
                      )}
                    </div>
                    <div className="mt-2 truncate text-white/90 font-semibold" style={{ fontSize: 'var(--f10)' }}>
                      {currentPath.name}
                    </div>
                    <div className="mt-1 line-clamp-2 text-white/25" style={{ fontSize: 'var(--f8)' }}>
                      {currentPath.description || '按这条路径逐张处理卡片，最后把所有步骤沉淀成 Permanent。'}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="mono text-[10px] text-white/30">{currentPath.source || 'learning'} · {formatTime(currentPath.createdAt)}</div>
                    <div className="mt-1 text-[11px] text-white/70">
                      {totalDone}/{currentSteps.length} steps
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex items-center gap-3">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-black/35">
                    <div className="h-full rounded-full bg-gradient-to-r from-purple-400 via-pink-400 to-cyan-400" style={{ width: `${totalProgress}%` }} />
                  </div>
                  <div className="mono text-[10px] text-white/35">{totalProgress}%</div>
                </div>

                <div className="mt-4 grid grid-cols-3 gap-3">
                  <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
                    <div className="mono text-[10px] text-white/25">任务总数</div>
                    <div className="mt-1 text-lg text-white/90">{currentSteps.length}</div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
                    <div className="mono text-[10px] text-white/25">下一任务</div>
                    <div className="mt-1 truncate text-sm text-cyan-200">{nextStep?.name || '无'}</div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
                    <div className="mono text-[10px] text-white/25">线程归档</div>
                    <div className="mt-1 text-sm text-purple-200">永久卡片自动归档</div>
                  </div>
                </div>
              </>
            ) : (
              <div className="rounded-2xl border border-white/8 bg-white/[0.02] px-5 py-8 text-center">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03] text-white/25">
                  <Route className="h-5 w-5" />
                </div>
                <div className="font-semibold text-white/70" style={{ fontSize: 'var(--f10)' }}>选择一条路径开始推进</div>
                <div className="mt-1 text-white/20" style={{ fontSize: 'var(--f8)' }}>
                  Learn 只负责编排，真正的知识加工发生在 Forge
                </div>
              </div>
            )}
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar px-5 py-5">
            {currentPath ? (
              <div className="space-y-6">
                {groupedSteps.map(([chapter, steps]) => {
                  const chapterDone = steps.filter((step) => step.status === 'completed' || step.status === 'mastered').length
                  const chapterNext = getNextStep(steps)
                  return (
                    <div key={chapter}>
                      <div className="mb-3 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className={`h-2.5 w-2.5 rounded-full ${chapterDone === steps.length ? 'bg-green-400' : chapterNext ? 'bg-purple-400' : 'bg-white/15'}`} />
                          <div className="font-semibold text-white/80" style={{ fontSize: 'var(--f9)' }}>{chapter}</div>
                        </div>
                        <div className="mono text-[10px] text-white/20">{chapterDone}/{steps.length}</div>
                      </div>

                      <div className="ml-4 border-l border-white/10 pl-4">
                        {steps.map((step, index) => {
                          const meta = statusMeta(step)
                          const selected = step.id === currentStep?.id
                          const done = step.status === 'completed' || step.status === 'mastered'
                          return (
                            <div key={step.id} className="relative pb-4 last:pb-0">
                              <div className={`absolute left-[-21px] top-4 h-3 w-3 rounded-full border ${meta.border} ${meta.bar} ${done ? '' : selected ? 'shadow-[0_0_10px_rgba(168,85,247,0.5)]' : ''}`} />
                              <button
                                className={`w-full rounded-2xl border px-4 py-4 text-left transition-all ${
                                  selected
                                    ? 'border-purple-500/40 bg-purple-500/10'
                                    : 'border-white/8 bg-white/[0.03] hover:border-white/15 hover:bg-white/[0.05]'
                                }`}
                                onClick={() => setActiveLearningStepId(step.id)}
                              >
                                <div className="flex items-start justify-between gap-4">
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                      <span className="truncate font-semibold text-white/90" style={{ fontSize: 'var(--f10)' }}>
                                        {step.name}
                                      </span>
                                      <span className={`mono ${meta.tone}`} style={{ fontSize: 'var(--f8)' }}>
                                        {meta.label}
                                      </span>
                                    </div>
                                    {step.desc && (
                                      <div className="mt-2 line-clamp-2 text-white/25" style={{ fontSize: 'var(--f8)' }}>
                                        {step.desc}
                                      </div>
                                    )}
                                    <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] mono text-white/25">
                                      {step.chapter && <span className="rounded-full border border-white/10 px-2 py-0.5">{step.chapter}</span>}
                                      {step.estimatedMinutes && (
                                        <span className="inline-flex items-center gap-1 rounded-full border border-white/10 px-2 py-0.5">
                                          <Clock3 className="h-3 w-3" />
                                          {step.estimatedMinutes} 分钟
                                        </span>
                                      )}
                                      {step.cardId && (
                                        <span className="inline-flex items-center gap-1 rounded-full border border-purple-500/20 px-2 py-0.5 text-purple-200/80">
                                          <BookOpen className="h-3 w-3" />
                                          绑定卡片
                                        </span>
                                      )}
                                    </div>
                                  </div>

                                  <div className="shrink-0 flex flex-col items-end gap-2">
                                    <span className="mono text-[10px] text-white/25">#{index + 1}</span>
                                    <div className="flex flex-wrap justify-end gap-2">
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          void openStepInForge(step)
                                        }}
                                        disabled={executeStep.isPending}
                                        className="inline-flex items-center gap-1 rounded-lg border border-purple-500/30 bg-purple-500/10 px-3 py-2 text-[10px] mono text-purple-200 transition-colors hover:bg-purple-500/15 disabled:opacity-40"
                                      >
                                        <ExternalLink className="h-3 w-3" />
                                        Forge
                                      </button>
                                      {step.status === 'learning' && (
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            void handleMarkComplete(step)
                                          }}
                                          disabled={updateProgress.isPending}
                                          className="inline-flex items-center gap-1 rounded-lg border border-green-500/30 bg-green-500/10 px-3 py-2 text-[10px] mono text-green-200 transition-colors hover:bg-green-500/15 disabled:opacity-40"
                                        >
                                          <CheckCircle2 className="h-3 w-3" />
                                          完成
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </button>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="flex h-full items-center justify-center rounded-2xl border border-white/5 bg-white/[0.02] px-6 text-center">
                <div>
                  <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03] text-white/25">
                    <ArrowRight className="h-5 w-5" />
                  </div>
                  <div className="font-semibold text-white/70" style={{ fontSize: 'var(--f10)' }}>路线图会显示当前路径的任务序列</div>
                  <div className="mt-1 text-white/20" style={{ fontSize: 'var(--f8)' }}>
                    点击左侧任一路径后，这里会变成可推进的任务地图
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Right: task inspector */}
        <aside className="glass-panel rounded-2xl overflow-hidden border-purple-500/20 shadow-[0_0_32px_rgba(168,85,247,0.05)] flex min-h-0 flex-col">
          <div className="border-b border-white/5 px-5 py-4">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-cyan-300" />
              <span className="mono text-cyan-300" style={{ fontSize: 'var(--f10)' }}>TASK INSPECTOR</span>
            </div>
            <div className="mt-1 text-white/30" style={{ fontSize: 'var(--f8)' }}>
              当前任务、卡片绑定和进入 Forge 的入口
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar px-4 py-4">
            {currentPath && currentStep ? (
              <div className="space-y-4">
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4">
                  <div className="mono text-[10px] text-white/25">当前路径</div>
                  <div className="mt-1 font-semibold text-white/85" style={{ fontSize: 'var(--f10)' }}>{currentPath.name}</div>
                  <div className="mt-2 text-white/25" style={{ fontSize: 'var(--f8)' }}>
                    {currentPath.description || '这条路径会在 Forge 中逐个完成并自动归档。'}
                  </div>
                </div>

                <div className="rounded-2xl border border-purple-500/20 bg-purple-500/10 px-4 py-4">
                  <div className="mono text-[10px] text-purple-200/80">当前步骤</div>
                  <div className="mt-1 font-semibold text-white/90" style={{ fontSize: 'var(--f10)' }}>{currentStep.name}</div>
                  <div className="mt-2 text-white/30" style={{ fontSize: 'var(--f8)' }}>
                    {currentStep.desc || '在 Forge 里继续对话、补材料、生成资源。'}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                    <div className="mono text-[10px] text-white/25">状态</div>
                    <div className={`mt-1 text-sm ${statusMeta(currentStep).tone}`}>{statusMeta(currentStep).label}</div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                    <div className="mono text-[10px] text-white/25">卡片绑定</div>
                    <div className="mt-1 text-sm text-white/75">{currentStep.cardId ? '已绑定' : '待生成'}</div>
                  </div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4 space-y-3">
                  <div className="mono text-[10px] text-white/25">任务信息</div>
                  <div className="flex items-center justify-between gap-3 text-[10px] mono text-white/30">
                    <span>章节</span>
                    <span className="text-white/70">{currentStep.chapter || '未分章'}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3 text-[10px] mono text-white/30">
                    <span>预计时长</span>
                    <span className="text-white/70">{currentStep.estimatedMinutes ? `${currentStep.estimatedMinutes} 分钟` : '未估算'}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3 text-[10px] mono text-white/30">
                    <span>前置条件</span>
                    <span className="text-white/70">{currentStep.prerequisites?.length ? `${currentStep.prerequisites.length} 项` : '无'}</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <button
                    onClick={() => void openStepInForge(currentStep)}
                    disabled={executeStep.isPending}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-purple-500/35 bg-purple-500/15 px-4 py-3 text-[10px] mono text-purple-200 transition-colors hover:bg-purple-500/20 disabled:opacity-40"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    进入 Forge 处理
                  </button>
                  {currentStep.status === 'learning' && (
                    <button
                      onClick={() => void handleMarkComplete(currentStep)}
                      disabled={updateProgress.isPending}
                      className="flex w-full items-center justify-center gap-2 rounded-xl border border-green-500/35 bg-green-500/10 px-4 py-3 text-[10px] mono text-green-200 transition-colors hover:bg-green-500/15 disabled:opacity-40"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      标记当前任务完成
                    </button>
                  )}
                </div>

                <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-4">
                  <div className="mono text-[10px] text-white/25">路径完成规则</div>
                  <div className="mt-2 text-white/25" style={{ fontSize: 'var(--f8)' }}>
                    这条路径下所有卡片都升级为 Permanent 后，相关会话自动归档，任务结束。
                  </div>
                  <div className="mt-3 flex items-center gap-2 text-[10px] mono text-white/25">
                    <Circle className="h-3 w-3" />
                    <span>{allDone ? '当前路径已完成' : '路径仍在推进中'}</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center rounded-2xl border border-white/5 bg-white/[0.02] px-6 text-center">
                <div>
                  <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03] text-white/25">
                    <BookOpen className="h-5 w-5" />
                  </div>
                  <div className="font-semibold text-white/70" style={{ fontSize: 'var(--f10)' }}>任务面板会显示当前卡片的加工状态</div>
                  <div className="mt-1 text-white/20" style={{ fontSize: 'var(--f8)' }}>
                    Learn 负责编排和推进，Forge 负责真正的对话和写入
                  </div>
                </div>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}
