/**
 * AXIOM 内置工具 - 文档导入知识卡片
 *
 * 接收一篇完整文档（教材章节、论文、文章），AI 自动解析为：
 * - 核心概念 → permanent 卡片
 * - 细节知识点 → fleeting 卡片
 * - 来源文献 → literature 卡片
 * - 概念间关联 → 自动建立 WikiLink + edge
 *
 * 一次调用完成全部导入，避免逐张创建的低效。
 */

import { Type } from "@mariozechner/pi-ai";
import { createHash } from 'crypto';
import { createTool, toolRegistry } from "../tools";
import { prisma } from '@/lib/db';
import { getCurrentVaultId, getCurrentUserId } from '../agent-context';
import { aiManager } from '../../ai/AIManager';

interface ExtractedConcept {
  name: string;
  description: string;
}

interface ExtractedFleeting {
  title: string;
  content: string;
  linksTo: string[];  // names of related permanent concepts
}

interface StructuredDocument {
  title: string;
  concepts: ExtractedConcept[];
  fleetingCards: ExtractedFleeting[];
  relations: Array<{ from: string; to: string; type: 'prerequisite' | 'related' | 'derived' }>;
}

function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

// ── Chunking helpers (adapted from LLM Wiki ingest.ts) ──

interface DocumentChunk {
  index: number;
  total: number;
  headingPath: string;
  overlapBefore: string;
  main: string;
}

/** Split text at sentence boundaries when a single block is too large */
function splitOversizedBlock(block: string, targetChars: number): string[] {
  if (block.length <= targetChars * 1.25) return [block]
  const pieces = block.match(/[^.!?\u3002\uff01\uff1f\n]+[.!?\u3002\uff01\uff1f]?|\n+/g) ?? [block]
  const out: string[] = []
  let current = ""
  for (const piece of pieces) {
    if (current && current.length + piece.length > targetChars) {
      out.push(current.trim())
      current = ""
    }
    if (piece.length > targetChars) {
      for (let i = 0; i < piece.length; i += targetChars) {
        const s = piece.slice(i, i + targetChars).trim()
        if (s) out.push(s)
      }
    } else {
      current += piece
    }
  }
  if (current.trim()) out.push(current.trim())
  return out
}

/** Parse document into heading-aware semantic blocks */
function semanticBlocks(content: string, targetChars: number): Array<{ text: string; headingPath: string }> {
  const blocks: Array<{ text: string; headingPath: string }> = []
  const headingStack: string[] = []
  let paragraph: string[] = []
  let paragraphHeading = ""

  const currentHeadingPath = () => headingStack.filter(Boolean).join(" > ")
  const flushParagraph = () => {
    const text = paragraph.join("\n").trim()
    if (text) {
      for (const piece of splitOversizedBlock(text, targetChars)) {
        blocks.push({ text: piece, headingPath: paragraphHeading })
      }
    }
    paragraph = []
  }

  for (const line of content.replace(/\r\n/g, "\n").split("\n")) {
    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line)
    if (heading) {
      flushParagraph()
      const depth = heading[1].length
      headingStack.length = depth - 1
      headingStack[depth - 1] = heading[2].trim()
      blocks.push({ text: line.trim(), headingPath: currentHeadingPath() })
      paragraphHeading = currentHeadingPath()
      continue
    }
    if (line.trim() === "") {
      flushParagraph()
      paragraphHeading = currentHeadingPath()
      continue
    }
    if (paragraph.length === 0) paragraphHeading = currentHeadingPath()
    paragraph.push(line)
  }
  flushParagraph()
  return blocks
}

/** Get overlap suffix from previous chunk for context continuity */
function overlapSuffix(text: string, maxChars: number): string {
  if (!text || maxChars <= 0) return ""
  if (text.length <= maxChars) return text
  const raw = text.slice(-maxChars)
  const paragraphBreak = raw.search(/\n\s*\n/)
  if (paragraphBreak > 0 && raw.length - paragraphBreak > maxChars * 0.4) {
    return raw.slice(paragraphBreak).trim()
  }
  const sentenceBreak = raw.search(/[.!?\u3002\uff01\uff1f]\s+/)
  if (sentenceBreak > 0 && raw.length - sentenceBreak > maxChars * 0.4) {
    return raw.slice(sentenceBreak + 1).trim()
  }
  return raw.trim()
}

/** Split document into semantic chunks with overlap */
function splitIntoSemanticChunks(content: string, targetChars: number, overlapChars: number): DocumentChunk[] {
  const target = Math.max(1000, targetChars)
  const blocks = semanticBlocks(content, target)
  if (blocks.length === 0) return []

  const rawChunks: Array<{ main: string; headingPath: string }> = []
  let current: string[] = []
  let currentLength = 0
  let currentHeading = blocks[0]?.headingPath ?? ""

  for (const block of blocks) {
    const nextLength = currentLength + block.text.length + (current.length > 0 ? 2 : 0)
    if (current.length > 0 && nextLength > target) {
      rawChunks.push({ main: current.join("\n\n"), headingPath: currentHeading })
      current = []
      currentLength = 0
    }
    if (current.length === 0) currentHeading = block.headingPath
    current.push(block.text)
    currentLength += block.text.length + (current.length > 1 ? 2 : 0)
  }
  if (current.length > 0) {
    rawChunks.push({ main: current.join("\n\n"), headingPath: currentHeading })
  }

  return rawChunks.map((chunk, idx) => ({
    index: idx + 1,
    total: rawChunks.length,
    headingPath: chunk.headingPath,
    overlapBefore: idx > 0 ? overlapSuffix(rawChunks[idx - 1].main, overlapChars) : "",
    main: chunk.main,
  }))
}

const importDocumentTool = createTool(
  'import_document',
  '导入文档生成知识卡片',
  '将一篇完整的文档（教材章节、论文、文章等）解析为结构化的知识卡片体系。'
  + '自动提取核心概念（permanent 卡片）、细节知识点（fleeting 卡片）、'
  + '并建立概念间的关联关系（WikiLink + edge）。一次调用完成全部导入，避免逐张创建。'
  + '支持任意长度的文档，长文档会自动进行语义分块处理。(最大单块 20000 字，自动重叠 8% 以保持上下文连贯)'
  + '【触发时机】当用户说"帮我整理这篇文档"、"把这本书转成卡片"、"导入这篇文章"、'
  + '"从这篇文章生成知识点"、"帮我读这本书"、"把这段内容做成闪念卡片"等类似请求时，'
  + '必须调用此工具。请直接将文档全文传入，不要先用其他工具分析。',
  Type.Object({
    document: Type.String({ description: '文档全文内容，支持任意长度。长文档会自动分块处理。' }),
    topic: Type.String({ description: '文档的主题/领域名称，如"数据结构与算法"、"操作系统"等' }),
    source_title: Type.Optional(Type.String({ description: '文档标题（可选）。留空则自动从内容推断。' })),
    cluster_name: Type.Optional(Type.String({ description: '所属知识域（可选）。默认使用 topic 作为知识域。' })),
  }),
  async (_id, params) => {
    try {
      const vaultId = getCurrentVaultId();
      const userId = getCurrentUserId();
      if (!vaultId || !userId) {
        return { content: [{ type: 'text', text: '缺少必要上下文（Vault ID 或 User ID）' }], details: { error: 'Missing context' } };
      }

      // ── Step 1: AI 解析文档，提取结构化内容 ──────────────────────────

      const clusterName = params.cluster_name || params.topic;
      const contentHash = hashContent(params.document);

      // Check if this document content was already imported (SHA-256 dedup)
      const existingCard = await prisma.card.findFirst({
        where: { vaultId, tags: { contains: contentHash } },
      });
      if (existingCard) {
        return {
          content: [{ type: 'text', text: '文档已导入过（内容未变更），跳过。\n\n已存在的卡片在知识域: ' + clusterName }],
          details: { cached: true, hash: contentHash },
        };
      }

      // ── Step 1 & 2: AI 解析 + 结构化输出（单段/长文档分块双路径） ──

      const docContent = params.document;
      const MAX_CHUNK_CHARS = 20000;  // ~5000 tokens per chunk, safe for most models
      const OVERLAP_CHARS = Math.floor(MAX_CHUNK_CHARS * 0.08); // 8% overlap like LLM Wiki

      let parsed: StructuredDocument;

      if (docContent.length > MAX_CHUNK_CHARS) {
        // ── Multi-chunk processing ──
        const chunks = splitIntoSemanticChunks(docContent, MAX_CHUNK_CHARS, OVERLAP_CHARS);
        if (!chunks || chunks.length === 0) {
          return { content: [{ type: 'text', text: '文档分块失败' }], details: { error: 'Document chunking failed' } };
        }

        let globalDigest = '';
        const allConcepts: ExtractedConcept[] = [];
        const allFleeting: ExtractedFleeting[] = [];
        const allRelations: Array<{ from: string; to: string; type: string }> = [];

        for (const chunk of chunks) {
          const chunkPrompt = `你是一个知识萃取专家。你正在处理一篇长文档的第 ${chunk.index}/${chunk.total} 个片段。

## 全局上下文（前面片段的摘要）
${globalDigest || '(这是第一个片段)'}

## 当前片段标题路径
${chunk.headingPath || '(无)'}

## 片段间上下文重叠
${chunk.overlapBefore ? chunk.overlapBefore.slice(0, 500) : '(无)'}

## 当前片段内容

${chunk.main}

## 输出要求
以严格的 JSON 格式返回（不要 \`\`\`json 包裹，不要任何其他文字）：
{
  "concepts": [{"name": "核心概念名", "description": "定义（50-100字）"}],
  "fleetingCards": [{"title": "知识点", "content": "说明（100-300字）", "linksTo": ["关联概念"]}],
  "relations": [{"from": "A", "to": "B", "type": "prerequisite|related|derived"}],
  "digest": "本片段的摘要（2-3句话），用于传递给下一个片段的上下文"
}

## 规则
- 只提取本片段中新出现的内容，不要重复前面片段已经提取过的
- concepts: 本片段独有的核心概念（0-5个）
- fleetingCards: 本片段的具体知识点（0-10个）
- digest: 必须写，2-3句话总结本片段核心内容

## ⚠️ 强制输出语言：中文
所有内容必须用中文输出。专有名词保留原文。`;

          const chunkResponse = await aiManager.callAPI(
            '你是知识萃取专家。内部推理即可，不要输出思考过程。直接返回 JSON 结果。',
            [{ role: 'user', content: chunkPrompt }],
          );

          const cleaned = chunkResponse.replace(/```(?:json)?\s*/g, '').replace(/\s*```/g, '');
          const match = cleaned.match(/\{[\s\S]*\}/);
          if (match) {
            try {
              const chunkResult = JSON.parse(match[0]);
              if (chunkResult.concepts) allConcepts.push(...chunkResult.concepts);
              if (chunkResult.fleetingCards) allFleeting.push(...chunkResult.fleetingCards);
              if (chunkResult.relations) allRelations.push(...chunkResult.relations);
              if (chunkResult.digest) globalDigest = chunkResult.digest;
            } catch {
              // Skip bad chunk, continue with next
            }
          }
        }

        // Deduplicate concepts by name
        const seenConcepts = new Set<string>();
        const uniqueConcepts = allConcepts.filter(c => {
          const key = c.name.toLowerCase();
          if (seenConcepts.has(key)) return false;
          seenConcepts.add(key);
          return true;
        });

        if (uniqueConcepts.length === 0) {
          return { content: [{ type: 'text', text: '文档解析失败：未能提取出任何概念' }], details: { error: 'No concepts extracted across all chunks' } };
        }

        parsed = {
          title: params.source_title || params.topic,
          concepts: uniqueConcepts,
          fleetingCards: allFleeting,
          relations: allRelations as Array<{ from: string; to: string; type: 'prerequisite' | 'related' | 'derived' }>,
        };
      } else {
        // ── Single-chunk processing (original behavior) ──

        const prompt = `你是一个知识萃取专家。将以下文档解析为结构化的知识卡片体系。

## 输出要求

以严格的 JSON 格式返回（不要 \`\`\`json 包裹，不要任何其他文字）：

{
  "title": "文档标题",
  "concepts": [
    {
      "name": "核心概念名称",
      "description": "此概念的简要定义和说明（100-200 字）"
    }
  ],
  "fleetingCards": [
    {
      "title": "知识点标题",
      "content": "此知识点的详细说明（200-500 字），包括定义、原理、示例等。如果涉及代码，请包含代码片段。",
      "linksTo": ["关联的核心概念名称1", "关联的核心概念名称2"]
    }
  ],
  "relations": [
    {
      "from": "概念A名称",
      "to": "概念B名称",
      "type": "prerequisite | related | derived"
    }
  ]
}

## 规则

1. **concepts**（permanent 卡片）：提取文档中的核心概念。每个概念是一个独立的、完整的知识单元。通常 5-15 个。
2. **fleetingCards**（fleeting 卡片）：提取具体的知识点、细节、例子、代码片段等。每个 fleetingCard 必须有 linksTo 属性，关联到 1-3 个核心概念。
3. **relations**：定义核心概念之间的关系。prerequisite = A 是 B 的前置知识；derived = A 衍生出 B；related = A 和 B 同级相关。
4. 所有名称必须精准，后续用 [[名称]] 做 WikiLink 匹配。
5. fleetingCards 的数量应该在 15-40 条之间，覆盖文档的主要内容。

## 文档内容

主题：${params.topic}
${params.source_title ? `标题：${params.source_title}` : ''}

---

${params.document}

## ⚠️ 强制输出语言：中文
所有内容必须用中文输出。专有名词保留原文。`;

        const response = await aiManager.callAPI(
          '你是知识萃取专家。内部推理即可，不要输出思考过程。直接返回 JSON 结果。',
          [{ role: 'user', content: prompt }],
        );

        // ── Step 2: 解析 AI 输出 ─────────────────────────────────────────

        const cleaned = response.replace(/```(?:json)?\s*/g, '').replace(/\s*```/g, '');
        const match = cleaned.match(/\{[\s\S]*\}/);

        if (!match) {
          return { content: [{ type: 'text', text: '文档解析失败：AI 输出格式不正确' }], details: { error: 'AI output parse failed', raw: response.slice(0, 500) } };
        }

        try {
          parsed = JSON.parse(match[0]);
        } catch {
          return { content: [{ type: 'text', text: '文档解析失败：JSON 解析错误' }], details: { error: 'JSON parse failed', raw: match[0].slice(0, 500) } };
        }

        if (!parsed.concepts || parsed.concepts.length === 0) {
          return { content: [{ type: 'text', text: '文档解析失败：未能提取出任何概念' }], details: { error: 'No concepts extracted', raw: match[0].slice(0, 500) } };
        }
      }

      // ── Step 3: 确保 cluster 存在 ─────────────────────────────────────

      let cluster = await prisma.cluster.findFirst({
        where: { vaultId, name: clusterName },
      });
      if (!cluster) {
        cluster = await prisma.cluster.create({
          data: { vaultId, name: clusterName, color: '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0') },
        });
      }

      // ── Step 4: 批量创建 permanent 卡片 ───────────────────────────────

      const docTitle = parsed.title || params.source_title || params.topic;
      let createdCount = { permanent: 0, fleeting: 0, literature: 0, edges: 0 };

      for (const concept of parsed.concepts) {
        const content = `## ${concept.name}\n\n${concept.description}\n\n---\n_从「${docTitle}」自动生成_`;
        const path = `${clusterName}/${concept.name.replace(/[/\\]/g, '_')}.md`;

        await prisma.card.upsert({
          where: { vaultId_path: { vaultId, path } },
          update: { content, type: 'permanent', clusterId: cluster.id },
          create: { vaultId, clusterId: cluster.id, path, title: concept.name, content, type: 'permanent', tags: JSON.stringify([params.topic, 'core']) },
        });
        createdCount.permanent++;
      }

      // ── Step 5: 批量创建 fleeting 卡片（带 WikiLink） ─────────────────

      for (const fc of parsed.fleetingCards) {
        // Build [[WikiLink]] references to permanent concepts
        const linksSection = fc.linksTo.length > 0
          ? '\n\n**关联概念：** ' + [...new Set(fc.linksTo)].map(t => `[[${t}]]`).join('、')
          : '';

        const content = `## ${fc.title}\n\n${fc.content}${linksSection}\n\n---\n_从「${docTitle}」自动生成_`;
        const path = `${clusterName}/${fc.title.replace(/[/\\]/g, '_')}.md`;

        await prisma.card.upsert({
          where: { vaultId_path: { vaultId, path } },
          update: { content, type: 'fleeting', clusterId: cluster.id },
          create: { vaultId, clusterId: cluster.id, path, title: fc.title, content, type: 'fleeting', tags: JSON.stringify([params.topic, 'idea']) },
        });
        createdCount.fleeting++;
      }

      // ── Step 6: 创建 literature 卡片记录来源 ──────────────────────────

      if (params.source_title || parsed.title) {
        const litContent = `## ${docTitle}\n\n> 本文档由 import_document 工具导入。\n\n**主题：** ${params.topic}\n\n---\n_自动生成文献记录_`;
        const litPath = `${clusterName}/${docTitle.replace(/[/\\]/g, '_')}.md`;

        await prisma.card.upsert({
          where: { vaultId_path: { vaultId, path: litPath } },
          update: { content: litContent, type: 'literature', clusterId: cluster.id },
          create: { vaultId, clusterId: cluster.id, path: litPath, title: docTitle, content: litContent, type: 'literature', tags: JSON.stringify([params.topic, 'reference', `hash:sha256:${contentHash}`]) },
        });
        createdCount.literature++;
      }

      // ── Step 7: 建立 relations → edges ────────────────────────────────

      // 先建立所有卡片名称 → id 的映射（限定当前 vault）
      const allCards = await prisma.card.findMany({
        where: { vaultId },
        select: { id: true, title: true },
      });
      const cardIdByName = new Map<string, string>();
      for (const c of allCards) {
        if (c.title) cardIdByName.set(c.title, c.id);
      }

      // 通过 content [[WikiLink]] 同步 edges
      const cardsWithLinks = await prisma.card.findMany({
        where: { vaultId, content: { contains: '[[' } },
        select: { id: true, title: true, content: true },
      });

      for (const card of cardsWithLinks) {
        // Use syncEdgesFromContent to parse [[WikiLink]] into edges
        const { syncEdgesFromContent } = await import('@/lib/wiki-links');
        await syncEdgesFromContent(prisma, card.id, vaultId, card.content);
      }

      // 额外添加 relations 中定义的 edge（如果还没有的话）
      for (const rel of parsed.relations || []) {
        const sourceId = cardIdByName.get(rel.from);
        const targetId = cardIdByName.get(rel.to);
        if (!sourceId || !targetId) continue;

        const existing = await prisma.edge.findFirst({
          where: { vaultId, sourceId, targetId, type: rel.type },
        });
        if (!existing) {
          await prisma.edge.create({
            data: { vaultId, sourceId, targetId, type: rel.type, weight: 1.0 },
          });
          createdCount.edges++;
        }
      }

      // ── Step 8: 生成报告 ──────────────────────────────────────────────

      const report = `
## 文档导入完成：${docTitle}

**主题：** ${params.topic}
**知识域：** ${clusterName}

### 导入统计

| 类型 | 数量 |
|------|------|
| 📘 核心概念（Permanent） | ${createdCount.permanent} |
| 🏷️ 知识点（Fleeting） | ${createdCount.fleeting} |
| 📄 文献记录（Literature） | ${createdCount.literature} |
| 🔗 关联边（Edges） | ${createdCount.edges} |
| **合计** | **${createdCount.permanent + createdCount.fleeting + createdCount.literature} 张卡片** |

### 核心概念
${parsed.concepts.map(c => `- **${c.name}**：${c.description.slice(0, 80)}${c.description.length > 80 ? '...' : ''}`).join('\n')}

### 操作建议
- 在 Galaxy 视图中查看知识图谱
- 使用 \`create_learning_path\` 为此主题创建学习路径
- 使用 \`get_learning_progress\` 跟踪学习进度
`;

      return {
        content: [{ type: 'text', text: report }],
        details: {
          document_title: docTitle,
          topic: params.topic,
          stats: createdCount,
          concepts: parsed.concepts.map(c => c.name),
          fleeting_count: parsed.fleetingCards.length,
          edges_count: parsed.relations?.length || 0,
        },
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `文档导入失败: ${(error as Error).message}` }],
        details: { error: (error as Error).message },
      };
    }
  }
);

export function registerImportDocumentTool(): void {
  toolRegistry.register(importDocumentTool);
}
