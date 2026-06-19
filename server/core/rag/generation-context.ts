import { queryLightRAGContext } from './lightrag-service'

export interface GenerationRagContext {
  enabled: boolean
  used: boolean
  contextText: string
  references: string[]
  error?: string
}

export async function buildGenerationRagContext(params: {
  vaultId?: string | null
  query: string
  topK?: number
  maxChars?: number
}): Promise<GenerationRagContext> {
  const query = params.query.trim()
  if (!params.vaultId || !query) {
    return { enabled: false, used: false, contextText: '', references: [] }
  }

  const result = await queryLightRAGContext({
    vaultId: params.vaultId,
    query,
    mode: 'mix',
    topK: params.topK ?? 8,
  })

  const answer = result.answer.trim().slice(0, params.maxChars ?? 5000)
  const references = result.references
    .slice(0, params.topK ?? 8)
    .map((reference, index) => {
      const title = reference.title || reference.filePath || reference.cardId || `reference-${index + 1}`
      const type = reference.type ? `/${reference.type}` : ''
      return `[${index + 1}] ${title}${type}${reference.cardId ? ` (${reference.cardId})` : ''}`
    })

  if (!answer) {
    return {
      enabled: result.enabled,
      used: false,
      contextText: '',
      references,
      error: result.error,
    }
  }

  return {
    enabled: result.enabled,
    used: true,
    contextText: [
      '## LightRAG 检索上下文',
      '',
      '生成内容必须优先依据这里的当前知识库内容；如果上下文不足，只能写成待补线索，不能把猜测写成确定事实。',
      '',
      answer,
      '',
      references.length > 0 ? `引用卡片：\n${references.map((item) => `- ${item}`).join('\n')}` : '',
    ].filter(Boolean).join('\n'),
    references,
    error: result.error,
  }
}
