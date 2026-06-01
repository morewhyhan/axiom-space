/**
 * RAG 检索增强生成器
 *
 * 在资源生成前从 Vault 检索相关资料，作为 LLM 的参考输入
 * 实现防幻觉的第一道防线
 */

import { prisma } from '@/lib/db';

export interface RAGResult {
  enhancedPrompt: string;
  citations: Array<{
    id: string;
    title: string;
    source: string;
    content: string;
  }>;
  searchQuery: string;
}

export class RAGEnhancer {
  /**
   * 从 Vault 搜索相关资料
   */
  async searchVault(
    topic: string,
    vaultId: string,
    limit: number = 5
  ): Promise<Array<{
    id: string;
    title: string;
    source: string;
    content: string;
  }>> {
    try {
      // 从数据库中搜索相关卡片
      const cards = await prisma.card.findMany({
        where: {
          vaultId,
          OR: [
            { title: { contains: topic } },
            { content: { contains: topic } },
          ]
        },
        select: {
          id: true,
          title: true,
          content: true,
          path: true,
        },
        take: limit,
        orderBy: { updatedAt: 'desc' }
      });

      return cards.map((c: any) => ({
        id: c.id,
        title: c.title || 'Untitled',
        source: c.path || 'Vault',
        content: c.content || '',
      }));
    } catch (error) {
      console.error('[RAGEnhancer] 搜索 Vault 失败:', error);
      return [];
    }
  }

  /**
   * 使用 RAG 增强 prompt
   */
  async enrichPrompt(
    originalPrompt: string,
    topic: string,
    vaultId: string,
    resourceType: string = 'document'
  ): Promise<RAGResult> {
    // 搜索相关资料
    const citations = await this.searchVault(topic, vaultId, 5);

    // 如果找不到相关资料，返回原始 prompt（带警告）
    if (citations.length === 0) {
      return {
        enhancedPrompt: `${originalPrompt}

【重要提示】
当前 Vault 中缺少与 "${topic}" 相关的参考资料。
请基于你的通用知识生成内容，但必须：
1. 明确标注哪些内容缺乏参考验证
2. 建议用户补充更多学习材料
3. 避免编造具体数据或引用`,
        citations: [],
        searchQuery: topic
      };
    }

    // 构建参考内容
    const referenceContent = citations
      .map((c, idx) => `【参考 ${idx + 1}】《${c.title}》
来源: ${c.source}
内容摘要: ${c.content.slice(0, 500)}${c.content.length > 500 ? '...' : ''}`)
      .join('\n\n');

    // 增强 prompt
    const enhancedPrompt = `${originalPrompt}

---
【参考资料】
${referenceContent}

【生成要求】
1. 严格基于上述参考资料生成内容，避免编造事实
2. 重点信息必须用 [引用 N] 的格式标注来源
3. 如果参考资料不足以完整回答问题，请明确说明
4. 生成的资源末尾自动附参考文献列表

【禁止行为】
- 编造具体的统计数据、公式或代码
- 虚构引用或作者
- 添加参考资料中不存在的概念`;

    return {
      enhancedPrompt,
      citations,
      searchQuery: topic
    };
  }

  /**
   * 在生成的内容中强制附加参考文献
   */
  formatWithCitations(content: string, citations: RAGResult['citations']): string {
    if (citations.length === 0) return content;

    // 检查内容是否已包含引用标记
    const hasReferences = /\[引用\s*\d+\]/g.test(content);

    if (!hasReferences) {
      // 如果没有引用标记，在末尾添加"基于以下资料生成"
      content = `${content}

---
## 参考资料

本内容基于以下资料生成：`;
    }

    // 添加引用列表
    const referenceList = citations
      .map((c, idx) => `${idx + 1}. 《${c.title}》 - ${c.source}`)
      .join('\n');

    return `${content}

${referenceList}`;
  }
}

export const ragEnhancer = new RAGEnhancer();
