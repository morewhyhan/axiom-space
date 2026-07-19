import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { A3_STORY } from '../../local-tests/a3-golden-video-card/story.js'

const root = process.cwd()
const outputPath = path.resolve(
  root,
  'docs/03-宣传资料/AXIOM-Space-A3黄金案例-V12-八幕整合版逐页稿.md',
)

const lines = [
  '# AXIOM Space A3 黄金案例 V12｜八幕整合版逐页稿',
  '',
  '> 本稿是 HTML 上屏文字与自然旁白的共同真源。全稿从 13 组压缩为 8 组：A 页回答一个观众问题，B 页只展示与该问题直接对应的产品动作和结果。',
  '',
  '## 产品语义合同',
  '',
  '- 产品：面向高校学习场景的 AI 掌握学习系统。',
  '- 通用 Agent 的完成标准：答案或任务已经交付。',
  '- AXIOM 的完成标准：学生能用自己的话讲清，并独立处理变化后的新问题。',
  '- 核心闭环：暴露缺口 → 改变教学 → 召回旧知 → 形成知识 → 补充资源 → 独立验证 → 改变下一步 → 长期延续。',
  '- Agent 分工：Agent1 前台教学；Agent2 后台取证、更新六维画像并反馈路径。',
  '- 卡片颜色：文献卡粉色、灵感卡青色、永久卡紫色；永久卡不等于能力已经 mastered。',
  '- 记忆架构：Postgres / Prisma 事实源 → Qdrant 快速语义召回 → LightRAG 后台图谱增强。',
  '- 评估结构：知识质量与能力掌握分开；陌生迁移通过后，证据必须继续改变路径。',
  '- A/B 页面合同：A 页只回答一个问题；B 页只展示一个“用户动作 → 系统动作 → 可见结果”。',
  '- 当前完成：核心产品机制可运行、可检查。',
  '- 诚实边界：真实学习效果、长期留存和高校采用仍待用户验证。',
  '',
]

const sceneIds = [...new Set(A3_STORY.map(item => item.scene))]

for (const sceneId of sceneIds) {
  const entries = A3_STORY.filter(item => item.scene === sceneId)
  const content = entries.find(item => item.kind === 'content')
  lines.push(`## ${sceneId}｜${content?.shortTitle || ''}`, '')

  for (const item of entries) {
    const pageSuffix = item.kind === 'content' ? 'A 问题页' : 'B 解决方案页'
    const headingText = item.headingHtml
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/?em>/gi, '')
    lines.push(
      `### ${item.scene}${item.kind === 'content' ? 'A' : 'B'}｜${pageSuffix}`,
      '',
      `**章节：** ${item.phase}`,
      '',
      `**上屏引导：** ${item.kicker}`,
      '',
      `**上屏主句：** ${headingText}`,
      '',
      `**上屏解释：** ${item.summary}`,
      '',
      `**页脚结论：** ${item.footer}`,
      '',
      '**完整旁白：**',
      '',
      item.narration,
      '',
    )
  }
}

await mkdir(path.dirname(outputPath), { recursive: true })
await writeFile(outputPath, `${lines.join('\n')}\n`, 'utf8')
console.log(outputPath)
