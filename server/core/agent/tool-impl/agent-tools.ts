/**
 * AXIOM 内置工具 - Agent 编排
 */

import { createAxiomCompat } from '@/server/infra/storage/AxiomCompat'
import { getFileStorage } from '@/server/infra/storage/GlobalFileStorage'
import { Type } from '@mariozechner/pi-ai';
import { resolveAiConfig } from '@/lib/ai-config';
const axiom = createAxiomCompat(getFileStorage());

import { createTool, toolRegistry } from "../tools";
import { getVaultPath } from "./helpers";

// 结果缓存
const spawnCache = new Map<string, { result: any; expiresAt: number }>();

const webSearchTool = createTool(
  'web_search',
  '知识检索（本地+互联网）',
  '支持两种搜索：(1) 本地搜索 - 在 Vault 中搜索已有的卡片；(2) 知识库搜索 - 基于 AI 模型知识回答。自动根据 query_source 参数选择搜索方式，或同时进行两种搜索并合并结果。',
  Type.Object({
    query: Type.String({ description: '搜索查询' }),
    query_source: Type.Optional(Type.String({ description: '搜索来源: "local"(本地Vault) / "ai-knowledge"(AI知识库) / "both"(同时搜索，默认)' })),
    limit: Type.Optional(Type.Number({ description: '结果数量限制，默认 10' })),
    sort_by: Type.Optional(Type.String({ description: '排序方式: "relevance"(相关度，默认) / "recency"(最新) / "popularity"(热度)' })),
    filter_type: Type.Optional(Type.String({ description: '卡片类型过滤: "all"(全部) / "permanent"(永久卡) / "fleeting"(灵感卡) / "literature"(文献卡)，仅对本地搜索有效' })),
  }),
  async (_id, params) => {
    try {
      const querySource = params.query_source || 'both';
      const limit = Math.min(params.limit || 10, 50);
      const vaultPath = getVaultPath();

      const results: Array<{ source: 'local' | 'ai-knowledge'; title?: string; snippet: string; relevance?: number; type?: string; lastModified?: number }> = [];

      // 本地搜索
      if ((querySource === 'local' || querySource === 'both') && vaultPath) {
        try {
          const searchCardResult = await (
            await import('../tool-impl/card-tools')
          ).searchCardsTool?.execute?.(_id, {
            query: params.query,
            type: params.filter_type || 'all',
            limit: limit,
          }) as any;

          if (searchCardResult?.success && searchCardResult.details?.results) {
            for (const card of searchCardResult.details.results.slice(0, Math.ceil(limit / 2))) {
              results.push({
                source: 'local',
                title: card.title || card.cardType,
                snippet: card.content?.slice(0, 150) || card.title || '',
                type: card.cardType || card.type,
                relevance: 0.9, // 本地搜索默认高相关度
              });
            }
          }
        } catch (err) {
          console.warn('[web_search] Local search failed:', err);
        }
      }

      // AI 知识库搜索
      if (querySource === 'ai-knowledge' || querySource === 'both') {
        try {
          const { resolveWebSearchApiKey, createWebSearchModel, executeWebSearch } = await import('../web-search-helpers');
          const apiKey = await resolveWebSearchApiKey();

          if (apiKey) {
            const model = createWebSearchModel();
            const result = await executeWebSearch(model, apiKey, params.query);

            if (!result.error && result.text) {
              // 分割结果成多条
              const lines = result.text.split('\n').filter((l: string) => l.trim());
              for (const line of lines.slice(0, Math.ceil(limit / 2))) {
                results.push({
                  source: 'ai-knowledge',
                  snippet: line,
                  relevance: 0.8,
                });
              }
            }
          }
        } catch (err) {
          console.warn('[web_search] AI search failed:', err);
        }
      }

      // 排序
      if (params.sort_by === 'recency') {
        results.sort((a, b) => (b.lastModified || 0) - (a.lastModified || 0));
      } else if (params.sort_by === 'popularity') {
        results.sort((a, b) => (b.relevance || 0) - (a.relevance || 0));
      } else {
        results.sort((a, b) => (b.relevance || 0) - (a.relevance || 0));
      }

      if (results.length === 0) {
        return {
          content: [{ type: 'text', text: `未找到与 "${params.query}" 相关的结果。` }],
          details: { query: params.query, count: 0, sources: [querySource] },
        };
      }

      const summary = results.slice(0, limit).map((r, i) => {
        const source = r.source === 'local' ? `[本地-${r.type}]` : '[知识库]';
        const title = r.title ? ` ${r.title}` : '';
        return `${i + 1}. ${source}${title}\n   ${r.snippet.slice(0, 100)}`;
      }).join('\n\n');

      return {
        content: [{ type: 'text', text: `搜索结果 (${results.length} 条):\n\n${summary}` }],
        details: {
          query: params.query,
          count: results.length,
          results: results.slice(0, limit),
          sources: [querySource],
        },
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
  '网页抓取（增强版）',
  '抓取指定 URL 的网页内容。支持自动提取关键概念、生成摘要、解析结构化数据、自动建卡等高级功能。',
  Type.Object({
    url: Type.String({ description: '要抓取的网页 URL' }),
    max_length: Type.Optional(Type.Number({ description: '返回内容的最大字符数，默认 5000' })),
    extract_concepts: Type.Optional(Type.Boolean({ description: '是否自动提取关键概念（需调用 AI，默认 false）' })),
    create_card: Type.Optional(Type.Boolean({ description: '是否自动创建文献卡片（默认 false）' })),
    content_type: Type.Optional(Type.String({ description: '内容类型提示: "paper"(论文) / "blog"(博客) / "doc"(文档) / "video-transcript"(视频转录) / "auto"(自动识别，默认)' })),
    summary: Type.Optional(Type.Boolean({ description: '是否生成内容摘要（默认 false）' })),
    extract_tables: Type.Optional(Type.Boolean({ description: '是否提取表格数据（默认 false）' })),
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

      const content = result.content || '';
      const vaultPath = getVaultPath();
      let response = `## ${params.url}\n\n${content}`;
      const details: any = { url: params.url, length: content.length };

      // 自动提取概念
      if (params.extract_concepts) {
        try {
          const { aiManager } = await import('../../ai/AIManager');
          const conceptPrompt = `从以下内容中提取关键概念、术语和关键观点。以 JSON 格式返回（不要 \`\`\`json 包裹，不要任何其他文字），包含 concepts (数组) 和 key_points (数组)。\n\n内容：\n${content.slice(0, 2000)}\n\n## ⚠️ 强制输出语言：中文\n所有内容必须用中文输出。专有名词保留原文。`;
          const conceptResult = await aiManager.callAPI('你是概念提取专家。内部推理即可，不要输出思考过程。直接返回 JSON 结果。', [{ role: 'user', content: conceptPrompt }]);

          try {
            const cleaned = conceptResult.replace(/```(?:json)?\s*/g, '').replace(/\s*```/g, '');
            const match = cleaned.match(/\{[\s\S]*\}/);
            if (match) {
              const parsed = JSON.parse(match[0]);
              details.concepts = parsed.concepts;
              details.key_points = parsed.key_points;
              response += `\n\n### 提取的概念\n${(parsed.concepts || []).slice(0, 10).map((c: string) => `- ${c}`).join('\n')}`;
            }
          } catch (parseErr) {
            console.warn('[web_fetch] Concept extraction JSON parse failed');
          }
        } catch (err) {
          console.warn('[web_fetch] Concept extraction failed:', err);
        }
      }

      // 生成摘要
      if (params.summary) {
        try {
          const { aiManager } = await import('../../ai/AIManager');
          const summaryPrompt = `用 100-200 字总结以下内容的核心要点：\n\n${content.slice(0, 1500)}\n\n## ⚠️ 强制输出语言：中文\n所有内容必须用中文输出。专有名词保留原文。`;
          const summaryResult = await aiManager.callAPI('你是总结专家。内部推理即可，不要输出思考过程。直接返回 JSON 结果。', [{ role: 'user', content: summaryPrompt }]);
          details.summary = summaryResult;
          response += `\n\n### 摘要\n${summaryResult}`;
        } catch (err) {
          console.warn('[web_fetch] Summary generation failed:', err);
        }
      }

      // 自动建卡
      if (params.create_card && vaultPath) {
        try {
          const { createAxiomCompat } = await import('@/server/infra/storage/AxiomCompat');
          const { getFileStorage } = await import('@/server/infra/storage/GlobalFileStorage');
          const axiomCompat = createAxiomCompat(getFileStorage());

          const cardTitle = new URL(params.url).hostname || '网页资源';
          const cardContent = `# ${cardTitle}\n\n**来源**: ${params.url}\n\n${content.slice(0, 1000)}...`;

          const cardResult = await (axiomCompat as any).createLiterature?.(vaultPath, {
            title: cardTitle,
            content: cardContent,
            source: params.url,
            sourceType: params.content_type || 'web',
          });

          if (cardResult?.success) {
            details.card_created = true;
            details.card_path = cardResult.cardPath || cardResult.id;
            response += `\n\n✅ 文献卡片已创建: ${details.card_path}`;
          }
        } catch (err) {
          console.warn('[web_fetch] Card creation failed:', err);
        }
      }

      return {
        content: [{ type: 'text', text: response }],
        details,
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
    allow_context_sharing: Type.Optional(Type.Boolean({ description: '是否允许共享父会话的上下文（默认 false）' })),
    priority: Type.Optional(Type.String({ description: '优先级: "high" / "normal" / "low"，默认 normal' })),
    cache_ttl: Type.Optional(Type.Number({ description: '结果缓存时间（毫秒），0=不缓存，默认 0' })),
  }),
  async (_id, params) => {
    try {
      const { getSubagentManager, SubagentMode, SubagentRole, AGENT_ROLES } = await import('../subagent/SubagentSystem');
      const { getCurrentAgent } = await import('@/server/core/agent/agent-context');
      const manager = getSubagentManager();
      const parentAgent = getCurrentAgent<any>();
      if (parentAgent) {
        manager.setParentAgent(parentAgent);
        const parentMemory = typeof parentAgent.getMemory === 'function' ? parentAgent.getMemory() : null;
        if (parentMemory) manager.setParentMemory(parentMemory as any);
      }

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

      // 上下文共享和优先级
      const allowContextSharing = params.allow_context_sharing ?? false;
      const priority = ['high', 'normal', 'low'].includes(params.priority || '') ? params.priority : 'normal';
      const cacheTtl = params.cache_ttl ?? 0;

      // 缓存检查
      if (cacheTtl > 0) {
        const cacheKey = `${params.task}|${params.skillName || ''}|${roleStr || ''}`;
        const cached = spawnCache.get(cacheKey);
        if (cached && Date.now() < cached.expiresAt) {
          return {
            content: [{ type: 'text', text: `[缓存命中] 子会话结果 (缓存有效期内)\n\n--- 输出 ---\n${cached.result.output || '(无输出)'}` }],
            details: { ...cached.result, cached: true, cacheKey },
          };
        }
      }

      const config = {
        task: params.task,
        label: params.label || (roleStr ? (AGENT_ROLES as any)[roleStr]?.name : undefined),
        mode: params.mode === 'session' ? SubagentMode.Session : SubagentMode.Run,
        timeout: params.timeout,
        model: params.model ? {
          provider: resolveAiConfig().model.provider as any,
          modelId: params.model,
        } : undefined,
        cleanup: true,
        role: roleStr as any,
        skillContent,
        allowContextSharing,
        priority,
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

      // 缓存结果
      if (cacheTtl > 0 && !waitError) {
        const cacheKey = `${params.task}|${params.skillName || ''}|${roleStr || ''}`;
        spawnCache.set(cacheKey, {
          result: { subagentId, output: outputText, role: roleStr, skillName: params.skillName },
          expiresAt: Date.now() + cacheTtl,
        });
      }

      const roleInfo = roleStr ? ` (角色: ${(AGENT_ROLES as any)[roleStr]?.name})` : '';
      const skillInfo = skillContent ? ` [Skill: ${params.skillName}]` : '';
      const priorityInfo = priority !== 'normal' ? ` [优先级: ${priority}]` : '';
      const cacheInfo = cacheTtl > 0 ? ` [缓存: ${cacheTtl}ms]` : '';
      const sharingInfo = allowContextSharing ? ' [上下文共享: 开]' : '';
      const statusInfo = waitError ? `\n状态: 失败 - ${waitError}` : '\n状态: 已完成';

      return {
        content: [{ type: 'text', text: `子会话完成: ${subagentId}${roleInfo}${skillInfo}${priorityInfo}${cacheInfo}${sharingInfo}${statusInfo}\n\n--- 输出 ---\n${outputText || '(无输出)'}` }],
        details: { subagentId, role: roleStr, skillName: params.skillName, output: outputText, error: waitError, priority, cacheTtl, allowContextSharing },
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
  '管理 Subagent：list（列出）、kill（终止）、steer（重定向）、status（状态详情）、batch_kill（批量终止）、get_metrics（性能指标）、export_logs（导出日志）',
  Type.Object({
    action: Type.String({ description: '操作: list, kill, steer, status, batch_kill, get_metrics, export_logs' }),
    subagentId: Type.Optional(Type.String({ description: '子会话 ID（kill/steer/status 时需要；batch_kill 可传逗号分隔或多个 "all"）' })),
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

        case 'status': {
          const subagents = manager.list();
          if (params.subagentId) {
            const sa = subagents.find(s => s.id === params.subagentId);
            if (!sa) {
              return {
                content: [{ type: 'text', text: `未找到子会话: ${params.subagentId}` }],
                details: { error: 'Subagent not found', subagentId: params.subagentId },
              };
            }
            return {
              content: [{ type: 'text', text: `子会话详情:\nID: ${sa.id}\n状态: ${sa.status}\n任务: ${sa.config.task || '(无)'}\n标签: ${sa.config.label || '(无)'}\n模式: ${sa.config.mode || '(无)'}` }],
              details: { subagent: sa },
            };
          }
          const summary = subagents
            .map(s => `- ${s.id}: ${s.status} (${s.config.task?.substring(0, 60) || 'no task'})`)
            .join('\n');
          return {
            content: [{ type: 'text', text: `所有子会话 (${subagents.length} 个):\n${summary || '(无活跃子会话)'}` }],
            details: { count: subagents.length, subagents },
          };
        }

        case 'batch_kill': {
          if (!params.subagentId) {
            return {
              content: [{ type: 'text', text: '错误: batch_kill 操作需要 subagentId（逗号分隔或 "all"）' }],
              details: { error: 'Missing subagentId' },
            };
          }

          let idsToKill: string[];
          if (params.subagentId === 'all') {
            idsToKill = manager.list().map(s => s.id);
          } else {
            idsToKill = params.subagentId.split(',').map(id => id.trim()).filter(Boolean);
          }

          for (const id of idsToKill) {
            try { manager.kill(id); } catch (e) { console.warn(`[subagents] Failed to kill ${id}:`, e); }
          }

          return {
            content: [{ type: 'text', text: `批量终止完成: ${idsToKill.length} 个子会话已终止` }],
            details: { killed: idsToKill, count: idsToKill.length },
          };
        }

        case 'get_metrics': {
          const stats = manager.getStats();
          const subagents = manager.list();
          const now = Date.now();
          const withTiming = subagents.map(s => ({
            id: s.id,
            status: s.status,
            elapsed: s.startTime ? `${((now - s.startTime) / 1000).toFixed(1)}s` : 'N/A',
          }));
          return {
            content: [{ type: 'text', text: `性能指标:\n${JSON.stringify(stats, null, 2)}\n\n各子会话耗时:\n${withTiming.map(t => `- ${t.id}: ${t.status} (${t.elapsed})`).join('\n') || '(无)'}` }],
            details: { stats, timing: withTiming },
          };
        }

        case 'export_logs': {
          const subagents = manager.list();
          const logs = subagents.map(s => `[${s.id}] ${s.status} | 任务: ${s.config.task || '(无)'}`).join('\n');
          return {
            content: [{ type: 'text', text: `子会话日志 (${subagents.length} 条):\n\n${logs || '(无日志)'}` }],
            details: { count: subagents.length, logs: subagents },
          };
        }

        default:
          return {
            content: [{ type: 'text', text: `未知操作: ${params.action}. 支持: list, kill, steer, status, batch_kill, get_metrics, export_logs` }],
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
