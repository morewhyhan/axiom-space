'use client'

/**
 * Chat Session Sidebar
 *
 * 左侧会话列表 — 展示所有历史 AI 对话会话。
 * 真实数据来自 API，支持切换 / 新建 / 删除。
 */

import { useEffect } from 'react'
import { useAgent } from '@/hooks/use-agent'
import type { SessionSummary } from '@/hooks/use-agent'

export default function ChatSessionList() {
  const {
    sessions, sessionId,
    switchSession, createSession, deleteSession, loadSessions,
  } = useAgent()

  useEffect(() => { loadSessions() }, [loadSessions])

  const activeSession = sessions.find((s: SessionSummary) => s.id === sessionId)

  return (
    <aside className="side-slot visible flex-col pointer-events-auto" style={{ width: 'var(--panel-xs)', flex: 1, padding: 'var(--panel-py) 0' }}>
      <div className="glass-panel rounded-2xl flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 flex-shrink-0">
          <span className="mono text-white/40 uppercase tracking-wider" style={{ fontSize: 'var(--f9)' }}>
            会话历史
          </span>
          <button
            className="mono text-purple-400/70 hover:text-purple-400 transition-colors"
            style={{ fontSize: 'var(--f8)' }}
            onClick={createSession}
          >+ 新建</button>
        </div>

        {/* Session list */}
        <div className="flex-1 overflow-y-auto no-scrollbar p-2 space-y-1">
          {sessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center px-6">
              <div className="mono text-white/10 text-[10px] leading-relaxed">
                暂无历史会话<br/>
                在 Forge 中开始对话
              </div>
            </div>
          ) : (
            sessions.map((s: SessionSummary) => {
              const isActive = s.id === sessionId
              const time = formatRelativeTime(s.updatedAt)
              return (
                <div
                  key={s.id}
                  className={`group relative p-3 rounded-xl cursor-pointer transition-all ${
                    isActive
                      ? 'bg-purple-500/10 border border-purple-500/20 shadow-[0_0_12px_rgba(168,85,247,0.08)]'
                      : 'hover:bg-white/5 border border-transparent'
                  }`}
                  onClick={() => switchSession(s.id)}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span
                      className={`font-medium truncate ${isActive ? 'text-white' : 'text-white/60 group-hover:text-white/80'}`}
                      style={{ fontSize: 'var(--f9)' }}
                    >
                      {s.title}
                    </span>
                    <span className="mono text-white/15 flex-shrink-0 ml-2" style={{ fontSize: 'var(--f7)' }}>
                      {time}
                    </span>
                  </div>
                  {s.preview && (
                    <div className="mono text-white/25 truncate leading-relaxed" style={{ fontSize: 'var(--f8)' }}>
                      {s.preview}
                    </div>
                  )}

                  {/* Delete button */}
                  <button
                    className="absolute top-1 right-1 w-5 h-5 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 hover:bg-red-500/20 text-white/15 hover:text-red-400 transition-all"
                    onClick={(e) => { e.stopPropagation(); deleteSession(s.id) }}
                  >
                    <span className="mono text-[10px]">×</span>
                  </button>
                </div>
              )
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2.5 border-t border-white/5 flex items-center justify-between">
          <span className="mono text-white/15" style={{ fontSize: 'var(--f6)' }}>
            {sessions.length} 个会话
          </span>
          {activeSession && (
            <span className="mono text-purple-400/40" style={{ fontSize: 'var(--f6)' }}>
              ID: {activeSession.id.slice(0, 6)}
            </span>
          )}
        </div>
      </div>
    </aside>
  )
}

/** Format a date string into relative time in Chinese */
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
  return dateStr.slice(0, 10)
}
