'use client'

/**
 * File Tree — 左侧面板的文件浏览器
 * 按集群分组显示 vault 中的所有卡片，支持筛选、排序、搜索。
 */

import { useState, useMemo } from 'react'
import { useAppStore } from '@/stores/mode-store'
import { useGalaxyData } from '@/hooks/use-galaxy'

type TypeFilter = 'all' | 'fleeting' | 'permanent' | 'literature'
type SortMode = 'name' | 'updated' | 'type'
type ViewMode = 'cluster' | 'type'

const TYPE_LABELS: Record<TypeFilter, string> = {
  all: '全部',
  fleeting: '灵感',
  permanent: '永久',
  literature: '文献',
}

const TYPE_GROUP_META: Record<string, { label: string; color: string; dot: string }> = {
  permanent: { label: '永久卡片', color: 'bg-purple-500', dot: '◆' },
  literature: { label: '文献卡片', color: 'bg-pink-500', dot: '○' },
  fleeting: { label: '灵感卡片', color: 'bg-cyan-500', dot: '◇' },
}

const TYPE_ORDER = ['permanent', 'literature', 'fleeting']

const SORT_LABELS: Record<SortMode, string> = {
  name: '名称',
  updated: '更新',
  type: '类型',
}

export default function FileTree() {
  const { data } = useGalaxyData()
  const setSelectedNode = useAppStore((s) => s.setSelectedNode)
  const setMode = useAppStore((s) => s.setMode)
  const setRightOpen = useAppStore((s) => s.setRightPanelOpen)
  const setRightView = useAppStore((s) => s.setRightPanelView)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [sortMode, setSortMode] = useState<SortMode>('name')
  const [viewMode, setViewMode] = useState<ViewMode>('cluster')
  const [showFilters, setShowFilters] = useState(false)

  const clusters = data?.clusters ?? []
  const nodes = data?.nodes ?? []

  const toggleCluster = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const handleOpen = (node: { id: string; title: string; type: string }) => {
    setSelectedNode({ id: node.id, title: node.title, type: node.type })
    setRightView('editor')
    setRightOpen(true)
    setMode('forge')
  }

  // Filter by type
  const filteredByType = useMemo(() => {
    if (typeFilter === 'all') return nodes
    return nodes.filter(n => n.type === typeFilter)
  }, [nodes, typeFilter])

  // Search filter (title only for now — content requires extra API calls)
  const q = search.toLowerCase().trim()
  const filteredNodes = useMemo(() => {
    if (!q) return filteredByType
    return filteredByType.filter(n =>
      (n.title || '').toLowerCase().includes(q)
    )
  }, [filteredByType, q])

  // Sort
  const sortedNodes = useMemo(() => {
    const arr = [...filteredNodes]
    switch (sortMode) {
      case 'name':
        arr.sort((a, b) => (a.title || '').localeCompare(b.title || ''))
        break
      case 'type':
        arr.sort((a, b) => {
          const ta = a.type === 'permanent' ? 0 : a.type === 'literature' ? 1 : 2
          const tb = b.type === 'permanent' ? 0 : b.type === 'literature' ? 1 : 2
          return ta - tb
        })
        break
      default:
        arr.sort((a, b) => (a.title || '').localeCompare(b.title || ''))
    }
    return arr
  }, [filteredNodes, sortMode])

  // Group by cluster
  const grouped = useMemo(() => {
    const clusterIds = new Set(clusters.map(c => c.id))
    const groups = clusters
      .map(cluster => ({
        ...cluster,
        items: sortedNodes.filter(n => n.clusterId === cluster.id),
      }))
      .filter(g => g.items.length > 0)
    const unclustered = sortedNodes.filter(n => !n.clusterId || !clusterIds.has(n.clusterId))
    return { groups, unclustered }
  }, [clusters, sortedNodes])

  // Group by type
  const typeGroups = useMemo(() => {
    return TYPE_ORDER.map(t => ({
      id: t,
      name: TYPE_GROUP_META[t].label,
      color: TYPE_GROUP_META[t].color,
      dot: TYPE_GROUP_META[t].dot,
      items: sortedNodes.filter(n => n.type === t),
    })).filter(g => g.items.length > 0)
  }, [sortedNodes])

  // Active grouping
  const activeList = viewMode === 'type' ? typeGroups : [...grouped.groups]
  const showUnclustered = viewMode === 'cluster' && grouped.unclustered.length > 0

  // Type color helper
  const typeColor = (type: string) =>
    type === 'permanent' ? 'bg-purple-400'
    : type === 'literature' ? 'bg-pink-400'
    : 'bg-cyan-400'

  return (
    <aside className="side-slot visible flex-col pointer-events-auto" style={{ width: 'var(--panel-sm)', flex: 1, padding: 'var(--panel-py) 0' }}>
      <div className="glass-panel rounded-2xl flex-1 flex flex-col overflow-hidden">
        {/* Search */}
        <div className="px-3 pt-3 pb-2 space-y-2">
          <div className="relative">
            <input
              type="text"
              className="w-full bg-white/5 border border-white/10 rounded-lg pl-3 pr-8 py-1.5 outline-none text-white/70 mono transition-all focus:border-purple-500/30 focus:bg-purple-500/5"
              placeholder="搜索标题或内容..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ fontSize: 'var(--f9)' }}
            />
            {/* Filter toggle */}
            <button
              className={`absolute right-1.5 top-1/2 -translate-y-1/2 mono transition-colors ${showFilters ? 'text-purple-400' : 'text-white/20 hover:text-white/50'}`}
              style={{ fontSize: 9 }}
              onClick={() => setShowFilters(!showFilters)}
            >
              ☰
            </button>
          </div>

          {/* Filter bar */}
          {showFilters && (
            <div className="flex items-center gap-2 pt-1 pb-0.5 animate-in fade-in duration-200">
              {/* View mode toggle */}
              <div className="flex gap-0.5 border border-white/10 rounded-lg p-0.5">
                <button
                  className={`px-2 py-0.5 rounded-md mono transition-all ${viewMode === 'cluster' ? 'text-white bg-white/15' : 'text-white/30 hover:text-white/50'}`}
                  style={{ fontSize: 8 }}
                  onClick={() => { setViewMode('cluster'); typeFilter !== 'all' && setTypeFilter('all') }}
                >星团</button>
                <button
                  className={`px-2 py-0.5 rounded-md mono transition-all ${viewMode === 'type' ? 'text-white bg-white/15' : 'text-white/30 hover:text-white/50'}`}
                  style={{ fontSize: 8 }}
                  onClick={() => setViewMode('type')}
                >类型</button>
              </div>

              {/* Type filter (only in cluster mode) */}
              {viewMode === 'cluster' && (
                <div className="flex gap-0.5">
                  {(Object.keys(TYPE_LABELS) as TypeFilter[]).map(t => (
                    <button
                      key={t}
                      className={`px-1.5 py-0.5 rounded-md mono transition-all ${
                        typeFilter === t
                          ? 'text-white bg-white/15'
                          : 'text-white/25 hover:text-white/50'
                      }`}
                      style={{ fontSize: 8 }}
                      onClick={() => setTypeFilter(t)}
                    >
                      {TYPE_LABELS[t]}
                    </button>
                  ))}
                </div>
              )}

              {/* Sort selector */}
              <div className="flex items-center gap-0.5 ml-auto">
                <span className="mono text-white/15" style={{ fontSize: 7 }}>排序</span>
                {(Object.keys(SORT_LABELS) as SortMode[]).map(s => (
                  <button
                    key={s}
                    className={`px-1 py-0.5 rounded mono transition-all ${sortMode === s ? 'text-purple-400 bg-purple-500/10' : 'text-white/20 hover:text-white/40'}`}
                    style={{ fontSize: 7 }}
                    onClick={() => setSortMode(s)}
                  >
                    {SORT_LABELS[s]}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* File list */}
        <div className="flex-1 overflow-y-auto no-scrollbar px-2 pb-2">
          {sortedNodes.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center px-8">
              <div className="mono text-white/10 text-[10px] leading-relaxed">
                {q ? '未找到匹配节点' : typeFilter !== 'all' ? '该类型暂无卡片' : '暂无卡片'}
              </div>
            </div>
          ) : (
            <>
              {activeList.map(group => {
                const isType = viewMode === 'type'
                return (
                <div key={group.id} className="mb-1">
                  <div
                    className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg cursor-pointer hover:bg-white/5 transition-colors group"
                    onClick={() => toggleCluster(group.id)}
                  >
                    <span className="text-white/20 mono group-hover:text-white/40 transition-colors" style={{ fontSize: 9 }}>
                      {expanded.has(group.id) ? '▼' : '▶'}
                    </span>
                    {isType ? (
                      <span className={`w-2 h-2 rounded-full ${group.color}`} />
                    ) : (
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: (group as any).color }} />
                    )}
                    <span className={`truncate ${isType ? 'text-white/80 font-medium' : 'text-white/60 font-medium'}`} style={{ fontSize: 'var(--f9)' }}>{group.name}</span>
                    <span className="mono text-white/15 ml-auto" style={{ fontSize: 8 }}>{group.items.length}</span>
                  </div>
                  {expanded.has(group.id) && group.items.map(node => (
                    <div
                      key={node.id}
                      className="flex items-center gap-2 pl-7 pr-2 py-1 rounded-lg cursor-pointer hover:bg-white/5 transition-colors group"
                      onClick={() => handleOpen(node)}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${typeColor(node.type)}`} />
                      <span className="text-white/45 group-hover:text-white/80 truncate flex-1" style={{ fontSize: 'var(--f9)' }}>{node.title}</span>
                      <span className="mono text-white/10 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" style={{ fontSize: 7 }}>
                        {node.type === 'fleeting' ? '◇' : node.type === 'permanent' ? '◆' : '○'}
                      </span>
                    </div>
                  ))}
                </div>
                )
              })}

              {/* Unclustered (cluster mode only) */}
              {showUnclustered && (
                <div className="mt-2 pt-2 border-t border-white/5">
                  <div
                    className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg cursor-pointer hover:bg-white/5 transition-colors"
                    onClick={() => toggleCluster('_orphans')}
                  >
                    <span className="text-white/20 mono" style={{ fontSize: 9 }}>{expanded.has('_orphans') ? '▼' : '▶'}</span>
                    <span className="w-2 h-2 rounded-full bg-white/20" />
                    <span className="text-white/40 truncate" style={{ fontSize: 'var(--f9)' }}>未分类</span>
                    <span className="mono text-white/15 ml-auto" style={{ fontSize: 8 }}>{grouped.unclustered.length}</span>
                  </div>
                  {expanded.has('_orphans') && grouped.unclustered.map(node => (
                    <div
                      key={node.id}
                      className="flex items-center gap-2 pl-7 pr-2 py-1 rounded-lg cursor-pointer hover:bg-white/5 group transition-colors"
                      onClick={() => handleOpen(node)}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${typeColor(node.type)}`} />
                      <span className="text-white/45 group-hover:text-white/80 truncate" style={{ fontSize: 'var(--f9)' }}>{node.title}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Status bar */}
        <div className="px-3 py-2 border-t border-white/5 flex items-center justify-between">
          <span className="mono text-white/15" style={{ fontSize: 'var(--f6)' }}>
            {sortedNodes.length} / {nodes.length} 个节点
          </span>
          <span className="mono text-white/10" style={{ fontSize: 'var(--f6)' }}>
            {viewMode === 'type' ? `${typeGroups.length} 个类型` : `${clusters.length} 个集群`}
          </span>
        </div>
      </div>
    </aside>
  )
}
