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
 * 虚拟 Agent 实现（用于演示）
 */
export class MockAgent {
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

          // 发送结果回来
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
        }
      }
    });
  }

  /**
   * 处理任务（模拟实现）
   */
  private async processTask(payload: Record<string, any>): Promise<Record<string, any>> {
    const { task, userId } = payload;

    // 模拟处理时间
    await new Promise(resolve => setTimeout(resolve, 1000));

    switch (this.role) {
      case 'profile':
        return {
          userLevel: 'intermediate',
          learningStyle: 'visual',
          weakPoints: ['recursion', 'tree-traversal'],
          masteryConcepts: ['basic-syntax', 'functions'],
          estimatedTime: 120, // 分钟
        };

      case 'planner':
        return {
          recommendedResourceTypes: ['document', 'code', 'diagram'],
          contentOutline: [
            '基本概念介绍',
            '原理讲解',
            '代码示例',
            '实践练习',
            '综合应用'
          ],
          estimatedDuration: 180, // 分钟
          resources: [
            { type: 'document', title: '递归详解' },
            { type: 'code', title: '递归代码示例' },
            { type: 'diagram', title: '递归流程图' }
          ]
        };

      case 'generator':
        return {
          generatedResources: [
            {
              type: 'document',
              title: '递归完全指南',
              url: '/resources/recursion-guide.md',
              status: 'completed'
            },
            {
              type: 'code',
              title: '递归代码练习',
              url: '/resources/recursion-code.json',
              status: 'completed'
            },
            {
              type: 'diagram',
              title: '递归可视化',
              url: '/resources/recursion-diagram.svg',
              status: 'completed'
            }
          ],
          qualityScore: 0.92
        };

      case 'reviewer':
        return {
          reviewResult: {
            factualAccuracy: 'verified',
            completeness: 'excellent',
            safety: 'passed',
            relevance: 'high'
          },
          suggestedImprovements: [
            '可添加更多实际案例'
          ],
          approved: true
        };

      case 'pusher':
        return {
          pushStatus: 'success',
          notificationId: nanoid(),
          pushedAt: Date.now(),
          message: '已将 3 个资源推送给用户'
        };

      default:
        return {};
    }
  }
}

/**
 * 导出单例
 */
export const agentMessageBus = new AgentMessageBus();
export const orchestrationEngine = new AgentOrchestrationEngine(agentMessageBus);

// 初始化虚拟 Agents
export const mockAgents = {
  profile: new MockAgent('profile', agentMessageBus),
  planner: new MockAgent('planner', agentMessageBus),
  generator: new MockAgent('generator', agentMessageBus),
  reviewer: new MockAgent('reviewer', agentMessageBus),
  pusher: new MockAgent('pusher', agentMessageBus),
};
