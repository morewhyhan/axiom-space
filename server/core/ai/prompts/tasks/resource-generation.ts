import { definePrompt, type PromptContract, type PromptOutputMode } from '../types';
import {
  AXIOM_KNOWLEDGE_STANDARD,
  JSON_OUTPUT_STANDARD,
  buildSystemPrompt,
} from '../standards';

export type ResourceGenerationType =
  | 'document'
  | 'mindmap'
  | 'quiz'
  | 'code'
  | 'video'
  | 'svg'
  | 'diagram'
  | 'docx'
  | 'pdf'
  | 'ppt';

export interface ResourceGenerationInput {
  topic: string;
  userLevel: string;
  literatureContent?: string;
  ragContext?: string;
  ragReferences?: string[];
  profileContext?: string;
  profileEvidence?: {
    remainingGaps?: string[];
    resourcePreference?: string[];
    recentEvidence?: string[];
    masteredConcepts?: string[];
    teachingFocus?: string;
  };
}

interface ResourcePromptSpec {
  type: ResourceGenerationType;
  name: string;
  role: string;
  outputMode: PromptOutputMode;
  output: string[];
  process: string[];
  correct: string[];
  incorrect: string[];
  extraStandards?: string[];
}

const buildUserMessage = (input: ResourceGenerationInput) => [
  `学习主题：${input.topic}`,
  `用户水平：${input.userLevel}`,
  input.literatureContent
    ? `参考文献内容：\n${input.literatureContent.slice(0, 4000)}`
    : '参考文献内容：无',
  input.ragContext
    ? input.ragContext
    : 'LightRAG 检索上下文：无。只能基于用户提供资料和通用必要解释生成，不能伪造当前知识库依据。',
  input.ragReferences?.length
    ? `RAG 引用：\n${input.ragReferences.map((item) => `- ${item}`).join('\n')}`
    : '',
  input.profileContext
    ? `画像上下文：\n${input.profileContext.slice(0, 3000)}`
    : '画像上下文：无。',
  input.profileEvidence
    ? [
      '画像驱动依据：',
      input.profileEvidence.remainingGaps?.length ? `- 剩余缺口：${input.profileEvidence.remainingGaps.join('、')}` : '',
      input.profileEvidence.resourcePreference?.length ? `- 资源偏好：${input.profileEvidence.resourcePreference.join('、')}` : '',
      input.profileEvidence.masteredConcepts?.length ? `- 已掌握概念：${input.profileEvidence.masteredConcepts.join('、')}` : '',
      input.profileEvidence.teachingFocus ? `- 教学重点：${input.profileEvidence.teachingFocus}` : '',
      input.profileEvidence.recentEvidence?.length ? `- 近期证据：\n${input.profileEvidence.recentEvidence.map((item) => `  - ${item}`).join('\n')}` : '',
    ].filter(Boolean).join('\n')
    : '',
].join('\n\n');

function createResourcePrompt(spec: ResourcePromptSpec): PromptContract<ResourceGenerationInput> {
  const contract = {
    id: `resource.generation.${spec.type}`,
    version: '2026-06-17',
    name: spec.name,
    purpose: `Generate ${spec.type} learning resources from a topic and optional literature content.`,
    whenToUse: [
      'A user or workflow requests this resource type for a learning topic.',
    ],
    whenNotToUse: [
      'Do not use to create concept graph nodes or permanent cards.',
      'Do not use when the requested topic is unrelated to the current learning context unless the caller explicitly allows it.',
    ],
    input: [
      'topic: 学习资源围绕的概念、课程或任务。',
      'userLevel: 用户当前水平，用来控制解释深度。',
      'literatureContent: 可选参考资料；有资料时必须优先依据资料。',
      'ragContext/ragReferences: 可选当前知识库检索上下文；有检索结果时必须优先使用。',
      'profileContext/profileEvidence: 可选学习画像；有画像时必须说明资源解决哪个剩余缺口，并按资源偏好组织形式。',
    ],
    process: [
      '先确定资源要解决的学习任务，不要泛泛介绍主题。',
      '只保留对用户学习有必要的内容；删掉空泛背景、口号和重复段落。',
      '区分资料明确给出的内容、通用知识和必要解释，不把猜测写成事实。',
      '有 LightRAG 检索上下文时，优先依据当前知识库内容生成；如果检索上下文不足，只输出待补说明或练习入口，不写成确定知识结论。',
      '有画像上下文时，必须围绕画像里的剩余缺口、资源偏好和教学重点生成，不能把画像当成装饰性文字。',
      '生成结果必须满足清晰、准确、必要、可追溯、可执行。',
      ...spec.process,
    ],
    output: spec.output,
    correct: spec.correct,
    incorrect: [
      '没有使用输入主题，或生成了与主题无关的内容。',
      '输出格式不符合指定格式，导致后续解析、渲染或保存失败。',
      '内容只有标题和空话，不能支持用户学习或练习。',
      '有画像输入却看不出资源解决了哪个缺口，或生成形式违背用户资源偏好。',
      ...spec.incorrect,
    ],
  };

  return definePrompt<ResourceGenerationInput>({
    ...contract,
    outputMode: spec.outputMode,
    system: buildSystemPrompt({
      role: spec.role,
      standards: [
        AXIOM_KNOWLEDGE_STANDARD,
        ...(spec.extraStandards ?? []),
      ],
      contract,
    }),
    buildUserMessage,
  });
}

export const RESOURCE_GENERATION_PROMPTS: Record<ResourceGenerationType, PromptContract<ResourceGenerationInput>> = {
  document: createResourcePrompt({
    type: 'document',
    name: '学习文档生成',
    role: '你是 AXIOM 课程文档生成专家，负责把主题或资料整理成可阅读的学习文档。',
    outputMode: 'markdown',
    process: [
      '按“概述 → 核心概念 → 进阶理解 → 总结”的顺序组织内容。',
      '每个核心概念都要有定义、必要解释和它与主题的关系。',
    ],
    output: [
      '输出纯 Markdown 文档，不要前言。',
      '总字数不少于 800 字。',
      '必须包含章节：## 概述、## 核心概念、## 进阶理解、## 总结。',
      '代码用 fenced code block，术语可用 **粗体** 强调。',
    ],
    correct: [
      '章节齐全，概念解释具体，用户能直接阅读学习。',
      '内容由主题和资料推出，没有无关扩写。',
    ],
    incorrect: [
      '少于 800 字，或缺少主要章节。',
      '只列提纲，没有实质解释。',
    ],
  }),

  mindmap: createResourcePrompt({
    type: 'mindmap',
    name: '思维导图生成',
    role: '你是 AXIOM 思维导图生成专家，负责把学习主题压缩成可渲染的 Mermaid mindmap。',
    outputMode: 'markdown',
    process: [
      '根节点必须是学习主题。',
      '一级分支只放必要的结构维度，叶子节点放清楚的子概念。',
    ],
    output: [
      '输出纯 Mermaid mindmap 代码块，以 ```mermaid 开头。',
      '根节点使用 root((主题))。',
      '至少 4 个一级分支，每个分支至少 3 个叶子节点。',
      '节点文本不要使用 [] 方括号，不要使用 &、/、<、> 等特殊符号。',
    ],
    correct: [
      '导图能显示主题的必要结构层次。',
      '节点短而明确，能被 Mermaid 渲染。',
    ],
    incorrect: [
      '输出普通列表而不是 Mermaid mindmap。',
      '节点过长、含特殊符号或结构层级混乱。',
    ],
  }),

  quiz: createResourcePrompt({
    type: 'quiz',
    name: '练习题库生成',
    role: '你是 AXIOM 练习题库生成专家，负责生成可自动解析的学习测验。',
    outputMode: 'json',
    extraStandards: [JSON_OUTPUT_STANDARD],
    process: [
      '题目必须覆盖基础概念理解和进阶应用分析。',
      '每道题只考一个明确知识点，解释必须说明正确答案为什么成立。',
    ],
    output: [
      '只输出严格 JSON 数组，不要 Markdown，不要解释性前言。',
      '至少 5 道题：基础概念 3 题，进阶应用 2 题。',
      '每题包含 type、question、options、answer、explanation。',
      '每题只能有一个正确答案，answer 必须对应 options 里的选项编号。',
    ],
    correct: [
      'JSON 可直接解析。',
      '题目不重复，选项互斥，解释能证明答案。',
    ],
    incorrect: [
      '输出 JSON 外文字或代码块。',
      '多个正确答案、重复选项、解释与答案不一致。',
    ],
  }),

  code: createResourcePrompt({
    type: 'code',
    name: '代码实操资源生成',
    role: '你是 AXIOM 代码实操资源生成专家，负责生成用户能直接动手完成的练习。',
    outputMode: 'markdown',
    process: [
      '先确定练习目标，再给初始代码和明确任务。',
      '选择 TypeScript、Python 或伪代码中最贴近主题的一种。',
    ],
    output: [
      '输出纯 Markdown，不要前言。',
      '必须包含章节：## 练习目标、## 初始代码、## 任务要求、## 测试样例、## 参考实现、## 讲解。',
      '至少包含 2 个 fenced code block。',
    ],
    correct: [
      '用户能根据初始代码、任务要求和测试样例完成练习。',
      '参考实现与讲解对应同一个任务。',
    ],
    incorrect: [
      '只解释概念，没有可操作代码。',
      '代码块不足，或任务要求无法验证。',
    ],
  }),

  video: createResourcePrompt({
    type: 'video',
    name: '教学视频/动画生成',
    role: '你是 AXIOM 教学视频与动画生成专家，负责生成可渲染的教学动画场景配置。',
    outputMode: 'json',
    extraStandards: [JSON_OUTPUT_STANDARD],
    process: [
      '用 4 到 6 个场景表达一个清晰学习过程。',
      '每个场景只承载一个主要教学意图。',
    ],
    output: [
      '用 ```json 代码块包裹严格 JSON。',
      'JSON 顶层包含 scenes、width、height、fps。',
      'scenes 为 4 到 6 个场景，每个场景包含 id、duration、backgroundColor、elements。',
      '每个场景包含 2 到 5 个 text/code/shape 元素。',
      '总时长控制在 30 到 90 秒。',
    ],
    correct: [
      'JSON 能被解析并渲染。',
      '场景顺序表达清楚的教学推进。',
    ],
    incorrect: [
      '缺少 scenes、width、height 或 fps。',
      '场景过少、元素过少或内容无法教学。',
    ],
  }),

  svg: createResourcePrompt({
    type: 'svg',
    name: 'SVG 图解生成',
    role: '你是 SVG 图解专家，负责生成可以直接预览的结构图。',
    outputMode: 'markdown',
    process: [
      '选择能表达主题结构、流程或关系的图形布局。',
      '所有文字标签使用中文，专有名词可保留英文。',
    ],
    output: [
      '输出 ```svg 代码块。',
      '必须包含完整 <svg> 标签和 xmlns。',
      '使用 800x600 viewBox。',
      '至少包含 6 个图形或文字元素，如 rect、circle、text、line。',
    ],
    correct: [
      'SVG 可直接渲染。',
      '图形关系和中文标签能解释主题结构。',
    ],
    incorrect: [
      '缺少 <svg> 或 </svg>。',
      '只有装饰图形，没有概念关系。',
    ],
  }),

  diagram: createResourcePrompt({
    type: 'diagram',
    name: 'Mermaid 图表生成',
    role: '你是 AXIOM Mermaid 图表生成专家，负责选择最适合主题的 Mermaid 图表。',
    outputMode: 'markdown',
    process: [
      '根据主题选择 flowchart、sequenceDiagram、classDiagram、pie、stateDiagram 或 gantt。',
      '用节点和边表达必要关系，不做无意义连接。',
    ],
    output: [
      '输出纯 Mermaid 代码块，以 ```mermaid 开头。',
      '至少 6 个节点，结构完整。',
    ],
    correct: [
      '图表类型适合主题。',
      '节点和连线表达明确关系，能被 Mermaid 渲染。',
    ],
    incorrect: [
      '图表类型与主题不匹配。',
      '节点不足，或连线只是关键词相关。',
    ],
  }),

  docx: createResourcePrompt({
    type: 'docx',
    name: 'Word 文档 HTML 生成',
    role: '你是 AXIOM Word 文档生成专家，负责生成可转换为 Word 的结构化 HTML。',
    outputMode: 'text',
    process: [
      '先组织章节，再写段落、列表、代码或表格。',
      '内容要适合在 Word 中阅读和打印。',
    ],
    output: [
      '输出纯 HTML body 内容，不要 <html>、<head>、<body> 包裹。',
      '总字数不少于 800 字。',
      '用 h1/h2/h3 表示章节层级，p 表示段落，ul/li 表示列表。',
      '代码用 pre/code，表格用 table。',
    ],
    correct: [
      'HTML 可直接转换成 Word。',
      '章节完整，内容具体。',
    ],
    incorrect: [
      '输出 Markdown 或完整网页外壳。',
      '标题过少，内容不足。',
    ],
  }),

  pdf: createResourcePrompt({
    type: 'pdf',
    name: 'PDF 文档 HTML 生成',
    role: '你是 AXIOM PDF 文档生成专家，负责生成适合打印的结构化 HTML。',
    outputMode: 'text',
    process: [
      '优先生成适合 A4 阅读的章节、列表和表格。',
      '避免过长单段和无法打印的复杂样式。',
    ],
    output: [
      '输出纯 HTML body 内容，不要 <html>、<head>、<body> 包裹。',
      '总字数不少于 800 字。',
      '用 h1/h2/h3 表示章节层级，p 表示段落，ul/li 表示列表。',
      '代码用 pre/code，表格用 table。',
    ],
    correct: [
      'HTML 可直接转换成 PDF。',
      '结构适合 A4 打印和阅读。',
    ],
    incorrect: [
      '输出 Markdown 或完整网页外壳。',
      '排版只适合屏幕，不适合打印。',
    ],
  }),

  ppt: createResourcePrompt({
    type: 'ppt',
    name: 'PPT 内容生成（McKinsey 模板）',
    role: '你是 AXIOM 演示文稿生成专家，负责生成结构化的幻灯片规格 JSON，由 McKinsey 风格 PPT 引擎渲染为专业演示文稿。',
    outputMode: 'json',
    process: [
      '把主题拆成：封面、背景与动机、核心概念（1-2页）、关键关系或对比、实例或应用、总结与要点回顾。',
      '每页只表达一个主点。',
      '选择最匹配内容的 slide type。',
    ],
    output: [
      '输出严格 JSON 数组，每个元素是一个 slide spec 对象。',
      '至少 6 页，包括 cover 和 summary。',
      '可用 slide type 及必填字段：',
      '',
      'cover_slide: { "type": "cover_slide", "title": "演示标题", "subtitle": "副标题或日期" }',
      'executive_summary_paragraph: { "type": "executive_summary_paragraph", "title": "概述", "paragraphs": ["段落1...", "段落2..."] }',
      'executive_summary_takeaways: { "type": "executive_summary_takeaways", "title": "要点", "sections": [{"takeaway": "关键结论", "bullets": ["支撑点1", "支撑点2"]}], "final_conclusion": "最终总结" }',
      'two_column_compare: { "type": "two_column_compare", "title": "对比", "left_header": "A", "right_header": "B", "rows": [{"label": "维度", "left": "A特征", "right": "B特征"}] }',
      'process_flow: { "type": "process_flow", "title": "流程", "steps": [{"label": "步骤1", "description": "说明"}] }',
      'phases_chevron_3: { "type": "phases_chevron_3", "title": "三阶段", "phases": [{"title": "阶段1", "description": "说明"}, ...] }',
      'dark_navy_summary: { "type": "dark_navy_summary", "title": "总结", "key_points": ["要点1", "要点2"], "next_steps": "下一步建议" }',
      'big_number: { "type": "big_number", "number": "85%", "label": "关键指标说明" }',
      'funnel: { "type": "funnel", "title": "漏斗/筛选", "steps": [{"label": "层1", "value": "100%"}, ...] }',
      'section_divider: { "type": "section_divider", "title": "章节标题" }',
      '',
      'section_marker 字段可选，用于页眉标注。',
    ],
    correct: [
      'slide type 和内容匹配（概念用 structure，对比用 comparison，流程用 process_flow）。',
      '每个 spec 包含正确的必填字段。',
      'JSON 合法，可直接解析。',
    ],
    incorrect: [
      '输出 HTML 或 Markdown。',
      '虚构 slide type。',
      'JSON 格式错误或缺少必填字段。',
    ],
  }),
};
