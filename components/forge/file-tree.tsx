'use client'

import { useMemo, useState } from 'react'
import {
  ArrowUpAZ,
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  Filter,
  Folder,
  FolderPlus,
  Plus,
  Search,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { useAppStore, type PanelLayout } from '@/stores/mode-store'
import { useCreateCluster, useGalaxyData } from '@/hooks/use-galaxy'
import type { GalaxyNode } from '@/types/galaxy'

type TypeFilter = 'all' | GalaxyNode['type']
type SortMode = 'name' | 'type'
type GroupMode = 'flat' | 'type' | 'cluster'
type DirectoryGroup = {
  id: string
  label: string
  accent: string
  color?: string
  items: GalaxyNode[]
}

const DEFAULT_TYPE_META: Record<string, { label: string; dot: string; tone: string; order: number }> = {
  fleeting: {
    label: '灵感',
    dot: 'bg-cyan-300',
    tone: 'text-cyan-200',
    order: 2,
  },
  literature: {
    label: '文献',
    dot: 'bg-pink-300',
    tone: 'text-pink-200',
    order: 1,
  },
  permanent: {
    label: '永久',
    dot: 'bg-purple-300',
    tone: 'text-purple-200',
    order: 0,
  },
}

const TYPE_ORDER = ['permanent', 'literature', 'fleeting']

function getTypeMeta(type: string) {
  return DEFAULT_TYPE_META[type] ?? {
    label: type,
    dot: 'bg-emerald-300',
    tone: 'text-emerald-200',
    order: 10,
  }
}

const GROUP_LABEL: Record<GroupMode, string> = {
  flat: '全部',
  type: '类型',
  cluster: '星团',
}

const CLUSTER_COLORS = ['#a855f7', '#22d3ee', '#f472b6', '#34d399', '#fbbf24', '#818cf8']

export default function FileTree() {
  const { data } = useGalaxyData()
  const createCluster = useCreateCluster()
  const openModal = useAppStore((s) => s.openModal)
  const selectedNode = useAppStore((s) => s.selectedNode)
  const setSelectedNode = useAppStore((s) => s.setSelectedNode)
  const setMode = useAppStore((s) => s.setMode)
  const panelLayout = useAppStore((s) => s.panelLayout)
  const setPanelLayout = useAppStore((s) => s.setPanelLayout)
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [sortMode, setSortMode] = useState<SortMode>('name')
  const [groupMode, setGroupMode] = useState<GroupMode>('flat')
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['permanent', 'literature', 'fleeting', '_uncategorized']))
  const [showNewSpace, setShowNewSpace] = useState(false)
  const [newSpaceName, setNewSpaceName] = useState('')
  const [newSpaceColor, setNewSpaceColor] = useState(CLUSTER_COLORS[0])

  const nodes = useMemo(() => data?.nodes ?? [], [data?.nodes])
  const clusters = useMemo(() => data?.clusters ?? [], [data?.clusters])
  const clusterMap = useMemo(() => new Map(clusters.map((cluster) => [cluster.id, cluster])), [clusters])
  const typeFilters = useMemo<Array<{ id: TypeFilter; label: string }>>(() => {
    const customTypes = Array.from(new Set(nodes.map((node) => node.type).filter(Boolean)))
      .sort((a, b) => {
        const aIndex = TYPE_ORDER.indexOf(a)
        const bIndex = TYPE_ORDER.indexOf(b)
        if (aIndex !== -1 || bIndex !== -1) return (aIndex === -1 ? 99 : aIndex) - (bIndex === -1 ? 99 : bIndex)
        return a.localeCompare(b)
      })
    const knownTypes = customTypes.length > 0 ? customTypes : TYPE_ORDER
    return [
      { id: 'all', label: '全部' },
      ...knownTypes.map((type) => ({ id: type, label: getTypeMeta(type).label })),
    ]
  }, [nodes])

  const filteredNodes = useMemo(() => {
    const q = query.trim().toLowerCase()
    return nodes
      .filter((node) => typeFilter === 'all' || node.type === typeFilter)
      .filter((node) => {
        if (!q) return true
        return [
          node.title,
          node.type,
          node.clusterName,
          ...(node.tags ?? []),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(q)
      })
      .sort((a, b) => {
        if (sortMode === 'type') {
          const typeDiff = getTypeMeta(a.type).order - getTypeMeta(b.type).order
          if (typeDiff !== 0) return typeDiff
        }
        return (a.title || '').localeCompare(b.title || '')
      })
  }, [nodes, query, sortMode, typeFilter])

  const groups = useMemo<DirectoryGroup[]>(() => {
    if (groupMode === 'type') {
      const types = typeFilters
        .map((item) => item.id)
        .filter((type): type is string => type !== 'all')
      return types
        .map((type) => ({
          id: type,
          label: getTypeMeta(type).label,
          accent: getTypeMeta(type).dot,
          items: filteredNodes.filter((node) => node.type === type),
        }))
        .filter((group) => group.items.length > 0)
    }

    if (groupMode === 'cluster') {
      const knownClusterIds = new Set(clusters.map((cluster) => cluster.id))
      const clusterGroups = clusters
        .map((cluster) => ({
          id: cluster.id,
          label: cluster.name,
          accent: '',
          color: cluster.color,
          items: filteredNodes.filter((node) => node.clusterId === cluster.id),
        }))
        .filter((group) => group.items.length > 0)
      const uncategorized = filteredNodes.filter((node) => !node.clusterId || !knownClusterIds.has(node.clusterId))
      return uncategorized.length > 0
        ? [...clusterGroups, { id: '_uncategorized', label: '未分类', accent: 'bg-white/25', items: uncategorized }]
        : clusterGroups
    }

    return []
  }, [clusters, filteredNodes, groupMode, typeFilters])

  const openCard = (node: GalaxyNode) => {
    setSelectedNode({ id: node.id, title: node.title, type: node.type })
    setMode('forge')
    if (!panelLayout.right.includes('editor')) {
      const nextLayout: PanelLayout = {
        left: panelLayout.left.filter((panel) => panel !== 'editor'),
        right: [...panelLayout.right, 'editor'],
      }
      setPanelLayout(nextLayout)
    }
  }

  const toggleGroup = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleCreateSpace = async () => {
    const name = newSpaceName.trim()
    if (!name || createCluster.isPending) return
    try {
      const result = await createCluster.mutateAsync({ name, color: newSpaceColor })
      setNewSpaceName('')
      setShowNewSpace(false)
      setGroupMode('cluster')
      setExpanded((prev) => new Set(prev).add(result.cluster.id))
      toast.success(`知识空间「${result.cluster.name}」已创建`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '创建知识空间失败')
    }
  }

  return (
    <aside className="side-slot visible forge-card-tray flex-col pointer-events-auto" style={{ width: '100%', flex: 1, padding: 'var(--panel-py) 0' }}>
      <div className="glass-panel workspace-surface workspace-library-surface flex flex-1 flex-col overflow-hidden rounded-2xl border-white/10 bg-black/45">
        <div className="workspace-panel-head border-b border-white/8 px-3 py-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-cyan-400/18 bg-cyan-400/8 text-cyan-100">
                <Folder className="h-3.5 w-3.5" />
              </div>
              <div className="min-w-0">
                <div className="mono text-[9px] uppercase tracking-[0.16em] text-white/42">Cards</div>
                <div className="truncate text-[11px] text-white/76">卡片库</div>
              </div>
            </div>
            <div className="mono text-[8px] text-white/24">{filteredNodes.length}/{nodes.length}</div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-1.5">
            <button
              className="flex h-8 items-center justify-center gap-1.5 rounded-lg border border-cyan-400/18 bg-cyan-400/8 text-[10px] text-cyan-100/80 transition-colors hover:bg-cyan-400/12 hover:text-cyan-100"
              onClick={() => openModal('newcard')}
            >
              <Plus className="h-3.5 w-3.5" />
              新建卡片
            </button>
            <button
              className={`flex h-8 items-center justify-center gap-1.5 rounded-lg border text-[10px] transition-colors ${
                showNewSpace
                  ? 'border-cyan-400/24 bg-cyan-400/12 text-cyan-100'
                  : 'border-white/8 bg-white/[0.025] text-white/44 hover:text-white/70'
              }`}
              onClick={() => setShowNewSpace((value) => !value)}
            >
              {showNewSpace ? <X className="h-3.5 w-3.5" /> : <FolderPlus className="h-3.5 w-3.5" />}
              新建空间
            </button>
          </div>

          {showNewSpace && (
            <div className="mt-2 rounded-xl border border-cyan-400/14 bg-cyan-400/[0.045] p-2">
              <input
                className="h-8 w-full rounded-lg border border-white/8 bg-black/30 px-2 text-[11px] text-white/72 outline-none placeholder:text-white/22 focus:border-cyan-400/28"
                value={newSpaceName}
                onChange={(event) => setNewSpaceName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void handleCreateSpace()
                  if (event.key === 'Escape') setShowNewSpace(false)
                }}
                placeholder="知识空间名称"
                autoFocus
              />
              <div className="mt-2 flex items-center gap-1.5">
                {CLUSTER_COLORS.map((color) => (
                  <button
                    key={color}
                    className={`h-5 w-5 rounded-full border transition-transform ${newSpaceColor === color ? 'scale-110 border-white/70' : 'border-white/12'}`}
                    style={{ backgroundColor: color }}
                    onClick={() => setNewSpaceColor(color)}
                    title={color}
                  />
                ))}
                <button
                  className="ml-auto h-7 rounded-md border border-cyan-400/20 bg-cyan-400/10 px-2 text-[10px] text-cyan-100/80 transition-colors hover:bg-cyan-400/14 disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={!newSpaceName.trim() || createCluster.isPending}
                  onClick={() => void handleCreateSpace()}
                >
                  {createCluster.isPending ? '创建中' : '创建'}
                </button>
              </div>
            </div>
          )}

          <div className="mt-3 flex items-center gap-2 rounded-lg border border-white/8 bg-black/28 px-2 py-1.5">
            <Search className="h-3.5 w-3.5 shrink-0 text-white/24" />
            <input
              className="min-w-0 flex-1 bg-transparent text-[11px] text-white/70 outline-none placeholder:text-white/22"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索卡片、标签、星团"
            />
          </div>

          <div className="mt-2 grid grid-cols-4 gap-1">
            {typeFilters.map((item) => {
              const active = typeFilter === item.id
              return (
                <button
                  key={item.id}
                  className={`h-7 rounded-md border text-[10px] transition-colors ${
                    active
                      ? 'border-cyan-400/24 bg-cyan-400/10 text-cyan-100'
                      : 'border-white/6 bg-white/[0.025] text-white/34 hover:text-white/62'
                  }`}
                  onClick={() => setTypeFilter(item.id)}
                >
                  {item.label}
                </button>
              )
            })}
          </div>

          <div className="mt-2 flex items-center gap-1">
            <Filter className="h-3.5 w-3.5 text-white/20" />
            {(['flat', 'type', 'cluster'] as GroupMode[]).map((mode) => (
              <button
                key={mode}
                className={`rounded-md px-2 py-1 mono text-[8px] transition-colors ${
                  groupMode === mode ? 'bg-white/10 text-white/66' : 'text-white/24 hover:bg-white/[0.04] hover:text-white/48'
                }`}
                onClick={() => setGroupMode(mode)}
              >
                {GROUP_LABEL[mode]}
              </button>
            ))}
            <button
              className={`ml-auto flex items-center gap-1 rounded-md px-2 py-1 mono text-[8px] transition-colors ${
                sortMode === 'type' ? 'bg-white/10 text-white/66' : 'text-white/24 hover:bg-white/[0.04] hover:text-white/48'
              }`}
              onClick={() => setSortMode((mode) => mode === 'name' ? 'type' : 'name')}
              title={sortMode === 'name' ? '按名称排序' : '按类型排序'}
            >
              <ArrowUpAZ className="h-3 w-3" />
              {sortMode === 'name' ? '名称' : '类型'}
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto no-scrollbar px-2 py-2">
          {filteredNodes.length === 0 ? (
            <div className="flex h-full min-h-[220px] flex-col items-center justify-center px-6 text-center">
              <FileText className="mb-3 h-7 w-7 text-white/12" />
              <div className="mono text-[10px] text-white/22">
                {query.trim() ? '没有匹配的卡片' : '暂无卡片'}
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              {groupMode === 'flat' ? (
                filteredNodes.map((node) => (
                  <CardRow
                    key={node.id}
                    node={node}
                    clusterColor={node.clusterId ? clusterMap.get(node.clusterId)?.color : undefined}
                    active={selectedNode?.id === node.id}
                    onOpen={() => openCard(node)}
                  />
                ))
              ) : groups.map((group) => {
                const isOpen = expanded.has(group.id)
                return (
                  <div key={group.id}>
                    <button
                      className="flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left transition-colors hover:bg-white/[0.04]"
                      onClick={() => toggleGroup(group.id)}
                    >
                      {isOpen ? <ChevronDown className="h-3.5 w-3.5 text-white/28" /> : <ChevronRight className="h-3.5 w-3.5 text-white/24" />}
                      {group.color ? (
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: group.color }} />
                      ) : (
                        <span className={`h-2 w-2 shrink-0 rounded-full ${group.accent}`} />
                      )}
                      <span className="min-w-0 flex-1 truncate text-[10px] font-medium text-white/54">{group.label}</span>
                      <span className="mono text-[8px] text-white/20">{group.items.length}</span>
                    </button>

                    {isOpen && (
                      <div className="space-y-0.5 pb-1">
                        {group.items.map((node) => (
                          <CardRow
                            key={node.id}
                            node={node}
                            clusterColor={node.clusterId ? clusterMap.get(node.clusterId)?.color : undefined}
                            active={selectedNode?.id === node.id}
                            onOpen={() => openCard(node)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}

function CardRow({
  node,
  clusterColor,
  active,
  onOpen,
}: {
  node: GalaxyNode
  clusterColor?: string
  active: boolean
  onOpen: () => void
}) {
  const meta = getTypeMeta(node.type)
  return (
    <button
      className={`group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors ${
        active ? 'bg-cyan-400/[0.075] text-white' : 'text-white/48 hover:bg-white/[0.04] hover:text-white/78'
      }`}
      onClick={onOpen}
      title={node.title}
    >
      <span className="relative flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-white/7 bg-black/24">
        <FileText className={`h-3.5 w-3.5 ${active ? 'text-cyan-100' : meta.tone}`} />
        {clusterColor && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full border border-black/60" style={{ backgroundColor: clusterColor }} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[11px] leading-4">{node.title || '未命名卡片'}</span>
        <span className="mt-0.5 flex min-w-0 items-center gap-1.5">
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${meta.dot}`} />
          <span className="mono text-[8px] text-white/24">{meta.label}</span>
          {node.clusterName && (
            <>
              <span className="text-white/12">/</span>
              <span className="truncate mono text-[8px] text-white/20">{node.clusterName}</span>
            </>
          )}
        </span>
      </span>
      {active && <Check className="h-3.5 w-3.5 shrink-0 text-cyan-100/70" />}
    </button>
  )
}
