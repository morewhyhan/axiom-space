/**
 * AXIOM 内置工具 — 画像信号校验
 *
 * profile_signal_check 是 Channel A → Channel B 的桥梁。
 * Agent 每轮回复后调用此工具，产出结构化信号参数。
 * Pipeline 读取 tool result，决定是否触发 Channel B (BackgroundAnalyzer)。
 */

import { Type } from '@mariozechner/pi-ai'
import { createTool, toolRegistry } from '../tools'

const PROFILE_DIMENSION_KEYS = [
  'learningGoal',
  'currentFoundation',
  'bestExplanationPath',
  'stuckPattern',
  'paceAndLoad',
  'masteryCheck',
] as const

const profileSignalCheckTool = createTool(
  'profile_signal_check',
  '画像信号校验',
  `每轮对话结束后调用：校验本轮是否出现需要更新学习画像的信号。

对照 6 个画像维度逐一检查本轮对话中用户是否暴露了新证据：

1. learningGoal（学什么）：用户是否表达了新的学习目标、使用场景、范围边界或优先级？
   触发信号：创建或调整学习路径、明确说想学什么、限定了范围、表达了急迫程度。
   不应提取：随口提到一个名词、单次查询关键词、产品反馈而非学习目标。

2. currentFoundation（会什么）：用户是否展示了已掌握、半懂、缺失前置或误解？
   触发信号：用自己的话解释概念、明确说会/不会/半懂、测评或练习暴露前置缺口。
   不应提取：复制原文、助手刚讲过但用户没有复述、礼貌性说懂了但无验证证据。

3. bestExplanationPath（怎么讲）：用户是否要求了特定的解释入口？
   触发信号：要求举例、画图、代码、类比、反例、先整体后局部、换说法。
   不应提取：单次偶然要求但后续无偏好证据、与学习理解无关的格式偏好。

4. stuckPattern（哪里会卡）：用户是否表现出卡顿模式？
   触发信号：明确说卡住/没懂/混了、同类题多次出错、概念混淆、能听懂但不会用。
   不应提取：第一次问某个问题、确认性提问而非失败证据、外部材料本身复杂。

5. paceAndLoad（一次讲多少）：用户是否反馈了信息密度、推进速度或术语密度？
   触发信号：要求短一点/详细一点/慢一点/快一点/一步一步、频繁打断、长时间停顿。
   不应提取：单次说继续/下一步、系统卡顿导致的中断。

6. masteryCheck（怎么算学会）：用户是否展现了掌握证据或明确了验收偏好？
   触发信号：完成复述/做题/改错/迁移任务、沉淀永久卡、说明想如何验收。
   不应提取：助手建议测验但用户未执行、只听完解释无输出证据。

如果至少一个维度有真实的新证据，needsUpdate 为 true，并列出对应的维度。
如果没有新证据，needsUpdate 为 false，dimensions 为空数组。`,
  Type.Object({
    needsUpdate: Type.Boolean({ description: '是否有任一维度需要更新' }),
    dimensions: Type.Array(
      Type.String({ description: '需要更新的维度 key' }),
      { description: '本轮检测到有新证据的画像维度列表，空数组表示无需更新' },
    ),
    evidenceSummary: Type.String({
      description: '简短说明本轮发现的画像信号（1-3句话），没有新证据时写"本轮无画像更新信号"',
    }),
  }),
  async (_id, params) => {
    // This tool is a pure signal — no side effects.
    // Pipeline reads the tool result from the message stream.
    const dimensionLabels: Record<string, string> = {
      learningGoal: '学什么',
      currentFoundation: '会什么',
      bestExplanationPath: '怎么讲',
      stuckPattern: '哪里会卡',
      paceAndLoad: '一次讲多少',
      masteryCheck: '怎么算学会',
    }
    const labeled = params.dimensions
      .map((d: string) => dimensionLabels[d] || d)
      .join('、')

    return {
      content: [
        {
          type: 'text',
          text: params.needsUpdate
            ? `✓ 画像信号: ${labeled} 维度检测到新证据`
            : '○ 本轮无画像更新信号',
        },
      ],
      details: {
        needsUpdate: params.needsUpdate,
        dimensions: params.dimensions,
        evidenceSummary: params.evidenceSummary,
      },
    }
  },
)

export { profileSignalCheckTool }

export function registerProfileSignalTools(): void {
  toolRegistry.register(profileSignalCheckTool)
}
