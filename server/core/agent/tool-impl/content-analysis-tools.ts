/**
 * AXIOM 内置工具 - 内容分析与概念提取
 *
 * 这些工具用于从各种内容格式（文本、markdown、代码等）中自动提取关键概念、
 * 生成摘要、识别前置条件等，辅助知识图谱的构建。
 */

import { Type } from '@mariozechner/pi-ai';
import { createTool, toolRegistry } from "../tools";
import { aiManager } from '../../ai/AIManager';
import { AXIOM_KNOWLEDGE_STANDARD } from '../../ai/prompt-standards';
import { AGENT_TOOL_PROMPTS } from '../../ai/prompts';

/**
 * 从文本中提取关键概念
 */
const extractConceptsTool = createTool(
  'extract_concepts',
  '提取关键概念（两步法 Step 1）',
  '从内容中提取关键概念、实体及其与现有知识图谱的关联。这是知识提取流程的第一步——先用此工具分析内容，再创建或打磨 fleeting 灵感草稿；只有用户确认且内容满足质量门槛后才创建 permanent 永久知识卡。'
  + '【重要】调用此工具前，请先用 search_cards 查询知识库中是否已有相关概念，以便在分析结果中标注"已存在"或"新概念"。',
  Type.Object({
    content: Type.String({ description: '要分析的内容' }),
    depth: Type.Optional(Type.String({ description: '提取深度: "shallow"(表层概念) / "deep"(深层概念) / "all"(全部，默认)' })),
    limit: Type.Optional(Type.Number({ description: '返回概念数量限制，默认 20' })),
    context_domain: Type.Optional(Type.String({ description: '领域提示，帮助 AI 更准确识别（如 "计算机科学", "生物学"）' })),
  }),
  async (_id, params) => {
    try {
      const prompt = `你是知识提取专家。分析下面的内容，输出结构化分析结果。

${AXIOM_KNOWLEDGE_STANDARD}

${params.context_domain ? `领域：${params.context_domain}` : ''}
深度：${params.depth || 'all'}

## 分析框架

按以下 6 个维度分析：

1. **关键实体** — 人物、组织、产品、工具、数据集。标注每个实体的角色（核心/边缘）。
2. **关键概念** — 理论、方法、技术、现象。给出简洁定义并说明其重要性。
3. **主要论点/发现** — 核心主张或结果是什么？证据支持度如何？
4. **概念间关系** — 概念之间的依赖、前置、对比或包含关系。
5. **矛盾与张力** — 内容中是否有内部矛盾？与常识或其他来源有冲突吗？
6. **建议行动** — 哪些概念应该先创建或打磨灵感草稿？哪些已有足够定义、例子、关联和应用，才适合沉淀为永久知识？

## 输出格式

以严格的 JSON 格式返回（不要任何其他文字，不要输出 \`\`\`json 包裹）：
{
  "concepts": [
    {
      "name": "概念名",
      "definition": "简洁定义（1-2句话）",
      "importance": 5,
      "category": "概念类型（理论/方法/工具/现象/人物）",
      "status": "new 或 existing"
    }
  ],
  "relationships": [
    {"from": "概念A", "to": "概念B", "type": "prerequisite/related/contrast/extends", "reason": "关联原因"}
  ],
  "key_points": ["核心观点1", "核心观点2"],
  "contradictions": ["矛盾点或不明之处"],
  "suggestions": ["建议创建或打磨的灵感草稿", "建议建立的链接"],
  "summary": "2-3句话的内容概述"
}

## ⚠️ 强制输出语言：中文
所有内容（概念名、定义、描述）必须用中文输出。专有名词保留原文。`;

      const response = await aiManager.callAPI(
        AGENT_TOOL_PROMPTS.contentConceptExtraction.system,
        [{ role: 'user', content: `${prompt}\n\n内容：\n${params.content.slice(0, 4000)}` }]
      );

      // 解析 JSON 响应
      const cleaned = response.replace(/```(?:json)?\s*/g, '').replace(/\s*```/g, '');
      const match = cleaned.match(/\{[\s\S]*\}/);

      if (!match) {
        return {
          content: [{ type: 'text', text: '概念提取失败：无法解析 AI 响应' }],
          details: { error: 'JSON parse failed', contentLength: params.content.length },
        };
      }

      const parsed = JSON.parse(match[0]);
      const concepts = (parsed.concepts || [])
        .sort((a: any, b: any) => (b.importance || 0) - (a.importance || 0))
        .slice(0, params.limit || 20);

      const conceptsMd = concepts
        .map((c: any) => `- **${c.name}** (重要度: ${c.importance}/5, ${c.status || 'new'})\n  ${c.definition}`)
        .join('\n\n');

      const relationships = (parsed.relationships || []);
      const relationshipsMd = relationships.length > 0
        ? `\n\n### 概念间关系\n${relationships.map((r: any) => `- ${r.from} → ${r.to} [${r.type}]：${r.reason}`).join('\n')}`
        : '';

      const contradictions = (parsed.contradictions || []);
      const contradictionsMd = contradictions.length > 0
        ? `\n\n### ⚠️ 注意\n${contradictions.map((c: string) => `- ${c}`).join('\n')}`
        : '';

      const suggestions = (parsed.suggestions || []);
      const suggestionsMd = suggestions.length > 0
        ? `\n\n### 建议下一步\n${suggestions.map((s: string) => `- ${s}`).join('\n')}`
        : '';

      const summary = `${parsed.summary ? `> ${parsed.summary}\n\n` : ''}## 提取的 ${concepts.length} 个关键概念\n\n${conceptsMd}${relationshipsMd}${contradictionsMd}${suggestionsMd}`;

      return {
        content: [{ type: 'text', text: summary }],
        details: {
          count: concepts.length,
          concepts,
          relationships,
          contradictions,
          suggestions,
          key_points: parsed.key_points,
          summary: parsed.summary,
        },
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `概念提取失败: ${(error as Error).message}` }],
        details: { error: (error as Error).message },
      };
    }
  }
);

/**
 * 为长文档生成目录树
 */
const generateOutlineTool = createTool(
  'generate_outline',
  '生成文档大纲',
  '为长文档自动生成分层次的大纲，帮助快速理解内容结构。可用于 extract_concepts 的补充——先看结构再决定深度分析的焦点。',
  Type.Object({
    content: Type.String({ description: '要分析的文档内容' }),
    max_depth: Type.Optional(Type.Number({ description: '大纲最大深度，默认 3' })),
    format: Type.Optional(Type.String({ description: '输出格式: "markdown"(默认) / "tree"(树形) / "json"(JSON)' })),
  }),
  async (_id, params) => {
    try {
      const prompt = `你是文档结构分析专家。分析文档结构，生成分层次的大纲。

${AXIOM_KNOWLEDGE_STANDARD}

要求：
1. 最多 ${params.max_depth || 3} 层级
2. 每个标题配上简短描述（10-20字）
3. 以严格的 JSON 格式返回（不要 \`\`\`json 包裹，不要任何其他文字）：
{"outline": [{"title": "...", "level": 1, "description": "...", "children": [...]}]}

## ⚠️ 强制输出语言：中文
所有标题和描述必须用中文输出。专有名词保留原文。

文档内容：
${params.content.slice(0, 4000)}`;

      const response = await aiManager.callAPI(
        AGENT_TOOL_PROMPTS.contentOutline.system,
        [{ role: 'user', content: prompt }]
      );

      const cleaned = response.replace(/```(?:json)?\s*/g, '').replace(/\s*```/g, '');
      const match = cleaned.match(/\{[\s\S]*\}/);

      if (!match) {
        return {
          content: [{ type: 'text', text: '大纲生成失败：无法解析 AI 响应' }],
          details: { error: 'JSON parse failed' },
        };
      }

      const parsed = JSON.parse(match[0]);
      const outline = parsed.outline || [];

      // 格式化输出
      let formatted = '';
      if (params.format === 'tree') {
        formatted = renderOutlineTree(outline);
      } else if (params.format === 'json') {
        formatted = `\`\`\`json\n${JSON.stringify(outline, null, 2)}\n\`\`\``;
      } else {
        formatted = renderOutlineMarkdown(outline);
      }

      return {
        content: [{ type: 'text', text: formatted }],
        details: { outline, format: params.format || 'markdown' },
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `大纲生成失败: ${(error as Error).message}` }],
        details: { error: (error as Error).message },
      };
    }
  }
);

/**
 * 辅助函数：渲染大纲为 Markdown
 */
function renderOutlineMarkdown(outline: any[]): string {
  const lines: string[] = [];
  const renderItem = (item: any, indent: number) => {
    const prefix = '#'.repeat(item.level || 1) + ' ';
    lines.push(prefix + item.title);
    if (item.description) {
      lines.push(`> ${item.description}\n`);
    }
    if (item.children && item.children.length > 0) {
      item.children.forEach((child: any) => renderItem(child, indent + 1));
    }
  };
  outline.forEach(item => renderItem(item, 0));
  return lines.join('\n');
}

/**
 * 辅助函数：渲染大纲为树形
 */
function renderOutlineTree(outline: any[]): string {
  const lines: string[] = [];
  const renderItem = (item: any, prefix: string = '') => {
    lines.push(prefix + '├─ ' + item.title);
    if (item.description) {
      lines.push(prefix + '│  ' + item.description);
    }
    if (item.children && item.children.length > 0) {
      item.children.forEach((child: any, idx: number) => {
        const isLast = idx === item.children.length - 1;
        const newPrefix = prefix + (isLast ? '   ' : '│  ');
        renderItem(child, newPrefix);
      });
    }
  };
  outline.forEach(item => renderItem(item));
  return lines.join('\n');
}

/**
 * 识别前置要求和依赖关系
 */
const identifyPrerequisitesTool = createTool(
  'identify_prerequisites',
  '识别前置要求',
  '分析某个概念的学习前置条件和依赖关系。在创建学习路径前使用，帮助确定学习顺序。',
  Type.Object({
    content: Type.String({ description: '要分析的内容' }),
    concept: Type.String({ description: '主要概念名称（可选，用于聚焦分析）' }),
  }),
  async (_id, params) => {
    try {
      const prompt = `你是教育课程设计专家。分析下面内容${params.concept ? `中关于 "${params.concept}"` : ''}的学习前置要求。

${AXIOM_KNOWLEDGE_STANDARD}

分析维度：
1. 核心前置概念（必须先理解才能学这个）
2. 辅助背景知识（有帮助但不是必须）
3. 推荐学习顺序（从入门到精通）
4. 难度评估和预估学习时间

以严格的 JSON 格式返回（不要 \`\`\`json 包裹，不要任何其他文字）：
{
  "concept": "主要概念",
  "prerequisites": [
    {"concept": "前置概念", "importance": "critical/important/helpful", "reason": "为什么需要"}
  ],
  "related": ["相关概念1", "相关概念2"],
  "learning_sequence": ["应该先学...", "再学...", "最后学..."],
  "difficulty": 1-5,
  "estimated_hours": 数字
}

## ⚠️ 强制输出语言：中文
所有概念名和内容必须用中文输出。专有名词保留原文。

内容：
${params.content.slice(0, 3000)}`;

      const response = await aiManager.callAPI(
        AGENT_TOOL_PROMPTS.prerequisites.system,
        [{ role: 'user', content: prompt }]
      );

      const cleaned = response.replace(/```(?:json)?\s*/g, '').replace(/\s*```/g, '');
      const match = cleaned.match(/\{[\s\S]*\}/);

      if (!match) {
        return {
          content: [{ type: 'text', text: '前置分析失败' }],
          details: { error: 'JSON parse failed' },
        };
      }

      const parsed = JSON.parse(match[0]);

      const summary = `
## 学习 "${parsed.concept || '此内容'}" 的前置要求

### 关键前置条件
${(parsed.prerequisites || [])
  .filter((p: any) => p.importance === 'critical')
  .map((p: any) => `- **${p.concept}** (原因: ${p.reason})`)
  .join('\n')}

### 推荐学习顺序
${(parsed.learning_sequence || [])
  .map((step: string, idx: number) => `${idx + 1}. ${step}`)
  .join('\n')}

### 学习指标
- 难度等级: ${parsed.difficulty || '-'}/5
- 估计学习时间: ${parsed.estimated_hours || '-'} 小时
`;

      return {
        content: [{ type: 'text', text: summary }],
        details: {
          concept: parsed.concept,
          prerequisites: parsed.prerequisites,
          related: parsed.related,
          learning_sequence: parsed.learning_sequence,
          difficulty: parsed.difficulty,
          estimated_hours: parsed.estimated_hours,
        },
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `前置分析失败: ${(error as Error).message}` }],
        details: { error: (error as Error).message },
      };
    }
  }
);

/**
 * 生成文本摘要
 */
const summarizeContentTool = createTool(
  'summarize_content',
  '生成内容摘要',
  '为长文本生成不同长度和风格的摘要。在阅读长文档前使用，帮助快速把握要点。',
  Type.Object({
    content: Type.String({ description: '要总结的内容' }),
    length: Type.Optional(Type.String({ description: '摘要长度: "bullet"(要点) / "short"(100字) / "medium"(300字) / "long"(500字)，默认 short' })),
    style: Type.Optional(Type.String({ description: '摘要风格: "academic"(学术) / "casual"(通俗) / "technical"(技术)，默认 academic' })),
  }),
  async (_id, params) => {
    try {
      const lengthMap = {
        bullet: '3-5 个要点，用 • 符号列出',
        short: '100 字以内',
        medium: '300 字左右',
        long: '500 字左右',
      };

      const prompt = `你是文本总结专家。用${lengthMap[params.length as keyof typeof lengthMap] || lengthMap.short}的${params.style || 'academic'}风格总结下面的内容。

${AXIOM_KNOWLEDGE_STANDARD}

要求：
- ${params.length === 'bullet' ? '用 • 符号列出要点' : '简洁准确，抓住核心信息'}
- 不要输出分析过程或 preamble，直接输出摘要
- 内部推理即可

## ⚠️ 强制输出语言：中文

内容：
${params.content.slice(0, 3000)}`;

      const response = await aiManager.callAPI(
        AGENT_TOOL_PROMPTS.textSummary.system,
        [{ role: 'user', content: prompt }]
      );

      return {
        content: [{ type: 'text', text: `## 内容摘要 (${params.length || 'short'})\n\n${response}` }],
        details: { length: params.length || 'short', style: params.style || 'academic' },
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `摘要生成失败: ${(error as Error).message}` }],
        details: { error: (error as Error).message },
      };
    }
  }
);

/**
 * Extract keywords and phrases from text
 */
const extractKeywordsTool = createTool(
  'extract_keywords',
  '提取关键词',
  '从文本中提取关键词和短语，按重要度排序。可用于搜索前优化查询词，或快速了解文档主题。',
  Type.Object({
    content: Type.String({ description: '要分析的文本内容' }),
    max_keywords: Type.Optional(Type.Number({ description: '返回关键词数量上限，默认 15' })),
    language: Type.Optional(Type.String({ description: '语言: "auto"(自动检测) / "zh"(中文) / "en"(英文)，默认 auto' })),
  }),
  async (_id, params) => {
    try {
      const limit = params.max_keywords || 15;
      const lang = params.language || 'auto';

      const prompt = `你是关键词提取专家。从以下内容中提取最多 ${limit} 个关键词或短语，按重要度排序。

${AXIOM_KNOWLEDGE_STANDARD}

语言: ${lang === 'auto' ? '自动检测' : lang === 'zh' ? '中文' : '英文'}

以严格的 JSON 格式返回（不要 \`\`\`json 包裹，不要任何其他文字）：
{
  "keywords": [
    {"word": "关键词", "frequency": 5, "importance": 0.9}
  ]
}

## ⚠️ 强制输出语言：中文
关键词用中文输出（如果内容是中文）。英文内容保留英文关键词。专有名词保留原文。

内容：
${params.content.slice(0, 4000)}`;

      const response = await aiManager.callAPI(
        AGENT_TOOL_PROMPTS.keywordExtraction.system,
        [{ role: 'user', content: prompt }]
      );

      const cleaned = response.replace(/```(?:json)?\s*/g, '').replace(/\s*```/g, '');
      const match = cleaned.match(/\{[\s\S]*\}/);

      if (!match) {
        return {
          content: [{ type: 'text', text: '关键词提取失败：无法解析 AI 响应' }],
          details: { error: 'JSON parse failed' },
        };
      }

      const parsed = JSON.parse(match[0]);
      const keywords = (parsed.keywords || []).slice(0, limit);

      if (keywords.length === 0) {
        return {
          content: [{ type: 'text', text: '未提取到关键词' }],
          details: { keywords: [] },
        };
      }

      const sorted = keywords.sort((a: any, b: any) => (b.importance || 0) - (a.importance || 0));
      const summary = sorted.map((k: any, i: number) =>
        `${i + 1}. **${k.word}** (频率: ${k.frequency || '-'}，重要度: ${((k.importance || 0) * 100).toFixed(0)}%)`
      ).join('\n');

      return {
        content: [{ type: 'text', text: `提取到 ${sorted.length} 个关键词：\n\n${summary}` }],
        details: { keywords: sorted, count: sorted.length },
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `关键词提取失败: ${(error as Error).message}` }],
        details: { error: (error as Error).message },
      };
    }
  }
);

/**
 * Extract and annotate code snippets from content
 */
const extractCodeTool = createTool(
  'extract_code',
  '提取代码片段',
  '从文本中提取代码块（\`\`\` \`\`\`），附带语言标注和行数信息。',
  Type.Object({
    content: Type.String({ description: '包含代码的内容' }),
    language: Type.Optional(Type.String({ description: '过滤指定语言的代码块（可选，如 "python", "typescript"）' })),
    include_line_numbers: Type.Optional(Type.Boolean({ description: '是否包含行号，默认 false' })),
  }),
  async (_id, params) => {
    try {
      // Match fenced code blocks: ```language ... ```
      const blockRegex = /```(\w*)\s*\n([\s\S]*?)```/g;
      const blocks: Array<{ language: string; code: string; line_count: number; lines?: string[] }> = [];
      let match;

      while ((match = blockRegex.exec(params.content)) !== null) {
        const lang = match[1] || 'unknown';
        const code = match[2];
        const lines = code.split('\n');
        // Remove trailing empty lines
        while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
          lines.pop();
        }

        blocks.push({
          language: lang,
          code: params.include_line_numbers ? lines.map((l, i) => `${i + 1}  ${l}`).join('\n') : code,
          line_count: lines.length,
          ...(params.include_line_numbers ? { lines } : {}),
        });
      }

      if (blocks.length === 0) {
        return {
          content: [{ type: 'text', text: '未在内容中找到代码块' }],
          details: { blocks: [] },
        };
      }

      // Filter by language if specified
      const filtered = params.language
        ? blocks.filter(b => b.language.toLowerCase() === params.language!.toLowerCase())
        : blocks;

      if (filtered.length === 0) {
        return {
          content: [{ type: 'text', text: `未找到 ${params.language} 语言的代码块` }],
          details: { blocks: [], language_filter: params.language },
        };
      }

      const summary = filtered.map((b, i) =>
        `### 代码块 ${i + 1}（${b.language || 'unknown'}，${b.line_count} 行）\n\`\`\`${b.language}\n${b.code}\n\`\`\``
      ).join('\n\n');

      return {
        content: [{ type: 'text', text: `找到 ${filtered.length} 个代码块：\n\n${summary}` }],
        details: {
          total_blocks: blocks.length,
          blocks: filtered.map(b => ({ language: b.language, line_count: b.line_count })),
        },
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `代码提取失败: ${(error as Error).message}` }],
        details: { error: (error as Error).message },
      };
    }
  }
);

/**
 * Parse Markdown document structure
 */
const parseMarkdownTool = createTool(
  'parse_markdown',
  '解析 Markdown 结构',
  '解析 Markdown 文档的结构，提取标题层级、链接、代码块和 frontmatter 元数据。',
  Type.Object({
    content: Type.String({ description: 'Markdown 内容' }),
    include_toc: Type.Optional(Type.Boolean({ description: '是否生成目录，默认 true' })),
    include_metadata: Type.Optional(Type.Boolean({ description: '是否解析 frontmatter 元数据，默认 false' })),
  }),
  async (_id, params) => {
    try {
      const result: any = {
        headings: [],
        links: [],
        code_blocks: [],
        word_count: 0,
        char_count: 0,
        estimated_read_time_minutes: 0,
      };

      // Word and character count
      const textOnly = params.content.replace(/```[\s\S]*?```/g, '').replace(/\[.*?\]\(.*?\)/g, '');
      result.word_count = textOnly.split(/\s+/).filter(Boolean).length;
      result.char_count = textOnly.length;
      result.estimated_read_time_minutes = Math.max(1, Math.round(result.word_count / 200));

      // Frontmatter
      if (params.include_metadata) {
        const fmMatch = params.content.match(/^---\n([\s\S]*?)\n---/);
        if (fmMatch) {
          const fm: Record<string, any> = {};
          fmMatch[1].split('\n').forEach(line => {
            const sep = line.indexOf(':');
            if (sep > 0) {
              const key = line.slice(0, sep).trim();
              let value: any = line.slice(sep + 1).trim();
              if (value.startsWith('[') || value.startsWith('{')) {
                try { value = JSON.parse(value); } catch {}
              }
              fm[key] = value;
            }
          });
          result.frontmatter = fm;
        }
      }

      // Headings
      const headingRegex = /^(#{1,6})\s+(.+)$/gm;
      let hMatch;
      while ((hMatch = headingRegex.exec(params.content)) !== null) {
        result.headings.push({
          level: hMatch[1].length,
          text: hMatch[2].trim(),
          anchor: hMatch[2].trim().toLowerCase().replace(/[^\w\u4e00-\u9fff]+/g, '-').replace(/(^-|-$)/g, ''),
        });
      }

      // Links: markdown [text](url)
      const mdLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
      let lMatch;
      while ((lMatch = mdLinkRegex.exec(params.content)) !== null) {
        result.links.push({
          type: 'markdown',
          text: lMatch[1],
          url: lMatch[2],
        });
      }

      // Links: wiki [[link]]
      const wikiLinkRegex = /\[\[([^\]]+)\]\]/g;
      while ((lMatch = wikiLinkRegex.exec(params.content)) !== null) {
        result.links.push({
          type: 'wiki',
          target: lMatch[1],
        });
      }

      // Code blocks
      const codeRegex = /```(\w*)\s*\n([\s\S]*?)```/g;
      while ((hMatch = codeRegex.exec(params.content)) !== null) {
        result.code_blocks.push({
          language: hMatch[1] || 'unknown',
          line_count: hMatch[2].split('\n').filter(Boolean).length,
        });
      }

      // Build TOC if requested
      let output = `## Markdown 文档分析\n\n`;
      output += `**基本信息**：${result.word_count} 词，${result.char_count} 字符，阅读约 ${result.estimated_read_time_minutes} 分钟\n\n`;

      if (params.include_toc && result.headings.length > 0) {
        output += `### 目录\n`;
        result.headings.forEach((h: any) => {
          const indent = '  '.repeat(h.level - 1);
          output += `${indent}- ${h.text}\n`;
        });
        output += '\n';
      }

      if (result.frontmatter) {
        output += `### Frontmatter 元数据\n\`\`\`json\n${JSON.stringify(result.frontmatter, null, 2)}\n\`\`\`\n\n`;
      }

      output += `### 统计\n`;
      output += `- **标题数**: ${result.headings.length}（H1: ${result.headings.filter((h: any) => h.level === 1).length}，H2: ${result.headings.filter((h: any) => h.level === 2).length}，H3+: ${result.headings.filter((h: any) => h.level >= 3).length}）\n`;
      output += `- **链接数**: ${result.links.length}（Markdown: ${result.links.filter((l: any) => l.type === 'markdown').length}，Wiki: ${result.links.filter((l: any) => l.type === 'wiki').length}）\n`;
      output += `- **代码块数**: ${result.code_blocks.length}\n`;

      return {
        content: [{ type: 'text', text: output }],
        details: result,
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Markdown 解析失败: ${(error as Error).message}` }],
        details: { error: (error as Error).message },
      };
    }
  }
);

export function registerContentAnalysisTools(): void {
  toolRegistry.register(extractConceptsTool);
  toolRegistry.register(generateOutlineTool);
  toolRegistry.register(identifyPrerequisitesTool);
  toolRegistry.register(summarizeContentTool);
  toolRegistry.register(extractKeywordsTool);
  toolRegistry.register(extractCodeTool);
  toolRegistry.register(parseMarkdownTool);
}
