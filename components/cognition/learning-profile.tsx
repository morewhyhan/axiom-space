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
  type ProfileNode,
} from './profile'

export default function LearningProfile() {
  const { data, loading } = useCognition()
  const submitFeedback = useSubmitProfileFeedback()
  const dimensions = useMemo(() => buildDimensions(data), [data])
  const profileTree = useMemo(() => buildProfileTree(data, dimensions), [data, dimensions])

  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')

  const activeKey = selectedKey ?? profileTree[0]?.key ?? null
  const activeDimension = activeKey
    ? profileTree.find((dimension) => dimension.key === activeKey) ?? null
    : null

  const activeNodeCount = activeDimension?.nodes.length ?? 0
  const profileColumns = activeNodeCount <= 3 ? 1 : activeNodeCount <= 6 ? 2 : 3
  const profileRows = activeNodeCount <= 3
    ? Math.max(1, activeNodeCount)
    : activeNodeCount <= 6
      ? Math.ceil(activeNodeCount / 2)
      : 3
  const profileLayoutClass = activeNodeCount <= 3
    ? 'profile-layout-sparse'
    : activeNodeCount <= 6
      ? 'profile-layout-medium'
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
        <div
          className={`profile-nodes-grid ${profileLayoutClass}`}
          style={{
            '--profile-columns': profileColumns,
            '--profile-rows': profileRows,
          } as CSSProperties}
        >
          {activeDimension.nodes.map((node) => (
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
      )}
    </aside>
  )
}
