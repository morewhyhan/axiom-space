'use client'

/**
 * AI workspace sidebar
 *
 * - Learning paths: task paths from Path Planner
 * - Free talks: standalone discussion streams
 * Card-bound threads are opened through the task/card they belong to, rather
 * than exposed as a separate primary workspace tab.
 */

import { useEffect, useMemo, useState } from 'react'
import type { ComponentType } from 'react'
import {
  Archive,
  ArrowRight,
  BookOpen,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Clock3,
  FileText,
  FolderKanban,
  Layers3,
  MessageSquareText,
  Plus,
  Search,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { useAgent } from '@/hooks/use-agent'
import { useExecuteStep, useLearningPaths, type LearningPath, type LearningStep } from '@/hooks/use-learning'
import type { SessionSummary } from '@/hooks/use-agent'
import { useAppStore } from '@/stores/mode-store'

type ViewMode = 'tasks' | 'talks'

const TYPE_LABEL: Record<string, string> = {
  fleeting: '灵感草稿',
  literature: '文献资料',
  permanent: '永久知识卡',
}

const TYPE_TONE: Record<string, string> = {
  fleeting: 'text-cyan-300/80 border-cyan-400/20 bg-cyan-400/8',
  literature: 'text-pink-300/80 border-pink-400/20 bg-pink-400/8',
  permanent: 'text-purple-300/80 border-purple-400/20 bg-purple-400/8',
}

const TYPE_COLOR: Record<string, string> = {
  fleeting: '#22d3ee',
  literature: '#f472b6',
  permanent: '#a855f7',
}

export default function ChatSessionList() {
  const {
    sessions,
    sessionId,
    openCardThread,
    createTalkSession,
    switchSession,
    deleteSession,
    loadSessions,
  } = useAgent()
  const { data: learningData } = useLearningPaths()
  const executeStep = useExecuteStep()
  const setSelectedNode = useAppStore((s) => s.setSelectedNode)
  const selectedPathId = useAppStore((s) => s.selectedPathId)
  const setSelectedPathId = useAppStore((s) => s.setSelectedPathId)
  const activeLearningStepId = useAppStore((s) => s.activeLearningStepId)
  const setActiveLearningStepId = useAppStore((s) => s.setActiveLearningStepId)
  const openModal = useAppStore((s) => s.openModal)
  const [query, setQuery] = useState('')
  const [view, setView] = useState<ViewMode>('tasks')
  const [showArchivedTasks, setShowArchivedTasks] = useState(false)
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null)

  const currentVaultId = useAppStore((s) => s.currentVaultId)
  useEffect(() => { loadSessions() }, [loadSessions, currentVaultId])

  const pathMap = useMemo(() => {
    const map = new Map<string, LearningPath>()
    for (const path of learningData?.paths ?? []) map.set(path.id, path)
    return map
  }, [learningData?.paths])

  const sessionsByPath = useMemo(() => {
    const map = new Map<string, SessionSummary[]>()
    for (const session of sessions) {
      if (!session.pathId) continue
      const list = map.get(session.pathId) ?? []
      list.push(session)
      map.set(session.pathId, list)
    }
    return map
  }, [sessions])

  const sessionsByCard = useMemo(() => {
    const map = new Map<string, SessionSummary[]>()
    for (const session of sessions) {
      if (!session.cardId) continue
      const list = map.get(session.cardId) ?? []
      list.push(session)
      map.set(session.cardId, list)
    }
    return map
  }, [sessions])

  const allTaskPaths = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (learningData?.paths ?? [])
      .filter((path) => matchesPath(path, q))
      .sort((a, b) => {
        const aSelected = a.id === selectedPathId ? 1 : 0
        const bSelected = b.id === selectedPathId ? 1 : 0
        if (aSelected !== bSelected) return bSelected - aSelected
        return b.progress - a.progress
      })
  }, [learningData?.paths, query, selectedPathId])

  const taskPaths = useMemo(
    () => allTaskPaths.filter((path) => showArchivedTasks || !isArchivedPath(path)),
    [allTaskPaths, showArchivedTasks],
  )

  const allTalkSessions = useMemo(() => {
    const q = query.trim().toLowerCase()
    return sessions
      .filter((session) => !session.pathId && !session.cardId)
      .filter((session) => matchesSession(session, q))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  }, [query, sessions])

  const talkSessions = allTalkSessions

  const counts = {
    tasks: allTaskPaths.length,
    talks: allTalkSessions.length,
  }

  const handleOpenStep = async (path: LearningPath, step: LearningStep) => {
    if (!canOpenStep(step)) {
      toast.error(step.lockedReason || '需要先完成前置任务')
      return
    }
    try {
      setSelectedPathId(path.id)
      setActiveLearningStepId(step.id)
      if (isUnassignedTaskPath(path)) {
        const cardId = step.cardId
        if (!cardId) {
          toast.error('这张灵感草稿缺少有效 ID')
          return
        }
        const cardTitle = step.cardTitle || step.name
        const cardType = step.cardType || 'fleeting'
        setSelectedNode({ id: cardId, title: cardTitle, type: cardType })
        await openCardThread({ id: cardId, title: cardTitle, type: cardType })
        return
      }
      const result = await executeStep.mutateAsync({ pathId: path.id, stepId: step.id })
      if (result?.pathId) setSelectedPathId(result.pathId)
      if (result?.stepId) setActiveLearningStepId(result.stepId)
      const cardId = result?.cardId ?? step.cardId ?? null
      if (!cardId) {
        toast.error('当前任务还没有理解卡')
        return
      }
      const cardTitle = result?.cardTitle || step.cardTitle || step.name
      const cardType = result?.cardType || 'fleeting'
      setSelectedNode({ id: cardId, title: cardTitle, type: cardType })
      await openCardThread({ id: cardId, title: cardTitle, type: cardType })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '打开任务失败')
    }
  }

  const handleOpenTask = async (path: LearningPath) => {
    const step = resolveTaskStep(path, activeLearningStepId)
    if (!step) {
      toast.error('这条学习路径暂时没有可开始的任务')
      return
    }
    await handleOpenStep(path, step)
  }

  const handleOpenConversation = async (session: SessionSummary) => {
    if (session.pathId && session.stepId) {
      const path = pathMap.get(session.pathId)
      const step = path?.steps.find((item) => item.id === session.stepId)
      if (path && step) {
        await handleOpenStep(path, step)
        return
      }
    }
    setSelectedPathId(null)
    setActiveLearningStepId(null)
    if (session.cardId) {
      setSelectedNode({ id: session.cardId, title: session.cardTitle || session.title, type: session.cardType || 'fleeting' })
    } else {
      setSelectedNode(null)
    }
    await switchSession(session.id)
  }

  const handleDeleteConversation = async (session: SessionSummary) => {
    if (deletingSessionId) return
    const confirmed = window.confirm(`确定删除「${session.title || '这段对话'}」？此操作不可撤销。`)
    if (!confirmed) return

    setDeletingSessionId(session.id)
    try {
      await deleteSession(session.id)
      toast.success('会话已删除')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除会话失败')
    } finally {
      setDeletingSessionId(null)
    }
  }

  return (
    <aside
      className="side-slot visible flex-col pointer-events-auto"
      style={{ width: '100%', flex: 1, padding: 'var(--panel-py) 0' }}
    >
      <div className="glass-panel rounded-2xl flex-1 flex flex-col overflow-hidden border-purple-500/20 shadow-[0_0_28px_rgba(244,114,182,0.06)]">
        <div className="border-b border-white/8 px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <FolderKanban className="h-4 w-4 text-pink-300/80" />
                <div className="mono text-white/35 uppercase tracking-[0.22em]" style={{ fontSize: 'var(--f8)' }}>
                  AI Workspace
                </div>
              </div>
              <div className="mt-1 text-white/88 font-medium" style={{ fontSize: 'var(--f10)' }}>
                学习路径与自由对话
              </div>
              <div className="mt-1 text-white/22 leading-relaxed" style={{ fontSize: 'var(--f8)' }}>
                从当前学习任务进入卡片工作；自由对话用于临时探索。
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <TypeLegend color={TYPE_COLOR.fleeting} label="灵感草稿" />
                <TypeLegend color={TYPE_COLOR.literature} label="文献资料" />
                <TypeLegend color={TYPE_COLOR.permanent} label="永久知识" />
              </div>
            </div>
            <button
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-pink-400/25 bg-pink-400/10 text-pink-300 transition-colors hover:bg-pink-400/15"
              onClick={() => openModal('newcard')}
              title="新建卡片"
            >
              <Plus className="h-4 w-4" />
            </button>
            <button
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-cyan-400/20 bg-cyan-400/8 text-cyan-300 transition-colors hover:bg-cyan-400/14"
              onClick={() => void createTalkSession()}
              title="新建会话"
            >
              <MessageSquareText className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <SummaryPill label="学习路径" value={counts.tasks} icon={Layers3} tone="text-pink-300" />
            <SummaryPill label="自由对话" value={counts.talks} icon={MessageSquareText} tone="text-cyan-300" />
          </div>

          <div className="mt-4 flex gap-1 rounded-xl border border-white/8 bg-black/25 p-1">
            {[
              { id: 'tasks' as const, label: '学习路径', icon: Layers3 },
              { id: 'talks' as const, label: '自由对话', icon: MessageSquareText },
            ].map((item) => {
              const Icon = item.icon
              const active = view === item.id
              return (
                <button
                  key={item.id}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-[10px] mono transition-colors ${
                    active ? 'bg-pink-400/12 text-pink-200' : 'text-white/28 hover:text-white/60'
                  }`}
                  onClick={() => setView(item.id)}
                >
                  <Icon className="h-3 w-3" />
                  {item.label}
                </button>
              )
            })}
          </div>

          <div className="mt-4 flex items-center gap-2 rounded-xl border border-white/8 bg-black/25 px-3 py-2">
            <Search className="h-4 w-4 shrink-0 text-white/25" />
            <input
              className="w-full bg-transparent text-sm text-white/70 outline-none placeholder:text-white/20"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索学习路径或对话..."
            />
          </div>

        </div>

        <div className="flex-1 overflow-y-auto no-scrollbar p-3">
          {view === 'tasks' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <SectionLabel title="学习路径" icon={Layers3} count={taskPaths.length} />
                <button
                  className={`rounded-lg border px-2 py-1 text-[10px] mono transition-colors ${
                    showArchivedTasks
                      ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200'
                      : 'border-white/8 text-white/25 hover:border-white/16 hover:text-white/50'
                  }`}
                  onClick={() => setShowArchivedTasks((value) => !value)}
                >
                  {showArchivedTasks ? '隐藏归档' : '显示归档'}
                </button>
              </div>
              {taskPaths.length === 0 ? (
                <EmptyState label="暂无学习任务" />
              ) : (
                taskPaths.map((path) => (
                  <TaskGroupCard
                    key={path.id}
                    path={path}
                    sessions={sessionsByPath.get(path.id) ?? []}
                    active={path.id === selectedPathId}
                    archived={isArchivedPath(path)}
                    currentStepId={activeLearningStepId}
                    sessionsByCard={sessionsByCard}
                    onOpen={() => void handleOpenTask(path)}
                    onOpenStep={(step) => void handleOpenStep(path, step)}
                  />
                ))
              )}
            </div>
          )}

          {view === 'talks' && (
            <div className="space-y-4">
              <SectionLabel title="自由对话" icon={MessageSquareText} count={talkSessions.length} />
              {talkSessions.length === 0 ? (
                <EmptyState label="暂无普通对话" />
              ) : (
                talkSessions.map((session) => (
                  <ConversationCard
                    key={session.id}
                    session={session}
                    active={session.id === sessionId}
                    archived={isArchivedSession(session)}
                    deleting={deletingSessionId === session.id}
                    onOpen={() => void handleOpenConversation(session)}
                    onDelete={() => void handleDeleteConversation(session)}
                  />
                ))
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-white/5 px-4 py-3">
          <button
            className="inline-flex items-center gap-2 text-white/25 transition-colors hover:text-white/50"
            onClick={() => openModal('newcard')}
          >
            <Plus className="h-3.5 w-3.5" />
            <span className="mono" style={{ fontSize: 'var(--f8)' }}>新建卡片</span>
          </button>
          <span className="mono text-white/18" style={{ fontSize: 'var(--f7)' }}>
            {taskPaths.length} 路径 · {talkSessions.length} 对话
          </span>
        </div>
      </div>
    </aside>
  )
}

function TaskGroupCard({
  path,
  sessions,
  active,
  archived = false,
  currentStepId,
  sessionsByCard,
  onOpen,
  onOpenStep,
}: {
  path: LearningPath
  sessions: SessionSummary[]
  active: boolean
  archived?: boolean
  currentStepId: string | null
  sessionsByCard: Map<string, SessionSummary[]>
  onOpen: () => void
  onOpenStep: (step: LearningStep) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const nextStep = resolveTaskStep(path, currentStepId)
  const canContinue = !!nextStep && canOpenStep(nextStep)
  const doneCount = path.steps.filter((step) => step.status === 'completed' || step.status === 'mastered').length
  const stepCount = path.steps.length
  const progress = path.progress || (stepCount ? Math.round((doneCount / stepCount) * 100) : 0)
  const aiChatCount = path.steps.reduce((sum, step) => sum + getStepSessions(step, sessions, sessionsByCard).length, 0)
  const inbox = isUnassignedTaskPath(path)
  const accent = path.color && path.color !== '#ff4466' ? path.color : (inbox ? TYPE_COLOR.fleeting : '#64748b')
  const nextIsPermanent = nextStep?.cardType === 'permanent'

  return (
    <div
      className="group rounded-xl border p-3 transition-all hover:bg-white/[0.045]"
      style={{
        borderColor: active ? colorWithAlpha(accent, 0.45) : 'rgba(255,255,255,0.06)',
        background: active ? `linear-gradient(135deg, ${colorWithAlpha(accent, 0.12)}, rgba(255,255,255,0.025))` : 'rgba(255,255,255,0.025)',
        boxShadow: active ? `0 0 18px ${colorWithAlpha(accent, 0.12)}` : undefined,
      }}
    >
      <button className="w-full text-left" onClick={() => setExpanded((value) => !value)}>
        <div className="flex items-start gap-3">
          <div
            className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border"
            style={{
              color: archived ? '#a78bfa' : accent,
              borderColor: archived ? 'rgba(167,139,250,0.22)' : colorWithAlpha(accent, 0.24),
              backgroundColor: archived ? 'rgba(167,139,250,0.08)' : colorWithAlpha(accent, 0.09),
            }}
          >
            {archived ? <Archive className="h-4 w-4" /> : <Layers3 className="h-4 w-4" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: active ? accent : 'rgba(255,255,255,0.18)' }} />
              <div className={`truncate font-medium ${active ? 'text-white' : 'text-white/68 group-hover:text-white/85'}`} style={{ fontSize: 'var(--f9)' }}>
                {path.name}
              </div>
              <div className="ml-auto flex shrink-0 items-center gap-2 mono text-white/18" style={{ fontSize: 'var(--f7)' }}>
                {inbox ? `${stepCount} 张` : `${stepCount} 步`}
                {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              </div>
            </div>

            <div className="mt-2 text-white/25" style={{ fontSize: 'var(--f8)' }}>
              {path.topic || path.description || (inbox ? '还没有安排进正式学习路径的灵感草稿' : '由路径规划生成的学习路径')}
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="rounded-md border border-white/10 px-1.5 py-0.5 mono text-white/35" style={{ fontSize: 'var(--f7)' }}>
                {progress}%
              </span>
              <span className="inline-flex items-center gap-1 mono text-white/25" style={{ fontSize: 'var(--f7)' }}>
                {archived ? <CheckCircle2 className="h-3 w-3 text-emerald-300/70" /> : <Sparkles className="h-3 w-3 text-cyan-300/60" />}
                {archived ? '已归档' : inbox ? '灵感草稿箱' : '学习路径'}
              </span>
              <span className="inline-flex items-center gap-1 mono text-white/25" style={{ fontSize: 'var(--f7)' }}>
                <MessageSquareText className="h-3 w-3" />
                {aiChatCount} 段 AI 对话
              </span>
              {nextStep && (
                <span className="inline-flex items-center gap-1 rounded-md border border-purple-400/15 bg-purple-400/8 px-1.5 py-0.5 mono text-purple-200/80" style={{ fontSize: 'var(--f7)' }}>
                  当前：{nextStep.name}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-black/35">
          <div className="h-full rounded-full" style={{ width: `${progress}%`, background: `linear-gradient(90deg, ${accent}, ${colorWithAlpha(accent, 0.35)})` }} />
        </div>
      </button>

      <div className="mt-3 flex items-center justify-between gap-3 pl-11">
        <div className="mono text-white/20" style={{ fontSize: 'var(--f7)' }}>
          {expanded ? '已展开任务' : inbox ? '展开后选择要打磨的灵感草稿' : '展开后选择具体学习任务'}
        </div>
        <button
          className="inline-flex items-center gap-1 rounded-lg border border-pink-400/20 bg-pink-400/8 px-2.5 py-1.5 text-[10px] mono text-pink-200 transition-colors hover:bg-pink-400/14 disabled:cursor-not-allowed disabled:opacity-40"
          onClick={onOpen}
          disabled={!canContinue}
          title={!canContinue ? nextStep?.lockedReason || '需要先完成前置任务' : '继续当前任务'}
        >
          {nextIsPermanent ? '查看' : inbox ? '打磨' : '继续'}
          <ArrowRight className="h-3 w-3" />
        </button>
      </div>

      {expanded && (
        <div className="mt-3 space-y-2 pl-11">
          {path.steps.map((step) => {
            const stepSessions = getStepSessions(step, sessions, sessionsByCard)
            const selected = step.id === currentStepId
            const status = step.status
            const tone = stepTone(status)
            const typeColor = TYPE_COLOR[step.cardType || 'fleeting'] || TYPE_COLOR.fleeting
            return (
              <button
                key={step.id}
                className="w-full rounded-lg border px-3 py-2 text-left transition-colors hover:bg-white/[0.04] disabled:cursor-not-allowed disabled:opacity-40"
                style={{
                  borderColor: selected ? colorWithAlpha(typeColor, 0.42) : 'rgba(255,255,255,0.08)',
                  backgroundColor: selected ? colorWithAlpha(typeColor, 0.09) : 'rgba(0,0,0,0.15)',
                }}
                disabled={!canOpenStep(step)}
                title={!canOpenStep(step) ? step.lockedReason || '需要先完成前置任务' : undefined}
                onClick={() => onOpenStep(step)}
              >
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full border" style={{ backgroundColor: typeColor, borderColor: colorWithAlpha(typeColor, 0.35) }} />
                  <span className={`truncate font-medium ${selected ? 'text-white' : 'text-white/70'}`} style={{ fontSize: 'var(--f8)' }}>
                    {step.name}
                  </span>
                  <span className="ml-auto mono text-white/22" style={{ fontSize: 'var(--f7)' }}>
                    {stepSessions.length}
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between">
                  <span className={`mono ${tone.text}`} style={{ fontSize: 'var(--f7)' }}>{tone.label}</span>
                  <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 mono ${TYPE_TONE[step.cardType || 'fleeting'] ?? 'text-white/35 border-white/10 bg-white/5'}`} style={{ fontSize: 'var(--f7)' }}>
                    {step.cardId ? <BookOpen className="h-3 w-3" /> : <Clock3 className="h-3 w-3" />}
                    {step.cardId ? TYPE_LABEL[step.cardType || 'fleeting'] ?? '理解卡' : '开始时创建灵感理解'}
                  </span>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function ConversationCard({
  session,
  active,
  archived = false,
  deleting = false,
  onOpen,
  onDelete,
}: {
  session: SessionSummary
  active: boolean
  archived?: boolean
  deleting?: boolean
  onOpen: () => void | Promise<void>
  onDelete?: () => void | Promise<void>
}) {
  const isThread = !!session.cardId
  const threadLabel = session.sessionKind === 'path-step-thread' ? '学习线程' : isThread ? '卡片线程' : '自由对话'
  const type = session.cardType || 'fleeting'
  const typeTone = isThread
    ? (TYPE_TONE[type] ?? 'text-white/45 border-white/10 bg-white/5')
    : 'text-cyan-300/80 border-cyan-400/20 bg-cyan-400/8'
  return (
    <div
      className={`group relative rounded-xl border p-3 transition-all ${deleting ? 'cursor-wait opacity-55' : 'cursor-pointer'} ${
        active
          ? 'border-pink-400/30 bg-pink-400/[0.08] shadow-[0_0_18px_rgba(244,114,182,0.08)]'
          : 'border-white/6 bg-white/[0.025] hover:border-white/10 hover:bg-white/[0.045]'
      }`}
      onClick={() => {
        if (!deleting) void onOpen()
      }}
      aria-busy={deleting}
    >
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${typeTone}`}>
          {archived ? <Archive className="h-4 w-4" /> : isThread ? <Sparkles className="h-4 w-4" /> : <MessageSquareText className="h-4 w-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className={`h-1.5 w-1.5 shrink-0 rounded-full ${active ? 'bg-pink-300' : isThread ? 'bg-cyan-300/70' : 'bg-white/18'}`} />
            <div className={`truncate font-medium ${active ? 'text-white' : 'text-white/68 group-hover:text-white/85'}`} style={{ fontSize: 'var(--f9)' }}>
              {session.pathTitle
                ? `${session.pathTitle} · ${session.stepTitle || session.cardTitle || session.title}`
                : isThread
                  ? (session.cardTitle || session.title)
                  : session.title}
            </div>
            <div className="ml-auto shrink-0 mono text-white/18" style={{ fontSize: 'var(--f7)' }}>
              {formatRelativeTime(session.updatedAt)}
            </div>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            {session.cardId && (
              <span className={`rounded-md border px-1.5 py-0.5 mono ${typeTone}`} style={{ fontSize: 'var(--f7)' }}>
                {TYPE_LABEL[type] ?? type}
              </span>
            )}
            {session.pathTitle && (
              <span className="rounded-md border border-purple-400/15 bg-purple-400/8 px-1.5 py-0.5 mono text-purple-200/80" style={{ fontSize: 'var(--f7)' }}>
                {session.pathTitle}
              </span>
            )}
            <span className="inline-flex items-center gap-1 mono text-white/25" style={{ fontSize: 'var(--f7)' }}>
              {archived ? <CheckCircle2 className="h-3 w-3 text-emerald-300/70" /> : isThread ? <CheckCircle2 className="h-3 w-3 text-cyan-300/60" /> : <Clock3 className="h-3 w-3" />}
              {archived ? '已归档' : threadLabel}
            </span>
          </div>

          <div className="mt-2 line-clamp-2 mono text-white/25" style={{ fontSize: 'var(--f8)' }}>
            {session.preview || '点击打开这段对话。'}
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between">
        <div className="mono text-white/20" style={{ fontSize: 'var(--f7)' }}>
          {archived ? '只读历史' : '可继续编辑'}
        </div>
        <div className="flex items-center gap-2">
          <button
            className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-white/30 transition-colors hover:border-white/20 hover:text-white/55 disabled:cursor-not-allowed disabled:opacity-35"
            disabled={deleting}
            onClick={(event) => {
              event.stopPropagation()
              void onOpen()
            }}
            title="打开"
          >
            <ArrowRight className="h-3 w-3" />
          </button>
          {onDelete && (
            <button
              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-white/12 opacity-0 transition-all hover:bg-red-500/15 hover:text-red-300 group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-35"
              disabled={deleting}
              onClick={(event) => {
                event.stopPropagation()
                void onDelete()
              }}
              title="删除线程"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function SectionLabel({
  title,
  icon: Icon,
  count,
}: {
  title: string
  icon: ComponentType<{ className?: string }>
  count: number
}) {
  return (
    <div className="flex items-center gap-2 px-1">
      <Icon className="h-3.5 w-3.5 text-white/28" />
      <div className="mono text-[9px] text-white/40 uppercase tracking-[0.18em]">{title}</div>
      <div className="mono text-[9px] text-white/20">{count}</div>
    </div>
  )
}

function TypeLegend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 mono text-white/25" style={{ fontSize: 'var(--f7)' }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  )
}

function SummaryPill({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string
  value: number
  icon: ComponentType<{ className?: string }>
  tone: string
}) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="mono text-white/25" style={{ fontSize: 'var(--f7)' }}>{label}</div>
        <Icon className={`h-3.5 w-3.5 ${tone}`} />
      </div>
      <div className={`mt-1 font-semibold ${tone}`} style={{ fontSize: 'var(--f10)' }}>{value}</div>
    </div>
  )
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="rounded-xl border border-white/5 bg-white/[0.02] px-4 py-8 text-center">
      <FileText className="mx-auto mb-3 h-7 w-7 text-white/15" />
      <div className="mono text-white/18" style={{ fontSize: 'var(--f9)' }}>{label}</div>
    </div>
  )
}

function isUnassignedTaskPath(path: LearningPath) {
  return path.source === 'unassigned' || path.id === '__unassigned_tasks__' || path.id === '__fleeting_inbox__'
}

function canOpenStep(step: LearningStep) {
  return step.status !== 'locked'
}

function colorWithAlpha(hex: string, alpha: number) {
  const normalized = hex.trim().replace('#', '')
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return `rgba(255,255,255,${alpha})`
  const value = Number.parseInt(normalized, 16)
  const r = (value >> 16) & 255
  const g = (value >> 8) & 255
  const b = value & 255
  return `rgba(${r},${g},${b},${alpha})`
}

function resolveTaskStep(path: LearningPath, activeStepId: string | null): LearningStep | null {
  if (!path.steps.length) return null
  const selected = path.steps.find((step) => step.id === activeStepId)
  if (selected && canOpenStep(selected)) return selected
  return path.steps.find((step) => step.status === 'available' || step.status === 'learning')
    ?? path.steps.find(canOpenStep)
    ?? null
}

function getStepSessions(
  step: LearningStep,
  sessions: SessionSummary[],
  sessionsByCard: Map<string, SessionSummary[]>,
): SessionSummary[] {
  const seen = new Set<string>()
  const matched: SessionSummary[] = []
  for (const session of sessions) {
    if (session.stepId !== step.id) continue
    seen.add(session.id)
    matched.push(session)
  }
  if (step.cardId) {
    for (const session of sessionsByCard.get(step.cardId) ?? []) {
      if (seen.has(session.id)) continue
      seen.add(session.id)
      matched.push(session)
    }
  }
  return matched
}

function matchesPath(path: LearningPath, q: string): boolean {
  if (!q) return true
  const haystack = [
    path.name,
    path.topic,
    path.description,
    path.source,
    ...path.steps.map((step) => `${step.name} ${step.desc} ${step.chapter}`),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return haystack.includes(q)
}

function matchesSession(session: SessionSummary, q: string): boolean {
  if (!q) return true
  const haystack = [
    session.title,
    session.preview,
    session.cardTitle,
    session.cardType,
    session.threadStatus,
    session.pathTitle,
    session.stepTitle,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return haystack.includes(q)
}

function isArchivedSession(session: SessionSummary): boolean {
  return session.status === 'completed'
    || session.threadStatus === 'archived'
    || session.cardType === 'permanent'
}

function isArchivedPath(path: LearningPath): boolean {
  return path.status === 'archived'
}

function stepTone(status: LearningStep['status']) {
  if (status === 'mastered') {
    return { label: '已掌握', text: 'text-green-300', fill: 'bg-green-400', border: 'border-green-500/30' }
  }
  if (status === 'completed') {
    return { label: '任务已完成', text: 'text-green-300', fill: 'bg-green-400', border: 'border-green-500/30' }
  }
  if (status === 'learning') {
    return { label: '学习中', text: 'text-cyan-300', fill: 'bg-cyan-400', border: 'border-cyan-500/30' }
  }
  if (status === 'available') {
    return { label: '可开始', text: 'text-purple-300', fill: 'bg-purple-400', border: 'border-purple-500/30' }
  }
  return { label: '前置未满足', text: 'text-white/25', fill: 'bg-white/20', border: 'border-white/10' }
}

function formatRelativeTime(dateStr: string): string {
  const now = Date.now()
  const date = new Date(dateStr).getTime()
  const diffMs = now - date
  const diffMin = Math.floor(diffMs / 60000)
  const diffHour = Math.floor(diffMs / 3600000)
  const diffDay = Math.floor(diffMs / 86400000)

  if (diffMin < 1) return '刚刚'
  if (diffMin < 60) return `${diffMin} 分钟前`
  if (diffHour < 24) return `${diffHour} 小时前`
  if (diffDay < 7) return `${diffDay} 天前`
  return dateStr.slice(5, 10)
}
