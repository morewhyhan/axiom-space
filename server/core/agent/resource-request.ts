import {
  DEFAULT_RESOURCE_PLAN,
  RESOURCE_KINDS,
  targetsForResourcePlan,
  type ResourceFormat,
  type ResourceKind,
  type ResourcePlanItem,
  type ResourceType,
} from './ResourceGenerationState'

const ALL_PATTERN = /(?:全部|全套|所有(?:格式|类型|资源)?|完整资源包|一整套|all\s+(?:resources|formats))/i

function add(plan: Map<ResourceKind, Set<ResourceFormat>>, kind: ResourceKind, ...formats: ResourceFormat[]) {
  const current = plan.get(kind) ?? new Set<ResourceFormat>()
  formats.forEach((format) => current.add(format))
  plan.set(kind, current)
}

export function parseResourcePlan(message: string): ResourcePlanItem[] {
  const text = message.trim()
  if (!text) return []
  if (ALL_PATTERN.test(text)) return DEFAULT_RESOURCE_PLAN.map((item) => ({ ...item, formats: [...item.formats] }))

  const plan = new Map<ResourceKind, Set<ResourceFormat>>()
  const wantsDocx = /(?:docx|\bdocs?\b|word\s*文档|word文件|word)/i.test(text)
  const wantsPdf = /\bpdf\b/i.test(text)
  const wantsPpt = /(?:pptx|ppt|powerpoint|演示文稿|幻灯片)/i.test(text)
  const wantsMarkdownDocument = /(?:讲解文档|学习文档|markdown|\bmd\b|document|文章|讲义)/i.test(text)
    || (/(?:文档)/i.test(text) && !wantsDocx)
  if (wantsMarkdownDocument || wantsDocx || wantsPdf || wantsPpt) {
    const formats: ResourceFormat[] = []
    if (wantsMarkdownDocument || (!wantsDocx && !wantsPdf && !wantsPpt)) formats.push('markdown')
    if (wantsDocx) formats.push('docx')
    if (wantsPdf) formats.push('pdf')
    if (wantsPpt) formats.push('pptx')
    add(plan, 'explanation', ...formats)
  }
  if (/(?:思维导图|知识导图|脑图|mind\s*map|mindmap)/i.test(text)) add(plan, 'mindmap', 'mermaid')
  if (/(?:练习题|题库|题目|测验|试题|quiz|exam)/i.test(text)) add(plan, 'quiz', 'json')
  if (/(?:代码练习|代码实操|编程练习|实操案例|代码案例|code)/i.test(text)) add(plan, 'code-practice', 'markdown')
  const wantsSvg = /(?:svg|矢量图|矢量图片|插图)/i.test(text)
  const wantsMermaidDiagram = /(?:mermaid|流程图|时序图|类图|关系图|图表|diagram)/i.test(text)
  if (wantsSvg || wantsMermaidDiagram) {
    add(plan, 'diagram', ...(wantsMermaidDiagram ? ['mermaid' as const] : []), ...(wantsSvg ? ['svg' as const] : []))
  }
  if (/(?:教学视频|讲解视频|交互式动画|视频|动画|video)/i.test(text)) add(plan, 'video', 'html', 'mp4')

  return RESOURCE_KINDS.flatMap((kind) => {
    const formats = plan.get(kind)
    return formats?.size ? [{ kind, formats: [...formats] }] : []
  })
}

/** Internal compatibility adapter for the existing format renderers. */
export function parseRequestedResourceTypes(message: string): ResourceType[] {
  return targetsForResourcePlan(parseResourcePlan(message))
}

export function isResourceGenerationRequest(message: string): boolean {
  const text = message.trim()
  if (!text) return false
  const resourceNoun = /(?:学习资源|学习资料|资料包|资源包|多模态资料|资源)/i.test(text)
  const generationVerb = /(?:生成|整理|制作|创建|产出|准备|推送|补充|画|做|导出|给我|帮我)/i.test(text)
  return generationVerb && (parseResourcePlan(text).length > 0 || resourceNoun)
}
