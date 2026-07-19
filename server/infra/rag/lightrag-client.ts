export type LightRAGQueryMode = 'naive' | 'local' | 'global' | 'hybrid' | 'mix'

export interface LightRAGInsertResult {
  status?: string
  message?: string
  id?: string
  track_id?: string
  trackId?: string
  [key: string]: unknown
}

export interface LightRAGQueryResult {
  response?: string
  answer?: string
  result?: string
  data?: unknown
  [key: string]: unknown
}

export interface LightRAGTrackStatus {
  track_id?: string
  documents?: Array<{
    id?: string
    status?: string
    error_msg?: string | null
    file_path?: string
  }>
  status_summary?: Record<string, number>
  [key: string]: unknown
}

export interface LightRAGDocumentRecord {
  id?: string
  file_path?: string
  status?: string
  error_msg?: string | null
  [key: string]: unknown
}

export interface LightRAGDocumentsResult {
  statuses?: Record<string, LightRAGDocumentRecord[]>
  [key: string]: unknown
}

export interface LightRAGClientConfig {
  baseUrl: string
  apiKey?: string
  timeoutMs?: number
}

export class LightRAGClient {
  private readonly baseUrl: string
  private readonly apiKey?: string
  private readonly timeoutMs: number

  constructor(config: LightRAGClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '')
    this.apiKey = config.apiKey
    this.timeoutMs = config.timeoutMs ?? 30_000
  }

  async health(workspace?: string): Promise<{ ok: boolean; detail?: unknown }> {
    try {
      const detail = await this.request<unknown>('/health', {
        method: 'GET',
        headers: workspace ? { 'LIGHTRAG-WORKSPACE': workspace } : undefined,
      })
      return { ok: true, detail }
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : String(error) }
    }
  }

  async insertText(params: {
    content: string
    documentId: string
    workspace: string
  }): Promise<LightRAGInsertResult> {
    return this.request<LightRAGInsertResult>('/documents/text', {
      method: 'POST',
      headers: { 'LIGHTRAG-WORKSPACE': params.workspace },
      body: {
        text: params.content,
        file_source: params.documentId,
      },
    })
  }

  async insertTexts(params: {
    texts: string[]
    documentIds: string[]
    workspace: string
  }): Promise<LightRAGInsertResult> {
    if (params.texts.length === 0 || params.texts.length !== params.documentIds.length) {
      throw new Error('LightRAG batch insert requires equally sized, non-empty texts and documentIds')
    }
    return this.request<LightRAGInsertResult>('/documents/texts', {
      method: 'POST',
      headers: { 'LIGHTRAG-WORKSPACE': params.workspace },
      body: {
        texts: params.texts,
        file_sources: params.documentIds,
      },
    })
  }

  async listDocuments(workspace?: string): Promise<LightRAGDocumentsResult> {
    return this.request<LightRAGDocumentsResult>('/documents', {
      method: 'GET',
      headers: workspace ? { 'LIGHTRAG-WORKSPACE': workspace } : undefined,
    })
  }

  async deleteDocuments(docIds: string[], workspace?: string): Promise<{ status?: string; message?: string; [key: string]: unknown }> {
    return this.request('/documents/delete_document', {
      method: 'DELETE',
      headers: workspace ? { 'LIGHTRAG-WORKSPACE': workspace } : undefined,
      body: {
        doc_ids: docIds,
        delete_file: false,
        delete_llm_cache: true,
      },
    })
  }

  async query(params: {
    query: string
    workspace: string
    mode?: LightRAGQueryMode
    topK?: number
  }): Promise<LightRAGQueryResult> {
    // The deployed LightRAG API exposes one physical store and does not
    // declare a workspace filter in its OpenAPI schema. Put AXIOM's vault
    // scope into both indexed content and retrieval keywords, then still
    // enforce the hard vault boundary when references are hydrated.
    const scope = `AXIOM_WORKSPACE:${params.workspace}`
    return this.request<LightRAGQueryResult>('/query', {
      method: 'POST',
      headers: { 'LIGHTRAG-WORKSPACE': params.workspace },
      body: {
        query: `${scope}\n${params.query}`,
        mode: params.mode ?? 'mix',
        top_k: params.topK ?? 8,
        chunk_top_k: params.topK ?? 8,
        ll_keywords: [scope],
        include_references: true,
        include_chunk_content: false,
      },
    })
  }

  async getTrackStatus(trackId: string): Promise<LightRAGTrackStatus> {
    return this.request<LightRAGTrackStatus>(`/documents/track_status/${encodeURIComponent(trackId)}`, {
      method: 'GET',
    })
  }

  private async request<T>(path: string, init: { method: 'GET' | 'POST' | 'DELETE'; body?: unknown; headers?: Record<string, string> }): Promise<T> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: init.method,
        headers: {
          ...(init.body ? { 'content-type': 'application/json' } : {}),
          ...(this.apiKey ? { 'x-api-key': this.apiKey, authorization: `Bearer ${this.apiKey}` } : {}),
          ...(init.headers || {}),
        },
        body: init.body ? JSON.stringify(init.body) : undefined,
        signal: controller.signal,
      })

      const text = await response.text()
      const data = text ? safeJson(text) : null
      if (!response.ok) {
        const detail = typeof data === 'object' && data && 'detail' in data ? String(data.detail) : text
        throw new Error(`LightRAG ${response.status}: ${detail || response.statusText}`)
      }
      return data as T
    } finally {
      clearTimeout(timer)
    }
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return { response: text }
  }
}
