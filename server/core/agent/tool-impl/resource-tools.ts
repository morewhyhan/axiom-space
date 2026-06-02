/**
 * AXIOM 内置工具 - 资源生成
 */

import { createAxiomCompat } from '@/server/infra/storage/AxiomCompat'
import { getFileStorage } from '@/server/infra/storage/GlobalFileStorage'
import { Type } from "@mariozechner/pi-ai";
const axiom = createAxiomCompat(getFileStorage());

import { createTool, toolRegistry } from "../tools";
import { getVaultPath } from "./helpers";
import { getCurrentUserId, getCurrentVaultId } from '@/server/core/agent/agent-context';
import { prisma } from '@/lib/db';
import { emitNotification } from '../notification-bus';

/** Persist a resource generation record to DB (fire-and-forget, scoped by userId+vaultId) */
function persistResourceToDb(userId: string, topic: string, types: string[], detail: Record<string, any>): void {
  const vaultId = getCurrentVaultId() || 'novault'
  const sessionId = `resource-${userId}-${vaultId}`
  prisma.learningSession.upsert({
    where: { id: sessionId },
    create: {
      id: sessionId,
      userId,
      domain: '__resource__',
      concept: '资源生成记录',
      status: 'active',
      phase: 'generation',
    },
    update: { updatedAt: new Date() },
  }).then((session) => {
    prisma.learningMessage.create({
      data: {
        sessionId: session.id,
        role: 'system',
        content: `[资源生成] ${topic} — ${types.join(', ')}`,
        metadata: JSON.stringify({ topic, types, ...detail }),
      },
    }).catch(() => {});
  }).catch(() => {});
}

const pushResourceTool = createTool(
  'push_resource',
  '推送学习资源到文献盒',
  '为当前学习主题生成全套学习资源（文档、思维导图、练习题、教学视频）并保存到文献盒。'
  + '【关键时机】当用户说"整理成学习资料"、"保存到文献盒"、"记录下来"、"生成资料"、"生成文档"、"创建学习资源"等类似请求时，必须直接调用此工具。'
  + '用户水平自动从画像推断，无需询问用户。自动跳过已有资源。',
  Type.Object({
    topic: Type.String({ description: '学习主题（必填）。从对话上下文或用户消息中提取。' }),
    level: Type.Optional(Type.String({ description: '可选。不填则自动从 .axiom/user-profile.json 读取。' })),
    literatureTitle: Type.Optional(Type.String({ description: '关联的文献标题。' })),
    literatureContent: Type.Optional(Type.String({ description: '文献内容截取。' })),
  }),
  async (_id, params) => {
    try {
      const vaultPath = getVaultPath();
      if (!vaultPath) {
        return {
          content: [{ type: 'text', text: '错误: 未打开 Vault，请先选择一个目录。' }],
          details: { error: 'No vault open' },
        };
      }

      // Determine user level: params.level > DB profile > default
      let userLevel = params.level || process.env.AXIOM_USER_LEVEL || '';
      if (!userLevel) {
        try {
          const { loadUserProfile } = await import('@/server/core/learning/memory/profile-manager');
          const profile = await loadUserProfile(vaultPath);
          userLevel = profile?.identity?.level || profile?.level || 'intermediate';
        } catch { userLevel = 'intermediate'; }
      }
      if (!userLevel) userLevel = 'intermediate';

      // Use topic as fallback literature title
      const litTitle = params.literatureTitle || params.topic;

      // Dynamic imports for cross-module dependencies
      const { ResourceGenerationOrchestrator } = await import('../ResourceGenerationOrchestrator');
      const { ResourceGenerationState, RESOURCE_FILE_MAP, RESOURCE_TYPES } = await import('../ResourceGenerationState');
      const { aiManager } = await import('../../ai/AIManager');

      // Build OrchestratorDeps with real IPC-backed implementations
      const deps = {
        callLLM: async (systemPrompt: string, userMessage: string): Promise<string> => {
          return aiManager.callAPI(systemPrompt, [{ role: 'user', content: userMessage }]);
        },
        resourceExists: async (type: string, literatureTitle: string): Promise<boolean> => {
          const fileName = (RESOURCE_FILE_MAP as Record<string, string>)[type];
          if (!fileName) return false;
          const resourceDir = `${vaultPath}/resources/${literatureTitle.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '')}`;
          const fullPath = `${resourceDir}/${fileName}`;
          const result = await getFileStorage().readFile(fullPath);
          return result?.success === true;
        },
        saveResource: async (type: string, literatureTitle: string, content: string): Promise<void> => {
          const fileName = (RESOURCE_FILE_MAP as Record<string, string>)[type];
          if (!fileName) return;
          const resourceDir = `resources/${literatureTitle.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '')}`;
          await getFileStorage().ensureDir(`${vaultPath}/${resourceDir}`);
          const fullPath = `${vaultPath}/${resourceDir}/${fileName}`;
          const result = await getFileStorage().writeFile(fullPath, content);
          if (!result?.success) {
            throw new Error(result?.error || 'Failed to save resource file');
          }
        },
      };

      const state = new ResourceGenerationState();
      const orchestrator = new ResourceGenerationOrchestrator(state, deps);

      await orchestrator.orchestrate(params.topic, userLevel, litTitle, params.literatureContent);

      // 读取生成的资源，合并为一个文献卡片
      const sanitizedDir = litTitle.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
      const resourceDir = `${vaultPath}/resources/${sanitizedDir}`;
      const sections: string[] = [];
      let generatedCount = 0;

      for (const type of RESOURCE_TYPES) {
        if (state.getStatus(type) !== 'completed') continue;
        try {
          const fileName = RESOURCE_FILE_MAP[type];
          const result = await getFileStorage().readFile(`${resourceDir}/${fileName}`);
          if (result?.success && result.content) {
            if (type === 'video') {
              // Embed a reference marker instead of the full HTML.
              // The forge-editor will detect this and load the video HTML via API.
              const videoRef = `resources/${sanitizedDir}/${fileName}`;
              sections.push(`> 📺 **教学视频已生成** — 在 READ 模式下自动播放\n\n<!-- axiom-video:${videoRef} -->`);
            } else {
              sections.push(result.content);
            }
            generatedCount++;
          }
        } catch (err) { console.warn('[ResourceTools] Failed to read generated resource:', err); }
      }

      if (sections.length === 0) {
        return {
          content: [{ type: 'text', text: `资源生成失败：未生成任何有效内容。` }],
          details: { error: 'No content generated' },
        };
      }

      // 合并为一个文件，直接放 literature/ 文献盒
      const litDir = `${vaultPath}/literature`;
      await getFileStorage().ensureDir(litDir);
      const litFileName = `lit-${Date.now()}.md`;
      const fullContent = `---
title: "${params.topic}"
source_type: ai
source: AI 自动生成
created: ${new Date().toISOString()}
tags: [ai-generated, ${params.topic}]
---

${sections.join('\n\n---\n\n')}
`;
      await getFileStorage().writeFile(`${litDir}/${litFileName}`, fullContent);

      // Also create a DB Card record for the literature so it appears in galaxy/knowledge graph
      try {
        const { prisma: litDb } = await import('@/lib/db');
        const { getCurrentVaultId } = await import('@/server/core/agent/agent-context');
        const litVid = getCurrentVaultId();
        if (litVid) {
          await litDb.card.upsert({
            where: { vaultId_path: { vaultId: litVid, path: `literature/${litFileName}` } },
            create: {
              vaultId: litVid,
              path: `literature/${litFileName}`,
              title: params.topic,
              content: fullContent.slice(0, 10000),
              type: 'literature',
              tags: JSON.stringify(['ai-generated', params.topic]),
            },
            update: {
              content: fullContent.slice(0, 10000),
              updatedAt: new Date(),
            },
          });
        }
      } catch (dbErr) {
        console.warn('[push_resource] Failed to create DB literature card:', dbErr);
      }

      console.log(`[Event] axiom:toast — card: 生成学习资料: ${params.topic}`);
      const srcVaultId = getCurrentVaultId();
      if (srcVaultId) {
        emitNotification(srcVaultId, { type: 'toast', message: `card: 生成学习资料: ${params.topic}` });
      }

      return {
        content: [{
          type: 'text',
          text: `学习资料已放入文献盒。「${params.topic}」包含文档、导图、练习题、教学视频，点开即可阅读。`,
        }],
        details: { topic: params.topic, userLevel, types_generated: generatedCount },
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `资源生成失败: ${(error as Error).message}` }],
        details: { error: (error as Error).message },
      };
    }
  }
);


const extractCardsTool = createTool(
  'extract_cards',
  '提取概念卡片',
  '从文献内容中提取所有符合条件的核心概念，为每个概念创建一张灵感卡片。'
  + '每张卡片包含：定义（概念是什么）、关联（[[wiki链接]]到相关概念）、例子（至少一个具体示例）。'
  + '提取的卡片会自动关联回源文献。',
  Type.Object({
    literatureTitle: Type.String({ description: '要提取的文献标题' }),
    literatureContent: Type.String({ description: '文献完整内容（LLM从中提取概念）' }),
    auto: Type.Optional(Type.Boolean({ description: '是否自动执行无需用户确认。true=直接提取，false=先列候选再确认。默认false。' })),
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

      // Step 1: If not auto, list candidates and ask user for confirmation
      if (!params.auto) {
        const { aiManager } = await import('../../ai/AIManager');
        const candidatePrompt = `你是文献概念识别专家。从以下文献内容中，列出所有符合以下条件的核心概念名称（仅返回名称，每行一个，不要序号）：

1. 在文献中有明确的定义或解释
2. 有清晰的边界，不是模糊的泛称
3. 该概念可以复用到该文献之外的场景

文献标题：${params.literatureTitle}
文献内容：
${params.literatureContent.slice(0, 8000)}

仅返回概念名称列表，每行一个。

## ⚠️ 强制输出语言：中文
所有内容必须用中文输出。专有名词保留原文。`;

        const candidateResult = await aiManager.callAPI(
          '你是一个精确的概念识别专家。只输出概念名称列表。内部推理即可，不要输出思考过程。直接返回 JSON 结果。',
          [{ role: 'user', content: candidatePrompt }],
        );

        const candidates = candidateResult
          .split('\n')
          .map(line => line.replace(/^[\d.\s-]+/, '').trim())
          .filter(line => line.length > 0);

        if (candidates.length === 0) {
          return {
            content: [{ type: 'text', text: `从《${params.literatureTitle}》中未识别出符合条件的核心概念。` }],
            details: { candidates: [], literature: params.literatureTitle },
          };
        }

        const conceptList = candidates.map((c, i) => `${i + 1}. ${c}`).join('\n');

        console.warn('[Event] axiom:ask-user dispatched on server — no client to respond. Returning fallback.');

        return {
          content: [{ type: 'text', text: `从《${params.literatureTitle}》中识别到 ${candidates.length} 个候选概念。请确认是否提取。` }],
          details: { awaitingConfirmation: true, candidates, literature: params.literatureTitle },
        };
      }

      // Step 2: Perform full extraction (auto=true or confirmed)
      const { aiManager } = await import('../../ai/AIManager');
      const extractionPrompt = `你是文献概念提取专家。从给定的文献内容中提取所有重要的核心概念。

提取标准（必须全部满足）：
1. 概念在文献中有明确的定义或解释（不是仅提及）
2. 概念有清晰的边界，不是模糊的泛称
3. 该概念可以复用到该文献之外的场景

对于每个提取的概念，请生成以下内容：
- title: 概念名称（简短）
- definition: 概念的定义，用自己的话清晰解释（2-4句）
- associations: 该概念关联的其他概念名称数组，这些概念在文献中或你自己的知识体系中出现（用于 [[wikilinks]]）
- examples: 至少一个具体例子（来自文献或现实生活）
- tags: 标签数组（用于分类）

以JSON数组格式返回（严格JSON，不要 \`\`\`json 包裹，不要任何其他文字）：
[
  {
    "title": "概念名称",
    "definition": "概念定义...",
    "associations": ["相关概念1", "相关概念2"],
    "examples": ["具体例子1"],
    "tags": ["标签1", "标签2"]
  }
]

注意事项：
- 只提取在文献中 EXPLICITLY 定义或解释的概念，不要编造
- 典型数量：3-10个，视文献密度而定
- 宁缺毋滥：不确定的概念不要提取

文献标题：${params.literatureTitle}
文献内容：
${params.literatureContent.slice(0, 8000)}

## ⚠️ 强制输出语言：中文
所有内容必须用中文输出。专有名词保留原文。`;

      const llmResult = await aiManager.callAPI(
        '你是一个精确的概念提取专家。严格按照JSON格式返回。内部推理即可，不要输出思考过程。直接返回 JSON 结果。',
        [{ role: 'user', content: extractionPrompt }],
      );

      // Parse JSON response
      let concepts: Array<{ title: string; definition: string; associations: string[]; examples: string[]; tags: string[] }>;
      try {
        const jsonMatch = llmResult.match(/\[[\s\S]*\]/);
        if (!jsonMatch) throw new Error('No JSON array found in response');
        concepts = JSON.parse(jsonMatch[0]);
        if (!Array.isArray(concepts)) throw new Error('Response is not an array');
        // Validate each concept has required fields and substantive content
        concepts = concepts.filter(c => {
          if (!c.title?.trim()) return false;
          if (!c.definition?.trim()) return false;
          // Reject concepts with trivial definitions (<50 chars = too shallow)
          if (c.definition.trim().length < 50) {
            console.warn(`[extract_cards] Skipping "${c.title}" — definition too short (${c.definition.length} chars)`);
            return false;
          }
          // Reject concepts without at least 1 association
          if (!c.associations || c.associations.length === 0) {
            console.warn(`[extract_cards] Skipping "${c.title}" — no associations`);
            return false;
          }
          // Reject concepts without at least 1 example
          if (!c.examples || c.examples.length === 0) {
            console.warn(`[extract_cards] Skipping "${c.title}" — no examples`);
            return false;
          }
          return true;
        });
      } catch (parseError) {
        return {
          content: [{ type: 'text', text: `LLM 返回解析失败: ${(parseError as Error).message}\n\n原始返回:\n${llmResult}` }],
          details: { error: 'LLM JSON parse failed', rawOutput: llmResult },
        };
      }

      if (concepts.length === 0) {
        return {
          content: [{ type: 'text', text: `从《${params.literatureTitle}》中未提取到符合条件的核心概念。` }],
          details: { concepts: [], literature: params.literatureTitle },
        };
      }

      // Step 3: Create DB card records for each concept
      const createdCards: Array<{ title: string; id?: string }> = [];
      const { prisma: pdb } = await import('@/lib/db');
      const { getCurrentVaultId } = await import('@/server/core/agent/agent-context');
      const vid = getCurrentVaultId();

      if (!vid) {
        return {
          content: [{ type: 'text', text: '错误: 未找到当前 Vault' }],
          details: { error: 'No vault id in context' },
        };
      }

      for (const concept of concepts) {
        const cardContent = `# ${concept.title}

## 定义
${concept.definition}

## 关联
${(concept.associations || []).map(a => `[[${a}]]`).join(' ')}

## 例子
${(concept.examples || []).map(e => `- ${e}`).join('\n')}

> 来源：[[${params.literatureTitle}]]`;

        try {
          const safeTitle = concept.title.replace(/[\/\\]/g, '_').replace(/\.+/g, '_').slice(0, 100);
          const card = await pdb.card.create({
            data: {
              vaultId: vid,
              path: `fleeting/${safeTitle}.md`,
              title: concept.title,
              content: cardContent,
              type: 'fleeting',
              tags: JSON.stringify(concept.tags || []),
            },
          });
          createdCards.push({ title: concept.title, id: card.id });
        } catch (cardError) {
          console.warn(`[extract_cards] Failed to create card for "${concept.title}":`, cardError);
          createdCards.push({ title: concept.title });
        }
      }

      // Step 4: Link extracted cards to source literature via edges
      try {
        const sourceCard = await pdb.card.findFirst({
          where: { vaultId: vid, title: params.literatureTitle, type: 'literature' },
          select: { id: true },
        });
        if (sourceCard) {
          for (const c of createdCards) {
            if (!c.id) continue;
            await pdb.edge.create({
              data: {
                vaultId: vid,
                sourceId: sourceCard.id,
                targetId: c.id,
                type: 'derived',
                weight: 1,
              },
            }).catch(() => {});
          }
        }
      } catch (updateError) {
        console.warn('[extract_cards] Failed to link cards to literature:', updateError);
      }

      const conceptNames = concepts.map(c => c.title).join('、');
      return {
        content: [{ type: 'text', text: `从《${params.literatureTitle}》中提取了 ${concepts.length} 个概念: ${conceptNames}\n已创建 ${createdCards.length} 张灵感卡片并关联回源文献。` }],
        details: {
          concepts: concepts.map(c => ({ title: c.title, tags: c.tags })),
          literature: params.literatureTitle,
          cardsCreated: createdCards.length,
        },
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `提取概念失败: ${(error as Error).message}` }],
        details: { error: (error as Error).message },
      };
    }
  }
);


const generatePptTool = createTool(
  'generate_ppt',
  '生成 PPT 文件',
  '生成一个真实的 .pptx PowerPoint 文件并放入文献盒。只需提供主题，工具内部自动生成幻灯片内容。用户说"生成PPT"、"做个演示文稿"、"给我一个ppt"时直接调用，不要手动写文件。',
  Type.Object({
    topic: Type.String({ description: 'PPT 主题，从对话上下文提取' }),
    slides: Type.Optional(Type.String({ description: '可选。PPT 内容，每页用 --- 分隔。不填则工具内部自动生成。' })),
  }),
  async (_id, params) => {
    try {
      const vaultPath = getVaultPath();
      if (!vaultPath) return { content: [{ type: 'text', text: '错误: 未打开 Vault。' }], details: {} };

      // 如果没有提供 slides，内部调 LLM 生成
      let slidesText = params.slides || '';
      if (!slidesText) {
        const { aiManager } = await import('../../ai/AIManager');
        const prompt = `生成一份关于"${params.topic}"的PPT内容。每页用 --- 分隔。每页格式：# 标题\\n- 要点1\\n- 要点2...。至少8页，包括封面和总结页。不要用emoji。内部推理即可，不要输出思考过程。直接返回 JSON 结果。`;
        slidesText = await aiManager.callAPI(prompt, [{ role: 'user', content: `主题: ${params.topic}

## ⚠️ 强制输出语言：中文
所有内容必须用中文输出。专有名词保留原文。` }]);
        if (!slidesText || slidesText.trim().length < 50) {
          return { content: [{ type: 'text', text: 'PPT 内容生成失败，请重试。' }], details: {} };
        }
      }

      const slides = slidesText.split(/\n---\n/).filter((s: string) => s.trim());
      if (slides.length < 3) {
        return { content: [{ type: 'text', text: 'PPT 内容不足，至少需要3页幻灯片。' }], details: {} };
      }

      // 调主进程生成 PPTX
      const generatePptx = (axiom as any).generatePptx;
      if (typeof generatePptx !== 'function') {
        return { content: [{ type: 'text', text: 'PPT 生成功能不可用，请重启应用。' }], details: {} };
      }
      const result = await generatePptx(params.topic, slidesText, vaultPath);
      if (!result?.success) {
        return { content: [{ type: 'text', text: `PPT 生成失败: ${result?.error || '未知错误'}` }], details: {} };
      }

      console.log(`[Event] axiom:toast — card: 生成 PPT: ${params.topic} (${result.slides}页)`);
      const pptVaultId = getCurrentVaultId();
      if (pptVaultId) {
        emitNotification(pptVaultId, { type: 'toast', message: `card: 生成 PPT: ${params.topic}` });
      }

      return {
        content: [{ type: 'text', text: `PPT 已生成！"${params.topic}" ${result.slides} 页，文献盒中可查看。刷新文献列表即可看到。` }],
        details: { topic: params.topic, slides: result.slides, file: result.file },
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `PPT 生成失败: ${(error as Error).message}` }],
        details: { error: (error as Error).message },
      };
    }
  }
);


export function registerResourceTools(): void {
  toolRegistry.register(pushResourceTool);
  toolRegistry.register(extractCardsTool);
  toolRegistry.register(generatePptTool);
}
