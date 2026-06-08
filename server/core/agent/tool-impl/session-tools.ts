/**
 * AXIOM 内置工具 - 会话管理
 */

import { createAxiomCompat } from '@/server/infra/storage/AxiomCompat'
import { getFileStorage } from '@/server/infra/storage/GlobalFileStorage'
import { Type } from '@mariozechner/pi-ai';
const axiom = createAxiomCompat(getFileStorage());

import { createTool, toolRegistry } from "../tools";
import { getVaultPath, getSessionState, setSessionState, resolvePath } from "./helpers";
import { DEFAULT_MODEL, DEFAULT_COMPRESSION_MODEL } from "@/types/agent";

// In-memory cache replacing localStorage (browser API unavailable in Node.js)
const _toolCache = new Map<string, string>();

const switchModelTool = createTool(
  'switch_model',
  '切换模型',
  '切换到不同的 LLM 模型。可用的模型: ' + DEFAULT_MODEL + '（快速）, ' + DEFAULT_COMPRESSION_MODEL + '（精准）',
  Type.Object({
    modelId: Type.String({ description: '模型ID: ' + DEFAULT_MODEL + ', ' + DEFAULT_COMPRESSION_MODEL }),
  }),
  async (_id, params) => {
    const validModels = [DEFAULT_MODEL, DEFAULT_COMPRESSION_MODEL];
    if (!validModels.includes(params.modelId)) {
      return {
        content: [{ type: 'text', text: `不支持的模型: ${params.modelId}。可用模型: ${validModels.join(', ')}` }],
        details: { error: 'Invalid model ID' },
      };
    }
    // 持久化模型选择 (in-memory cache — localStorage unavailable in Node.js)
    _toolCache.set('axiom-model-id', params.modelId);
    return {
      content: [{ type: 'text', text: `模型已切换为 ${params.modelId}。下次对话生效。` }],
      details: { modelId: params.modelId, success: true },
    };
  }
);


const assessUnderstandingTool = createTool(
  'assess_understanding',
  '检测理解度',
  '对用户进行理解度检测。生成一道检测题（费曼解释/应用场景/关联分析/反例识别），评估用户是否真正理解了概念。',
  Type.Object({
    concept: Type.String({ description: '要检测的概念名称' }),
    method: Type.Union([
      Type.Literal('feynman', { description: '费曼检测：让用户用自己的话解释概念' }),
      Type.Literal('application', { description: '应用检测：给出场景让用户运用概念' }),
      Type.Literal('connection', { description: '关联检测：让用户说出该概念与其他概念的关系' }),
      Type.Literal('counterexample', { description: '反例检测：给出错误示例让用户识别并纠正' }),
    ], { description: '检测方法' }),
  }),
  async (_id, params) => {
    const prompts: Record<string, string> = {
      feynman: `请用自己的话解释"${params.concept}"这个概念。不要照搬定义，而是像给一个完全不懂的人讲解一样。`,
      application: `请给出一个"${params.concept}"在实际场景中的应用例子，并解释为什么这个概念在这里适用。`,
      connection: `"${params.concept}"和其他哪些概念有关系？请至少说出2个相关概念，并解释它们之间的联系。`,
      counterexample: `以下关于"${params.concept}"的说法中，哪个是错误的？请指出并纠正。\n\nA. (正确理解)\nB. (常见误解)\nC. (正确理解)\nD. (常见误解)`,
    };

    const question = prompts[params.method] || prompts.feynman;

    globalThis.dispatchEvent(new CustomEvent('axiom:ask-user', {
      detail: { question: `[检测] 理解度检测 — ${params.concept}\n\n${question}` },
    }));

    return {
      content: [{
        type: 'text',
        text: `已发起理解度检测: 概念="${params.concept}", 方法="${params.method}"\n\n检测题目已发送给用户，等待用户回复后由AI评估理解程度。`,
      }],
      details: { concept: params.concept, method: params.method, question },
    };
  }
);


const askUserTool = createTool(
  'ask_user',
  '询问用户',
  '向用户提出问题并等待回答。将问题发送到聊天界面供用户查看。',
  Type.Object({
    question: Type.String({ description: '要问用户的问题' }),
    options: Type.Optional(Type.Array(Type.String(), { description: '可选的选项列表' })),
  }),
  async (_id, params) => {
    // 通过 DOM 直接将问题注入到聊天界面
    const optionsText = params.options
      ? `\n\n可选选项:\n${params.options.map((o: string, i: number) => `${i + 1}. ${o}`).join('\n')}`
      : '';

    // 触发自定义事件通知 UI 显示问题
    globalThis.dispatchEvent(new CustomEvent('axiom:ask-user', {
      detail: {
        question: params.question,
        options: params.options,
      },
    }));

    return {
      content: [{
        type: 'text',
        text: `已向用户提问: "${params.question}"${optionsText}\n\n等待用户回复后继续。当前回合已结束，用户下次输入后将继续对话。`
      }],
      details: { question: params.question, options: params.options, asked: true },
    };
  }
);


const updateStateTool = createTool(
  'update_state',
  '更新状态',
  '更新当前会话的状态（如当前 Phase、学习进度等）。状态会持久化到 localStorage。',
  Type.Object({
    key: Type.String({ description: '状态键名' }),
    value: Type.String({ description: '状态值' }),
  }),
  async (_id, params) => {
    setSessionState(params.key, params.value);

    // 触发状态更新事件
    globalThis.dispatchEvent(new CustomEvent('axiom:state-updated', {
      detail: { key: params.key, value: params.value },
    }));

    return {
      content: [{ type: 'text', text: `状态已更新: ${params.key} = ${params.value}` }],
      details: { key: params.key, value: params.value, persisted: true },
    };
  }
);


const refreshVaultTool = createTool(
  'refresh_vault',
  '刷新 Vault',
  '重新加载当前 Vault 的所有数据，包括文献、灵感和永久卡片。在创建或修改文件后调用此工具来更新界面。',
  Type.Object({}),
  async (_id, params) => {
    try {
      const vaultPath = getVaultPath();
      if (!vaultPath) {
        return {
          content: [{ type: 'text', text: '错误: 未打开 Vault' }],
          details: { error: 'No vault open' },
        };
      }

      // 调用 openVault 重新加载数据
      const result = await axiom.loadFleeing?.(vaultPath);

      if (result?.success && result?.data) {
        // 触发自定义事件通知前端更新
        globalThis.dispatchEvent(new CustomEvent('vault-data-updated', {
          detail: {
            literature: (result.data as any).literature || [],
            fleeing: (result.data as any).fleeing || [],
            permanent: (result.data as any).permanent || [],
          }
        }));

        return {
          content: [{ type: 'text', text: 'Vault 数据已刷新' }],
          details: {
            literature: ((result.data as any).literature || []).length,
            fleeing: ((result.data as any).fleeing || []).length,
            permanent: ((result.data as any).permanent || []).length,
          },
        };
      }

      return {
        content: [{ type: 'text', text: `刷新失败: ${result?.error || '未知错误'}` }],
        details: { error: result?.error },
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `错误: ${(error as Error).message}` }],
        details: { error: (error as Error).message },
      };
    }
  }
);


const sessionSearchTool = createTool(
  'session_search',
  '搜索历史对话',
  '在所有历史对话会话中搜索关键词，用于回忆过去的对话内容。当用户提到之前讨论过的话题时使用。',
  Type.Object({
    query: Type.String({ description: '搜索关键词' }),
    limit: Type.Optional(Type.Number({ description: '返回结果数量限制，默认 10' })),
  }),
  async (_id, params) => {
    try {
      const vaultPath = getVaultPath();
      if (!vaultPath) {
        return {
          content: [{ type: 'text', text: '错误: 未打开 Vault' }],
          details: { error: 'No vault open' },
        };
      }

      const { searchSessions } = await import('../SessionSearch');
      const results = await searchSessions(vaultPath, params.query, params.limit || 10);

      if (results.length === 0) {
        return {
          content: [{ type: 'text', text: `未找到包含 "${params.query}" 的历史对话` }],
          details: { query: params.query, count: 0 },
        };
      }

      const summary = results
        .map((r, i) => `${i + 1}. [${r.sessionName}] (${r.role}) ${r.snippet}`)
        .join('\n');

      return {
        content: [{ type: 'text', text: `找到 ${results.length} 条匹配:\n${summary}` }],
        details: { query: params.query, results, count: results.length },
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `搜索失败: ${(error as Error).message}` }],
        details: { error: (error as Error).message },
      };
    }
  }
);


const feynmanTestTool = createTool(
  'feynman_test',
  '费曼理解测试',
  '对指定概念进行费曼理解度测试。'
  + '向用户提问"请用自己的话解释{概念}"，收集回答后在3个固定维度（定义、关联、例子）上评分1-5，'
  + 'AI可自由扩展维度。测试结果持久化到卡片 frontmatter 中。',
  Type.Object({
    concept: Type.String({ description: '要测试的概念名称。必须是卡片标题或已存在的概念名。' }),
    cardPath: Type.Optional(Type.String({ description: '卡片文件路径（可选）。如果提供，测试结果会直接写入卡片 frontmatter。' })),
    userResponse: Type.Optional(Type.String({ description: '用户的回答内容。第一次调用时不传，工具会先提问。第二次调用时传入用户回答进行评分。' })),
  }),
  async (_id, params) => {
    try {
      // MODE 1: No userResponse — Ask the Feynman question first
      if (!params.userResponse) {
        globalThis.dispatchEvent(new CustomEvent('axiom:ask-user', {
          detail: {
            question: `\u{1f9e0} 费曼测试: ${params.concept}\n\n请用自己的话解释"${params.concept}"这个概念，就像给一个完全不懂的人讲解一样。\n\n注意：\n1. 不要背诵定义，用你自己的语言\n2. 可以举例说明\n3. 可以说说它和其他概念的关系`,
          },
        }));

        return {
          content: [{ type: 'text', text: `已发起费曼测试: "${params.concept}"\n\n测试题目已发送给用户，等待用户回复后评估理解程度。用户回复后，可以使用 feynman_test 并传入 userResponse 参数继续评估。` }],
          details: { concept: params.concept, cardPath: params.cardPath, step: 'awaiting', awaitingUserResponse: true },
        };
      }

      // MODE 2: userResponse provided — Evaluate the user's explanation
      const { aiManager } = await import('../../ai/AIManager');

      const evaluationSystemPrompt = `你是概念理解评估专家。用户正在尝试用自己的话解释一个概念（费曼学习法）。

请从以下维度评估用户的解释质量，每个维度给出1-5分：

1. definition（定义）：用户是否准确捕捉了概念的核心含义？是否清晰无混淆？
   - 1: 完全错误或无关
   - 2: 部分正确但有重要偏差
   - 3: 基本正确，核心含义到位
   - 4: 准确且清晰，有深度
   - 5: 精准、深刻、有洞察力

2. association（关联）：用户是否将该概念连接到了相关概念或知识体系？
   - 1: 没有提及任何关联
   - 2: 提及了关联但不准确
   - 3: 有至少一个正确的关联
   - 4: 多个正确关联，展示了知识网络
   - 5: 丰富的关联网络，展示了系统性理解

3. examples（例子）：用户是否提供了具体的例子来说明概念？
   - 1: 没有例子
   - 2: 例子不恰当或模糊
   - 3: 至少一个具体、恰当的例子
   - 4: 多个好例子，覆盖不同场景
   - 5: 创造性例子，展示深度应用

你可以根据概念所属领域自由添加扩展维度（如数学概念的 mathematical_rigor, 编程概念的 code_accuracy 等）。

以JSON格式返回（严格JSON，不要 \`\`\`json 包裹，不要任何其他文字）：
{
  "scores": {
    "definition": 4,
    "association": 3,
    "examples": 5
  },
  "extensions": {
    "mathematical_rigor": 4
  },
  "pass": true,
  "feedback": "你对{概念}的定义理解得很好...但可以多谈谈它与其他概念的关系。"
}

注意：pass = true 仅当所有固定维度（definition, association, examples）都 >= 3。

内部推理即可，不要输出思考过程。直接返回 JSON 结果。`;

      const evaluationResult = await aiManager.callAPI(
        evaluationSystemPrompt,
        [{ role: 'user', content: `概念: ${params.concept}\n\n用户的解释:\n${params.userResponse}\n\n## ⚠️ 强制输出语言：中文\n所有内容必须用中文输出。专有名词保留原文。` }],
      );

      // Parse JSON response from LLM
      let scores: Record<string, number> = {};
      let extensions: Record<string, number> = {};
      let pass = false;
      let feedback = '';

      try {
        // Strip markdown code fences if present
        let cleaned = evaluationResult.replace(/```(?:json)?\s*/g, '').replace(/\s*```/g, '');
        const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          scores = parsed.scores || {};
          extensions = parsed.extensions || {};
          pass = parsed.pass === true;
          feedback = parsed.feedback || '';
        } else {
          throw new Error('No JSON object found in LLM response');
        }
      } catch (parseError) {
        return {
          content: [{ type: 'text', text: `评估解析失败: ${(parseError as Error).message}\n\n原始返回:\n${evaluationResult}` }],
          details: { concept: params.concept, error: 'LLM JSON parse failed', rawOutput: evaluationResult },
        };
      }

      // Build quality_check entry
      const now = new Date();
      const qualityEntry: Record<string, any> = {
        timestamp: now.toISOString(),
        scores,
        pass,
        feedback,
        extensions,
      };

      // Resolve card path: if not provided, search by concept title in fleeing cards
      let targetCardPath = params.cardPath;

      if (!targetCardPath) {
        try {
          const vaultPath = getVaultPath();
          if (vaultPath) {
            const fleeingResult = await axiom.loadFleeing?.(vaultPath);
            if (fleeingResult?.success && fleeingResult.data) {
              const foundCard = fleeingResult.data.find(
                (card: any) => card.title === params.concept || card.title?.includes(params.concept)
              );
              if (foundCard?.cardPath) {
                targetCardPath = foundCard.cardPath;
              }
            }
          }
        } catch (searchError) {
          console.warn('[feynman_test] Card search failed, quality_check not persisted:', searchError);
        }
      }

      // Persist quality_check to card frontmatter if we have a card path
      let qualityChecks: Array<Record<string, any>> = [];
      let bodyContent = '';
      let nextReview: string | null = null;

      if (targetCardPath) {
        try {
          const vaultPath = getVaultPath();
          if (!vaultPath) {
            throw new Error('No vault path available');
          }

          const fullPath = resolvePath(targetCardPath);

          const readResult = await getFileStorage().readFile(fullPath);

          if (readResult?.success && readResult.content) {
            const fileContent = readResult.content;

            // Parse YAML frontmatter and body content
            const frontmatterMatch = fileContent.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
            let frontmatter: Record<string, any> = {};

            if (frontmatterMatch) {
              const yaml = await import('js-yaml');
              const parsed = yaml.load(frontmatterMatch[1]);
              if (parsed && typeof parsed === 'object') {
                frontmatter = parsed as Record<string, any>;
              }
              bodyContent = frontmatterMatch[2];
            } else {
              // No frontmatter — treat entire content as body
              bodyContent = fileContent;
            }

            // Get existing quality_checks (append, never replace per T-04-03-03)
            qualityChecks = Array.isArray(frontmatter.quality_check) ? frontmatter.quality_check : [];
            qualityChecks.push(qualityEntry);

            // Count passing entries (including current) for spaced repetition interval
            const passCount = qualityChecks.filter((q: any) => q.pass === true).length;

            // Calculate next_review interval per D-12 schedule
            let intervalDays: number;
            if (!pass) {
              intervalDays = 1; // Failed: retry next day
            } else if (passCount <= 1) {
              intervalDays = 1;
            } else if (passCount === 2) {
              intervalDays = 3;
            } else if (passCount === 3) {
              intervalDays = 7;
            } else {
              intervalDays = 30;
            }

            const nextReviewDate = new Date(now.getTime() + intervalDays * 24 * 60 * 60 * 1000);
            nextReview = nextReviewDate.toISOString();

            // Update frontmatter
            frontmatter.quality_check = qualityChecks;
            frontmatter.next_review = nextReview;

            // Write back with updated frontmatter (preserve body content exactly)
            const yaml = await import('js-yaml');
            const newFrontmatterYaml = yaml.dump(frontmatter, { lineWidth: -1, quotingType: '"' });
            const newContent = `---\n${newFrontmatterYaml}---\n${bodyContent}`;

            const writeResult = await getFileStorage().writeFile(fullPath, newContent);

            if (writeResult?.success !== false) {
              // Dispatch UI update event
              globalThis.dispatchEvent(new CustomEvent('axiom:card-quality-updated', {
                detail: { cardPath: targetCardPath, qualityEntry },
              }));
            }
          } else {
            console.warn(`[feynman_test] Card file not found at: ${fullPath}`);
          }
        } catch (fsError) {
          console.warn('[feynman_test] Failed to persist quality_check to card:', fsError);
        }
      }

      // Build score summary for response
      const scoreSummary = Object.entries(scores)
        .map(([dim, score]) => `${dim}: ${score}/5`)
        .join(', ');

      const extensionSummary = Object.keys(extensions).length > 0
        ? '\n扩展维度: ' + Object.entries(extensions).map(([dim, score]) => `${dim}: ${score}/5`).join(', ')
        : '';

      const nextReviewText = nextReview
        ? `\n下次复习: ${new Date(nextReview).toLocaleDateString('zh-CN')}`
        : '';

      const historyText = qualityChecks.length > 0
        ? `\n已记录 ${qualityChecks.length} 次质量检测。`
        : '';

      return {
        content: [{
          type: 'text',
          text: `## 费曼测试结果: "${params.concept}"\n\n**结果: ${pass ? '通过' : '未通过'}**\n\n### 维度评分\n${scoreSummary}${extensionSummary}\n\n### 反馈\n${feedback}${nextReviewText}${historyText}`,
        }],
        details: {
          concept: params.concept,
          scores,
          extensions,
          pass,
          feedback,
          qualityCheckCount: qualityChecks.length,
          nextReview,
          cardPath: targetCardPath,
          step: 'completed',
        },
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `费曼测试执行失败: ${(error as Error).message}` }],
        details: { error: (error as Error).message },
      };
    }
  }
);


export function registerSessionTools(): void {
  toolRegistry.register(switchModelTool);
  toolRegistry.register(assessUnderstandingTool);
  toolRegistry.register(askUserTool);
  toolRegistry.register(updateStateTool);
  toolRegistry.register(refreshVaultTool);
  toolRegistry.register(sessionSearchTool);
  toolRegistry.register(feynmanTestTool);
}
