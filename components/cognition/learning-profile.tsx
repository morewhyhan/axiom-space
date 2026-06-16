'use client'

import { useEffect, useMemo, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react'
import {
  Check,
  ChevronRight,
  CircleHelp,
  ClipboardList,
  Eye,
  GitBranch,
  Layers3,
  Plus,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  X,
} from 'lucide-react'
import {
  useAddProfileObservation,
  useCognition,
  useSubmitProfileFeedback,
  type CognitionData,
  type ProfileDimensionInsight,
} from '@/hooks/use-cognition'

type Verdict = 'correct' | 'partial' | 'wrong'
type Importance = 'high' | 'medium' | 'low'

const VERDICT_LABEL: Record<Verdict, string> = {
  correct: '准确',
  partial: '部分准确',
  wrong: '不准确',
}

const DIMENSION_TONES = [
  { accent: 'rgba(103, 232, 249, 0.9)', soft: 'rgba(103, 232, 249, 0.1)' },
  { accent: 'rgba(251, 207, 232, 0.92)', soft: 'rgba(251, 207, 232, 0.1)' },
  { accent: 'rgba(253, 224, 71, 0.86)', soft: 'rgba(253, 224, 71, 0.09)' },
  { accent: 'rgba(110, 231, 183, 0.86)', soft: 'rgba(110, 231, 183, 0.09)' },
  { accent: 'rgba(196, 181, 253, 0.9)', soft: 'rgba(196, 181, 253, 0.1)' },
  { accent: 'rgba(147, 197, 253, 0.9)', soft: 'rgba(147, 197, 253, 0.09)' },
] as const

const PROFILE_CLAIM_TEMPLATES: Record<string, Array<{
  key: string
  caption: string
  fallbackClaim: string
  explanation: string
  promptEffect: string
  importance: Importance
}>> = {
  learningGoal: [
    { key: 'active-target', caption: '当前目标', fallbackClaim: '你的当前学习目标还不够稳定，需要继续确认真正想推进的主线。', explanation: '系统需要从学习路径、近期对话和反复出现的主题里确认主线。', promptEffect: '下一轮教学应先确认目标，而不是直接展开长解释。', importance: 'high' },
    { key: 'scope-boundary', caption: '学习边界', fallbackClaim: '你的学习边界还比较松散，容易被临时问题带偏。', explanation: '这说明系统还不能稳定区分哪些内容应该深入，哪些内容应该暂时收束。', promptEffect: '下一轮教学应主动限定讨论范围，避免解释发散。', importance: 'medium' },
    { key: 'desired-output', caption: '期望产物', fallbackClaim: '你的输出偏好还不稳定，暂时需要在理解、方案、卡片和练习之间确认。', explanation: '这会影响回答形态：同一个问题可能需要概念解释、执行方案、卡片沉淀或测验任务。', promptEffect: '下一轮教学应先确认输出形态，再组织内容。', importance: 'high' },
  ],
  currentFoundation: [
    { key: 'mastered-concepts', caption: '已掌握', fallbackClaim: '你的已知前提还不够清楚，暂时不能直接跳过基础确认。', explanation: '如果系统不知道你已经会什么，就容易重复解释或跳过不该跳过的基础。', promptEffect: '下一轮教学应用小问题快速确认前提，而不是假设你已经掌握。', importance: 'high' },
    { key: 'weak-concepts', caption: '薄弱点', fallbackClaim: '你的薄弱概念区域还没有稳定浮现。', explanation: '薄弱点决定教学应该在哪里停下来补桥，而不是继续往后推进。', promptEffect: '下一轮教学应在关键概念上加校验，发现薄弱点后先补前置。', importance: 'high' },
    { key: 'missing-prerequisites', caption: '前置缺口', fallbackClaim: '你的前置缺口暂时不明显。', explanation: '前置缺口不是一般不会，而是会直接导致后面内容听不懂的基础断点。', promptEffect: '下一轮教学可以继续推进，但遇到理解阻塞时要回头检查前置。', importance: 'medium' },
  ],
  bestExplanationPath: [
    { key: 'explanation-order', caption: '讲法入口', fallbackClaim: '你的最佳讲法入口还不稳定，需要继续观察你更适合先例子、先框架还是先定义。', explanation: '讲法入口决定你是先建立直觉，还是先建立结构，再进入细节。', promptEffect: '下一轮教学应尝试一种讲法，并根据你的反馈更新画像。', importance: 'high' },
    { key: 'representation', caption: '表达媒介', fallbackClaim: '你暂时适合简洁文字配合少量结构提示。', explanation: '表达媒介会影响理解成本：文字、图解、代码、流程图适合不同类型的问题。', promptEffect: '下一轮教学应先用轻结构表达，必要时再转成图解或流程。', importance: 'medium' },
    { key: 'example-density', caption: '例子密度', fallbackClaim: '你需要多少具体例子才能进入抽象，目前还不稳定。', explanation: '例子太少会导致抽象，例子太多会显得拖沓；这个判断会控制解释颗粒度。', promptEffect: '下一轮教学应先给一个例子，再观察你是否需要更多例子。', importance: 'high' },
  ],
  stuckPattern: [
    { key: 'recurring-block', caption: '重复卡点', fallbackClaim: '你的重复卡点还没有稳定显现。', explanation: '重复卡点不是一次错误，而是多次出现的理解阻塞方式。', promptEffect: '下一轮教学应继续观察，不要急着形成固定标签。', importance: 'high' },
    { key: 'isolated-knowledge', caption: '孤立知识', fallbackClaim: '你的孤立知识问题暂时不明显。', explanation: '孤立知识指的是单点知道，但没有和其他概念建立关系。', promptEffect: '下一轮教学可以在解释后主动补概念连接。', importance: 'medium' },
    { key: 'conflict-pattern', caption: '冲突画像', fallbackClaim: '你的部分画像还可能互相冲突，需要继续观察。', explanation: '比如你有时希望详细解释，有时又觉得啰嗦，这类冲突不能过早写死。', promptEffect: '下一轮教学应把冲突判断作为条件策略，而不是固定策略。', importance: 'medium' },
  ],
  paceAndLoad: [
    { key: 'chunk-size', caption: '信息块', fallbackClaim: '你适合中等大小的信息块，分段推进。', explanation: '信息块大小决定一次回答放多少概念、例子和操作步骤。', promptEffect: '下一轮教学应避免一次性塞太多内容，并保留分段结构。', importance: 'high' },
    { key: 'rhythm', caption: '推进节奏', fallbackClaim: '你的推进节奏更适合稳步推进，而不是极快跳跃。', explanation: '推进节奏决定系统是快速给结论，还是慢拆原因和边界。', promptEffect: '下一轮教学应先稳住结构，再根据你的反馈加速。', importance: 'high' },
    { key: 'confirmation', caption: '确认频率', fallbackClaim: '你在关键节点后需要轻量确认，避免只是看起来理解。', explanation: '确认不一定是考试，也可以是让你复述、选择、改写或应用。', promptEffect: '下一轮教学应在关键概念后加入小检查。', importance: 'medium' },
  ],
  masteryCheck: [
    { key: 'proof-format', caption: '掌握判据', fallbackClaim: '你适合通过复述、比较和边界判断来确认是否真的学会。', explanation: '掌握不是看过，也不是觉得懂，而是能把概念讲清楚、用出来、分清边界。', promptEffect: '下一轮教学应用小任务检验掌握，而不是只继续解释。', importance: 'high' },
    { key: 'transfer-task', caption: '迁移能力', fallbackClaim: '你的迁移能力证据还不足，暂时需要用新问题来验证。', explanation: '迁移能力比记住定义更重要，它能判断你是否真正建立了可用理解。', promptEffect: '下一轮教学应在解释后安排一个小迁移任务。', importance: 'medium' },
    { key: 'review-signal', caption: '复习信号', fallbackClaim: '你的复习压力暂时不强。', explanation: '复习信号来自遗忘、重复错误、长期未触达或路径停滞。', promptEffect: '下一轮教学可以继续推进，但要保留复习触发条件。', importance: 'low' },
  ],
}

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
  importance: Importance
  freshness: string
  evidenceCount: number
  evidenceLabels: string[]
  observations: ProfileDimensionInsight['observations']
  feedback?: NonNullable<ProfileDimensionInsight['userFeedback']>
}

type DimensionView = ProfileDimensionInsight & {
  nodes: ProfileNode[]
  tone: (typeof DIMENSION_TONES)[number]
}

export default function LearningProfile() {
  const { data, loading } = useCognition()
  const submitFeedback = useSubmitProfileFeedback()
  const addObservation = useAddProfileObservation()
  const dimensions = useMemo(() => buildDimensions(data), [data])
  const profileTree = useMemo(() => buildProfileTree(data, dimensions), [data, dimensions])
  const allNodes = useMemo(() => profileTree.flatMap((dimension) => dimension.nodes), [profileTree])
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const selectedNode = allNodes.find((node) => node.id === selectedNodeId) ?? allNodes[0] ?? null
  const selectedDimension = selectedNode
    ? profileTree.find((dimension) => dimension.key === selectedNode.dimensionKey) ?? null
    : null
  const profileStats = useMemo(() => buildProfileStats(data, allNodes), [data, allNodes])

  useEffect(() => {
    if (!allNodes.length) {
      if (selectedNodeId !== null) setSelectedNodeId(null)
      return
    }
    if (!selectedNodeId || !allNodes.some((node) => node.id === selectedNodeId)) {
      setSelectedNodeId(allNodes[0].id)
    }
  }, [allNodes, selectedNodeId])

  return (
    <aside className="side-slot visible cognition-panel cognition-workbench pointer-events-auto" style={{ maxWidth: 'none' }}>
      <div className="cognition-scroll no-scrollbar">
        <section className="cognition-brief glass-panel">
          <div className="cognition-brief-main">
            <div className="cognition-eyebrow">
              <Sparkles className="h-3.5 w-3.5" />
              教学画像闭环
            </div>
            <h2>当前学习画像</h2>
            <p>{data?.profileSummary?.summary || '画像仍在形成中。系统会从对话、卡片、学习路径和用户校验中逐步建立判断。'}</p>
            <div className="cognition-focus-line">
              <ShieldCheck className="h-4 w-4" />
              <span>{data?.profileSummary?.teachingFocus || '下一轮教学会优先收集目标、基础、讲法和卡点证据。'}</span>
            </div>
          </div>
          <div className="cognition-brief-metrics">
            <BriefMetric label="可用证据" value={profileStats.evidenceCount} detail="条" />
            <BriefMetric label="已校验节点" value={profileStats.verifiedCount} detail={`/${profileStats.nodeCount}`} />
            <BriefMetric label="可进材料" value={profileStats.injectableCount} detail="项" />
            <BriefMetric label="平均置信" value={profileStats.averageConfidence} detail="%" />
          </div>
        </section>

        <div className="cognition-layout">
          <section className="cognition-matrix glass-panel">
            <div className="cognition-section-head">
              <div>
                <div className="cognition-eyebrow">
                  <Layers3 className="h-3.5 w-3.5" />
                  画像矩阵
                </div>
                <h3>画像判断</h3>
              </div>
              <AddProfileClaim
                dimensions={profileTree}
                selectedDimensionKey={selectedNode?.dimensionKey}
                disabled={addObservation.isPending}
                onSubmit={(input, done) => addObservation.mutate(input, { onSuccess: done })}
              />
            </div>

            {profileTree.length === 0 ? (
              <div className="cognition-empty-state">
                当前没有可展示的画像。完成一次 AI 工作台对话、创建学习路径，或主动添加一条画像后，这里会生成结构。
              </div>
            ) : (
              <div className="cognition-dimension-grid">
                {profileTree.map((dimension) => (
                  <DimensionColumn
                    key={dimension.key}
                    dimension={dimension}
                    selectedNodeId={selectedNode?.id ?? null}
                    loading={loading}
                    onSelect={setSelectedNodeId}
                  />
                ))}
              </div>
            )}
          </section>

          <NodeDetail
            node={selectedNode}
            dimension={selectedDimension}
            loading={loading}
            disabled={submitFeedback.isPending}
            savingSummary={submitFeedback.isPending}
            onSaveSummary={(payload, done) => submitFeedback.mutate(payload, { onSuccess: done })}
            onSubmit={(payload) => submitFeedback.mutate(payload)}
          />
        </div>

      </div>
    </aside>
  )
}

function DimensionColumn({
  dimension,
  selectedNodeId,
  loading,
  onSelect,
}: {
  dimension: DimensionView
  selectedNodeId: string | null
  loading: boolean
  onSelect: (nodeId: string) => void
}) {
  const scorePct = Math.round(clamp01(dimension.score) * 100)
  const confidencePct = Math.round(clamp01(dimension.confidence) * 100)
  const style = {
    '--profile-accent': dimension.tone.accent,
    '--profile-soft': dimension.tone.soft,
  } as CSSProperties

  return (
    <article className="cognition-dimension-column" style={style}>
      <div className="cognition-dimension-head">
        <div>
          <span className="cognition-dot" />
          <h4>{dimension.label}</h4>
        </div>
        <div className="cognition-dimension-score">
          <strong>{confidencePct}</strong>
          <span>置信</span>
        </div>
      </div>
      <p>{loading ? '画像加载中...' : dimension.interpretation}</p>
      <div className="cognition-score-line">
        <span style={{ width: `${Math.max(scorePct, 4)}%` }} />
      </div>
      <div className="cognition-node-list">
        {dimension.nodes.map((node) => (
          <button
            key={node.id}
            className={`cognition-node-row${selectedNodeId === node.id ? ' active' : ''}`}
            onClick={() => onSelect(node.id)}
          >
            <span className="cognition-node-main">
              <span>{node.claim}</span>
              <small>{node.caption}</small>
            </span>
            <span className="cognition-node-meta">
              <span>{Math.round(node.confidence * 100)}%</span>
              <ChevronRight className="h-3.5 w-3.5" />
            </span>
          </button>
        ))}
      </div>
    </article>
  )
}

function NodeDetail({
  node,
  dimension,
  loading,
  disabled,
  savingSummary,
  onSaveSummary,
  onSubmit,
}: {
  node: ProfileNode | null
  dimension: DimensionView | null
  loading: boolean
  disabled: boolean
  savingSummary: boolean
  onSaveSummary: (input: {
    dimensionKey: string
    nodeKey?: string
    nodeLabel?: string
    verdict: Verdict
    confidence: number
    note?: string
    summary?: string
  }, done: () => void) => void
  onSubmit: (input: {
    dimensionKey: string
    nodeKey?: string
    nodeLabel?: string
    verdict: Verdict
    confidence: number
    note?: string
  }) => void
}) {
  if (!node || !dimension) {
    return (
      <section className="cognition-node-detail glass-panel">
        <div className="cognition-empty-state">选择一个画像判断后，可以查看总结、证据推理和置信度。</div>
      </section>
    )
  }

  const style = {
    '--profile-accent': dimension.tone.accent,
    '--profile-soft': dimension.tone.soft,
  } as CSSProperties

  return (
    <section className="cognition-node-detail glass-panel" style={style}>
      <div className="cognition-detail-top simple">
        <div>
          <div className="cognition-eyebrow">
            <GitBranch className="h-3.5 w-3.5" />
            {node.dimensionLabel}
          </div>
          <h3>你的画像</h3>
        </div>
        <div className="cognition-confidence-orb">
          <strong>{Math.round(node.confidence * 100)}</strong>
          <span>置信</span>
        </div>
      </div>

      <SummaryEditor
        node={node}
        loading={loading}
        disabled={savingSummary}
        onSave={(summary, done) => onSaveSummary({
          dimensionKey: node.dimensionKey,
          nodeKey: node.id,
          nodeLabel: node.caption,
          verdict: node.feedback?.verdict ?? 'correct',
          confidence: node.feedback?.confidence ?? node.confidence,
          note: node.feedback?.note,
          summary,
        }, done)}
      />

      <EvidenceBlock node={node} />

      <CalibrationPanel node={node} disabled={disabled} onSubmit={onSubmit} />
    </section>
  )
}

function SummaryEditor({
  node,
  loading,
  disabled,
  onSave,
}: {
  node: ProfileNode
  loading: boolean
  disabled: boolean
  onSave: (text: string, done: () => void) => void
}) {
  const [summary, setSummary] = useState(node.claim)
  const [savedText, setSavedText] = useState('')

  useEffect(() => {
    setSummary(node.feedback?.summary || node.claim)
    setSavedText('')
  }, [node.id, node.claim, node.feedback?.summary])

  const currentSummary = node.feedback?.summary || node.claim
  const changed = summary.trim() && summary.trim() !== currentSummary.trim()

  return (
    <div className="cognition-summary-editor">
      <div className="cognition-mini-title">
        <ClipboardList className="h-3.5 w-3.5" />
        总结
      </div>
      <textarea
        value={loading ? '正在读取画像判断...' : summary}
        disabled={loading || disabled}
        onChange={(event) => setSummary(event.target.value)}
      />
      <div className="cognition-summary-actions">
        <span>{savedText || '保存后会优先使用你的修订版作为这个画像判断的总结。'}</span>
        <button
          disabled={!changed || disabled}
          onClick={() => onSave(summary.trim(), () => setSavedText('已保存用户修订'))}
        >
          保存总结
        </button>
      </div>
    </div>
  )
}

function EvidenceBlock({ node }: { node: ProfileNode }) {
  return (
    <div className="cognition-evidence-block">
      <div className="cognition-mini-title">
        <Eye className="h-3.5 w-3.5" />
        证据与推理
      </div>
      {node.observations.length > 0 ? (
        <div className="cognition-evidence-list">
          {node.observations.slice(0, 4).map((observation, index) => (
            <div key={`${node.id}-evidence-${index}`} className="cognition-evidence-item">
              <p>{observation.text}</p>
              <div>
                <span>{observation.entryPoint}</span>
                <span>{observation.sourceType}:{observation.sourceId}</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="cognition-evidence-empty">
          这条画像判断还缺少直接证据。系统会先把它作为待观察判断，不会把它当成稳定事实。
        </div>
      )}
      <div className="cognition-reasoning-line">
        <span>{node.explanation}</span>
        <span>{node.promptEffect}</span>
      </div>
      <div className="cognition-evidence-tags">
        {node.evidenceLabels.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
    </div>
  )
}

function CalibrationPanel({
  node,
  disabled,
  onSubmit,
}: {
  node: ProfileNode
  disabled: boolean
  onSubmit: (input: {
    dimensionKey: string
    nodeKey?: string
    nodeLabel?: string
    verdict: Verdict
    confidence: number
    note?: string
  }) => void
}) {
  const [verdict, setVerdict] = useState<Verdict>(node.feedback?.verdict ?? 'correct')
  const [confidence, setConfidence] = useState(Math.round((node.feedback?.confidence ?? 0.7) * 100))
  const [note, setNote] = useState(node.feedback?.note ?? '')

  useEffect(() => {
    setVerdict(node.feedback?.verdict ?? 'correct')
    setConfidence(Math.round((node.feedback?.confidence ?? 0.7) * 100))
    setNote(node.feedback?.note ?? '')
  }, [node.id, node.feedback])

  return (
    <div className="cognition-calibration">
      <div className="cognition-mini-title">
        <SlidersHorizontal className="h-3.5 w-3.5" />
        置信度
      </div>
      <div className="cognition-verdict-grid">
        <VerdictButton active={verdict === 'correct'} icon={<Check className="h-3.5 w-3.5" />} label="准确" onClick={() => setVerdict('correct')} />
        <VerdictButton active={verdict === 'partial'} icon={<CircleHelp className="h-3.5 w-3.5" />} label="部分" onClick={() => setVerdict('partial')} />
        <VerdictButton active={verdict === 'wrong'} icon={<X className="h-3.5 w-3.5" />} label="不准" onClick={() => setVerdict('wrong')} />
      </div>

      <div className="cognition-slider-row">
        <span>你的评分</span>
        <strong>{confidence}%</strong>
      </div>
      <input
        className="orbit-slider w-full cursor-pointer"
        type="range"
        min="0"
        max="100"
        step="5"
        value={confidence}
        onChange={(event) => setConfidence(Number(event.target.value))}
      />

      <textarea
        className="cognition-note-input"
        placeholder="补充你的修正，例如：这个判断只在学习数学时成立..."
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />

      <button
        className="cognition-submit-btn"
        disabled={disabled}
        onClick={() => onSubmit({
          dimensionKey: node.dimensionKey,
          nodeKey: node.id,
          nodeLabel: node.caption,
          verdict,
          confidence: confidence / 100,
          note,
        })}
      >
        保存置信度：{VERDICT_LABEL[verdict]}
      </button>

      {node.feedback && (
        <div className="cognition-last-feedback">
          最近校验：{VERDICT_LABEL[node.feedback.verdict]} / {Math.round(node.feedback.confidence * 100)}%
        </div>
      )}
    </div>
  )
}

function AddProfileClaim({
  dimensions,
  selectedDimensionKey,
  disabled,
  onSubmit,
}: {
  dimensions: DimensionView[]
  selectedDimensionKey?: string
  disabled: boolean
  onSubmit: (input: { dimensionKey: string; text: string }, done: () => void) => void
}) {
  const [open, setOpen] = useState(false)
  const [dimensionKey, setDimensionKey] = useState(selectedDimensionKey ?? dimensions[0]?.key ?? 'learningGoal')
  const [text, setText] = useState('')

  useEffect(() => {
    if (!open && selectedDimensionKey) setDimensionKey(selectedDimensionKey)
  }, [open, selectedDimensionKey])

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = text.trim()
    if (!trimmed) return
    onSubmit({ dimensionKey, text: trimmed }, () => {
      setText('')
      setOpen(false)
    })
  }

  return (
    <div className="cognition-add-profile">
      <button className="cognition-add-trigger" onClick={() => setOpen((value) => !value)}>
        <Plus className="h-3.5 w-3.5" />
        添加画像
      </button>
      {open && (
        <form className="cognition-add-popover" onSubmit={handleSubmit}>
          <label>
            放到哪个维度
            <select value={dimensionKey} onChange={(event) => setDimensionKey(event.target.value)}>
              {dimensions.map((dimension) => (
                <option key={dimension.key} value={dimension.key}>{dimension.label}</option>
              ))}
            </select>
          </label>
          <label>
            你的自述画像
            <textarea
              placeholder="例如：我更适合先看一个具体例子，再回到抽象定义。"
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          </label>
          <button disabled={disabled || !text.trim()} type="submit">
            写入证据
          </button>
        </form>
      )}
    </div>
  )
}

function BriefMetric({ label, value, detail }: { label: string; value: number; detail: string }) {
  return (
    <div className="cognition-brief-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  )
}

function VerdictButton({ active, icon, label, onClick }: { active: boolean; icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      className={`cognition-verdict-btn${active ? ' active' : ''}`}
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  )
}

function buildDimensions(data: CognitionData | null): ProfileDimensionInsight[] {
  if (data?.dimensionInsights?.length) return data.dimensionInsights
  return []
}

function buildProfileTree(data: CognitionData | null, dimensions: ProfileDimensionInsight[]): DimensionView[] {
  const claims = buildDimensionClaims(data)
  return dimensions.map((dimension, dimensionIndex) => {
    const tone = DIMENSION_TONES[dimensionIndex % DIMENSION_TONES.length]
    const templates = PROFILE_CLAIM_TEMPLATES[dimension.key] ?? []
    const nodes = templates.map((template, nodeIndex) => {
      const nodeId = `${dimension.key}:${template.key}`
      const feedback = dimension.nodeFeedback?.[nodeId]
      const directObservation = dimension.observations[nodeIndex]
      const sourceBoost = directObservation ? 0.08 : 0
      const feedbackShift = feedback?.verdict === 'correct' ? 0.1 : feedback?.verdict === 'partial' ? 0.02 : feedback?.verdict === 'wrong' ? -0.18 : 0
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
        importance: template.importance,
        freshness: feedback ? '已校验' : directObservation ? '有新证据' : '待观察',
        evidenceCount: dimension.observations.length + dimension.evidence.length,
        evidenceLabels: [template.caption, ...dimension.evidence].slice(0, 4),
        observations: directObservation ? [directObservation, ...dimension.observations.filter((item) => item !== directObservation)] : dimension.observations,
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
      goals[0] ? `你当前主要在推进「${goals[0]}」。` : '你的当前学习目标还不够稳定，需要继续确认真正想推进的主线。',
      domains.length ? `你的学习边界主要靠近「${domains.slice(0, 2).join(' / ')}」。` : '你的学习边界还比较松散，容易被临时问题带偏。',
      nextActions[0] ? `你下一步更需要「${nextActions[0]}」。` : '你的输出偏好还不稳定，暂时需要在理解、方案、卡片和练习之间确认。',
    ],
    currentFoundation: [
      mastered[0] ? `你已经可以把「${mastered.slice(0, 2).join('、')}」作为已知前提。` : '你的已知前提还不够清楚，暂时不能直接跳过基础确认。',
      weak[0] ? `你的薄弱点集中在「${weak.slice(0, 2).join('、')}」。` : '你的薄弱概念区域还没有稳定浮现。',
      missing[0] ? `你可能缺少这些前置：「${missing.slice(0, 2).join('、')}」。` : '你的前置缺口暂时不明显。',
    ],
    bestExplanationPath: [
      styles[0] ? `你更适合用「${styles.slice(0, 2).join('、')}」进入解释。` : '你的最佳讲法入口还不稳定，需要继续观察你更适合先例子、先框架还是先定义。',
      data?.teachingPolicy?.shouldSuggestWikiLinks ? '你需要用关系、图谱或概念连接来帮助理解。' : '你暂时适合简洁文字配合少量结构提示。',
      needsExamples ? '你需要先看到具体例子，再回到抽象定义。' : '你可以减少例子，更多使用框架和边界说明。',
    ],
    stuckPattern: [
      weak[0] ? `你反复卡住的地方可能来自「${weak[0]}」。` : '你的重复卡点还没有稳定显现。',
      isolated[0] ? `你存在孤立知识点，例如「${isolated[0].title}」。` : '你的孤立知识问题暂时不明显。',
      '你的部分画像还可能互相冲突，需要继续观察，而不能过早定型。',
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

function buildProfileStats(data: CognitionData | null, nodes: ProfileNode[]) {
  const evidenceCount = data?.profileLoop?.evidenceCount ?? nodes.reduce((sum, node) => sum + node.evidenceCount, 0)
  const verifiedCount = nodes.filter((node) => !!node.feedback).length
  const injectableCount = nodes.filter((node) => node.confidence >= 0.62 && node.feedback?.verdict !== 'wrong').length
  const pendingCount = nodes.filter((node) => node.confidence < 0.62 || node.feedback?.verdict === 'wrong').length
  const averageConfidence = nodes.length
    ? Math.round(nodes.reduce((sum, node) => sum + node.confidence, 0) / nodes.length * 100)
    : 0
  return {
    evidenceCount,
    verifiedCount,
    injectableCount,
    pendingCount,
    averageConfidence,
    nodeCount: nodes.length,
  }
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}
