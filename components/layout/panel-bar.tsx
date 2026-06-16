'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
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
    label: '路径',
    description: '学习路径和自由对话入口',
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

  useEffect(() => {
    if (mode !== 'forge') return
    const state = useAppStore.getState()
    const desiredLayout = { left: [] as PanelId[], right: ['editor' as PanelId] }
    const leftSame = state.panelLayout.left.length === desiredLayout.left.length && state.panelLayout.left.every((panel, index) => panel === desiredLayout.left[index])
    const rightSame = state.panelLayout.right.length === desiredLayout.right.length && state.panelLayout.right.every((panel, index) => panel === desiredLayout.right[index])
    if (!leftSame || !rightSame) state.setPanelLayout(desiredLayout)
    if (state.chatPanelOpen) state.setChatPanelOpen(false)
    setOpen(true)
  }, [mode])

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
      <div className="forge-panel-switcher">
        <div className="forge-panel-rail" aria-label="AI 工作台面板">
          <button
            className={`forge-panel-rail-btn forge-panel-home ${open ? 'active' : ''}`}
            onClick={() => setOpen((value) => !value)}
            title="工作台面板"
          >
            <PanelLeft className="h-4 w-4" />
          </button>

          <div className="forge-panel-rail-separator" />

          {FORGE_ITEMS.map((item) => {
            const Icon = item.icon
            const active = item.id === 'chat' ? chatPanelOpen : isVisible(item.id)
            return (
              <button
                key={item.id}
                className={`forge-panel-rail-btn ${active ? 'active' : ''}`}
                onClick={() => {
                  if (item.id === 'chat') setChatPanelOpen(!chatPanelOpen)
                  else togglePanel(item.id)
                }}
                title={item.label}
              >
                <Icon className={`h-4 w-4 ${active ? item.tone : ''}`} />
              </button>
            )
          })}

          <div className="forge-panel-open-count">{openCount}</div>
        </div>

        {open && (
          <div className="forge-panel-drawer">
            <div className="flex items-center justify-between border-b border-white/8 px-3 py-2.5">
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="h-3.5 w-3.5 text-white/42" />
                <span className="mono text-[9px] uppercase tracking-[0.16em] text-white/44">Workspace</span>
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
