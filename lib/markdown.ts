/**
 * Markdown 渲染工具
 * 使用 marked + highlight.js + mermaid 进行完整渲染
 */

import { Marked } from 'marked';
import type { Tokens } from 'marked';
import hljs from 'highlight.js/lib/core';

// 注册常用语言（按需加载，减小体积）
import hljsJavascript from 'highlight.js/lib/languages/javascript';
import hljsTypescript from 'highlight.js/lib/languages/typescript';
import hljsPython from 'highlight.js/lib/languages/python';
import hljsJava from 'highlight.js/lib/languages/java';
import hljsCpp from 'highlight.js/lib/languages/cpp';
import hljsBash from 'highlight.js/lib/languages/bash';
import hljsJson from 'highlight.js/lib/languages/json';
import hljsYaml from 'highlight.js/lib/languages/yaml';
import hljsHtml from 'highlight.js/lib/languages/xml';
import hljsCss from 'highlight.js/lib/languages/css';
import hljsSql from 'highlight.js/lib/languages/sql';
import hljsGo from 'highlight.js/lib/languages/go';
import hljsMarkdown from 'highlight.js/lib/languages/markdown';

hljs.registerLanguage('javascript', hljsJavascript);
hljs.registerLanguage('js', hljsJavascript);
hljs.registerLanguage('typescript', hljsTypescript);
hljs.registerLanguage('ts', hljsTypescript);
hljs.registerLanguage('python', hljsPython);
hljs.registerLanguage('py', hljsPython);
hljs.registerLanguage('java', hljsJava);
hljs.registerLanguage('cpp', hljsCpp);
hljs.registerLanguage('c', hljsCpp);
hljs.registerLanguage('bash', hljsBash);
hljs.registerLanguage('sh', hljsBash);
hljs.registerLanguage('shell', hljsBash);
hljs.registerLanguage('json', hljsJson);
hljs.registerLanguage('yaml', hljsYaml);
hljs.registerLanguage('yml', hljsYaml);
hljs.registerLanguage('html', hljsHtml);
hljs.registerLanguage('xml', hljsHtml);
hljs.registerLanguage('css', hljsCss);
hljs.registerLanguage('sql', hljsSql);
hljs.registerLanguage('go', hljsGo);
hljs.registerLanguage('markdown', hljsMarkdown);
hljs.registerLanguage('md', hljsMarkdown);

interface MermaidModule {
  render: (id: string, text: string) => Promise<{ svg: string }>;
  initialize: (config: Record<string, unknown>) => void;
}

// Mermaid 懒加载单例
let mermaidModule: MermaidModule | null = null;
let mermaidInitPromise: Promise<void> | null = null;
let mermaidRenderSequence = 0;

async function getMermaid(): Promise<MermaidModule> {
  if (mermaidModule) return mermaidModule;
  if (mermaidInitPromise) {
    await mermaidInitPromise;
    return mermaidModule!;
  }
  mermaidInitPromise = (async () => {
    const m = await import('mermaid');
    mermaidModule = (m.default || m) as MermaidModule;
    mermaidModule.initialize({
      startOnLoad: false,
      theme: 'dark',
      themeVariables: {
        primaryColor: '#d0b070',
        primaryTextColor: '#e0e0e0',
        primaryBorderColor: '#3a3a40',
        lineColor: '#555',
        secondaryColor: '#1a1a1e',
        tertiaryColor: '#121214',
        fontFamily: 'Inter, sans-serif',
        fontSize: '13px',
      },
    });
  })();
  try {
    await mermaidInitPromise;
  } catch (error) {
    mermaidInitPromise = null;
    mermaidModule = null;
    throw error;
  }
  return mermaidModule!;
}

// Mermaid ID must be deterministic across SSR and client hydration.
// A module-level counter causes React hydration mismatches because the server
// and browser can parse markdown in different orders.
function stableMermaidId(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `mermaid-${(hash >>> 0).toString(36)}`;
}

// 创建 Marked 实例，配置自定义渲染
const markedInstance = new Marked();

markedInstance.use({
  renderer: {
    code({ text, lang }: { text: string; lang?: string }): string {
      const language = lang || '';

      // Mermaid 图表：输出占位 div，后续异步渲染
      if (language === 'mermaid') {
        const id = stableMermaidId(text);
        const escaped = text
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
        return `<div class="mermaid-container" data-mermaid-id="${id}" data-mermaid-src="${encodeURIComponent(text)}"><pre class="mermaid-src">${escaped}</pre></div>`;
      }

      // 代码高亮
      let highlighted: string;
      try {
        if (language && hljs.getLanguage(language)) {
          highlighted = hljs.highlight(text, { language }).value;
        } else {
          // 无语言标记时不做自动检测（太慢），直接转义输出
          highlighted = text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
        }
      } catch {
        highlighted = text
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
      }

      const langLabel = language ? ` class="hljs language-${language}"` : ' class="hljs"';
      return `<pre><code${langLabel}>${highlighted}</code></pre>`;
    },

    table(token: Tokens.Table): string {
      return `<div class="md-table-wrapper"><table><thead>${token.header}</thead><tbody>${(token as unknown as { body: string }).body}</tbody></table></div>`;
    },

    codespan({ text }: { text: string }): string {
      return `<code class="inline-code">${text}</code>`;
    },

    paragraph({ text }: { text: string }): string {
      return `<p>${text}</p>`;
    },
  },
});

// wikilink 扩展：[[title]] → 可点击链接
const wikilinkExtension = {
  name: 'wikilink',
  level: 'inline' as const,
  start(src: string) {
    return src.indexOf('[[');
  },
  tokenizer(src: string) {
    const match = src.match(/^\[\[([^\]]+)\]\]/);
    if (match) {
      return {
        type: 'wikilink',
        raw: match[0],
        title: match[1],
      };
    }
  },
  renderer(token: { type: string; raw: string; title: string }) {
      const escapedTitle = token.title
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      return `<a href="#" class="md-link" data-title="${escapedTitle}">${escapedTitle}</a>`;
  },
};

markedInstance.use({ extensions: [wikilinkExtension] });

/**
 * 解析 Markdown 为 HTML
 * 保持与原有 parseMD 相同的签名
 */
export const parseMD = (text: string, _allTitles?: string[]): string => {
  if (!text) {
    return '<p style="color:var(--text-dim); font-style:italic;">Empty content...</p>';
  }

  try {
    const result = markedInstance.parse(text, { async: false });
    return typeof result === 'string' ? result : '';
  } catch (e) {
    // 降级：简单换行处理
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');
  }
};

/**
 * 异步渲染页面中所有 mermaid 占位 div
 * 在 React useEffect 中调用
 */
export async function renderMermaidBlocks(container: HTMLElement): Promise<void> {
  const mermaidDivs = container.querySelectorAll('.mermaid-container[data-mermaid-src]');
  if (mermaidDivs.length === 0) return;

  try {
    const mermaid = await getMermaid();

    for (const div of Array.from(mermaidDivs) as HTMLElement[]) {
      const src = decodeURIComponent(div.getAttribute('data-mermaid-src') || '');
      if (!src) continue;

      const baseId = div.getAttribute('data-mermaid-id') || stableMermaidId(src);
      const id = `${baseId}-${++mermaidRenderSequence}`;

      try {
        const { svg } = await mermaid.render(id, src);
        div.innerHTML = svg;
        div.removeAttribute('data-mermaid-src');
        div.removeAttribute('data-mermaid-id');
      } catch (renderErr) {
        // mermaid 渲染失败时保留源码显示
        console.warn('[Mermaid] render failed:', renderErr);
        div.innerHTML = `<pre class="mermaid-error" style="color:var(--color-error, #e55);font-size:12px;padding:8px;">Mermaid 渲染失败:\n${src}</pre>`;
      }
    }
  } catch (e) {
    console.warn('[Mermaid] module load failed:', e);
    let shouldRetry = false;
    for (const div of Array.from(mermaidDivs) as HTMLElement[]) {
      const retries = Number(div.dataset.mermaidRetries || '0');
      if (retries < 2) {
        div.dataset.mermaidRetries = String(retries + 1);
        shouldRetry = true;
      }
      div.innerHTML = '<div class="mermaid-error">图表组件加载失败，正在等待重试。</div>';
      div.setAttribute('data-mermaid-src', div.getAttribute('data-mermaid-src') || '');
    }
    if (shouldRetry && container.isConnected) {
      window.setTimeout(() => { void renderMermaidBlocks(container); }, 800);
    }
  }
}
