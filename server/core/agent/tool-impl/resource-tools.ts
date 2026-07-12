/**
 * AXIOM 内置工具 - 资源生成
 */

import { createAxiomCompat } from '@/server/infra/storage/AxiomCompat'
import { getFileStorage } from '@/server/infra/storage/GlobalFileStorage'
import { Type } from '@mariozechner/pi-ai';
const axiom = createAxiomCompat(getFileStorage());

import { createTool, toolRegistry } from "../tools";
import { getVaultPath } from "./helpers";
import { getCurrentUserId, getCurrentVaultId } from '@/server/core/agent/agent-context';
import { prisma } from '@/lib/db';
import { emitNotification, emitResourceProgress } from '../notification-bus';
import type { ResourceType } from '../ResourceGenerationState';
import { createHash } from 'node:crypto';
import { consumeConfirmationToken, createConfirmationToken } from '../OperationConfirmation';
import { AXIOM_KNOWLEDGE_STANDARD } from '../../ai/prompt-standards';
import { AGENT_TOOL_PROMPTS } from '../../ai/prompts';
import { buildGenerationRagContext, type GenerationRagContext } from '@/server/core/rag/generation-context';
import { buildLearningProfileContext, type LearningProfileContext } from '@/server/core/learning/profile-context';
import { scheduleRagIndexCard, scheduleRagIndexCards } from '@/server/core/rag/auto-index';

const RESOURCE_LABELS: Record<string, string> = {
  document: '讲解文档',
  mindmap: '思维导图',
  quiz: '练习题',
  code: '代码实操',
  video: '教学视频/动画',
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

type GeneratedResourceManifestItem = {
  type: string;
  title: string;
  path: string;
  ref: string;
  rawPath?: string;
  rawRef?: string;
  mp4Path?: string;
  mp4Ref?: string;
  fileName: string;
  status: 'ready';
  source: string;
  sourceObjectType: 'card';
  sourceObjectId?: string;
  sourcePath: string;
  sourceTitle: string;
  contentHash: string;
  generatedAt: string;
};

const GRAPH_RESOURCE_TYPES = new Set<ResourceType>(['document', 'mindmap', 'diagram', 'quiz', 'svg', 'video', 'code', 'pdf', 'docx', 'ppt']);
const MARKDOWN_RENDERED_RESOURCE_TYPES = new Set<ResourceType>(['document', 'mindmap', 'diagram', 'quiz', 'svg', 'code']);

type ResourceProfileEvidence = {
  profileSummary: string;
  remainingGaps: string[];
  resourcePreference: string[];
  recentEvidence: string[];
  masteredConcepts: string[];
  teachingFocus: string;
  contextText: string;
};

function sha256Text(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function safeResourceSlug(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120) || 'resource';
}

function displayResourceTitle(topic: string, type: string): string {
  return `${topic} - ${RESOURCE_LABELS[type] || type}`;
}

function renderResourceCardMarkdown(params: {
  type: string;
  title: string;
  topic: string;
  rawPath: string;
  rawContent: string;
  resourcePackTitle: string;
  mp4Path?: string;
}) {
  const { type, title, topic, rawPath, rawContent, resourcePackTitle, mp4Path } = params;
  const trimmed = rawContent.trim();
  let body = trimmed;
  if (type === 'mindmap' || type === 'diagram') {
    body = `\`\`\`mermaid\n${trimmed}\n\`\`\``;
  } else if (type === 'quiz') {
    body = renderQuizMarkdown(trimmed);
  } else if (type === 'svg') {
    body = trimmed.includes('<svg') ? trimmed : `\`\`\`xml\n${trimmed}\n\`\`\``;
  } else if (type === 'video') {
    body = [
      `<!-- axiom-video-html:${rawPath} -->`,
      mp4Path ? `<!-- axiom-video-mp4:${mp4Path} -->` : '',
      `<!-- axiom-video:${rawPath} -->`,
      '',
      '视频会在资源预览面板中播放。',
    ].filter(Boolean).join('\n');
  } else if (type === 'pdf' || type === 'docx' || type === 'ppt') {
    body = `成品文件：\`${rawPath}\`\n\n请在资源预览面板中预览或下载。`;
  }

  return `---
title: "${title}"
source_type: ai-resource
source: AI 自动生成
created: ${new Date().toISOString()}
tags: [ai-generated-resource, ${type}, ${topic}]
---

# ${title}

> 资源包：[[${resourcePackTitle}]]
> 原始资源：\`${rawPath}\`

${body}
`;
}

function renderQuizMarkdown(rawContent: string) {
  try {
    const parsed = JSON.parse(rawContent) as Array<{
      question?: string;
      options?: string[];
      answer?: string;
      explanation?: string;
    }>;
    if (!Array.isArray(parsed)) throw new Error('quiz is not array');
    return [
      '## 练习题',
      '',
      ...parsed.flatMap((question, index) => [
        `### ${index + 1}. ${question.question || '未命名题目'}`,
        '',
        ...(Array.isArray(question.options) ? question.options.map((option) => `- ${option}`) : []),
        '',
        `**答案**：${question.answer || '未提供'}`,
        question.explanation ? `**解析**：${question.explanation}` : '',
        '',
      ]),
    ].filter(Boolean).join('\n');
  } catch {
    return `\`\`\`json\n${rawContent}\n\`\`\``;
  }
}

type PendingExtractCards = {
  target: string;
  literatureTitle: string;
  literatureContent: string;
  candidates?: string[];
  createdAt: number;
};

const pendingExtractCards = new Map<string, PendingExtractCards>();

function rememberPendingExtractCards(token: string, pending: Omit<PendingExtractCards, 'createdAt'>): void {
  pendingExtractCards.set(token, { ...pending, createdAt: Date.now() });
}

function uniqueStrings(items: Array<string | null | undefined>): string[] {
  return Array.from(new Set(items.map((item) => (item || '').trim()).filter(Boolean)));
}

function buildResourceProfileEvidence(profile: LearningProfileContext | null): ResourceProfileEvidence | null {
  if (!profile) return null;
  const observations = profile.dimensionInsights.flatMap((dimension) =>
    dimension.observations
      .filter((observation) => observation.status !== 'refuted')
      .map((observation) => ({ dimensionKey: dimension.key, ...observation })),
  );
  if (observations.length === 0 || !profile.promptBlock.trim()) return null;

  const remainingGaps = uniqueStrings([
    ...profile.knowledgeProfile.weakConcepts,
    ...profile.knowledgeProfile.missingPrerequisites,
    ...profile.knowledgeProfile.isolatedNodes.map((node) => node.title),
    ...profile.knowledgeProfile.weakDomains,
  ]).slice(0, 8);
  const strategyObservations = observations.filter((observation) =>
    ['bestExplanationPath', 'paceAndLoad', 'masteryCheck'].includes(observation.dimensionKey),
  );
  const resourcePreference = uniqueStrings(strategyObservations.flatMap((observation) => [
    observation.subDimensionLabel,
    observation.teachingIntervention,
    observation.verificationCriterion,
  ])).slice(0, 8);
  const profileSummary = uniqueStrings(observations.map((observation) =>
    observation.userFacingSummary || observation.text,
  )).slice(0, 3).join('；');
  const teachingFocus = uniqueStrings(observations.map((observation) =>
    observation.teachingIntervention,
  )).slice(0, 3).join('；');

  return {
    profileSummary,
    remainingGaps,
    resourcePreference,
    recentEvidence: profile.profileLoop.recentEvidence.slice(0, 5),
    masteredConcepts: profile.knowledgeProfile.masteredConcepts.slice(0, 8),
    teachingFocus,
    contextText: profile.promptBlock,
  };
}

function formatResourceProfileEvidence(evidence: ResourceProfileEvidence | null): string {
  if (!evidence) return '- 未读取到可用画像';
  return [
    evidence.profileSummary ? `- 当前画像：${evidence.profileSummary}` : '',
    evidence.remainingGaps.length ? `- 剩余缺口：${evidence.remainingGaps.join('、')}` : '- 剩余缺口：暂无稳定缺口',
    evidence.resourcePreference.length ? `- 资源偏好：${evidence.resourcePreference.join('、')}` : '- 资源偏好：暂无稳定偏好',
    evidence.masteredConcepts.length ? `- 已掌握概念：${evidence.masteredConcepts.join('、')}` : '',
    evidence.teachingFocus ? `- 后续教学重点：${evidence.teachingFocus}` : '',
    evidence.recentEvidence.length ? `- 触发证据：${evidence.recentEvidence.join('；')}` : '',
  ].filter(Boolean).join('\n');
}

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

function inferDefaultResourceTypes(
  topic: string,
  literatureContent: string | undefined,
  userLevel: string,
): ResourceType[] {
  const text = `${topic} ${literatureContent || ''}`.toLowerCase();
  const types = new Set<ResourceType>();

  if (/(文档|讲义|说明|整理|markdown|\bmd\b|document|article|note)/i.test(text)) {
    types.add('document');
  }

  if (/(思维导图|知识导图|脑图|mindmap|mind map)/i.test(text)) {
    types.add('mindmap');
  } else if (/(图|流程|关系|结构|架构|路径|系统|网络|状态|sequence|flow|diagram|map)/i.test(text)) {
    types.add(/(关系|结构|体系|知识|章节|地图|mindmap|map)/i.test(text) ? 'mindmap' : 'diagram');
  }

  if (/(练习|测试|题|测验|评估|巩固|复习|quiz|exam|test)/i.test(text)) {
    types.add('quiz');
  }

  if (/(代码|编程|算法|实现|函数|项目|实操|案例|python|java|typescript|javascript|react|next|sql|code)/i.test(text)) {
    types.add('code');
  }

  if (/(视频|动画|演示视频|video)/i.test(text)) {
    types.add('video');
  }

  if (/(svg|矢量|插图|示意图)/i.test(text)) {
    types.add('svg');
  }

  if (/(ppt|演示文稿|汇报)/i.test(text)) {
    types.add('ppt');
  }
  if (/(pdf|打印|讲义)/i.test(text)) {
    types.add('pdf');
  }
  if (/(word|docx|文档模板)/i.test(text)) {
    types.add('docx');
  }

  if (/(初学|小白|入门|beginner)/i.test(userLevel)) {
    if (types.size === 0) types.add('document');
  }

  if (/(资源包|一套|全部|全套|所有格式|all resources|resource pack)/i.test(text)) {
    types.add('document');
    types.add('mindmap');
    types.add('quiz');
  }

  return (types.size > 0 ? Array.from(types) : ['document' as ResourceType]).slice(0, 4);
}

const pushResourceTool = createTool(
  'push_resource',
  '推送学习资源到文献盒',
  '为当前学习主题生成必要的学习资料并保存到文献盒。支持 10 种格式：'
  + '📄 文档(markdown)、🧠 思维导图(mermaid)、❓ 练习题(JSON)、💻 代码实操(markdown)、🎬 教学视频(HTML/MP4)、'
  + '📊 SVG矢量图、🔀 Mermaid流程图/时序图/类图等、📝 Word文档(docx)、📑 PDF文档、📽️ PPT演示文稿。'
  + '【关键时机】当用户说"整理成学习资料"、"保存到文献盒"、"生成文档"、"导出Word"、"导出PDF"、"做个PPT"'
  + '"画个流程图"、"生成SVG"等类似请求时，必须直接调用此工具。不要在普通对话里打断式推送资源；'
  + '必须尊重用户指定格式：用户指定什么就只生成什么。用户没有指定 formats 时，只按明确意图推断少量资源，默认只生成 document；'
  + '只有用户明确要求"资源包/全套/全部"时才生成多项核心资源，只有明确要求时才生成视频/PDF/Word/PPT 等重资源。'
  + '用户水平自动从画像推断，无需询问用户。自动跳过已有资源。',
  Type.Object({
    topic: Type.String({ description: '学习主题（必填）。从对话上下文或用户消息中提取。' }),
    level: Type.Optional(Type.String({ description: '可选。不填则自动从 .axiom/user-profile.json 读取。' })),
    literatureTitle: Type.Optional(Type.String({ description: '关联的文献标题。' })),
    literatureContent: Type.Optional(Type.String({ description: '文献内容截取。' })),
    formats: Type.Optional(Type.String({ description: '可选。指定生成的格式，逗号分隔。如 "svg,diagram" 只生成 SVG 和图表；"mindmap" 只生成知识导图。不填则按明确意图推断，默认只生成 document。可用值: document,mindmap,quiz,code,video,svg,diagram,docx,pdf,ppt' })),
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
      const currentUserId = getCurrentUserId();
      let profileEvidence: ResourceProfileEvidence | null = null;
      if (progressVaultId) {
        const learningProfile = await buildLearningProfileContext({
          vaultId: progressVaultId,
          userId: currentUserId,
        }).catch(() => null);
        profileEvidence = buildResourceProfileEvidence(learningProfile);
        if (!params.level && learningProfile?.profileSummary.userLevel) {
          userLevel = learningProfile.profileSummary.userLevel;
        }
      }

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
          const resourceDir = `resources/${safeResourceSlug(literatureTitle)}`;
          const fullPath = `${resourceDir}/${fileName}`;
          const result = await getFileStorage().readFile(fullPath);
          return result?.success === true;
        },
        saveResource: async (type: string, literatureTitle: string, content: string): Promise<void> => {
          const fileName = (RESOURCE_FILE_MAP as Record<string, string>)[type];
          if (!fileName) return;
          const resourceDir = `resources/${safeResourceSlug(literatureTitle)}`;
          await getFileStorage().ensureDir(resourceDir);
          const fullPath = `${resourceDir}/${fileName}`;
          const result = await getFileStorage().writeFile(fullPath, content);
          if (!result?.success) {
            throw new Error(result?.error || 'Failed to save resource file');
          }
        },
        saveResourceFile: async (literatureTitle: string, fileName: string, content: string): Promise<void> => {
          // Guardrail/report JSON is machine-only metadata. Do not persist it as a card,
          // otherwise it pollutes the human knowledge graph.
          if (/\.json$/i.test(fileName)) return;
          const resourceDir = `resources/${safeResourceSlug(literatureTitle)}`;
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
        ? params.formats.split(',').map(f => f.trim()).filter(f => (RESOURCE_TYPES as readonly string[]).includes(f)) as ResourceType[]
        : undefined;
      const requestedTypes = formats && formats.length > 0
        ? formats
        : inferDefaultResourceTypes(params.topic, params.literatureContent, userLevel);
      let orchestrationEvidence: ResourceOrchestrationEvidence | null = null;
      let ragContext: GenerationRagContext = { enabled: false, used: false, contextText: '', references: [] };
      if (progressVaultId) {
        emitResourceProgress(progressVaultId, {
          topic: params.topic,
          resourceType: 'document',
          label: 'RAG 检索',
          status: 'generating',
          progress: 3,
          message: '正在检索当前知识库上下文',
        });
        ragContext = await buildGenerationRagContext({
          vaultId: progressVaultId,
          query: [
            params.topic,
            params.literatureTitle || '',
            params.literatureContent?.slice(0, 1600) || '',
            requestedTypes.join(', '),
            profileEvidence?.remainingGaps.join(' ') || '',
            profileEvidence?.resourcePreference.join(' ') || '',
          ].filter(Boolean).join('\n\n'),
          topK: 8,
          maxChars: 5000,
        });
      }
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
            profile: profileEvidence ? {
              remainingGaps: profileEvidence.remainingGaps,
              resourcePreference: profileEvidence.resourcePreference,
              teachingFocus: profileEvidence.teachingFocus,
            } : null,
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

      const generationResults = await orchestrator.orchestrate(
        params.topic,
        userLevel,
        litTitle,
        params.literatureContent,
        requestedTypes,
        {
          contextText: ragContext.contextText,
          references: ragContext.references,
        },
        profileEvidence ? {
          contextText: profileEvidence.contextText,
          evidence: {
            remainingGaps: profileEvidence.remainingGaps,
            resourcePreference: profileEvidence.resourcePreference,
            recentEvidence: profileEvidence.recentEvidence,
            masteredConcepts: profileEvidence.masteredConcepts,
            teachingFocus: profileEvidence.teachingFocus,
          },
        } : undefined,
      );

      // 读取生成的资源，写入 manifest。资源正文保持在各自独立文件/卡片中，汇总卡只做索引。
      const sanitizedDir = safeResourceSlug(litTitle);
      const resourceDir = `resources/${sanitizedDir}`;
      const sections: string[] = [];
      const resourceManifest: GeneratedResourceManifestItem[] = [];
      let generatedCount = 0;
      const manifestVaultId = getCurrentVaultId();

      for (const type of RESOURCE_TYPES) {
        if (state.getStatus(type) !== 'completed') continue;
        try {
          const fileName = RESOURCE_FILE_MAP[type];
          const resourcePath = `resources/${sanitizedDir}/${fileName}`;
          const result = await getFileStorage().readFile(`${resourceDir}/${fileName}`);
          if (result?.success && result.content) {
            const resourceCard = manifestVaultId
              ? await prisma.card.findUnique({
                where: { vaultId_path: { vaultId: manifestVaultId, path: resourcePath } },
                select: { id: true, path: true },
              }).catch(() => null)
              : null;
            const item: GeneratedResourceManifestItem = {
              type,
              title: RESOURCE_LABELS[type] || type,
              path: resourcePath,
              ref: resourcePath,
              fileName,
              status: 'ready',
              source: 'AI 自动生成资源，已持久化为当前 Vault 内的 Card',
              sourceObjectType: 'card',
              sourceObjectId: resourceCard?.id,
              sourcePath: resourceCard?.path || resourcePath,
              sourceTitle: litTitle,
              contentHash: sha256Text(result.content),
              generatedAt: new Date().toISOString(),
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
                mp4Ref: mp4Result?.success ? videoMp4Ref : undefined,
              });
              sections.push([
                `- **${RESOURCE_LABELS[type]}**：\`${videoHtmlRef}\`${mp4Result?.success ? `，MP4：\`${videoMp4Ref}\`` : ''}`,
                '',
                `<!-- axiom-video-html:${videoHtmlRef} -->`,
                mp4Result?.success ? `<!-- axiom-video-mp4:${videoMp4Ref} -->` : '',
                `<!-- axiom-video:${videoHtmlRef} -->`,
              ].filter(Boolean).join('\n'));
            } else if (type === 'mindmap' || type === 'diagram') {
              resourceManifest.push(item);
              sections.push(`- **${RESOURCE_LABELS[type]}**：\`${resourcePath}\`（点击资源面板中的条目单独预览）`);
            } else if (type === 'quiz' || type === 'svg' || type === 'docx' || type === 'pdf' || type === 'ppt') {
              resourceManifest.push(item);
              sections.push(`- **${RESOURCE_LABELS[type]}**：\`${resourcePath}\`（点击资源面板中的条目单独预览/下载）`);
            } else {
              resourceManifest.push(item);
              sections.push(`- **${RESOURCE_LABELS[type]}**：\`${resourcePath}\`（点击资源面板中的条目单独打开）`);
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

      // 汇总卡只保存生成依据、manifest 和独立资源入口，不再把多个产物正文拼进一个 Markdown。
      const litDir = `literature`;
      await getFileStorage().ensureDir(litDir);
      const litFileName = `lit-${Date.now()}.md`;
      const litPath = `${litDir}/${litFileName}`;
      const resourcePackTitle = profileEvidence
        ? `${params.topic} - 个性化资源包`
        : `${params.topic} - 学习资源包`;
      const evidenceLines = [
        `- 当前主题：${params.topic}`,
        `- 当前资料/卡片：${litTitle}`,
        profileEvidence?.remainingGaps.length ? `- 剩余缺口：${profileEvidence.remainingGaps.join('、')}` : '',
        profileEvidence?.resourcePreference.length ? `- 画像支持的资源策略：${profileEvidence.resourcePreference.join('、')}` : '',
        profileEvidence?.masteredConcepts.length ? `- 已掌握概念：${profileEvidence.masteredConcepts.join('、')}` : '',
        profileEvidence ? '' : '- 画像依据：暂无可用证据，本次只按当前主题和卡片生成，不宣称个性化。',
        ragContext.references.length ? `- 资料来源：${ragContext.references.slice(0, 5).join('、')}` : '',
        profileEvidence
          ? '- 目标：围绕有证据的当前缺口生成可预览学习资源。'
          : '- 目标：围绕当前主题生成可预览学习资源。',
      ].filter(Boolean).join('\n');
      let fullContent = `---
title: "${params.topic}"
source_type: ai
source: AI 自动生成
created: ${new Date().toISOString()}
tags: [ai-generated, ${params.topic}]
---

<!-- axiom-resources:${JSON.stringify(resourceManifest)} -->
<!-- axiom-orchestration:${JSON.stringify(orchestrationEvidence)} -->
<!-- axiom-rag-context:${JSON.stringify({
  enabled: ragContext.enabled,
  used: ragContext.used,
  references: ragContext.references,
  error: ragContext.error,
})} -->
<!-- axiom-profile-evidence:${JSON.stringify(profileEvidence)} -->

## ${profileEvidence ? '画像驱动依据' : '生成依据'}

${evidenceLines}

## 生成依据明细

${formatResourceProfileEvidence(profileEvidence)}

${orchestrationEvidence ? [
  '## 多 Agent 协同记录',
  '',
  `- 工作流 ID：${orchestrationEvidence.id}`,
  `- 状态：${orchestrationEvidence.status}`,
  `- 参与角色：${orchestrationEvidence.agents.map(a => `${a.role}(${a.status})`).join(' → ')}`,
  `- 资源安全/事实核查：已为每个产物写入 guardrail-*.json 报告`,
].join('\n') : ''}

## 独立资源

${sections.join('\n')}

${resourceManifest.some((item) => GRAPH_RESOURCE_TYPES.has(item.type as ResourceType)) ? [
  '## 知识库资源卡',
  '',
  ...resourceManifest
    .filter((item) => GRAPH_RESOURCE_TYPES.has(item.type as ResourceType))
    .map((item) => `- [[${displayResourceTitle(params.topic, item.type)}]]`),
  '',
].join('\n') : ''}

> 每个资源已单独写入 \`resources/${sanitizedDir}/\`。在 READ 模式下点击资源条目，可在右侧预览区单独打开、放大或下载。
	`;
      await getFileStorage().writeFile(litPath, fullContent);

      // Also create a DB Card record for the literature so it appears in galaxy/knowledge graph
      let createdResourceCard: { id: string; title: string | null; type: string; path: string } | null = null;
      try {
        const { prisma: litDb } = await import('@/lib/db');
        const { getCurrentVaultId } = await import('@/server/core/agent/agent-context');
        const litVid = getCurrentVaultId();
        if (litVid) {
          const resourceCard = await litDb.card.upsert({
            where: { vaultId_path: { vaultId: litVid, path: `literature/${litFileName}` } },
            create: {
              vaultId: litVid,
              path: `literature/${litFileName}`,
              title: resourcePackTitle,
              content: fullContent.slice(0, 10000),
              type: 'literature',
              tags: JSON.stringify(['ai-generated', params.topic]),
            },
            update: {
              title: resourcePackTitle,
              content: fullContent.slice(0, 10000),
              tags: JSON.stringify(['ai-generated', params.topic]),
              updatedAt: new Date(),
            },
          });
          createdResourceCard = {
            id: resourceCard.id,
            title: resourceCard.title,
            type: resourceCard.type,
            path: resourceCard.path,
          };
          scheduleRagIndexCard(resourceCard.id, 'resource-generation');

          const graphResourceCards: Array<{ id: string; title: string | null; path: string }> = [];
          for (const item of resourceManifest) {
            if (!GRAPH_RESOURCE_TYPES.has(item.type as ResourceType)) continue;
            const resourceTitle = displayResourceTitle(params.topic, item.type);
            const resourceCardPath = `literature/${safeResourceSlug(resourceTitle)}.md`;
            const rawResourcePath = item.path;
            const rawResource = await getFileStorage().readFile(rawResourcePath).catch(() => null);
            const rawContent = rawResource?.success ? rawResource.content || '' : '';
            const resourceCardContent = renderResourceCardMarkdown({
              type: item.type,
              title: resourceTitle,
              topic: params.topic,
              rawPath: rawResourcePath,
              rawContent,
              resourcePackTitle,
              mp4Path: item.mp4Path,
            });
            const graphCard = await litDb.card.upsert({
              where: { vaultId_path: { vaultId: litVid, path: resourceCardPath } },
              create: {
                vaultId: litVid,
                path: resourceCardPath,
                title: resourceTitle,
                content: resourceCardContent,
                type: 'literature',
                tags: JSON.stringify(['ai-generated-resource', item.type, params.topic]),
              },
              update: {
                title: resourceTitle,
                content: resourceCardContent,
                tags: JSON.stringify(['ai-generated-resource', item.type, params.topic]),
                updatedAt: new Date(),
              },
            });
            if (MARKDOWN_RENDERED_RESOURCE_TYPES.has(item.type as ResourceType)) {
              item.rawPath = rawResourcePath;
              item.rawRef = rawResourcePath;
              item.path = graphCard.path;
              item.ref = graphCard.path;
              item.fileName = resourceCardPath.split('/').pop() || item.fileName;
              item.contentHash = sha256Text(resourceCardContent);
            }
            item.sourceObjectId = graphCard.id;
            item.sourcePath = graphCard.path;
            item.sourceTitle = resourceTitle;
            graphResourceCards.push({ id: graphCard.id, title: graphCard.title, path: graphCard.path });
            scheduleRagIndexCard(graphCard.id, 'resource-generation-card');
          }

          for (const graphCard of graphResourceCards) {
            await Promise.all([
              litDb.edge.upsert({
                where: { vaultId_sourceId_targetId_type: { vaultId: litVid, sourceId: resourceCard.id, targetId: graphCard.id, type: 'related' } },
                create: { vaultId: litVid, sourceId: resourceCard.id, targetId: graphCard.id, type: 'related', weight: 1 },
                update: { weight: 1 },
              }),
              litDb.edge.upsert({
                where: { vaultId_sourceId_targetId_type: { vaultId: litVid, sourceId: graphCard.id, targetId: resourceCard.id, type: 'related' } },
                create: { vaultId: litVid, sourceId: graphCard.id, targetId: resourceCard.id, type: 'related', weight: 1 },
                update: { weight: 1 },
              }),
            ]).catch((edgeErr) => {
              console.warn('[push_resource] Failed to link resource card:', edgeErr);
            });
          }

          const updatedFullContent = fullContent.replace(
            /<!--\s*axiom-resources:[\s\S]*?\s*-->/,
            `<!-- axiom-resources:${JSON.stringify(resourceManifest)} -->`,
          );
          if (updatedFullContent !== fullContent) {
            fullContent = updatedFullContent;
            await getFileStorage().writeFile(litPath, fullContent);
            await litDb.card.update({
              where: { id: resourceCard.id },
              data: { content: fullContent.slice(0, 10000), updatedAt: new Date() },
            }).catch(() => {});
          }
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
        ref: item.ref,
        rawPath: item.rawPath,
        rawRef: item.rawRef,
        mp4Path: item.mp4Path,
        mp4Ref: item.mp4Ref,
        fileName: item.fileName,
        status: item.status,
        source: item.source,
        sourceObjectType: item.sourceObjectType,
        sourceObjectId: item.sourceObjectId,
        sourcePath: item.sourcePath,
        sourceTitle: item.sourceTitle,
        contentHash: item.contentHash,
        generatedAt: item.generatedAt,
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
          rag: {
            enabled: ragContext.enabled,
            used: ragContext.used,
            references: ragContext.references,
            error: ragContext.error,
          },
          profileEvidence,
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
          resourcePackCard: createdResourceCard,
          workspaceActions: createdResourceCard ? [
            {
              type: 'select_card',
              card: {
                id: createdResourceCard.id,
                title: createdResourceCard.title || params.topic,
                type: createdResourceCard.type || 'literature',
              },
            },
            { type: 'set_right_panel_view', view: 'read' },
            { type: 'set_panel', panel: 'editor', zone: 'right', open: true },
          ] : [],
          resources: generatedResources,
          orchestration: orchestrationEvidence,
          generationResults,
          rag: {
            enabled: ragContext.enabled,
            used: ragContext.used,
            references: ragContext.references,
            error: ragContext.error,
          },
          profileEvidence,
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
    auto: Type.Optional(Type.Boolean({ description: '是否自动执行。写入卡片前仍必须有用户确认 token。默认 false。' })),
    confirmationToken: Type.Optional(Type.String({ description: '用户确认后得到的一次性确认 token。执行提取写入时必须提供。' })),
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

      let literatureTitle = params.literatureTitle;
      let literatureContent = params.literatureContent;

      if (params.confirmationToken) {
        const pending = pendingExtractCards.get(params.confirmationToken);
        const target = pending?.target || literatureTitle;
        if (!consumeConfirmationToken('extract_cards', target, params.confirmationToken)) {
          return {
            content: [{ type: 'text', text: `提取《${literatureTitle}》需要重新确认。` }],
            details: { error: 'Invalid or missing confirmationToken' },
          };
        }
        if (pending) {
          literatureTitle = pending.literatureTitle;
          literatureContent = pending.literatureContent;
          pendingExtractCards.delete(params.confirmationToken);
        } else if (!literatureContent.trim()) {
          return {
            content: [{ type: 'text', text: '确认请求已失效，无法恢复待提取的文献内容。请重新发起提取。' }],
            details: { error: 'Pending extraction payload expired' },
          };
        }
      } else if (params.auto) {
        const confirmation = createConfirmationToken('extract_cards', literatureTitle);
        rememberPendingExtractCards(confirmation.token, {
          target: literatureTitle,
          literatureTitle,
          literatureContent,
        });
        return {
          content: [{ type: 'text', text: `从《${literatureTitle}》提取概念卡片将写入当前 Vault。请确认后执行。` }],
          details: {
            awaitingConfirmation: true,
            confirmationToken: confirmation.token,
            expiresAt: confirmation.expiresAt,
            literature: literatureTitle,
            target: literatureTitle,
          },
        };
      }

      // Step 1: If not auto, list candidates and ask user for confirmation
      if (!params.auto) {
        const { aiManager } = await import('../../ai/AIManager');
        const candidatePrompt = `你是文献概念识别专家。从以下文献内容中，列出所有符合以下条件的核心概念名称（仅返回名称，每行一个，不要序号）：

${AXIOM_KNOWLEDGE_STANDARD}

1. 在文献中有明确的定义或解释
2. 有清晰的边界，不是模糊的泛称
3. 该概念可以复用到该文献之外的场景

文献标题：${literatureTitle}
文献内容：
${literatureContent.slice(0, 8000)}

仅返回概念名称列表，每行一个。

## ⚠️ 强制输出语言：中文
所有内容必须用中文输出。专有名词保留原文。`;

        const candidateResult = await aiManager.callAPI(
          AGENT_TOOL_PROMPTS.documentConceptCandidate.system,
          [{ role: 'user', content: candidatePrompt }],
        );

        const candidates = candidateResult
          .split('\n')
          .map(line => line.replace(/^[\d.\s-]+/, '').trim())
          .filter(line => line.length > 0);

        if (candidates.length === 0) {
          return {
            content: [{ type: 'text', text: `从《${literatureTitle}》中未识别出符合条件的核心概念。` }],
            details: { candidates: [], literature: literatureTitle },
          };
        }

        const confirmation = createConfirmationToken('extract_cards', literatureTitle);
        rememberPendingExtractCards(confirmation.token, {
          target: literatureTitle,
          literatureTitle,
          literatureContent,
          candidates,
        });

        console.warn('[Event] axiom:ask-user dispatched on server — no client to respond. Returning fallback.');

        return {
          content: [{ type: 'text', text: `从《${literatureTitle}》中识别到 ${candidates.length} 个候选概念。请确认是否提取。` }],
          details: {
            awaitingConfirmation: true,
            confirmationToken: confirmation.token,
            expiresAt: confirmation.expiresAt,
            candidates,
            literature: literatureTitle,
            target: literatureTitle,
          },
        };
      }

      // Step 2: Perform full extraction (auto=true or confirmed)
      const { aiManager } = await import('../../ai/AIManager');
      const extractionPrompt = `你是文献概念提取专家。从给定的文献内容中提取所有重要的核心概念。

${AXIOM_KNOWLEDGE_STANDARD}

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

文献标题：${literatureTitle}
文献内容：
${literatureContent.slice(0, 8000)}

## ⚠️ 强制输出语言：中文
所有内容必须用中文输出。专有名词保留原文。`;

      const llmResult = await aiManager.callAPI(
        AGENT_TOOL_PROMPTS.documentConceptExtraction.system,
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
          content: [{ type: 'text', text: `从《${literatureTitle}》中未提取到符合条件的核心概念。` }],
          details: { concepts: [], literature: literatureTitle },
        };
      }

      // Step 3: Create DB card records for each concept
      const createdCards: Array<{ title: string; id?: string }> = [];
      const failedCards: Array<{ title: string; error: string }> = [];
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

> 来源：[[${literatureTitle}]]`;

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
          failedCards.push({ title: concept.title, error: cardError instanceof Error ? cardError.message : String(cardError) });
        }
      }

      // Step 4: Link extracted cards to source literature via edges
      try {
        const sourceCard = await pdb.card.findFirst({
          where: { vaultId: vid, title: literatureTitle, type: 'literature' },
          select: { id: true },
        });
        if (sourceCard) {
          for (const c of createdCards) {
            if (!c.id) continue;
            const existingEdge = await pdb.edge.findFirst({
              where: { vaultId: vid, sourceId: sourceCard.id, targetId: c.id, type: 'derived' },
              select: { id: true },
            });
            if (!existingEdge) {
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
        }
      } catch (updateError) {
        console.warn('[extract_cards] Failed to link cards to literature:', updateError);
      }
      scheduleRagIndexCards(createdCards.map((card) => card.id), 'extract-cards-tool');

      const conceptNames = concepts.map(c => c.title).join('、');
      return {
        content: [{
          type: 'text',
          text: `从《${literatureTitle}》中提取了 ${concepts.length} 个概念: ${conceptNames}\n已创建 ${createdCards.length} 张灵感卡片${failedCards.length > 0 ? `，${failedCards.length} 张创建失败` : ''}。`,
        }],
        details: {
          concepts: concepts.map(c => ({ title: c.title, tags: c.tags })),
          literature: literatureTitle,
          cardsCreated: createdCards.length,
          cardsFailed: failedCards.length,
          failedCards,
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
