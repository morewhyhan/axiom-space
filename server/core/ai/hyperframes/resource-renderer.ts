/**
 * 资源渲染器
 *
 * 用专业库把 LLM 生成的内容转换成高质量的目标格式：
 * - LLM 输出 HTML（它最擅长的格式）
 * - html-to-docx → .docx
 * - Puppeteer → .pdf
 * - McKinsey PPTX 引擎 → .pptx（deep-navy 专业模板）
 *
 * SVG 和 Mermaid 是自描述格式，LLM 直接生成，无需额外转换。
 */

import { spawn } from 'node:child_process';
import { writeFile, readFile, unlink, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser } from 'puppeteer';
import puppeteer from 'puppeteer';

// ── 统一的 HTML 转文档接口 ────────────────────────────────────────

export function wrapForDocType(title: string, bodyHtml: string, lang = 'zh-CN'): string {
  return `<!DOCTYPE html>
<html lang="${lang}">
<head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
  body { font-family: 'Segoe UI', system-ui, sans-serif; max-width: 800px; margin: 0 auto; padding: 40px 20px; color: #1a1a1a; line-height: 1.8; font-size: 14px; }
  h1 { font-size: 28px; color: #6366f1; border-bottom: 2px solid #6366f1; padding-bottom: 8px; margin-top: 0; }
  h2 { font-size: 22px; color: #a855f7; margin-top: 32px; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; }
  h3 { font-size: 18px; color: #22d3ee; margin-top: 24px; }
  p { margin: 10px 0; }
  code { background: #f3f4f6; padding: 2px 6px; border-radius: 4px; font-size: 13px; color: #dc2626; }
  pre { background: #1f2937; color: #f3f4f6; padding: 16px; border-radius: 8px; overflow-x: auto; font-size: 13px; line-height: 1.6; }
  pre code { background: none; color: inherit; padding: 0; }
  table { border-collapse: collapse; width: 100%; margin: 16px 0; }
  th, td { border: 1px solid #d1d5db; padding: 8px 12px; text-align: left; }
  th { background: #f3f4f6; font-weight: 600; }
  ul, ol { margin: 8px 0; padding-left: 24px; }
  li { margin: 4px 0; }
  blockquote { border-left: 4px solid #6366f1; margin: 16px 0; padding: 8px 16px; background: #f5f3ff; border-radius: 0 8px 8px 0; }
  img { max-width: 100%; border-radius: 8px; margin: 16px 0; }
  hr { border: none; border-top: 1px solid #e5e7eb; margin: 24px 0; }
  .mermaid { background: #f8fafc; padding: 16px; border-radius: 8px; text-align: center; font-family: monospace; white-space: pre; }
  @media print { body { padding: 0; } }
</style></head><body>${bodyHtml}</body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── DOCX ──────────────────────────────────────────────────────────

export async function renderDocx(
  title: string,
  bodyHtml: string,
): Promise<Buffer> {
  const fullHtml = wrapForDocType(title, bodyHtml);
  // Use the UMD build because Next bundles the package ESM entry and warns on
  // its optional `encoding` dependency even though this code only runs server-side.
  // @ts-ignore — package subpath has no TS declaration.
  const docxModule = await import('html-to-docx/dist/html-to-docx.umd.js');
  const htmlToDocx = (docxModule.default ?? docxModule) as (
    html: string,
    options?: Record<string, unknown>,
  ) => Promise<Buffer | ArrayBuffer>;
  const buffer = await htmlToDocx(fullHtml, {
    orientation: 'portrait',
    margins: { top: 720, right: 720, bottom: 720, left: 720 },
  });
  return buffer as unknown as Buffer;
}

// ── PDF ───────────────────────────────────────────────────────────

let _pdfBrowser: Browser | null = null;

async function getPdfBrowser(): Promise<Browser> {
  if (!_pdfBrowser?.connected) {
    _pdfBrowser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
  }
  return _pdfBrowser;
}

export async function renderPdf(
  title: string,
  bodyHtml: string,
): Promise<Buffer> {
  const fullHtml = wrapForDocType(title, bodyHtml);
  const browser = await getPdfBrowser();
  const page = await browser.newPage();
  await page.setContent(fullHtml, { waitUntil: 'networkidle0' as any });
  const buf = await page.pdf({
    format: 'A4',
    margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' },
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    footerTemplate: `
      <div style="width:100%;font-size:9px;color:#999;text-align:center;padding:4px 20px">
        ${escapeHtml(title)} — 第 <span class="pageNumber"></span> 页
      </div>`,
  });
  await page.close();
  return buf as unknown as Buffer;
}

// ── PPT ───────────────────────────────────────────────────────────

const MCKINSEY_BRIDGE = join(
  process.cwd(), 'scripts', 'mckinsey-pptx', 'bridge.py',
);
const MCKINSEY_VENV_PYTHON = join(
  process.cwd(), 'scripts', 'mckinsey-pptx', '.venv', 'bin', 'python3',
);

/**
 * Build a McKinsey-style PPTX from structured slide specs.
 *
 * Each slide spec has a `type` and payload matching the McKinsey template registry.
 * Types include: executive_summary, column_chart, assessment_table, trends,
 * org_chart, timeline, process_flow, summary, structure, comparison, etc.
 *
 * Uses the cloned mckinsey-pptx engine (scripts/mckinsey-pptx) via a Python bridge.
 */
export async function renderPptx(
  title: string,
  slideSpecs: Record<string, unknown>[],
): Promise<Buffer> {
  // Ensure every spec has a section marker so the McKinsey engine formats consistently
  const specs = slideSpecs.map((spec, i) => ({
    ...spec,
    section_marker: (spec.section_marker as string) || title || `Slide ${i + 1}`,
  }));

  const tmpDir = await mkdtemp(join(tmpdir(), 'axiom-pptx-'));
  const jsonPath = join(tmpDir, 'spec.json');
  const pptxPath = join(tmpDir, 'output.pptx');

  try {
    await writeFile(jsonPath, JSON.stringify(specs), 'utf-8');

    await new Promise<void>((resolve, reject) => {
      const proc = spawn(MCKINSEY_VENV_PYTHON, [MCKINSEY_BRIDGE, jsonPath, pptxPath], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stderr = '';
      proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
      proc.on('close', (code: number | null) => {
        if (code === 0) resolve();
        else reject(new Error(stderr.trim() || `mckinsey-pptx exited ${code}`));
      });
      proc.on('error', reject);
    });

    const buf = await readFile(pptxPath);
    return buf;
  } finally {
    // Cleanup temp files
    unlink(jsonPath).catch(() => {});
    unlink(pptxPath).catch(() => {});
  }
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, '').trim();
}

// ── 关闭 PDF 浏览器（释放资源） ──────────────────────────────────

export async function closePdfRenderer(): Promise<void> {
  if (_pdfBrowser) {
    await _pdfBrowser.close().catch(() => {});
    _pdfBrowser = null;
  }
}
