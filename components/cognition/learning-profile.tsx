'use client'

import { useMemo, useState, type CSSProperties } from 'react'
import { Check, CircleHelp, Edit3, X } from 'lucide-react'
import { useCognition, useSubmitProfileFeedback, type CognitionData, type ProfileDimensionInsight } from '@/hooks/use-cognition'
import PromptModal from './observations-panel'

// ── Types ──

type Verdict = 'correct' | 'partial' | 'wrong'

// ── Constants ──

const DIMENSION_TONES = [
  { accent: 'rgba(103, 232, 249, 0.9)', soft: 'rgba(103, 232, 249, 0.1)', border: 'rgba(103, 232, 249, 0.25)' },
  { accent: 'rgba(251, 207, 232, 0.92)', soft: 'rgba(251, 207, 232, 0.1)', border: 'rgba(251, 207, 232, 0.25)' },
  { accent: 'rgba(253, 224, 71, 0.86)', soft: 'rgba(253, 224, 71, 0.09)', border: 'rgba(253, 224, 71, 0.22)' },
  { accent: 'rgba(110, 231, 183, 0.86)', soft: 'rgba(110, 231, 183, 0.09)', border: 'rgba(110, 231, 183, 0.22)' },
  { accent: 'rgba(196, 181, 253, 0.9)', soft: 'rgba(196, 181, 253, 0.1)', border: 'rgba(196, 181, 253, 0.25)' },
  { accent: 'rgba(147, 197, 253, 0.9)', soft: 'rgba(147, 197, 253, 0.09)', border: 'rgba(147, 197, 253, 0.22)' },
] as const

const PROFILE_CLAIM_TEMPLATES: Record<string, Array<{
  key: string
  caption: string
  fallbackClaim: string
  explanation: string
  promptEffect: string
}>> = {
  learningGoal: [
    { key: 'active-target', caption: '当前目标', fallbackClaim: '你当前的学习目标还不够稳定，需要继续确认。', explanation: '系统从学习路径、近期对话和反复出现的主题里确认主线。', promptEffect: '下一轮教学应先确认目标，而不是直接展开长解释。' },
    { key: 'scope-boundary', caption: '学习边界', fallbackClaim: '你的学习边界还比较松散，容易被临时问题带偏。', explanation: '系统还不能稳定区分哪些内容应深入，哪些应收束。', promptEffect: '下一轮教学应主动限定讨论范围。' },
    { key: 'desired-output', caption: '期望产物', fallbackClaim: '你的输出偏好还不稳定，需要在理解、方案、卡片和练习之间确认。', explanation: '影响回答形态：概念解释、执行方案、卡片沉淀或测验任务。', promptEffect: '下一轮教学应先确认输出形态，再组织内容。' },
  ],
  currentFoundation: [
    { key: 'mastered-concepts', caption: '已掌握', fallbackClaim: '你的已知前提还不够清楚，暂时不能直接跳过基础确认。', explanation: '如果系统不知道你已经会什么，容易重复或跳过不该跳过的基础。', promptEffect: '下一轮教学应用小问题快速确认前提。' },
    { key: 'weak-concepts', caption: '薄弱点', fallbackClaim: '你的薄弱概念区域还没有稳定浮现。', explanation: '薄弱点决定教学应该在哪里停下来补桥。', promptEffect: '下一轮教学应在关键概念上加校验。' },
    { key: 'missing-prerequisites', caption: '前置缺口', fallbackClaim: '你的前置缺口暂时不明显。', explanation: '前置缺口是会导致后面内容听不懂的基础断点。', promptEffect: '遇到理解阻塞时要回头检查前置。' },
  ],
  bestExplanationPath: [
    { key: 'explanation-order', caption: '讲法入口', fallbackClaim: '你更适合先例子、先框架还是先定义，还不稳定。', explanation: '讲法入口决定先建立直觉还是先建立结构。', promptEffect: '下一轮教学应尝试一种讲法并根据反馈更新画像。' },
    { key: 'representation', caption: '表达媒介', fallbackClaim: '你暂时适合简洁文字配合少量结构提示。', explanation: '文字、图解、代码、流程图适合不同类型的问题。', promptEffect: '下一轮教学应先用轻结构表达。' },
    { key: 'example-density', caption: '例子密度', fallbackClaim: '你需要多少具体例子才能进入抽象，目前还不稳定。', explanation: '例子太少导致抽象，太多显得拖沓。', promptEffect: '下一轮教学应先给一个例子再观察。' },
  ],
  stuckPattern: [
    { key: 'recurring-block', caption: '重复卡点', fallbackClaim: '你的重复卡点还没有稳定显现。', explanation: '不是一次错误，而是多次出现的理解阻塞方式。', promptEffect: '下一轮教学应继续观察，不要急着形成固定标签。' },
    { key: 'isolated-knowledge', caption: '孤立知识', fallbackClaim: '你的孤立知识问题暂时不明显。', explanation: '单点知道但没有和其他概念建立关系。', promptEffect: '下一轮教学可在解释后主动补概念连接。' },
    { key: 'conflict-pattern', caption: '冲突画像', fallbackClaim: '你的部分画像还可能互相冲突，需要继续观察。', explanation: '比如有时希望详细解释，有时又觉得啰嗦，不能过早写死。', promptEffect: '下一轮教学应把冲突判断作为条件策略。' },
  ],
  paceAndLoad: [
    { key: 'chunk-size', caption: '信息块', fallbackClaim: '你适合中等大小的信息块，分段推进。', explanation: '信息块大小决定一次回答放多少概念和操作步骤。', promptEffect: '下一轮教学应避免一次性塞太多内容。' },
    { key: 'rhythm', caption: '推进节奏', fallbackClaim: '你的推进节奏更适合稳步推进。', explanation: '决定系统是快速给结论还是慢拆原因和边界。', promptEffect: '下一轮教学应先稳住结构，再根据反馈加速。' },
    { key: 'confirmation', caption: '确认频率', fallbackClaim: '你在关键节点后需要轻量确认。', explanation: '确认不一定是考试，可以是复述、选择、改写或应用。', promptEffect: '下一轮教学应在关键概念后加入小检查。' },
  ],
  masteryCheck: [
    { key: 'proof-format', caption: '掌握判据', fallbackClaim: '你适合通过复述、比较和边界判断来确认是否真的学会。', explanation: '掌握不是看过或觉得懂，而是能讲清楚、用出来、分清边界。', promptEffect: '下一轮教学应用小任务检验掌握。' },
    { key: 'transfer-task', caption: '迁移能力', fallbackClaim: '你的迁移能力证据还不足，需要用新问题来验证。', explanation: '迁移能力比记住定义更重要。', promptEffect: '下一轮教学应在解释后安排一个小迁移任务。' },
    { key: 'review-signal', caption: '复习信号', fallbackClaim: '你的复习压力暂时不强。', explanation: '复习信号来自遗忘、重复错误、长期未触达或路径停滞。', promptEffect: '下一轮教学可继续推进，但保留复习触发条件。' },
  ],
}

// ── Data types ──

interface ProfileNode {
  id: string
  key: string
  caption: string
  dimensionKey: string
  dimensionLabel: string
  claim: string
  explanation: string
  promptEffect: string
  confidence: number
  freshness: string
  feedback?: NonNullable<ProfileDimensionInsight['userFeedback']>
}

type DimensionView = ProfileDimensionInsight & {
  nodes: ProfileNode[]
  tone: (typeof DIMENSION_TONES)[number]
}

// ── Main ──

export default function LearningProfile() {
  const { data, loading } = useCognition()
  const submitFeedback = useSubmitProfileFeedback()
  const dimensions = useMemo(() => buildDimensions(data), [data])
  const profileTree = useMemo(() => buildProfileTree(data, dimensions), [data, dimensions])

  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')

  // Default to first dimension when data loads and nothing is selected
  const activeKey = selectedKey ?? profileTree[0]?.key ?? null
  const activeDimension = activeKey
    ? profileTree.find((d) => d.key === activeKey) ?? null
    : null

  const activeIndex = activeDimension
    ? profileTree.findIndex((d) => d.key === activeDimension.key)
    : -1
  const activeTone = activeIndex >= 0
    ? DIMENSION_TONES[activeIndex % DIMENSION_TONES.length]
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
    return (
      <aside className="cognition-workbench pointer-events-auto">
        <div className="profile-loading">
          <p>正在加载画像...</p>
        </div>
      </aside>
    )
  }

  if (profileTree.length === 0) {
    return (
      <aside className="cognition-workbench pointer-events-auto">
        <div className="profile-empty">
          <p>当前没有可展示的画像。</p>
          <p>完成一次 AI 工作台对话或创建学习路径后，这里会生成画像结构。</p>
        </div>
      </aside>
    )
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

        <div className="profile-pill-dock">
          {profileTree.map((dimension, index) => {
            const tone = DIMENSION_TONES[index % DIMENSION_TONES.length]
            const isActive = dimension.key === activeKey

            return (
              <button
                key={dimension.key}
                type="button"
                className={`profile-capsule${isActive ? ' active' : ''}`}
                style={{
                  '--profile-accent': tone.accent,
                  '--profile-soft': tone.soft,
                  '--profile-border': tone.border,
                } as CSSProperties}
                onClick={() => setSelectedKey(dimension.key)}
              >
                {dimension.label}
              </button>
            )
          })}
        </div>

        <div className="profile-prompt-action">
          <PromptModal />
        </div>
      </div>

      {/* Detail: node cards only (knowledge-graph glass-panel style) */}
      {activeDimension && activeTone && (
        <div
          className={`profile-nodes-grid ${profileLayoutClass}`}
          style={{
            '--profile-columns': profileColumns,
            '--profile-rows': profileRows,
          } as CSSProperties}
        >
          {activeDimension.nodes.map((node) => (
            <section
              key={node.id}
              className="profile-node-card glass-panel rounded-2xl border-white/10 bg-black/[0.38] px-4 py-3 shadow-[0_18px_58px_rgba(0,0,0,0.22)]"
              style={{
                display: 'flex',
                flexDirection: 'column',
              } as CSSProperties}
            >
              {/* Node header */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{
                  fontFamily: 'var(--font-jetbrains-mono), monospace',
                  fontSize: '8px',
                  textTransform: 'uppercase' as const,
                  letterSpacing: '0.16em',
                  color: 'rgba(255,255,255,0.34)',
                }}>
                  {node.caption}
                </span>
                <span style={{
                  fontFamily: 'var(--font-jetbrains-mono), monospace',
                  fontSize: '12px',
                  color: 'rgba(255,255,255,0.3)',
                }}>
                  {Math.round(node.confidence * 100)}%
                </span>
              </div>

              {/* Freshness badge */}
              {node.freshness !== '待观察' && (
                <span style={{
                  display: 'inline-flex',
                  alignSelf: 'flex-start',
                  marginBottom: 8,
                  padding: '2px 7px',
                  borderRadius: 999,
                  border: '1px solid rgba(255,255,255,0.08)',
                  background: node.freshness === '有新证据'
                    ? 'rgba(103,232,249,0.08)'
                    : 'rgba(110,231,183,0.08)',
                  color: node.freshness === '有新证据'
                    ? 'rgba(103,232,249,0.65)'
                    : 'rgba(110,231,183,0.65)',
                  fontSize: '9px',
                  fontFamily: 'var(--font-jetbrains-mono), monospace',
                }}>
                  {node.freshness}
                </span>
              )}

              {/* Edit mode or display */}
              {editingNodeId === node.id ? (
                <div style={{ marginBottom: 10 }}>
                  <textarea
                    style={{
                      width: '100%', minHeight: 64, resize: 'vertical' as const,
                      borderRadius: 10, border: '1px solid rgba(255,255,255,0.1)',
                      background: 'rgba(0,0,0,0.2)', padding: 10,
                      color: 'rgba(255,255,255,0.84)', outline: 'none',
                      fontSize: 13, lineHeight: 1.5,
                    }}
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    rows={3}
                    autoFocus
                  />
                  <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                    <button
                      type="button"
                      className="profile-verdict-btn correct"
                      onClick={() => {
                        submitFeedback.mutate({
                          dimensionKey: node.dimensionKey, nodeKey: node.id, nodeLabel: node.caption,
                          verdict: 'correct', confidence: node.confidence, summary: editText.trim(),
                        })
                        setEditingNodeId(null)
                      }}
                      disabled={!editText.trim() || submitFeedback.isPending}
                    >
                      保存
                    </button>
                    <button
                      type="button"
                      className="profile-verdict-btn wrong"
                      onClick={() => setEditingNodeId(null)}
                    >
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="profile-node-claim" style={{ margin: '0 0 8px', color: 'rgba(255,255,255,0.86)', fontSize: 15, lineHeight: 1.5 }}>
                    {node.claim}
                  </p>
                  <p className="profile-node-explanation" style={{ margin: '0 0 6px', color: 'rgba(255,255,255,0.4)', fontSize: 13, lineHeight: 1.5 }}>
                    {node.explanation}
                  </p>
                  <p className="profile-node-effect" style={{
                    margin: '10px 0 0', padding: '8px 10px', borderRadius: 10,
                    background: 'rgba(255,255,255,0.02)', color: 'rgba(255,255,255,0.25)',
                    fontSize: 12, lineHeight: 1.4,
                  }}>
                    {node.promptEffect}
                  </p>
                </>
              )}

              {/* Actions */}
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: 6, marginTop: 10,
              }} className="profile-node-actions">
                <div style={{ display: 'flex', gap: 4 }}>
                  <button
                    type="button"
                    className="profile-verdict-btn correct"
                    disabled={submitFeedback.isPending}
                    onClick={() => submitFeedback.mutate({
                      dimensionKey: node.dimensionKey, nodeKey: node.id, nodeLabel: node.caption,
                      verdict: 'correct', confidence: 1, summary: node.claim,
                    })}
                  >
                    <Check className="h-3 w-3" /> 准确
                  </button>
                  <button
                    type="button"
                    className="profile-verdict-btn partial"
                    disabled={submitFeedback.isPending}
                    onClick={() => submitFeedback.mutate({
                      dimensionKey: node.dimensionKey, nodeKey: node.id, nodeLabel: node.caption,
                      verdict: 'partial', confidence: 0.6, summary: node.claim,
                    })}
                  >
                    <CircleHelp className="h-3 w-3" /> 部分
                  </button>
                  <button
                    type="button"
                    className="profile-verdict-btn wrong"
                    disabled={submitFeedback.isPending}
                    onClick={() => submitFeedback.mutate({
                      dimensionKey: node.dimensionKey, nodeKey: node.id, nodeLabel: node.caption,
                      verdict: 'wrong', confidence: 0.2, summary: node.claim,
                    })}
                  >
                    <X className="h-3 w-3" /> 不准
                  </button>
                </div>
                <button
                  type="button"
                  className="profile-verdict-btn"
                  onClick={() => { setEditingNodeId(node.id); setEditText(node.claim) }}
                >
                  <Edit3 className="h-3 w-3" /> 编辑
                </button>
              </div>
            </section>
          ))}
        </div>
      )}
    </aside>
  )
}

// ── Data Builders ──

function buildDimensions(data: CognitionData | null): ProfileDimensionInsight[] {
  if (data?.dimensionInsights?.length) return data.dimensionInsights
  return []
}

function buildProfileTree(
  data: CognitionData | null,
  dimensions: ProfileDimensionInsight[],
): DimensionView[] {
  const claims = buildDimensionClaims(data)
  return dimensions.map((dimension, dimensionIndex) => {
    const tone = DIMENSION_TONES[dimensionIndex % DIMENSION_TONES.length]
    const templates = PROFILE_CLAIM_TEMPLATES[dimension.key] ?? []
    const nodes = templates.map((template, nodeIndex) => {
      const nodeId = `${dimension.key}:${template.key}`
      const feedback = dimension.nodeFeedback?.[nodeId]
      const directObservation = dimension.observations[nodeIndex]
      const sourceBoost = directObservation ? 0.08 : 0
      const feedbackShift =
        feedback?.verdict === 'correct' ? 0.1
          : feedback?.verdict === 'partial' ? 0.02
            : feedback?.verdict === 'wrong' ? -0.18
              : 0
      const feedbackWeight = feedback ? feedback.confidence * 0.08 : 0
      const confidence = clamp01(dimension.confidence * 0.78 + sourceBoost + feedbackShift + feedbackWeight)
      const baseClaim = claims[dimension.key]?.[nodeIndex] ?? template.fallbackClaim
      const claim = feedback?.summary?.trim() || baseClaim

      return {
        id: nodeId,
        key: template.key,
        caption: template.caption,
        dimensionKey: dimension.key,
        dimensionLabel: dimension.label,
        claim,
        explanation: template.explanation,
        promptEffect: template.promptEffect,
        confidence,
        freshness: feedback ? '已校验' : directObservation ? '有新证据' : '待观察',
        feedback,
      }
    })

    return { ...dimension, tone, nodes }
  })
}

function buildDimensionClaims(data: CognitionData | null): Record<string, string[]> {
  const goals = data?.profileSummary?.goals ?? []
  const domains = data?.profileSummary?.activeDomains ?? []
  const mastered = data?.knowledgeProfile?.masteredConcepts ?? []
  const weak = data?.knowledgeProfile?.weakConcepts ?? []
  const missing = data?.knowledgeProfile?.missingPrerequisites ?? []
  const isolated = data?.knowledgeProfile?.isolatedNodes ?? []
  const styles = data?.teachingPolicy?.explainStyle ?? data?.preferences?.explanationStyle ?? []
  const pace = data?.teachingPolicy?.pace ?? data?.preferences?.pace
  const nextActions = data?.nextActions ?? []
  const needsExamples = data?.teachingPolicy?.shouldUseExamples ?? data?.preferences?.needsExamples

  return {
    learningGoal: [
      goals[0] ? `你当前主要在推进「${goals[0]}」。` : '你的当前学习目标还不够稳定，需要继续确认。',
      domains.length ? `你的学习边界主要靠近「${domains.slice(0, 2).join(' / ')}」。` : '你的学习边界还比较松散。',
      nextActions[0] ? `你下一步更需要「${nextActions[0]}」。` : '你的输出偏好还不稳定。',
    ],
    currentFoundation: [
      mastered[0] ? `你已经可以把「${mastered.slice(0, 2).join('、')}」作为已知前提。` : '你的已知前提还不够清楚。',
      weak[0] ? `你的薄弱点集中在「${weak.slice(0, 2).join('、')}」。` : '你的薄弱概念区域还没有稳定浮现。',
      missing[0] ? `你可能缺少这些前置：「${missing.slice(0, 2).join('、')}」。` : '你的前置缺口暂时不明显。',
    ],
    bestExplanationPath: [
      styles[0] ? `你更适合用「${styles.slice(0, 2).join('、')}」进入解释。` : '你的最佳讲法入口还不稳定。',
      data?.teachingPolicy?.shouldSuggestWikiLinks ? '你需要用关系、图谱来帮助理解。' : '你暂时适合简洁文字配合少量结构提示。',
      needsExamples ? '你需要先看到具体例子，再回到抽象定义。' : '你可以减少例子，更多使用框架和边界说明。',
    ],
    stuckPattern: [
      weak[0] ? `你反复卡住的地方可能来自「${weak[0]}」。` : '你的重复卡点还没有稳定显现。',
      isolated[0] ? `你存在孤立知识点，例如「${isolated[0]?.title ?? isolated[0]}」。` : '你的孤立知识问题暂时不明显。',
      '你的部分画像还可能互相冲突，需要继续观察，不能过早定型。',
    ],
    paceAndLoad: [
      pace === 'slow' ? '你更适合较小的信息块，先拆开讲。' : pace === 'fast' ? '你可以提高推进速度，但仍要保留检查点。' : '你适合中等大小的信息块，分段推进。',
      data?.teachingPolicy?.shouldAskReflection ? '你推进后需要加入复述或反思问题。' : '你当前可以更连续地推进。',
      '你在关键概念后需要轻量确认，避免只是看起来理解。',
    ],
    masteryCheck: [
      data?.teachingPolicy?.shouldPreferPractice ? '你更适合用练习或小任务证明掌握。' : '你适合通过复述、比较和边界判断来确认是否真的学会。',
      '你需要用迁移任务确认能否把概念用到新问题。',
      data?.stats?.pendingReview ? `你有 ${data.stats.pendingReview} 项内容可能需要复习。` : '你的复习压力暂时不强。',
    ],
  }
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}
