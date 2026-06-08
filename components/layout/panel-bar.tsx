'use client'

import { useCallback, useMemo, useState } from 'react'
import {
  Check,
  Files,
  LayoutDashboard,
  MessageSquareText,
  PanelLeft,
  PenLine,
  SlidersHorizontal,
} from 'lucide-react'
import { useAppStore, type PanelId } from '@/stores/mode-store'

const FORGE_ITEMS = [
  {
    id: 'sessionList' as const,
    label: '任务',
    description: '任务组和普通对话入口',
    icon: LayoutDashboard,
    tone: 'text-pink-300',
  },
  {
    id: 'chat' as const,
    label: 'AI 对话',
    description: '当前任务或会话的对话区',
    icon: MessageSquareText,
    tone: 'text-cyan-300',
  },
  {
    id: 'fileTree' as const,
    label: '卡片库',
    description: '按类型或星团浏览卡片',
    icon: Files,
    tone: 'text-purple-300',
  },
  {
    id: 'editor' as const,
    label: '卡片编辑',
    description: '查看和修改当前卡片',
    icon: PenLine,
    tone: 'text-pink-300',
  },
]

export default function PanelBar() {
  const mode = useAppStore((s) => s.mode)
  const panelLayout = useAppStore((s) => s.panelLayout)
  const togglePanel = useAppStore((s) => s.togglePanel)
  const chatPanelOpen = useAppStore((s) => s.chatPanelOpen)
  const setChatPanelOpen = useAppStore((s) => s.setChatPanelOpen)
  const [open, setOpen] = useState(false)

  const isVisible = useCallback(
    (id: PanelId) => panelLayout.left.includes(id) || panelLayout.right.includes(id),
    [panelLayout.left, panelLayout.right],
  )
  const visiblePanels = useMemo(
    () => (['sessionList', 'fileTree', 'editor'] as PanelId[]).filter(isVisible),
    [isVisible],
  )
  const openCount = visiblePanels.length + (chatPanelOpen ? 1 : 0)

  if (mode === 'forge') {
    return (
      <div className="fixed bottom-4 left-4 z-40 pointer-events-auto">
        {open && (
          <div className="mb-2 w-[236px] overflow-hidden rounded-xl border border-white/10 bg-black/72 shadow-[0_20px_70px_rgba(0,0,0,0.45)] backdrop-blur-xl">
            <div className="flex items-center justify-between border-b border-white/8 px-3 py-2">
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="h-3.5 w-3.5 text-white/45" />
                <span className="mono text-[9px] uppercase tracking-[0.16em] text-white/45">Workspace Panels</span>
              </div>
              <span className="mono text-[8px] text-white/22">{openCount}/4 open</span>
            </div>

            <div className="p-1.5">
              {FORGE_ITEMS.map((item) => {
                const Icon = item.icon
                const active = item.id === 'chat' ? chatPanelOpen : isVisible(item.id)
                return (
                  <button
                    key={item.id}
                    className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors ${
                      active ? 'bg-white/[0.055] text-white/82' : 'text-white/32 hover:bg-white/[0.035] hover:text-white/62'
                    }`}
                    onClick={() => {
                      if (item.id === 'chat') setChatPanelOpen(!chatPanelOpen)
                      else togglePanel(item.id)
                    }}
                  >
                    <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md border ${
                      active ? 'border-white/12 bg-white/[0.045]' : 'border-white/6 bg-black/20'
                    } ${active ? item.tone : 'text-white/22'}`}>
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[11px] leading-none">{item.label}</span>
                      <span className="mt-1 block truncate mono text-[8px] text-white/24">{item.description}</span>
                    </span>
                    {active && <Check className="h-3.5 w-3.5 shrink-0 text-white/48" />}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        <button
          className={`flex h-9 items-center gap-2 rounded-full border px-3 shadow-[0_12px_36px_rgba(0,0,0,0.35)] backdrop-blur-xl transition-all active:scale-95 ${
            open
              ? 'border-pink-400/28 bg-pink-400/12 text-pink-200'
              : 'border-white/10 bg-black/58 text-white/46 hover:border-white/16 hover:text-white/70'
          }`}
          onClick={() => setOpen((value) => !value)}
          title="AI 工作台面板"
        >
          <PanelLeft className="h-4 w-4" />
          <span className="mono text-[9px] uppercase tracking-[0.12em]">Workspace</span>
          <span className="mono rounded-full border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[8px] text-white/36">
            {openCount}
          </span>
        </button>
      </div>
    )
  }

  return (
    <div className="flex items-center px-4 py-1 border-t border-white/5 pointer-events-auto" style={{ height: 34 }}>
      <div className="flex-1 text-center">
        <span className="mono text-white/15 tracking-widest" style={{ fontSize: 9 }}>INSIGHTS</span>
      </div>
    </div>
  )
}
