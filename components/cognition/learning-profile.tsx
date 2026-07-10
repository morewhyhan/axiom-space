'use client'

import { useMemo, useState, type CSSProperties } from 'react'
import { CheckCircle2, ChevronDown, ChevronUp, FlaskConical, XCircle } from 'lucide-react'
import { HudPanel } from '@/components/ui'
import { useCognition, useSubmitProfileFeedback } from '@/hooks/use-cognition'
import PromptModal from './observations-panel'
import { ProfileHistoryStrip } from './profile-history-strip'
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
  const [assessmentOpen, setAssessmentOpen] = useState(false)

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
      <ProfileHistoryStrip />
      {!!data?.assessmentTimeline?.length && (
        <HudPanel as="section" className="mb-3 rounded-xl p-3" data-testid="assessment-evidence-timeline">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-3 text-left"
            onClick={() => setAssessmentOpen((value) => !value)}
            data-testid="assessment-evidence-toggle"
          >
            <span className="flex items-center gap-2">
              <FlaskConical className="h-4 w-4 text-cyan-200/70" />
              <span>
                <span className="block mono uppercase text-white/32" style={{ fontSize: 'var(--f8)' }}>Assessment_Evidence</span>
                <span className="block text-white/58" style={{ fontSize: 'var(--f9)' }}>
                  {data.assessmentTimeline.length} 次正式评估 · {data.assessmentTimeline.filter((item) => item.passed).length} 次通过
                </span>
              </span>
            </span>
            {assessmentOpen ? <ChevronUp className="h-4 w-4 text-white/35" /> : <ChevronDown className="h-4 w-4 text-white/35" />}
          </button>
          {assessmentOpen && (
            <div className="mt-3 grid gap-2 border-t border-white/8 pt-3">
              {data.assessmentTimeline.map((item) => (
                <AssessmentEvidenceRow key={item.id} item={item} />
              ))}
            </div>
          )}
        </HudPanel>
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

function AssessmentEvidenceRow({ item }: { item: NonNullable<ReturnType<typeof useCognition>['data']>['assessmentTimeline'][number] }) {
  const rubricId = typeof item.verification?.rubricId === 'string' ? item.verification.rubricId : '未标注'
  const deterministicCheck = typeof item.verification?.deterministicCheck === 'string' ? item.verification.deterministicCheck : '未标注'
  return (
    <div className="rounded-lg border border-white/8 bg-white/[0.02] px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-white/72" style={{ fontSize: 'var(--f9)' }}>
          {item.passed ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-200/70" /> : <XCircle className="h-3.5 w-3.5 text-rose-200/70" />}
          {item.concept}
        </span>
        <span className="mono text-white/38" style={{ fontSize: 'var(--f8)' }}>
          {item.mastery} · {item.passed ? '通过' : '未通过'} · {new Date(item.createdAt).toLocaleDateString('zh-CN')}
        </span>
      </div>
      <div className="mt-1 text-white/45" style={{ fontSize: 'var(--f8)' }}>{item.feedback}</div>
      <div className="mt-1 text-cyan-100/48" style={{ fontSize: 'var(--f8)' }}>
        量规 {rubricId} · 确定性检查 {deterministicCheck}
      </div>
      {item.evidence.length > 0 && (
        <div className="mt-1 text-white/34" style={{ fontSize: 'var(--f8)' }}>
          证据：{item.evidence.join('；')}
        </div>
      )}
      <div className="mt-1 mono text-white/22" style={{ fontSize: 'var(--f8)' }}>评估记录 ID：{item.id}</div>
    </div>
  )
}
