'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Files,
  Layers3,
  MessageSquareText,
  Plus,
  Search,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { useAgent, type SessionSummary } from '@/hooks/use-agent'
import { useExecuteStep, useLearningPaths, type LearningPath, type LearningStep } from '@/hooks/use-learning'
import { useGalaxyData } from '@/hooks/use-galaxy'
import { useAppStore, type PanelLayout } from '@/stores/mode-store'
import type { GalaxyNode } from '@/types/galaxy'

export type ForgeResourceView = 'context' | 'cards'

type Props = {
  view: ForgeResourceView
  onViewChange: (view: ForgeResourceView) => void
}

const TYPE_LABEL: Record<string, string> = {
  fleeting: '灵感',
  literature: '文献',
  permanent: '永久',
}

const TYPE_TONE: Record<string, string> = {
  fleeting: 'cyan',
  literature: 'pink',
  permanent: 'violet',
}

type CardFilter = 'all' | 'permanent' | 'literature' | 'fleeting'
type ContextTab = 'tasks' | 'talks'

export default function ForgeResourcePanel({ view, onViewChange }: Props) {
  const { sessions, sessionId, switchSession, createTalkSession, openCardThread, deleteSession, loadSessions } = useAgent()
  const { data: learningData } = useLearningPaths()
  const executeStep = useExecuteStep()
  const { data: galaxyData } = useGalaxyData()
  const openModal = useAppStore((s) => s.openModal)
  const selectedNode = useAppStore((s) => s.selectedNode)
  const setSelectedNode = useAppStore((s) => s.setSelectedNode)
  const setSelectedPathId = useAppStore((s) => s.setSelectedPathId)
  const activeLearningStepId = useAppStore((s) => s.activeLearningStepId)
  const setActiveLearningStepId = useAppStore((s) => s.setActiveLearningStepId)
  const setMode = useAppStore((s) => s.setMode)
  const panelLayout = useAppStore((s) => s.panelLayout)
  const setPanelLayout = useAppStore((s) => s.setPanelLayout)
  const [query, setQuery] = useState('')
  const [contextTab, setContextTab] = useState<ContextTab>('tasks')
  const [cardFilter, setCardFilter] = useState<CardFilter>('all')
  const [expandedPathId, setExpandedPathId] = useState<string | null>(null)
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null)

  useEffect(() => { loadSessions() }, [loadSessions])

  const q = query.trim().toLowerCase()

  const pathMap = useMemo(() => {
    const map = new Map<string, LearningPath>()
    for (const path of learningData.paths) map.set(path.id, path)
    return map
  }, [learningData.paths])

  const paths = useMemo(() => {
    return learningData.paths
      .filter((path) => !isArchivedPath(path))
      .filter((path) => matchesPath(path, q))
      .sort((a, b) => (b.progress || 0) - (a.progress || 0))
  }, [learningData.paths, q])

  const talks = useMemo(() => {
    return sessions
      .filter((session) => !session.pathId && !session.cardId)
      .filter((session) => matchesSession(session, q))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  }, [sessions, q])

  const cards = useMemo(() => {
    return (galaxyData?.nodes ?? [])
      .filter((node) => cardFilter === 'all' || node.type === cardFilter)
      .filter((node) => matchesCard(node, q))
      .sort((a, b) => (a.title || '').localeCompare(b.title || ''))
  }, [cardFilter, galaxyData?.nodes, q])

  const ensureEditor = () => {
    if (panelLayout.right.includes('editor')) return
    const next: PanelLayout = {
      left: panelLayout.left.filter((panel) => panel !== 'editor'),
      right: [...panelLayout.right, 'editor'],
    }
    setPanelLayout(next)
  }

  const handleOpenCard = (node: GalaxyNode) => {
    setSelectedNode({ id: node.id, title: node.title || '未命名卡片', type: node.type })
    setMode('forge')
    ensureEditor()
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
        ensureEditor()
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
      ensureEditor()
      await openCardThread({ id: cardId, title: cardTitle, type: cardType })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '打开任务失败')
    }
  }

  const handleOpenPath = async (path: LearningPath) => {
    const step = resolveTaskStep(path, activeLearningStepId)
    if (!step) {
      toast.error('这条路径暂时没有可开始的任务')
      return
    }
    await handleOpenStep(path, step)
  }

  const handleOpenTalk = async (session: SessionSummary) => {
    setSelectedPathId(null)
    setActiveLearningStepId(null)
    setSelectedNode(null)
    await switchSession(session.id)
  }

  const handleDeleteTalk = async (session: SessionSummary) => {
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
    <aside className="forge-resource-panel">
      <header className="forge-resource-top glass-panel">
        <div>
          <span className="mono">Resources</span>
          <strong>{view === 'context' ? '路径与会话' : '卡片库'}</strong>
        </div>
        <div className="forge-resource-actions">
          <button type="button" onClick={() => openModal('newcard')} title="新建卡片">
            <Plus className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={() => void createTalkSession()} title="新建对话">
            <MessageSquareText className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>

      <section className="forge-resource-controls glass-panel">
        <div className="forge-resource-switch">
          <button type="button" className={view === 'context' ? 'active' : ''} onClick={() => onViewChange('context')}>
            <Layers3 className="h-3.5 w-3.5" />
            路径
          </button>
          <button type="button" className={view === 'cards' ? 'active' : ''} onClick={() => onViewChange('cards')}>
            <Files className="h-3.5 w-3.5" />
            卡片
          </button>
        </div>

        <label className="forge-resource-search">
          <Search className="h-3.5 w-3.5" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={view === 'context' ? '搜索路径或对话' : '搜索卡片、标签、星团'}
          />
        </label>
      </section>

      {view === 'context' ? (
        <>
          <div className="forge-resource-tabs two glass-panel">
            <button type="button" className={contextTab === 'tasks' ? 'active' : ''} onClick={() => setContextTab('tasks')}>任务 {paths.length}</button>
            <button type="button" className={contextTab === 'talks' ? 'active' : ''} onClick={() => setContextTab('talks')}>对话 {talks.length}</button>
          </div>
          <div className="forge-resource-list glass-panel">
            {contextTab === 'tasks' ? (
              paths.length ? paths.map((path) => {
                const step = resolveTaskStep(path, activeLearningStepId)
                const open = expandedPathId === path.id
                return (
                  <section key={path.id} className="forge-path-item">
                    <button type="button" className="forge-path-main" onClick={() => void handleOpenPath(path)} disabled={!step || !canOpenStep(step)}>
                      <StatusDot status={step?.status ?? 'available'} />
                      <span className="forge-pill-text">
                        <strong>{path.name}</strong>
                        <small>{step ? step.name : path.topic || '暂无可开始任务'}</small>
                      </span>
                      <span className="forge-pill-meta">{path.progress || 0}%</span>
                    </button>
                    <button type="button" className="forge-expand-btn" onClick={() => setExpandedPathId(open ? null : path.id)}>
                      {open ? '收起' : `${path.steps.length} 步`}
                    </button>
                    {open && (
                      <div className="forge-step-list">
                        {path.steps.slice(0, 7).map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            className={item.id === activeLearningStepId ? 'active' : ''}
                            disabled={!canOpenStep(item)}
                            onClick={() => void handleOpenStep(path, item)}
                          >
                            <StatusDot status={item.status} />
                            <span className="forge-pill-text">{item.name}</span>
                            <small>{stepStatusLabel(item.status)}</small>
                          </button>
                        ))}
                      </div>
                    )}
                  </section>
                )
              }) : <EmptyLine label="暂无学习任务" />
            ) : (
              talks.length ? talks.map((session) => (
                <section key={session.id} className={`forge-talk-item ${session.id === sessionId ? 'active' : ''}`}>
                  <button type="button" onClick={() => void handleOpenTalk(session)}>
                    <MessageSquareText className="h-3.5 w-3.5" />
                    <span className="forge-pill-text">
                      <strong>{session.title || '自由对话'}</strong>
                      <small>{session.preview || '继续这段对话'}</small>
                    </span>
                    <span className="forge-pill-meta">{formatRelativeTime(session.updatedAt)}</span>
                  </button>
                  <button type="button" className="forge-delete-btn" disabled={deletingSessionId === session.id} onClick={() => void handleDeleteTalk(session)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </section>
              )) : <EmptyLine label="暂无自由对话" />
            )}
          </div>
        </>
      ) : (
        <>
          <div className="forge-resource-tabs four glass-panel">
            {(['all', 'permanent', 'literature', 'fleeting'] as CardFilter[]).map((filter) => (
              <button key={filter} type="button" className={cardFilter === filter ? 'active' : ''} onClick={() => setCardFilter(filter)}>
                {filter === 'all' ? '全部' : TYPE_LABEL[filter]}
              </button>
            ))}
          </div>
          <div className="forge-resource-list glass-panel">
            {cards.length ? cards.map((node) => (
              <button
                key={node.id}
                type="button"
                className={`forge-card-item ${selectedNode?.id === node.id ? 'active' : ''}`}
                onClick={() => handleOpenCard(node)}
              >
                <span className={`forge-type-dot ${TYPE_TONE[node.type] ?? 'cyan'}`} />
                <span className="forge-pill-text">
                  <strong>{node.title || '未命名卡片'}</strong>
                  <small>{TYPE_LABEL[node.type] ?? node.type}{node.clusterName ? ` / ${node.clusterName}` : ''}</small>
                </span>
              </button>
            )) : <EmptyLine label="没有匹配的卡片" />}
          </div>
        </>
      )}
    </aside>
  )
}

function EmptyLine({ label }: { label: string }) {
  return <div className="forge-empty-line">{label}</div>
}

function StatusDot({ status }: { status: LearningStep['status'] }) {
  return <span className={`forge-status-dot ${status}`} />
}

function canOpenStep(step: LearningStep) {
  return step.status !== 'locked'
}

function isArchivedPath(path: LearningPath) {
  return path.status === 'archived'
}

function isUnassignedTaskPath(path: LearningPath) {
  return path.source === 'unassigned' || path.id === '__unassigned_tasks__' || path.id === '__fleeting_inbox__'
}

function resolveTaskStep(path: LearningPath, currentStepId: string | null) {
  if (currentStepId) {
    const current = path.steps.find((step) => step.id === currentStepId && canOpenStep(step) && step.status !== 'completed' && step.status !== 'mastered')
    if (current) return current
  }
  return path.steps.find((step) => step.status === 'learning')
    ?? path.steps.find((step) => step.status === 'available')
    ?? path.steps.find((step) => canOpenStep(step))
    ?? null
}

function matchesPath(path: LearningPath, query: string) {
  if (!query) return true
  const text = [
    path.name,
    path.topic,
    path.description,
    ...path.steps.flatMap((step) => [step.name, step.desc, step.concept, step.cardTitle]),
  ].filter(Boolean).join(' ').toLowerCase()
  return text.includes(query)
}

function matchesSession(session: SessionSummary, query: string) {
  if (!query) return true
  return [session.title, session.preview, session.pathTitle, session.stepTitle, session.cardTitle]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .includes(query)
}

function matchesCard(node: GalaxyNode, query: string) {
  if (!query) return true
  return [
    node.title,
    node.type,
    node.clusterName,
    node.path,
    ...(node.tags ?? []),
  ].filter(Boolean).join(' ').toLowerCase().includes(query)
}

function stepStatusLabel(status: LearningStep['status']) {
  if (status === 'mastered') return '掌握'
  if (status === 'completed') return '完成'
  if (status === 'learning') return '进行中'
  if (status === 'available') return '可开始'
  return '锁定'
}

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  if (!Number.isFinite(diff)) return ''
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}
