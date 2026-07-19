import { LEARNING_SYSTEM_DIMENSIONS } from './learning-system-profile'

export const PROFILE_DIMENSION_PROTOCOL = [
  {
    key: 'learningGoal',
    label: '愿景与动力',
    purpose: '了解用户想成为怎样的人、为什么愿意投入、什么结果值得持续付出，以及多个目标之间会怎样取舍。',
    initialScope: '首次画像只问清一个主要目标或场景，不追问完整规划。',
    extractionTargets: ['主要目标', '使用场景', '目标产物', '范围边界', '当前优先级'],
    triggerSources: ['用户明确说想学什么或为什么学', '学习路径创建或调整', '反复回到同一主题', '用户要求某种产出'],
    normalUsageSignals: ['我要学/复习/搞懂某主题', '这次先讲某范围', '我想做出某个笔记、卡片、资源或项目成果', '用户多轮持续回到同一学习主题'],
    doNotExtract: ['用户只是顺手提到一个名词', '助手主动建议目标但用户没有接受', '用户在反馈产品问题而不是表达学习目标'],
    teachingImpact: '把长期愿景转成当前可执行目标，决定优先级、任务意义和无关内容的收束。',
  },
  {
    key: 'currentFoundation',
    label: '我现在在哪',
    purpose: '了解用户怎样判断自己学到了什么、这种判断是否可靠、哪里仍然没把握。具体知识点留在知识图谱中。',
    initialScope: '首次画像只问用户自述基础，不把自述当作稳定掌握证据。',
    extractionTargets: ['已掌握概念', '半懂概念', '缺失前置', '稳定误解', '可跳过内容', '需要校验的基础'],
    triggerSources: ['用户解释某个概念', '练习或测验结果', '用户说自己会/不会', '卡片内容体现理解边界', 'AI 追问后的回答'],
    normalUsageSignals: ['用户用自己的话解释概念', '用户说这个会/不会/半懂', '用户做题或测评体现前置缺口', '卡片打磨时暴露理解边界'],
    doNotExtract: ['用户只是复制材料原文', '助手刚讲过但用户没有复述或应用', '用户礼貌性说懂了但没有任何验证证据'],
    teachingImpact: '决定从哪里开始讲、哪些基础只需简单确认，以及哪里需要先补上一小步。',
  },
  {
    key: 'bestExplanationPath',
    label: '怎样更容易理解',
    purpose: '了解用户用什么顺序和表达方式更容易真正理解、记住并重新讲出来。',
    initialScope: '首次画像只问一个偏好的讲解入口，后续再由真实反馈修正。',
    extractionTargets: ['例子先行', '图解/流程', '代码/案例', '类比', '反例', '定义/公式', '先整体后局部', '表达格式偏好'],
    triggerSources: ['用户要求举例、画图、写代码、换说法', '用户反馈太抽象或太啰嗦', '某种解释后用户明显能继续推进', '资源生成偏好'],
    normalUsageSignals: ['用户要求举例、画图、代码、类比、反例或换说法', '用户明确反馈某种讲法太抽象/太啰嗦/更好懂', '用户选择或反复生成某类资源'],
    doNotExtract: ['单次偶然要求一个例子但后续没有偏好证据', '助手用了某种讲法但用户没有反馈效果', '与学习理解无关的格式偏好'],
    teachingImpact: '决定先用例子、图解、代码、反例还是定义，以及一次讲多少最合适。',
  },
  {
    key: 'stuckPattern',
    label: '为什么会卡住',
    purpose: '找到用户反复卡住的真实原因和触发条件，而不是罗列不会的知识点。',
    initialScope: '首次画像只收集自述常见卡点，不写成稳定缺陷。',
    extractionTargets: ['术语卡点', '抽象跳跃', '前置断点', '概念混淆', '步骤断裂', '迁移失败', '表达困难', '记忆不稳'],
    triggerSources: ['用户反复说没懂或卡住', '同类题反复错', '概念解释出现混淆', '用户无法迁移到新场景', '卡片讨论中多次越过边界'],
    normalUsageSignals: ['用户明确说卡住、没懂、混了', '同类题或同类概念多次出错', '用户解释时混淆两个概念边界', '能听懂定义但无法迁移到新场景'],
    doNotExtract: ['用户第一次问某个问题', '用户为了确认而提问但没有失败证据', '外部材料本身复杂但用户没有表现出卡点'],
    teachingImpact: '决定先解决哪一个卡点、在哪里停下来确认，以及什么时候换成对比或反例。',
  },
  {
    key: 'paceAndLoad',
    label: '怎样更容易行动',
    purpose: '了解什么会让用户迟迟不开始、任务拆到多小才容易行动，以及什么节奏能持续。',
    initialScope: '首次画像只问用户自述节奏偏好，不把它当成固定负荷上限。',
    extractionTargets: ['信息块大小', '推进速度', '确认频率', '术语密度', '是否一问一答', '当前负荷状态'],
    triggerSources: ['用户要求短一点/详细一点/一步一步', '用户中断或跳过解释', '用户连续完成或频繁停顿', '路径推进速度和资源使用情况'],
    normalUsageSignals: ['用户要求短一点、详细一点、慢一点、快一点、一步一步', '用户频繁打断或要求直接结论', '用户连续完成小任务或长时间停顿'],
    doNotExtract: ['用户单次说继续/下一步但没有节奏偏好', '因为系统卡顿导致的中断', '用户在讨论产品体验而不是学习负荷'],
    teachingImpact: '决定任务大小、提醒力度、同时推进几件事和多久反馈一次，避免一下子压得太满。',
  },
  {
    key: 'masteryCheck',
    label: '怎样确认有效',
    purpose: '了解怎样才算真的有效、没效果时怎么换方法、什么时候可以停止帮助，并避免把熟悉感当成真正会用。',
    initialScope: '首次画像只问用户认可的掌握方式，真实掌握仍以后续任务验证。',
    extractionTargets: ['复述', '做题', '改错', '迁移应用', '写卡片', '项目产出', '通过标准', '复习触发条件'],
    triggerSources: ['测验结果', '用户复述或解释', '用户做题/改错/迁移表现', '永久卡沉淀', '用户说明想如何验收'],
    normalUsageSignals: ['用户说明怎样才算学会', '用户完成复述、做题、改错或迁移任务', '用户把理解沉淀成卡片或通过永久卡审核', '用户要求用某种方式验收'],
    doNotExtract: ['助手说可以测验但用户没有执行', '用户听完解释但没有输出证据', '只创建了草稿卡但没有体现掌握标准'],
    teachingImpact: '决定用什么表现确认有效、失败后怎样调整、什么时候可以继续往前，而不是只记录做过什么。',
  },
] as const

export type ProfileDimensionKey = (typeof PROFILE_DIMENSION_PROTOCOL)[number]['key']

export const PROFILE_REVISION_RULES = [
  '新证据支持旧判断：提高置信度，但仍保留证据来源。',
  '新证据和旧判断冲突：降低旧判断权重，标记为需要重新确认，不能强行合并。',
  '用户明确否认：该判断不得作为确定教学规则注入，只能用于后续重新收集证据。',
  '用户部分认可：改写为条件策略，例如“当用户要求快速推进时才减少解释”。',
  '长时间没有新证据：自然降权，优先相信近期学习行为。',
  '多次独立证据一致：升级为稳定画像，可影响下一轮教学策略。',
]

export function formatProfileDimensionExtractionProtocol(mode: 'initial' | 'runtime' = 'runtime'): string {
  return PROFILE_DIMENSION_PROTOCOL.map((item) => [
    `- ${item.key} / ${item.label}: ${item.purpose}`,
    mode === 'initial' ? `  首次画像边界: ${item.initialScope}` : `  可提取子项: ${item.extractionTargets.join('、')}`,
    mode === 'runtime' ? `  可能来源: ${item.triggerSources.join('、')}` : '',
    mode === 'runtime' ? `  正常使用触发信号: ${item.normalUsageSignals.join('、')}` : '',
    mode === 'runtime' ? `  不应提取: ${item.doNotExtract.join('、')}` : '',
    mode === 'runtime' ? `  动态小维度候选: ${LEARNING_SYSTEM_DIMENSIONS.find((dimension) => dimension.key === item.key)?.subDimensions.join('、') || ''}` : '',
    `  教学影响: ${item.teachingImpact}`,
  ].filter(Boolean).join('\n')).join('\n')
}

export function formatSingleProfileDimensionExtractionGuide(key: string, mode: 'initial' | 'runtime' = 'runtime'): string {
  const item = PROFILE_DIMENSION_PROTOCOL.find((dimension) => dimension.key === key)
  if (!item) return formatProfileDimensionExtractionProtocol(mode)
  return [
    `${item.key} / ${item.label}: ${item.purpose}`,
    mode === 'initial' ? `首次画像边界: ${item.initialScope}` : `可提取子项: ${item.extractionTargets.join('、')}`,
    mode === 'runtime' ? `可能来源: ${item.triggerSources.join('、')}` : '',
    mode === 'runtime' ? `正常使用触发信号: ${item.normalUsageSignals.join('、')}` : '',
    mode === 'runtime' ? `不应提取: ${item.doNotExtract.join('、')}` : '',
    mode === 'runtime' ? `动态小维度候选: ${LEARNING_SYSTEM_DIMENSIONS.find((dimension) => dimension.key === item.key)?.subDimensions.join('、') || ''}` : '',
    `教学影响: ${item.teachingImpact}`,
  ].filter(Boolean).join('\n')
}

export function formatProfileRevisionRules(): string {
  return PROFILE_REVISION_RULES.map((rule) => `- ${rule}`).join('\n')
}

export function getProfileDimensionTeachingImpact(key: string): string {
  return PROFILE_DIMENSION_PROTOCOL.find((dimension) => dimension.key === key)?.teachingImpact
    ?? '下一轮教学只能在证据支持时使用这条画像。'
}
