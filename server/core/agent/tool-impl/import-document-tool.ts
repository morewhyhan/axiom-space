/**
 * AXIOM 内置工具 - 文档导入知识卡片
 *
 * 接收一篇完整文档（教材章节、论文、文章），AI 自动解析为：
 * - 核心概念 → extracted fleeting 卡片
 * - 细节知识点 → fleeting 卡片
 * - 来源文献 → literature 卡片
 * - 概念间关联 → 自动建立 WikiLink + edge
 *
 * 一次调用完成全部导入，避免逐张创建的低效。
 */

import { Type } from '@mariozechner/pi-ai';
import { createTool, toolRegistry } from "../tools";
import { getCurrentVaultId, getCurrentUserId } from '../agent-context';
import { DocumentImportError, importDocumentToVault } from '@/server/core/learning/document-import-service';

const importDocumentTool = createTool(
  'import_document',
  '导入文档生成知识卡片',
  '将一篇完整的文档（教材章节、论文、文章等）解析为结构化的知识卡片体系。'
  + '自动提取核心概念候选与细节知识点，全部先写入 fleeting 灵感草稿，'
  + '并建立概念间的关联关系（WikiLink + edge）。一次调用完成全部导入，避免逐张创建。'
  + '支持任意长度的文档，长文档会自动进行语义分块处理。(最大单块 20000 字，自动重叠 8% 以保持上下文连贯)'
  + '【触发时机】当用户说"帮我整理这篇文档"、"把这本书转成卡片"、"导入这篇文章"、'
  + '"从这篇文章生成知识点"、"帮我读这本书"、"把这段内容做成闪念卡片"等类似请求时，'
  + '必须调用此工具。请直接将文档全文传入，不要先用其他工具分析。',
  Type.Object({
    document: Type.String({ description: '文档全文内容，支持任意长度。长文档会自动分块处理。' }),
    topic: Type.String({ description: '文档的主题/领域名称，如"数据结构与算法"、"操作系统"等' }),
    source_title: Type.Optional(Type.String({ description: '文档标题（可选）。留空则自动从内容推断。' })),
    source: Type.Optional(Type.String({ description: '资料来源、URL、书名、课程名或粘贴来源说明。未提供时会记录为 AI 工作台粘贴导入。' })),
    cluster_name: Type.Optional(Type.String({ description: '兼容旧参数。实际星团会由导入服务按现有知识结构自动匹配。' })),
  }),
  async (_id, params) => {
    try {
      const vaultId = getCurrentVaultId();
      const userId = getCurrentUserId();
      if (!vaultId || !userId) {
        return { content: [{ type: 'text', text: '缺少必要上下文（Vault ID 或 User ID）' }], details: { error: 'Missing context' } };
      }

      const source = (params.source || params.source_title || `AI 工作台粘贴导入 / ${params.topic}`).trim();
      const result = await importDocumentToVault({
        userId,
        vaultId,
        document: params.document,
        topic: params.topic,
        source,
        sourceTitle: params.source_title || params.topic,
      });

      const report = `
## 文档导入完成：${result.docTitle}

**主题：** ${params.topic}
**知识域：** ${result.clusterName}
**来源：** ${result.source}

### 导入统计

| 类型 | 数量 |
|------|------|
| 核心概念候选 | ${result.concepts.length} |
| 实际写入灵感草稿 | ${result.stats.fleeting} |
| 文献记录 | ${result.stats.literature} |
| 关联边 | ${result.stats.edges} |
| 跳过/重复 | ${result.stats.skipped} |
| 错误 | ${result.stats.errors} |
| 合计 | ${result.stats.permanent + result.stats.fleeting + result.stats.literature} 张卡片 |

### 核心概念
${result.concepts.map((name) => `- ${name}`).join('\n')}

### 操作建议
- 在 Galaxy 视图中查看文献、灵感草稿和关系边
- 从学习路径进入 AI 工作台继续打磨灵感草稿
- 只有用户确认并满足质量门禁后，灵感草稿才会沉淀为永久知识
`;

      return {
        content: [{ type: 'text', text: report }],
        details: {
          document_title: result.docTitle,
          topic: params.topic,
          source: result.source,
          contentHash: result.contentHash,
          clusterId: result.clusterId,
          clusterName: result.clusterName,
          literatureCardId: result.literatureCardId,
          sourceDocumentId: result.sourceDocumentId,
          pathId: result.pathId,
          duplicate: result.duplicate,
          stats: result.stats,
          concepts: result.concepts,
          fleeting_count: result.stats.fleeting,
          edges_count: result.stats.edges,
        },
      };
    } catch (error) {
      if (error instanceof DocumentImportError) {
        return {
          content: [{ type: 'text', text: `文档导入失败: ${error.code}` }],
          details: { error: error.code, detail: error.message },
        };
      }
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
