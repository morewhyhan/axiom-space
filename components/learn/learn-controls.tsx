'use client'

import { useState } from 'react'
import { useLearningPaths, useGeneratePath, useDeletePath, useImportDocument } from '@/hooks/use-learning'
import type { ImportDocumentResult } from '@/hooks/use-learning'
import { useAppStore, useGalaxyActions } from '@/stores/mode-store'
import type { LearningPath } from '@/hooks/use-learning'

export default function LearnControls() {
  const { data, loading } = useLearningPaths()
  const generatePath = useGeneratePath()
  const deletePath = useDeletePath()
  const importDocument = useImportDocument()
  const selectedPathId = useAppStore((s) => s.selectedPathId)
  const setSelectedPathId = useAppStore((s) => s.setSelectedPathId)

  const paths = data?.paths ?? []

  // ── Create state ──
  const [createMode, setCreateMode] = useState<'idle' | 'ai' | 'progressive' | 'batch' | 'material'>('idle')
  const [customTopic, setCustomTopic] = useState('')
  const [customLevel, setCustomLevel] = useState<string>('beginner')
  const [customMaterial, setCustomMaterial] = useState('')
  const [genError, setGenError] = useState<string | null>(null)
  const [importResult, setImportResult] = useState<ImportDocumentResult | null>(null)

  const handleGenerate = async (topic: string, level = 'beginner') => {
    if (!topic.trim()) return
    setGenError(null)
    try {
      const mode = createMode === 'progressive' ? 'progressive' : createMode === 'batch' ? 'batch' : 'full'
      const result = await generatePath.mutateAsync({
        topic: topic.trim(),
        level,
        mode,
        batchSize: createMode === 'progressive' ? 3 : createMode === 'batch' ? 10 : undefined,
        material: customMaterial.slice(0, 5000) || undefined,
      })
      if (result?.id) setSelectedPathId(result.id)
      setCreateMode('idle')
      setCustomTopic('')
      setCustomMaterial('')
    } catch (e: unknown) {
      setGenError(e instanceof Error ? e.message : '生成失败')
    }
  }

  const handleDelete = async (e: React.MouseEvent, pathId: string) => {
    e.stopPropagation()
    try {
      await deletePath.mutateAsync(pathId)
      if (selectedPathId === pathId) setSelectedPathId(null)
    } catch {}
  }

  const handleImportDocument = async () => {
    if (!customMaterial.trim()) return
    setGenError(null)
    setImportResult(null)
    try {
      const result = await importDocument.mutateAsync({
        document: customMaterial,
        topic: customTopic.trim() || '文献学习',
        sourceTitle: customTopic.trim() || undefined,
      })
      setImportResult(result)
      if (result.pathId) setSelectedPathId(result.pathId)
      setCreateMode('idle')
      setCustomTopic('')
      setCustomMaterial('')
      setTimeout(() => setImportResult(null), 8000)
    } catch (e: unknown) {
      setGenError(e instanceof Error ? e.message : '导入失败')
    }
  }

  // ── Group paths by status ──
  const activePaths = paths.filter(p => p.progress > 0 && p.progress < 100)
  const newPaths = paths.filter(p => p.progress === 0)
  const completedPaths = paths.filter(p => p.progress >= 100)
  const isEmpty = paths.length === 0 && !loading

  return (
    <aside
      className="side-slot visible flex-col pointer-events-auto"
      style={{ width: 'var(--panel-md)', padding: 'var(--panel-py) 0' }}
    >
      <div
        className="glass-panel rounded-2xl flex flex-col overflow-hidden border-purple-500/20 shadow-[0_0_30px_rgba(168,85,247,0.05)]"
        style={{ height: '100%' }}
      >
        {/* ── Header ── */}
        <div className="px-5 py-4 border-b border-white/5 flex-shrink-0 bg-gradient-to-b from-purple-500/5 to-transparent">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-purple-500/20 border border-purple-500/30 flex items-center justify-center">
                  <span className="text-purple-400 text-xs">✦</span>
                </div>
                <span className="mono text-purple-400 font-bold" style={{ fontSize: 'var(--f10)' }}>
                  任务大厅
                </span>
              </div>
              <p className="mono text-white/15 mt-0.5" style={{ fontSize: 'var(--f7)' }}>
                AI 驱动的概念学习路径
              </p>
            </div>
            {!isEmpty && (
              <button
                className="mono text-[10px] px-3 py-1.5 rounded-lg bg-purple-500/15 border border-purple-500/30 text-purple-400 hover:bg-purple-500/25 transition-all"
                onClick={() => setCreateMode(createMode === 'idle' ? 'ai' : 'idle')}
              >
                + 新建任务
              </button>
            )}
          </div>
        </div>

        {/* ── Create panel ── */}
        {createMode !== 'idle' && (
          <div className="mx-4 mt-4 p-4 rounded-xl bg-purple-500/8 border border-purple-500/20 space-y-3 flex-shrink-0">
            {/* Mode tabs */}
            <div className="flex gap-1 bg-black/30 rounded-lg p-1 flex-wrap">
              <button
                className={`flex-1 py-1.5 rounded-md text-center mono transition-all text-[9px] ${
                  createMode === 'ai'
                    ? 'bg-purple-500/20 text-purple-400'
                    : 'text-white/25 hover:text-white/45'
                }`}
                onClick={() => { setCreateMode('ai'); setGenError(null) }}
              >
                AI 智能生成
              </button>
              <button
                className={`flex-1 py-1.5 rounded-md text-center mono transition-all text-[9px] ${
                  createMode === 'progressive'
                    ? 'bg-purple-500/20 text-purple-400'
                    : 'text-white/25 hover:text-white/45'
                }`}
                onClick={() => { setCreateMode('progressive'); setGenError(null) }}
              >
                渐进 (3个/批)
              </button>
              <button
                className={`flex-1 py-1.5 rounded-md text-center mono transition-all text-[9px] ${
                  createMode === 'batch'
                    ? 'bg-purple-500/20 text-purple-400'
                    : 'text-white/25 hover:text-white/45'
                }`}
                onClick={() => { setCreateMode('batch'); setGenError(null) }}
              >
                批量节点
              </button>
              <button
                className={`flex-1 py-1.5 rounded-md text-center mono transition-all text-[9px] ${
                  createMode === 'material'
                    ? 'bg-purple-500/20 text-purple-400'
                    : 'text-white/25 hover:text-white/45'
                }`}
                onClick={() => { setCreateMode('material'); setGenError(null) }}
              >
                从文献导入
              </button>
            </div>

            {/* ── AI Generate ── */}
            {createMode === 'ai' && (
              <>
                <input
                  type="text"
                  className="w-full bg-black/30 border border-purple-500/30 rounded-lg px-4 py-2.5 outline-none text-white/80 placeholder:text-white/15 focus:border-purple-500/50"
                  style={{ fontSize: 'var(--f9)' }}
                  placeholder="想学什么？例如：Python 基础、机器学习..."
                  value={customTopic}
                  onChange={e => setCustomTopic(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleGenerate(customTopic, customLevel) }}
                  autoFocus
                />
                <div className="flex gap-1.5">
                  {(['beginner', 'intermediate', 'advanced'] as const).map(l => (
                    <button
                      key={l}
                      className={`flex-1 py-1.5 rounded-lg text-center mono transition-all text-[9px] ${
                        customLevel === l
                          ? 'text-purple-400 bg-purple-500/15 border border-purple-500/30'
                          : 'text-white/15 border border-transparent hover:text-white/30'
                      }`}
                      onClick={() => setCustomLevel(l)}
                    >
                      {l === 'beginner' ? '基础' : l === 'intermediate' ? '进阶' : '高级'}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <button
                    className="flex-1 py-2 rounded-lg bg-purple-500/20 border border-purple-500/40 text-purple-400 mono font-bold text-[10px] transition-all hover:bg-purple-500/30 active:scale-[0.98] disabled:opacity-30"
                    onClick={() => handleGenerate(customTopic, customLevel)}
                    disabled={generatePath.isPending || !customTopic.trim()}
                  >
                    {generatePath.isPending ? '生成中...' : '生成学习路径'}
                  </button>
                  <button
                    className="px-3 py-2 rounded-lg border border-white/10 text-white/30 mono text-[10px] hover:text-white/50"
                    onClick={() => { setCreateMode('idle'); setCustomTopic(''); setGenError(null) }}
                  >
                    取消
                  </button>
                </div>
                {genError && <div className="mono text-[8px] text-red-400/60">{genError}</div>}
              </>
            )}

            {/* ── Progressive Generate ── */}
            {createMode === 'progressive' && (
              <>
                <p className="mono text-white/30 leading-relaxed" style={{ fontSize: 'var(--f8)' }}>
                  AI 每次生成 3 个概念节点作为闪念卡片。学完当前批次后，根据掌握程度自动生成下一批。
                </p>
                <input
                  type="text"
                  className="w-full bg-black/30 border border-purple-500/30 rounded-lg px-4 py-2.5 outline-none text-white/80 placeholder:text-white/15 focus:border-purple-500/50"
                  style={{ fontSize: 'var(--f9)' }}
                  placeholder="想学什么？例如：数据结构、微积分..."
                  value={customTopic}
                  onChange={e => setCustomTopic(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleGenerate(customTopic, customLevel) }}
                  autoFocus
                />
                <div className="flex gap-2">
                  <button
                    className="flex-1 py-2 rounded-lg bg-purple-500/20 border border-purple-500/40 text-purple-400 mono font-bold text-[10px] transition-all hover:bg-purple-500/30 active:scale-[0.98] disabled:opacity-30"
                    onClick={() => handleGenerate(customTopic, customLevel)}
                    disabled={generatePath.isPending || !customTopic.trim()}
                  >
                    {generatePath.isPending ? '生成中...' : '生成首批 3 个概念'}
                  </button>
                  <button
                    className="px-3 py-2 rounded-lg border border-white/10 text-white/30 mono text-[10px] hover:text-white/50"
                    onClick={() => { setCreateMode('idle'); setCustomTopic(''); setGenError(null) }}
                  >取消</button>
                </div>
                {genError && <div className="mono text-[8px] text-red-400/60">{genError}</div>}
              </>
            )}

            {/* ── Batch Generate ── */}
            {createMode === 'batch' && (
              <>
                <p className="mono text-white/30 leading-relaxed" style={{ fontSize: 'var(--f8)' }}>
                  AI 一次性生成大量概念节点（8-20 个），每个作为独立的闪念卡片，LLM 自动建立关联边。
                </p>
                <input
                  type="text"
                  className="w-full bg-black/30 border border-purple-500/30 rounded-lg px-4 py-2.5 outline-none text-white/80 placeholder:text-white/15 focus:border-purple-500/50"
                  style={{ fontSize: 'var(--f9)' }}
                  placeholder="主题名称，例如：计算机网络、线性代数..."
                  value={customTopic}
                  onChange={e => setCustomTopic(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleGenerate(customTopic, customLevel) }}
                  autoFocus
                />
                <div className="flex gap-2">
                  <button
                    className="flex-1 py-2 rounded-lg bg-cyan-500/20 border border-cyan-500/40 text-cyan-400 mono font-bold text-[10px] transition-all hover:bg-cyan-500/30 active:scale-[0.98] disabled:opacity-30"
                    onClick={() => handleGenerate(customTopic, customLevel)}
                    disabled={generatePath.isPending || !customTopic.trim()}
                  >
                    {generatePath.isPending ? '生成中...' : '批量生成概念节点'}
                  </button>
                  <button
                    className="px-3 py-2 rounded-lg border border-white/10 text-white/30 mono text-[10px] hover:text-white/50"
                    onClick={() => { setCreateMode('idle'); setCustomTopic(''); setGenError(null) }}
                  >取消</button>
                </div>
                {genError && <div className="mono text-[8px] text-red-400/60">{genError}</div>}
              </>
            )}

            {/* ── Material Import ── */}
            {createMode === 'material' && (
              <>
                <p className="mono text-white/30 leading-relaxed" style={{ fontSize: 'var(--f8)' }}>
                  粘贴文献或学习资料全文，AI 会自动提取核心概念生成 permanent 卡片、细节知识点 fleeting 卡片、
                  并建立知识图谱关联，同时生成结构化的学习路径。一次完成，无需逐张创建。
                </p>
                <textarea
                  className="w-full bg-black/30 border border-purple-500/30 rounded-lg px-4 py-3 outline-none text-white/80 placeholder:text-white/15 focus:border-purple-500/50 resize-none"
                  style={{ fontSize: 'var(--f9)' }}
                  rows={8}
                  placeholder="在此粘贴文档全文（支持 50000 字以内）..."
                  value={customMaterial}
                  onChange={e => setCustomMaterial(e.target.value)}
                />
                <input
                  type="text"
                  className="w-full bg-black/30 border border-purple-500/30 rounded-lg px-4 py-2.5 outline-none text-white/80 placeholder:text-white/15 focus:border-purple-500/50"
                  style={{ fontSize: 'var(--f9)' }}
                  placeholder="主题名称（如：数据结构与算法）"
                  value={customTopic}
                  onChange={e => setCustomTopic(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleImportDocument() }}
                />
                <div className="flex gap-2">
                  <button
                    className="flex-1 py-2 rounded-lg bg-purple-500/20 border border-purple-500/40 text-purple-400 mono font-bold text-[10px] transition-all hover:bg-purple-500/30 active:scale-[0.98] disabled:opacity-30"
                    onClick={handleImportDocument}
                    disabled={importDocument.isPending || !customMaterial.trim()}
                  >
                    {importDocument.isPending ? 'AI 分析文档中...' : '导入文档生成知识卡片'}
                  </button>
                  <button
                    className="px-3 py-2 rounded-lg border border-white/10 text-white/30 mono text-[10px] hover:text-white/50"
                    onClick={() => { setCreateMode('idle'); setCustomTopic(''); setCustomMaterial(''); setGenError(null); setImportResult(null) }}
                  >
                    取消
                  </button>
                </div>
                {importDocument.isPending && (
                  <div className="flex items-center gap-2 text-cyan-400/60 mono text-[9px]">
                    <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
                    AI 正在解析文档、生成卡片、建立关联...
                  </div>
                )}
                {importResult && (
                  <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 mono text-[9px] space-y-1">
                    <div className="font-bold">✅ 导入完成</div>
                    <div>📘 核心概念 {importResult.stats.permanent} 个</div>
                    <div>🏷️ 知识点 {importResult.stats.fleeting} 个</div>
                    <div>📄 文献记录 {importResult.stats.literature} 个</div>
                    <div>🔗 关联边 {importResult.stats.edges} 条</div>
                    {importResult.pathId && <div>📚 已自动创建学习路径 ✓</div>}
                  </div>
                )}
                {genError && <div className="mono text-[8px] text-red-400/60">{genError}</div>}
              </>
            )}
          </div>
        )}

        {/* ── Path list ── */}
        <div className="flex-1 overflow-y-auto no-scrollbar min-h-0 px-4 py-4 space-y-5">
          {loading ? (
            <div className="flex justify-center py-16">
              <div className="w-8 h-8 border-t-2 border-purple-500 rounded-full animate-spin opacity-20" />
            </div>
          ) : isEmpty ? (
            /* ── Empty state ── */
            <div className="flex flex-col items-center justify-center py-10 px-3">
              <div className="w-14 h-14 rounded-2xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center mb-4">
                <span className="text-2xl opacity-40">✦</span>
              </div>
              <h3 className="text-white/50 font-bold mb-2" style={{ fontSize: 'var(--f10)' }}>
                开始你的学习之旅
              </h3>
              <p className="mono text-white/15 text-center leading-relaxed mb-6" style={{ fontSize: 'var(--f8)' }}>
                输入你想学的主题，AI 会生成一个结构化的概念学习路径。
                <br />
                每个概念按顺序学习，确保循序渐进地掌握知识。
              </p>
              <div className="w-full space-y-2">
                <button
                  className="w-full py-3 rounded-xl bg-purple-500/15 border border-purple-500/30 text-purple-400 font-bold text-[10px] mono hover:bg-purple-500/25 transition-all"
                  onClick={() => setCreateMode('ai')}
                >
                  ✦ 输入主题，AI 生成路径
                </button>
                <button
                  className="w-full py-3 rounded-xl bg-white/5 border border-white/10 text-white/35 font-bold text-[10px] mono hover:bg-white/10 transition-all"
                  onClick={() => setCreateMode('material')}
                >
                  ◇ 导入文献，提取概念
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Active paths */}
              {activePaths.length > 0 && (
                <Section label="进行中" count={activePaths.length} accent="purple">
                  {activePaths.map(p => (
                    <PathCard
                      key={p.id}
                      path={p}
                      isSelected={p.id === selectedPathId}
                      onSelect={() => setSelectedPathId(p.id)}
                      onDelete={handleDelete}
                    />
                  ))}
                </Section>
              )}

              {/* New paths */}
              {newPaths.length > 0 && (
                <Section label="待开始" count={newPaths.length} accent="cyan">
                  {newPaths.map(p => (
                    <PathCard
                      key={p.id}
                      path={p}
                      isSelected={p.id === selectedPathId}
                      onSelect={() => setSelectedPathId(p.id)}
                      onDelete={handleDelete}
                    />
                  ))}
                </Section>
              )}

              {/* Completed paths */}
              {completedPaths.length > 0 && (
                <Section label="已完成" count={completedPaths.length} accent="green" defaultCollapsed>
                  {completedPaths.map(p => (
                    <PathCard
                      key={p.id}
                      path={p}
                      isSelected={p.id === selectedPathId}
                      onSelect={() => setSelectedPathId(p.id)}
                      onDelete={handleDelete}
                    />
                  ))}
                </Section>
              )}
            </>
          )}
        </div>

        {/* ── Footer ── */}
        {!isEmpty && (
          <div className="px-5 py-2.5 bg-black/20 border-t border-white/5 flex items-center justify-between opacity-25">
            <span className="mono text-[7px]">{paths.length} 个路径</span>
            <span className="mono text-[7px]">
              {paths.reduce((sum, p) => sum + p.doneCount, 0)}/{paths.reduce((sum, p) => sum + p.totalCount, 0)} 已掌握
            </span>
          </div>
        )}
      </div>
    </aside>
  )
}

// ═══════════════════════════════════════════════
// Section — collapsible group of path cards
// ═══════════════════════════════════════════════

const ACCENT_MAP = {
  purple: {
    dot: 'bg-purple-500',
    dotShadow: 'shadow-[0_0_6px_rgba(168,85,247,0.5)]',
    text: 'text-purple-400/80',
  },
  cyan: {
    dot: 'bg-cyan-500',
    dotShadow: '',
    text: 'text-cyan-400/80',
  },
  green: {
    dot: 'bg-green-500',
    dotShadow: '',
    text: 'text-green-400/60',
  },
} as const

function Section({
  label,
  count,
  accent,
  defaultCollapsed = false,
  children,
}: {
  label: string
  count: number
  accent: keyof typeof ACCENT_MAP
  defaultCollapsed?: boolean
  children: React.ReactNode
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)
  const c = ACCENT_MAP[accent]

  return (
    <div>
      <button
        className="flex items-center gap-2 mb-2.5 px-1 w-full group"
        onClick={() => setCollapsed(!collapsed)}
      >
        <span className={`w-1.5 h-1.5 rounded-full ${c.dot} ${c.dotShadow}`} />
        <span className={`mono text-[9px] ${c.text} font-bold`}>{label}</span>
        <span className="mono text-[8px] text-white/12">{count}</span>
        <span className="mono text-[7px] text-white/8 ml-auto opacity-0 group-hover:opacity-100 transition-opacity">
          {collapsed ? '展开' : '收起'}
        </span>
      </button>
      {!collapsed && <div className="space-y-1.5">{children}</div>}
    </div>
  )
}

// ═══════════════════════════════════════════════
// PathCard — single learning path
// ═══════════════════════════════════════════════

function PathCard({
  path,
  isSelected,
  onSelect,
  onDelete,
}: {
  path: LearningPath
  isSelected: boolean
  onSelect: () => void
  onDelete: (e: React.MouseEvent, pathId: string) => void
}) {
  const [pathVisible, setPathVisible] = useState(false)
  const isDone = path.progress >= 100
  const isActive = path.progress > 0 && !isDone
  const nextStep = path.steps.find(s => s.status === 'available' || s.status === 'learning')
  const stepCount = path.totalCount || path.steps.length

  const togglePath = (e: React.MouseEvent) => {
    e.stopPropagation()
    // Select this path first so galaxy canvas gets the right steps
    onSelect()
    // Wait a tick for the path steps to propagate, then toggle
    requestAnimationFrame(() => {
      const toggle = useGalaxyActions.getState().actions.toggleLearningPath
      if (typeof toggle === 'function') toggle()
      else console.warn('[PathCard] toggleLearningPath not registered')
    })
    setPathVisible(v => !v)
  }

  return (
    <div
      className={`group relative px-4 py-3.5 rounded-xl cursor-pointer transition-all border ${
        isSelected
          ? 'bg-purple-500/10 border-purple-500/30'
          : 'bg-white/[0.02] border-white/5 hover:bg-white/[0.05] hover:border-white/10'
      }`}
      onClick={onSelect}
    >
      {/* Top row: name + badges */}
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{
              backgroundColor: isDone
                ? '#22c55e'
                : isActive
                  ? '#a855f7'
                  : 'rgba(255,255,255,0.2)',
              boxShadow: isActive ? '0 0 6px rgba(168,85,247,0.5)' : 'none',
            }}
          />
          <span className="text-white/80 font-bold truncate" style={{ fontSize: 'var(--f9)' }}>
            {path.name}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span
            className={`mono text-[7px] font-bold px-1.5 py-0.5 rounded border ${
              path.source === 'ai'
                ? 'text-yellow-400/60 border-yellow-500/20'
                : 'text-cyan-400/60 border-cyan-500/20'
            }`}
          >
            {path.source === 'ai' ? 'AI' : '图谱'}
          </span>
          <span className="mono text-[7px] text-white/15">
            {path.difficulty === 'beginner' ? '基础' : path.difficulty === 'intermediate' ? '进阶' : '高级'}
          </span>
        </div>
      </div>

      {/* Description */}
      {path.description && (
        <div className="mono text-[8px] text-white/15 mb-2 line-clamp-1">
          {path.description}
        </div>
      )}

      {/* Progress bar */}
      <div className="flex items-center gap-2.5">
        <div className="flex-1 h-1 bg-black/40 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{
              width: `${path.progress}%`,
              background: isDone
                ? 'linear-gradient(90deg, #22c55e, #4ade80)'
                : 'linear-gradient(90deg, #a855f7, #c084fc)',
            }}
          />
        </div>
        <span className="mono text-[8px] text-white/25 font-bold">
          {path.doneCount}/{stepCount}
        </span>
      </div>

      {/* Next step hint */}
      {nextStep && !isDone && (
        <div className="mt-1.5 flex items-center gap-1.5">
          <span className="mono text-[7px] text-purple-400/35">下一步</span>
          <span className="mono text-[7px] text-purple-400/55 truncate">{nextStep.name}</span>
        </div>
      )}

      {/* Show path on galaxy toggle */}
      <div className="mt-2 flex items-center gap-2">
        <button
          className={`mono text-[10px] font-bold transition-all flex items-center gap-1.5 px-3 py-1.5 rounded-lg ${
            pathVisible
              ? 'text-red-300 bg-red-500/20 border border-red-500/40 shadow-[0_0_12px_rgba(239,68,68,0.3)]'
              : 'text-red-400/80 bg-red-500/10 border border-red-500/30 hover:bg-red-500/20 hover:border-red-500/50'
          }`}
          onClick={togglePath}
          title={pathVisible ? '在星系中隐藏学习路径' : '在星系中显示学习路径红线'}
        >
          <span className="text-xs">{pathVisible ? '🔴' : '🔗'}</span>
          {pathVisible ? '隐藏路径' : '在星系中显示'}
        </button>
      </div>

      {/* Delete button (hover) */}
      <button
        className="absolute top-2 right-2 w-5 h-5 rounded-md bg-red-500/10 border border-red-500/20 text-red-400/50 text-[8px] opacity-0 group-hover:opacity-100 transition-all hover:bg-red-500/20 flex items-center justify-center"
        onClick={e => onDelete(e, path.id)}
      >
        ✕
      </button>
    </div>
  )
}
