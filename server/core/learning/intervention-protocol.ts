export interface InterventionProtocol {
  currentLearningObject: string
  observationFact: string
  currentJudgment: string
  judgmentBoundary: string
  primaryIntervention: string
  executionSteps: string[]
  forbiddenActions: string[]
  verificationTask: string
  passCriteria: string[]
  failureBranch: string
  stopCondition: string
  priority: number
}

export interface InterventionProtocolInput {
  dimensionKey: string
  dimensionLabel?: string
  subDimensionLabel?: string
  observableBehavior?: string
  mechanismHypothesis?: string
  competingHypotheses?: string[]
  teachingIntervention: string
  verificationCriterion: string
  confidence?: number
  protocol?: Partial<InterventionProtocol>
}

export function compileInterventionProtocol(input: InterventionProtocolInput): InterventionProtocol {
  const supplied = input.protocol ?? {}
  const label = input.subDimensionLabel || input.dimensionLabel || input.dimensionKey
  const boundary = input.competingHypotheses?.length
    ? `当前判断不等于“${input.competingHypotheses.slice(0, 3).join('”或“')}”；这些解释仍需用后续行为区分。`
    : '当前结论只适用于已有证据覆盖的学习任务，不外推为固定能力或人格标签。'
  const forbiddenActions = defaultForbiddenActions(input.dimensionKey)
  const executionSteps = [
    `先确认本轮只处理“${label}”，不同时展开新的学习目标。`,
    normalizeSentence(input.teachingIntervention),
    `干预后立即执行验证任务：${normalizeSentence(input.verificationCriterion)}`,
    '根据用户可观察表现记录结果；未达到标准时进入失败分支，不直接宣布掌握。',
  ]
  return {
    currentLearningObject: supplied.currentLearningObject?.trim() || label,
    observationFact: supplied.observationFact?.trim() || input.observableBehavior?.trim() || '当前只有画像观察，需在本轮继续收集可观察行为。',
    currentJudgment: supplied.currentJudgment?.trim() || input.mechanismHypothesis?.trim() || '现有证据支持调整教学，但不足以形成固定结论。',
    judgmentBoundary: supplied.judgmentBoundary?.trim() || boundary,
    primaryIntervention: supplied.primaryIntervention?.trim() || normalizeSentence(input.teachingIntervention),
    executionSteps: normalizeList(supplied.executionSteps, executionSteps, 6),
    forbiddenActions: normalizeList(supplied.forbiddenActions, forbiddenActions, 6),
    verificationTask: supplied.verificationTask?.trim() || normalizeSentence(input.verificationCriterion),
    passCriteria: normalizeList(supplied.passCriteria, [normalizeSentence(input.verificationCriterion)], 5),
    failureBranch: supplied.failureBranch?.trim() || defaultFailureBranch(input.dimensionKey),
    stopCondition: supplied.stopCondition?.trim() || '达到通过标准并在一个变式或正式评估中保持后，停止当前干预，进入下一学习节点。',
    priority: clampPriority(supplied.priority ?? Math.round((input.confidence ?? 0.5) * 100)),
  }
}

export function formatInterventionProtocol(protocol: InterventionProtocol): string {
  return [
    `【当前学习对象】${protocol.currentLearningObject}`,
    `【观察事实】${protocol.observationFact}`,
    `【当前判断】${protocol.currentJudgment}`,
    `【判断边界】${protocol.judgmentBoundary}`,
    `【唯一主干预】${protocol.primaryIntervention}`,
    `【执行顺序】\n${protocol.executionSteps.map((step, index) => `${index + 1}. ${step}`).join('\n')}`,
    `【禁止事项】\n${protocol.forbiddenActions.map((item) => `- ${item}`).join('\n')}`,
    `【验证任务】${protocol.verificationTask}`,
    `【通过标准】\n${protocol.passCriteria.map((item) => `- ${item}`).join('\n')}`,
    `【失败分支】${protocol.failureBranch}`,
    `【停止条件】${protocol.stopCondition}`,
  ].join('\n')
}

export function isInterventionProtocolComplete(protocol: InterventionProtocol): boolean {
  return Boolean(
    protocol.currentLearningObject.trim() &&
    protocol.observationFact.trim() &&
    protocol.currentJudgment.trim() &&
    protocol.judgmentBoundary.trim() &&
    protocol.primaryIntervention.trim() &&
    protocol.executionSteps.length >= 3 &&
    protocol.forbiddenActions.length >= 2 &&
    protocol.verificationTask.trim() &&
    protocol.passCriteria.length >= 1 &&
    protocol.failureBranch.trim() &&
    protocol.stopCondition.trim(),
  )
}

function defaultForbiddenActions(dimensionKey: string): string[] {
  const shared = ['不要机械复述画像标签或向用户宣布系统已经看透其能力。', '不要在没有验证结果时标记掌握或提高画像置信度。']
  if (dimensionKey === 'paceAndLoad') return [...shared, '不要把局部因果缺口泛化成全局慢讲。', '不要同时打开多个尚未闭合的新节点。']
  if (dimensionKey === 'stuckPattern') return [...shared, '不要把一次错误解释为人格、智力或动机问题。', '不要绕过当前关键前提继续堆叠新内容。']
  if (dimensionKey === 'currentFoundation') return [...shared, '不要重复讲已经有稳定证据支持的基础内容。', '不要把助手刚讲过的内容视为用户已经掌握。']
  if (dimensionKey === 'masteryCheck') return [...shared, '不要用“懂了吗”或复述原定义作为唯一验收。', '不要跳过陌生变式或反例边界。']
  if (dimensionKey === 'bestExplanationPath') return [...shared, '不要一次堆叠多种媒介和完整项目细节。', '不要在用户尚未作答前直接给出验证任务答案。']
  return [...shared, '不要扩展到与当前目标无关的内容。', '不要用通用建议替代具体学习动作。']
}

function defaultFailureBranch(dimensionKey: string): string {
  if (dimensionKey === 'paceAndLoad') return '若用户仍跟不上，减少一个并行概念并缩短因果跨度；若表现稳定，则恢复正常速度。'
  if (dimensionKey === 'stuckPattern') return '若仍失败，回到最近一个可验证前提，改用单变量反例区分竞争解释。'
  if (dimensionKey === 'currentFoundation') return '若验证失败，将该能力降为待复测并补一个最小前置任务；不要重讲整章。'
  if (dimensionKey === 'masteryCheck') return '若未通过，记录缺失的具体证据，安排针对性练习后再次使用陌生变式验证。'
  if (dimensionKey === 'bestExplanationPath') return '若当前媒介无效，保留同一学习目标，只切换一种表达媒介并再次验证。'
  return '若未达到标准，缩小任务范围、收集新的行为证据并调整主干预；不要继续原方案或直接推进。'
}

function normalizeList(value: string[] | undefined, fallback: string[], max: number): string[] {
  const normalized = (Array.isArray(value) ? value : fallback)
    .map((item) => typeof item === 'string' ? normalizeSentence(item) : '')
    .filter(Boolean)
  return [...new Set(normalized)].slice(0, max)
}

function normalizeSentence(value: string): string {
  return value.replace(/\s+/g, ' ').trim().replace(/[。；;]+$/u, '') + '。'
}

function clampPriority(value: number): number {
  return Math.max(1, Math.min(100, Math.round(Number.isFinite(value) ? value : 50)))
}
