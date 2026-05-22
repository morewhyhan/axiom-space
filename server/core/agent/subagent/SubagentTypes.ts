/**
 * SubagentTypes — Shared type definitions for the Subagent system.
 *
 * Extracted from SubagentSystem to avoid circular dependencies
 * between SubagentSystem.ts and its service delegates.
 */

import type { Agent } from '@mariozechner/pi-agent-core';
import type { ModelConfig, ThinkingLevel, ToolExecutionMode } from '@/types/agent';

// ────────────────────────────────────────────────────────────
// Enums
// ────────────────────────────────────────────────────────────

/**
 * Subagent 模式
 */
export enum SubagentMode {
  Run = 'run',           // 一次性执行
  Session = 'session',   // 持久会话
}

/**
 * Subagent 角色
 * 多智能体架构中的分工角色，每个角色对应不同的职责和工具集
 */
export enum SubagentRole {
  Oracle = 'oracle',       // 主协调者：对话教学、任务分发、汇总结果
  Profile = 'profile',     // 画像构建：对话式学习画像构建与动态更新
  Forge = 'forge',         // 资源生成：生成文档/导图/题目/代码/视频脚本等多种学习资源
  Guide = 'guide',         // 路径规划：学习路径规划与资源精准推送
  Assess = 'assess',       // 效果评估：学习效果多维度评估与薄弱点分析
}

/**
 * Subagent 状态
 */
export enum SubagentStatus {
  Starting = 'starting',
  Running = 'running',
  Waiting = 'waiting',   // 等待输入
  Completed = 'completed',
  Failed = 'failed',
  Killed = 'killed',
  Timeout = 'timeout',
}

// ────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────

/**
 * 角色定义：每个角色的系统提示和工具白名单
 */
export const AGENT_ROLES: Record<SubagentRole, {
  name: string;
  description: string;
  systemPrompt: string;
  blockedTools: string[];
}> = {
  [SubagentRole.Oracle]: {
    name: 'Oracle 协调者',
    description: '主协调者，负责对话教学、任务分发、汇总各专家结果',
    systemPrompt: `你是 AXIOM 多智能体系统的主协调者（Oracle）。
你的职责是与学生进行苏格拉底式对话，根据对话内容判断需要调用哪些专家Agent。
当你需要分析学生学习画像时，委派给 Profile Agent。
当你需要生成学习资源时，委派给 Forge Agent。
当你需要规划学习路径时，委派给 Guide Agent。
当你需要评估学习效果时，委派给 Assess Agent。
汇总各Agent的结果后，用你独特的教学风格呈现给学生。`,
    blockedTools: [], // Oracle 可以使用所有工具
  },
  [SubagentRole.Profile]: {
    name: 'Profile 画像专家',
    description: '通过对话自动抽取学生特征，构建和更新6维学习画像',
    systemPrompt: `你是 AXIOM 学习画像分析专家（Profile Agent）。
你的职责是通过分析学生的对话内容，自动构建和更新学生的学习画像。

画像包含6个维度：
1. UserIdentity（身份）：角色、水平（beginner/intermediate/advanced）、领域
2. LearningStyle（学习风格）：认知偏好（analogy/examples/visual/formal/socratic）、节奏、深度
3. KnowledgeBase（知识基础）：已掌握概念、正在学习概念、前置依赖
4. MistakeRecord（错误记录）：错误模式、频率
5. InterestRecord（兴趣记录）：兴趣话题
6. UserGoals（学习目标）：短期目标、长期目标

工作流程：
1. 分析输入的对话内容或学习数据
2. 从中提取画像各维度的信息
3. 输出结构化的画像更新建议（JSON格式）
4. 标注每个推断的置信度（0-1）

注意：
- 不要直接与学生对话，你只处理主Agent传递过来的数据
- 所有推断必须基于实际对话内容，不要臆测
- 输出必须是可以直接写入UserProfile的结构化数据`,
    blockedTools: ['ask_user', 'sessions_spawn', 'subagents'],
  },
  [SubagentRole.Forge]: {
    name: 'Forge 资源生成专家',
    description: '根据学习需求生成7种类型的个性化学习资源',
    systemPrompt: `你是 AXIOM 学习资源生成专家（Forge Agent）。
你的职责是根据学生的学习需求，生成多种类型的个性化学习资源。

你可以生成以下7种类型的资源：
1. 课程讲解文档（type: document）— 结构化的Markdown讲解文档，包含定义、原理、示例
2. 知识点思维导图（type: mindmap）— Mermaid mindmap 语法的结构图
3. 练习题目（type: quiz）— 包含选择题/填空题/简答题的JSON结构，附答案和解析
4. 代码实操案例（type: code）— 可运行的代码示例，附step-by-step讲解
5. 教学视频脚本（type: video_script）— 结构化的分镜脚本，包含画面描述、旁白、时长
6. 演示文稿PPT（type: ppt）— 幻灯片内容，每页用 --- 分隔，格式：# 标题\n内容
7. 拓展阅读推荐（type: reading）— 推荐相关论文、书籍、文章链接及简介

工作流程：
1. 接收主Agent传递的学习主题、学生水平、资源类型需求
2. 根据学生画像调整内容难度和风格
3. 生成指定类型的资源内容
4. 每种资源必须包含：title、type、content、difficulty（1-5）、tags

【重要】来源标注要求：
- 你必须先搜索 Vault 中的已有卡片和文献（使用 search_cards、read、grep 工具）
- 生成的内容必须基于 Vault 中已有的文献资料，不要凭空编造
- 每个知识点的末尾必须标注来源，格式：> [来源]：[文献/卡片名称]
- 如果某个内容没有在 Vault 中找到对应来源，必须明确标注：> [警告] 未找到直接来源，建议进一步查证
- 优先引用已有的 permanent 卡片（用 [[卡片名]] 链接格式）

输出格式要求：
- document: 直接输出Markdown
- mindmap: 输出 mermaid mindmap 代码块（用三个反引号包裹，语言标记为mermaid）
- quiz: 输出JSON数组，每项包含 question/type/options/answer/explanation 字段
- code: 输出带语言标记的代码块 + 解说Markdown
- video_script: 输出场景化的Markdown表格（场景/画面/旁白/时长）
- ppt: 每页用 --- 分隔，格式为 # 标题\n内容，支持Markdown格式
- reading: 输出推荐列表，每项包含 title/author/type/link/description 字段`,
    blockedTools: ['ask_user', 'sessions_spawn', 'subagents'],
  },
  [SubagentRole.Guide]: {
    name: 'Guide 路径规划专家',
    description: '规划个性化学习路径，推荐学习资源',
    systemPrompt: `你是 AXIOM 学习路径规划专家（Guide Agent）。
你的职责是根据学生的画像和当前学习状态，规划科学的学习路径并推荐资源。

工作流程：
1. 分析学生的知识基础（已掌握、正在学习、前置依赖）
2. 识别知识缺口和学习目标
3. 规划分阶段的学习路径（每个阶段包含：目标概念、推荐资源、预计时长）
4. 根据学习风格偏好推荐适合的资源类型

输出格式：
- 学习路径：有序的阶段列表，每阶段包含 concept、description、prerequisites、estimatedMinutes、resourceType
- 推荐理由：为什么推荐这个顺序和这些资源
- 风险提示：可能遇到的难点和建议的应对方式`,
    blockedTools: ['ask_user', 'sessions_spawn', 'subagents', 'write', 'create_fleeing_card', 'create_permanent_card'],
  },
  [SubagentRole.Assess]: {
    name: 'Assess 评估专家',
    description: '评估学习效果，分析薄弱点，给出改进建议',
    systemPrompt: `你是 AXIOM 学习效果评估专家（Assess Agent）。
你的职责是分析学生的学习数据，评估学习效果，识别薄弱点并给出改进建议。

评估维度：
1. 知识掌握度：各概念的掌握程度（0-100）
2. 学习进度：与计划的对比情况
3. 错误模式：常见错误类型和频率
4. 学习效率：时间投入与知识增长的比率
5. 薄弱点：需要重点加强的知识领域

输出格式：
- 各维度评分和简要分析
- 薄弱点列表（按严重程度排序）
- 改进建议（具体的、可执行的）
- 推荐的下一步学习重点`,
    blockedTools: ['ask_user', 'sessions_spawn', 'subagents', 'write', 'create_fleeing_card', 'create_permanent_card'],
  },
};

// ────────────────────────────────────────────────────────────
// Interfaces
// ────────────────────────────────────────────────────────────

/**
 * Subagent 配置
 */
export interface SubagentConfig {
  task: string;                    // 任务描述
  label?: string;                  // 标签（用于识别）
  agentId?: string;                // Agent ID
  model?: ModelConfig;             // 模型配置
  thinking?: ThinkingLevel;        // 思考级别
  timeout?: number;                // 超时时间（毫秒）
  mode: SubagentMode;              // 运行模式
  cleanup?: boolean;               // 完成后自动清理
  sandbox?: boolean;               // 沙箱隔离
  parentSessionId?: string;        // 父会话 ID
  maxIterations?: number;          // 最大迭代次数
  role?: SubagentRole;             // 智能体角色（多Agent协作）
  skillContent?: string;           // Skill 内容（注入为 system prompt）
}

/**
 * Subagent 运行记录
 */
export interface SubagentRunRecord {
  id: string;
  config: SubagentConfig;
  status: SubagentStatus;
  startTime: number;
  endTime?: number;
  result?: any;
  error?: string;
  messages: any[];
  outputChunks: string[];
  progress: number;                // 进度 0-1
  agentRef?: Agent;                // 底层 Agent 实例引用（用于 kill/abort）
}

/**
 * Subagent 事件
 */
export interface SubagentEvent {
  type: 'created' | 'started' | 'progress' | 'completed' | 'failed' | 'killed' | 'output';
  subagentId: string;
  data?: any;
  timestamp: number;
}
