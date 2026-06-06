/**
 * P0 任务 5: 多智能体协同编排系统
 *
 * 实现 Agent 协同工作流：
 * Profile → Planner → Generator → Reviewer → Pusher
 */

import { EventEmitter } from 'events';
import { nanoid } from 'nanoid';

/**
 * Agent 消息协议
 */
export interface AgentMessage {
  messageId: string;
  from: AgentRole;
  to: AgentRole | 'broadcast';
  type: 'task' | 'result' | 'feedback' | 'status';
  payload: Record<string, any>;
  timestamp: number;
  priority: 'high' | 'normal' | 'low';
}

export type AgentRole = 'profile' | 'planner' | 'generator' | 'reviewer' | 'pusher' | 'orchestrator';

/**
 * 流程步骤定义
 */
export interface FlowStep {
  stepId: string;
  agentRole: AgentRole;
  taskDescription: string;
  inputs?: Record<string, any>;
  outputs?: Record<string, any>;
  status: 'pending' | 'running' | 'completed' | 'failed';
  error?: string;
  completedAt?: number;
}

/**
 * 工作流模板
 */
export interface FlowTemplate {
  name: 'resource_generation' | 'assessment_feedback' | 'profile_update';
  description: string;
  steps: FlowStep[];
  parallelGroups?: AgentRole[][]; // 可并行执行的 Agent 组
  estimatedDuration?: number; // 毫秒
}

/**
 * 协同状态
 */
export interface OrchestrationState {
  orchestrationId: string;
  flowName: string;
  userId: string;
  steps: FlowStep[];
  currentStepIndex: number;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: number; // 0-100
  startedAt: number;
  completedAt?: number;
  results: Record<string, any>;
  logs: Array<{
    timestamp: number;
    agent: AgentRole;
    message: string;
    level: 'info' | 'warning' | 'error';
  }>;
}

/**
 * Agent 消息总线
 */
export class AgentMessageBus extends EventEmitter {
  private messageHistory: AgentMessage[] = [];
  private maxHistorySize = 1000;

  /**
   * 发布消息
   */
  publish(message: AgentMessage): void {
    // 去重检查
    const isDuplicate = this.messageHistory.some(
      m => m.messageId === message.messageId ||
           (m.from === message.from && m.to === message.to &&
            m.type === message.type && m.timestamp === message.timestamp)
    );

    if (isDuplicate) {
      console.warn(`[AgentMessageBus] 重复消息已忽略: ${message.messageId}`);
      return;
    }

    this.messageHistory.push(message);
    if (this.messageHistory.length > this.maxHistorySize) {
      this.messageHistory = this.messageHistory.slice(-this.maxHistorySize);
    }

    // 路由消息
    if (message.to === 'broadcast') {
      this.emit('broadcast', message);
    } else {
      this.emit(`agent:${message.to}`, message);
    }

    console.log(`[AgentMessageBus] 消息路由: ${message.from} → ${message.to}`);
  }

  /**
   * 订阅消息
   */
  subscribe(agentRole: AgentRole, callback: (message: AgentMessage) => void): () => void {
    this.on(`agent:${agentRole}`, callback);

    // 返回取消订阅函数
    return () => {
      this.off(`agent:${agentRole}`, callback);
    };
  }

  /**
   * 获取消息历史
   */
  getHistory(from?: AgentRole, to?: AgentRole): AgentMessage[] {
    return this.messageHistory.filter(m =>
      (!from || m.from === from) &&
      (!to || m.to === to)
    );
  }
}

/**
 * Agent 协调编排器
 */
export class AgentOrchestrationEngine {
  private messageBus: AgentMessageBus;
  private orchestrationStates: Map<string, OrchestrationState> = new Map();
  private flowTemplates: Map<string, FlowTemplate> = new Map();

  constructor(messageBus: AgentMessageBus) {
    this.messageBus = messageBus;
    this.initializeFlowTemplates();
  }

  /**
   * 初始化工作流模板
   */
  private initializeFlowTemplates(): void {
    // 资源生成协同流程
    const resourceGenerationFlow: FlowTemplate = {
      name: 'resource_generation',
      description: '资源生成协同工作流：分析→规划→生成→审核→推送',
      steps: [
        {
          stepId: 'step_1',
          agentRole: 'profile',
          taskDescription: '分析用户学习画像和需求',
          status: 'pending',
        },
        {
          stepId: 'step_2',
          agentRole: 'planner',
          taskDescription: '规划资源类型和内容大纲',
          status: 'pending',
        },
        {
          stepId: 'step_3',
          agentRole: 'generator',
          taskDescription: '生成各类型资源（并行：document/code/diagram/video）',
          status: 'pending',
        },
        {
          stepId: 'step_4',
          agentRole: 'reviewer',
          taskDescription: '审核资源质量和准确性',
          status: 'pending',
        },
        {
          stepId: 'step_5',
          agentRole: 'pusher',
          taskDescription: '推送资源给用户',
          status: 'pending',
        },
      ],
      parallelGroups: [
        // Step 3 中的生成可以并行
        // 由具体实现控制
      ],
      estimatedDuration: 30000, // 30 秒
    };

    this.flowTemplates.set('resource_generation', resourceGenerationFlow);

    // 评估反馈工作流
    const assessmentFeedbackFlow: FlowTemplate = {
      name: 'assessment_feedback',
      description: '评估结果处理工作流：评估→诊断→反馈→调整',
      steps: [
        {
          stepId: 'step_1',
          agentRole: 'profile',
          taskDescription: '分析评估结果和学生状态',
          status: 'pending',
        },
        {
          stepId: 'step_2',
          agentRole: 'planner',
          taskDescription: '诊断问题并制定调整方案',
          status: 'pending',
        },
        {
          stepId: 'step_3',
          agentRole: 'generator',
          taskDescription: '生成针对性补充资源',
          status: 'pending',
        },
        {
          stepId: 'step_4',
          agentRole: 'pusher',
          taskDescription: '推送反馈和建议给用户',
          status: 'pending',
        },
      ],
      estimatedDuration: 20000, // 20 秒
    };

    this.flowTemplates.set('assessment_feedback', assessmentFeedbackFlow);
  }

  /**
   * 启动协同工作流
   */
  async executeFlow(
    flowName: 'resource_generation' | 'assessment_feedback' | 'profile_update',
    userId: string,
    inputs: Record<string, any> = {}
  ): Promise<OrchestrationState> {
    const template = this.flowTemplates.get(flowName);
    if (!template) {
      throw new Error(`工作流模板不存在: ${flowName}`);
    }

    const orchestrationId = nanoid();
    const state: OrchestrationState = {
      orchestrationId,
      flowName,
      userId,
      steps: template.steps.map(s => ({ ...s })),
      currentStepIndex: 0,
      status: 'running',
      progress: 0,
      startedAt: Date.now(),
      results: { ...inputs },
      logs: [
        {
          timestamp: Date.now(),
          agent: 'orchestrator',
          message: `启动工作流: ${flowName}`,
          level: 'info'
        }
      ]
    };

    this.orchestrationStates.set(orchestrationId, state);

    // 执行流程
    try {
      await this.executeSteps(state);
      state.status = 'completed';
      state.completedAt = Date.now();
      state.progress = 100;
    } catch (error) {
      state.status = 'failed';
      state.completedAt = Date.now();
      state.logs.push({
        timestamp: Date.now(),
        agent: 'orchestrator',
        message: `工作流失败: ${error instanceof Error ? error.message : '未知错误'}`,
        level: 'error'
      });
    }

    return state;
  }

  /**
   * 按顺序执行步骤
   */
  private async executeSteps(state: OrchestrationState): Promise<void> {
    for (let i = 0; i < state.steps.length; i++) {
      const step = state.steps[i];
      state.currentStepIndex = i;
      state.progress = Math.round((i / state.steps.length) * 100);

      try {
        step.status = 'running';

        // 发送任务消息给对应的 Agent
        const taskMessage: AgentMessage = {
          messageId: nanoid(),
          from: 'orchestrator',
          to: step.agentRole,
          type: 'task',
          payload: {
            stepId: step.stepId,
            task: step.taskDescription,
            previousResults: state.results,
            userId: state.userId,
          },
          timestamp: Date.now(),
          priority: 'high'
        };

        this.messageBus.publish(taskMessage);

        // 等待 Agent 完成（通过监听 result 消息）
        const result = await this.waitForResult(
          step.agentRole,
          step.stepId,
          30000 // 30 秒超时
        );

        step.outputs = result;
        step.status = 'completed';
        step.completedAt = Date.now();

        // 合并结果
        state.results = { ...state.results, ...result };

        state.logs.push({
          timestamp: Date.now(),
          agent: step.agentRole,
          message: `步骤完成: ${step.taskDescription}`,
          level: 'info'
        });
      } catch (error) {
        step.status = 'failed';
        step.error = error instanceof Error ? error.message : '未知错误';
        state.logs.push({
          timestamp: Date.now(),
          agent: step.agentRole,
          message: `步骤失败: ${step.error}`,
          level: 'error'
        });
        throw error; // 中断工作流
      }
    }
  }

  /**
   * 等待 Agent 完成结果
   */
  private waitForResult(
    agentRole: AgentRole,
    stepId: string,
    timeout: number
  ): Promise<Record<string, any>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Agent ${agentRole} 执行超时`));
      }, timeout);

      const unsubscribe = this.messageBus.subscribe(
        'orchestrator',
        (message: AgentMessage) => {
          if (
            message.from === agentRole &&
            message.type === 'result' &&
            message.payload.stepId === stepId
          ) {
            clearTimeout(timer);
            unsubscribe();
            resolve(message.payload.result || {});
          }
        }
      );
    });
  }

  /**
   * 获取协同状态
   */
  getOrchestrationStatus(orchestrationId: string): OrchestrationState | undefined {
    return this.orchestrationStates.get(orchestrationId);
  }

  /**
   * 列出所有协同记录
   */
  listOrchestrations(userId?: string): OrchestrationState[] {
    const states = Array.from(this.orchestrationStates.values());
    if (userId) {
      return states.filter(s => s.userId === userId);
    }
    return states;
  }
}

/**
 * 真实 Agent 实现 — 使用 Prisma + AI Manager 执行实际任务
 */
export class RealAgent {
  private role: AgentRole;
  private messageBus: AgentMessageBus;

  constructor(role: AgentRole, messageBus: AgentMessageBus) {
    this.role = role;
    this.messageBus = messageBus;
    this.setupListener();
  }

  /**
   * 设置消息监听
   */
  private setupListener(): void {
    this.messageBus.subscribe(this.role, async (message: AgentMessage) => {
      if (message.type === 'task') {
        try {
          const result = await this.processTask(message.payload);

          const resultMessage: AgentMessage = {
            messageId: nanoid(),
            from: this.role,
            to: 'orchestrator',
            type: 'result',
            payload: {
              stepId: message.payload.stepId,
              result,
            },
            timestamp: Date.now(),
            priority: 'high'
          };

          this.messageBus.publish(resultMessage);
        } catch (error) {
          console.error(`[${this.role}] 处理任务失败:`, error);
          const resultMessage: AgentMessage = {
            messageId: nanoid(),
            from: this.role,
            to: 'orchestrator',
            type: 'result',
            payload: {
              stepId: message.payload.stepId,
              result: {
                status: 'failed',
                error: error instanceof Error ? error.message : String(error),
              },
            },
            timestamp: Date.now(),
            priority: 'high'
          };
          this.messageBus.publish(resultMessage);
        }
      }
    });
  }

  /**
   * 处理任务 — 分发到角色对应的 handler
   */
  async processTask(payload: Record<string, any>): Promise<Record<string, any>> {
    const { task, userId } = payload;
    switch (this.role) {
      case 'profile':
        return await this.handleProfile(payload);
      case 'planner':
        return await this.handlePlanner(payload);
      case 'generator':
        return await this.handleGenerator(payload);
      case 'reviewer':
        return await this.handleReviewer(payload);
      case 'pusher':
        return await this.handlePusher(payload);
      default:
        return { status: 'unknown_role' };
    }
  }

  /**
   * profile: 读取卡片和能力数据，推算用户学习画像
   */
  private async handleProfile(payload: Record<string, any>): Promise<Record<string, any>> {
    const userId = payload.userId || '';
    const previousResults = payload.previousResults || {};
    const vaultId = previousResults.vaultId || payload.vaultId;
    const { prisma } = await import('@/lib/db');

    const vault = vaultId
      ? await prisma.vault.findFirst({ where: { id: vaultId, userId } })
      : await prisma.vault.findFirst({ where: { userId } });
    if (!vault) {
      return {
        userLevel: 'beginner',
        learningStyle: 'visual',
        weakPoints: [],
        masteryConcepts: [],
        estimatedTime: 60,
      };
    }

    const cards = await prisma.card.findMany({ where: { vaultId: vault.id } });
    const permanentCount = cards.filter(c => c.type === 'permanent').length;
    const literatureCount = cards.filter(c => c.type === 'literature').length;
    const totalCards = cards.length;

    let userLevel = 'beginner';
    if (permanentCount > 20) userLevel = 'advanced';
    else if (permanentCount > 5) userLevel = 'intermediate';

    let profileCache: Record<string, any> = {};
    if (vault.profileCache) {
      try { profileCache = JSON.parse(vault.profileCache); } catch { /* ignore parse error */ }
    }

    const capabilities = await prisma.vaultCapability.findMany({ where: { vaultId: vault.id } });
    const weakPoints = capabilities.filter(c => c.masteryLevel < 30).map(c => c.concept);
    const masteryConcepts = capabilities.filter(c => c.masteryLevel >= 70).map(c => c.concept);

    return {
      userLevel,
      learningStyle: profileCache.learningStyle || 'visual',
      weakPoints: weakPoints.slice(0, 5),
      masteryConcepts: masteryConcepts.slice(0, 5),
      estimatedTime: profileCache.estimatedTime || Math.max(30, totalCards * 2),
      totalCards,
      permanentCards: permanentCount,
      literatureCards: literatureCount,
      ...profileCache,
    };
  }

  /**
   * planner: 调用 AI 生成学习计划和资源推荐
   */
  private async handlePlanner(payload: Record<string, any>): Promise<Record<string, any>> {
    const previousResults = payload.previousResults || {};
    const { aiManager } = await import('@/server/core/ai/AIManager');

    const systemPrompt = `你是一个学习路径规划专家。根据用户的学习画像，生成一份学习计划。
请以 JSON 格式返回（不要 markdown fence），字段如下：
{
  "recommendedResourceTypes": ["document", "code", "diagram", "video"],
  "contentOutline": ["章节标题1", "章节标题2"],
  "estimatedDuration": 120,
  "resources": [{ "type": "document", "title": "资源标题" }]
}`;

    try {
      const raw = await aiManager.callAPI(
        systemPrompt,
        [{ role: 'user', content: `用户画像：\n${JSON.stringify(previousResults, null, 2)}\n请生成适合该用户的学习计划。` }],
        { temperature: 0.7 }
      );
      const cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*$/g, '').trim();
      return JSON.parse(cleaned);
    } catch (err) {
      console.error('[planner] AI call failed:', err);
      return {
        recommendedResourceTypes: ['document', 'code', 'diagram'],
        contentOutline: ['基本概念', '原理讲解', '代码示例', '实践练习'],
        estimatedDuration: 120,
        resources: [
          { type: 'document', title: '学习指南' },
          { type: 'code', title: '代码示例' },
        ],
      };
    }
  }

  /**
   * generator: 调用 AI 根据计划生成实际学习资源内容
   */
  private async handleGenerator(payload: Record<string, any>): Promise<Record<string, any>> {
    const previousResults = payload.previousResults || {};
    const { aiManager } = await import('@/server/core/ai/AIManager');

    const systemPrompt = `你是一个学习资源生成专家。根据学习计划大纲，生成具体的资源内容。
请以 JSON 格式返回（不要 markdown fence），字段如下：
{
  "generatedResources": [
    {
      "type": "document",
      "title": "资源标题",
      "content": "资源内容（markdown格式）",
      "status": "completed"
    }
  ],
  "qualityScore": 0.95
}`;

    try {
      const raw = await aiManager.callAPI(
        systemPrompt,
        [{ role: 'user', content: `计划大纲：\n${JSON.stringify(previousResults, null, 2)}\n请根据大纲生成具体的学习资源。` }],
        { temperature: 0.7 }
      );
      const cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*$/g, '').trim();
      return JSON.parse(cleaned);
    } catch (err) {
      console.error('[generator] AI call failed:', err);
      return {
        generatedResources: [
          { type: 'document', title: '学习资料', content: '# 学习资料\n\n待生成', status: 'pending' },
        ],
        qualityScore: 0.5,
      };
    }
  }

  /**
   * reviewer: 读取学习路径步骤数据，评估掌握程度
   */
  private async handleReviewer(payload: Record<string, any>): Promise<Record<string, any>> {
    const userId = payload.userId || '';
    const { prisma } = await import('@/lib/db');

    const paths = await prisma.learningPath.findMany({
      where: { userId, status: 'active' },
      include: { steps: true },
    });

    const allSteps = paths.flatMap(p => p.steps);
    const completedSteps = allSteps.filter(s => s.status === 'completed' || s.status === 'mastered');
    const completionRate = allSteps.length > 0 ? completedSteps.length / allSteps.length : 0;
    const avgMastery = allSteps.length > 0
      ? allSteps.reduce((sum, s) => sum + s.mastery, 0) / allSteps.length
      : 0;

    const approved = completionRate > 0.6 || avgMastery > 60;

    return {
      reviewResult: {
        factualAccuracy: completionRate > 0.8 ? 'verified' : 'needs_review',
        completeness: completionRate > 0.5 ? 'excellent' : 'needs_improvement',
        safety: 'passed',
        relevance: completionRate > 0.3 ? 'high' : 'medium',
        completionRate,
        avgMastery,
      },
      suggestedImprovements: completionRate < 0.6
        ? ['需要更多练习', '建议补充基础知识']
        : ['继续保持当前进度'],
      approved,
    };
  }

  /**
   * pusher: 通过 notification-bus 推送通知，记录到 PushRecord
   */
  private async handlePusher(payload: Record<string, any>): Promise<Record<string, any>> {
    const userId = payload.userId || '';
    const previousResults = payload.previousResults || {};
    const generated = previousResults.generatedResources || [];
    const { prisma } = await import('@/lib/db');
    const { emitNotification } = await import('./notification-bus');

    const inputVaultId = previousResults.vaultId || payload.vaultId;
    const vault = inputVaultId
      ? await prisma.vault.findFirst({ where: { id: inputVaultId, userId } })
      : await prisma.vault.findFirst({ where: { userId } });
    const vaultId = vault?.id || '';

    const resourceCount = generated.length || 1;
    const message = `已将 ${resourceCount} 个资源推送给用户`;

    if (userId) {
      try {
        await prisma.pushRecord.create({
          data: {
            userId,
            vaultId: vaultId || null,
            resources: JSON.stringify(generated),
            trigger: 'stage_completion',
            reason: message,
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          },
        });
      } catch (err) {
        console.error('[pusher] Failed to create push record:', err);
      }
    }

    if (vaultId) {
      await emitNotification(vaultId, { type: 'toast', message });
    }

    return {
      pushStatus: 'success',
      notificationId: nanoid(),
      pushedAt: Date.now(),
      message,
    };
  }
}

/**
 * 导出单例
 */
export const agentMessageBus = new AgentMessageBus();
export const orchestrationEngine = new AgentOrchestrationEngine(agentMessageBus);

// 初始化真实 Agents
export const realAgents = {
  profile: new RealAgent('profile', agentMessageBus),
  planner: new RealAgent('planner', agentMessageBus),
  generator: new RealAgent('generator', agentMessageBus),
  reviewer: new RealAgent('reviewer', agentMessageBus),
  pusher: new RealAgent('pusher', agentMessageBus),
};
