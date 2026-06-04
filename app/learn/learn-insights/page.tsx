'use client'

import { Suspense, useState } from 'react'
import EducationProfileView from '@/components/learning/education-profile-view'
import PathAdjustmentView from '@/components/learning/path-adjustment-view'
import PushResourceCard from '@/components/learning/push-resource-card'

// 加载骨架屏
function LoadingPanel() {
  return (
    <div className="glass-panel p-6 rounded-2xl">
      <div className="animate-pulse space-y-4">
        <div className="h-6 bg-white/10 rounded w-1/3"></div>
        <div className="h-64 bg-white/10 rounded"></div>
      </div>
    </div>
  )
}

export default function LearnInsightsPage() {
  const [activeTab, setActiveTab] = useState<'overview' | 'profile' | 'path' | 'resources'>('overview')

  return (
    <div className="min-h-screen p-6 space-y-6">
      {/* 页面头部 */}
      <div>
        <h1 className="text-4xl font-bold mb-2">学习洞察</h1>
        <p className="text-white/60">
          实时了解您的学习进度、能力评估和推荐资源
        </p>
      </div>

      {/* 标签页导航（移动端） */}
      <div className="md:hidden glass-panel p-2 rounded-2xl flex gap-2 overflow-x-auto">
        {[
          { id: 'overview', label: '概览', icon: '📊' },
          { id: 'profile', label: '画像', icon: '🎯' },
          { id: 'path', label: '路径', icon: '📚' },
          { id: 'resources', label: '资源', icon: '🎁' },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as typeof activeTab)}
            className={`flex-shrink-0 px-4 py-2 rounded-lg font-semibold transition whitespace-nowrap ${
              activeTab === tab.id
                ? 'bg-purple-500/50 text-white'
                : 'bg-white/5 text-white/70 hover:bg-white/10'
            }`}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* 内容区域 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 主内容区（桌面端显示所有，移动端根据选中标签显示） */}

        {/* 概览面板（桌面端显示，移动端在 overview 标签显示） */}
        {(activeTab === 'overview' || window.innerWidth >= 1024) && (
          <div className={`lg:col-span-3 ${activeTab !== 'overview' && activeTab !== 'profile' ? 'hidden md:block' : ''}`}>
            <OverviewPanel />
          </div>
        )}

        {/* 学习画像（桌面端占 1 列，移动端独占） */}
        {(activeTab === 'profile' || activeTab === 'overview' || window.innerWidth >= 1024) && (
          <div className={`${activeTab === 'profile' ? '' : activeTab === 'overview' ? '' : 'hidden lg:block'}`}>
            <h3 className="text-lg font-semibold mb-4 hidden lg:block">学习画像</h3>
            <Suspense fallback={<LoadingPanel />}>
              <EducationProfileView />
            </Suspense>
          </div>
        )}

        {/* 学习路径（桌面端占 1 列，移动端独占） */}
        {(activeTab === 'path' || activeTab === 'overview' || window.innerWidth >= 1024) && (
          <div className={`${activeTab === 'path' ? '' : activeTab === 'overview' ? '' : 'hidden lg:block'}`}>
            <h3 className="text-lg font-semibold mb-4 hidden lg:block">学习路径</h3>
            <Suspense fallback={<LoadingPanel />}>
              <PathAdjustmentView />
            </Suspense>
          </div>
        )}

        {/* 推送资源（桌面端占 1 列，移动端独占） */}
        {(activeTab === 'resources' || activeTab === 'overview' || window.innerWidth >= 1024) && (
          <div className={`${activeTab === 'resources' ? '' : activeTab === 'overview' ? '' : 'hidden lg:block'}`}>
            <h3 className="text-lg font-semibold mb-4 hidden lg:block">推荐资源</h3>
            <Suspense fallback={<LoadingPanel />}>
              <PushResourceCard />
            </Suspense>
          </div>
        )}
      </div>

      {/* 底部提示 */}
      <div className="glass-panel p-4 rounded-2xl text-center text-sm text-white/60">
        <p>💡 此页面每 5 分钟自动更新。您也可以手动刷新浏览器获取最新数据。</p>
      </div>
    </div>
  )
}

/**
 * 概览面板组件 - 显示核心指标
 */
function OverviewPanel() {
  return (
    <div className="space-y-6">
      <div className="glass-panel p-6 rounded-2xl">
        <h2 className="text-2xl font-bold mb-4">🎯 学习概览</h2>

        {/* 快速统计 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-gradient-to-br from-purple-500/20 to-purple-500/5 p-4 rounded-lg border border-purple-500/20">
            <p className="text-xs text-purple-300 uppercase mb-1">学习画像</p>
            <p className="text-2xl font-bold text-purple-300">6 维</p>
            <p className="text-xs text-white/40 mt-1">实时自动分析</p>
          </div>

          <div className="bg-gradient-to-br from-blue-500/20 to-blue-500/5 p-4 rounded-lg border border-blue-500/20">
            <p className="text-xs text-blue-300 uppercase mb-1">学习路径</p>
            <p className="text-2xl font-bold text-blue-300">动态</p>
            <p className="text-xs text-white/40 mt-1">智能调整</p>
          </div>

          <div className="bg-gradient-to-br from-green-500/20 to-green-500/5 p-4 rounded-lg border border-green-500/20">
            <p className="text-xs text-green-300 uppercase mb-1">推送资源</p>
            <p className="text-2xl font-bold text-green-300">个性化</p>
            <p className="text-xs text-white/40 mt-1">精准推荐</p>
          </div>

          <div className="bg-gradient-to-br from-pink-500/20 to-pink-500/5 p-4 rounded-lg border border-pink-500/20">
            <p className="text-xs text-pink-300 uppercase mb-1">反馈闭环</p>
            <p className="text-2xl font-bold text-pink-300">完整</p>
            <p className="text-xs text-white/40 mt-1">持续优化</p>
          </div>
        </div>

        {/* 功能说明 */}
        <div className="space-y-4">
          <div className="p-4 bg-white/5 rounded-lg border border-white/10">
            <h3 className="font-semibold mb-2 flex items-center gap-2">
              <span>🎯</span> 6维学习画像
            </h3>
            <p className="text-sm text-white/70">
              系统自动分析您的学习表现，从深度、广度、联接、表达、应用、节奏 6 个维度评估您的能力，提供全面的学习洞察。
            </p>
          </div>

          <div className="p-4 bg-white/5 rounded-lg border border-white/10">
            <h3 className="font-semibold mb-2 flex items-center gap-2">
              <span>📚</span> 动态学习路径
            </h3>
            <p className="text-sm text-white/70">
              根据您的评估成绩实时调整学习难度和内容。表现优异可自动跳级，表现欠佳可获得自动复习资源，确保学习体验最优。
            </p>
          </div>

          <div className="p-4 bg-white/5 rounded-lg border border-white/10">
            <h3 className="font-semibold mb-2 flex items-center gap-2">
              <span>🎁</span> 智能资源推送
            </h3>
            <p className="text-sm text-white/70">
              基于您的学习画像和薄弱点，系统智能推荐最适合您的学习资源。支持文档、代码、图解、视频等多种形式，满足不同学习需求。
            </p>
          </div>

          <div className="p-4 bg-white/5 rounded-lg border border-white/10">
            <h3 className="font-semibold mb-2 flex items-center gap-2">
              <span>⚡</span> 完整反馈闭环
            </h3>
            <p className="text-sm text-white/70">
              您的学习数据和反馈不断优化系统的推荐算法。更多的学习让系统更了解您，推荐也越来越精准。
            </p>
          </div>
        </div>
      </div>

      {/* 快速开始 */}
      <div className="glass-panel p-6 rounded-2xl bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-500/20">
        <h3 className="font-semibold mb-4">🚀 快速开始</h3>
        <ol className="space-y-3 text-sm text-white/80">
          <li className="flex items-start gap-3">
            <span className="flex-shrink-0 w-6 h-6 bg-purple-500/30 rounded-full flex items-center justify-center text-xs font-bold">1</span>
            <span>完成一个学习会话（Forge 或 Learn 模式）</span>
          </li>
          <li className="flex items-start gap-3">
            <span className="flex-shrink-0 w-6 h-6 bg-purple-500/30 rounded-full flex items-center justify-center text-xs font-bold">2</span>
            <span>完成会话中的评估（Feynman Test 或 MCQ）</span>
          </li>
          <li className="flex items-start gap-3">
            <span className="flex-shrink-0 w-6 h-6 bg-purple-500/30 rounded-full flex items-center justify-center text-xs font-bold">3</span>
            <span>系统自动更新您的 6维画像和学习路径</span>
          </li>
          <li className="flex items-start gap-3">
            <span className="flex-shrink-0 w-6 h-6 bg-purple-500/30 rounded-full flex items-center justify-center text-xs font-bold">4</span>
            <span>查看本页面了解您的能力评估和推荐资源</span>
          </li>
        </ol>
      </div>
    </div>
  )
}
