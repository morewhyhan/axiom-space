'use client'

import { UsersRound } from 'lucide-react'
import { HudPanel } from '@/components/ui'

export type OrchestrationManifest = {
  id: string
  status: string
  progress?: number
  durationMs?: number | null
  agents: Array<{
    role: string
    task: string
    status: string
    error?: string
  }>
  logs?: Array<{
    agent: string
    level: string
    message: string
  }>
}

type AgentOrchestrationPanelProps = {
  orchestration: OrchestrationManifest | null
  resources?: Array<{
    type: string
    title: string
    fileName?: string
    status?: string
    sourceTitle?: string
  }>
}

type UserFacingAgent = {
  name: string
  status: string
  input: string
  output: string
}

const statusLabel = (value: string) => {
  if (value === 'completed' || value === 'ready') return '已完成'
  if (value === 'completed_with_warnings') return '完成，有提醒'
  if (value === 'failed') return '失败'
  if (value === 'running' || value === 'generating') return '执行中'
  return '待执行'
}

const ROLE_META: Record<string, { name: string; input: string }> = {
  profile: { name: '画像诊断', input: '学习画像、当前卡片与最近证据' },
  retriever: { name: '资料检索', input: '当前知识库与可追溯资料' },
  planner: { name: '资源规划', input: '用户原话、指定类型与格式' },
  generator: { name: '资源生成', input: '已确认的资源计划与资料上下文' },
  reviewer: { name: '质量校验', input: '实际产物、结构规则、安全与事实规则' },
  pusher: { name: '入库与预览', input: '通过校验的资源文件与知识图谱' },
}

function buildUserFacingAgents(
  orchestration: OrchestrationManifest,
  _resources: AgentOrchestrationPanelProps['resources'] = [],
): UserFacingAgent[] {
  return orchestration.agents.map((agent) => {
    const meta = ROLE_META[agent.role] ?? { name: agent.role, input: '本次工作流的真实上游产物' }
    return {
      name: meta.name,
      status: statusLabel(agent.status),
      input: meta.input,
      output: agent.error ? `${agent.task}（${agent.error}）` : agent.task,
    }
  })
}

export function AgentOrchestrationPanel({ orchestration, resources = [] }: AgentOrchestrationPanelProps) {
  if (!orchestration) return null
  const userFacingAgents = buildUserFacingAgents(orchestration, resources)

  return (
    <HudPanel as="div" className="mt-6 rounded-xl p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <UsersRound className="h-4 w-4 text-purple-200/70" />
          <div className="min-w-0">
            <div className="mono uppercase text-white/32" style={{ fontSize: 'var(--f8)' }}>Agent_Orchestration</div>
            <div className="truncate text-white/62" style={{ fontSize: 'var(--f9)' }}>
              {orchestration.id}
            </div>
          </div>
        </div>
        <span className="rounded-lg border border-white/8 bg-white/[0.025] px-2 py-1 text-white/40" style={{ fontSize: 'var(--f8)' }}>
          {statusLabel(orchestration.status)}
        </span>
      </div>

      {typeof orchestration.progress === 'number' && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/8">
          <div
            className="h-full rounded-full bg-purple-300/75"
            style={{ width: `${Math.max(0, Math.min(100, orchestration.progress))}%` }}
          />
        </div>
      )}

      <div className="mt-4">
        <div className="mono uppercase text-purple-200/55" style={{ fontSize: 'var(--f8)' }}>本次真实执行链路</div>
        <div className="mt-2 grid gap-2">
          {userFacingAgents.map((agent) => (
            <div key={agent.name} className="rounded-lg border border-purple-300/10 bg-purple-300/[0.035] p-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-white/76" style={{ fontSize: 'var(--f9)' }}>{agent.name}</span>
                <span className="mono text-purple-100/45" style={{ fontSize: 'var(--f8)' }}>{agent.status}</span>
              </div>
              <p className="mt-1 text-white/35" style={{ fontSize: 'var(--f8)' }}>输入：{agent.input}</p>
              <p className="mt-1 text-white/52" style={{ fontSize: 'var(--f8)' }}>结果：{agent.output}</p>
            </div>
          ))}
        </div>
      </div>

      {orchestration.logs && orchestration.logs.length > 0 && (
        <div className="mt-3 rounded-lg border border-white/8 bg-black/18 p-3">
          {orchestration.logs.slice(-3).map((log, index) => (
            <div key={`${log.agent}:${index}`} className="truncate text-white/32" style={{ fontSize: 'var(--f8)' }}>
              {log.agent}: {log.message}
            </div>
          ))}
        </div>
      )}
    </HudPanel>
  )
}
