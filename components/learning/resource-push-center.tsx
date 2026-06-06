'use client'

import React, { useState } from 'react'
import { useMarkPushRead, usePushResources, useRecordPushFeedback } from '@/hooks/use-learning'

const PUSH_TRIGGER_ICONS: Record<string, string> = {
  assessment_failed: '❌',
  assessment_excellent: '🌟',
  path_progressed: '📍',
  learning_stalled: '⏸️',
  weekly_report: '📊',
  profile_updated: '📈',
  stage_completion: '✅',
  low_dimension: '⬆️',
  scheduled: '⏰',
}

const PUSH_TRIGGER_LABELS: Record<string, string> = {
  assessment_failed: '评估未通过，推送补充资源',
  assessment_excellent: '评估优秀，推送进阶资源',
  path_progressed: '路径推进新阶段',
  learning_stalled: '学习停滞，推送激励资源',
  weekly_report: '周期性学习报告',
  profile_updated: '画像维度更新',
  stage_completion: '阶段完成',
  low_dimension: '发现薄弱维度',
  scheduled: '定期推送',
}

interface PushableResource {
  resourceId?: string
  type: string
  title: string
  content?: string
}

interface PushRecord {
  id: string
  userId?: string
  resources?: string | PushableResource[]
  trigger?: string
  reason?: string
  sentAt?: number | string
  expiresAt?: number | string
  viewedAt?: number | string | null
  engagedCount?: number
  feedback?: string | { engagedResourceIds?: string[]; feedbackText?: string }
  parsedResources?: PushableResource[]
  parsedFeedback?: { engagedResourceIds?: string[]; feedbackText?: string }
}

export default function ResourcePushCenter() {
  const { data: pushRecords, loading, refetch } = usePushResources()
  const recordFeedback = useRecordPushFeedback()
  const markRead = useMarkPushRead()
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [feedbackOpen, setFeedbackOpen] = useState<string | null>(null)
  const [feedbackText, setFeedbackText] = useState('')

  // 解析 resources
  const parsePushRecords = (records: PushRecord[] | undefined) => {
    if (!records) return []
    return records.map((r) => ({
      ...r,
      parsedResources: typeof r.resources === 'string' ? JSON.parse(r.resources) : r.resources || [],
      parsedFeedback: typeof r.feedback === 'string' ? JSON.parse(r.feedback) : r.feedback || {},
    }))
  }

  const records = parsePushRecords(pushRecords?.records)
  const unreadCount = records.filter((r) => !r.viewedAt).length

  const handleSubmitFeedback = async (push: PushRecord) => {
    await recordFeedback.mutateAsync({
      pushId: push.id,
      engagedResourceIds: push.parsedResources?.map((res) => res.resourceId).filter(Boolean) as string[] | undefined,
      feedbackText,
    })
    setFeedbackOpen(null)
    setFeedbackText('')
    await refetch()
  }

  const handleMarkRead = async (pushId: string) => {
    await markRead.mutateAsync(pushId)
    await refetch()
  }

  if (loading) {
    return (
      <div className="glass-panel p-6 rounded-2xl animate-pulse">
        <div className="h-8 bg-white/10 rounded w-1/3 mb-4"></div>
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-12 bg-white/5 rounded"></div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* 标题和统计 */}
      <div className="glass-panel p-6 rounded-2xl">
        <div className="flex items-center justify-between">
          <div>
            <span className="mono opacity-40 uppercase block text-sm mb-2">Push_Resources</span>
            <h2 className="text-2xl font-bold">推荐资源</h2>
          </div>
          <div className="flex gap-6">
            <div className="text-right">
              <div className="text-3xl font-bold text-purple-400">{records.length}</div>
              <div className="mono text-white/40 text-sm">总推送</div>
            </div>
            {unreadCount > 0 && (
              <div className="text-right">
                <div className="text-3xl font-bold text-red-400 relative">
                  {unreadCount}
                  <span className="absolute top-0 right-0 w-2 h-2 bg-red-400 rounded-full -mt-1"></span>
                </div>
                <div className="mono text-white/40 text-sm">未读</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 推送列表 */}
      {records.length === 0 ? (
        <div className="glass-panel p-6 rounded-2xl text-center">
          <p className="mono text-white/40">暂无推送资源</p>
          <p className="mono text-white/20 text-sm mt-2">继续完成学习，系统会根据你的学习情况推荐相关资源</p>
        </div>
      ) : (
        <div className="space-y-3">
          {records.map((push: PushRecord, idx: number) => {
            const trigger = push.trigger || 'scheduled'
            const triggerIcon = PUSH_TRIGGER_ICONS[trigger] || '📌'
            const triggerLabel = PUSH_TRIGGER_LABELS[trigger] || '推荐资源'
            const isUnread = !push.viewedAt
            const isExpanded = expandedId === push.id
            const sentDate = new Date(push.sentAt || Date.now())
            const expiresDate = push.expiresAt ? new Date(push.expiresAt) : null

            return (
              <div
                key={push.id || idx}
                className={`glass-panel p-4 rounded-xl cursor-pointer transition-all ${
                  isUnread ? 'ring-1 ring-red-500/50 bg-red-500/5' : ''
                } ${isExpanded ? 'ring-1 ring-purple-500/50' : ''}`}
                onClick={() => setExpandedId(isExpanded ? null : push.id)}
              >
                {/* 推送头部 */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3 flex-1">
                    <span className="text-xl">{triggerIcon}</span>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-white">{triggerLabel}</span>
                        {isUnread && <span className="w-2 h-2 bg-red-400 rounded-full"></span>}
                      </div>
                      {push.reason && <p className="mono text-white/40 text-xs mt-1">{push.reason}</p>}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="mono text-white/40 text-xs">
                      {sentDate.toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </div>
                    {push.engagedCount && (
                      <div className="mono text-white/30 text-xs mt-1">
                        👁️ {push.engagedCount} 次查看
                      </div>
                    )}
                  </div>
                </div>

                {/* 展开的详细信息 */}
                {isExpanded && (
                  <div className="pt-3 border-t border-white/10 space-y-3 animate-fade-in-up">
                    {/* 推送资源列表 */}
                    {push.parsedResources && push.parsedResources.length > 0 && (
                      <div>
                        <p className="mono text-white/40 text-xs mb-2">📚 推荐资源:</p>
                        <div className="space-y-2">
                          {push.parsedResources.map((res: PushableResource, i: number) => (
                            <div key={i} className="p-2 bg-white/5 rounded flex items-start gap-2">
                              <span className="text-sm font-semibold text-purple-400">{res.type}</span>
                              <div className="flex-1">
                                <p className="text-white/70 text-sm">{res.title}</p>
                                {res.content && <p className="mono text-white/40 text-xs mt-1 line-clamp-2">{res.content}</p>}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* 过期时间 */}
                    {expiresDate && (
                      <p className="mono text-white/30 text-xs">
                        ⏰ 过期时间: {expiresDate.toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </p>
                    )}

                    {/* 反馈按钮 */}
                    <div className="flex gap-2">
                      {feedbackOpen === push.id ? (
                        <div className="w-full space-y-2">
                          <textarea
                            value={feedbackText}
                            onChange={(e) => setFeedbackText(e.target.value)}
                            placeholder="分享你的想法..."
                            className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded text-white/80 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500"
                            rows={3}
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                void handleSubmitFeedback(push)
                              }}
                              className="flex-1 px-3 py-2 bg-purple-500/30 hover:bg-purple-500/40 rounded text-purple-300 text-sm font-semibold transition"
                            >
                              提交反馈
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                setFeedbackOpen(null)
                              }}
                              className="flex-1 px-3 py-2 bg-white/10 hover:bg-white/20 rounded text-white/70 text-sm transition"
                            >
                              取消
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              setFeedbackOpen(push.id)
                            }}
                            className="flex-1 px-3 py-2 bg-purple-500/20 hover:bg-purple-500/30 rounded text-purple-300 text-sm font-semibold transition"
                          >
                            💬 反馈
                          </button>
                          {!push.viewedAt && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                void handleMarkRead(push.id)
                              }}
                              className="flex-1 px-3 py-2 bg-green-500/20 hover:bg-green-500/30 rounded text-green-300 text-sm font-semibold transition"
                            >
                              ✓ 已读
                            </button>
                          )}
                        </>
                      )}
                    </div>

                    {/* 现有反馈 */}
                    {push.parsedFeedback?.feedbackText && (
                      <div className="bg-white/5 p-3 rounded">
                        <p className="mono text-white/40 text-xs mb-1">你的反馈:</p>
                        <p className="text-white/60 text-sm">{push.parsedFeedback.feedbackText}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* 推送统计 */}
      {records.length > 0 && (
        <div className="glass-panel p-4 rounded-xl grid grid-cols-3 gap-4">
          <div className="text-center">
            <div className="text-2xl font-bold text-amber-400">
              {records.filter((r) => r.trigger === 'assessment_failed').length}
            </div>
            <p className="mono text-white/40 text-xs mt-1">补强推送</p>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-green-400">
              {records.filter((r) => r.trigger === 'assessment_excellent').length}
            </div>
            <p className="mono text-white/40 text-xs mt-1">进阶推送</p>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-blue-400">
              {Math.round(
                (records.filter((r) => r.viewedAt).length / Math.max(records.length, 1)) * 100
              )}%
            </div>
            <p className="mono text-white/40 text-xs mt-1">查看率</p>
          </div>
        </div>
      )}
    </div>
  )
}
