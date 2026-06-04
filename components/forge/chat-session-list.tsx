'use client'

/**
 * Forge Task Workspace Sidebar
 *
 * - Projects: learning-path task groups from Learn
 * - Talks: raw discussion streams
 * - Archive: completed paths and archived threads
 */

import { useEffect, useMemo, useState } from 'react'
import type { ComponentType } from 'react'
import {
  Archive,
  ArrowRight,
  BookOpen,
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

type ViewMode = 'projects' | 'conversations' | 'archive'

const TYPE_LABEL: Record<string, string> = {
  fleeting: 'FLEETING',
  literature: 'LITERATURE',
  permanent: 'PERMANENT',
}

const TYPE_TONE: Record<string, string> = {
  fleeting: 'text-amber-300/80 border-amber-400/20 bg-amber-400/8',
  literature: 'text-cyan-300/80 border-cyan-400/20 bg-cyan-400/8',
  permanent: 'text-emerald-300/80 border-emerald-400/20 bg-emerald-400/8',
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
  const [view, setView] = useState<ViewMode>('projects')

  useEffect(() => { loadSessions() }, [loadSessions])

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

  const archivedSessions = useMemo(
    () => sessions.filter((session) => isArchivedSession(session)),
    [sessions],
  )

  const taskPaths = useMemo(() => {
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

  const conversationSessions = useMemo(() => {
    const q = query.trim().toLowerCase()
    return sessions
      .filter((session) => !session.pathId && !session.cardId)
      .filter((session) => matchesSession(session, q))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  }, [query, sessions])

  const cardThreadSessions = useMemo(() => {
    const q = query.trim().toLowerCase()
    return sessions
      .filter((session) => session.cardId && !session.pathId)
      .filter((session) => matchesSession(session, q))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  }, [query, sessions])

  const archivedTaskPaths = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (learningData?.paths ?? [])
      .filter((path) => path.progress >= 100 || path.status === 'completed' || path.status === 'archived')
      .filter((path) => matchesPath(path, q))
      .sort((a, b) => new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime())
  }, [learningData?.paths, query])

  const archivedConversationSessions = useMemo(() => {
    const q = query.trim().toLowerCase()
    return sessions
      .filter((session) => isArchivedSession(session) && !session.cardId)
      .filter((session) => matchesSession(session, q))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  }, [query, sessions])

  const archivedCardThreads = useMemo(() => {
    const q = query.trim().toLowerCase()
    return sessions
      .filter((session) => isArchivedSession(session) && !!session.cardId && !session.pathId)
      .filter((session) => matchesSession(session, q))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  }, [query, sessions])

  const counts = {
    projects: taskPaths.length,
    talks: conversationSessions.length,
    archive: archivedTaskPaths.length + archivedSessions.length,
  }

  const handleOpenStep = async (path: LearningPath, step: LearningStep) => {
    try {
      setSelectedPathId(path.id)
      setActiveLearningStepId(step.id)
      let cardId = step.cardId ?? null
      if (!cardId) {
        const result = await executeStep.mutateAsync({ pathId: path.id, stepId: step.id })
        cardId = result?.cardId ?? null
      }
      if (!cardId) {
        toast.error('当前步骤还没有绑定卡片')
        return
      }
      const cardTitle = step.name
      setSelectedNode({ id: cardId, title: cardTitle, type: 'fleeting' })
      await openCardThread({ id: cardId, title: cardTitle, type: 'fleeting' })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '打开任务失败')
    }
  }

  const handleOpenTask = async (path: LearningPath) => {
    const step = resolveTaskStep(path, activeLearningStepId) ?? path.steps[0]
    if (!step) return
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
                  Forge Workspace
                </div>
              </div>
              <div className="mt-1 text-white/88 font-medium" style={{ fontSize: 'var(--f10)' }}>
                项目优先的任务工作台
              </div>
              <div className="mt-1 text-white/22 leading-relaxed" style={{ fontSize: 'var(--f8)' }}>
                Projects 是 Learn 过来的任务组，Talks 是原始对话，Archive 是完成后的历史。
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

          <div className="mt-4 grid grid-cols-3 gap-2">
            <SummaryPill label="Projects" value={counts.projects} icon={Layers3} tone="text-pink-300" />
            <SummaryPill label="Talks" value={counts.talks} icon={MessageSquareText} tone="text-cyan-300" />
            <SummaryPill label="Archive" value={counts.archive} icon={Archive} tone="text-emerald-300" />
          </div>

          <div className="mt-4 flex gap-1 rounded-xl border border-white/8 bg-black/25 p-1">
            {[
              { id: 'projects' as const, label: 'Projects', icon: Layers3 },
              { id: 'conversations' as const, label: 'Talks', icon: MessageSquareText },
              { id: 'archive' as const, label: 'Archive', icon: Archive },
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
              placeholder="搜索任务 / 对话 / 章节..."
            />
          </div>

        </div>

        <div className="flex-1 overflow-y-auto no-scrollbar p-3">
          {view === 'projects' && (
            <div className="space-y-4">
              <SectionLabel title="Active Tasks" icon={Layers3} count={taskPaths.length} />
              {taskPaths.length === 0 ? (
                <EmptyState label="暂无可执行的任务组" />
              ) : (
                taskPaths.map((path) => (
                  <TaskGroupCard
                    key={path.id}
                    path={path}
                    sessions={sessionsByPath.get(path.id) ?? []}
                    active={path.id === selectedPathId}
                    currentStepId={activeLearningStepId}
                    onOpen={() => void handleOpenTask(path)}
                    onOpenStep={(step) => void handleOpenStep(path, step)}
                  />
                ))
              )}
            </div>
          )}

          {view === 'conversations' && (
            <div className="space-y-4">
              <SectionLabel title="Talks" icon={MessageSquareText} count={conversationSessions.length} />
              {conversationSessions.length === 0 ? (
                <EmptyState label="暂无独立对话流" />
              ) : (
                conversationSessions.map((session) => (
                  <ConversationCard
                    key={session.id}
                    session={session}
                    active={session.id === sessionId}
                    onOpen={() => void handleOpenConversation(session)}
                    onDelete={() => deleteSession(session.id)}
                  />
                ))
              )}

              <SectionLabel title="Card Threads" icon={Sparkles} count={cardThreadSessions.length} />
              {cardThreadSessions.length === 0 ? (
                <EmptyState label="暂无卡片线程" />
              ) : (
                cardThreadSessions.map((session) => (
                  <ConversationCard
                    key={session.id}
                    session={session}
                    active={session.id === sessionId}
                    onOpen={() => void handleOpenConversation(session)}
                    onDelete={() => deleteSession(session.id)}
                  />
                ))
              )}
            </div>
          )}

          {view === 'archive' && (
            <div className="space-y-4">
              <SectionLabel title="Archived Tasks" icon={Archive} count={archivedTaskPaths.length} />
              {archivedTaskPaths.length === 0 ? (
                <EmptyState label="没有完成归档的任务组" />
              ) : (
                archivedTaskPaths.map((path) => (
                  <TaskGroupCard
                    key={path.id}
                    path={path}
                    sessions={sessionsByPath.get(path.id) ?? []}
                    active={path.id === selectedPathId}
                    archived
                    currentStepId={activeLearningStepId}
                    onOpen={() => void handleOpenTask(path)}
                    onOpenStep={(step) => void handleOpenStep(path, step)}
                  />
                ))
              )}

              <SectionLabel title="Archived Talks" icon={Clock3} count={archivedConversationSessions.length} />
              {archivedConversationSessions.length === 0 ? (
                <EmptyState label="没有已归档对话" />
              ) : (
                archivedConversationSessions.map((session) => (
                  <ConversationCard
                    key={session.id}
                    session={session}
                    active={session.id === sessionId}
                    archived
                    onOpen={() => void handleOpenConversation(session)}
                    onDelete={() => deleteSession(session.id)}
                  />
                ))
              )}

              <SectionLabel title="Archived Threads" icon={Archive} count={archivedCardThreads.length} />
              {archivedCardThreads.length === 0 ? (
                <EmptyState label="没有已归档卡片线程" />
              ) : (
                archivedCardThreads.map((session) => (
                  <ConversationCard
                    key={session.id}
                    session={session}
                    active={session.id === sessionId}
                    archived
                    onOpen={() => void handleOpenConversation(session)}
                    onDelete={() => deleteSession(session.id)}
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
            <span className="mono" style={{ fontSize: 'var(--f8)' }}>New Task</span>
          </button>
          <span className="mono text-white/18" style={{ fontSize: 'var(--f7)' }}>
            {taskPaths.length} tasks · {conversationSessions.length} talks
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
  onOpen,
  onOpenStep,
}: {
  path: LearningPath
  sessions: SessionSummary[]
  active: boolean
  archived?: boolean
  currentStepId: string | null
  onOpen: () => void
  onOpenStep: (step: LearningStep) => void
}) {
  const nextStep = resolveTaskStep(path, currentStepId)
  const doneCount = path.steps.filter((step) => step.status === 'completed' || step.status === 'mastered').length
  const stepCount = path.steps.length
  const progress = path.progress || (stepCount ? Math.round((doneCount / stepCount) * 100) : 0)

  return (
    <div
      className={`group rounded-xl border p-3 transition-all ${
        active
          ? 'border-pink-400/30 bg-pink-400/[0.08] shadow-[0_0_18px_rgba(244,114,182,0.08)]'
          : 'border-white/6 bg-white/[0.025] hover:border-white/10 hover:bg-white/[0.045]'
      }`}
    >
      <button className="w-full text-left" onClick={onOpen}>
        <div className="flex items-start gap-3">
          <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${archived ? 'text-emerald-300/80 border-emerald-400/20 bg-emerald-400/8' : active ? 'text-pink-300/80 border-pink-400/20 bg-pink-400/8' : 'text-white/40 border-white/10 bg-white/5'}`}>
            {archived ? <Archive className="h-4 w-4" /> : <Layers3 className="h-4 w-4" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <div className={`h-1.5 w-1.5 shrink-0 rounded-full ${active ? 'bg-pink-300' : 'bg-white/18'}`} />
              <div className={`truncate font-medium ${active ? 'text-white' : 'text-white/68 group-hover:text-white/85'}`} style={{ fontSize: 'var(--f9)' }}>
                {path.name}
              </div>
              <div className="ml-auto shrink-0 mono text-white/18" style={{ fontSize: 'var(--f7)' }}>
                {stepCount} steps
              </div>
            </div>

            <div className="mt-2 text-white/25" style={{ fontSize: 'var(--f8)' }}>
              {path.topic || path.description || '由 Learn 导入的任务组'}
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="rounded-md border border-white/10 px-1.5 py-0.5 mono text-white/35" style={{ fontSize: 'var(--f7)' }}>
                {progress}%
              </span>
              <span className="inline-flex items-center gap-1 mono text-white/25" style={{ fontSize: 'var(--f7)' }}>
                {archived ? <CheckCircle2 className="h-3 w-3 text-emerald-300/70" /> : <Sparkles className="h-3 w-3 text-cyan-300/60" />}
                {archived ? 'ARCHIVED' : 'PROJECT'}
              </span>
              <span className="inline-flex items-center gap-1 mono text-white/25" style={{ fontSize: 'var(--f7)' }}>
                <MessageSquareText className="h-3 w-3" />
                {sessions.length} threads
              </span>
              {nextStep && (
                <span className="inline-flex items-center gap-1 rounded-md border border-purple-400/15 bg-purple-400/8 px-1.5 py-0.5 mono text-purple-200/80" style={{ fontSize: 'var(--f7)' }}>
                  next: {nextStep.name}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-black/35">
          <div className="h-full rounded-full bg-gradient-to-r from-pink-400 via-purple-400 to-cyan-400" style={{ width: `${progress}%` }} />
        </div>
      </button>

      <div className="mt-3 space-y-2 pl-11">
        {path.steps.map((step) => {
          const stepSessions = sessions.filter((session) => session.stepId === step.id)
          const selected = step.id === currentStepId
          const status = step.status
          const tone = stepTone(status)
          return (
            <button
              key={step.id}
              className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                selected ? 'border-pink-400/30 bg-pink-400/[0.08]' : 'border-white/8 bg-black/15 hover:border-white/14 hover:bg-white/[0.04]'
              }`}
              onClick={() => onOpenStep(step)}
            >
              <div className="flex items-center gap-2">
                <span className={`h-2.5 w-2.5 rounded-full border ${tone.border} ${tone.fill}`} />
                <span className={`truncate font-medium ${selected ? 'text-white' : 'text-white/70'}`} style={{ fontSize: 'var(--f8)' }}>
                  {step.name}
                </span>
                <span className="ml-auto mono text-white/22" style={{ fontSize: 'var(--f7)' }}>
                  {stepSessions.length}
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between">
                <span className={`mono ${tone.text}`} style={{ fontSize: 'var(--f7)' }}>{tone.label}</span>
                {step.cardId ? <BookOpen className="h-3 w-3 text-white/20" /> : <Clock3 className="h-3 w-3 text-white/14" />}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function ConversationCard({
  session,
  active,
  archived = false,
  onOpen,
  onDelete,
}: {
  session: SessionSummary
  active: boolean
  archived?: boolean
  onOpen: () => void
  onDelete?: () => void
}) {
  const isThread = !!session.cardId
  const type = session.cardType || 'fleeting'
  const typeTone = isThread
    ? (TYPE_TONE[type] ?? 'text-white/45 border-white/10 bg-white/5')
    : 'text-cyan-300/80 border-cyan-400/20 bg-cyan-400/8'
  return (
    <div
      className={`group relative cursor-pointer rounded-xl border p-3 transition-all ${
        active
          ? 'border-pink-400/30 bg-pink-400/[0.08] shadow-[0_0_18px_rgba(244,114,182,0.08)]'
          : 'border-white/6 bg-white/[0.025] hover:border-white/10 hover:bg-white/[0.045]'
      }`}
      onClick={onOpen}
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
              {archived ? 'ARCHIVED' : isThread ? 'THREAD' : 'TALK'}
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
            className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-white/30 transition-colors hover:border-white/20 hover:text-white/55"
            onClick={(event) => {
              event.stopPropagation()
              onOpen()
            }}
            title="打开"
          >
            <ArrowRight className="h-3 w-3" />
          </button>
          {onDelete && (
            <button
              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-white/12 opacity-0 transition-all hover:bg-red-500/15 hover:text-red-300 group-hover:opacity-100"
              onClick={(event) => {
                event.stopPropagation()
                onDelete()
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

function resolveTaskStep(path: LearningPath, activeStepId: string | null): LearningStep | null {
  if (!path.steps.length) return null
  return path.steps.find((step) => step.id === activeStepId)
    ?? path.steps.find((step) => step.status === 'available' || step.status === 'learning')
    ?? path.steps[0]
    ?? null
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

function stepTone(status: LearningStep['status']) {
  if (status === 'mastered' || status === 'completed') {
    return { label: '已完成', text: 'text-green-300', fill: 'bg-green-400', border: 'border-green-500/30' }
  }
  if (status === 'learning') {
    return { label: '处理中', text: 'text-cyan-300', fill: 'bg-cyan-400', border: 'border-cyan-500/30' }
  }
  if (status === 'available') {
    return { label: '可进入', text: 'text-purple-300', fill: 'bg-purple-400', border: 'border-purple-500/30' }
  }
  return { label: '待解锁', text: 'text-white/25', fill: 'bg-white/20', border: 'border-white/10' }
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
