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
  const latestIntervention = data?.interventionRuns?.[0]

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
      <div className="profile-top-row">
        <ProfilePillDock
          dimensions={profileTree}
          activeKey={activeKey}
          onSelect={setSelectedKey}
        />
        <PromptModal />
      </div>

      {latestIntervention && (
        <div
          data-testid="profile-intervention-run"
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(140px, 0.7fr) minmax(240px, 1.6fr) minmax(220px, 1.2fr)',
            gap: 14,
            alignItems: 'start',
            padding: '10px 14px',
            borderTop: '1px solid rgba(255,255,255,0.07)',
            borderBottom: '1px solid rgba(255,255,255,0.07)',
            background: 'rgba(8,12,18,0.72)',
            fontFamily: 'var(--font-jetbrains-mono), monospace',
          }}
        >
          <InterventionField
            label="干预状态"
            value={interventionStatusLabel(latestIntervention.status, latestIntervention.assessmentMastery)}
          />
          <InterventionField
            label="本轮实际干预"
            value={latestIntervention.protocol
              ? `${latestIntervention.protocol.primaryIntervention}\n${latestIntervention.protocol.executionSteps.map((step, index) => `${index + 1}. ${step}`).join('\n')}\n停止：${latestIntervention.protocol.stopCondition}`
              : latestIntervention.intervention}
          />
          <InterventionField
            label={latestIntervention.userOutcome ? '观察到的结果' : '下一步验证'}
            value={latestIntervention.userOutcome || latestIntervention.verificationCriterion}
          />
        </div>
      )}

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

function InterventionField({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ color: 'rgba(255,255,255,0.36)', fontSize: 8, marginBottom: 4 }}>{label}</div>
      <div style={{ color: 'rgba(255,255,255,0.78)', fontSize: 10, lineHeight: 1.55, overflowWrap: 'anywhere' }}>{value}</div>
    </div>
  )
}

function interventionStatusLabel(status: string, mastery?: number) {
  if (status === 'verified') return `已验证${typeof mastery === 'number' ? ` · 掌握度 ${mastery}` : ''}`
  if (status === 'needs_adjustment') return '需要调整'
  if (status === 'observed') return '已观察，等待正式验证'
  return '已执行，等待用户结果'
}
