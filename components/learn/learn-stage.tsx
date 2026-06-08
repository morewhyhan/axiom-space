'use client'

import { useEffect, useMemo, useState } from 'react'
import { useAppStore, useGalaxyActions } from '@/stores/mode-store'
import { useLearningPaths } from '@/hooks/use-learning'

function StatBlock({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3">
      <div className="mono text-[7px] uppercase tracking-[0.2em] text-white/25">{label}</div>
      <div className="mt-1 text-sm font-semibold text-white/85">{value}</div>
      {hint && <div className="mt-1 mono text-[7px] text-white/18">{hint}</div>}
    </div>
  )
}

export default function LearnStage() {
  const { data } = useLearningPaths()
  const selectedPathId = useAppStore((s) => s.selectedPathId)
  const setMode = useAppStore((s) => s.setMode)
  const actions = useGalaxyActions((s) => s.actions)
  const [focusMode, setFocusMode] = useState(true)

  const currentPath = useMemo(() => {
    const paths = data?.paths ?? []
    return paths.find((p) => p.id === selectedPathId) ?? data?.paths?.find((p) => p.id === data.activePath) ?? paths[0] ?? null
  }, [data, selectedPathId])

  const nextStep = currentPath?.steps?.find((s) => s.status === 'available' || s.status === 'learning') ?? null
  const totalSteps = currentPath?.steps?.length ?? 0
  const doneSteps = currentPath?.steps?.filter((s) => s.status === 'completed' || s.status === 'mastered').length ?? 0
  const progress = totalSteps > 0 ? Math.round((doneSteps / totalSteps) * 100) : 0

  useEffect(() => {
    const toggleLearningPath = actions.toggleLearningPath as (() => void) | undefined
    const isLearningPathVisible = actions.isLearningPathVisible as (() => boolean) | undefined
    const setInternalEdgesVisible = actions.setInternalEdgesVisible as ((v: boolean) => void) | undefined
    const setExternalEdgesVisible = actions.setExternalEdgesVisible as ((v: boolean) => void) | undefined
    const setCometsVisible = actions.setCometsVisible as ((v: boolean) => void) | undefined
    const setAutoRotate = actions.setAutoRotate as ((v: boolean) => void) | undefined

    if (focusMode) {
      setInternalEdgesVisible?.(false)
      setExternalEdgesVisible?.(false)
      setCometsVisible?.(false)
      setAutoRotate?.(false)
      if (isLearningPathVisible && !isLearningPathVisible() && toggleLearningPath) {
        toggleLearningPath()
      }
    } else {
      setInternalEdgesVisible?.(true)
      setExternalEdgesVisible?.(true)
      setCometsVisible?.(true)
      setAutoRotate?.(true)
      if (isLearningPathVisible && isLearningPathVisible() && toggleLearningPath) {
        toggleLearningPath()
      }
    }
  }, [focusMode, actions])

  useEffect(() => {
    return () => {
      const toggleLearningPath = actions.toggleLearningPath as (() => void) | undefined
      const isLearningPathVisible = actions.isLearningPathVisible as (() => boolean) | undefined
      const setInternalEdgesVisible = actions.setInternalEdgesVisible as ((v: boolean) => void) | undefined
      const setExternalEdgesVisible = actions.setExternalEdgesVisible as ((v: boolean) => void) | undefined
      const setCometsVisible = actions.setCometsVisible as ((v: boolean) => void) | undefined
      const setAutoRotate = actions.setAutoRotate as ((v: boolean) => void) | undefined

      setInternalEdgesVisible?.(true)
      setExternalEdgesVisible?.(true)
      setCometsVisible?.(true)
      setAutoRotate?.(true)
      if (isLearningPathVisible && isLearningPathVisible() && toggleLearningPath) {
        toggleLearningPath()
      }
    }
  }, [actions])

  return (
    <div className="flex h-full items-center justify-center px-4">
      <div className="glass-panel w-full max-w-[640px] overflow-hidden rounded-[22px] border border-white/10 shadow-[0_24px_80px_rgba(0,0,0,0.35)]">
        <div className="border-b border-white/5 bg-gradient-to-b from-purple-500/6 to-transparent px-6 py-5">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="mono text-[7px] uppercase tracking-[0.28em] text-white/25">Path Planner</div>
              <div className="mt-2 text-xl font-semibold text-white/90">{currentPath?.name || '选择一个任务路径'}</div>
              <div className="mt-2 max-w-[56ch] text-sm leading-6 text-white/40">
                {currentPath
                  ? '左侧创建和管理路径，右侧按章节推进当前步骤。默认只展示主路径，避免知识图谱干扰推进节奏。'
                  : '先在左侧创建或选择一个路径，然后在这里查看进度、下一步和任务状态。'}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                className={`mono rounded-lg border px-3 py-2 text-[10px] transition-colors ${
                  focusMode
                    ? 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300'
                    : 'border-white/10 bg-white/5 text-white/45 hover:bg-white/10'
                }`}
                onClick={() => setFocusMode(true)}
              >
                专注路径
              </button>
              <button
                className={`mono rounded-lg border px-3 py-2 text-[10px] transition-colors ${
                  !focusMode
                    ? 'border-purple-500/30 bg-purple-500/10 text-purple-300'
                    : 'border-white/10 bg-white/5 text-white/45 hover:bg-white/10'
                }`}
                onClick={() => setFocusMode(false)}
              >
                展示关系
              </button>
            </div>
          </div>
        </div>

        {currentPath ? (
          <div className="space-y-5 px-6 py-5">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatBlock label="来源" value={currentPath.source === 'ai' ? 'AI 生成' : '图谱导入'} />
              <StatBlock label="难度" value={currentPath.difficulty === 'beginner' ? '基础' : currentPath.difficulty === 'intermediate' ? '进阶' : '高级'} />
              <StatBlock label="进度" value={`${progress}%`} hint={`${doneSteps}/${totalSteps} steps`} />
              <StatBlock label="当前状态" value={nextStep ? '可以继续' : '等待选择'} hint={nextStep?.name || '暂无下一步'} />
            </div>

            <div className="rounded-2xl border border-white/8 bg-white/[0.025] p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="mono text-[7px] uppercase tracking-[0.22em] text-white/25">Next Action</div>
                <span className="mono text-[7px] text-white/20">
                  {currentPath.steps.length} steps
                </span>
              </div>
              {nextStep ? (
                <>
                  <div className="text-base font-semibold text-white/85">{nextStep.name}</div>
                  <div className="mt-2 text-sm leading-6 text-white/35">
                    {nextStep.desc || '在右侧步骤列表中继续这一步，完成后系统会自动更新进度和评估结果。'}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <span className="rounded-full border border-cyan-500/20 bg-cyan-500/8 px-3 py-1 mono text-[10px] text-cyan-300/80">
                      {nextStep.status === 'learning' ? '进行中' : '下一步'}
                    </span>
                    {nextStep.estimatedMinutes && (
                      <span className="rounded-full border border-white/8 bg-white/5 px-3 py-1 mono text-[10px] text-white/45">
                        约 {nextStep.estimatedMinutes} 分钟
                      </span>
                    )}
                    {currentPath.source === 'ai' && (
                      <span className="rounded-full border border-amber-500/20 bg-amber-500/8 px-3 py-1 mono text-[10px] text-amber-300/80">
                        自动评估
                      </span>
                    )}
                  </div>
                </>
              ) : (
                <div className="text-sm leading-6 text-white/40">
                  当前路径没有可直接执行的步骤。你可以在左侧新建路径，或者切换到另一条进行中的路径。
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-white/8 bg-black/20 px-4 py-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="mono text-[7px] uppercase tracking-[0.22em] text-white/25">Path Progress</div>
                <div className="mono text-[7px] text-white/20">{doneSteps}/{totalSteps}</div>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-white/5">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{
                    width: `${progress}%`,
                    background: progress >= 100
                      ? 'linear-gradient(90deg, #22c55e, #4ade80)'
                      : 'linear-gradient(90deg, #22d3ee, #a855f7)',
                  }}
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 mono text-[10px] text-white/45 transition-colors hover:bg-white/10 hover:text-white/75"
                onClick={() => setMode('forge')}
              >
                跳到 Forge
              </button>
              <button
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 mono text-[10px] text-white/45 transition-colors hover:bg-white/10 hover:text-white/75"
                onClick={() => setFocusMode((v) => !v)}
              >
                {focusMode ? '查看关系图' : '只看路径'}
              </button>
            </div>
          </div>
        ) : (
          <div className="px-6 py-8">
            <div className="rounded-2xl border border-white/8 bg-white/[0.025] px-5 py-6 text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-white/8 bg-white/[0.04] text-xl text-white/20">
                ◈
              </div>
              <div className="text-lg font-semibold text-white/80">先选一个任务路径</div>
              <div className="mt-2 text-sm leading-6 text-white/38">
                左侧创建或选择路径后，这里会显示当前进度、下一步和关系图模式。
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
