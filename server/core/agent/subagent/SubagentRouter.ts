/**
 * SubagentRouter — 自动子 Agent 路由
 *
 * 根据意图自动选择子 Agent 角色和工具集：
 * - learn  → Guide  （教学引导）
 * - create → Forge  （内容创建）
 * - analyze → Oracle （分析解答）
 * - manage → Assess  （评估管理）
 * - chat   → null   （主 Agent 直接处理）
 */

import type { Intent } from '@/server/core/agent/IntentRouter';
import { SubagentRole, SubagentMode, type SubagentConfig } from './SubagentSystem';

interface RoleMapping {
  role: SubagentRole;
  description: string;
  tools: string[];
}

/** 意图 → 角色映射 */
const INTENT_ROLE_MAP: Record<Exclude<Intent, 'chat'>, RoleMapping> = {
  learn: {
    role: SubagentRole.Guide,
    description: '教学引导：解释概念、提供例子、循序渐进',
    tools: ['read', 'read_skill', 'list_skills', 'write', 'ask_user', 'web_search', 'memory'],
  },
  create: {
    role: SubagentRole.Forge,
    description: '内容创建：生成笔记、卡片、文档、PPT、学习资源',
    tools: ['write', 'mkdir', 'create_fleeing_card', 'create_permanent_card', 'read',
      'push_resource', 'generate_ppt', 'web_search', 'memory'],
  },
  analyze: {
    role: SubagentRole.Oracle,
    description: '分析解答：检索信息、对比分析、总结',
    tools: ['read', 'grep', 'find', 'ls', 'search_cards', 'web_search', 'memory'],
  },
  manage: {
    role: SubagentRole.Assess,
    description: '评估管理：检查进度、更新状态',
    tools: ['read', 'ls', 'search_cards', 'update_state', 'ask_user'],
  },
  profile: {
    role: SubagentRole.Profile,
    description: '画像分析：分析学习特征、更新用户画像',
    tools: ['read', 'write', 'memory', 'ask_user'],
  },
};

/**
 * 根据意图生成子 Agent 配置
 *
 * @param intent 意图分类结果
 * @param task 任务描述
 * @returns SubagentConfig 或 null（如果主 Agent 应直接处理）
 */
export function routeToSubagent(
  intent: Intent,
  task: string
): SubagentConfig | null {
  const mapping = INTENT_ROLE_MAP[intent as Exclude<Intent, 'chat'>];
  if (!mapping) return null; // chat → 主 Agent 处理

  return {
    role: mapping.role,
    task,
    mode: SubagentMode.Run,
    timeout: 300000, // 5 分钟
    skillContent: `[Auto-routed: ${mapping.role}] ${mapping.description}\n可用工具方向: ${mapping.tools.join(', ')}`,
  };
}

/**
 * 直接获取意图对应的工具列表（避免从 skillContent 中正则提取）
 */
export function getToolsForIntent(intent: Intent): string[] | null {
  const mapping = INTENT_ROLE_MAP[intent as Exclude<Intent, 'chat'>];
  return mapping?.tools ?? null;
}

/**
 * 判断是否应该委派给子 Agent
 * 只在满足以下条件时委派：
 * - 意图不是 chat
 * - 消息长度 >= 10 个字符（避免碎片消息触发子 Agent）
 * - 不是简单的问答（如 "是"、"好"、"继续"）
 */
export function shouldDelegate(intent: Intent, message: string): boolean {
  if (intent === 'chat') return false;

  const trimmed = message.trim();
  if (!trimmed) return false;

  // 简单回复不触发子 Agent（中文短回复通常 < 4 字符）
  const shortReplies = ['是', '好', '继续', '对', '嗯', 'ok', 'yes', 'no', '好的', '明白', '不需要', '不用', '算了'];
  if (shortReplies.includes(trimmed.toLowerCase())) return false;

  return true;
}
