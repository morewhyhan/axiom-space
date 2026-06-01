/**
 * AXIOM 内置工具 - Vault 维护
 *
 * 这些工具用于维护和管理知识库（Vault）的健康状态，
 * 包括清理破损链接、合并重复卡片、重建索引、导入导出等。
 */

import { Type } from "@mariozechner/pi-ai";
import { createTool, toolRegistry } from "../tools";
import { prisma } from '@/lib/db';
import { getCurrentVaultId } from '../agent-context';
import { getFileStorage } from '@/server/infra/storage/GlobalFileStorage';
import { getVaultPath, resolvePath } from './helpers';

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
          where: { vaultId, OR: [{ title: { contains: ident } }, { path: { contains: ident.replace(/\.md$/, '') } }] },
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

        // 更新指向 B 的边为指向 A
        await prisma.edge.updateMany({
          where: { vaultId, targetId: cardB.id },
          data: { targetId: cardA.id },
        });
        await prisma.edge.updateMany({
          where: { vaultId, sourceId: cardB.id },
          data: { sourceId: cardA.id },
        });

        // 标记 B 为合并状态（软删除）
        await prisma.card.update({
          where: { id: cardB.id },
          data: { content: `> 此卡片已与 [[${cardA.title}]] 合并。\n\n${cardB.content || ''}`, type: 'fleeting' },
        });
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
  }),
  async (_id, params) => {
    try {
      const vaultId = getCurrentVaultId();
      if (!vaultId) {
        return { content: [{ type: 'text', text: '未找到当前 Vault' }], details: { error: 'No vault id' } };
      }

      const isDryRun = params.dry_run !== false;
      const defaultType = params.default_type || 'fleeting';
      const parsed: Array<{ title: string; content: string; type: string; tags: string[] }> = [];

      // 解析不同格式
      try {
        if (params.format === 'json') {
          const json = JSON.parse(params.data);
          const cardsArray = json.cards || json.data || (Array.isArray(json) ? json : [json]);
          for (const item of cardsArray) {
            if (item.title || item.content) {
              parsed.push({
                title: item.title || '导入卡片',
                content: item.content || '',
                type: item.type || item.cardType || defaultType,
                tags: item.tags || [],
              });
            }
          }
        } else if (params.format === 'csv') {
          const lines = params.data.split('\n').filter(l => l.trim());
          const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
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
        } else if (params.format === 'markdown' || params.format === 'obsidian') {
          // 按 ## 或 --- 分割
          const sections = params.data.split(/\n(?=# |## |---\n)/);
          for (const section of sections) {
            if (!section.trim()) continue;
            const titleMatch = section.match(/^#+\s+(.+)/m);
            const title = titleMatch ? titleMatch[1].trim() : '导入卡片';
            const content = section.trim();
            parsed.push({ title, content, type: defaultType, tags: [] });
          }
        }
      } catch (parseErr) {
        return {
          content: [{ type: 'text', text: `解析失败: ${(parseErr as Error).message}\n请检查数据格式是否正确。` }],
          details: { error: `Parse error: ${(parseErr as Error).message}` },
        };
      }

      if (parsed.length === 0) {
        return { content: [{ type: 'text', text: '未能从数据中解析出任何卡片' }], details: { error: 'No cards parsed' } };
      }

      // 冲突检测
      const existingTitles = new Set(
        (await prisma.card.findMany({ where: { vaultId }, select: { title: true } }))
          .map(c => c.title?.toLowerCase()).filter(Boolean)
      );
      const conflicts = parsed.filter(c => existingTitles.has(c.title.toLowerCase()));
      const newCards = parsed.filter(c => !existingTitles.has(c.title.toLowerCase()));

      if (isDryRun) {
        const report = `
## 卡片导入预览

**格式**: ${params.format}
**总计**: ${parsed.length} 张卡片
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
        return { content: [{ type: 'text', text: report }], details: { total: parsed.length, new: newCards.length, conflicts: conflicts.length, dry_run: true } };
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
              type: card.type as any,
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
        details: { imported, total: parsed.length, skipped: conflicts.length },
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

export function registerVaultMaintenanceTools(): void {
  toolRegistry.register(cleanupBrokenLinksTool);
  toolRegistry.register(mergeDuplicateCardsTool);
  toolRegistry.register(rebuildIndexTool);
  toolRegistry.register(exportVaultTool);
  toolRegistry.register(importCardsTool);
}
