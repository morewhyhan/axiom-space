/**
 * OutputSchemaGuardrail — 输出 schema 校验中间件
 * 对标 Hermes: agent/guardrails/output_schema.py
 *
 * 校验 AI 工具调用的返回值结构是否符合预期。
 * 所有 AXIOM 内置工具统一返回 { content: [{ type: 'text', text: string }], details: any }
 */

import type { ToolMiddleware } from '../tools';

interface ValidationResult {
  valid: boolean;
  error?: string;
}

/** 统一的返回格式校验 */
function validateToolResult(result: any): ValidationResult {
  if (result === null || result === undefined) {
    return { valid: false, error: '返回了空结果' };
  }

  // 允许 error-only 返回（工具抛异常时框架会包装）
  if (typeof result === 'object' && result.error) {
    return { valid: true };
  }

  // 标准格式: { content: [...], details?: {...} }
  if (typeof result === 'object' && Array.isArray(result.content)) {
    for (const item of result.content) {
      if (!item.type || typeof item.text !== 'string') {
        return { valid: false, error: `content 项缺少 type 或 text: ${JSON.stringify(item).slice(0, 100)}` };
      }
    }
    return { valid: true };
  }

  // 旧格式兼容: { type: 'text', text: string } (单条)
  if (typeof result === 'object' && result.type === 'text' && typeof result.text === 'string') {
    return { valid: true };
  }

  return { valid: false, error: `无法识别的返回格式: ${typeof result} ${JSON.stringify(result).slice(0, 100)}` };
}

/** 按工具名的额外校验 */
const TOOL_VALIDATORS: Record<string, (result: any) => ValidationResult> = {
  create_fleeing_card: (result) => {
    const base = validateToolResult(result);
    if (!base.valid) return base;
    // 成功时 details 应含 cardPath
    if (result.details && !result.details.error && !result.details.cardPath) {
      return { valid: false, error: 'create_fleeing_card 成功但未返回 cardPath' };
    }
    return { valid: true };
  },

  create_permanent_card: (result) => {
    const base = validateToolResult(result);
    if (!base.valid) return base;
    if (result.details && !result.details.error && !result.details.cardPath) {
      return { valid: false, error: 'create_permanent_card 成功但未返回 cardPath' };
    }
    return { valid: true };
  },

  search_cards: (result) => {
    const base = validateToolResult(result);
    if (!base.valid) return base;
    if (result.details && !result.details.error) {
      // results 应为数组
      if (result.details.results !== undefined && !Array.isArray(result.details.results)) {
        return { valid: false, error: 'search_cards results 不是数组' };
      }
    }
    return { valid: true };
  },

  read_skill: (result) => {
    const base = validateToolResult(result);
    if (!base.valid) return base;
    if (result.details && !result.details.error && !result.details.content && !result.details.name) {
      return { valid: false, error: 'read_skill 成功但未返回 skill 内容' };
    }
    return { valid: true };
  },

  list_skills: (result) => {
    const base = validateToolResult(result);
    if (!base.valid) return base;
    if (result.details && !result.details.error && !Array.isArray(result.details.skills)) {
      return { valid: false, error: 'list_skills 未返回 skills 数组' };
    }
    return { valid: true };
  },

  sessions_spawn: (result) => {
    const base = validateToolResult(result);
    if (!base.valid) return base;
    if (result.details && !result.details.error && !result.details.subagentId) {
      return { valid: false, error: 'sessions_spawn 成功但未返回 subagentId' };
    }
    return { valid: true };
  },

  ask_user: (result) => {
    const base = validateToolResult(result);
    if (!base.valid) return base;
    return { valid: true };
  },
};

/** 跳过 schema 校验的工具（底层 I/O，返回格式不统一） */
const SKIP_TOOLS = new Set([
  'bash', 'read', 'write', 'mkdir', 'edit', 'grep', 'find', 'ls', 'echo',
  'memory', 'switch_model', 'update_state', 'refresh_vault',
]);

export class OutputSchemaGuardrail implements ToolMiddleware {
  name = 'output-schema';

  afterCall(toolName: string, result: any): { result: any } {
    if (SKIP_TOOLS.has(toolName)) return { result };

    const validator = TOOL_VALIDATORS[toolName] || validateToolResult;
    const validation = validator(result);

    if (!validation.valid) {
      const audit = `[OutputSchema] ${toolName}: ${validation.error}`;
      console.warn(audit);

      // 对已知关键工具（create_card 等），用修正后的格式替换以避免下游崩溃
      if (result && typeof result === 'object' && !result.content) {
        return {
          result: {
            content: [{ type: 'text', text: `工具 ${toolName} 返回格式异常: ${validation.error}` }],
            details: { error: validation.error, originalResult: result },
          },
        };
      }
    }

    return { result };
  }
}
