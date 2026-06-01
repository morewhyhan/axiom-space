// ── Minimal SVG icons (16×16, 1.5px stroke, round caps/joins) ───────────

const IconChatBubble = () => <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2 2h12v10H5l-3 4V2z"/></svg>
const IconFile = () => <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 2h6l4 4v8H3z"/><path d="M9 2v4h4"/></svg>
const IconHistory = () => <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="8" r="6"/><path d="M8 4v4l3 2"/></svg>
const IconEdit = () => <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11 1l3 3-9 9H2v-3z"/></svg>

import { useAppStore, type PanelId } from '@/stores/mode-store'

export default function PanelBar() {
  const mode = useAppStore((s) => s.mode)
  const panelLayout = useAppStore((s) => s.panelLayout)
  const togglePanel = useAppStore((s) => s.togglePanel)
  const movePanel = useAppStore((s) => s.movePanel)
  const chatPanelOpen = useAppStore((s) => s.chatPanelOpen)
  const setChatPanelOpen = useAppStore((s) => s.setChatPanelOpen)

  const isVisible = (id: PanelId) => panelLayout.left.includes(id) || panelLayout.right.includes(id)
  const visiblePanels = ['fileTree', 'sessionList', 'editor'].filter(p => isVisible(p as PanelId))

  // ── Forge view ──
  if (mode === 'forge') {
    return (
      <div className="flex items-center gap-1 px-3 py-1 border-t border-white/5 pointer-events-auto" style={{ height: 34 }}>
        {/* ── Chat indicator ── */}
        <button
          className={`flex items-center gap-1.5 px-2.5 h-7 rounded-md transition-all active:scale-95 ${
            chatPanelOpen
              ? 'text-cyan-400 bg-cyan-500/10 shadow-[0_0_8px_rgba(34,211,238,0.08)]'
              : 'text-white/25 hover:text-white/50 hover:bg-white/5'
          }`}
          onClick={() => setChatPanelOpen(!chatPanelOpen)}
          title={chatPanelOpen ? '隐藏对话' : '显示对话'}
        >
          <IconChatBubble />
          <span className="mono" style={{ fontSize: 10 }}>对话</span>
        </button>

        {/* ── File tree ── */}
        <button
          className={`flex items-center gap-1.5 px-2.5 h-7 rounded-md transition-all active:scale-95 ${
            isVisible('fileTree')
              ? 'text-purple-400 bg-purple-500/12 shadow-[0_0_8px_rgba(168,85,247,0.08)]'
              : 'text-white/30 hover:text-white/60 hover:bg-white/5'
          }`}
          onClick={() => togglePanel('fileTree')}
          title="文件树"
        >
          <IconFile />
          <span className="mono" style={{ fontSize: 10 }}>资料</span>
        </button>

        {/* ── Session history ── */}
        <button
          className={`flex items-center gap-1.5 px-2.5 h-7 rounded-md transition-all active:scale-95 ${
            isVisible('sessionList')
              ? 'text-purple-400 bg-purple-500/12 shadow-[0_0_8px_rgba(168,85,247,0.08)]'
              : 'text-white/30 hover:text-white/60 hover:bg-white/5'
          }`}
          onClick={() => togglePanel('sessionList')}
          title="会话历史"
        >
          <IconHistory />
          <span className="mono" style={{ fontSize: 10 }}>历史</span>
        </button>

        {/* ── Editor ── */}
        <button
          className={`flex items-center gap-1.5 px-2.5 h-7 rounded-md transition-all active:scale-95 ${
            isVisible('editor')
              ? 'text-pink-400 bg-pink-500/12 shadow-[0_0_8px_rgba(244,114,182,0.08)]'
              : 'text-white/30 hover:text-white/60 hover:bg-white/5'
          }`}
          onClick={() => togglePanel('editor')}
          title="编辑器"
        >
          <IconEdit />
          <span className="mono" style={{ fontSize: 10 }}>编辑</span>
        </button>

        {/* ── Status — what's open right now ── */}
        <div className="ml-auto flex items-center gap-1.5">
          <span className="mono text-white/15" style={{ fontSize: 8 }}>
            {visiblePanels.length === 0 ? '仅对话' : visiblePanels.map(p =>
              p === 'fileTree' ? '资料' : p === 'sessionList' ? '历史' : '编辑'
            ).join(' · ')}
          </span>
        </div>
      </div>
    )
  }

  // ── Cognition view ──
  return (
    <div className="flex items-center px-4 py-1 border-t border-white/5 pointer-events-auto" style={{ height: 34 }}>
      <div className="flex-1 text-center">
        <span className="mono text-white/15 tracking-widest" style={{ fontSize: 9 }}>COGNITION</span>
      </div>
    </div>
  )
}
