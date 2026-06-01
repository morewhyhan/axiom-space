import {
  ResourceGenerationState,
  RESOURCE_TYPES,
  RESOURCE_FILE_MAP,
  type ResourceType,
} from './ResourceGenerationState';
import { HyperFramesHTMLBuilder } from '../ai/hyperframes/generator';
import type { HyperFramesConfig } from '../ai/hyperframes/generator';

export interface OrchestratorDeps {
  callLLM: (systemPrompt: string, userMessage: string) => Promise<string>;
  resourceExists: (type: ResourceType, literatureTitle: string) => Promise<boolean>;
  saveResource: (type: ResourceType, literatureTitle: string, content: string) => Promise<void>;
}

export interface GenerationResult {
  type: ResourceType;
  status: 'completed' | 'failed' | 'skipped';
  error?: string;
}

// ── Per-type generation prompts ──────────────────────────────────

const RESOURCE_PROMPTS: Record<ResourceType, string> = {
  document: `你是 AXIOM 课程文档生成专家。请根据以下内容生成一份结构化的学习文档。

要求：
1. 总字数不少于 800 字，内容具体、有实质性信息，不要说"此处略"、"待补充"
2. 严格包含以下章节：
   ## 概述（用 4-6 句话引入主题，说明为什么值得学、解决什么问题）
   ## 核心概念（每个概念一节，包含：定义和原理、一个具体例子、与其他概念的关系）
   ## 进阶理解（常见误区 2-3 个、深层原理、实际应用场景）
   ## 总结（6-8 条关键要点，每条一句话，可直接用于复习）
3. 根据用户水平调整深度：入门→多举生活例子少术语，中级→原理推导+实践场景，进阶→深层机制+前沿发展
4. 格式：Markdown，代码用 \` 包裹，强调用 **粗体**
5. 输出纯文档内容，不要加"以下是生成的内容"之类的前言`,

  mindmap: `你是 AXIOM 思维导图生成专家。请根据以下内容生成一张 Mermaid mindmap。

要求：
1. 使用 Mermaid mindmap 语法，根节点为 ((学习主题))
2. 至少 4 个一级分支，每分支至少 3 个叶子节点
3. 分支结构要体现概念的层级关系 —— 从概括到具体、从理论到应用
4. 叶子节点用方括号 [具体知识点] 或圆括号 (应用场景)
5. 输出纯 Mermaid mindmap 代码块，以 \`\`\`mermaid 开头，不要加解释文字

格式参考：
\`\`\`mermaid
mindmap
  root((主题))
    分支A
      [子概念1]
      [子概念2]
      [子概念3]
    分支B
      [子概念4]
      [子概念5]
\`\`\``,

  quiz: `你是 AXIOM 练习题库生成专家。请根据以下内容生成一套练习题。

要求：
1. 至少 5 道题，覆盖基础概念理解（3 题）+ 进阶应用分析（2 题）
2. 题型分布：选择题 3+ 道 + 简答题 2+ 道
3. 输出严格 JSON 数组格式，不要加任何其他文字（不要 markdown 代码块包裹，直接输出 [ 开头）
4. 每题包含以下字段：
   - type: "choice" | "fill" | "short"（对应选择/填空/简答）
   - question: 题目文字
   - options: 4 个选项（仅 choice 类型需要，格式 ["A. ...", "B. ...", "C. ...", "D. ..."]）
   - answer: 正确答案
   - explanation: 解释为什么这个答案正确（1-2 句，帮助理解而非只是判对错）
5. 选择题干扰项要有迷惑性——用最常见的错误理解作为干扰项
6. 根据用户水平：入门→基础概念记忆+理解，中级→概念应用+分析，进阶→综合推理+评价

输出格式：
[
  {
    "type": "choice",
    "question": "以下关于X的描述，正确的是？",
    "options": ["A. ...", "B. ...", "C. ...", "D. ..."],
    "answer": "B",
    "explanation": "选项B正确，因为..."
  },
  {
    "type": "short",
    "question": "请简述X和Y的区别。",
    "answer": "X是...而Y是...，关键在于...",
    "explanation": "区分这两个概念的要点是..."
  }
]`,
  video: `你是 AXIOM 教学视频脚本生成专家。请根据以下学习主题，生成一个教学动画视频的场景配置。

要求：
1. 生成 4-6 个场景，每个场景有明确的 id、duration（秒）、backgroundColor
2. 每个场景包含 2-5 个元素（element），类型为 text/code/shape
3. 场景设计要体现教学节奏：开场(intro) → 核心讲解(content) x1-3 → 示例演示(example) → 总结(conclusion)
4. 元素位置 (x, y) 合理布局，文字内容简洁有力
5. 为关键元素添加动画（fadeIn/slideIn/bounce/scale），duration 0.5-1.5s
6. 根据用户水平调整：入门→多生活类比+慢节奏(每场景8-12s)，中级→原理推导+正常节奏(5-8s)，进阶→深层机制+快节奏(3-5s)
7. 总时长控制在 30-90 秒

以严格 JSON 格式返回（不要 JSON 包裹，不要任何其他文字）：
{
  "scenes": [
    {
      "id": "intro",
      "duration": 6,
      "backgroundColor": "#f0f4f8",
      "elements": [
        {
          "type": "text",
          "x": 100,
          "y": 100,
          "content": "学习主题名称",
          "fontSize": 48,
          "color": "#1a1a1a",
          "fontWeight": "bold",
          "animation": { "type": "fadeIn", "duration": 1 }
        },
        {
          "type": "shape",
          "x": 50,
          "y": 200,
          "width": 200,
          "height": 4,
          "shape": "rect",
          "fillColor": "#0066cc",
          "animation": { "type": "slideIn", "duration": 1, "delay": 0.3 }
        }
      ]
    },
    {
      "id": "content-1",
      "duration": 10,
      "backgroundColor": "#ffffff",
      "elements": [
        {
          "type": "text",
          "x": 80,
          "y": 40,
          "content": "核心概念一",
          "fontSize": 32,
          "color": "#0066cc",
          "fontWeight": "bold",
          "animation": { "type": "fadeIn", "duration": 0.8 }
        }
      ]
    }
  ],
  "width": 1920,
  "height": 1080,
  "fps": 30
}`,
};

// ── Quality validation ───────────────────────────────────────────

function validateResource(type: ResourceType, content: string): string | null {
  if (!content || content.trim().length === 0) {
    return 'Empty content';
  }

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
          if (!arr[i].question || !arr[i].answer) {
            return `Question ${i + 1} missing question/answer`;
          }
        }
      } catch {
        return 'Quiz is not valid JSON';
      }
      break;
    }
    case 'video': {
      if (len < 200) return `Too short (${len} chars, min 200)`;
      try {
        const config = JSON.parse(text);
        if (!config.scenes || !Array.isArray(config.scenes)) return 'Missing scenes array';
        if (config.scenes.length < 3) return `Need at least 3 scenes, got ${config.scenes.length}`;
        for (let i = 0; i < config.scenes.length; i++) {
          const s = config.scenes[i];
          if (!s.id || typeof s.duration !== 'number') return `Scene ${i + 1}: missing id or duration`;
          if (!s.elements || !Array.isArray(s.elements) || s.elements.length === 0) return `Scene ${i + 1}: missing elements`;
        }
        if (!config.width || !config.height || !config.fps) return 'Missing width/height/fps';
      } catch {
        return 'Video config is not valid JSON';
      }
      break;
    }
  }
  return null; // valid
}

// ── Orchestrator ─────────────────────────────────────────────────

export class ResourceGenerationOrchestrator {
  private state: ResourceGenerationState;
  private deps: OrchestratorDeps;

  constructor(state: ResourceGenerationState, deps: OrchestratorDeps) {
    this.state = state;
    this.deps = deps;
  }

  /**
   * Generate resources one type at a time.
   * Each type gets its own LLM call with a dedicated prompt.
   * One type failing does not prevent others from being generated.
   */
  async orchestrate(
    topic: string,
    userLevel: string,
    literatureTitle: string,
    literatureContent?: string,
  ): Promise<GenerationResult[]> {
    const results: GenerationResult[] = [];
    const context = this.buildContext(topic, userLevel, literatureContent);

    for (const type of RESOURCE_TYPES) {
      this.state.startGenerating(type);

      try {
        const exists = await this.deps.resourceExists(type, literatureTitle);
        if (exists) {
          this.state.completeGenerating(type);
          results.push({ type, status: 'completed' });
          continue;
        }

        const prompt = RESOURCE_PROMPTS[type];
        let content = await this.deps.callLLM(prompt, context);
        let cleaned = this.cleanOutput(type, content);

        const validationError = validateResource(type, cleaned);
        if (validationError) {
          this.state.failGenerating(type, validationError);
          results.push({ type, status: 'failed', error: validationError });
          continue;
        }

        // For video: convert JSON config to self-contained HTML animation
        if (type === 'video') {
          const config = JSON.parse(cleaned) as HyperFramesConfig;
          const htmlBuilder = new HyperFramesHTMLBuilder();
          cleaned = htmlBuilder.buildHTML(config);
        }

        await this.deps.saveResource(type, literatureTitle, cleaned);
        this.state.completeGenerating(type);
        results.push({ type, status: 'completed' });
      } catch (error: any) {
        this.state.failGenerating(type, error.message || String(error));
        results.push({ type, status: 'failed', error: error.message || String(error) });
      }
    }

    return results;
  }

  private buildContext(topic: string, userLevel: string, literatureContent?: string): string {
    const parts = [
      `学习主题：${topic}`,
      `用户水平：${userLevel}`,
    ];
    if (literatureContent) {
      parts.push(`\n参考文献内容：\n${literatureContent.slice(0, 4000)}`);
    }
    return parts.join('\n');
  }

  /** Strip markdown code fences from LLM output */
  private cleanOutput(type: ResourceType, raw: string): string {
    let text = raw.trim();
    if (type === 'document') {
      text = text.replace(/^```(?:markdown|md)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    }
    if (type === 'mindmap') {
      const mermaidMatch = text.match(/```(?:mermaid)?\s*\n?([\s\S]*?)```/);
      if (mermaidMatch) text = mermaidMatch[1].trim();
    }
    if (type === 'quiz') {
      const jsonMatch = text.match(/(\[[\s\S]*\])/);
      if (jsonMatch) text = jsonMatch[1].trim();
    }
    if (type === 'video') {
      // Extract JSON config from LLM output
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) text = jsonMatch[0].trim();
    }
    return text.trim();
  }
}
