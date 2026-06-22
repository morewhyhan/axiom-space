'use client'

import { useMemo, useState, type CSSProperties } from 'react'
import { useCognition, useSubmitProfileFeedback } from '@/hooks/use-cognition'
import PromptModal from './observations-panel'
import {
  ProfileEmptyState,
  ProfileLoadingState,
  ProfileNodeCard,
  ProfilePillDock,
  buildDimensions,
  buildProfileTree,
  buildProfileTransitionSummary,
  type ProfileNode,
} from './profile'

export default function LearningProfile() {
  const { data, loading } = useCognition()
  const submitFeedback = useSubmitProfileFeedback()
  const dimensions = useMemo(() => buildDimensions(data), [data])
  const profileTree = useMemo(() => buildProfileTree(data, dimensions), [data, dimensions])
  const transitionSummary = useMemo(() => buildProfileTransitionSummary(data, dimensions), [data, dimensions])

  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')

  const activeKey = selectedKey ?? profileTree[0]?.key ?? null
  const activeDimension = activeKey
    ? profileTree.find((dimension) => dimension.key === activeKey) ?? null
    : null

  const activeNodeCount = activeDimension?.nodes.length ?? 0
  const visibleNodes = activeDimension?.nodes ?? []
  const profileColumns = activeNodeCount <= 3 ? Math.max(1, activeNodeCount)
    : activeNodeCount <= 6 ? 2
      : 3
  const profileRows = activeNodeCount <= 3 ? 1
    : activeNodeCount <= 6 ? Math.ceil(activeNodeCount / 2)
      : Math.min(3, Math.ceil(activeNodeCount / 3))
  const profileLayoutClass = activeNodeCount <= 3
    ? 'profile-layout-compact'
    : activeNodeCount <= 6
      ? 'profile-layout-medium'
      : activeNodeCount > 9
        ? 'profile-layout-scroll'
        : 'profile-layout-dense'

  if (loading && profileTree.length === 0) {
    return <ProfileLoadingState />
  }

  if (profileTree.length === 0) {
    return <ProfileEmptyState />
  }

  const startEdit = (node: ProfileNode) => {
    setEditingNodeId(node.id)
    setEditText(node.claim)
  }

  return (
    <aside className="cognition-workbench pointer-events-auto">
      {transitionSummary && (
        <section className="profile-transition-summary" aria-label="画像前后变化">
          <div className="profile-transition-head">
            <span className="mono uppercase text-cyan-100/70">画像前后变化</span>
            <span className="mono text-white/28">证据 {transitionSummary.evidenceCount} 条</span>
          </div>
          <div className="profile-transition-grid">
            <div className="profile-transition-cell">
              <div className="mono profile-transition-label">
                原始状态
              </div>
              <p>
                {transitionSummary.before}
              </p>
            </div>
            <div className="profile-transition-cell">
              <div className="mono profile-transition-label">
                当前状态
              </div>
              <p>
                {transitionSummary.current}
              </p>
            </div>
            <div className="profile-transition-cell">
              <div className="mono profile-transition-label">
                下一步
              </div>
              <p>
                {transitionSummary.next}
              </p>
            </div>
          </div>
        </section>
      )}

      <div className="profile-top-row">
        <div className="profile-top-copy">
          {activeDimension && (
            <p className="profile-interpretation-inline">
              {activeDimension.interpretation}
            </p>
          )}
        </div>

        <ProfilePillDock
          dimensions={profileTree}
          activeKey={activeKey}
          onSelect={setSelectedKey}
        />

        <div className="profile-prompt-action">
          <PromptModal />
        </div>
      </div>

      {activeDimension && (
        <div className="profile-page-shell">
          <div
            className={`profile-nodes-grid ${profileLayoutClass}`}
            style={{
              '--profile-columns': profileColumns,
              '--profile-rows': profileRows,
            } as CSSProperties}
          >
            {visibleNodes.map((node) => (
              <ProfileNodeCard
                key={node.id}
                node={node}
                editing={editingNodeId === node.id}
                editText={editText}
                submitting={submitFeedback.isPending}
                onEditTextChange={setEditText}
                onStartEdit={startEdit}
                onCancelEdit={() => setEditingNodeId(null)}
                onSubmitFeedback={(feedback) => submitFeedback.mutate(feedback)}
              />
            ))}
          </div>
        </div>
      )}
    </aside>
  )
}
