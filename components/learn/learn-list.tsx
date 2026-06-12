'use client'

import { useEffect, useState } from 'react'
import { useLearningPaths, useExecuteStep, useUpdateStepProgress } from '@/hooks/use-learning'
import { useAppStore, useGalaxyActions } from '@/stores/mode-store'
import { useAgentStore } from '@/stores/agent-store'
import { toast } from 'sonner'

export default function LearnList() {
  const { data, refetch } = useLearningPaths()
  const executeStep = useExecuteStep()
  const updateProgress = useUpdateStepProgress()
  const agentSessionId = useAgentStore(s => s.sessionId)
  const paths = data?.paths ?? []
  const selectedPathId = useAppStore(s => s.selectedPathId)
  const setSelectedPathId = useAppStore(s => s.setSelectedPathId)
  const setSelectedNode = useAppStore(s => s.setSelectedNode)
  const setMode = useAppStore(s => s.setMode)

  // Galaxy path toggle
  const [galaxyPathVisible, setGalaxyPathVisible] = useState(false)

  // Track evaluation results per step
  const [evalResults, setEvalResults] = useState<Record<string, { passed: boolean; feedback: string }>>({})
  const [assessDialog, setAssessDialog] = useState<{
    title: string
    passed: boolean
    feedback: string
    mastery?: number
    cardUpgraded?: boolean
  } | null>(null)
  const [stepSessionIds, setStepSessionIds] = useState<Record<string, string>>({})

  // Auto-select active path on first load
  useEffect(() => {
    if (data?.activePath && !selectedPathId) setSelectedPathId(data.activePath)
  }, [data?.activePath, selectedPathId, setSelectedPathId])

  const currentPath = paths.find(p => p.id === selectedPathId)
  const steps = currentPath?.steps ?? []

  // Group steps by chapter
  const chapters = steps.reduce<Record<string, typeof steps>>((acc, s) => {
    const ch = s.chapter || '其他'
    if (!acc[ch]) acc[ch] = []
    acc[ch].push(s)
    return acc
  }, {})
  const chapterList = Object.entries(chapters)

  const allDone = steps.length > 0 && steps.every(s => s.status === 'completed' || s.status === 'mastered')
  const totalDone = steps.filter(s => s.status === 'completed' || s.status === 'mastered').length
  const totalProgress = steps.length > 0 ? Math.round((totalDone / steps.length) * 100) : 0

  const handleToggleGalaxyPath = () => {
    const toggle = useGalaxyActions.getState().actions.toggleLearningPath
    if (typeof toggle === 'function') {
      toggle()
      setGalaxyPathVisible(v => !v)
    }
  }

  const handleStart = async (step: (typeof steps)[0]) => {
    if (!currentPath || !(step.status === 'available' || step.status === 'learning')) return
    try {
      let cardId: string | null | undefined = step.cardId
      const result = await executeStep.mutateAsync({ pathId: currentPath.id, stepId: step.id })
      setStepSessionIds((prev) => ({ ...prev, [step.id]: result.id }))
      if (result?.cardId) cardId = result.cardId
      if (!cardId) {
        toast.error('当前任务还没有理解卡，无法打开 AI 工作台')
        return
      }
      setSelectedNode({ id: cardId, title: step.name, type: result.cardType || 'fleeting' })
      await useAgentStore.getState().loadSessions()
      await useAgentStore.getState().switchSession(result.id)
      setMode('forge')
    } catch (e) {
      console.error(e)
    }
  }

  const handleComplete = async (step: (typeof steps)[0]) => {
    if (!currentPath || step.status !== 'learning') return
    try {
      const result = await updateProgress.mutateAsync({
        pathId: currentPath.id,
        stepId: step.id,
        status: 'completed',
        sessionId: stepSessionIds[step.id] ?? agentSessionId ?? undefined,
      })

      if (result.evaluation) {
        const ev = result.evaluation
        setEvalResults(prev => ({ ...prev, [step.id]: { passed: ev.passed, feedback: ev.feedback } }))
        setAssessDialog({
          title: step.name,
          passed: ev.passed,
          feedback: ev.feedback || (ev.passed ? 'AI 评估通过。' : 'AI 评估：尚未完全掌握，请继续学习。'),
          mastery: ev.mastery,
          cardUpgraded: result.cardUpgraded,
        })
        if (ev.passed) {
          toast.success(`「${step.name}」已掌握！可继续发起卡片升级。`)
        } else {
          toast.error(ev.feedback || 'AI 评估：尚未完全掌握，请继续学习。')
        }
      } else {
        toast.success('步骤已标记为完成')
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '标记失败')
    }
  }

  // Periodic refresh + focus handler
  useEffect(() => {
    const i = setInterval(() => refetch(), 30_000)
    const f = () => refetch()
    window.addEventListener('focus', f)
    return () => {
      clearInterval(i)
      window.removeEventListener('focus', f)
    }
  }, [refetch])

  const isExecuting = executeStep.isPending

  // ── Empty: no path selected ──
  if (!currentPath) {
    return (
      <aside
        className="side-slot visible flex-col pointer-events-auto"
        style={{ width: 'var(--panel-lg)', padding: 'var(--panel-py) 0' }}
      >
        <div
          className="glass-panel rounded-2xl flex flex-col items-center justify-center overflow-hidden border-purple-500/20"
          style={{ height: '100%' }}
        >
          {paths.length === 0 ? (
            /* Nothing created yet */
            <div className="text-center px-6">
              <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/5 flex items-center justify-center mb-4 mx-auto">
                <span className="text-xl opacity-15">◈</span>
              </div>
              <p className="text-white/25 font-bold mb-1" style={{ fontSize: 'var(--f10)' }}>
                还没有学习路径
              </p>
              <p className="mono text-white/10 leading-relaxed" style={{ fontSize: 'var(--f8)' }}>
                在左侧任务大厅中创建一个学习路径
                <br />
                然后在这里查看学习进度
              </p>
            </div>
          ) : (
            /* Has paths but none selected */
            <div className="text-center px-6">
              <div className="w-12 h-12 rounded-2xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center mb-4 mx-auto">
                <span className="text-xl opacity-25">◈</span>
              </div>
              <p className="text-white/25 font-bold mb-1" style={{ fontSize: 'var(--f10)' }}>
                选择一个学习路径
              </p>
              <p className="mono text-white/10 leading-relaxed" style={{ fontSize: 'var(--f8)' }}>
                在左侧任务大厅中点击任意路径
                <br />
                查看详细的学习步骤和进度
              </p>
            </div>
          )}
        </div>
      </aside>
    )
  }

  // ── Path detail view ──
  return (
    <aside
      className="side-slot visible flex-col pointer-events-auto"
      style={{ width: 'var(--panel-lg)', padding: 'var(--panel-py) 0' }}
    >
      {assessDialog && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/55 px-4 backdrop-blur-sm"
          onClick={() => setAssessDialog(null)}
        >
          <div
            className="w-full max-w-[420px] rounded-2xl border border-white/10 bg-[#111018]/95 p-5 shadow-[0_24px_80px_rgba(0,0,0,0.45)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="mono text-white/30" style={{ fontSize: 'var(--f8)' }}>ASSESS RESULT</div>
                <div className="mt-1 font-bold text-white/90" style={{ fontSize: 'var(--f11)' }}>{assessDialog.title}</div>
              </div>
              <span
                className={`rounded-full border px-2.5 py-1 mono ${
                  assessDialog.passed
                    ? 'border-green-500/30 bg-green-500/10 text-green-300'
                    : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                }`}
                style={{ fontSize: 'var(--f8)' }}
              >
                {assessDialog.passed ? '已掌握' : '需复习'}
              </span>
            </div>
            {typeof assessDialog.mastery === 'number' && (
              <div className="mb-4">
                <div className="mb-1 flex items-center justify-between mono text-white/25" style={{ fontSize: 'var(--f8)' }}>
                  <span>掌握度</span>
                  <span>{assessDialog.mastery}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-black/40">
                  <div
                    className={`h-full rounded-full ${assessDialog.passed ? 'bg-green-400' : 'bg-amber-400'}`}
                    style={{ width: `${Math.max(0, Math.min(100, assessDialog.mastery))}%` }}
                  />
                </div>
              </div>
            )}
            <p className="leading-relaxed text-white/65" style={{ fontSize: 'var(--f10)' }}>
              {assessDialog.feedback}
            </p>
            <div className="mt-4 rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2 text-white/35" style={{ fontSize: 'var(--f9)' }}>
              {assessDialog.passed
                ? assessDialog.cardUpgraded ? '卡片已沉淀为永久知识卡，并会更新学习路径进度。' : '学习路径进度已更新。'
                : '系统会保留当前步骤，并继续推送复习资源到学习资源区。'}
            </div>
            <button
              className="mt-4 w-full rounded-lg border border-purple-500/30 bg-purple-500/15 py-2 mono text-purple-200 transition-colors hover:bg-purple-500/25"
              style={{ fontSize: 'var(--f9)' }}
              onClick={() => setAssessDialog(null)}
            >
              关闭
            </button>
          </div>
        </div>
      )}
      <div
        className="glass-panel rounded-2xl flex flex-col overflow-hidden border-purple-500/20 shadow-[0_0_40px_rgba(168,85,247,0.1)]"
        style={{ height: '100%' }}
      >
        {/* ── Header ── */}
        <div className="px-6 py-5 border-b border-white/5 flex-shrink-0 bg-gradient-to-b from-purple-500/5 to-transparent">
          <div className="flex items-center gap-2 mb-1">
            <span
              className={`mono text-[7px] font-bold px-1.5 py-0.5 rounded border ${
                currentPath.source === 'ai'
                  ? 'text-yellow-400/60 border-yellow-500/20'
                  : 'text-cyan-400/60 border-cyan-500/20'
              }`}
            >
              {currentPath.source === 'ai' ? 'AI 任务' : '图谱任务'}
            </span>
            {currentPath.difficulty && (
              <span className="mono text-[7px] text-white/15 border border-white/10 px-1.5 py-0.5 rounded">
                {currentPath.difficulty === 'beginner' ? '基础' : currentPath.difficulty === 'intermediate' ? '进阶' : '高级'}
              </span>
            )}
            {allDone && (
              <span className="mono text-[7px] text-green-400/60 border border-green-500/20 px-1.5 py-0.5 rounded">
                ✓ 已掌握
              </span>
            )}
          </div>
          <div className="text-white/90 font-bold" style={{ fontSize: 'var(--f10)' }}>
            {currentPath.name}
          </div>
          {currentPath.description && (
            <div className="text-white/20 mt-1 leading-relaxed line-clamp-2" style={{ fontSize: 'var(--f8)' }}>
              {currentPath.description}
            </div>
          )}

          {/* Progress */}
          <div className="mt-3 flex items-center gap-3">
            <div className="flex-1 h-2 bg-black/40 rounded-full overflow-hidden border border-white/5">
              <div
                className="h-full rounded-full transition-all duration-1000"
                style={{
                  width: `${totalProgress}%`,
                  background: allDone
                    ? 'linear-gradient(90deg, #22c55e, #4ade80)'
                    : 'linear-gradient(90deg, #a855f7, #c084fc)',
                  boxShadow: allDone
                    ? '0 0 10px rgba(34,197,94,0.5)'
                    : '0 0 10px rgba(168,85,247,0.5)',
                }}
              />
            </div>
            <span className="mono text-[8px] text-white/30 font-bold">
              {totalDone}/{steps.length}
            </span>
          </div>

          {/* ── Galaxy Path Toggle ── */}
          <button
            onClick={handleToggleGalaxyPath}
            className={`mt-3 w-full py-2 rounded-lg mono text-[10px] font-bold transition-all flex items-center justify-center gap-2 ${
              galaxyPathVisible
                ? 'text-red-300 bg-red-500/20 border border-red-500/40 shadow-[0_0_12px_rgba(239,68,68,0.3)]'
                : 'text-red-400/80 bg-red-500/10 border border-red-500/30 hover:bg-red-500/20 hover:border-red-500/50'
            }`}
          >
            <span>{galaxyPathVisible ? '🔴' : '🔗'}</span>
            {galaxyPathVisible ? '隐藏星系路径红线' : '在星系中显示学习路径'}
          </button>
        </div>

        {/* ── Steps ── */}
          <div className="flex-1 overflow-y-auto no-scrollbar min-h-0 px-4 py-4 space-y-5">
            {chapterList.map(([chapter, chapterSteps]) => {
            const chDone = chapterSteps.filter(
              s => s.status === 'completed' || s.status === 'mastered',
            ).length
            const isChapterDone = chapterSteps.every(
              s => s.status === 'completed' || s.status === 'mastered',
            )
            const nextInChapter = chapterSteps.find(
              s => s.status === 'available' || s.status === 'learning',
            )

            return (
              <div key={chapter}>
                {/* Chapter header */}
                <div className="flex items-center justify-between mb-2.5">
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        isChapterDone
                          ? 'bg-green-400'
                          : nextInChapter
                            ? 'bg-purple-400 shadow-[0_0_8px_rgba(168,85,247,0.6)]'
                            : 'bg-white/15'
                      }`}
                    />
                    <span
                      className={`font-bold ${isChapterDone ? 'text-white/35' : 'text-white/80'}`}
                      style={{ fontSize: 'var(--f9)' }}
                    >
                      {chapter}
                    </span>
                  </div>
                  <span className="mono text-[7px] text-white/12">
                    {chDone}/{chapterSteps.length}
                  </span>
                </div>

                {/* Steps in chapter */}
                <div className="space-y-0.5 ml-4 pl-4 border-l-2 border-white/5">
                  {chapterSteps.map((step, si) => {
                    const isDone = step.status === 'completed' || step.status === 'mastered'
                    const isCurrent = step.id === nextInChapter?.id
                    const isLocked = step.status === 'locked'
                    const isLearning = step.status === 'learning'

                    return (
                      <div
                        key={step.id}
                        className={`flex items-stretch gap-3 py-2.5 px-3 rounded-xl transition-all ${
                          isCurrent && !isDone
                            ? 'bg-purple-500/8 -mx-1 px-4 border border-purple-500/15'
                            : ''
                        } ${isLocked ? 'opacity-15' : isDone ? 'opacity-40' : ''}`}
                      >
                        {/* Status dot + connector */}
                        <div className="flex flex-col items-center pt-1">
                          <div
                            className={`w-2.5 h-2.5 rounded-full border-2 transition-all ${
                              isDone
                                ? 'bg-green-400 border-green-400'
                                : isLearning
                                  ? 'bg-cyan-400 border-cyan-400 shadow-[0_0_6px_rgba(34,211,238,0.5)]'
                                  : isCurrent
                                    ? 'bg-purple-400 border-purple-400 shadow-[0_0_6px_rgba(168,85,247,0.5)]'
                                    : isLocked
                                      ? 'bg-white/5 border-white/10'
                                      : 'bg-white/10 border-white/20'
                            }`}
                          />
                          {si < chapterSteps.length - 1 && (
                            <div
                              className={`w-px h-4 ${isDone ? 'bg-green-400/15' : 'bg-white/5'}`}
                            />
                          )}
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0 flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span
                                className={`font-bold truncate block ${
                                  isDone
                                    ? 'line-through text-white/25'
                                    : isLocked
                                      ? 'text-white/10'
                                      : isLearning
                                        ? 'text-cyan-400/90'
                                        : 'text-white/80'
                                }`}
                                style={{ fontSize: 'var(--f9)' }}
                              >
                                {step.name}
                              </span>
                              {isLearning && (
                                <span className="w-1 h-1 rounded-full bg-cyan-400/60 animate-pulse shrink-0" />
                              )}
                            </div>
                            {step.desc && !isDone && (
                              <span
                                className="mono text-white/15 line-clamp-1 block mt-0.5"
                                style={{ fontSize: 'var(--f7)' }}
                              >
                                {step.desc}
                              </span>
                            )}
                            {step.estimatedMinutes && !isDone && (
                              <span className="mono text-[6px] text-white/12 mt-0.5">
                                约 {step.estimatedMinutes} 分钟
                              </span>
                            )}
                          </div>

                          {/* Action buttons */}
                          {isCurrent && !isDone && (
                            <div className="shrink-0 flex items-center gap-1.5">
                              <button
                                className="px-3 py-1.5 rounded-lg bg-purple-500/20 border border-purple-500/40 text-purple-400 mono font-bold text-[10px] transition-all hover:bg-purple-500/30 active:scale-[0.98]"
                                onClick={() => handleStart(step)}
                                disabled={isExecuting || updateProgress.isPending}
                              >
                                {step.status === 'learning' ? '继续' : '学习'}
                              </button>
                              {step.status === 'learning' && (
                                <button
                                  className="px-3 py-1.5 rounded-lg bg-green-500/20 border border-green-500/40 text-green-400 mono font-bold text-[10px] transition-all hover:bg-green-500/30 active:scale-[0.98]"
                                  onClick={() => handleComplete(step)}
                                  disabled={updateProgress.isPending}
                                >
                                  {updateProgress.isPending ? '评估中...' : '标记完成'}
                                </button>
                              )}
                            </div>
                          )}
                          {/* Evaluation result */}
                          {evalResults[step.id] && (
                            <div className={`mt-1.5 px-2 py-1 rounded text-[9px] mono ${
                              evalResults[step.id].passed
                                ? 'bg-green-500/10 border border-green-500/20 text-green-400/80'
                                : 'bg-amber-500/10 border border-amber-500/20 text-amber-400/80'
                            }`}>
                              {evalResults[step.id].passed ? '✓ 已掌握 · 可继续提炼卡片' : evalResults[step.id].feedback}
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>

        {/* ── Footer ── */}
        <div className="px-6 py-3 bg-black/20 border-t border-white/5 flex items-center justify-between opacity-25">
          <span className="mono text-[7px]">{chapterList.length} 个概念组</span>
          <span className="mono text-[7px]">
            {totalDone}/{steps.length} 已掌握
          </span>
        </div>
      </div>
    </aside>
  )
}
