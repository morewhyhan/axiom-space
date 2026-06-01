'use client'

import React, { useState } from 'react'
import ProfileComparison from './profile-comparison'
import PathAdjustmentPanel from './path-adjustment-panel'
import ResourcePushCenter from './resource-push-center'

type TabType = 'profile' | 'path' | 'push'

export default function LearningDashboard({ pathId }: { pathId?: string } = {}) {
  const [activeTab, setActiveTab] = useState<TabType>('profile')

  const tabs: Array<{ id: TabType; label: string; icon: string }> = [
    { id: 'profile', label: '学习画像', icon: '📊' },
    { id: 'path', label: '路径调整', icon: '🗺️' },
    { id: 'push', label: '推荐资源', icon: '🎁' },
  ]

  return (
    <div className="w-full space-y-6">
      {/* 选项卡导航 */}
      <div className="glass-panel p-2 rounded-2xl flex gap-2 sticky top-0 z-10">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 px-4 py-3 rounded-xl font-semibold transition-all ${
              activeTab === tab.id
                ? 'bg-purple-500/30 text-purple-200 ring-1 ring-purple-500/50'
                : 'text-white/50 hover:text-white/70 hover:bg-white/5'
            }`}
          >
            <span className="mr-2">{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* 选项卡内容 */}
      <div className="animate-fade-in-up">
        {activeTab === 'profile' && <ProfileComparison />}
        {activeTab === 'path' && <PathAdjustmentPanel pathId={pathId} />}
        {activeTab === 'push' && <ResourcePushCenter />}
      </div>
    </div>
  )
}
