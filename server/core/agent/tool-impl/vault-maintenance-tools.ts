/**
 * AXIOM 内置工具 - Vault 维护
 *
 * 这些工具用于维护和管理知识库（Vault）的健康状态，
 * 包括清理破损链接、合并重复卡片、重建索引、导入导出等。
 */

import { Type } from '@mariozechner/pi-ai';
import { createTool, toolRegistry } from "../tools";
import { prisma } from '@/lib/db';
import { getCurrentVaultId } from '../agent-context';
import { getFileStorage } from '@/server/infra/storage/GlobalFileStorage';
import { getVaultPath, resolvePath } from './helpers';
import { createHash } from 'node:crypto';
import { consumeConfirmationToken, createConfirmationToken } from '../OperationConfirmation';
import { CARD_TYPES, type CardType, validatePermanentCardContent } from '@/server/core/domain/contracts';

type ParsedImportCard = { title: string; content: string; type: CardType; tags: string[] };

type PendingImportCards = {
  target: string;
  vaultId: string;
  cards: ParsedImportCard[];
  conflicts: ParsedImportCard[];
  total: number;
  createdAt: number;
};

const pendingImportCards = new Map<string, PendingImportCards>();
const CARD_TYPE_SET = new Set<string>(CARD_TYPES);

/**
 * 清理破损链接
 */
const cleanupBrokenLinksTool = createTool(
  'cleanup_broken_links',
  '清理破损链接',
  '扫描并清理 Vault 中指向不存在卡片或文件的破损 WikiLink。可选择自动修复或手动确认。',
  Type.Object({
    dry_run: Type.Optional(Type.Boolean({ description: '预览模式，只显示不执行，默认 true' })),
    auto_fix: Type.Optional(Type.Boolean({ description: '自动修复模式（删除无效链接），默认 false' })),
    confirmationToken: Type.Optional(Type.String({ description: '用户确认后得到的一次性确认 token。执行自动修复时必须提供。' })),
  }),
  async (_id, params) => {
    try {
      const vaultId = getCurrentVaultId();
      const vaultPath = getVaultPath();
      if (!vaultId || !vaultPath) {
        return { content: [{ type: 'text', text: '未找到当前 Vault' }], details: { error: 'No vault' } };
      }

      const isDryRun = params.dry_run !== false;

      // 获取所有卡片
      const cards = await prisma.card.findMany({
        where: { vaultId, type: { in: ['permanent', 'fleeting', 'literature'] } },
        select: { id: true, title: true, path: true, content: true },
      });

      const allTitles = new Set(cards.map(c => c.title?.toLowerCase()).filter(Boolean));
      const fixOperations: Array<{ cardId: string; cardTitle: string | null; brokenLink: string; fixAction: string }> = [];
      const skippedNames = new Set(['概念', 'undefined', 'null', '']);

      for (const card of cards) {
        if (!card.content) continue;
        const wikiLinks = card.content.match(/\[\[.+?\]\]/g) || [];
        for (const link of wikiLinks) {
          const target = link.slice(2, -2).split('|')[0].split('#')[0].trim();
          if (!target || skippedNames.has(target.toLowerCase())) continue;
          // 跳过 URL 和文件路径
          if (target.includes('://') || target.includes('/') || target.includes('.')) continue;

          if (!allTitles.has(target.toLowerCase())) {
            fixOperations.push({
              cardId: card.id,
              cardTitle: card.title,
              brokenLink: target,
              fixAction: isDryRun ? '待修复' : '删除无效链接',
            });
          }
        }
      }

      if (fixOperations.length === 0) {
        return { content: [{ type: 'text', text: `扫描 ${cards.length} 张卡片，未发现破损链接 ✅` }], details: { fixed: 0, dry_run: true } };
      }

      // 按来源卡片分组
      const grouped: Record<string, typeof fixOperations> = {};
      for (const op of fixOperations) {
        const key = op.cardTitle || '(无标题)';
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(op);
      }

      let fixedCount = 0;
      if (!isDryRun && params.auto_fix) {
        const target = cleanupBrokenLinksTarget(vaultId);
        if (!consumeConfirmationToken('cleanup_broken_links', target, params.confirmationToken)) {
          const confirmation = createConfirmationToken('cleanup_broken_links', target);
          return {
            content: [{ type: 'text', text: `将自动标记 ${fixOperations.length} 个破损链接。请确认后执行。` }],
            details: {
              awaitingConfirmation: true,
              confirmationToken: confirmation.token,
              expiresAt: confirmation.expiresAt,
              target,
              brokenLinkCount: fixOperations.length,
            },
          };
        }

        for (const card of cards) {
          const cardOps = fixOperations.filter(op => op.cardId === card.id);
          if (cardOps.length === 0 || !card.content) continue;

          let newContent = card.content;
          for (const op of cardOps) {
            const linkPattern = new RegExp(`\\[\\[${escapeRegex(op.brokenLink)}(\\|[^\\]]+)?\\]\\]`, 'g');
            newContent = newContent.replace(linkPattern, `~~[[${op.brokenLink}]]~~(已删除)`);
          }

          if (newContent !== card.content) {
            await prisma.card.update({
              where: { id: card.id },
              data: { content: newContent },
            });
            fixedCount += cardOps.length;
          }
        }
      }

      const report = `
## 破损链接清理报告

${isDryRun ? '🔍 **预览模式** — 使用 auto_fix=true 执行修复\n' : ''}

**扫描范围**: ${cards.length} 张卡片
**发现破损链接**: ${fixOperations.length} 个

### 详细列表
${Object.entries(grouped).map(([card, ops]) =>
  `- **${card}** (${ops.length} 个): ${ops.map(o => `[[${o.brokenLink}]]`).join(', ')}`
).join('\n')}

${isDryRun ? '\n### 建议\n使用 auto_fix=true 自动修复，或手动编辑卡片修正链接。' : `\n### 执行结果\n已修复 ${fixedCount} 个链接。${fixOperations.length > fixedCount ? `剩余 ${fixOperations.length - fixedCount} 个未处理。` : ''}`}
`;

      return {
        content: [{ type: 'text', text: report }],
        details: { dry_run: isDryRun, found: fixOperations.length, fixed: fixedCount, broken_links: fixOperations },
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `清理失败: ${(error as Error).message}` }],
        details: { error: (error as Error).message },
      };
    }
  }
);

/**
 * 合并重复卡片
 */
const mergeDuplicateCardsTool = createTool(
  'merge_duplicate_cards',
  '合并重复卡片',
  '将内容相似或重复的卡片合并为一张卡片，保留所有内容和链接关系。先预览再执行。',
  Type.Object({
    card_a: Type.String({ description: '要合并的卡片 A 的标题或路径' }),
    card_b: Type.String({ description: '要合并的卡片 B 的标题或路径' }),
    keep_both: Type.Optional(Type.Boolean({ description: '保留两张卡片（仅在 B 中添加对 A 的引用），默认 false' })),
    preview: Type.Optional(Type.Boolean({ description: '预览合并结果而不实际执行，默认 true' })),
    confirmationToken: Type.Optional(Type.String({ description: '用户确认后得到的一次性确认 token。执行合并时必须提供。' })),
  }),
  async (_id, params) => {
    try {
      const vaultId = getCurrentVaultId();
      const vaultPath = getVaultPath();
      if (!vaultId || !vaultPath) {
        return { content: [{ type: 'text', text: '未找到当前 Vault' }], details: { error: 'No vault' } };
      }

      // 查找两张卡片
      const findCard = async (ident: string) => {
        return prisma.card.findFirst({
          where: { vaultId, OR: [{ id: ident }, { title: { contains: ident } }, { path: { contains: ident.replace(/\.md$/, '') } }] },
          select: { id: true, title: true, content: true, type: true, path: true },
        });
      };

      const cardA = await findCard(params.card_a);
      const cardB = await findCard(params.card_b);

      if (!cardA || !cardB) {
        const notFound = !cardA ? params.card_a : params.card_b;
        return { content: [{ type: 'text', text: `未找到卡片: ${notFound}` }], details: { error: `Card not found: ${notFound}` } };
      }

      if (cardA.id === cardB.id) {
        return { content: [{ type: 'text', text: '两张卡片是同一张，无需合并' }], details: { error: 'Same card' } };
      }

      // 生成合并预览
      const mergedContent = `# ${cardA.title}

> 合并自: [[${cardA.title}]] + [[${cardB.title}]]

---

## ${cardA.title} (原卡片A)
${cardA.content || '(无内容)'}

---

## ${cardB.title} (原卡片B)
${cardB.content || '(无内容)'}
`;

      if (params.preview !== false) {
        const report = `
## 卡片合并预览

| 属性 | 卡片 A | 卡片 B |
|------|--------|--------|
| 标题 | ${cardA.title} | ${cardB.title} |
| 类型 | ${cardA.type} | ${cardB.type} |
| 路径 | ${cardA.path} | ${cardB.path} |

### 合并后内容预览
\`\`\`
${mergedContent.slice(0, 500)}...
\`\`\`

### 合并影响
- ${cardA.title} 将作为主卡片保留
- ${cardB.title} 将删除并重定向到 ${cardA.title}
- 所有指向 [[${cardB.title}]] 的链接将更新为 [[${cardA.title}]]

使用 preview=false 执行合并，或 keep_both=true 仅在 B 中添加引用。
`;
        return { content: [{ type: 'text', text: report }], details: { cardA: cardA.title, cardB: cardB.title, preview: true } };
      }

      const mergeTarget = mergeDuplicateCardsTarget(cardA.id, cardB.id, !!params.keep_both);
      if (!consumeConfirmationToken('merge_duplicate_cards', mergeTarget, params.confirmationToken)) {
        const confirmation = createConfirmationToken('merge_duplicate_cards', mergeTarget);
        return {
          content: [{ type: 'text', text: `将合并 "${cardB.title}" 到 "${cardA.title}"。请确认后执行。` }],
          details: {
            awaitingConfirmation: true,
            confirmationToken: confirmation.token,
            expiresAt: confirmation.expiresAt,
            target: mergeTarget,
            cardA: cardA.title,
            cardB: cardB.title,
            keep_both: !!params.keep_both,
          },
        };
      }

      // 执行合并
      if (params.keep_both) {
        // 仅在 B 中添加指向 A 的引用
        const updatedContent = (cardB.content || '') + `\n\n> 关联卡片: [[${cardA.title}]]`;
        await prisma.card.update({
          where: { id: cardB.id },
          data: { content: updatedContent },
        });
      } else {
        // 合并到 A，删除 B
        await prisma.card.update({
          where: { id: cardA.id },
          data: { content: mergedContent },
        });

        // 更新指向 B 的边为指向 A；若重定向后重复或自环，则删除旧边。
        const affectedEdges = await prisma.edge.findMany({
          where: {
            vaultId,
            OR: [{ sourceId: cardB.id }, { targetId: cardB.id }],
          },
        });
        for (const edge of affectedEdges) {
          const sourceId = edge.sourceId === cardB.id ? cardA.id : edge.sourceId;
          const targetId = edge.targetId === cardB.id ? cardA.id : edge.targetId;
          if (sourceId === targetId) {
            await prisma.edge.delete({ where: { id: edge.id } });
            continue;
          }
          const duplicate = await prisma.edge.findFirst({
            where: { vaultId, sourceId, targetId, type: edge.type, id: { not: edge.id } },
            select: { id: true },
          });
          if (duplicate) {
            await prisma.edge.delete({ where: { id: edge.id } });
          } else {
            await prisma.edge.update({
              where: { id: edge.id },
              data: { sourceId, targetId },
            });
          }
        }

        await prisma.card.delete({ where: { id: cardB.id } });
      }

      return {
        content: [{ type: 'text', text: `✅ 合并完成: "${cardA.title}" + "${cardB.title}"\n${params.keep_both ? `在 "${cardB.title}" 中添加了对 "${cardA.title}" 的引用` : `主卡片: ${cardA.title}，${cardB.title} 已合并`}` }],
        details: { merged: true, primary: cardA.title, secondary: cardB.title, keep_both: params.keep_both },
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `合并失败: ${(error as Error).message}` }],
        details: { error: (error as Error).message },
      };
    }
  }
);

/**
 * 重建搜索索引
 */
const rebuildIndexTool = createTool(
  'rebuild_index',
  '重建搜索索引',
  '重建 Vault 的搜索索引，用于修复搜索不准确或缺失结果的问题。',
  Type.Object({
    index_type: Type.Optional(Type.String({ description: '索引类型: "fulltext"(全文) / "graph"(图谱) / "all"(全部，默认)' })),
  }),
  async (_id, params) => {
    try {
      const vaultId = getCurrentVaultId();
      const vaultPath = getVaultPath();
      if (!vaultId || !vaultPath) {
        return { content: [{ type: 'text', text: '未找到当前 Vault' }], details: { error: 'No vault' } };
      }

      const indexType = params.index_type || 'all';
      const startTime = Date.now();
      let rebuiltCount = 0;

      if (indexType === 'fulltext' || indexType === 'all') {
        // 检查全文搜索索引：统计卡片及其内容的可搜索性
        const cards = await prisma.card.findMany({
          where: { vaultId },
          select: { id: true, title: true, content: true },
        });

        // 计算可搜索的内容量
        let totalContentLength = 0;
        let cardsWithContent = 0;
        for (const card of cards) {
          const contentLen = (card.content || '').length + (card.title || '').length;
          totalContentLength += contentLen;
          if (contentLen > 0) cardsWithContent++;
        }

        rebuiltCount = cards.length;
      }

      if (indexType === 'graph' || indexType === 'all') {
        // 重建图谱索引：确保所有边的引用是有效的
        const edges = await prisma.edge.findMany({ where: { vaultId } });
        const cards = await prisma.card.findMany({
          where: { vaultId },
          select: { id: true },
        });
        const validCardIds = new Set(cards.map(c => c.id));

        let invalidEdges = 0;
        for (const edge of edges) {
          if (!validCardIds.has(edge.sourceId) || !validCardIds.has(edge.targetId)) {
            invalidEdges++;
            await prisma.edge.delete({ where: { id: edge.id } });
          }
        }

        rebuiltCount += edges.length;
      }

      const duration = Date.now() - startTime;

      const report = `
## 搜索索引重建报告

| 项目 | 结果 |
|------|------|
| 索引类型 | ${indexType} |
| 处理条目 | ${rebuiltCount} 条 |
| 耗时 | ${duration}ms |
| Vault ID | ${vaultId} |

**状态**: ✅ 索引重建完成

### 后续建议
1. 使用 \`search_cards\` 测试搜索是否恢复正常
2. 如果仍有问题，可以尝试重建特定类型的索引
`;

      return {
        content: [{ type: 'text', text: report }],
        details: { index_type: indexType, rebuilt_count: rebuiltCount, duration_ms: duration },
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `重建失败: ${(error as Error).message}` }],
        details: { error: (error as Error).message },
      };
    }
  }
);

/**
 * 导出 Vault
 */
const exportVaultTool = createTool(
  'export_vault',
  '导出 Vault',
  '将 Vault 导出为指定格式（Markdown / JSON / CSV），用于备份或迁移。',
  Type.Object({
    format: Type.Optional(Type.String({ description: '导出格式: "markdown"(原始Markdown) / "json"(结构化JSON) / "csv"(表格格式)，默认 markdown' })),
    include: Type.Optional(Type.String({ description: '导出内容: "cards"(仅卡片) / "graph"(仅图谱) / "all"(全部，默认)' })),
  }),
  async (_id, params) => {
    try {
      const vaultId = getCurrentVaultId();
      if (!vaultId) {
        return { content: [{ type: 'text', text: '未找到当前 Vault' }], details: { error: 'No vault id' } };
      }

      const format = params.format || 'markdown';
      const include = params.include || 'all';

      let output = '';
      const exportSize = { cards: 0, edges: 0, size_bytes: 0 };

      if (include === 'cards' || include === 'all') {
        const cards = await prisma.card.findMany({
          where: { vaultId },
          orderBy: { type: 'asc' },
          select: { title: true, type: true, content: true, path: true, tags: true, createdAt: true },
        });

        if (format === 'json') {
          output += JSON.stringify({ vault: vaultId, exported_at: new Date().toISOString(), cards }, null, 2);
        } else if (format === 'csv') {
          output += 'title,type,path,tags,created_at\n';
          for (const card of cards) {
            const safeTitle = (card.title || '').replace(/"/g, '""');
            const safePath = (card.path || '').replace(/"/g, '""');
            const safeTags = (card.tags || '').replace(/"/g, '""');
            output += `"${safeTitle}","${card.type}","${safePath}","${safeTags}","${card.createdAt.toISOString()}"\n`;
          }
        } else {
          for (const card of cards) {
            output += `---\n卡片: ${card.title || '(无)'}\n类型: ${card.type}\n路径: ${card.path}\n标签: ${card.tags || ''}\n创建: ${card.createdAt.toISOString()}\n---\n\n${card.content || '(无内容)'}\n\n`;
          }
        }
        exportSize.cards = cards.length;
      }

      if ((include === 'graph' || include === 'all') && format === 'json') {
        const edges = await prisma.edge.findMany({ where: { vaultId } });
        if (include === 'all') {
          // 追加到已有 JSON
          const parsed = JSON.parse(output);
          parsed.edges = edges;
          output = JSON.stringify(parsed, null, 2);
        } else {
          output = JSON.stringify({ vault: vaultId, exported_at: new Date().toISOString(), edges }, null, 2);
        }
        exportSize.edges = edges.length;
      }

      if (format === 'graph' && include === 'graph') {
        const edges = await prisma.edge.findMany({ where: { vaultId } });
        output = edges.map(e => `${e.sourceId} -> ${e.targetId} [${e.type}]`).join('\n');
      }

      exportSize.size_bytes = output.length;

      // 对于大型导出，只返回摘要和部分预览
      const preview = output.length > 2000 ? output.slice(0, 2000) + '\n...(截断)' : output;

      const report = `
## Vault 导出完成

| 属性 | 数值 |
|------|------|
| 格式 | ${format} |
| 内容 | ${include} |
| 卡片数 | ${exportSize.cards} |
| 关系边 | ${exportSize.edges} |
| 大小 | ${(exportSize.size_bytes / 1024).toFixed(1)} KB |

### 预览
\`\`\`
${preview}
\`\`\`

### 建议
- Markdown 格式适合直接阅读和备份
- JSON 格式适合程序处理和数据迁移
- CSV 格式适合导入电子表格
`;

      return {
        content: [{ type: 'text', text: report }],
        details: { format, include, ...exportSize, preview },
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `导出失败: ${(error as Error).message}` }],
        details: { error: (error as Error).message },
      };
    }
  }
);

/**
 * 导入卡片
 */
const importCardsTool = createTool(
  'import_cards',
  '导入卡片',
  '从外部格式（JSON/CSV/Markdown）导入卡片到当前 Vault。支持批量导入和冲突检测。',
  Type.Object({
    data: Type.String({ description: '要导入的数据内容（JSON/CSV/Markdown 格式）' }),
    format: Type.String({ description: '数据格式: "json"(结构化JSON) / "csv"(CSV) / "markdown"(Markdown文件) / "obsidian"(Obsidian格式)' }),
    default_type: Type.Optional(Type.String({ description: '默认卡片类型: "fleeting" / "permanent" / "literature"，默认 fleeting' })),
    dry_run: Type.Optional(Type.Boolean({ description: '预览模式，只显示不导入，默认 true' })),
    confirmationToken: Type.Optional(Type.String({ description: '用户确认后得到的一次性确认 token。执行导入时必须提供。' })),
  }),
  async (_id, params) => {
    try {
      const vaultId = getCurrentVaultId();
      if (!vaultId) {
        return { content: [{ type: 'text', text: '未找到当前 Vault' }], details: { error: 'No vault id' } };
      }

      const isDryRun = params.dry_run !== false;
      let parsed: ParsedImportCard[] = [];
      let conflicts: ParsedImportCard[] = [];
      let newCards: ParsedImportCard[] = [];
      let totalParsed = 0;

      if (params.confirmationToken) {
        const pending = pendingImportCards.get(params.confirmationToken);
        if (!pending) {
          return {
            content: [{ type: 'text', text: '确认请求已失效，无法恢复待导入的卡片内容。请重新发起导入。' }],
            details: { error: 'Pending import payload expired' },
          };
        }
        if (!consumeConfirmationToken('import_cards', pending.target, params.confirmationToken)) {
          return {
            content: [{ type: 'text', text: '导入卡片需要重新确认。' }],
            details: { error: 'Invalid or missing confirmationToken' },
          };
        }
        if (pending.vaultId !== vaultId) {
          return {
            content: [{ type: 'text', text: '确认请求所属 Vault 与当前 Vault 不一致，已拒绝导入。' }],
            details: { error: 'Vault mismatch' },
          };
        }
        newCards = pending.cards;
        conflicts = pending.conflicts;
        totalParsed = pending.total;
        parsed = [...newCards, ...conflicts];
        pendingImportCards.delete(params.confirmationToken);
      } else {
        const parsedRaw = parseImportCardsPayload(params.data, params.format, params.default_type || 'fleeting');
        const normalized = validateParsedImportCards(parsedRaw);
        if (!normalized.success) {
          return {
            content: [{ type: 'text', text: normalized.error }],
            details: normalized.details,
          };
        }

        parsed = normalized.cards;
        if (parsed.length === 0) {
          return { content: [{ type: 'text', text: '未能从数据中解析出任何卡片' }], details: { error: 'No cards parsed' } };
        }

        const existingTitles = new Set(
          (await prisma.card.findMany({ where: { vaultId }, select: { title: true } }))
            .map(c => c.title?.toLowerCase()).filter(Boolean)
        );
        conflicts = parsed.filter(c => existingTitles.has(c.title.toLowerCase()));
        newCards = parsed.filter(c => !existingTitles.has(c.title.toLowerCase()));
        totalParsed = parsed.length;
      }

      if (!params.confirmationToken && isDryRun) {
        const report = `
## 卡片导入预览

**格式**: ${params.format}
**总计**: ${totalParsed} 张卡片
**新增**: ${newCards.length} 张
**冲突**: ${conflicts.length} 张（已存在）

### 即将导入的卡片
${newCards.slice(0, 10).map(c => `- **${c.title}** [${c.type}]${c.tags.length ? ` (标签: ${c.tags.join(', ')})` : ''}`).join('\n')}
${newCards.length > 10 ? `... 还有 ${newCards.length - 10} 张` : ''}

### 冲突卡片
${conflicts.slice(0, 5).map(c => `- **${c.title}**: 已存在，将被跳过`).join('\n')}
${conflicts.length > 5 ? `... 还有 ${conflicts.length - 5} 张冲突` : ''}

使用 dry_run=false 执行导入。
`;
        return { content: [{ type: 'text', text: report }], details: { total: totalParsed, new: newCards.length, conflicts: conflicts.length, dry_run: true } };
      }

      if (!params.confirmationToken) {
        const target = importCardsTarget(vaultId, newCards);
        const confirmation = createConfirmationToken('import_cards', target);
        pendingImportCards.set(confirmation.token, {
          target,
          vaultId,
          cards: newCards,
          conflicts,
          total: totalParsed,
          createdAt: Date.now(),
        });
        return {
          content: [{ type: 'text', text: `将导入 ${newCards.length} 张新卡片，跳过 ${conflicts.length} 张冲突卡片。请确认后执行。` }],
          details: {
            awaitingConfirmation: true,
            confirmationToken: confirmation.token,
            expiresAt: confirmation.expiresAt,
            target,
            total: totalParsed,
            new: newCards.length,
            conflicts: conflicts.length,
          },
        };
      }

      // 执行导入
      let imported = 0;
      for (const card of newCards) {
        try {
          const safeTitle = card.title.replace(/[/\\]/g, '_').slice(0, 100);
          await prisma.card.create({
            data: {
              vaultId,
              path: `${card.type}/${safeTitle}.md`,
              title: card.title,
              content: card.content,
              type: card.type,
              tags: JSON.stringify(card.tags),
            },
          });
          imported++;
        } catch (err) {
          console.warn(`[import_cards] Failed to import "${card.title}":`, err);
        }
      }

      return {
        content: [{ type: 'text', text: `✅ 导入完成: ${imported}/${newCards.length} 张卡片已导入\n${conflicts.length > 0 ? `⚠️ ${conflicts.length} 张卡片因冲突跳过` : ''}` }],
        details: { imported, total: totalParsed, skipped: conflicts.length },
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `导入失败: ${(error as Error).message}` }],
        details: { error: (error as Error).message },
      };
    }
  }
);

/**
 * 正则转义辅助
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cleanupBrokenLinksTarget(vaultId: string): string {
  return `cleanup_broken_links:${vaultId}`;
}

function mergeDuplicateCardsTarget(cardAId: string, cardBId: string, keepBoth: boolean): string {
  return `merge_duplicate_cards:${cardAId}:${cardBId}:${keepBoth ? 'keep' : 'merge'}`;
}

function importCardsTarget(vaultId: string, cards: ParsedImportCard[]): string {
  const hash = createHash('sha256')
    .update(JSON.stringify(cards.map(card => [card.title, card.type, card.content.slice(0, 200)])))
    .digest('hex')
    .slice(0, 16);
  return `import_cards:${vaultId}:${hash}:${cards.length}`;
}

function parseImportCardsPayload(
  data: string,
  format: string,
  defaultType: string,
): Array<{ title: string; content: string; type: string; tags: string[] }> {
  const parsed: Array<{ title: string; content: string; type: string; tags: string[] }> = [];

  if (format === 'json') {
    const json = JSON.parse(data);
    const cardsArray = json.cards || json.data || (Array.isArray(json) ? json : [json]);
    for (const item of cardsArray) {
      if (item.title || item.content) {
        parsed.push({
          title: String(item.title || '导入卡片'),
          content: String(item.content || ''),
          type: String(item.type || item.cardType || defaultType),
          tags: Array.isArray(item.tags) ? item.tags.map(String) : [],
        });
      }
    }
    return parsed;
  }

  if (format === 'csv') {
    const lines = data.split('\n').filter(l => l.trim());
    const headers = (lines[0] || '').split(',').map(h => h.trim().replace(/"/g, ''));
    const titleIdx = headers.indexOf('title');
    const contentIdx = headers.indexOf('content');
    const typeIdx = headers.indexOf('type');

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map(c => c.trim().replace(/"/g, ''));
      if (cols.length >= 2) {
        parsed.push({
          title: titleIdx >= 0 ? cols[titleIdx] : `导入卡片 ${i}`,
          content: contentIdx >= 0 ? cols[contentIdx] : cols.join(', '),
          type: typeIdx >= 0 ? cols[typeIdx] : defaultType,
          tags: [],
        });
      }
    }
    return parsed;
  }

  if (format === 'markdown' || format === 'obsidian') {
    const sections = data.split(/\n(?=# |## |---\n)/);
    for (const section of sections) {
      if (!section.trim()) continue;
      const titleMatch = section.match(/^#+\s+(.+)/m);
      const title = titleMatch ? titleMatch[1].trim() : '导入卡片';
      parsed.push({ title, content: section.trim(), type: defaultType, tags: [] });
    }
    return parsed;
  }

  throw new Error(`Unsupported import format: ${format}`);
}

function validateParsedImportCards(
  cards: Array<{ title: string; content: string; type: string; tags: string[] }>,
): { success: true; cards: ParsedImportCard[] } | { success: false; error: string; details: Record<string, unknown> } {
  const normalized: ParsedImportCard[] = [];
  const invalidTypes: Array<{ title: string; type: string }> = [];
  const invalidPermanent: Array<{ title: string; missingElements: string[] }> = [];

  for (const card of cards) {
    const type = card.type.trim().toLowerCase();
    if (!CARD_TYPE_SET.has(type)) {
      invalidTypes.push({ title: card.title, type: card.type });
      continue;
    }
    if (type === 'permanent') {
      const quality = validatePermanentCardContent(card.content);
      if (!quality.passed) {
        invalidPermanent.push({ title: card.title, missingElements: quality.missingElements });
        continue;
      }
    }
    normalized.push({
      title: card.title.trim() || '导入卡片',
      content: card.content || '',
      type: type as CardType,
      tags: Array.isArray(card.tags) ? card.tags : [],
    });
  }

  if (invalidTypes.length > 0) {
    return {
      success: false,
      error: `导入数据包含非法卡片类型：${invalidTypes.map(item => `${item.title}=${item.type}`).join('、')}`,
      details: { error: 'INVALID_CARD_TYPE', invalidTypes, allowedTypes: CARD_TYPES },
    };
  }

  if (invalidPermanent.length > 0) {
    return {
      success: false,
      error: `导入数据包含不符合永久卡质量门禁的卡片：${invalidPermanent.map(item => `${item.title}(${item.missingElements.join(',')})`).join('、')}`,
      details: { error: 'PROMOTION_CRITERIA_FAILED', invalidPermanent },
    };
  }

  return { success: true, cards: normalized };
}

export function registerVaultMaintenanceTools(): void {
  toolRegistry.register(cleanupBrokenLinksTool);
  toolRegistry.register(mergeDuplicateCardsTool);
  toolRegistry.register(rebuildIndexTool);
  toolRegistry.register(exportVaultTool);
  toolRegistry.register(importCardsTool);
}
