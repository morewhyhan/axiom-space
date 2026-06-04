/**
 * HyperFrames 视频渲染器
 *
 * 将生成好的 HTML 动画通过 Puppeteer + FFmpeg 渲染为真实 MP4 视频。
 *
 * 流程：
 *   生成 HTML → Puppeteer 打开 → 逐帧截图 → 管道传入 FFmpeg → MP4
 */

import puppeteer from 'puppeteer';
import type { Browser, Page } from 'puppeteer';
import { mkdtempSync } from 'node:fs';
import { writeFile, unlink } from 'node:fs/promises';
import { join, delimiter } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { hyperframesHTMLBuilder } from './generator';
import type { HyperFramesConfig } from './generator';

const FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg';
const DEFAULT_FPS = 30;

export interface RenderOptions {
  /** 输出文件完整路径（含 .mp4） */
  outputPath: string;
  /** 帧率，默认 30 */
  fps?: number;
  /** 视频宽度，默认 1920 */
  width?: number;
  /** 视频高度，默认 1080 */
  height?: number;
  /** 渲染进度回调 */
  onProgress?: (progress: {
    percent: number;
    frame: number;
    totalFrames: number;
  }) => void;
}

export interface RenderResult {
  success: boolean;
  outputPath?: string;
  durationMs?: number;
  framesEncoded?: number;
  fileSize?: number;
  error?: string;
}

/**
 * HyperFrames 渲染器
 */
export class HyperFramesRenderer {
  private browser: Browser | null = null;

  async ensureBrowser(): Promise<Browser> {
    if (!this.browser?.connected) {
      this.browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
        ],
      });
    }
    return this.browser;
  }

  /**
   * 渲染单个帧为 PNG buffer
   */
  private async captureFrame(page: Page, frameIndex: number, fps: number): Promise<Buffer> {
    const timeSeconds = frameIndex / fps;
    // 用 JS 推进动画时间线
    await page.evaluate((t) => {
      const seek = (window as any).__hyperframesSeek;
      if (typeof seek === 'function') seek(t);
      const tl = (window as any).__hfTimeline;
      if (tl && typeof tl.seek === 'function') tl.seek(t);
    }, timeSeconds);
    await sleep(50); // 等待渲染完成
    return await page.screenshot({ type: 'png', fullPage: false }) as unknown as Buffer;
  }

  /**
   * 将 HTML 动画渲染为 MP4 视频
   */
  async render(config: HyperFramesConfig, options: RenderOptions): Promise<RenderResult> {
    const fps = options.fps ?? DEFAULT_FPS;
    const width = options.width ?? config.width ?? 1920;
    const height = options.height ?? config.height ?? 1080;
    const totalDuration = config.duration ?? config.scenes.reduce((s, sc) => s + sc.duration, 0);
    const totalFrames = Math.ceil(totalDuration * fps);

    const startTime = Date.now();

    try {
      // 1. 生成 HTML
      const html = hyperframesHTMLBuilder.buildHTML(config);

      // 2. 写临时文件
      const tmpDir = mkdtempSync(join(tmpdir(), 'hyperframes-'));
      const htmlPath = join(tmpDir, 'index.html');
      await writeFile(htmlPath, html, 'utf-8');

      // 3. 启动浏览器
      const browser = await this.ensureBrowser();
      const page = await browser.newPage();
      await page.setViewport({ width, height });
      await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle0', timeout: 30000 });
      await sleep(500); // 等待 GSAP 初始化

      // 4. 启动 FFmpeg 进程（从 stdin 读取 PNG 帧）
      const homeBin = join(homedir(), 'bin');
      const envPath = [homeBin, process.env.PATH].filter(Boolean).join(delimiter);
      const ffmpeg = spawn(FFMPEG_PATH, [
        '-y',
        '-f', 'image2pipe',
        '-framerate', String(fps),
        '-i', '-',
        '-c:v', 'libx264',
        '-preset', 'medium',
        '-crf', '18',
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
        options.outputPath,
      ], {
        stdio: ['pipe', 'inherit', 'pipe'],
        env: { ...process.env, PATH: envPath },
      });

      // 5. 逐帧捕获并写入 FFmpeg stdin
      let framesWritten = 0;
      const writeStream = ffmpeg.stdin!;

      for (let i = 0; i < totalFrames; i++) {
        // 第一帧和第 N 帧特殊处理
        if (i === 0) {
          // 等待 GSAP 初始化完成后再捕获第一帧
          await sleep(300);
        }
        const buf = await this.captureFrame(page, i, fps);
        writeStream.write(buf);
        framesWritten++;

        // 每 30 帧报告一次进度
        if (i % 30 === 0 && i > 0) {
          const progress = Math.round((i / totalFrames) * 100);
          console.log(`[HyperFrames] Rendering: ${progress}% (${i}/${totalFrames} frames)`);
          options.onProgress?.({ percent: progress, frame: i, totalFrames });
        }
      }

      // 6. 关闭 stdin 等待编码完成
      writeStream.end();

      const exitCode = await new Promise<number>((resolve) => {
        ffmpeg.on('close', resolve);
        ffmpeg.on('error', (err) => {
          console.error('[HyperFrames] FFmpeg error:', err);
          resolve(1);
        });
      });

      await page.close();

      // 7. 清理临时文件
      await unlink(htmlPath).catch(() => {});

      if (exitCode !== 0) {
        return {
          success: false,
          error: `FFmpeg exited with code ${exitCode}`,
          framesEncoded: framesWritten,
          durationMs: Date.now() - startTime,
        };
      }

      // 获取文件大小
      const { stat } = await import('node:fs/promises');
      let fileSize = 0;
      try {
        fileSize = (await stat(options.outputPath)).size;
      } catch {}

      return {
        success: true,
        outputPath: options.outputPath,
        durationMs: Date.now() - startTime,
        framesEncoded: framesWritten,
        fileSize,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg, durationMs: Date.now() - startTime };
    }
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
    }
  }
}

/** 默认渲染器实例 */
export const hyperframesRenderer = new HyperFramesRenderer();
