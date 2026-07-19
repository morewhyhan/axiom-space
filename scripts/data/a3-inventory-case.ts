/**
 * A3 V8 库存超卖黄金案例的稳定业务契约。
 *
 * 数据导入、快速自检、真实链路验收和录制脚本都应引用这一份真源，
 * 避免每个脚本各自猜测标题、卡片和场景顺序。
 */

export const A3_INVENTORY_CASE_ID = 'java-web-inventory-oversell'
export const A3_INVENTORY_RUN_VERSION = 'v8-2026-07-15'
export const A3_INVENTORY_VAULT = 'Java Web 并发控制黄金案例'
export const A3_INVENTORY_EMAIL = process.env.A3_INVENTORY_EMAIL || 'demo@axiom.space'
export const A3_INVENTORY_PASSWORD = process.env.A3_INVENTORY_PASSWORD || 'demo123456'

export const A3_INVENTORY_CARD_PATHS = {
  root: 'Java Web 并发控制/00-课程总览.md',
  source: 'Java Web 并发控制/01-并发库存课程资料.md',
  priorAnalogy: 'Java Web 并发控制/02-多人修改在线表格.md',
  timeline: 'Java Web 并发控制/03-库存交错时间线.md',
  core: 'Java Web 并发控制/04-共享旧状态导致超卖.md',
  atomicity: 'Java Web 并发控制/05-原子检查与扣减.md',
  boundary: 'Java Web 并发控制/06-并发边界与选型.md',
  coupon: 'Java Web 并发控制/07-最后一张优惠券.md',
  compensation: 'Java Web 并发控制/08-跨系统失败补偿.md',
  resourcePack: 'literature/inventory-personalized-resource-pack.md',
} as const

export const A3_INVENTORY_PATH_NAME = '并发库存个性化学习路径'

export const A3_INVENTORY_SCENES = [
  { id: '01', title: 'AI 给出答案，不等于学生已经掌握' },
  { id: '02', title: '用预测冲突发现真实缺口' },
  { id: '03', title: '六维画像改变下一步教学' },
  { id: '04', title: '完整课程、来源和知识图谱' },
  { id: '05', title: '语义召回旧知识参与当前判断' },
  { id: '06', title: '对话保留用户原话并形成卡片' },
  { id: '07', title: '证据不足时独立审核拒绝升级' },
  { id: '08', title: '按缺口且按用户指定类型生成资源' },
  { id: '09', title: '费曼式输出与陌生迁移分别留证' },
  { id: '10', title: '评估证据改变路径和两类推送' },
  { id: '11', title: '画像、会话和卡片跨会话延续' },
  { id: '12', title: '从结果反向追溯证据与失败分支' },
  { id: '13', title: '四步学习链改变下一次学习' },
] as const

export const A3_INVENTORY_PROFILE_DIMENSIONS = [
  'learningGoal',
  'currentFoundation',
  'bestExplanationPath',
  'stuckPattern',
  'paceAndLoad',
  'masteryCheck',
] as const

export const A3_INVENTORY_RESOURCE_TYPES = [
  'document',
  'mindmap',
  'quiz',
  'code',
  'svg',
  'video',
] as const

export function inventoryCaseTag(key: string) {
  return [`case:${A3_INVENTORY_CASE_ID}`, `key:${key}`, `version:${A3_INVENTORY_RUN_VERSION}`]
}
