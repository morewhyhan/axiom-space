'use client'

import { useCognition } from '@/hooks/use-cognition'

export default function ProfileBar() {
  const { data, loading } = useCognition()

  const userName = data?.user?.name ?? '学习者'
  const userInitial = userName.charAt(0).toUpperCase()
  const stats = data?.stats ?? { streakDays: 0, mastered: 0, pendingReview: 0, chatRounds: 0 }
  const totalCards = stats.totalCards ?? stats.mastered + stats.pendingReview
  const isEmpty = totalCards === 0

  return (
    <aside
      className="side-slot visible flex-col items-center pointer-events-auto no-scrollbar"
      style={{
        width: '72px',
        justifyContent: 'flex-start',
        gap: 'var(--gap-zone)',
        padding: 'var(--panel-py) 0',
        flexShrink: 0,
      }}
    >
      {/* Avatar */}
      <div className="glass-panel rounded-2xl flex flex-col items-center py-5 px-2 flex-shrink-0" style={{ width: '100%' }}>
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500/40 to-cyan-500/40 border border-white/10 flex items-center justify-center mb-2">
          <span className="serif text-sm">{loading ? '—' : userInitial}</span>
        </div>
        <span className="mono text-white/60 text-center truncate w-full" style={{ fontSize: 'var(--f8)' }}>
          {loading ? '加载中' : userName}
        </span>
        {!loading && (
          <div className="mt-1 mono text-white/20" style={{ fontSize: 'var(--f7)' }}>
            {isEmpty ? '无卡片' : `${totalCards} 张`}
          </div>
        )}
      </div>

      {/* Key stats */}
      <div className="glass-panel rounded-2xl flex flex-col items-center py-4 px-2 flex-shrink-0" style={{ width: '100%' }}>
        <div className="flex flex-col items-center gap-3">
          <div className="text-center">
            <div className="serif font-bold text-purple-400" style={{ fontSize: 'var(--t-sub)' }}>
              {loading ? '—' : stats.streakDays}
            </div>
            <div className="mono opacity-30" style={{ fontSize: 'var(--f7)' }}>连续</div>
          </div>
          <div className="text-center">
            <div className="serif font-bold text-cyan-400" style={{ fontSize: 'var(--t-sub)' }}>
              {loading ? '—' : stats.mastered}
            </div>
            <div className="mono opacity-30" style={{ fontSize: 'var(--f7)' }}>永久</div>
          </div>
          <div className="text-center">
            <div className="serif font-bold text-pink-400" style={{ fontSize: 'var(--t-sub)' }}>
              {loading ? '—' : stats.pendingReview}
            </div>
            <div className="mono opacity-30" style={{ fontSize: 'var(--f7)' }}>灵感草稿</div>
          </div>
        </div>
      </div>

      {/* Label at bottom */}
      <div className="mt-auto mono text-white/10 text-center" style={{ fontSize: 'var(--f7)' }}>
        <span style={{ writingMode: 'vertical-rl' }}>INSIGHTS</span>
      </div>
    </aside>
  )
}
