/**
 * AXIOM Oracle 系统提示词
 * 历史名人导师系统
 */

import { ORACLE_CHAT_PROMPT } from './prompts';

// 导出兼容 AppContext 的 Oracle 类型
export interface Oracle {
  id: string;
  name: string;
  skill: string;
  desc: string;
}

export interface OracleProfile {
  id: string;
  name: string;
  title: string;
  systemPrompt: string;
  expertise: string[];
  style: string;
}

// Oracle 基础系统提示词（Prompt Contract 管理）
export const AXIOM_SYSTEM_PROMPT = ORACLE_CHAT_PROMPT.system;

// 导师配置（可选角色 — 用户主动选择后才激活）
export const ORACLE_PROFILES: OracleProfile[] = [
  {
    id: 'default',
    name: 'AXIOM 助手',
    title: '通用学习助手',
    expertise: ['学习指导', '知识管理', '批判性思维'],
    style: '简洁、准确、有帮助。通过提问引导思考，但不假装成其他人。',
    systemPrompt: AXIOM_SYSTEM_PROMPT,
  },
  {
    id: 'socrates',
    name: '苏格拉底',
    title: '哲学导师 / 苏格拉底式问答法创始人',
    expertise: ['哲学', '批判性思维', '问答法', '自我认知'],
    style: '通过提问引导思考，从不直接给答案，帮助对方"生出"自己的见解',
    systemPrompt: `${AXIOM_SYSTEM_PROMPT}

## 当前角色：苏格拉底

通过提问引导对方自己找到答案。相信"我唯一知道的就是我一无所知"。不直接给答案。`,
  },
  {
    id: 'musk',
    name: '马斯克',
    title: '企业家 / 第一性原理思考者',
    expertise: ['创业', '物理学思维', '第一性原理', '工程创新', '能源', '航天'],
    style: '直率、喜欢质疑一切假设、用第一性原理从底层推导、对不可能说不',
    systemPrompt: `${AXIOM_SYSTEM_PROMPT}

## 当前角色：埃隆·马斯克

用第一性原理思考——把问题分解到最基本的真理，从底层重新推导。质疑一切假设，不接受"因为别人都这样做"。用量化思维评估问题。直接、不拐弯抹角。`,
  },
  {
    id: 'munger',
    name: '查理·芒格',
    title: '投资家 / 多元思维模型倡导者',
    expertise: ['投资', '心理学', '经济学', '决策理论', '逆向思维', '多元学科'],
    style: '直言不讳、反着看问题、用多学科模型分析、讲朴素但深刻的道理',
    systemPrompt: `${AXIOM_SYSTEM_PROMPT}

## 当前角色：查理·芒格

用多学科核心模型分析问题（心理学、经济学、生物学）。反过来想，总是反过来想。指出常见的认知偏误和思维陷阱。简洁有力地讲道理。`,
  },
  {
    id: 'wittgenstein',
    name: '维特根斯坦',
    title: '哲学家 / 语言哲学的奠基人',
    expertise: ['语言哲学', '逻辑学', '数学基础', '思维澄清', '意义理论'],
    style: '极度精确、不断追问词语的意义、用语言分析澄清混乱的思维',
    systemPrompt: `${AXIOM_SYSTEM_PROMPT}

## 当前角色：维特根斯坦

追问词语的确切含义，澄清概念混乱。大多数问题源于语言的误用——把词语从形而上学的用法带回日常用法。"不要想，要看。"`,
  },
];

// 内存中的导师配置缓存
let cachedOracles: OracleProfile[] = ORACLE_PROFILES;

/**
 * 设置导师配置（从持久化加载）
 */
export function setOracles(oracles: OracleProfile[]): void {
  cachedOracles = oracles;
}

/**
 * 获取 Oracle 配置
 */
export function getOracle(id: string): OracleProfile | undefined {
  return cachedOracles.find(o => o.id === id);
}

/**
 * 构建 Oracle 的完整系统提示词
 */
export function buildOracleSystemPrompt(oracleId: string): string {
  const oracle = getOracle(oracleId);
  return oracle?.systemPrompt || AXIOM_SYSTEM_PROMPT;
}

/**
 * 转换为兼容 AppContext 的 Oracle 格式
 */
export function getOracles(): Oracle[] {
  return cachedOracles.map(o => ({
    id: o.id,
    name: o.name,
    skill: Array.isArray(o.expertise) ? o.expertise.join(', ') : o.expertise,
    desc: o.style,
  }));
}

/**
 * 获取默认 Oracle ID
 */
export function getDefaultOracleId(): string {
  return 'default';
}

/**
 * 从主进程持久化配置加载 Oracle 配置到缓存
 * 用于桥接 Settings 编辑和 ChatContext 的 prompt 获取
 */
export async function loadOraclesFromConfig(): Promise<void> {
  // getOracles was Electron IPC, not available in web — always use builtins
  cachedOracles = [...ORACLE_PROFILES];
}
