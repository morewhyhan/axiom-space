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
import { emitNotification, emitResourceProgress } from '../notification-bus';

const RESOURCE_LABELS: Record<string, string> = {
  document: '学习文档',
  mindmap: '思维导图',
  quiz: '练习题',
  video: '教学视频',
  svg: 'SVG 图解',
  diagram: 'Mermaid 图表',
  docx: 'Word 文档',
  pdf: 'PDF 文档',
  ppt: 'PPT 演示文稿',
};

type ResourceOrchestrationEvidence = {
  id: string;
  status: string;
  progress: number;
  durationMs: number | null;
  agents: Array<{
    role: string;
    task: string;
    status: string;
    error?: string;
  }>;
  logs: Array<{
    agent: string;
    level: string;
    message: string;
  }>;
};

/** Persist a resource generation record to DB (fire-and-forget, scoped by userId+vaultId) */
function persistResourceToDb(userId: string, topic: string, types: string[], detail: Record<string, any>): void {
  const vaultId = getCurrentVaultId()
  const sessionVaultId = vaultId || 'novault'
  const sessionId = `resource-${userId}-${sessionVaultId}`
  prisma.learningSession.upsert({
    where: { id: sessionId },
    create: {
      id: sessionId,
      userId,
      vaultId: vaultId || null,
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
  '为当前学习主题生成全套学习资料并保存到文献盒。支持 9 种格式：'
  + '📄 文档(markdown)、🧠 思维导图(mermaid)、❓ 练习题(JSON)、🎬 教学视频(HTML/MP4)、'
  + '📊 SVG矢量图、🔀 Mermaid流程图/时序图/类图等、📝 Word文档(docx)、📑 PDF文档、📽️ PPT演示文稿。'
  + '【关键时机】当用户说"整理成学习资料"、"保存到文献盒"、"生成文档"、"导出Word"、"导出PDF"、"做个PPT"'
  + '"画个流程图"、"生成SVG"等类似请求时，必须直接调用此工具。不填 formats 则生成全部格式。'
  + '用户水平自动从画像推断，无需询问用户。自动跳过已有资源。',
  Type.Object({
    topic: Type.String({ description: '学习主题（必填）。从对话上下文或用户消息中提取。' }),
    level: Type.Optional(Type.String({ description: '可选。不填则自动从 .axiom/user-profile.json 读取。' })),
    literatureTitle: Type.Optional(Type.String({ description: '关联的文献标题。' })),
    literatureContent: Type.Optional(Type.String({ description: '文献内容截取。' })),
    formats: Type.Optional(Type.String({ description: '可选。指定生成的格式，逗号分隔。如 "svg,diagram" 只生成SVG和图表。不填则生成全部9种格式。可用值: document,mindmap,quiz,video,svg,diagram,docx,pdf,ppt' })),
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
      const progressVaultId = getCurrentVaultId();

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
          const resourceDir = `resources/${literatureTitle.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '')}`;
          const fullPath = `${resourceDir}/${fileName}`;
          const result = await getFileStorage().readFile(fullPath);
          return result?.success === true;
        },
        saveResource: async (type: string, literatureTitle: string, content: string): Promise<void> => {
          const fileName = (RESOURCE_FILE_MAP as Record<string, string>)[type];
          if (!fileName) return;
          const resourceDir = `resources/${literatureTitle.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '')}`;
          await getFileStorage().ensureDir(resourceDir);
          const fullPath = `${resourceDir}/${fileName}`;
          const result = await getFileStorage().writeFile(fullPath, content);
          if (!result?.success) {
            throw new Error(result?.error || 'Failed to save resource file');
          }
        },
        saveResourceFile: async (literatureTitle: string, fileName: string, content: string): Promise<void> => {
          const resourceDir = `resources/${literatureTitle.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '')}`;
          await getFileStorage().ensureDir(resourceDir);
          const fullPath = `${resourceDir}/${fileName}`;
          const result = await getFileStorage().writeFile(fullPath, content);
          if (!result?.success) {
            throw new Error(result?.error || `Failed to save resource file: ${fileName}`);
          }
        },
        onProgress: (event: {
          type: string;
          status: 'queued' | 'generating' | 'validating' | 'saving' | 'ready' | 'rendering' | 'completed' | 'failed';
          progress: number;
          message: string;
          path?: string;
          fileName?: string;
          error?: string;
        }) => {
          if (!progressVaultId) return;
          emitResourceProgress(progressVaultId, {
            topic: params.topic,
            resourceType: event.type,
            label: RESOURCE_LABELS[event.type] || event.type,
            status: event.status,
            progress: event.progress,
            message: event.message,
            path: event.path,
            fileName: event.fileName,
            error: event.error,
          });
        },
      };

      const state = new ResourceGenerationState();
      const orchestrator = new ResourceGenerationOrchestrator(state, deps);

      const formats = params.formats
        ? params.formats.split(',').map(f => f.trim()).filter(f => (RESOURCE_TYPES as readonly string[]).includes(f))
        : undefined;
      const requestedTypes = formats && formats.length > 0 ? formats : RESOURCE_TYPES;
      const currentUserId = getCurrentUserId();
      let orchestrationEvidence: ResourceOrchestrationEvidence | null = null;
      if (currentUserId) {
        try {
          if (progressVaultId) {
            emitResourceProgress(progressVaultId, {
              topic: params.topic,
              resourceType: 'document',
              label: '多 Agent 协同',
              status: 'generating',
              progress: 2,
              message: 'Profile/Planner/Generator/Reviewer/Pusher 正在协同规划',
            });
          }
          const { orchestrationEngine } = await import('../orchestration-engine');
          const startedAt = Date.now();
          const orchestration = await orchestrationEngine.executeFlow('resource_generation', currentUserId, {
            topic: params.topic,
            vaultId: progressVaultId,
            requestedTypes,
            userLevel,
            literatureTitle: litTitle,
          });
          orchestrationEvidence = {
            id: orchestration.orchestrationId,
            status: orchestration.status,
            progress: orchestration.progress,
            durationMs: orchestration.completedAt ? orchestration.completedAt - startedAt : null,
            agents: orchestration.steps.map((step) => ({
              role: step.agentRole,
              task: step.taskDescription,
              status: step.status,
              error: step.error,
            })),
            logs: orchestration.logs.map((log) => ({
              agent: log.agent,
              level: log.level,
              message: log.message,
            })),
          };
        } catch (err) {
          orchestrationEvidence = {
            id: 'unavailable',
            status: 'failed',
            progress: 0,
            durationMs: null,
            agents: [],
            logs: [{
              agent: 'orchestrator',
              level: 'error',
              message: err instanceof Error ? err.message : String(err),
            }],
          };
        }
      }
      if (progressVaultId) {
        for (const type of requestedTypes) {
          emitResourceProgress(progressVaultId, {
            topic: params.topic,
            resourceType: type,
            label: RESOURCE_LABELS[type] || type,
            status: 'queued',
            progress: 0,
            message: '等待生成',
            fileName: (RESOURCE_FILE_MAP as Record<string, string>)[type],
          });
        }
      }

      const generationResults = await orchestrator.orchestrate(params.topic, userLevel, litTitle, params.literatureContent, formats);

      // 读取生成的资源，合并为一个文献卡片
      const sanitizedDir = litTitle.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
      const resourceDir = `resources/${sanitizedDir}`;
      const sections: string[] = [];
      const resourceManifest: Array<{
        type: string;
        title: string;
        path: string;
        mp4Path?: string;
        fileName: string;
      }> = [];
      let generatedCount = 0;

      for (const type of RESOURCE_TYPES) {
        if (state.getStatus(type) !== 'completed') continue;
        try {
          const fileName = RESOURCE_FILE_MAP[type];
          const resourcePath = `resources/${sanitizedDir}/${fileName}`;
          const result = await getFileStorage().readFile(`${resourceDir}/${fileName}`);
          if (result?.success && result.content) {
            const item = {
              type,
              title: RESOURCE_LABELS[type] || type,
              path: resourcePath,
              fileName,
            };
            if (type === 'video') {
              // Embed a reference marker instead of the full HTML.
              // The forge-editor will detect these and prefer MP4 playback.
              const videoHtmlRef = resourcePath;
              const videoMp4Ref = `resources/${sanitizedDir}/video.mp4`;
              const mp4Result = await getFileStorage().readFile(`${resourceDir}/video.mp4`).catch(() => null);
              resourceManifest.push({
                ...item,
                mp4Path: mp4Result?.success ? videoMp4Ref : undefined,
              });
              sections.push([
                `> 📺 **教学视频已生成** — 在 READ 模式下可预览和播放`,
                '',
                `<!-- axiom-video-html:${videoHtmlRef} -->`,
                mp4Result?.success ? `<!-- axiom-video-mp4:${videoMp4Ref} -->` : '',
                `<!-- axiom-video:${videoHtmlRef} -->`,
              ].filter(Boolean).join('\n'));
            } else if (type === 'mindmap' || type === 'diagram') {
              resourceManifest.push(item);
              sections.push(`## ${RESOURCE_LABELS[type]}\n\n\`\`\`mermaid\n${result.content.trim()}\n\`\`\``);
            } else if (type === 'quiz' || type === 'svg' || type === 'docx' || type === 'pdf' || type === 'ppt') {
              resourceManifest.push(item);
              sections.push(`> **${RESOURCE_LABELS[type]}已生成** — 可在下方资源面板预览、放大或下载。`);
            } else {
              resourceManifest.push(item);
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
      const litDir = `literature`;
      await getFileStorage().ensureDir(litDir);
      const litFileName = `lit-${Date.now()}.md`;
      const litPath = `${litDir}/${litFileName}`;
      const fullContent = `---
title: "${params.topic}"
source_type: ai
source: AI 自动生成
created: ${new Date().toISOString()}
tags: [ai-generated, ${params.topic}]
---

<!-- axiom-resources:${JSON.stringify(resourceManifest)} -->
<!-- axiom-orchestration:${JSON.stringify(orchestrationEvidence)} -->

${orchestrationEvidence ? [
  '## 多 Agent 协同记录',
  '',
  `- 工作流 ID：${orchestrationEvidence.id}`,
  `- 状态：${orchestrationEvidence.status}`,
  `- 参与角色：${orchestrationEvidence.agents.map(a => `${a.role}(${a.status})`).join(' → ')}`,
  `- 资源安全/事实核查：已为每个产物写入 guardrail-*.json 报告`,
].join('\n') : ''}

${sections.join('\n\n---\n\n')}
`;
      await getFileStorage().writeFile(litPath, fullContent);

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

        // ── Assign to relevant cluster ──
        try {
          const clusters = await litDb.cluster.findMany({
            where: { vaultId: litVid },
            select: { id: true, name: true },
          });
          const topicLower = params.topic.toLowerCase();
          // Find best matching cluster by name overlap
          const matchedCluster = clusters.find(c => {
            const cn = c.name.toLowerCase();
            return cn.includes(topicLower) || topicLower.includes(cn);
          });
          if (matchedCluster) {
            await litDb.card.updateMany({
              where: { vaultId: litVid, path: `literature/${litFileName}` },
              data: { clusterId: matchedCluster.id },
            });
          }
          // else: no matching cluster → leave as unattached (游离)
        } catch (clErr) {
          console.warn('[push_resource] Failed to assign cluster:', clErr);
        }
      } catch (dbErr) {
        console.warn('[push_resource] Failed to create DB literature card:', dbErr);
      }

      console.log(`[Event] axiom:toast — card: 生成学习资料: ${params.topic}`);
      const srcVaultId = getCurrentVaultId();
      if (srcVaultId) {
        emitNotification(srcVaultId, { type: 'toast', message: `card: 生成学习资料: ${params.topic}` });
      }

      const generatedResources = resourceManifest.map((item) => ({
        type: item.type,
        title: RESOURCE_LABELS[item.type as keyof typeof RESOURCE_LABELS] || item.title || item.type,
        path: item.path,
        mp4Path: item.mp4Path,
        fileName: item.fileName,
      }));
      const resourceLines = generatedResources.map((item) => {
        const preview = item.type === 'video'
          ? '卡片 READ 模式可播放'
          : '卡片资源面板可预览/下载';
        return `- ${item.title}: \`${item.fileName}\` (${preview})`;
      }).join('\n');
      if (currentUserId) {
        persistResourceToDb(currentUserId, params.topic, generatedResources.map(r => r.type), {
          requestedTypes,
          generationResults,
          orchestration: orchestrationEvidence,
          resources: generatedResources,
        });
      }

      return {
        content: [{
          type: 'text',
          text: [
            `学习资料已放入文献盒：\`${litPath}\``,
            '',
            `「${params.topic}」已生成 ${generatedResources.length} 个资源：`,
            resourceLines,
            '',
            orchestrationEvidence
              ? `多 Agent 协同已完成：${orchestrationEvidence.agents.map(a => `${a.role}:${a.status}`).join(' / ')}`
              : '多 Agent 协同记录不可用，资源生成链路已继续执行。',
            '资源安全和事实核查报告已写入同目录 guardrail-*.json。',
            '',
            '打开这张文献卡并切到 READ 模式，可以直接预览、放大或下载资源。视频 HTML 会先可播，MP4 会在后台完成后自动作为下载源。',
          ].join('\n'),
        }],
        details: {
          topic: params.topic,
          userLevel,
          types_generated: generatedCount,
          cardPath: litPath,
          resources: generatedResources,
          orchestration: orchestrationEvidence,
          generationResults,
        },
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
  '生成一个真实的 .pptx PowerPoint 文件并放入文献盒。此工具已收敛到 push_resource(formats="ppt") 资源生成主链路，用户说"生成PPT"、"做个演示文稿"、"给我一个ppt"时直接调用。',
  Type.Object({
    topic: Type.String({ description: 'PPT 主题，从对话上下文提取' }),
    slides: Type.Optional(Type.String({ description: '可选。PPT 内容，每页用 --- 分隔。不填则工具内部自动生成。' })),
  }),
  async (_id, params) => {
    return pushResourceTool.execute('generate_ppt', {
      topic: params.topic,
      literatureTitle: params.topic,
      literatureContent: params.slides,
      formats: 'ppt',
    });
  }
);


export function registerResourceTools(): void {
  toolRegistry.register(pushResourceTool);
  toolRegistry.register(extractCardsTool);
  toolRegistry.register(generatePptTool);
}
