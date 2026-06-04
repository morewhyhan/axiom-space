/**
 * HyperFrames 视频生成器
 *
 * 类型定义 + HTML 构建器 + 视频生成入口。
 * 由 ResourceGenerationOrchestrator 在 push_resource 管线中调用。
 */

export interface HyperFramesElement {
  type: 'text' | 'code' | 'shape' | 'image';
  x: number;
  y: number;
  width?: number;
  height?: number;
  content?: string;
  fontSize?: number;
  color?: string;
  fontWeight?: 'normal' | 'bold';
  animation?: {
    type: 'fadeIn' | 'slideIn' | 'bounce' | 'scale';
    duration: number;
    delay?: number;
  };
  code?: string;
  language?: string;
  shape?: 'rect' | 'circle' | 'line';
  fillColor?: string;
  strokeColor?: string;
}

export interface HyperFramesScene {
  id: string;
  duration: number;
  backgroundColor?: string;
  elements: HyperFramesElement[];
}

export interface HyperFramesConfig {
  scenes: HyperFramesScene[];
  width: number;
  height: number;
  fps: number;
  duration?: number;
  format?: 'mp4' | 'webm';
  bitrate?: string;
}

export interface VideoGenerationResult {
  success: boolean;
  videoUrl?: string;
  duration?: number;
  fileSize?: number;
  error?: string;
}

/**
 * HyperFrames HTML 构建器
 */
export class HyperFramesHTMLBuilder {
  buildHTML(config: HyperFramesConfig): string {
    const cssAnimations = `
      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      @keyframes slideIn {
        from { transform: translateX(-50px); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
      }
      @keyframes bounce {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-20px); }
      }
      @keyframes scale {
        from { transform: scale(0.8); opacity: 0; }
        to { transform: scale(1); opacity: 1; }
      }
    `;

    const scenes = config.scenes
      .map((scene, idx) => this.buildSceneHTML(scene, idx === 0))
      .join('\n');

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>HyperFrames Video</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #000; font-family: 'Segoe UI', Tahoma, Geneva, sans-serif; }

    .video-container {
      width: ${config.width}px;
      height: ${config.height}px;
      position: relative;
      overflow: hidden;
      background: #fff;
    }

    .scene {
      position: absolute;
      width: 100%;
      height: 100%;
      top: 0;
      left: 0;
      opacity: 0;
    }

    .scene.active {
      opacity: 1;
    }

    .element {
      position: absolute;
      font-family: inherit;
    }

    .text-element {
      display: flex;
      align-items: center;
      justify-content: flex-start;
    }

    .code-element {
      background: #f5f5f5;
      border-radius: 8px;
      padding: 16px;
      border-left: 4px solid #007bff;
      font-family: 'Monaco', 'Menlo', monospace;
      overflow: auto;
      font-size: 12px;
      color: #333;
    }

    .shape-element {
      border-radius: 4px;
    }

    ${cssAnimations}
  </style>
</head>
<body>
  <div class="video-container">
    ${scenes}
  </div>

  <script>
    const config = ${JSON.stringify(config)};
    let currentSceneIndex = 0;
    let currentTime = 0;
    const frameDuration = 1000 / config.fps;

    function showFrameAt(timeMs) {
      const videoContainer = document.querySelector('.video-container');
      const allScenes = Array.from(videoContainer.querySelectorAll('.scene'));

      let sceneStartTime = 0;
      for (let i = 0; i < config.scenes.length; i++) {
        const sceneEndTime = sceneStartTime + config.scenes[i].duration * 1000;

        if (timeMs >= sceneStartTime && timeMs < sceneEndTime) {
          allScenes.forEach((s, idx) => {
            s.classList.toggle('active', idx === i);
          });
          currentSceneIndex = i;
          break;
        }

        sceneStartTime = sceneEndTime;
      }

      const totalDuration = config.scenes.reduce((sum, s) => sum + s.duration * 1000, 0);
      if (timeMs >= totalDuration && allScenes.length > 0) {
        allScenes.forEach((s, idx) => {
          s.classList.toggle('active', idx === allScenes.length - 1);
        });
        currentSceneIndex = allScenes.length - 1;
      }
    }

    window.__hyperframesSeek = function(timeSeconds) {
      currentTime = Math.max(0, timeSeconds * 1000);
      showFrameAt(currentTime);
    };

    function render() {
      showFrameAt(currentTime);
      currentTime += frameDuration;
      const totalDuration = config.scenes.reduce((sum, s) => sum + s.duration * 1000, 0);

      if (currentTime < totalDuration) {
        requestAnimationFrame(render);
      }
    }

    render();
  </script>
</body>
</html>`;
  }

  private buildSceneHTML(scene: HyperFramesScene, isActive: boolean): string {
    const backgroundColor = scene.backgroundColor || '#ffffff';
    const elementsHTML = scene.elements
      .map(el => this.buildElementHTML(el))
      .join('\n');

    return `<div class="scene ${isActive ? 'active' : ''}" style="background: ${backgroundColor}">
      ${elementsHTML}
    </div>`;
  }

  private buildElementHTML(element: HyperFramesElement): string {
    const baseStyle = `
      left: ${element.x}px;
      top: ${element.y}px;
      ${element.width ? `width: ${element.width}px;` : ''}
      ${element.height ? `height: ${element.height}px;` : ''}
    `;

    const animationStyle = element.animation
      ? `animation: ${element.animation.type} ${element.animation.duration}s ease-in-out ${element.animation.delay || 0}s;`
      : '';

    switch (element.type) {
      case 'text':
        return `<div class="element text-element" style="${baseStyle} font-size: ${element.fontSize || 24}px; color: ${element.color || '#000'}; font-weight: ${element.fontWeight || 'normal'}; ${animationStyle}">
          ${(element.content || '').replace(/</g, '&lt;').replace(/>/g, '&gt;')}
        </div>`;

      case 'code':
        return `<div class="element code-element" style="${baseStyle} ${animationStyle}">
          <pre><code>${(element.code || '').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>
        </div>`;

      case 'shape':
        const shapeStyle = `
          ${baseStyle}
          background: ${element.fillColor || 'transparent'};
          border: ${element.fillColor ? '0' : '2px'} solid ${element.strokeColor || '#000'};
          border-radius: ${element.shape === 'circle' ? '50%' : '4px'};
          ${animationStyle}
        `;
        return `<div class="element shape-element" style="${shapeStyle}"></div>`;

      default:
        return '';
    }
  }
}

/**
 * HyperFrames 视频生成器
 *
 * 由 ResourceGenerationOrchestrator 在 push_resource 管线中调用。
 * LLM 生成 HyperFramesConfig JSON → buildHTML() 生成自包含动画 HTML → 保存为 video.html。
 */
export class HyperFramesGenerator {
  private builder = new HyperFramesHTMLBuilder();

  /**
   * 从 LLM 生成的 HyperFramesConfig JSON 构建自包含 HTML 视频
   */
  buildVideoHTML(config: HyperFramesConfig): string {
    return this.builder.buildHTML(config);
  }
}

export const hyperframesGenerator = new HyperFramesGenerator();

/** 直接导出 HTML builder，供编排器使用 */
export const hyperframesHTMLBuilder = new HyperFramesHTMLBuilder();
