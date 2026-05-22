/**
 * AXIOM 内置工具 - Agent 编排
 */

import { createAxiomCompat } from '@/server/infra/storage/AxiomCompat'
import { getFileStorage } from '@/server/infra/storage/GlobalFileStorage'
import { Type } from "@mariozechner/pi-ai";
const axiom = createAxiomCompat(getFileStorage());

import { createTool, toolRegistry } from "../tools";
import { getVaultPath } from "./helpers";

const webSearchTool = createTool(
  'web_search',
  '知识检索',
  '基于 AI 知识库检索相关信息。此工具利用 AI 模型的知识来回答，不进行实时互联网搜索。适用于概念解释、定义查询、背景知识等场景。如需实时信息，请使用 web_fetch 工具获取指定 URL 内容。',
  Type.Object({
    query: Type.String({ description: '搜索查询' }),
    limit: Type.Optional(Type.Number({ description: '结果数量限制' })),
  }),
  async (_id, params) => {
    try {
      const { resolveWebSearchApiKey, createWebSearchModel, executeWebSearch } = await import('../web-search-helpers');

      const apiKey = await resolveWebSearchApiKey();
      if (!apiKey) {
        return {
          content: [{ type: 'text', text: `搜索 "${params.query}" 失败：API Key 未配置` }],
          details: { query: params.query, error: 'No API key' },
        };
      }

      const model = createWebSearchModel();
      const result = await executeWebSearch(model, apiKey, params.query);

      if (result.error) {
        return {
          content: [{ type: 'text', text: `搜索 "${params.query}" 时出错: ${result.error}` }],
          details: { query: params.query, error: result.error },
        };
      }

      return {
        content: [{ type: 'text', text: result.text }],
        details: { query: params.query, source: 'ai-knowledge' },
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `搜索 "${params.query}" 时出错: ${(error as Error).message}` }],
        details: { query: params.query, error: (error as Error).message },
      };
    }
  }
);


const webFetchTool = createTool(
  'web_fetch',
  '网页抓取',
  '抓取指定 URL 的网页内容并转换为纯文本。适用于获取论文、文档、教程等在线资源的具体内容。',
  Type.Object({
    url: Type.String({ description: '要抓取的网页 URL' }),
    max_length: Type.Optional(Type.Number({ description: '返回内容的最大字符数，默认5000' })),
  }),
  async (_id, params) => {
    try {
      const maxLength = params.max_length || 5000;
      const result = await axiom.webFetch?.(params.url, maxLength);
      if (!result?.success) {
        return {
          content: [{ type: 'text', text: `无法获取 ${params.url} 的内容: ${result?.error || '未知错误'}` }],
          details: { url: params.url, error: result?.error },
        };
      }
      return {
        content: [{ type: 'text', text: `## ${params.url}\n\n${result.content}` }],
        details: { url: params.url, length: (result as any).length },
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `抓取 ${params.url} 时出错: ${(error as Error).message}` }],
        details: { url: params.url, error: (error as Error).message },
      };
    }
  }
);


const sessionsSpawnTool = createTool(
  'sessions_spawn',
  '创建子会话',
  '创建一个独立的 Subagent 来并行执行任务。用于需要上下文隔离或并行处理的场景。可指定role让子Agent以特定角色执行。',
  Type.Object({
    task: Type.String({ description: '子会话的任务描述' }),
    label: Type.Optional(Type.String({ description: '子会话标签（用于识别）' })),
    mode: Type.Optional(Type.String({ description: '运行模式: run（一次性）或 session（持久会话）' })),
    model: Type.Optional(Type.String({ description: '模型 ID（可选，用于使用不同模型）' })),
    timeout: Type.Optional(Type.Number({ description: '超时时间（毫秒）' })),
    role: Type.Optional(Type.String({ description: '智能体角色: oracle, profile, forge, guide, assess' })),
    skillName: Type.Optional(Type.String({ description: '要加载的Skill名称，Skill内容将作为子Agent的指令' })),
  }),
  async (_id, params) => {
    try {
      const { getSubagentManager, SubagentMode, SubagentRole, AGENT_ROLES } = await import('../subagent/SubagentSystem');
      const manager = getSubagentManager();

      // 如果指定了 skillName，加载 skill 内容
      let skillContent: string | undefined;
      if (params.skillName) {
        try {
          const { getSkillRegistry } = await import('../skills/SkillRegistry');
          const registry = getSkillRegistry();
          const skill = await registry.loadSkillContent(params.skillName);
          if (skill) {
            skillContent = skill.content;
          }
        } catch (err) {
          console.warn('[sessions_spawn] Failed to load skill:', err);
        }
      }

      // 解析 role
      const validRoles = Object.values(SubagentRole) as string[];
      const roleStr = params.role && validRoles.includes(params.role) ? params.role : undefined;

      const config = {
        task: params.task,
        label: params.label || (roleStr ? (AGENT_ROLES as any)[roleStr]?.name : undefined),
        mode: params.mode === 'session' ? SubagentMode.Session : SubagentMode.Run,
        timeout: params.timeout,
        model: params.model ? {
          provider: 'zai' as const,
          modelId: params.model,
        } : undefined,
        cleanup: true,
        role: roleStr as any,
        skillContent,
      };

      const subagentId = await manager.spawn(config);

      // 收集子代理输出
      let outputText = '';
      manager.on(subagentId, (event: any) => {
        if (event.type === 'output' && event.data?.text) {
          outputText += event.data.text;
        }
      });

      // 等待子代理完成
      let waitError: string | undefined;
      try {
        const result = await manager.wait(subagentId, params.timeout || 120000);
        if (result.outputChunks && result.outputChunks.length > 0) {
          outputText = result.outputChunks.join('') || outputText;
        }
      } catch (err) {
        waitError = (err as Error).message;
      }

      const roleInfo = roleStr ? ` (角色: ${(AGENT_ROLES as any)[roleStr]?.name})` : '';
      const skillInfo = skillContent ? ` [Skill: ${params.skillName}]` : '';
      const statusInfo = waitError ? `\n状态: 失败 - ${waitError}` : '\n状态: 已完成';

      return {
        content: [{ type: 'text', text: `子会话完成: ${subagentId}${roleInfo}${skillInfo}${statusInfo}\n\n--- 输出 ---\n${outputText || '(无输出)'}` }],
        details: { subagentId, role: roleStr, skillName: params.skillName, output: outputText, error: waitError },
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `创建失败: ${(error as Error).message}` }],
        details: { error: (error as Error).message },
      };
    }
  }
);


const subagentsTool = createTool(
  'subagents',
  '管理子会话',
  '管理 Subagent：list（列出）、kill（终止）、steer（重定向）',
  Type.Object({
    action: Type.String({ description: '操作: list, kill, steer' }),
    subagentId: Type.Optional(Type.String({ description: '子会话 ID（kill/steer 时需要）' })),
    newTask: Type.Optional(Type.String({ description: '新任务描述（steer 时需要）' })),
  }),
  async (_id, params) => {
    try {
      const { getSubagentManager } = await import('../subagent/SubagentSystem');
      const manager = getSubagentManager();

      switch (params.action) {
        case 'list': {
          const subagents = manager.list();
          const stats = manager.getStats();
          const summary = subagents
            .map(s => `- ${s.id}: ${s.status} (${s.config.task?.substring(0, 50) || 'no task'})`)
            .join('\n');

          return {
            content: [{ type: 'text', text: `子会话统计: ${JSON.stringify(stats)}\n\n活跃子会话:\n${summary || '(无)'}` }],
            details: { subagents, stats },
          };
        }

        case 'kill': {
          if (!params.subagentId) {
            return {
              content: [{ type: 'text', text: '错误: kill 操作需要 subagentId' }],
              details: { error: 'Missing subagentId' },
            };
          }

          manager.kill(params.subagentId);
          return {
            content: [{ type: 'text', text: `子会话已终止: ${params.subagentId}` }],
            details: { subagentId: params.subagentId },
          };
        }

        case 'steer': {
          if (!params.subagentId || !params.newTask) {
            return {
              content: [{ type: 'text', text: '错误: steer 操作需要 subagentId 和 newTask' }],
              details: { error: 'Missing parameters' },
            };
          }

          await manager.steer(params.subagentId, params.newTask);
          return {
            content: [{ type: 'text', text: `子会话已重定向: ${params.subagentId}` }],
            details: { subagentId: params.subagentId, newTask: params.newTask },
          };
        }

        default:
          return {
            content: [{ type: 'text', text: `未知操作: ${params.action}. 支持: list, kill, steer` }],
            details: { action: params.action },
          };
      }
    } catch (error) {
      return {
        content: [{ type: 'text', text: `错误: ${(error as Error).message}` }],
        details: { error: (error as Error).message },
      };
    }
  }
);


export function registerAgentTools(): void {
  toolRegistry.register(webSearchTool);
  toolRegistry.register(webFetchTool);
  toolRegistry.register(sessionsSpawnTool);
  toolRegistry.register(subagentsTool);
}
