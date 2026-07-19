'use client'

import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { CheckCircle2, FileText, LayoutDashboard, Loader2, Route } from 'lucide-react'
import { toast } from '@/lib/ui-feedback'
import {
  AI_GENERATION_STAGES,
  AssessmentPanel,
  ChapterStack,
  CreatePathPanel,
  DOCUMENT_IMPORT_STAGES,
  EmptyLearnPanel,
  PathSidebar,
  PushSuggestionDetailPanel,
  PushSuggestionBox,
  RouteHeader,
  canOpenStep,
  getNextStep,
  isArchivedPath,
  isUnassignedTaskPath,
  type CreateMode,
  type PathFilter,
} from './workspace'
import {
  type PushSuggestion,
  useArchivePath,
  useDeletePath,
  useExecuteStep,
  useGeneratePath,
  useImportDocument,
  useDocumentImportProgress,
  useLearningPaths,
  usePathAdjustments,
  useUpdateStepProgress,
} from '@/hooks/use-learning'
import type { AssessmentEvaluation, LearningPath, LearningStep } from '@/hooks/use-learning'
import { useAppStore } from '@/stores/mode-store'
import { useAgentStore } from '@/stores/agent-store'
import type { ImportFilePayload } from '@/lib/import-files'
import { HudPanel } from '@/components/ui'

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
  const [documentFile, setDocumentFile] = useState<ImportFilePayload | null>(null)
  const [pathMaterial, setPathMaterial] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [lastAssessment, setLastAssessment] = useState<{
    stepId: string
    stepName: string
    evaluation: AssessmentEvaluation
  } | null>(null)
  const [pathFilter, setPathFilter] = useState<PathFilter>('active')
  const [stepSessionIds, setStepSessionIds] = useState<Record<string, string>>({})
  const [selectedPushSuggestion, setSelectedPushSuggestion] = useState<PushSuggestion | null>(null)
  const [importJobId, setImportJobId] = useState<string | null>(null)
  const [importCompletion, setImportCompletion] = useState<{
    pathId: string
    pathName: string
    stepCount: number
    sourceTitle: string
  } | null>(null)
  const importProgress = useDocumentImportProgress(importJobId)
  const generationStages = createMode === 'material' ? DOCUMENT_IMPORT_STAGES : AI_GENERATION_STAGES
  const [generationStageIndex, setGenerationStageIndex] = useState(0)
  const currentGenerationStage = createMode === 'material' && importProgress.data
    ? { label: `${importProgress.data.label} · ${importProgress.data.progress}%`, desc: importProgress.data.message }
    : generationStages[generationStageIndex] ?? generationStages[0]
  const importProgressPercent = importDocument.isPending
    ? Math.max(8, importProgress.data?.progress ?? 12)
    : importCompletion
      ? 100
      : 0

  useEffect(() => {
    if (!generatePath.isPending) {
      setGenerationStageIndex(0)
      return
    }
    setGenerationStageIndex(0)
    const id = setInterval(() => {
      setGenerationStageIndex((index) => Math.min(index + 1, generationStages.length - 1))
    }, 2400)
    return () => clearInterval(id)
  }, [generatePath.isPending, generationStages.length])

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
  const pathAdjustments = usePathAdjustments(currentPath?.id)
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
    setSelectedPushSuggestion(null)
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
        setLastAssessment({
          stepId: step.id,
          stepName: step.name,
          evaluation: result.evaluation,
        })
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
    if (!documentText.trim() && !documentFile) return
    if (!topic.trim()) {
      toast.error('请先填写资料所属主题，系统会据此匹配已有星团')
      return
    }
    setError(null)
    setImportCompletion(null)
    const jobId = globalThis.crypto.randomUUID()
    setImportJobId(jobId)
    try {
      const result = await importDocument.mutateAsync({
        jobId,
        ...(documentText.trim() ? { document: documentText.trim() } : {}),
        ...(documentFile?.fileText ? { fileText: documentFile.fileText } : {}),
        ...(documentFile?.fileBase64 ? { fileBase64: documentFile.fileBase64 } : {}),
        topic: topic.trim(),
        sourceTitle: topic.trim(),
        source: documentFile?.originalFileName || topic.trim(),
        originalFileName: documentFile?.originalFileName,
        sourceMimeType: documentFile?.sourceMimeType,
        conversionKind: documentFile?.conversionKind,
      })
      setDocumentText('')
      setDocumentFile(null)
      if (result.pathId) {
        setSelectedPathId(result.pathId)
      }
      setCreatePanelOpen(false)
      setImportCompletion({
        pathId: result.pathId ?? '',
        pathName: `${topic.trim()} 资料学习路径`,
        stepCount: (result.concepts?.length ?? 0) + 1,
        sourceTitle: result.docTitle || topic.trim(),
      })
      toast.success('资料已导入并转成路径')
    } catch (err) {
      const message = err instanceof Error ? err.message : '导入失败'
      setError(message)
      toast.error(message)
      setImportCompletion(null)
      setImportJobId(null)
    }
  }

  const handleOpenDashboardAfterImport = () => {
    if (importCompletion?.pathId) {
      setSelectedPathId(importCompletion.pathId)
    }
    setImportCompletion(null)
    setImportJobId(null)
    setMode('dashboard')
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

  return (
    <div className="learn-workspace">
      {(importDocument.isPending || importCompletion) && (
        <DocumentImportOverlay
          pending={importDocument.isPending}
          progress={importProgressPercent}
          stage={currentGenerationStage}
          completion={importCompletion}
          onOpenDashboard={handleOpenDashboardAfterImport}
        />
      )}
      <div className="learn-orbit-grid">
        <PathSidebar
          loading={loading}
          isEmpty={isEmpty}
          pathFilter={pathFilter}
          pathBuckets={pathBuckets}
          currentPathId={currentPath?.id}
          onPathFilterChange={setPathFilter}
          onSelectPath={handleSelectPath}
          pushBox={(
            <PushSuggestionBox
              pathId={currentPath?.id}
              selectedId={selectedPushSuggestion?.id}
              onSelect={setSelectedPushSuggestion}
            />
          )}
          createPanel={(
            <CreatePathPanel
              open={createPanelOpen}
              createMode={createMode}
              topic={topic}
              level={level}
              documentText={documentText}
              documentFileName={documentFile?.originalFileName ?? null}
              pathMaterial={pathMaterial}
              error={error}
              currentGenerationStage={currentGenerationStage}
              generatePending={generatePath.isPending}
              importPending={importDocument.isPending}
              onOpen={() => setCreatePanelOpen(true)}
              onClose={() => { setCreatePanelOpen(false); setError(null); setDocumentFile(null) }}
              onCreateModeChange={(mode) => { setCreateMode(mode); setError(null) }}
              onTopicChange={setTopic}
              onLevelChange={setLevel}
              onDocumentTextChange={setDocumentText}
              onDocumentFileLoaded={setDocumentFile}
              onPathMaterialChange={setPathMaterial}
              onGeneratePath={handleGeneratePath}
              onImportDocument={handleImportDocument}
            />
          )}
        />

        <section className={`learn-detail${!currentPath && !selectedPushSuggestion ? ' empty' : ''}${sparsePath && !selectedPushSuggestion ? ' sparse' : ''}`}>
          {selectedPushSuggestion ? (
            <PushSuggestionDetailPanel
              suggestion={selectedPushSuggestion}
              onClose={() => setSelectedPushSuggestion(null)}
            />
          ) : currentPath && (
            <>
              <RouteHeader
                path={currentPath}
                steps={currentSteps}
                adjustmentHistory={pathAdjustments.data?.adjustmentHistory ?? []}
                adjustmentsLoading={pathAdjustments.loading}
                totalDone={totalDone}
                totalProgress={totalProgress}
                allDone={allDone}
                onArchivePath={handleArchivePath}
                onDeletePath={handleDeletePath}
              />
              {lastAssessment && (
                <AssessmentPanel
                  stepName={lastAssessment.stepName}
                  evaluation={lastAssessment.evaluation}
                  step={currentSteps.find((step) => step.id === lastAssessment.stepId) ?? null}
                  onClose={() => setLastAssessment(null)}
                  onOpenStep={openStepInForge}
                />
              )}
            </>
          )}

          {!selectedPushSuggestion && (
          <div className={`learn-step-scroll no-scrollbar${sparsePath ? ' sparse' : ''}${emptyStepArea ? ' empty' : ''}`}>
            {currentPath ? (
              groupedSteps.length > 0 ? (
                <ChapterStack
                  groupedSteps={groupedSteps}
                  sparse={sparsePath}
                  currentStepId={currentStep?.id}
                  stepSessionIds={stepSessionIds}
                  onSelectStep={setActiveLearningStepId}
                  onOpenStep={openStepInForge}
                  onMarkComplete={handleMarkComplete}
                />
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
          )}
        </section>
      </div>
    </div>
  )
}

function DocumentImportOverlay({
  pending,
  progress,
  stage,
  completion,
  onOpenDashboard,
}: {
  pending: boolean
  progress: number
  stage: { label: string; desc?: string }
  completion: {
    pathId: string
    pathName: string
    stepCount: number
    sourceTitle: string
  } | null
  onOpenDashboard: () => void
}) {
  const safeProgress = Math.min(100, Math.max(0, Math.round(progress)))

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/45 px-6 backdrop-blur-md"
      role="status"
      aria-live="polite"
    >
      <HudPanel
        as="div"
        className={`learn-import-modal relative w-[min(560px,calc(100vw-56px))] overflow-hidden rounded-[26px] border-cyan-200/15 bg-black/70 px-9 py-8 text-center shadow-[0_34px_110px_rgba(0,0,0,0.52),0_0_70px_rgba(34,211,238,0.12)]${completion ? ' complete' : ''}`}
        data-state={pending ? 'running' : 'complete'}
        style={{ '--import-progress': `${safeProgress}%` } as CSSProperties}
      >
        <div className="learn-import-orb">
          {completion ? <CheckCircle2 className="h-8 w-8" /> : <Loader2 className="h-8 w-8 animate-spin" />}
        </div>

        <div className="learn-import-kicker">
          {completion ? 'MATERIAL IMPORT COMPLETE' : 'MATERIAL TO KNOWLEDGE GRAPH'}
        </div>

        <h3>
          {completion ? '资料已经生成学习路径' : '正在把资料转成可学习的知识结构'}
        </h3>

        <p>
          {completion
            ? `《${completion.sourceTitle}》已经写入当前仓库，并生成可以在仪表盘查看的知识节点。`
            : stage.desc || '系统正在解析文档、抽取概念、建立路径与图谱关系。'}
        </p>

        <div className="learn-import-progress-block">
          <div className="learn-import-progress-meta">
            <span>{completion ? '生成完成' : stage.label}</span>
            <span>{safeProgress}%</span>
          </div>
          <div className="learn-import-progress-track">
            <div className="learn-import-progress-fill" />
          </div>
        </div>

        {completion ? (
          <div className="learn-import-result">
            <div>
              <Route className="h-4 w-4" />
              <span>{completion.pathName}</span>
            </div>
            <div>
              <FileText className="h-4 w-4" />
              <span>{completion.stepCount || '多'} 个学习步骤与知识节点</span>
            </div>
          </div>
        ) : (
          <div className="learn-import-live-line">
            <span />
            正在写入文献卡、概念卡、学习路径与知识图谱连接
          </div>
        )}

        {completion && (
          <button
            type="button"
            className="learn-import-dashboard-button"
            onClick={onOpenDashboard}
            data-testid="learn-import-open-dashboard"
          >
            <LayoutDashboard className="h-4 w-4" />
            进入仪表盘查看生成结果
          </button>
        )}
      </HudPanel>
    </div>
  )
}
