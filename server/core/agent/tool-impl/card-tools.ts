/**
 * AXIOM 内置工具 - 卡片/技能/图谱操作
 */

import { createAxiomCompat } from '@/server/infra/storage/AxiomCompat'
import { getFileStorage } from '@/server/infra/storage/GlobalFileStorage'
import { Type } from "@mariozechner/pi-ai";
import { createTool, toolRegistry } from "../tools";
import { getVaultPath, resolvePath } from "./helpers";
const axiom = createAxiomCompat(getFileStorage());

const createFleeingCardTool = createTool(
  'create_fleeing_card',
  '创建灵感卡片',
  '创建一个新的灵感卡片（Fleeing Card）。请在 content 中用 [[概念名]] 标注与其他概念的关联，并在 links.to 中列出所有引用的概念，确保双向链接完整以便知识图谱连线。',
  Type.Object({
    content: Type.String({ description: '卡片内容，请用 [[概念名]] 标注与其他概念的关联' }),
    title: Type.Optional(Type.String({ description: '卡片标题（可选）' })),
    tags: Type.Optional(Type.Array(Type.String(), { description: '标签列表' })),
    sourceLiterature: Type.Optional(Type.String({ description: '来源文献ID' })),
    links: Type.Optional(Type.Object({
      to: Type.Array(Type.String(), { description: '此卡片引用的概念列表' }),
    }, { description: '双向链接信息，用于知识图谱连线' })),
  }),
  async (_id, params) => {
    try {
      const vaultPath = getVaultPath();
      if (!vaultPath) {
        return {
          content: [{ type: 'text', text: '错误: 未打开 Vault' }],
          details: { error: 'No vault open' },
        };
      }
      const result = await (axiom as any).createFleeing?.(vaultPath, params, params.content);
      if (result?.success) {
        const cardPath = (result as any).cardPath || (result as any).id;
        globalThis.dispatchEvent(new CustomEvent('axiom:toast', { detail: { message: `创建灵感卡片: ${params.title}`, type: 'card' } }));
        return {
          content: [{ type: 'text', text: `灵感卡片已创建，路径: ${cardPath}` }],
          details: { id: cardPath, cardPath, content: params.content },
        };
      }
      return {
        content: [{ type: 'text', text: `创建失败: ${(result as any)?.error || '未知错误'}` }],
        details: { error: (result as any)?.error },
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `错误: ${(error as Error).message}` }],
        details: { error: (error as Error).message },
      };
    }
  }
);


const createPermanentCardTool = createTool(
  'create_permanent_card',
  '创建永久卡片',
  '创建一个新的永久知识卡片（Permanent Card）。请在 content 中用 [[概念名]] 标注与其他概念的关联，并确保 links.to 包含所有引用概念，实现知识图谱双向连线。',
  Type.Object({
    title: Type.String({ description: '卡片标题' }),
    content: Type.String({ description: '卡片内容，请用 [[概念名]] 标注与其他概念的关联，实现双向链接' }),
    template: Type.Optional(Type.String({ description: '模板ID，如 definition, concept, method' })),
    tags: Type.Optional(Type.Array(Type.String(), { description: '标签列表' })),
    sources: Type.Optional(Type.Object({
      literature: Type.Optional(Type.Array(Type.String())),
      fleeing: Type.Optional(Type.Array(Type.String())),
    })),
    links: Type.Optional(Type.Object({
      to: Type.Array(Type.String(), { description: '此卡片引用的概念列表' }),
    }, { description: '双向链接信息，用于知识图谱连线' })),
  }),
  async (_id, params) => {
    try {
      const vaultPath = getVaultPath();
      if (!vaultPath) {
        return {
          content: [{ type: 'text', text: '错误: 未打开 Vault' }],
          details: { error: 'No vault open' },
        };
      }
      const result = await (axiom as any).createPermanent?.(vaultPath, params, params.content);
      if (result?.success) {
        const cardPath = (result as any).cardPath || (result as any).id;
        globalThis.dispatchEvent(new CustomEvent('axiom:toast', { detail: { message: `创建永久卡片: ${params.title}`, type: 'card' } }));
        return {
          content: [{ type: 'text', text: `永久卡片已创建: ${params.title} (${cardPath})` }],
          details: { title: params.title, id: cardPath, cardPath },
        };
      }
      return {
        content: [{ type: 'text', text: `创建失败: ${result?.error || '未知错误'}` }],
        details: { error: result?.error },
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `错误: ${(error as Error).message}` }],
        details: { error: (error as Error).message },
      };
    }
  }
);


const searchCardsTool = createTool(
  'search_cards',
  '搜索卡片',
  '在 Vault 中搜索卡片（使用全文搜索索引，支持中英文混合查询）',
  Type.Object({
    query: Type.String({ description: '搜索关键词' }),
    type: Type.Optional(Type.String({ description: '卡片类型: literature, fleeting, permanent' })),
    limit: Type.Optional(Type.Number({ description: '返回结果数量限制' })),
  }),
  async (_id, params) => {
    try {
      const vaultPath = getVaultPath();
      if (!vaultPath) {
        return {
          content: [{ type: 'text', text: '错误: 未打开 Vault' }],
          details: { error: 'No vault open' },
        };
      }
      const type = params.type || 'all';
      const limit = params.limit || 10;

      // 优先使用 FTS 全文搜索
      try {
        const ftsResult = await axiom.ftsSearch?.(vaultPath, params.query, limit);
        if (ftsResult?.success && ftsResult.results && ftsResult.results.length > 0) {
          let ftsResults = ftsResult.results;
          // 按 type 过滤
          if (type !== 'all') {
            ftsResults = ftsResults.filter((r: any) => r.type === type);
          }
          const summary = ftsResults
            .slice(0, limit)
            .map((r: any) => `[${r.type}] ${r.title}${r.snippet ? ' — ' + r.snippet.slice(0, 80) : ''}`)
            .join('\n');
          return {
            content: [{ type: 'text', text: `找到 ${ftsResults.length} 个结果:\n${summary}` }],
            details: { query: params.query, results: ftsResults.slice(0, limit), engine: 'fts' },
          };
        }
      } catch (ftsErr) {
        console.debug('[search_cards] FTS failed, falling back to client scan:', ftsErr);
      }

      // Fallback: 客户端扫描
      let results: any[] = [];
      if (type === 'all' || type === 'permanent') {
        const permResult = await axiom.loadPermanent?.(vaultPath);
        if (permResult?.success && permResult.data) {
          results = results.concat(
            permResult.data
              .filter((c: any) =>
                c.title?.toLowerCase().includes(params.query.toLowerCase()) ||
                c.content?.toLowerCase().includes(params.query.toLowerCase())
              )
              .slice(0, limit)
              .map((c: any) => ({ ...c, cardType: 'permanent' }))
          );
        }
      }
      if (type === 'all' || type === 'fleeing') {
        const fleeResult = await axiom.loadPermanent?.(vaultPath);
        if (fleeResult?.success && fleeResult.data) {
          results = results.concat(
            fleeResult.data
              .filter((c: any) =>
                c.content?.toLowerCase().includes(params.query.toLowerCase())
              )
              .slice(0, limit)
              .map((c: any) => ({ ...c, cardType: 'fleeing' }))
          );
        }
      }
      const summary = results
        .slice(0, limit)
        .map((c: any) => `[${c.cardType}] ${c.title || c.content?.slice(0, 50)}`)
        .join('\n');
      return {
        content: [{ type: 'text', text: `找到 ${results.length} 个卡片:\n${summary || '(无匹配)'}` }],
        details: { query: params.query, results: results.slice(0, limit), engine: 'scan' },
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `错误: ${(error as Error).message}` }],
        details: { error: (error as Error).message },
      };
    }
  }
);


const readSkillTool = createTool(
  'read_skill',
  '读取技能文档',
  '读取指定的 Skill 完整内容。只在需要使用该 Skill 时调用。不要一次读取多个 Skill。',
  Type.Object({
    skillName: Type.String({ description: 'Skill 名称，如 axiom-learning, competition-creative' }),
  }),
  async (_id, params) => {
    try {
      const { getSkillRegistry } = await import('../skills/SkillRegistry');
      const registry = getSkillRegistry();
      const skillContent = await registry.loadSkillContent(params.skillName);

      if (skillContent) {
        if (params.skillName.includes('learning')) {
          try {
            globalThis.dispatchEvent(new CustomEvent('axiom:start-learning-session', {
              detail: { skillName: params.skillName },
            }));
          } catch { /* non-fatal */ }
        }

        return {
          content: [{ type: 'text', text: `Skill "${skillContent.name}" loaded:\n\n${skillContent.content}` }],
          details: { skillName: skillContent.name },
        };
      }
      return {
        content: [{ type: 'text', text: `Skill not found: ${params.skillName}. Available skills: ${registry.getAllSkills().map(s => s.name).join(', ')}` }],
        details: { available: registry.getAllSkills().map(s => s.name) },
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `错误: ${(error as Error).message}` }],
        details: { error: (error as Error).message },
      };
    }
  }
);


const listSkillsTool = createTool(
  'list_skills',
  '列出可用技能',
  '列出所有可用的 Skills（仅名称和描述）',
  Type.Object({}),
  async (_id, _params) => {
    try {
      const { getSkillRegistry } = await import('../skills/SkillRegistry');
      const registry = getSkillRegistry();
      const skills = registry.getAllSkills();

      const list = skills
        .map(s => `- **${s.name}**: ${s.description}`)
        .join('\n');

      return {
        content: [{ type: 'text', text: `可用 Skills (${skills.length}):\n\n${list || '(无)'}` }],
        details: { count: skills.length, skills: skills.map(s => ({ name: s.name, description: s.description })) },
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `错误: ${(error as Error).message}` }],
        details: { error: (error as Error).message },
      };
    }
  }
);


const deleteSkillTool = createTool(
  'delete_skill',
  '删除技能',
  '删除用户自定义的 Skill。系统内置 Skill 不可删除。',
  Type.Object({
    skillName: Type.String({ description: '要删除的 Skill 名称' }),
    force: Type.Optional(Type.Boolean({ description: '设为 true 可跳过确认直接删除' })),
  }),
  async (_id, params) => {
    try {
      const { getSkillRegistry } = await import('../skills/SkillRegistry');
      const registry = getSkillRegistry();

      // Confirmation gate (对标 D-14)
      if (!params.force) {
        globalThis.dispatchEvent(new CustomEvent('axiom:ask-user', {
          detail: {
            question: `确认删除 Skill: ${params.skillName}？`,
            context: { tool: 'delete_skill', args: params },
          },
        }));
        return {
          content: [{ type: 'text', text: `请确认是否删除 Skill "${params.skillName}"。确认后我将执行操作。` }],
          details: { awaitingConfirmation: true },
        };
      }

      const result = await registry.deleteSkill(params.skillName);
      if (!result.success) {
        return {
          content: [{ type: 'text', text: `删除 Skill 失败: ${(result as any).error}` }],
          details: { error: (result as any).error },
        };
      }
      return {
        content: [{ type: 'text', text: `Skill "${params.skillName}" 已删除。` }],
        details: { skillName: params.skillName },
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `错误: ${(error as Error).message}` }],
        details: { error: (error as Error).message },
      };
    }
  }
);


const updateSkillTool = createTool(
  'update_skill',
  '更新技能',
  '更新用户自定义 Skill 的描述和内容。系统内置 Skill 不可修改。',
  Type.Object({
    skillName: Type.String({ description: '要更新的 Skill 名称' }),
    description: Type.String({ description: '新的 Skill 描述' }),
    content: Type.String({ description: '新的 Skill 内容（完整替换）' }),
  }),
  async (_id, params) => {
    try {
      const { getSkillRegistry } = await import('../skills/SkillRegistry');
      const registry = getSkillRegistry();

      const result = await registry.updateSkill(params.skillName, params.description, params.content);
      if (!result.success) {
        return {
          content: [{ type: 'text', text: `更新 Skill 失败: ${(result as any).error}` }],
          details: { error: (result as any).error },
        };
      }
      return {
        content: [{ type: 'text', text: `Skill "${params.skillName}" 已更新。` }],
        details: { skillName: params.skillName },
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `错误: ${(error as Error).message}` }],
        details: { error: (error as Error).message },
      };
    }
  }
);


const deleteCardTool = createTool(
  'delete_card',
  '删除卡片',
  '删除 Vault 中的卡片（文献、灵感卡片、永久卡片）。默认软删除（移动到 .axiom/trash/，可恢复）。',
  Type.Object({
    cardPath: Type.String({ description: '要删除的卡片路径（相对于 Vault 根目录，如 "permanent/concept.md"）' }),
    force: Type.Optional(Type.Boolean({ description: '设为 true 可跳过确认直接删除' })),
  }),
  async (_id, params) => {
    try {
      const vaultPath = getVaultPath();
      if (!vaultPath) {
        return {
          content: [{ type: 'text', text: '未打开 Vault。' }],
          details: { error: 'No vault open' },
        };
      }

      // Confirmation gate (对标 D-14)
      if (!params.force) {
        globalThis.dispatchEvent(new CustomEvent('axiom:ask-user', {
          detail: {
            question: `确认删除卡片: ${params.cardPath}？删除后可通过 .axiom/trash/ 恢复。`,
            context: { tool: 'delete_card', args: params },
          },
        }));
        return {
          content: [{ type: 'text', text: `请确认是否删除卡片 "${params.cardPath}"。确认后我将执行操作。` }],
          details: { awaitingConfirmation: true },
        };
      }

      // Soft-delete via (axiom as any).softDelete (对标 D-10, D-13)
      const fileStorage = getFileStorage()
const axiom = createAxiomCompat(fileStorage);
      if (!axiom) {
        return {
          content: [{ type: 'text', text: '错误: 系统 API 不可用' }],
          details: { error: 'axiom API not available' },
        };
      }
      const resolvedPath = params.cardPath.startsWith('/')
        ? params.cardPath
        : `${vaultPath}/${params.cardPath}`;

      if ((axiom as any).softDelete) {
        const result = await (axiom as any).softDelete(vaultPath, params.cardPath);
        if (!result.success) {
          return {
            content: [{ type: 'text', text: `删除卡片失败: ${(result as any).error || '未知错误'}` }],
            details: { error: (result as any).error },
          };
        }
        return {
          content: [{ type: 'text', text: `卡片已移动到回收站: ${params.cardPath}\n可通过 .axiom/trash/ 恢复。` }],
          details: { cardPath: params.cardPath, trashPath: result.trashPath },
        };
      }

      // Fallback: use deleteCard API
      if (!(axiom as any).deleteCard) {
        return {
          content: [{ type: 'text', text: '错误: 删除操作不可用' }],
          details: { error: 'deleteCard API not available' },
        };
      }
      const result = await (axiom as any).deleteCard(vaultPath, params.cardPath);
      return {
        content: [{ type: 'text', text: result.success ? `卡片已删除: ${params.cardPath}` : `删除失败: ${(result as any).error}` }],
        details: { cardPath: params.cardPath, success: result.success },
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `错误: ${(error as Error).message}` }],
        details: { error: (error as Error).message },
      };
    }
  }
);


const addGraphNodeTool = createTool(
  'add_graph_node',
  '添加知识图谱节点',
  '向知识图谱中添加一个新概念节点。节点会作为 permanent 卡片持久化。',
  Type.Object({
    title: Type.String({ description: '概念名称' }),
    definition: Type.String({ description: '概念定义' }),
    difficulty: Type.Optional(Type.Number({ description: '难度等级 1-5，默认 3' })),
    domain: Type.Optional(Type.String({ description: '所属领域，默认 general' })),
  }),
  async (_id, params) => {
    try {
      const vaultPath = getVaultPath();
      if (!vaultPath) {
        return { content: [{ type: 'text', text: '未打开 Vault。' }], details: {} };
      }

      const fileStorage = getFileStorage()
const axiom = createAxiomCompat(fileStorage);
      if (!axiom?.createPermanent) {
        return { content: [{ type: 'text', text: '创建卡片功能不可用。' }], details: {} };
      }

      // Create as permanent card
      const content = params.definition || `# ${params.title}\n\n${params.definition || ''}`;
      const result = await (axiom as any).createPermanent(
        vaultPath,
        params.title,
        'concept',
        content,
        { literature: [], fleeing: [] }
      );

      if (!result.success) {
        return {
          content: [{ type: 'text', text: `添加节点失败: ${(result as any).error || '未知错误'}` }],
          details: { error: (result as any).error },
        };
      }

      return {
        content: [{ type: 'text', text: `概念 "${params.title}" 已添加到知识图谱。` }],
        details: { title: params.title, cardTitle: (result as any).title || params.title },
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `错误: ${(error as Error).message}` }],
        details: { error: (error as Error).message },
      };
    }
  }
);


const addGraphEdgeTool = createTool(
  'add_graph_edge',
  '添加知识图谱关系',
  '在知识图谱中两个概念节点之间添加关系边。概念可以是灵感卡片或永久卡片。',
  Type.Object({
    source: Type.String({ description: '源概念名称（灵感或永久卡片标题）' }),
    target: Type.String({ description: '目标概念名称（灵感或永久卡片标题）' }),
    type: Type.Optional(Type.String({ description: '关系类型: prerequisite(前置), related(相关), suggests(推荐), 默认 related' })),
    strength: Type.Optional(Type.Number({ description: '关系强度 0-1，默认 0.8' })),
  }),
  async (_id, params) => {
    try {
      const vaultPath = getVaultPath();
      if (!vaultPath) {
        return { content: [{ type: 'text', text: '未打开 Vault。' }], details: {} };
      }

      const fileStorage = getFileStorage()
const axiom = createAxiomCompat(fileStorage);
      if (!(axiom as any)?.loadCard || !(axiom as any)?.updateCard) {
        return { content: [{ type: 'text', text: '卡片操作功能不可用。' }], details: {} };
      }

      // 尝试加载源卡片（先永久、后灵感）
      let sourceResult = await (axiom as any).loadCard(vaultPath, `permanent/${params.source}.md`);
      let sourceType = 'permanent';
      if (!sourceResult.success || !sourceResult.card) {
        sourceResult = await (axiom as any).loadCard(vaultPath, `fleeting/${params.source}.md`);
        sourceType = 'fleeting';
      }
      if (!sourceResult.success || !sourceResult.card) {
        return {
          content: [{ type: 'text', text: `源概念 "${params.source}" 不存在（未在灵感盒或永久盒中找到）。` }],
          details: { error: `Source card not found: ${params.source}` },
        };
      }

      const card = sourceResult.card;
      const links = card.links || { to: [], from: [] };
      if (!links.to.includes(params.target)) {
        links.to.push(params.target);
      }

      await (axiom as any).updateCard(vaultPath, `${sourceType}/${params.source}.md`, { ...card, links }, card.content || '');

      return {
        content: [{ type: 'text', text: `关系已添加: ${params.source} --[${params.type || 'related'}]--> ${params.target}` }],
        details: { source: params.source, target: params.target, type: params.type || 'related', strength: params.strength || 0.8 },
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `错误: ${(error as Error).message}` }],
        details: { error: (error as Error).message },
      };
    }
  }
);


export function registerCardTools(): void {
  toolRegistry.register(createFleeingCardTool);
  toolRegistry.register(createPermanentCardTool);
  toolRegistry.register(searchCardsTool);
  toolRegistry.register(readSkillTool);
  toolRegistry.register(listSkillsTool);
  toolRegistry.register(deleteSkillTool);
  toolRegistry.register(updateSkillTool);
  toolRegistry.register(deleteCardTool);
  toolRegistry.register(addGraphNodeTool);
  toolRegistry.register(addGraphEdgeTool);
}
