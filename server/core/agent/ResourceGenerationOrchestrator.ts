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
import { contentSafetyGuardrail } from '../ai/guardrails/content-safety';
import { factualCheckGuardrail } from '../ai/guardrails/factual-check';
import { RESOURCE_GENERATION_PROMPTS, type ResourceGenerationInput } from '../ai/prompts';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export interface OrchestratorDeps {
  callLLM: (systemPrompt: string, userMessage: string) => Promise<string>;
  resourceExists: (type: ResourceType, literatureTitle: string) => Promise<boolean>;
  saveResource: (type: ResourceType, literatureTitle: string, content: string) => Promise<void>;
  saveResourceFile?: (literatureTitle: string, fileName: string, content: string) => Promise<void>;
  skipMp4Render?: boolean;
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
  guardrails?: GuardrailReport;
}

export interface GuardrailReport {
  safetyStatus: 'passed' | 'blocked' | 'review_needed';
  factualStatus: 'passed' | 'warning' | 'blocked';
  message: string;
  issues: Array<{
    assertion: string;
    status: string;
    suggestion?: string;
  }>;
}

const RESOURCE_PROGRESS_START: Record<ResourceType, number> = {
  document: 4,
  mindmap: 4,
  quiz: 4,
  code: 4,
  video: 4,
  svg: 4,
  diagram: 4,
  docx: 4,
  pdf: 4,
  ppt: 4,
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
          const issue = validateQuizQuestion(arr[i], i);
          if (issue) return issue;
        }
      } catch { return 'Quiz is not valid JSON'; }
      break;
    }
    case 'code': {
      if (len < 300) return `Too short (${len} chars, min 300)`;
      const required = ['练习目标', '初始代码', '任务要求', '测试样例', '参考实现'];
      const missing = required.filter((section) => !text.includes(section));
      if (missing.length > 2) return `Missing code practice sections: ${missing.join(', ')}`;
      const codeBlockCount = (text.match(/```/g) || []).length / 2;
      if (codeBlockCount < 2) return `Need at least 2 code blocks, got ${codeBlockCount}`;
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
      const validDiagramTypes = ['flowchart', 'sequenceDiagram', 'classDiagram', 'pie', 'stateDiagram', 'gantt', 'erDiagram', 'journey', 'gitGraph', 'graph'];
      const hasValidType = validDiagramTypes.some((dt) => text.includes(dt));
      if (!hasValidType) return `Missing valid Mermaid diagram type (got: ${text.slice(0, 50)})`;
      break;
    }
    case 'docx': case 'pdf': {
      if (len < 500) return `Too short (${len} chars, min 500)`;
      const headingCount = (text.match(/<h[12]/gi) || []).length;
      if (headingCount < 3) return `Too few headings (${headingCount}, min 3)`;
      break;
    }
    case 'ppt': {
      if (len < 200) return `Too short (${len} chars, min 200)`;
      // Accept new JSON slide-spec format or legacy HTML format
      try {
        const parsed = JSON.parse(text);
        if (!Array.isArray(parsed) || parsed.length < 4) return `Need at least 4 slides in JSON array`;
      } catch {
        // Legacy HTML fallback
        if (!text.includes('<!-- slide -->')) return 'Missing slide separators (legacy HTML)';
        const slideCount = text.split(/<!--\s*slide\s*-->/).length;
        if (slideCount < 4) return `Too few slides (${slideCount}, min 4)`;
      }
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
    ragContext?: { contextText: string; references: string[] },
    profileContext?: { contextText: string; evidence: ResourceGenerationInput['profileEvidence'] },
  ): Promise<GenerationResult[]> {
    const results: GenerationResult[] = [];
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

        const prompt = RESOURCE_GENERATION_PROMPTS[type];
        let content: string;
        try {
          content = await this.deps.callLLM(
            prompt.system,
            prompt.buildUserMessage!({
              topic,
              userLevel,
              literatureContent,
              ragContext: ragContext?.contextText,
              ragReferences: ragContext?.references,
              profileContext: profileContext?.contextText,
              profileEvidence: profileContext?.evidence,
            }),
          );
        } catch (error: any) {
          if (type !== 'svg') throw error;
          content = this.buildFallbackSvg(topic);
        }
        let cleaned = this.cleanOutput(type, content);

        this.deps.onProgress?.({
          type,
          status: 'validating',
          progress: 55,
          message: '正在校验生成结果',
        });
        let validationError = validateResource(type, cleaned);
        if (type === 'svg' && validationError) {
          cleaned = this.buildFallbackSvg(topic);
          validationError = validateResource(type, cleaned);
        }
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

        const guardrailReport = await this.runGuardrails(type, cleaned);
        if (guardrailReport.safetyStatus === 'blocked' || guardrailReport.factualStatus === 'blocked') {
          const error = guardrailReport.message;
          this.state.failGenerating(type, error);
          this.deps.onProgress?.({
            type,
            status: 'failed',
            progress: 100,
            message: '资源安全/事实校验失败',
            error,
          });
          if (this.deps.saveResourceFile) {
            await this.saveGuardrailReport(literatureTitle, type, guardrailReport).catch(() => {});
          }
          results.push({ type, status: 'failed', error, guardrails: guardrailReport });
          continue;
        }
        if (this.deps.saveResourceFile) {
          await this.saveGuardrailReport(literatureTitle, type, guardrailReport);
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
            this.deps.onProgress?.({ type, status: 'rendering', progress: 70, message: '正在渲染 McKinsey 风格 PPT' });
            let slideSpecs: Record<string, unknown>[];
            try {
              // New format: JSON slide specs for McKinsey engine
              const parsed = JSON.parse(cleaned);
              slideSpecs = Array.isArray(parsed) ? parsed : [parsed];
            } catch {
              // Fallback: old HTML format → convert to basic spec
              const slides = cleaned.split(/<!--\s*slide\s*-->/).filter((s: string) => s.trim());
              slideSpecs = slides.map((html: string, i: number) => {
                const titleMatch = html.match(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/);
                const slideTitle = titleMatch ? titleMatch[1].replace(/<[^>]*>/g, '').trim() : `${topic} (${i + 1})`;
                if (i === 0) return { type: 'cover_slide', title: slideTitle, subtitle: topic };
                if (i === slides.length - 1) return { type: 'dark_navy_summary', body: stripHtmlTags(html).slice(0, 200) };
                return { type: 'executive_summary_paragraph', title: slideTitle, paragraphs: [stripHtmlTags(html).slice(0, 400)] };
              });
            }
            const buf = await renderPptx(topic, slideSpecs);
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
        if (type === 'video' && videoConfig && !this.deps.skipMp4Render) {
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
        results.push({ type, status: 'completed', guardrails: guardrailReport });
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

  private cleanOutput(type: ResourceType, raw: string): string {
    let text = raw.trim();

    if (type === 'document' || type === 'code' || type === 'docx' || type === 'pdf' || type === 'ppt') {
      text = text.replace(/^```(?:markdown|md|html)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    }
    if (type === 'mindmap' || type === 'diagram') {
      const mmMatch = text.match(/```(?:mermaid)?\s*\n?([\s\S]*?)```/);
      if (mmMatch) text = mmMatch[1].trim();
      if (type === 'mindmap') text = this.sanitizeMindmap(text);
    }
    if (type === 'quiz') {
      const jsonMatch = text.match(/(\[[\s\S]*\])/);
      if (jsonMatch) text = jsonMatch[1].trim();
    }
    if (type === 'video') {
      // 支持 markdown 代码块包裹：```json ... ```
      const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
      if (fenceMatch) text = fenceMatch[1].trim();
      // 从内容中提取 JSON 对象
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) text = jsonMatch[0].trim();
    }
    if (type === 'svg') {
      // 支持 markdown 代码块包裹：```svg/html/xml ... ```
      const fenceMatch = text.match(/```(?:svg|html|xml)?\s*\n?([\s\S]*?)```/);
      if (fenceMatch) text = fenceMatch[1].trim();
      // 从 HTML 或纯文本中提取 <svg>...</svg>
      const svgMatch = text.match(/(<svg[\s\S]*?<\/svg>)/);
      if (svgMatch) text = svgMatch[1].trim();
    }

    return text.trim();
  }

  private sanitizeMindmap(raw: string): string {
    return raw
      .split('\n')
      .map((line) => {
        if (!line.trim()) return line;
        const indent = line.match(/^\s*/)?.[0] ?? '';
        const trimmed = line.trim();
        if (trimmed === 'mindmap' || trimmed.startsWith('root((')) return line;
        return indent + trimmed
          .replace(/^\[|\]$/g, '')
          .replace(/[\[\]<>]/g, '')
          .replace(/&/g, 'and')
          .replace(/\//g, ' or ')
          .replace(/[()]/g, '')
          .replace(/\s+/g, ' ')
          .trim();
      })
      .join('\n');
  }

  private buildFallbackSvg(topic: string): string {
    const safeTopic = escapeXml(topic || 'Learning Topic');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" width="800" height="600">
  <rect width="800" height="600" rx="24" fill="#f8fafc"/>
  <text x="400" y="58" text-anchor="middle" font-family="Microsoft YaHei, Arial, sans-serif" font-size="26" font-weight="700" fill="#172033">${safeTopic}</text>
  <text x="400" y="88" text-anchor="middle" font-family="Microsoft YaHei, Arial, sans-serif" font-size="15" fill="#526179">自动降级 SVG 图解</text>
  <g stroke="#355070" stroke-width="3" fill="none">
    <line x1="400" y1="145" x2="205" y2="260"/>
    <line x1="400" y1="145" x2="400" y2="280"/>
    <line x1="400" y1="145" x2="595" y2="260"/>
    <line x1="205" y1="260" x2="290" y2="420"/>
    <line x1="400" y1="280" x2="400" y2="420"/>
    <line x1="595" y1="260" x2="510" y2="420"/>
  </g>
  <g font-family="Microsoft YaHei, Arial, sans-serif" font-size="17" font-weight="700" text-anchor="middle">
    <circle cx="400" cy="145" r="52" fill="#355070"/><text x="400" y="151" fill="#fff">主题</text>
    <circle cx="205" cy="260" r="48" fill="#6d597a"/><text x="205" y="266" fill="#fff">概念</text>
    <circle cx="400" cy="280" r="48" fill="#b56576"/><text x="400" y="286" fill="#fff">方法</text>
    <circle cx="595" cy="260" r="48" fill="#e56b6f"/><text x="595" y="266" fill="#fff">应用</text>
    <rect x="235" y="395" width="110" height="58" rx="14" fill="#eaac8b"/><text x="290" y="431" fill="#172033">证据</text>
    <rect x="345" y="395" width="110" height="58" rx="14" fill="#f3c677"/><text x="400" y="431" fill="#172033">练习</text>
    <rect x="455" y="395" width="110" height="58" rx="14" fill="#84a98c"/><text x="510" y="431" fill="#172033">复盘</text>
  </g>
  <text x="400" y="530" text-anchor="middle" font-family="Microsoft YaHei, Arial, sans-serif" font-size="14" fill="#526179">AI SVG 生成失败时使用模板兜底，保证资源可预览且结构完整。</text>
</svg>`;
  }

  private async runGuardrails(type: ResourceType, content: string): Promise<GuardrailReport> {
    const safety = await contentSafetyGuardrail.filter(content);
    if (safety.status === 'blocked') {
      return {
        safetyStatus: 'blocked',
        factualStatus: 'blocked',
        message: safety.reason || '内容安全校验未通过',
        issues: [{
          assertion: safety.reason || 'content_safety',
          status: 'blocked',
          suggestion: safety.suggestion,
        }],
      };
    }

    const factual = await factualCheckGuardrail.verify(content, type);
    return {
      safetyStatus: safety.status,
      factualStatus: factual.status,
      message: factual.message,
      issues: factual.issues.map((issue) => ({
        assertion: issue.assertion,
        status: issue.status,
        suggestion: issue.suggestion,
      })),
    };
  }

  private async saveGuardrailReport(
    literatureTitle: string,
    type: ResourceType,
    report: GuardrailReport,
  ): Promise<void> {
    if (!this.deps.saveResourceFile) return;
    const fileName = `guardrail-${type}.json`;
    await this.deps.saveResourceFile(literatureTitle, fileName, JSON.stringify({
      resourceType: type,
      checkedAt: new Date().toISOString(),
      ...report,
    }, null, 2));
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
      if (bytes.length < 10_000 || bytes.subarray(4, 8).toString('ascii') !== 'ftyp') {
        throw new Error(`MP4 成品校验失败：${bytes.length} bytes，缺少有效 ftyp 文件头`);
      }
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

function validateQuizQuestion(question: any, index: number): string | null {
  const prefix = `Question ${index + 1}`;
  const options = Array.isArray(question.options) ? question.options.map((option: unknown) => String(option).trim()) : [];
  if (options.length < 4) return `${prefix} needs at least 4 options`;
  if (new Set(options).size !== options.length) return `${prefix} has duplicate options`;

  const answer = String(question.answer ?? '').trim();
  const optionLabels = options.map((option: string) => option.match(/^([A-Z])[\.\s:：]/)?.[1]).filter(Boolean);
  if (/^[A-Z]$/.test(answer) && optionLabels.length > 0 && !optionLabels.includes(answer)) {
    return `${prefix} answer ${answer} does not match options`;
  }

  const combined = [question.question, question.answer, question.explanation, ...options].join('\n');
  if (/(我需重新检查|重新检查|笔误|复制错误|答案设为|应该是|可能是正确|不确定|I need to|mistake|typo)/i.test(combined)) {
    return `${prefix} contains self-correction or uncertain wording`;
  }
  return null;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function stripHtmlTags(html: string): string {
  return html.replace(/<[^>]*>/g, '').trim();
}
