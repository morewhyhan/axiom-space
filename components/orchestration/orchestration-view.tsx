/**
 * P2 任务 1: 前端协同进度展示组件
 *
 * AgentOrchestrationView: 展示 Agent 协同进度
 */

'use client';

import React, { useEffect, useState } from 'react';
import { CheckCircle2, Clock, AlertCircle, Zap } from 'lucide-react';
import type { OrchestrationState, FlowStep } from '@/server/core/agent/orchestration-engine';

interface AgentOrchestrationViewProps {
  orchestrationId: string;
  flowName: string;
  onComplete?: (result: any) => void;
}

export default function AgentOrchestrationView({
  orchestrationId,
  flowName,
  onComplete
}: AgentOrchestrationViewProps) {
  const [state, setState] = useState<OrchestrationState | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 实际实现中会通过 WebSocket 或 polling 获取状态
    const fetchState = async () => {
      try {
        // const response = await fetch(`/api/orchestrations/${orchestrationId}`);
        // const data = await response.json();
        // setState(data);

        // 模拟数据（开发阶段）
        setTimeout(() => {
          setLoading(false);
        }, 1000);
      } catch (error) {
        console.error('Failed to fetch orchestration state:', error);
        setLoading(false);
      }
    };

    fetchState();

    // 定时轮询状态更新
    const interval = setInterval(fetchState, 2000);
    return () => clearInterval(interval);
  }, [orchestrationId]);

  if (loading) {
    return (
      <div className="glass-panel rounded-xl p-6 animate-pulse">
        <div className="h-6 bg-gray-700 rounded w-1/3 mb-4"></div>
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-12 bg-gray-700 rounded"></div>
          ))}
        </div>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="glass-panel rounded-xl p-6 border border-red-500/20">
        <p className="text-red-400">无法加载协同状态</p>
      </div>
    );
  }

  const getStepIcon = (step: FlowStep) => {
    if (step.status === 'completed') {
      return <CheckCircle2 className="w-5 h-5 text-green-400" />;
    } else if (step.status === 'running') {
      return <Zap className="w-5 h-5 text-blue-400 animate-pulse" />;
    } else if (step.status === 'failed') {
      return <AlertCircle className="w-5 h-5 text-red-400" />;
    } else {
      return <Clock className="w-5 h-5 text-gray-400" />;
    }
  };

  const getStepColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'bg-green-500/20 border-green-500/30';
      case 'running':
        return 'bg-blue-500/20 border-blue-500/30';
      case 'failed':
        return 'bg-red-500/20 border-red-500/30';
      default:
        return 'bg-gray-800/30 border-gray-700/30';
    }
  };

  const getAgentLabel = (role: string) => {
    const labels: Record<string, string> = {
      profile: '👤 学生画像分析',
      planner: '📋 资源规划',
      generator: '✨ 内容生成',
      reviewer: '✅ 质量审核',
      pusher: '📤 资源推送'
    };
    return labels[role] || role;
  };

  return (
    <div className="glass-panel rounded-xl p-6 border border-white/10">
      {/* 标题和进度 */}
      <div className="mb-6">
        <div className="flex justify-between items-center mb-2">
          <h3 className="text-lg font-semibold">Agent 协同进度</h3>
          <span className="text-sm text-gray-400">{state.progress}%</span>
        </div>
        <div className="w-full bg-gray-800 rounded-full h-2 overflow-hidden">
          <div
            className="bg-gradient-to-r from-blue-500 to-purple-500 h-full transition-all duration-500"
            style={{ width: `${state.progress}%` }}
          ></div>
        </div>
      </div>

      {/* 工作流步骤 */}
      <div className="space-y-3 mb-6">
        {state.steps.map((step, index) => (
          <div key={step.stepId} className={`rounded-lg border p-4 transition-all ${getStepColor(step.status)}`}>
            <div className="flex items-start gap-3">
              {/* 步骤号和图标 */}
              <div className="flex-shrink-0 flex flex-col items-center">
                <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center text-sm font-semibold">
                  {index + 1}
                </div>
              </div>

              {/* 步骤信息 */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  {getStepIcon(step)}
                  <h4 className="font-medium">{getAgentLabel(step.agentRole)}</h4>
                  {step.status === 'completed' && (
                    <span className="text-xs text-gray-400">
                      完成于 {new Date(step.completedAt || 0).toLocaleTimeString()}
                    </span>
                  )}
                </div>
                <p className="text-sm text-gray-300">{step.taskDescription}</p>

                {/* 错误信息 */}
                {step.error && (
                  <p className="text-sm text-red-400 mt-2">❌ 错误: {step.error}</p>
                )}

                {/* 步骤输出摘要 */}
                {step.outputs && Object.keys(step.outputs).length > 0 && (
                  <details className="mt-2">
                    <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-300">
                      查看输出 ({Object.keys(step.outputs).length} 项)
                    </summary>
                    <pre className="mt-2 text-xs bg-black/30 p-2 rounded overflow-x-auto">
                      {JSON.stringify(step.outputs, null, 2)}
                    </pre>
                  </details>
                )}
              </div>

              {/* 状态标签 */}
              <div className="flex-shrink-0">
                <span className={`text-xs font-medium px-2 py-1 rounded ${
                  step.status === 'completed' ? 'bg-green-500/30 text-green-300' :
                  step.status === 'running' ? 'bg-blue-500/30 text-blue-300' :
                  step.status === 'failed' ? 'bg-red-500/30 text-red-300' :
                  'bg-gray-700/30 text-gray-400'
                }`}>
                  {step.status === 'completed' ? '完成' :
                   step.status === 'running' ? '进行中' :
                   step.status === 'failed' ? '失败' :
                   '待处理'}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* 日志面板 */}
      <details className="border-t border-gray-700/50 pt-4">
        <summary className="text-sm font-semibold text-gray-400 cursor-pointer hover:text-gray-300">
          📋 执行日志 ({state.logs.length})
        </summary>
        <div className="mt-3 space-y-2 max-h-48 overflow-y-auto">
          {state.logs.map((log, idx) => (
            <div key={idx} className="text-xs font-mono">
              <span className="text-gray-500">[{new Date(log.timestamp).toLocaleTimeString()}]</span>
              <span className={`ml-2 ${
                log.level === 'error' ? 'text-red-400' :
                log.level === 'warning' ? 'text-yellow-400' :
                'text-gray-400'
              }`}>
                {log.agent}: {log.message}
              </span>
            </div>
          ))}
        </div>
      </details>

      {/* 状态摘要 */}
      <div className="mt-4 p-3 bg-gray-800/50 rounded border border-gray-700/30 text-sm">
        <p className="text-gray-300">
          状态: <span className={`font-semibold ${
            state.status === 'completed' ? 'text-green-400' :
            state.status === 'failed' ? 'text-red-400' :
            'text-blue-400'
          }`}>
            {state.status === 'completed' ? '✅ 已完成' :
             state.status === 'failed' ? '❌ 已失败' :
             '⏳ 进行中'}
          </span>
        </p>
        {state.completedAt && (
          <p className="text-gray-400 text-xs mt-1">
            耗时: {Math.round((state.completedAt - state.startedAt) / 1000)}秒
          </p>
        )}
      </div>
    </div>
  );
}
