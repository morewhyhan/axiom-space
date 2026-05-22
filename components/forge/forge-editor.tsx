'use client'

import { useState } from 'react'

export default function ForgeEditor() {
  const [editorMode, setEditorMode] = useState<'live' | 'read'>('live')
  const [cardContent, setCardContent] = useState('')
  const [cardTitle, setCardTitle] = useState<string | null>(null)

  // When no card is selected, show placeholder
  const hasCard = !!cardTitle

  const wordCount = cardContent ? cardContent.trim().split(/\s+/).length : 0

  return (
    <aside className="side-slot visible forge-panel flex-1 flex-col pointer-events-auto" style={{ maxWidth: 'var(--panel-xl)', minWidth: 'var(--panel-lg)' }}>
      <div className="glass-panel rounded-2xl flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex justify-between items-center px-5 py-3 border-b border-white/10">
          <div className="flex items-center gap-4">
            <span className="mono opacity-40 uppercase" style={{ fontSize: 'var(--f9)' }}>Editing</span>
            <span className="text-white/70" style={{ fontSize: 'var(--t-label)' }}>{cardTitle || '未选择卡片'}</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex bg-white/5 rounded-lg p-0.5">
              <button className={`editor-mode-tab ${editorMode === 'live' ? 'active' : ''}`} onClick={() => setEditorMode('live')}>LIVE</button>
              <button className={`editor-mode-tab ${editorMode === 'read' ? 'active' : ''}`} onClick={() => setEditorMode('read')}>READ</button>
            </div>
          </div>
        </div>

        {!hasCard ? (
          /* Empty / select state */
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="serif text-2xl text-white/10 mb-4">Forge Editor</div>
              <p className="mono text-white/20" style={{ fontSize: 'var(--f10)' }}>
                从 Galaxy 中选择节点或开始 Agent 对话<br />
                以查看和编辑卡片
              </p>
            </div>
          </div>
        ) : (
          <>
            {/* Status bar */}
            <div className="px-5 py-2 border-b border-white/5 flex items-center gap-4">
              <div className="flex items-center gap-1.5"><span className="mono opacity-25 uppercase" style={{ fontSize: 'var(--f7)' }}>Words</span><span className="mono text-white/60" style={{ fontSize: 'var(--f9)' }}>{wordCount}</span></div>
              <div className="w-px h-3 bg-white/5"></div>
              <div className="flex items-center gap-1.5"><span className="mono opacity-25 uppercase" style={{ fontSize: 'var(--f7)' }}>Polish</span><span className="mono text-pink-400/70" style={{ fontSize: 'var(--f8)' }}>fleeting</span></div>
            </div>
            {/* Editor content */}
            {editorMode === 'live' ? (
              <div className="flex-1 p-0 overflow-hidden">
                <textarea className="forge-editor" value={cardContent} onChange={e => setCardContent(e.target.value)} placeholder="在此编辑 Markdown 内容..." />
              </div>
            ) : (
              <div className="flex-1 p-8 overflow-y-auto no-scrollbar">
                <div className="max-w-2xl mx-auto">
                  <div className="mono text-purple-400 uppercase mb-2" style={{ fontSize: 'var(--f8)' }}>Markdown Preview</div>
                  <pre className="text-white/50 whitespace-pre-wrap" style={{ fontSize: 'var(--f10)' }}>{cardContent || '（空内容）'}</pre>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  )
}
