/** HyperFrames: structured teaching storyboard -> self-contained animated HTML. */

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
  role?: 'title' | 'body' | 'caption' | 'badge';
  align?: 'left' | 'center' | 'right';
  animation?: {
    type: 'fadeIn' | 'slideIn' | 'bounce' | 'scale' | 'reveal' | 'float' | 'draw';
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
  accentColor?: string;
  eyebrow?: string;
  title?: string;
  subtitle?: string;
  narration?: string;
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
  title?: string;
}

export interface VideoGenerationResult {
  success: boolean;
  videoUrl?: string;
  duration?: number;
  fileSize?: number;
  error?: string;
}

export class HyperFramesHTMLBuilder {
  buildHTML(config: HyperFramesConfig): string {
    const normalized = normalizeHyperFramesConfig(config);
    const scenes = normalized.scenes.map((scene, index) => this.buildSceneHTML(scene, index, normalized.scenes.length)).join('\n');
    const safeConfig = JSON.stringify(normalized).replace(/</g, '\\u003c');

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
  <title>${escapeHtml(normalized.title || 'AXIOM 教学视频')}</title>
  <style>
    :root{color-scheme:dark}*{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;overflow:hidden;background:#030712}
    body{font-family:Inter,"Microsoft YaHei","PingFang SC",system-ui,sans-serif;-webkit-font-smoothing:antialiased}
    .viewport{position:relative;width:100vw;height:100vh;overflow:hidden;background:radial-gradient(circle at 20% 15%,#12325a 0,transparent 35%),#030712}
    .stage{position:absolute;left:50%;top:50%;width:${normalized.width}px;height:${normalized.height}px;transform-origin:center center;overflow:hidden;background:#07111f}
    .scene{position:absolute;inset:0;display:block;opacity:0;visibility:hidden;overflow:hidden;color:#eef6ff}
    .scene.active{opacity:1;visibility:visible}
    .scene:before{content:"";position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.025) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.025) 1px,transparent 1px);background-size:48px 48px;mask-image:linear-gradient(to bottom,black,transparent 88%)}
    .scene:after{content:"";position:absolute;width:760px;height:760px;border-radius:50%;right:-300px;top:-390px;background:var(--accent);filter:blur(130px);opacity:.16}
    .ambient{position:absolute;z-index:1;inset:0;pointer-events:none;overflow:hidden}.orb{position:absolute;border:1px solid color-mix(in srgb,var(--accent) 32%,transparent);border-radius:50%;opacity:.28}.orb-a{width:420px;height:420px;right:120px;top:210px}.orb-b{width:250px;height:250px;right:205px;top:295px}.beam{position:absolute;left:50%;top:-20%;width:2px;height:140%;background:linear-gradient(transparent,var(--accent),transparent);opacity:.14;transform:rotate(34deg);box-shadow:0 0 45px var(--accent)}
    .scanline{position:absolute;z-index:7;left:0;right:0;height:2px;top:0;background:linear-gradient(90deg,transparent,rgba(190,240,255,.22),transparent);opacity:.35;pointer-events:none}
    .brand{position:absolute;left:72px;top:48px;z-index:5;display:flex;align-items:center;gap:14px;color:#dff8ff;font:700 18px/1 monospace;letter-spacing:.18em}
    .brand-mark{width:12px;height:12px;border:2px solid var(--accent);transform:rotate(45deg);box-shadow:0 0 22px var(--accent)}
    .scene-index{position:absolute;right:72px;top:48px;z-index:5;color:#8ea6c2;font:500 16px/1 monospace;letter-spacing:.12em}
    .scene-header{position:absolute;z-index:4;left:110px;right:110px;top:132px}
    .eyebrow{color:var(--accent);font:700 17px/1.2 monospace;letter-spacing:.18em;text-transform:uppercase;margin-bottom:22px}
    .scene-title{max-width:1480px;margin:0;color:#f8fbff;font-size:64px;line-height:1.12;letter-spacing:-.035em;font-weight:750;text-wrap:balance}
    .scene-subtitle{max-width:1380px;margin-top:20px;color:#b8c8dc;font-size:27px;line-height:1.55;font-weight:400}
    .content-layer{position:absolute;inset:0;z-index:3}
    .element{position:absolute;will-change:transform,opacity;overflow:hidden}
    .text-element{display:flex;align-items:center;padding:20px 26px;border:1px solid rgba(255,255,255,.10);border-radius:18px;background:linear-gradient(145deg,rgba(17,34,56,.88),rgba(8,20,36,.78));box-shadow:0 22px 55px rgba(0,0,0,.28);line-height:1.5;white-space:pre-wrap}
    .text-element[data-role="badge"]{padding:10px 16px;border-color:color-mix(in srgb,var(--accent) 35%,transparent);border-radius:999px;background:color-mix(in srgb,var(--accent) 12%,transparent);font-family:monospace}
    .text-element[data-role="caption"]{border:0;background:transparent;box-shadow:none;color:#91a8c2;padding:4px}
    .code-element{padding:24px 28px;border:1px solid rgba(111,220,255,.22);border-radius:20px;background:#06101df2;box-shadow:0 24px 65px #0008,inset 3px 0 0 var(--accent);font-family:"JetBrains Mono",Consolas,monospace;color:#d9edff}
    .code-head{display:flex;align-items:center;justify-content:space-between;padding-bottom:15px;margin-bottom:14px;border-bottom:1px solid rgba(255,255,255,.08);color:#7f9bb9;font-size:14px;text-transform:uppercase;letter-spacing:.12em}
    .code-dots{color:#ff6b7a;letter-spacing:.35em}.code-element pre{margin:0;white-space:pre-wrap;font-size:20px;line-height:1.65}
    .shape-element{filter:drop-shadow(0 12px 30px rgba(0,0,0,.24))}
    .narration{position:absolute;z-index:6;left:110px;right:110px;bottom:74px;min-height:76px;display:flex;align-items:center;padding:17px 24px;border-left:4px solid var(--accent);border-radius:0 16px 16px 0;background:linear-gradient(90deg,rgba(4,13,25,.90),rgba(4,13,25,.55));color:#dce9f8;font-size:22px;line-height:1.55;box-shadow:0 16px 45px #0005}
    .progress-track{position:absolute;z-index:8;left:0;right:0;bottom:0;height:7px;background:rgba(255,255,255,.06)}
    .progress-fill{height:100%;width:0;background:linear-gradient(90deg,var(--accent),#d9faff);box-shadow:0 0 18px var(--accent)}
  </style>
</head>
<body>
  <div class="viewport"><div class="stage">${scenes}<div class="progress-track"><div class="progress-fill"></div></div></div></div>
  <script>
    const config=${safeConfig};let currentTime=0;let lastNow=performance.now();let playing=true;
    const scenes=[...document.querySelectorAll('.scene')];const totalMs=config.scenes.reduce((sum,s)=>sum+s.duration*1000,0);
    function clamp(v,min,max){return Math.max(min,Math.min(max,v))}
    function resize(){const stage=document.querySelector('.stage');const scale=Math.min(innerWidth/config.width,innerHeight/config.height);stage.style.transform='translate(-50%,-50%) scale('+scale+')'}
    function elementState(el,localSeconds){const delay=Number(el.dataset.delay||0);const duration=Math.max(.1,Number(el.dataset.duration||.6));const p=clamp((localSeconds-delay)/duration,0,1);const eased=1-Math.pow(1-p,3);const type=el.dataset.animation||'fadeIn';let transform='none';el.style.clipPath='none';if(type==='slideIn')transform='translate3d('+(-90*(1-eased))+'px,0,0)';if(type==='scale')transform='scale('+(0.78+0.22*eased)+')';if(type==='bounce')transform='translateY('+(-22*Math.sin(p*Math.PI))+'px)';if(type==='float')transform='translate3d(0,'+(-16*eased+5*Math.sin(localSeconds*1.8))+'px,0)';if(type==='draw')transform='scaleX('+eased+')';if(type==='reveal')el.style.clipPath='inset(0 '+((1-eased)*100)+'% 0 0 round 16px)';el.style.opacity=String(eased);el.style.transform=transform}
    function showFrameAt(timeMs){let start=0;let activeIndex=config.scenes.length-1;for(let i=0;i<config.scenes.length;i++){const end=start+config.scenes[i].duration*1000;if(timeMs>=start&&timeMs<end){activeIndex=i;break}start=end}scenes.forEach((scene,index)=>scene.classList.toggle('active',index===activeIndex));const sceneStart=config.scenes.slice(0,activeIndex).reduce((sum,s)=>sum+s.duration*1000,0);const local=Math.max(0,(timeMs-sceneStart)/1000);const duration=config.scenes[activeIndex].duration;const sceneP=clamp(local/duration,0,1);const active=scenes[activeIndex];if(active){const fadeIn=clamp(local/.5,0,1);const fadeOut=clamp((duration-local)/.45,0,1);active.style.opacity=String(Math.min(fadeIn,fadeOut));active.querySelectorAll('.element,.scene-header,.narration').forEach(el=>elementState(el,local));const layer=active.querySelector('.content-layer');if(layer)layer.style.transform='translate3d(0,'+(-10*sceneP)+'px,0) scale('+(1+.018*sceneP)+')';const ambient=active.querySelector('.ambient');if(ambient)ambient.style.transform='translate3d('+(18*Math.sin(sceneP*Math.PI))+'px,'+(-14*sceneP)+'px,0) rotate('+(3*sceneP)+'deg)';const scan=active.querySelector('.scanline');if(scan)scan.style.transform='translateY('+(config.height*sceneP)+'px)'}document.querySelector('.progress-fill').style.width=(clamp(timeMs/totalMs,0,1)*100)+'%'}
    window.__hyperframesSeek=(seconds)=>{playing=false;currentTime=clamp(seconds*1000,0,totalMs);showFrameAt(currentTime)};
    function render(now){if(playing){const delta=Math.min(50,now-lastNow);currentTime=(currentTime+delta)%totalMs;showFrameAt(currentTime)}lastNow=now;requestAnimationFrame(render)}
    addEventListener('resize',resize);resize();showFrameAt(0);requestAnimationFrame(render);
  </script>
</body></html>`;
  }

  private buildSceneHTML(scene: HyperFramesScene, index: number, total: number): string {
    const accent = safeColor(scene.accentColor, '#55d9ff');
    const background = safeBackground(scene.backgroundColor);
    const elements = scene.elements.map((element) => this.buildElementHTML(element)).join('\n');
    return `<section class="scene ${index === 0 ? 'active' : ''}" data-scene="${index}" style="--accent:${accent};background:${background}">
      <div class="ambient"><span class="orb orb-a"></span><span class="orb orb-b"></span><span class="beam"></span></div><div class="scanline"></div>
      <div class="brand"><span class="brand-mark"></span>AXIOM · LEARNING</div><div class="scene-index">${String(index + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}</div>
      <header class="scene-header" data-animation="slideIn" data-duration=".7" data-delay=".05"><div class="eyebrow">${escapeHtml(scene.eyebrow || `STEP ${String(index + 1).padStart(2, '0')}`)}</div><h1 class="scene-title">${escapeHtml(scene.title || `核心概念 ${index + 1}`)}</h1>${scene.subtitle ? `<div class="scene-subtitle">${escapeHtml(scene.subtitle)}</div>` : ''}</header>
      <div class="content-layer">${elements}</div>
      ${scene.narration ? `<div class="narration" data-animation="fadeIn" data-duration=".7" data-delay=".35">${escapeHtml(scene.narration)}</div>` : ''}
    </section>`;
  }

  private buildElementHTML(element: HyperFramesElement): string {
    const style = [`left:${num(element.x)}px`, `top:${num(element.y)}px`, element.width ? `width:${num(element.width)}px` : '', element.height ? `height:${num(element.height)}px` : ''].filter(Boolean).join(';');
    const animation = element.animation || { type: 'fadeIn' as const, duration: .6, delay: .15 };
    const data = `data-animation="${animation.type}" data-duration="${num(animation.duration)}" data-delay="${num(animation.delay || 0)}" data-element-type="${element.type}"`;
    if (element.type === 'text') {
      return `<div class="element text-element" data-role="${element.role || 'body'}" ${data} style="${style};font-size:${num(element.fontSize || 25)}px;color:${safeColor(element.color, '#eaf4ff')};font-weight:${element.fontWeight === 'bold' ? 700 : 450};text-align:${element.align || 'left'}">${escapeHtml(element.content || '')}</div>`;
    }
    if (element.type === 'code') {
      return `<div class="element code-element" ${data} style="${style}"><div class="code-head"><span class="code-dots">● ● ●</span><span>${escapeHtml(element.language || 'code')}</span></div><pre><code>${escapeHtml(element.code || '')}</code></pre></div>`;
    }
    if (element.type === 'shape') {
      const fill = safeColor(element.fillColor, 'rgba(85,217,255,.10)');
      const stroke = safeColor(element.strokeColor, '#55d9ff');
      const radius = element.shape === 'circle' ? '50%' : element.shape === 'line' ? '999px' : '18px';
      return `<div class="element shape-element" ${data} style="${style};background:${fill};border:2px solid ${stroke};border-radius:${radius}"></div>`;
    }
    return '';
  }
}

export function normalizeHyperFramesConfig(config: HyperFramesConfig): HyperFramesConfig {
  const width = clampNumber(config.width || 1920, 960, 2560);
  const height = clampNumber(config.height || 1080, 540, 1440);
  const scenes = (config.scenes || []).map((raw, index) => {
    const textElements = (raw.elements || []).filter((element) => element.type === 'text' && element.content?.trim());
    const first = textElements[0]?.content?.trim();
    const second = textElements[1]?.content?.trim();
    const title = raw.title?.trim() || first || `核心概念 ${index + 1}`;
    const subtitle = raw.subtitle?.trim() || (second && second !== title ? second : undefined);
    const reservedTop = Math.round(height * .34);
    const reservedBottom = raw.narration ? Math.round(height * .13) : 54;
    const shouldPromoteText = (raw.elements || []).length > 2;
    const elements = (raw.elements || []).filter((element) => {
      if (!shouldPromoteText) return true;
      if (element.type !== 'text') return true;
      const content = element.content?.trim();
      return content !== title && content !== subtitle;
    }).map((element, elementIndex) => normalizeElement(element, elementIndex, width, height, reservedTop, reservedBottom));
    return {
      ...raw,
      id: raw.id || `scene-${index + 1}`,
      duration: clampNumber(raw.duration || 6, 3, 20),
      title,
      subtitle,
      narration: raw.narration?.trim() || subtitle || `这一幕说明“${title}”的关键关系。`,
      accentColor: safeColor(raw.accentColor, ['#55d9ff', '#8b7cff', '#45e0a8', '#ffbd59'][index % 4]),
      elements,
    };
  });
  return { ...config, width, height, fps: clampNumber(config.fps || 24, 12, 30), scenes };
}

function normalizeElement(element: HyperFramesElement, index: number, width: number, height: number, top: number, bottom: number): HyperFramesElement {
  const availableHeight = Math.max(180, height - top - bottom);
  const fallbackWidth = element.type === 'code' ? width * .68 : width * .36;
  const fallbackHeight = element.type === 'code' ? availableHeight * .7 : Math.min(160, availableHeight * .32);
  const column = index % 2;
  const row = Math.floor(index / 2);
  return {
    ...element,
    x: clampNumber(Number.isFinite(element.x) ? element.x : 110 + column * width * .44, 50, width - 180),
    y: clampNumber(Number.isFinite(element.y) ? element.y : top + row * 190, top, height - bottom - 80),
    width: clampNumber(element.width || fallbackWidth, 160, width - 120),
    height: clampNumber(element.height || fallbackHeight, 40, availableHeight),
    animation: element.animation || {
      type: element.type === 'code' ? 'reveal' : element.type === 'shape' ? (element.shape === 'line' ? 'draw' : 'scale') : index % 2 ? 'float' : 'slideIn',
      duration: element.type === 'code' ? .95 : .7,
      delay: .18 + index * .14,
    },
  };
}

function escapeHtml(value: string): string { return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function num(value: number): number { return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0; }
function clampNumber(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }
function safeColor(value: string | undefined, fallback: string): string { return value && /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|[a-z]+)$/i.test(value.trim()) ? value.trim() : fallback; }
function safeBackground(value?: string): string { const color = safeColor(value, '#07111f'); return `radial-gradient(circle at 78% 16%,color-mix(in srgb,${color} 70%,#264b78) 0,transparent 42%),linear-gradient(145deg,${color},#040a13 82%)`; }

export class HyperFramesGenerator {
  private builder = new HyperFramesHTMLBuilder();
  buildVideoHTML(config: HyperFramesConfig): string { return this.builder.buildHTML(config); }
}

export const hyperframesGenerator = new HyperFramesGenerator();
export const hyperframesHTMLBuilder = new HyperFramesHTMLBuilder();
