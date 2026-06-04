export type AgentCommandId =
  | 'new'
  | 'clear'
  | 'forge'
  | 'title'
  | 'summary'
  | 'ask'
  | 'learn'
  | 'help'

export interface AgentCommandDefinition {
  id: AgentCommandId
  label: string
  description: string
  icon: string
  aliases?: string[]
}

export const AGENT_COMMANDS: AgentCommandDefinition[] = [
  { id: 'new', label: '/new', description: '新建普通会话', icon: '+' },
  { id: 'clear', label: '/clear', description: '清空当前对话', icon: '⌫' },
  { id: 'forge', label: '/forge', description: '进入卡片锻造模式', icon: '◇' },
  { id: 'title', label: '/title', description: '重命名当前会话', icon: '✎' },
  { id: 'summary', label: '/summary', description: '让 AI 总结当前对话', icon: '≡' },
  { id: 'ask', label: '/ask', description: '让 AI 先追问澄清问题', icon: '?' },
  { id: 'learn', label: '/learn', description: '切换到学习建议模板', icon: '🎓' },
  { id: 'help', label: '/help', description: '查看命令提示', icon: 'i' },
]

export function findAgentCommand(raw: string): AgentCommandDefinition | null {
  const token = raw.trim().split(/\s+/, 1)[0]?.replace(/^\//, '').toLowerCase()
  if (!token) return null
  return AGENT_COMMANDS.find((command) => {
    if (command.id === token) return true
    if (command.aliases?.includes(token)) return true
    return command.label.slice(1) === token
  }) ?? null
}

export function filterAgentCommands(query: string): AgentCommandDefinition[] {
  const q = query.trim().replace(/^\//, '').toLowerCase()
  if (!q) return AGENT_COMMANDS
  return AGENT_COMMANDS.filter((command) => {
    const haystack = [command.id, command.label, command.description, ...(command.aliases ?? [])]
      .join(' ')
      .toLowerCase()
    return haystack.includes(q)
  })
}
