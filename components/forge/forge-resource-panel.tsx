'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  MessageSquareText,
  Plus,
  Search,
  Trash2,
} from 'lucide-react'
import { toast } from '@/lib/ui-feedback'
import { useAgent, type SessionSummary } from '@/hooks/use-agent'
import { useExecuteStep, useLearningPaths, type LearningPath, type LearningStep } from '@/hooks/use-learning'
import { useGalaxyData } from '@/hooks/use-galaxy'
import {
  useAppStore,
  type ForgeCardFilter,
  type ForgeResourceView,
  type PanelLayout,
} from '@/stores/mode-store'
import type { GalaxyNode } from '@/types/galaxy'
import { PanelShell } from '@/components/panels/panel-shell'
import {
  EmptyState,
  Button,
  SearchField,
  Surface,
} from '@/components/ui'

export type { ForgeResourceView } from '@/stores/mode-store'

type Props = {
  view: ForgeResourceView
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

type TabItem<T extends string> = {
  value: T
  label: string
}

const CARD_FILTERS: TabItem<ForgeCardFilter>[] = [
  { value: 'all', label: '全部' },
  { value: 'permanent', label: '永久' },
  { value: 'literature', label: '文献' },
  { value: 'fleeting', label: '灵感' },
]

export default function ForgeResourcePanel({ view }: Props) {
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
  const setRightPanelView = useAppStore((s) => s.setRightPanelView)
  const setForgeResourceView = useAppStore((s) => s.setForgeResourceView)
  const contextTab = useAppStore((s) => s.forgeContextTab)
  const setContextTab = useAppStore((s) => s.setForgeContextTab)
  const cardFilter = useAppStore((s) => s.forgeCardFilter)
  const setCardFilter = useAppStore((s) => s.setForgeCardFilter)
  const [query, setQuery] = useState('')
  const [expandedPathId, setExpandedPathId] = useState<string | null>(null)
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null)

  useEffect(() => { loadSessions() }, [loadSessions])

  const q = query.trim().toLowerCase()

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
      .sort((a, b) => {
        const priority = cardPriority(b) - cardPriority(a)
        if (priority !== 0) return priority
        return (a.title || '').localeCompare(b.title || '')
      })
  }, [cardFilter, galaxyData?.nodes, q])

  const ensureEditor = () => {
    if (panelLayout.right.includes('editor')) return
    const next: PanelLayout = {
      left: panelLayout.left.filter((panel) => panel !== 'editor'),
      right: [...panelLayout.right, 'editor'],
    }
    setPanelLayout(next)
  }

  const handleOpenCard = async (node: GalaxyNode) => {
    const card = { id: node.id, title: node.title || '未命名卡片', type: node.type }
    setSelectedPathId(null)
    setActiveLearningStepId(null)
    setSelectedNode(card)
    setMode('forge')
    setRightPanelView('read')
    ensureEditor()
    await openCardThread(card, { openChat: true })
    setSelectedPathId(null)
    setActiveLearningStepId(null)
    setSelectedNode(card)
    setRightPanelView('read')
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
        setRightPanelView('read')
        ensureEditor()
        await openCardThread({ id: cardId, title: cardTitle, type: cardType })
        setSelectedPathId(path.id)
        setActiveLearningStepId(step.id)
        setSelectedNode({ id: cardId, title: cardTitle, type: cardType })
        setRightPanelView('read')
        return
      }
      const result = await executeStep.mutateAsync({ pathId: path.id, stepId: step.id })
      if (result?.pathId) setSelectedPathId(result.pathId)
      if (result?.stepId) setActiveLearningStepId(result.stepId)
      const selectedPath = result?.pathId ?? path.id
      const selectedStep = result?.stepId ?? step.id
      const cardId = result?.cardId ?? step.cardId ?? null
      if (!cardId) {
        toast.error('当前任务还没有理解卡')
        return
      }
      const cardTitle = result?.cardTitle || step.cardTitle || step.name
      const cardType = result?.cardType || 'fleeting'
      setSelectedNode({ id: cardId, title: cardTitle, type: cardType })
      setRightPanelView('read')
      ensureEditor()
      await openCardThread({ id: cardId, title: cardTitle, type: cardType })
      setSelectedPathId(selectedPath)
      setActiveLearningStepId(selectedStep)
      setSelectedNode({ id: cardId, title: cardTitle, type: cardType })
      setRightPanelView('read')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '打开任务失败')
    }
  }

  const handleTogglePath = (path: LearningPath) => {
    if (path.steps.length <= 0) {
      toast.error('这条路径暂时没有可展开的任务')
      return
    }
    setExpandedPathId((current) => current === path.id ? null : path.id)
  }

  const handleOpenTalk = async (session: SessionSummary) => {
    setSelectedPathId(null)
    setActiveLearningStepId(null)
    setForgeResourceView('context')
    setContextTab('talks')
    await switchSession(session.id)
  }

  const handleCreateTalk = async () => {
    setForgeResourceView('context')
    setContextTab('talks')
    await createTalkSession()
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
    <PanelShell
      className="forge-left-panel"
      aria-label={view === 'context' ? 'AI 工作台路径与会话面板' : 'AI 工作台卡片库面板'}
      data-testid={`forge-resource-panel-${view}`}
    >
      <Surface as="header" variant="glass" className="forge-left-header">
        <div className="forge-left-heading">
          <span>Resources</span>
          <strong>{view === 'context' ? '路径与会话' : '卡片库'}</strong>
        </div>
        <div className="forge-left-actions">
          <Button
            variant="icon"
            aria-label="新建卡片"
            data-testid="forge-left-new-card"
            onClick={() => openModal('newcard')}
            title="新建卡片"
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="icon"
            aria-label="新建对话"
            data-testid="forge-left-new-talk"
            onClick={() => void handleCreateTalk()}
            title="新建对话"
          >
            <MessageSquareText className="h-3.5 w-3.5" />
          </Button>
        </div>
      </Surface>

      <Surface as="section" variant="glass" className="forge-left-tools">
        <SearchField
          className="forge-left-search"
          icon={<Search className="h-3.5 w-3.5" />}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={view === 'context' ? '搜索任务或对话' : '搜索卡片、标签、星团'}
          aria-label={view === 'context' ? '搜索任务或对话' : '搜索卡片、标签、星团'}
          data-testid={`forge-left-search-${view}`}
        />
      </Surface>

      {view === 'context' ? (
        <>
          <PillTabs
            value={contextTab}
            items={[
              { value: 'tasks', label: `任务 ${paths.length}` },
              { value: 'talks', label: `对话 ${talks.length}` },
            ]}
            onChange={setContextTab}
          />
          <Surface as="section" variant="glass" className="forge-left-scroll" key={`context-${contextTab}`} aria-label={contextTab === 'tasks' ? '任务列表' : '对话列表'}>
            {contextTab === 'tasks' ? (
              paths.length ? (
                paths.map((path, index) => (
                  <PathRow
                    key={path.id}
                    path={path}
                    activeLearningStepId={activeLearningStepId}
                    expanded={expandedPathId === path.id}
                    onToggle={() => handleTogglePath(path)}
                    onOpenStep={(step) => void handleOpenStep(path, step)}
                    style={{
                      animation: `modePanelLeftIn 320ms cubic-bezier(0.16, 1, 0.3, 1) both`,
                      animationDelay: `${Math.min(index * 38, 700)}ms`,
                    }}
                  />
                ))
              ) : (
                <EmptyLine label="暂无学习任务" />
              )
            ) : (
              talks.length ? (
                talks.map((session, index) => (
                  <TalkRow
                    key={session.id}
                    session={session}
                    active={session.id === sessionId}
                    deleting={deletingSessionId === session.id}
                    onOpen={() => void handleOpenTalk(session)}
                    onDelete={() => void handleDeleteTalk(session)}
                    style={{
                      animation: `modePanelLeftIn 320ms cubic-bezier(0.16, 1, 0.3, 1) both`,
                      animationDelay: `${Math.min(index * 38, 700)}ms`,
                    }}
                  />
                ))
              ) : (
                <EmptyLine label="暂无自由对话" />
              )
            )}
          </Surface>
        </>
      ) : (
        <>
          <PillTabs value={cardFilter} items={CARD_FILTERS} onChange={setCardFilter} />
          <Surface as="section" variant="glass" className="forge-left-scroll" key={`cards-${cardFilter}`} aria-label="卡片列表">
            {cards.length ? (
              cards.map((node, index) => (
                <button
                  key={node.id}
                  type="button"
                  className={`forge-left-row forge-left-card-row ${selectedNode?.id === node.id ? 'active' : ''}`}
                  aria-label={`打开卡片 ${node.title || '未命名卡片'}`}
                  aria-pressed={selectedNode?.id === node.id}
                  data-testid="forge-left-card-row"
                  data-card-id={node.id}
                  style={{
                    animation: `modePanelLeftIn 320ms cubic-bezier(0.16, 1, 0.3, 1) both`,
                    animationDelay: `${Math.min(index * 38, 700)}ms`,
                  }}
                  onClick={() => void handleOpenCard(node)}
                >
                  <span className={`forge-left-dot ${TYPE_TONE[node.type] ?? 'cyan'}`} />
                  <span className="forge-left-row-text">
                    <strong>{node.title || '未命名卡片'}</strong>
                    <small>{TYPE_LABEL[node.type] ?? node.type}{node.clusterName ? ` / ${node.clusterName}` : ''}</small>
                  </span>
                </button>
              ))
            ) : (
              <EmptyLine label="没有匹配的卡片" />
            )}
          </Surface>
        </>
      )}
    </PanelShell>
  )
}

function PillTabs<T extends string>({ value, items, onChange }: {
  value: T
  items: TabItem<T>[]
  onChange: (value: T) => void
}) {
  const select = (next: T) => {
    if (next !== value) onChange(next)
  }

  return (
    <div className={`forge-left-tabs cols-${items.length}`} role="tablist" aria-label="左侧面板筛选" data-no-global-shortcuts>
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          className={item.value === value ? 'active' : ''}
          aria-selected={item.value === value}
          aria-pressed={item.value === value}
          aria-label={`切换筛选：${item.label}`}
          data-testid={`forge-left-tab-${item.value}`}
          data-tab-value={item.value}
          role="tab"
          onPointerDown={(event) => {
            event.stopPropagation()
            select(item.value)
          }}
          onClick={(event) => {
            event.stopPropagation()
            select(item.value)
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}

function PathRow({
  path,
  activeLearningStepId,
  expanded,
  onToggle,
  onOpenStep,
  style,
}: {
  path: LearningPath
  activeLearningStepId: string | null
  expanded: boolean
  onToggle: () => void
  onOpenStep: (step: LearningStep) => void
  style?: React.CSSProperties
}) {
  const step = resolveTaskStep(path, activeLearningStepId)
  const ToggleIcon = expanded ? ChevronDown : ChevronRight

  return (
    <section className="forge-left-path-row" style={style}>
      <button
        type="button"
        className="forge-left-row forge-left-task-row"
        aria-expanded={expanded}
        aria-label={`${expanded ? '收起' : '展开'}任务组 ${path.name}`}
        data-testid="forge-left-path-row"
        data-path-id={path.id}
        onClick={onToggle}
      >
        <StatusDot status={step?.status ?? 'available'} />
        <span className="forge-left-row-text">
          <strong>{path.name}</strong>
          <small>{step ? step.name : path.topic || '暂无可开始任务'}</small>
        </span>
        <span className="forge-left-meta forge-left-task-meta">
          <span>{path.progress || 0}%</span>
          <ToggleIcon className="h-3.5 w-3.5" />
          <span>{path.steps.length}</span>
        </span>
      </button>
      {expanded && (
        <div className="forge-left-steps">
          {path.steps.slice(0, 7).map((item) => (
            <button
              key={item.id}
              type="button"
              className={`forge-left-step ${item.id === activeLearningStepId ? 'active' : ''}`}
              disabled={!canOpenStep(item)}
              aria-label={`打开任务 ${item.name}`}
              aria-pressed={item.id === activeLearningStepId}
              data-testid="forge-left-step-row"
              data-step-id={item.id}
              onClick={() => onOpenStep(item)}
            >
              <StatusDot status={item.status} />
              <span>{item.name}</span>
              <small>{stepStatusLabel(item.status)}</small>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

function TalkRow({
  session,
  active,
  deleting,
  onOpen,
  onDelete,
  style,
}: {
  session: SessionSummary
  active: boolean
  deleting: boolean
  onOpen: () => void
  onDelete: () => void
  style?: React.CSSProperties
}) {
  return (
    <section className={`forge-left-talk-row ${active ? 'active' : ''}`} style={style}>
      <button
        type="button"
        className="forge-left-row"
        aria-label={`打开对话 ${session.title || '自由对话'}`}
        aria-pressed={active}
        data-testid="forge-left-talk-row"
        data-session-id={session.id}
        onClick={onOpen}
      >
        <MessageSquareText className="forge-left-row-icon h-3.5 w-3.5" />
        <span className="forge-left-row-text">
          <strong>{session.title || '自由对话'}</strong>
          <small>{session.preview || '继续这段对话'}</small>
        </span>
        <span className="forge-left-meta">{formatRelativeTime(session.updatedAt)}</span>
      </button>
      <button
        type="button"
        className="forge-left-delete"
        disabled={deleting}
        aria-label={`删除对话 ${session.title || '自由对话'}`}
        data-testid="forge-left-delete-talk"
        onClick={onDelete}
        title="删除对话"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </section>
  )
}

function EmptyLine({ label }: { label: string }) {
  return <EmptyState className="forge-left-empty">{label}</EmptyState>
}

function StatusDot({ status }: { status: LearningStep['status'] }) {
  return <span className={`forge-left-dot status-${status}`} aria-hidden="true" />
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

function cardPriority(node: GalaxyNode) {
  const text = [
    node.title,
    node.clusterName,
    node.path,
    ...(node.tags ?? []),
  ].filter(Boolean).join(' ').toLowerCase()
  let score = 0
  if (/understanding-card|misconception|clarification|profile-gap|误区|澄清|待解决的问题|学生当前误区/.test(text)) score += 80
  if (/source-backed|imported|derived|资料依据|来自资料/.test(text)) score += 20
  if (node.type === 'fleeting') score += 5
  return score
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
