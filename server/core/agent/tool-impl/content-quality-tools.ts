/**
 * AXIOM 内置工具 - 内容质量检查
 *
 * 这些工具用于检查知识卡片和内容的质量，确保符合标准，
 * 包括格式验证、完整性检查、重复检测等。
 */

import { Type } from '@mariozechner/pi-ai';
import { createTool, toolRegistry } from "../tools";
import { prisma } from '@/lib/db';
import { getCurrentVaultId } from '../agent-context';
import { aiManager } from '../../ai/AIManager';
import { getFileStorage } from '@/server/infra/storage/GlobalFileStorage';
import { getVaultPath, resolvePath } from './helpers';

/**
 * 检查卡片质量（四要素验证）
 */
const checkCardQualityTool = createTool(
  'check_card_quality',
  '检查卡片质量',
  '检查知识卡片是否符合质量标准和"四要素"要求（定义、举例、关联、应用）。支持单张检查或批量扫描。',
  Type.Object({
    cardPath: Type.Optional(Type.String({ description: '卡片路径（可选，不填则扫描最新 20 张卡片）' })),
    auto_fix: Type.Optional(Type.Boolean({ description: '是否自动修复可修复的问题（默认 false）' })),
  }),
  async (_id, params) => {
    try {
      const vaultId = getCurrentVaultId();
      const vaultPath = getVaultPath();
      if (!vaultId || !vaultPath) {
        return { content: [{ type: 'text', text: '未找到当前 Vault' }], details: { error: 'No vault' } };
      }

      let cards: Array<{ id: string; title: string | null; content: string | null; type: string; path: string }>;

      if (params.cardPath) {
        const resolvedPath = resolvePath(params.cardPath);
        const card = await prisma.card.findFirst({
          where: { vaultId, path: { contains: params.cardPath.replace(/\.md$/, '') } },
          select: { id: true, title: true, content: true, type: true, path: true },
        });
        cards = card ? [card] : [];
      } else {
        cards = await prisma.card.findMany({
          where: { vaultId, type: { in: ['permanent', 'fleeting'] } },
          orderBy: { updatedAt: 'desc' },
          take: 20,
          select: { id: true, title: true, content: true, type: true, path: true },
        });
      }

      if (cards.length === 0) {
        return { content: [{ type: 'text', text: '未找到卡片' }], details: { error: 'No cards found' } };
      }

      const results: Array<{
        title: string; type: string; score: number; hasDefinition: boolean; hasExamples: boolean;
        hasRelations: boolean; hasApplications: boolean; issues: string[]; suggestions: string[];
      }> = [];

      for (const card of cards) {
        const content = card.content || '';
        const issues: string[] = [];
        const suggestions: string[] = [];

        // 四要素检查
        const hasDefinition = /\b(定义|是|指|概念|Definition|means|refers|is\s+a)\b/i.test(content);
        const hasExamples = /\b(例如|比如|举例|例子|示例|Example|e\.g\．|for example|such as)\b/i.test(content);
        const hasRelations = /\[\[.+?\]\]/.test(content);
        const hasApplications = /\b(应用|使用|场景|用途|Application|use\s+case|scenario|用于)\b/i.test(content);

        if (!hasDefinition) {
          issues.push('缺少定义(definition)');
          suggestions.push('添加概念的定义和解释，说明"是什么"');
        }
        if (!hasExamples) {
          issues.push('缺少举例(examples)');
          suggestions.push('添加至少一个具体的例子说明概念');
        }
        if (!hasRelations) {
          issues.push('缺少关联(relations)');
          suggestions.push('使用 [[WikiLink]] 关联到其他相关概念');
        }
        if (!hasApplications) {
          issues.push('缺少应用(applications)');
          suggestions.push('说明概念的使用场景和实际应用');
        }

        // 内容长度检查
        if (content.length < 100) {
          issues.push('内容过短(<100字符)');
          suggestions.push('扩展卡片内容，增加更多细节');
        }

        // WikiLink 格式检查
        const wikiLinks = content.match(/\[\[.+?\]\]/g);
        if (wikiLinks) {
          for (const link of wikiLinks) {
            const target = link.slice(2, -2).split('|')[0].trim();
            const targetCard = await prisma.card.findFirst({
              where: { vaultId, title: { contains: target } },
            });
            if (!targetCard) {
              issues.push(`[[${target}]] 指向不存在的卡片`);
              suggestions.push(`创建卡片 "${target}" 或修正链接`);
            }
          }
        }

        const score = 10 - issues.length * 2.5;
        results.push({
          title: card.title || '(无标题)',
          type: card.type,
          score: Math.max(0, score),
          hasDefinition, hasExamples, hasRelations, hasApplications,
          issues: [...new Set(issues)],
          suggestions: [...new Set(suggestions)],
        });
      }

      const totalScore = Math.round(results.reduce((s, r) => s + r.score, 0) / results.length * 10) / 10;

      const report = `
## 卡片质量检查报告

**总体评分**: ${totalScore}/10 (${results.length} 张卡片)

${results.map(r => `
### ${r.title} [${r.type === 'permanent' ? '永久卡' : '灵感卡'}]
**评分**: ${r.score}/10

**四要素状态**:
${r.hasDefinition ? '✅' : '❌'} 定义 | ${r.hasExamples ? '✅' : '❌'} 举例 | ${r.hasRelations ? '✅' : '❌'} 关联 | ${r.hasApplications ? '✅' : '❌'} 应用

${r.issues.length > 0 ? `**问题 (${r.issues.length})**:\n${r.issues.map(i => `- ${i}`).join('\n')}` : '✅ 卡片质量良好'}
${r.suggestions.length > 0 ? `\n**建议**:\n${r.suggestions.map(s => `- ${s}`).join('\n')}` : ''}
`).join('\n')}

### 总体建议
${totalScore >= 8 ? '✅ 卡片质量很好' : ''}
${totalScore >= 5 && totalScore < 8 ? '💪 部分卡片需要改进，建议逐一修复' : ''}
${totalScore < 5 ? '⚠️ 卡片质量较低，建议重新审视卡片标准并修订' : ''}
`;

      return {
        content: [{ type: 'text', text: report }],
        details: { cards_checked: results.length, average_score: totalScore, results },
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `检查失败: ${(error as Error).message}` }],
        details: { error: (error as Error).message },
      };
    }
  }
);

/**
 * 检查内容完整性
 */
const checkContentCompletenessTool = createTool(
  'check_content_completeness',
  '检查内容完整性',
  '检查特定内容是否包含必要的信息结构，如标题、元数据、引用来源等。',
  Type.Object({
    content: Type.String({ description: '要检查的内容' }),
    content_type: Type.Optional(Type.String({ description: '内容类型: "card"(卡片) / "literature"(文献) / "note"(笔记)，默认 card' })),
  }),
  async (_id, params) => {
    try {
      const content = params.content;
      const type = params.content_type || 'card';

      const checks: Array<{ name: string; passed: boolean; detail: string }> = [];

      // 基础结构检查
      const hasTitle = /^#\s+\S+/m.test(content);
      checks.push({ name: '标题', passed: hasTitle, detail: hasTitle ? '有标题' : '缺少 # 标题' });

      const hasFrontmatter = /^---\n[\s\S]*?\n---/.test(content);
      if (type === 'literature') {
        checks.push({ name: '元数据', passed: hasFrontmatter, detail: hasFrontmatter ? '有 frontmatter' : '文献卡片建议包含 frontmatter 元数据' });
      }

      const hasLinks = /\[\[.+?\]\]/.test(content);
      if (type === 'card') {
        checks.push({ name: '知识链接', passed: hasLinks, detail: hasLinks ? `有 ${content.match(/\[\[.+?\]\]/g)?.length || 0} 个 WikiLink` : '没有关联到其他概念' });
      }

      // 内容深度检查
      const wordCount = content.length;
      checks.push({ name: '内容长度', passed: wordCount >= 100, detail: `${wordCount} 字符${wordCount < 100 ? '（过短，建议至少 100 字）' : '（良好）'}` });

      const hasSections = /^#{2,3}\s+\S+/m.test(content);
      checks.push({ name: '分段结构', passed: hasSections, detail: hasSections ? '有分段标题' : '缺少层级结构（建议使用 ## 分段）' });

      const passedCount = checks.filter(c => c.passed).length;
      const score = Math.round((passedCount / checks.length) * 100);

      const report = `
## 内容完整性检查 (${type})

**完成度**: ${score}% (${passedCount}/${checks.length})

${checks.map(c => `${c.passed ? '✅' : '❌'} **${c.name}**: ${c.detail}`).join('\n')}

### 评估
${score >= 80 ? '✅ 内容结构完整' : ''}
${score >= 50 && score < 80 ? '💪 需要补充部分信息' : ''}
${score < 50 ? '⚠️ 内容结构不完整，建议补充' : ''}
`;

      return {
        content: [{ type: 'text', text: report }],
        details: { content_type: type, checks, score, passed: passedCount, total: checks.length },
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `检查失败: ${(error as Error).message}` }],
        details: { error: (error as Error).message },
      };
    }
  }
);

/**
 * 验证 Markdown 格式
 */
const validateMarkdownTool = createTool(
  'validate_markdown',
  '验证 Markdown 格式',
  '验证 Markdown 内容的格式是否正确，包括标题层级、链接语法、代码块闭合等。',
  Type.Object({
    content: Type.String({ description: '要验证的 Markdown 内容' }),
  }),
  async (_id, params) => {
    try {
      const content = params.content;
      const errors: Array<{ line: number; message: string }> = [];
      const warnings: Array<{ line: number; message: string }> = [];
      const lines = content.split('\n');

      // 检查标题层级跳跃（如 # 到 ### 没有 ##）
      let lastLevel = 0;
      for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(/^(#{1,6})\s/);
        if (match) {
          const level = match[1].length;
          if (lastLevel > 0 && level > lastLevel + 1) {
            warnings.push({ line: i + 1, message: `标题层级跳跃: ${'#'.repeat(lastLevel)} → ${'#'.repeat(level)}` });
          }
          lastLevel = level;
        }
      }

      // 检查未闭合的代码块
      const codeFenceCount = (content.match(/```/g) || []).length;
      if (codeFenceCount % 2 !== 0) {
        errors.push({ line: 0, message: '代码块未闭合（``` 数量为奇数）' });
      }

      // 检查不合法的链接语法
      const linkMatches = content.match(/\[.+?\]\(.*?\)/g);
      if (linkMatches) {
        for (const link of linkMatches) {
          if (link.endsWith('()')) {
            errors.push({ line: 0, message: `空链接: ${link.slice(0, 50)}` });
          }
        }
      }

      // 检查未闭合的标记
      const boldCount = (content.match(/\*\*/g) || []).length;
      if (boldCount % 2 !== 0) {
        errors.push({ line: 0, message: '加粗标记 ** 未成对' });
      }

      // 检查过长行
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].length > 500) {
          warnings.push({ line: i + 1, message: `行过长 (${lines[i].length} 字符，建议 ≤500)` });
        }
      }

      const report = `
## Markdown 格式验证

### 结果
${errors.length === 0 && warnings.length === 0 ? '✅ 格式正确，无问题' : ''}

${errors.length > 0 ? `### 错误 (${errors.length})\n${errors.map(e => `🔴 第 ${e.line} 行: ${e.message}`).join('\n')}` : ''}

${warnings.length > 0 ? `### 警告 (${warnings.length})\n${warnings.map(w => `⚠️ 第 ${w.line} 行: ${w.message}`).join('\n')}` : ''}

### 统计
- 总行数: ${lines.length}
- 总字符数: ${content.length}
- 代码块: ${Math.floor(codeFenceCount / 2)} 个
- 标题数: ${(content.match(/^#{1,6}\s/gm) || []).length} 个
- WikiLink: ${(content.match(/\[\[.+?\]\]/g) || []).length} 个
`;
      return {
        content: [{ type: 'text', text: report }],
        details: { valid: errors.length === 0, errors, warnings, stats: { lines: lines.length, chars: content.length } },
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `验证失败: ${(error as Error).message}` }],
        details: { error: (error as Error).message },
      };
    }
  }
);

/**
 * 检测重复内容
 */
const detectDuplicatesTool = createTool(
  'detect_duplicates',
  '检测重复内容',
  '检测 Vault 中相似的卡片或内容，避免概念冗余。使用文本相似度分析。',
  Type.Object({
    cardPath: Type.Optional(Type.String({ description: '特定卡片路径（可选，不填则扫描全部卡片）' })),
    threshold: Type.Optional(Type.Number({ description: '相似度阈值 0-1，默认 0.8' })),
  }),
  async (_id, params) => {
    try {
      const vaultId = getCurrentVaultId();
      if (!vaultId) {
        return { content: [{ type: 'text', text: '未找到当前 Vault' }], details: { error: 'No vault id' } };
      }

      let cards = await prisma.card.findMany({
        where: { vaultId, type: { in: ['permanent', 'fleeting'] } },
        select: { id: true, title: true, content: true, type: true },
        take: 100,
      });

      if (params.cardPath) {
        const targetCard = await prisma.card.findFirst({
          where: { vaultId, path: { contains: params.cardPath.replace(/\.md$/, '') } },
          select: { id: true, title: true, content: true, type: true },
        });
        if (targetCard) {
          cards = cards.filter(c => c.id !== targetCard.id);
          // 计算相似度
          const target = (targetCard.content || '') + (targetCard.title || '');
          const duplicates: Array<{ title: string; similarity: number; reason: string }> = [];

          for (const card of cards) {
            const candidate = (card.content || '') + (card.title || '');
            const similarity = simpleTextSimilarity(target, candidate);
            if (similarity >= (params.threshold || 0.8)) {
              duplicates.push({ title: card.title || '(无标题)', similarity: Math.round(similarity * 100) / 100, reason: '内容高度相似' });
            }
          }

          if (duplicates.length === 0) {
            return { content: [{ type: 'text', text: `"${targetCard.title}" 未发现明显重复内容` }], details: { card: targetCard.title, duplicates: [] } };
          }

          const report = `
## 重复内容检测 — "${targetCard.title}"

发现 ${duplicates.length} 个可能的重复:
${duplicates.map(d => `- **${d.title}** (相似度: ${(d.similarity * 100).toFixed(0)}%) - ${d.reason}`).join('\n')}

### 建议
1. 审查上述可能的重复卡片
2. 考虑合并内容或删除冗余
3. 使用 \`merge_duplicate_cards\` 自动合并
`;

          return { content: [{ type: 'text', text: report }], details: { card: targetCard.title, duplicates } };
        }
        return { content: [{ type: 'text', text: `未找到卡片: ${params.cardPath}` }], details: { error: 'Card not found' } };
      }

      // 全局扫描：比较所有卡片对
      const duplicatePairs: Array<{ cardA: string; cardB: string; similarity: number }> = [];
      for (let i = 0; i < cards.length; i++) {
        for (let j = i + 1; j < cards.length; j++) {
          const textA = (cards[i].content || '') + (cards[i].title || '');
          const textB = (cards[j].content || '') + (cards[j].title || '');
          const sim = simpleTextSimilarity(textA, textB);
          if (sim >= (params.threshold || 0.8)) {
            duplicatePairs.push({ cardA: cards[i].title || '(无)', cardB: cards[j].title || '(无)', similarity: sim });
          }
        }
        if (duplicatePairs.length >= 20) break; // 限制输出数量
      }

      if (duplicatePairs.length === 0) {
        return { content: [{ type: 'text', text: `分析 ${cards.length} 张卡片，未发现重复内容` }], details: { duplicates: [] } };
      }

      const report = `
## 重复内容检测报告

扫描 ${cards.length} 张卡片，发现 ${duplicatePairs.length} 组可能重复:

${duplicatePairs.map(d => `- **${d.cardA}** ↔ **${d.cardB}** (相似度: ${(d.similarity * 100).toFixed(0)}%)`).join('\n')}

### 建议
1. 审查上述重复组，确认是否需要合并
2. 使用 \`merge_duplicate_cards\` 进行合并
3. 检查是否需要保留不同角度的描述
`;

      return { content: [{ type: 'text', text: report }], details: { cards_scanned: cards.length, duplicates: duplicatePairs } };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `检测失败: ${(error as Error).message}` }],
        details: { error: (error as Error).message },
      };
    }
  }
);

/**
 * 检查链接有效性
 */
const checkLinkValidityTool = createTool(
  'check_link_validity',
  '检查链接有效性',
  '检查 Vault 中所有卡片之间的 WikiLink 是否有效（目标卡片是否真实存在）。',
  Type.Object({
    fix_broken: Type.Optional(Type.Boolean({ description: '是否自动修复断链（删除无效链接），默认 false' })),
  }),
  async (_id, params) => {
    try {
      const vaultId = getCurrentVaultId();
      if (!vaultId) {
        return { content: [{ type: 'text', text: '未找到当前 Vault' }], details: { error: 'No vault id' } };
      }

      const cards = await prisma.card.findMany({
        where: { vaultId, type: { in: ['permanent', 'fleeting', 'literature'] } },
        select: { id: true, title: true, path: true },
      });

      const allTitles = new Set(cards.map(c => c.title?.toLowerCase()).filter(Boolean));
      const brokenLinks: Array<{ cardTitle: string; brokenLink: string }> = [];

      for (const card of cards) {
        // 读取卡片内容
        const fullCard = await prisma.card.findUnique({
          where: { id: card.id },
          select: { content: true },
        });
        if (!fullCard?.content) continue;

        const content = fullCard.content;
        const wikiLinks = content.match(/\[\[.+?\]\]/g) || [];
        for (const link of wikiLinks) {
          const target = link.slice(2, -2).split('|')[0].split('#')[0].trim();
          if (target && !allTitles.has(target.toLowerCase())) {
            // 检查是否是文件路径引用
            if (!target.includes('/') && !target.includes('.')) {
              brokenLinks.push({ cardTitle: card.title || '(无标题)', brokenLink: target });
            }
          }
        }
      }

      if (brokenLinks.length === 0) {
        return { content: [{ type: 'text', text: `检查 ${cards.length} 张卡片，所有 WikiLink 均有效 ✅` }], details: { cards_checked: cards.length, broken_count: 0 } };
      }

      // 按来源分组
      const grouped: Record<string, string[]> = {};
      for (const bl of brokenLinks) {
        if (!grouped[bl.cardTitle]) grouped[bl.cardTitle] = [];
        grouped[bl.cardTitle].push(bl.brokenLink);
      }

      const report = `
## 链接有效性检查

检查 ${cards.length} 张卡片，发现 ${brokenLinks.length} 个无效链接:

${Object.entries(grouped).map(([card, links]) =>
  `- **${card}**: ${links.map(l => `[[${l}]]`).join(', ')}`
).join('\n')}

### 影响评估
${brokenLinks.length <= 5 ? '🟢 少量断链，影响有限' : ''}
${brokenLinks.length > 5 && brokenLinks.length <= 20 ? '🟡 中等数量断链，建议修复' : ''}
${brokenLinks.length > 20 ? '🔴 大量断链，需要系统清理' : ''}

### 建议
1. 创建缺失的卡片以修复链接
2. 或删除卡片中无效的 [[链接]]
${params.fix_broken ? '（自动修复模式未实现，请在编辑器中手动修复）' : '（使用 fix_broken=true 开启自动修复警告标记）'}
`;

      return {
        content: [{ type: 'text', text: report }],
        details: { cards_checked: cards.length, broken_count: brokenLinks.length, broken_links: brokenLinks },
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `检查失败: ${(error as Error).message}` }],
        details: { error: (error as Error).message },
      };
    }
  }
);

/**
 * 简单的文本相似度计算（基于 Jaccard 相似度 + 词袋）
 */
function simpleTextSimilarity(textA: string, textB: string): number {
  const tokensA = new Set(textA.toLowerCase().split(/[\s,.;:!?()\[\]{}"'，。；：！？（）【】""'']+/).filter(t => t.length > 1));
  const tokensB = new Set(textB.toLowerCase().split(/[\s,.;:!?()\[\]{}"'，。；：！？（）【】""'']+/).filter(t => t.length > 1));

  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let intersection = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) intersection++;
  }

  const union = tokensA.size + tokensB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

export function registerContentQualityTools(): void {
  toolRegistry.register(checkCardQualityTool);
  toolRegistry.register(checkContentCompletenessTool);
  toolRegistry.register(validateMarkdownTool);
  toolRegistry.register(detectDuplicatesTool);
  toolRegistry.register(checkLinkValidityTool);
}
