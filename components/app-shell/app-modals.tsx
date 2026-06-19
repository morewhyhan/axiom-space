'use client'

import { AxiomInput, AxiomTextarea, Button, FieldLabel, ListItemShell, MetricTile, Modal } from '@/components/ui'

type SearchResult = {
  path: string
  title: string
  snippet: string
}

type CardTypeOption<T extends string> = {
  id: T
  label: string
}

type OracleColor = {
  bg: string
  text: string
  border: string
}

type LearningProfileSummary = {
  masteryRate: number
  permanentCount: number
  domains: Array<{ id: string; name: string; color?: string | null; cardCount: number }>
}

type AppModalsProps<TCardType extends string> = {
  modal: string | null
  searchQuery: string
  searching: boolean
  searchResults: SearchResult[]
  newCardTitle: string
  newCardContent: string
  newCardType: TCardType
  cardTypeOptions: Array<CardTypeOption<TCardType>>
  creating: boolean
  oracleColors: Record<string, OracleColor>
  userName?: string | null
  nodeCount: number
  edgeCount: number
  orphanCount: number
  fleetingCount: number
  learningProfile: LearningProfileSummary | null | undefined
  onClose: () => void
  onSearch: (query: string) => void
  onOpenSearchResult: (result: SearchResult) => void
  onNewCardTitleChange: (value: string) => void
  onNewCardContentChange: (value: string) => void
  onNewCardTypeChange: (type: TCardType) => void
  onCreateCard: (typeOverride?: string) => void | Promise<void>
  onSetOracle: (oracle: string) => void
  onStartInitialProfile: () => void | Promise<void>
  onCompleteOnboarding: () => void
}

export function AppModals<TCardType extends string>({
  modal,
  searchQuery,
  searching,
  searchResults,
  newCardTitle,
  newCardContent,
  newCardType,
  cardTypeOptions,
  creating,
  oracleColors,
  userName,
  nodeCount,
  edgeCount,
  orphanCount,
  fleetingCount,
  learningProfile,
  onClose,
  onSearch,
  onOpenSearchResult,
  onNewCardTitleChange,
  onNewCardContentChange,
  onNewCardTypeChange,
  onCreateCard,
  onSetOracle,
  onStartInitialProfile,
  onCompleteOnboarding,
}: AppModalsProps<TCardType>) {
  if (!modal) return null

  return (
    <div className="modal-overlay" onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
      {modal === 'search' && (
        <Modal title="Search_Nodes" onClose={onClose}>
          <div className="p-5">
            <AxiomInput
              type="text"
              placeholder="输入关键词搜索全部节点..."
              value={searchQuery}
              onChange={(event) => onSearch(event.target.value)}
              autoFocus
            />
            <div className="mt-3">
              {searching ? (
                <div className="mono opacity-25 text-center" style={{ fontSize: 'var(--f8)' }}>搜索中...</div>
              ) : searchResults.length > 0 ? (
                <div className="space-y-2 max-h-60 overflow-y-auto no-scrollbar">
                  {searchResults.map((result, index) => (
                    <ListItemShell
                      interactive
                      key={index}
                      className="w-full p-3 bg-white/5 rounded-lg border border-white/5 cursor-pointer hover:bg-white/8 transition-colors text-left"
                      onClick={() => onOpenSearchResult(result)}
                    >
                      <div className="text-white/70 font-medium" style={{ fontSize: 'var(--f10)' }}>{result.title}</div>
                      <div className="mono opacity-25 mt-0.5 truncate" style={{ fontSize: 'var(--f7)' }}>{result.snippet.slice(0, 80)}...</div>
                    </ListItemShell>
                  ))}
                </div>
              ) : searchQuery ? (
                <div className="mono opacity-25 text-center" style={{ fontSize: 'var(--f8)' }}>未找到匹配节点</div>
              ) : (
                <div className="mono opacity-25 text-center" style={{ fontSize: 'var(--f8)' }}>输入关键词开始搜索...</div>
              )}
            </div>
          </div>
        </Modal>
      )}

      {modal === 'newcard' && (
        <Modal title="New_Card" onClose={onClose}>
          <div className="p-5 space-y-4">
            <div>
              <FieldLabel>Title</FieldLabel>
              <AxiomInput
                type="text"
                placeholder="卡片标题..."
                value={newCardTitle}
                onChange={(event) => onNewCardTitleChange(event.target.value)}
                autoFocus
              />
            </div>
            <div>
              <FieldLabel>Type</FieldLabel>
              <div className="flex flex-wrap gap-1.5">
                {cardTypeOptions.map((type) => (
                  <Button
                    key={type.id}
                    className={`mono rounded-lg border px-2.5 py-1.5 transition-colors ${
                      newCardType === type.id
                        ? 'border-cyan-500/25 bg-cyan-500/10 text-cyan-200/80'
                        : 'border-white/8 bg-white/[0.025] text-white/38 hover:text-white/68'
                    }`}
                    style={{ fontSize: 'var(--f9)' }}
                    onClick={() => onNewCardTypeChange(type.id)}
                  >
                    {type.label}
                  </Button>
                ))}
              </div>
            </div>
            <div>
              <FieldLabel>Content</FieldLabel>
              <AxiomTextarea
                rows={5}
                placeholder="在此输入内容 (Markdown)..."
                value={newCardContent}
                onChange={(event) => onNewCardContentChange(event.target.value)}
              />
            </div>
            <Button
              variant="axiom-primary"
              className="w-full text-center"
              disabled={!newCardTitle.trim() || creating}
              onClick={() => { void onCreateCard() }}
            >
              {creating ? '创建中...' : '创建卡片'}
            </Button>
          </div>
        </Modal>
      )}

      {modal === 'importtext' && (
        <Modal title="Import_Text" titleClassName="text-cyan-400" onClose={onClose}>
          <div className="p-5 space-y-4">
            <div>
              <FieldLabel>TITLE</FieldLabel>
              <AxiomInput
                type="text"
                placeholder="文献/材料标题..."
                value={newCardTitle}
                onChange={(event) => onNewCardTitleChange(event.target.value)}
              />
            </div>
            <div>
              <FieldLabel>CONTENT</FieldLabel>
              <AxiomTextarea
                rows={8}
                placeholder="粘贴文献内容、学习笔记、或任何文本..."
                value={newCardContent}
                onChange={(event) => onNewCardContentChange(event.target.value)}
              />
            </div>
            <Button
              variant="axiom-primary"
              className="w-full text-center"
              disabled={!newCardTitle.trim() || creating}
              onClick={() => { void onCreateCard('literature') }}
            >
              {creating ? '导入中...' : '导入为文献资料'}
            </Button>
          </div>
        </Modal>
      )}

      {modal === 'oracle' && (
        <Modal title="Switch_Oracle" onClose={onClose}>
          <div className="p-5 grid grid-cols-2 gap-3">
            {[
              { id: 'default', letter: 'A', name: 'AXIOM', desc: '通用学习助手 · 苏格拉底式提问引导', color: 'purple' },
              { id: 'socrates', letter: 'S', name: '苏格拉底', desc: '哲学导师 · 问答法 · 从不直接给答案', color: 'purple' },
              { id: 'musk', letter: 'M', name: '马斯克', desc: '第一性原理 · 质疑假设 · 物理思维', color: 'pink' },
              { id: 'munger', letter: 'C', name: '芒格', desc: '多元思维模型 · 逆向思维 · 跨学科', color: 'cyan' },
              { id: 'wittgenstein', letter: 'W', name: '维特根斯坦', desc: '语言分析 · 澄清概念 · 追问意义', color: 'purple' },
            ].map((agent, index) => {
              const color = oracleColors[agent.color] ?? oracleColors.purple
              return (
                <ListItemShell
                  key={agent.id}
                  interactive
                  className={`p-4 bg-white/5 rounded-xl border cursor-pointer hover:bg-white/8 transition-colors text-left ${index === 0 ? 'border-purple-500/20' : 'border-white/5'}`}
                  onClick={() => { onSetOracle(agent.id); onClose() }}
                >
                  <div className={`oracle-avatar ${color.bg} ${color.text} ${color.border} mb-2`}>{agent.letter}</div>
                  <div className="text-white/70 font-medium" style={{ fontSize: 'var(--t-label)' }}>{agent.name}</div>
                  <div className="mono opacity-35 mt-1" style={{ fontSize: 'var(--f8)' }}>{agent.desc}</div>
                </ListItemShell>
              )
            })}
          </div>
        </Modal>
      )}

      {modal === 'profile' && (
        <Modal title="User_Profile" onClose={onClose}>
          <div className="p-6">
            <div className="flex items-center gap-5 mb-6">
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-purple-500/40 to-cyan-500/40 border border-white/10 flex items-center justify-center">
                <span className="serif text-2xl">{(userName ?? 'A').charAt(0).toUpperCase()}</span>
              </div>
              <div>
                <div className="text-lg font-medium">{userName ?? '学习者'}</div>
                <div className="mono opacity-35 mt-1" style={{ fontSize: 'var(--f9)' }}>Nodes: {nodeCount} · Links: {edgeCount}</div>
              </div>
            </div>
            <div className="grid grid-cols-4 gap-3 mb-5">
              <MetricTile value={nodeCount} label="TOTAL" valueClassName="text-purple-400" />
              <MetricTile value={edgeCount} label="LINKS" valueClassName="text-cyan-400" />
              <MetricTile value={orphanCount} label="ORPHANS" valueClassName="text-pink-400" />
              <MetricTile value={fleetingCount} label="灵感草稿" valueClassName="text-white/60" />
            </div>
            {learningProfile && (
              <div className="mb-5 space-y-3">
                <div className="hud-line"></div>
                <span className="mono opacity-40 uppercase tracking-widest block" style={{ fontSize: 'var(--f8)' }}>Ability_Profile</span>
                <div className="grid grid-cols-3 gap-3">
                  <MetricTile value={`${learningProfile.masteryRate}%`} label="掌握率" valueClassName="text-lg text-green-400" />
                  <MetricTile value={learningProfile.permanentCount} label="永久知识" valueClassName="text-lg text-cyan-400" />
                  <MetricTile value={learningProfile.domains.length} label="领域" valueClassName="text-lg text-purple-400" />
                </div>
                {learningProfile.domains.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {learningProfile.domains.map((domain) => (
                      <span key={domain.id} className="px-2 py-0.5 rounded mono text-[10px] border border-white/10" style={{ color: domain.color || '#a855f7' }}>
                        {domain.name} ({domain.cardCount})
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
            <Button variant="axiom-secondary" className="w-full text-center" onClick={onClose} style={{ fontSize: 'var(--f8)' }}>CLOSE</Button>
          </div>
        </Modal>
      )}

      {modal === 'shortcuts' && (
        <Modal title="Shortcuts" onClose={onClose}>
          <div className="p-5 space-y-2">
            {[
              ['⌘K', '搜索节点'], ['⌘N', '新建节点'], ['⌘1/2/3/4/5', '切换页面（仪表板/AI工作台/知识图谱/认知洞察/路径规划）'], ['/', '命令面板'], ['Esc', '关闭面板'], ['Ctrl+S', '保存卡片（编辑器中）'], ['Ctrl+Z', '撤销编辑（编辑器中）'],
            ].map(([key, desc]) => (
              <div key={key as string} className="flex justify-between items-center py-2 border-b border-white/5">
                <span className="mono text-white/50" style={{ fontSize: 'var(--f9)' }}>{key as string}</span>
                <span className="text-white/35" style={{ fontSize: 'var(--f10)' }}>{desc as string}</span>
              </div>
            ))}
          </div>
        </Modal>
      )}

      {modal === 'onboarding' && (
        <Modal title="Welcome_to_AXIOM" onClose={() => { onClose(); onCompleteOnboarding() }} style={{ maxWidth: '520px' }}>
          <div className="p-6 space-y-5">
            <div>
              <h2 className="serif text-xl text-white/80 mb-2">欢迎来到 AXIOM 认知操作系统</h2>
              <p className="text-white/40 leading-relaxed" style={{ fontSize: 'var(--f10)' }}>
                AXIOM 将你的知识可视化为知识图谱，让 AI 帮助你整理、连接、深化认知。
              </p>
            </div>
            <div className="hud-line"></div>
            <div>
              <span className="mono opacity-30 uppercase tracking-wider block mb-3" style={{ fontSize: 'var(--f8)' }}>5 个页面</span>
              <div className="space-y-2.5">
                {[
                  { key: '1', name: '仪表板', sub: 'Dashboard', desc: '查看知识统计、最近活动和系统状态概览', color: 'text-white/60', dot: 'bg-white/40' },
                  { key: '2', name: 'AI 工作台', sub: 'Workspace', desc: '围绕理解卡对话、补例子和打磨理解', color: 'text-pink-400', dot: 'bg-pink-400' },
                  { key: '3', name: '知识图谱', sub: 'Graph', desc: '可视化浏览和整理你的知识网络，发现隐藏关联', color: 'text-cyan-400', dot: 'bg-cyan-400' },
                  { key: '4', name: '认知洞察', sub: 'Insights', desc: '查看能力画像、观察记录和下一步建议', color: 'text-purple-400', dot: 'bg-purple-400' },
                  { key: '5', name: '路径规划', sub: 'Path', desc: '从主题或资料生成学习路径 — 推荐从这里开始', color: 'text-amber-400', dot: 'bg-amber-400', recommend: true },
                ].map((item) => (
                  <div key={item.key} className={`flex items-start gap-3 p-3 rounded-lg ${item.recommend ? 'bg-pink-500/5 border border-pink-500/15' : 'bg-white/[0.02] border border-white/5'}`}>
                    <span className={`w-5 h-5 rounded-full ${item.dot} flex items-center justify-center shrink-0 mt-0.5`}>
                      <span className="mono text-[9px] text-black/60 font-bold">{item.key}</span>
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`font-medium ${item.color}`} style={{ fontSize: 'var(--f10)' }}>{item.name}</span>
                        <span className="mono opacity-25 uppercase" style={{ fontSize: 'var(--f7)' }}>{item.sub}</span>
                        {item.recommend && <span className="mono text-[8px] px-1.5 py-0.5 rounded bg-pink-500/15 text-pink-400 border border-pink-500/20">推荐</span>}
                      </div>
                      <p className="text-white/35 mt-0.5" style={{ fontSize: 'var(--f9)' }}>{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="hud-line"></div>
            <div>
              <span className="mono opacity-30 uppercase tracking-wider block mb-2" style={{ fontSize: 'var(--f8)' }}>快捷键</span>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                {[['⌘K', '搜索'], ['⌘N', '新建卡片'], ['⌘1-5', '切换页面'], ['/', '命令面板']].map(([key, desc]) => (
                  <div key={key as string} className="flex gap-2">
                    <span className="mono text-white/50 shrink-0" style={{ fontSize: 'var(--f9)' }}>{key as string}</span>
                    <span className="text-white/30" style={{ fontSize: 'var(--f9)' }}>{desc as string}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Button
                variant="axiom-primary"
                className="w-full text-center"
                onClick={() => { void onStartInitialProfile() }}
              >
                让 AI 先了解我
              </Button>
              <Button
                variant="axiom"
                className="w-full text-center"
                onClick={() => { onClose(); onCompleteOnboarding() }}
              >
                直接开始使用
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
