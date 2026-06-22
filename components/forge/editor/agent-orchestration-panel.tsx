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
  if (value === 'completed' || value === 'ready') return 'completed'
  if (value === 'failed') return 'failed'
  return value || 'pending'
}

function buildUserFacingAgents(
  orchestration: OrchestrationManifest,
  resources: AgentOrchestrationPanelProps['resources'] = [],
): UserFacingAgent[] {
  const statusByRole = new Map(orchestration.agents.map((agent) => [agent.role, agent.status]))
  const allDone = orchestration.status === 'completed'
  const resourceList = resources.length
    ? resources.map((item) => item.title || item.type).join('、')
    : '讲解文档、思维导图、练习题、代码实操、视频/动画脚本'
  const sourceTitle = resources.find((item) => item.sourceTitle)?.sourceTitle || '当前卡片与检索资料'
  const resourceStatus = resources.length > 0 && resources.every((item) => item.status === 'ready' || !item.status)
    ? 'completed'
    : statusByRole.get('generator') || orchestration.status

  return [
    {
      name: '诊断 Agent',
      status: statusLabel(statusByRole.get('profile') || orchestration.status),
      input: '当前卡片、学习画像、最近对话证据',
      output: `定位当前学习缺口与误区，作为「${sourceTitle}」资源生成依据。`,
    },
    {
      name: '文献 Agent',
      status: statusLabel(allDone ? 'completed' : orchestration.status),
      input: '当前卡片、Vault 检索上下文、资料引用',
      output: '汇总资料依据，避免把无来源内容写成确定事实。',
    },
    {
      name: '路径 Agent',
      status: statusLabel(statusByRole.get('planner') || orchestration.status),
      input: '学习路径、当前任务、画像剩余缺口',
      output: '对齐当前学习步骤，并确定资源要服务的下一步缺口。',
    },
    {
      name: '资源 Agent',
      status: statusLabel(resourceStatus),
      input: '资源类型、用户偏好、当前误区',
      output: `生成资源：${resourceList}。`,
    },
    {
      name: '评估 Agent',
      status: statusLabel(statusByRole.get('reviewer') || orchestration.status),
      input: '生成资源正文、事实核查与安全规则',
      output: '输出清晰、准确、必要的质量校验和 guardrail 报告。',
    },
    {
      name: '观察 Agent',
      status: statusLabel(statusByRole.get('pusher') || orchestration.status),
      input: '用户理解证据、资源选择、推送结果',
      output: '更新画像记录与后续推送依据，沉淀下一步学习状态。',
    },
  ]
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
          {orchestration.status}
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
        <div className="mono uppercase text-purple-200/55" style={{ fontSize: 'var(--f8)' }}>Visible Agent Roles</div>
        <div className="mt-2 grid gap-2">
          {userFacingAgents.map((agent) => (
            <div key={agent.name} className="rounded-lg border border-purple-300/10 bg-purple-300/[0.035] p-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-white/76" style={{ fontSize: 'var(--f9)' }}>{agent.name}</span>
                <span className="mono text-purple-100/45" style={{ fontSize: 'var(--f8)' }}>{agent.status}</span>
              </div>
              <p className="mt-1 text-white/35" style={{ fontSize: 'var(--f8)' }}>输入：{agent.input}</p>
              <p className="mt-1 text-white/52" style={{ fontSize: 'var(--f8)' }}>产物：{agent.output}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-3 grid gap-2">
        {orchestration.agents.map((agent, index) => (
          <div key={`${agent.role}:${index}`} className="rounded-lg border border-white/8 bg-white/[0.025] p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-white/70" style={{ fontSize: 'var(--f9)' }}>{agent.role}</span>
              <span className="mono text-white/30" style={{ fontSize: 'var(--f8)' }}>{agent.status}</span>
            </div>
            <p className="mt-1 text-white/38" style={{ fontSize: 'var(--f8)' }}>{agent.task}</p>
            {agent.error && (
              <p className="mt-1 text-amber-100/60" style={{ fontSize: 'var(--f8)' }}>{agent.error}</p>
            )}
          </div>
        ))}
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
