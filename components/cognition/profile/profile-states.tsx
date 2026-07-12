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
        <p>还没有可验证的学习画像。</p>
        <p>完成初始画像对话，或在真实学习中留下可追溯的回答、测评和反馈后，这里才会显示结论。</p>
      </div>
    </aside>
  )
}
