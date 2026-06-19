'use client'

export function ProfileLoadingState() {
  return (
    <aside className="cognition-workbench pointer-events-auto">
      <div className="profile-loading">
        <p>正在加载画像...</p>
      </div>
    </aside>
  )
}

export function ProfileEmptyState() {
  return (
    <aside className="cognition-workbench pointer-events-auto">
      <div className="profile-empty">
        <p>当前没有可展示的画像。</p>
        <p>完成一次 AI 工作台对话或创建学习路径后，这里会生成画像结构。</p>
      </div>
    </aside>
  )
}
