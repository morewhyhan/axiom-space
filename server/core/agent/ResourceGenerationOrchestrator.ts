import {
  ResourceGenerationState,
  RESOURCE_TYPES,
  RESOURCE_FILE_MAP,
  type ResourceType,
} from './ResourceGenerationState';
import { hyperframesHTMLBuilder } from '../ai/hyperframes/generator';
import type { HyperFramesConfig } from '../ai/hyperframes/generator';
import { renderDocx, renderPdf, renderPptx } from '../ai/hyperframes/resource-renderer';
import { hyperframesRenderer } from '../ai/hyperframes/renderer';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export interface OrchestratorDeps {
  callLLM: (systemPrompt: string, userMessage: string) => Promise<string>;
  resourceExists: (type: ResourceType, literatureTitle: string) => Promise<boolean>;
  saveResource: (type: ResourceType, literatureTitle: string, content: string) => Promise<void>;
  saveResourceFile?: (literatureTitle: string, fileName: string, content: string) => Promise<void>;
  onProgress?: (event: {
    type: ResourceType;
    status: 'queued' | 'generating' | 'validating' | 'saving' | 'ready' | 'rendering' | 'completed' | 'failed';
    progress: number;
    message: string;
    path?: string;
    fileName?: string;
    error?: string;
  }) => void;
}

export interface GenerationResult {
  type: ResourceType;
  status: 'completed' | 'failed' | 'skipped';
  error?: string;
}

const RESOURCE_PROGRESS_START: Record<ResourceType, number> = {
  document: 4,
  mindmap: 4,
  quiz: 4,
  video: 4,
  svg: 4,
  diagram: 4,
  docx: 4,
  pdf: 4,
  ppt: 4,
};

// ── Per-type generation prompts ──────────────────────────────────

const RESOURCE_PROMPTS: Record<ResourceType, string> = {
  document: `你是 AXIOM 课程文档生成专家。请根据以下内容生成一份结构化的学习文档。

要求：
1. 总字数不少于 800 字，内容具体、有实质性信息
2. 严格包含以下章节：
   ## 概述
   ## 核心概念
   ## 进阶理解
   ## 总结
3. 格式：Markdown，代码用 \` 包裹，强调用 **粗体**
4. 输出纯文档内容，不要加前言`,

  mindmap: `你是 AXIOM 思维导图生成专家。请根据以下内容生成一张 Mermaid mindmap。

要求：
1. 使用 Mermaid mindmap 语法，根节点为 ((学习主题))
2. 至少 4 个一级分支，每分支至少 3 个叶子节点
3. 输出纯 Mermaid mindmap 代码块，以 \`\`\`mermaid 开头

格式参考：
\`\`\`mermaid
mindmap
  root((主题))
    分支A
      [子概念1]
      [子概念2]
\`\`\``,

  quiz: `你是 AXIOM 练习题库生成专家。请根据以下内容生成一套练习题。

要求：
1. 至少 5 道题，覆盖基础概念理解（3 题）+ 进阶应用分析（2 题）
2. 输出严格 JSON 数组格式，不要加任何其他文字
3. 每题包含：type, question, options, answer, explanation

输出格式：
[
  {
    "type": "choice",
    "question": "以下关于X的描述，正确的是？",
    "options": ["A. ...", "B. ...", "C. ...", "D. ..."],
    "answer": "B",
    "explanation": "选项B正确，因为..."
  }
]`,

  video: `你是 AXIOM 教学视频脚本生成专家。请根据以下学习主题，生成一个教学动画视频的场景配置。

要求：
1. 生成 4-6 个场景
2. 每个场景包含 2-5 个元素（text/code/shape）
3. 总时长控制在 30-90 秒

以严格 JSON 格式返回：
{
  "scenes": [{ "id": "intro", "duration": 6, "backgroundColor": "#f0f4f8", "elements": [...] }],
  "width": 1920, "height": 1080, "fps": 30
}`,

  svg: `你是 AXIOM SVG 图表生成专家。请根据以下内容生成一个 SVG 矢量图。

要求：
1. 输出纯 SVG XML（以 <svg 开头，</svg> 结尾），不要 Markdown 包裹
2. 尺寸 800×600，viewBox="0 0 800 600"
3. 使用中文字体 font-family="system-ui, sans-serif"
4. 配色：主色 #6366f1 / #a855f7 / #22d3ee / #22c55e
5. 输出纯 SVG，不要加解释文字`,

  diagram: `你是 AXIOM Mermaid 图表生成专家。请根据以下内容生成一个 Mermaid 图表。

要求：
1. 选择最合适的图表类型：flowchart / sequenceDiagram / classDiagram / pie / stateDiagram / gantt
2. 至少 6 个节点，结构完整
3. 输出纯 Mermaid 代码块，以 \`\`\`mermaid 开头

格式参考：
\`\`\`mermaid
flowchart TD
  A[概念] --> B[子概念]
\`\`\``,

  docx: `你是 AXIOM Word 文档生成专家。请根据以下内容生成一份结构化的学习文档。

要求：
1. 总字数不少于 800 字
2. 使用 HTML 格式（将直接转换为 Word 文档）
3. 用 h1/h2/h3 表示章节层级，p 表示段落，ul/li 表示列表
4. 代码用 pre/code 包裹，表格用 table
5. 输出纯 HTML body 内容（不要 <html>/<head>/<body> 包裹），不要加前言`,

  pdf: `你是 AXIOM PDF 文档生成专家。请根据以下内容生成一份适合打印的学习文档。

要求：
1. 总字数不少于 800 字
2. 使用 HTML 格式（将直接转换为 PDF）
3. 用 h1/h2/h3 表示章节层级，p 表示段落，ul/li 表示列表
4. 代码用 pre/code 包裹，表格用 table
5. 适合 A4 打印排版
6. 输出纯 HTML body 内容（不要 <html>/<head>/<body> 包裹），不要加前言`,

  ppt: `你是 AXIOM 演示文稿生成专家。请根据以下内容生成一份幻灯片内容。

要求：
1. 至少 8 页，包括封面和总结页
2. 使用 HTML 格式，每页用 <!-- slide --> 分隔
3. 每页包含一个 h1/h2 标题 + 若干 li 要点
4. 输出纯 HTML，不要加前言

示例格式：
<h1>封面标题</h1>
<p>副标题</p>
<!-- slide -->
<h2>核心概念</h2>
<ul><li>要点1</li><li>要点2</li></ul>`,
};

// ── Quality validation ───────────────────────────────────────────

function validateResource(type: ResourceType, content: string): string | null {
  if (!content || content.trim().length === 0) return 'Empty content';
  const text = content.trim();
  const len = text.length;

  switch (type) {
    case 'document': {
      if (len < 500) return `Too short (${len} chars, min 500)`;
      const hasOverview = /##\s*概述/.test(text);
      const hasCore = /##\s*核心概念/.test(text);
      const hasSummary = /##\s*总结/.test(text);
      const sectionCount = [hasOverview, hasCore, hasSummary].filter(Boolean).length;
      if (sectionCount < 2) return `Missing required sections (need 2+ of: 概述/核心概念/总结, got ${sectionCount})`;
      break;
    }
    case 'mindmap': {
      if (len < 100) return `Too short (${len} chars, min 100)`;
      if (!text.includes('mindmap')) return 'Missing mindmap keyword';
      if (!text.includes('((')) return 'Missing root node (( ))';
      break;
    }
    case 'quiz': {
      if (len < 150) return `Too short (${len} chars, min 150)`;
      try {
        const arr = JSON.parse(text);
        if (!Array.isArray(arr)) return 'Quiz is not a JSON array';
        if (arr.length < 3) return `Need at least 3 questions, got ${arr.length}`;
        for (let i = 0; i < arr.length; i++) {
          if (!arr[i].question || !arr[i].answer) return `Question ${i + 1} missing question/answer`;
        }
      } catch { return 'Quiz is not valid JSON'; }
      break;
    }
    case 'video': {
      if (len < 200) return `Too short (${len} chars, min 200)`;
      try {
        const config = JSON.parse(text);
        if (!config.scenes || !Array.isArray(config.scenes)) return 'Missing scenes array';
        if (config.scenes.length < 3) return `Need at least 3 scenes, got ${config.scenes.length}`;
        if (!config.width || !config.height || !config.fps) return 'Missing width/height/fps';
      } catch { return 'Video config is not valid JSON'; }
      break;
    }
    case 'svg': {
      if (len < 100) return `Too short (${len} chars, min 100)`;
      if (!text.includes('<svg')) return 'Missing <svg> opening tag';
      if (!text.includes('</svg>')) return 'Missing </svg> closing tag';
      break;
    }
    case 'diagram': {
      if (len < 100) return `Too short (${len} chars, min 100)`;
      if (!text.includes('mermaid')) return 'Missing mermaid keyword';
      break;
    }
    case 'docx': case 'pdf': {
      if (len < 500) return `Too short (${len} chars, min 500)`;
      const headingCount = (text.match(/<h[12]/gi) || []).length;
      if (headingCount < 3) return `Too few headings (${headingCount}, min 3)`;
      break;
    }
    case 'ppt': {
      if (len < 300) return `Too short (${len} chars, min 300)`;
      if (!text.includes('<!-- slide -->')) return 'Missing slide separators';
      const slideCount = text.split(/<!--\s*slide\s*-->/).length;
      if (slideCount < 6) return `Too few slides (${slideCount}, min 6)`;
      break;
    }
  }
  return null;
}

// ── Orchestrator ─────────────────────────────────────────────────

export class ResourceGenerationOrchestrator {
  private state: ResourceGenerationState;
  private deps: OrchestratorDeps;

  constructor(state: ResourceGenerationState, deps: OrchestratorDeps) {
    this.state = state;
    this.deps = deps;
  }

  async orchestrate(
    topic: string,
    userLevel: string,
    literatureTitle: string,
    literatureContent?: string,
    formats?: string[],
  ): Promise<GenerationResult[]> {
    const results: GenerationResult[] = [];
    const context = this.buildContext(topic, userLevel, literatureContent);
    const types = formats && formats.length > 0
      ? RESOURCE_TYPES.filter(t => formats.includes(t))
      : RESOURCE_TYPES;

    for (const type of types) {
      this.state.startGenerating(type);
      this.deps.onProgress?.({
        type,
        status: 'generating',
        progress: RESOURCE_PROGRESS_START[type],
        message: '正在调用模型生成内容',
      });

      try {
        let videoConfig: HyperFramesConfig | null = null;
        const exists = await this.deps.resourceExists(type, literatureTitle);
        if (exists) {
          this.state.completeGenerating(type);
          this.deps.onProgress?.({
            type,
            status: 'ready',
            progress: 100,
            message: '已有资源，已复用',
            fileName: RESOURCE_FILE_MAP[type],
          });
          results.push({ type, status: 'completed' });
          continue;
        }

        const prompt = RESOURCE_PROMPTS[type];
        let content = await this.deps.callLLM(prompt, context);
        let cleaned = this.cleanOutput(type, content);

        this.deps.onProgress?.({
          type,
          status: 'validating',
          progress: 55,
          message: '正在校验生成结果',
        });
        const validationError = validateResource(type, cleaned);
        if (validationError) {
          this.state.failGenerating(type, validationError);
          this.deps.onProgress?.({
            type,
            status: 'failed',
            progress: 100,
            message: '资源校验失败',
            error: validationError,
          });
          results.push({ type, status: 'failed', error: validationError });
          continue;
        }

        // ── Post-processing per type ──
        switch (type) {
          case 'video': {
            videoConfig = JSON.parse(cleaned) as HyperFramesConfig;
            cleaned = hyperframesHTMLBuilder.buildHTML(videoConfig);
            this.deps.onProgress?.({
              type,
              status: 'saving',
              progress: 70,
              message: '正在保存可预览 HTML 视频',
              fileName: RESOURCE_FILE_MAP[type],
            });
            break;
          }
          case 'docx': {
            this.deps.onProgress?.({ type, status: 'rendering', progress: 70, message: '正在渲染 Word 文档' });
            const buf = await renderDocx(topic, cleaned);
            cleaned = `data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,${buf.toString('base64')}`;
            break;
          }
          case 'pdf': {
            this.deps.onProgress?.({ type, status: 'rendering', progress: 70, message: '正在渲染 PDF 文档' });
            const buf = await renderPdf(topic, cleaned);
            cleaned = `data:application/pdf;base64,${buf.toString('base64')}`;
            break;
          }
          case 'ppt': {
            this.deps.onProgress?.({ type, status: 'rendering', progress: 70, message: '正在渲染 PPT 文件' });
            const slides = cleaned.split(/<!--\s*slide\s*-->/).filter(s => s.trim());
            const buf = await renderPptx(topic, slides);
            cleaned = `data:application/vnd.openxmlformats-officedocument.presentationml.presentation;base64,${buf.toString('base64')}`;
            break;
          }
        }

        this.deps.onProgress?.({
          type,
          status: 'saving',
          progress: 85,
          message: '正在写入文献盒',
          fileName: RESOURCE_FILE_MAP[type],
        });
        await this.deps.saveResource(type, literatureTitle, cleaned);
        const resourcePath = `${this.resourceDir(literatureTitle)}/${RESOURCE_FILE_MAP[type]}`;
        this.deps.onProgress?.({
          type,
          status: 'ready',
          progress: 100,
          message: type === 'video' ? 'HTML 视频已可预览，MP4 后台渲染中' : '资源已可预览',
          path: resourcePath,
          fileName: RESOURCE_FILE_MAP[type],
        });
        if (type === 'video' && videoConfig) {
          void this.renderAndSaveMp4(videoConfig, literatureTitle, type).catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err);
            this.deps.onProgress?.({
              type,
              status: 'failed',
              progress: 100,
              message: 'MP4 渲染失败，HTML 视频仍可播放',
              error: message,
            });
            console.warn('[ResourceGeneration] MP4 render failed; HTML video remains available:', message);
          });
        }
        this.state.completeGenerating(type);
        results.push({ type, status: 'completed' });
      } catch (error: any) {
        this.state.failGenerating(type, error.message || String(error));
        this.deps.onProgress?.({
          type,
          status: 'failed',
          progress: 100,
          message: '资源生成失败',
          error: error.message || String(error),
        });
        results.push({ type, status: 'failed', error: error.message || String(error) });
      }
    }

    return results;
  }

  private buildContext(topic: string, userLevel: string, literatureContent?: string): string {
    const parts = [`学习主题：${topic}`, `用户水平：${userLevel}`];
    if (literatureContent) {
      parts.push(`\n参考文献内容：\n${literatureContent.slice(0, 4000)}`);
    }
    return parts.join('\n');
  }

  private cleanOutput(type: ResourceType, raw: string): string {
    let text = raw.trim();

    if (type === 'document' || type === 'docx' || type === 'pdf' || type === 'ppt') {
      text = text.replace(/^```(?:markdown|md|html)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    }
    if (type === 'mindmap' || type === 'diagram') {
      const mmMatch = text.match(/```(?:mermaid)?\s*\n?([\s\S]*?)```/);
      if (mmMatch) text = mmMatch[1].trim();
    }
    if (type === 'quiz') {
      const jsonMatch = text.match(/(\[[\s\S]*\])/);
      if (jsonMatch) text = jsonMatch[1].trim();
    }
    if (type === 'video') {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) text = jsonMatch[0].trim();
    }
    if (type === 'svg') {
      const svgMatch = text.match(/(<svg[\s\S]*?<\/svg>)/);
      if (svgMatch) text = svgMatch[1].trim();
    }

    return text.trim();
  }

  private async renderAndSaveMp4(config: HyperFramesConfig, literatureTitle: string, type: ResourceType): Promise<void> {
    if (!this.deps.saveResourceFile) return;

    const tempDir = await mkdtemp(join(tmpdir(), 'axiom-video-'));
    const outputPath = join(tempDir, 'video.mp4');
    try {
      this.deps.onProgress?.({
        type,
        status: 'rendering',
        progress: 0,
        message: '正在后台渲染 MP4',
        fileName: 'video.mp4',
      });
      const result = await hyperframesRenderer.render(config, {
        outputPath,
        fps: Math.min(Math.max(config.fps || 24, 12), 30),
        width: config.width || 1920,
        height: config.height || 1080,
        onProgress: ({ percent, frame, totalFrames }) => {
          this.deps.onProgress?.({
            type,
            status: 'rendering',
            progress: percent,
            message: `正在后台渲染 MP4 ${frame}/${totalFrames} frames`,
            fileName: 'video.mp4',
          });
        },
      });
      if (!result.success || !result.outputPath) {
        throw new Error(result.error || 'MP4 render failed');
      }

      const bytes = await readFile(result.outputPath);
      const dataUrl = `data:video/mp4;base64,${bytes.toString('base64')}`;
      await this.deps.saveResourceFile(literatureTitle, 'video.mp4', dataUrl);
      this.deps.onProgress?.({
        type,
        status: 'completed',
        progress: 100,
        message: 'MP4 渲染完成，可下载',
        path: `${this.resourceDir(literatureTitle)}/video.mp4`,
        fileName: 'video.mp4',
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  private resourceDir(literatureTitle: string): string {
    return `resources/${literatureTitle.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '')}`;
  }
}
