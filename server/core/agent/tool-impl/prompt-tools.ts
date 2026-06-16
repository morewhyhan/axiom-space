/**
 * AXIOM Agent tools - Prompt Registry access
 *
 * These tools expose the central prompt registry to the Workbench Agent so any
 * prompt contract can be inspected or used as a focused sub-task.
 */

import { Type } from '@mariozechner/pi-ai';
import { createTool, toolRegistry } from '../tools';
import { aiManager } from '@/server/core/ai/AIManager';
import { getPrompt, listPrompts, type PromptId } from '@/server/core/ai/prompts';
import { formatPromptContract, renderPrompt } from '@/server/core/ai/prompts/types';

function findPrompt(promptId: string) {
  return listPrompts().find((prompt) => prompt.id === promptId) ?? null;
}

function parseInputJson(inputJson?: string): unknown {
  if (!inputJson?.trim()) return {};
  try {
    return JSON.parse(inputJson);
  } catch (error) {
    throw new Error(`inputJson must be valid JSON: ${(error as Error).message}`);
  }
}

const listPromptsTool = createTool(
  'list_prompts',
  '列出系统提示词',
  '列出 AXIOM Prompt Registry 中所有可用提示词。需要选择专门提示词前先调用。',
  Type.Object({
    query: Type.Optional(Type.String({ description: '按 id/name/purpose/whenToUse 搜索。留空返回全部。' })),
    limit: Type.Optional(Type.Number({ description: '最多返回条数，默认 80。' })),
  }),
  async (_id, params) => {
    try {
      const q = params.query?.trim().toLowerCase() || '';
      const limit = Math.max(1, Math.min(params.limit || 80, 200));
      const prompts = listPrompts()
        .filter((prompt) => {
          if (!q) return true;
          const haystack = [
            prompt.id,
            prompt.name,
            prompt.purpose,
            prompt.outputMode,
            ...prompt.whenToUse,
            ...prompt.input,
          ].join(' ').toLowerCase();
          return haystack.includes(q);
        })
        .slice(0, limit);

      const lines = prompts.map((prompt) => [
        `- ${prompt.id}`,
        `  name: ${prompt.name}`,
        `  output: ${prompt.outputMode}`,
        `  purpose: ${prompt.purpose}`,
      ].join('\n'));

      return {
        content: [{ type: 'text', text: `可用提示词 ${prompts.length} 个:\n${lines.join('\n') || '(无匹配)'}` }],
        details: {
          query: params.query ?? null,
          count: prompts.length,
          prompts: prompts.map((prompt) => ({
            id: prompt.id,
            name: prompt.name,
            purpose: prompt.purpose,
            outputMode: prompt.outputMode,
            input: prompt.input,
            whenToUse: prompt.whenToUse,
          })),
        },
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `列出提示词失败: ${(error as Error).message}` }],
        details: { error: (error as Error).message },
      };
    }
  },
);

const getPromptTool = createTool(
  'get_prompt',
  '读取系统提示词',
  '读取指定 Prompt Registry 合约。默认只返回合约摘要；includeSystem=true 时返回完整 system prompt。',
  Type.Object({
    promptId: Type.String({ description: 'Prompt id，例如 oracle.chat 或 agent.tool.learning-plan。' }),
    includeSystem: Type.Optional(Type.Boolean({ description: '是否返回完整 system prompt。默认 false。' })),
  }),
  async (_id, params) => {
    try {
      const prompt = findPrompt(params.promptId);
      if (!prompt) {
        return {
          content: [{ type: 'text', text: `Prompt not found: ${params.promptId}` }],
          details: { error: 'PROMPT_NOT_FOUND', promptId: params.promptId },
        };
      }

      const contract = formatPromptContract(prompt);
      const system = params.includeSystem ? `\n\n## System Prompt\n${prompt.system}` : '';
      return {
        content: [{ type: 'text', text: `${contract}${system}` }],
        details: {
          id: prompt.id,
          name: prompt.name,
          version: prompt.version,
          purpose: prompt.purpose,
          outputMode: prompt.outputMode,
          input: prompt.input,
          hasBuildUserMessage: typeof prompt.buildUserMessage === 'function',
          system: params.includeSystem ? prompt.system : undefined,
        },
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `读取提示词失败: ${(error as Error).message}` }],
        details: { error: (error as Error).message },
      };
    }
  },
);

const runPromptTool = createTool(
  'run_prompt',
  '执行系统提示词',
  '用 Prompt Registry 中的指定提示词执行一次 LLM 子任务。适合调用系统已有专家提示词来产出 JSON/Markdown/Text 结果。',
  Type.Object({
    promptId: Type.String({ description: 'Prompt id。可先用 list_prompts 查找。' }),
    inputJson: Type.Optional(Type.String({ description: '传给 buildUserMessage 的 JSON 字符串；没有 buildUserMessage 时会作为普通文本输入。' })),
    userMessage: Type.Optional(Type.String({ description: '直接用户输入。若提供，将优先于 inputJson 渲染结果。' })),
    temperature: Type.Optional(Type.Number({ description: '采样温度，默认 0.2。' })),
    maxTokens: Type.Optional(Type.Number({ description: '最大输出 token，默认 2048。' })),
  }),
  async (_id, params) => {
    try {
      const prompt = getPrompt(params.promptId as PromptId);
      if (!prompt) {
        return {
          content: [{ type: 'text', text: `Prompt not found: ${params.promptId}` }],
          details: { error: 'PROMPT_NOT_FOUND', promptId: params.promptId },
        };
      }

      const input = parseInputJson(params.inputJson);
      const rendered = params.userMessage?.trim()
        ? { system: prompt.system, user: params.userMessage.trim() }
        : renderPrompt(prompt, input as never);

      const output = await aiManager.callAPI(
        rendered.system,
        [{ role: 'user', content: rendered.user }],
        {
          temperature: typeof params.temperature === 'number' ? params.temperature : 0.2,
          maxTokens: typeof params.maxTokens === 'number' ? params.maxTokens : 2048,
        },
      );

      return {
        content: [{ type: 'text', text: output }],
        details: {
          promptId: prompt.id,
          outputMode: prompt.outputMode,
          input,
          userMessage: rendered.user,
          outputLength: output.length,
        },
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `执行提示词失败: ${(error as Error).message}` }],
        details: { error: (error as Error).message, promptId: params.promptId },
      };
    }
  },
);

export function registerPromptTools(): void {
  toolRegistry.register(listPromptsTool);
  toolRegistry.register(getPromptTool);
  toolRegistry.register(runPromptTool);
}
