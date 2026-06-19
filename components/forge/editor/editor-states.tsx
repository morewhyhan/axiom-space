'use client'

export function EditorEmptyState() {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center">
        <div className="serif text-2xl text-white/10 mb-4">Card Preview</div>
        <p className="mono text-white/20" style={{ fontSize: 'var(--f10)' }}>
          从知识图谱中选择节点，或在 AI 工作台开始对话
          <br />
          以查看和编辑卡片
        </p>
      </div>
    </div>
  )
}

export function EditorLoadingState() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4">
      <div className="flex gap-1">
        <div className="w-2 h-2 bg-cyan-300/60 rounded-full animate-bounce" style={{ animationDelay: '0s' }} />
        <div className="w-2 h-2 bg-cyan-300/60 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
        <div className="w-2 h-2 bg-cyan-300/60 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }} />
      </div>
      <div className="mono text-white/40 text-center" style={{ fontSize: 'var(--f10)' }}>
        加载卡片内容...
      </div>
    </div>
  )
}
