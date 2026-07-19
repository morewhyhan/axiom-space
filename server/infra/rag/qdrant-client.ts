export interface QdrantCardPayload {
  vaultId: string
  cardId: string
  title: string
  path: string
  type: string
  contentHash: string
}

export interface QdrantSearchHit {
  id: string
  score: number
  payload: QdrantCardPayload
}

export class QdrantClient {
  constructor(
    private readonly baseUrl: string,
    private readonly collection: string,
    private readonly apiKey?: string,
  ) {}

  async ensureCollection(dimensions: number) {
    const response = await this.request(`/collections/${encodeURIComponent(this.collection)}`, { method: 'GET' }, true)
    if (response.ok) return
    if (response.status !== 404) throw new Error(`Qdrant collection check failed: ${response.status}`)
    await this.request(`/collections/${encodeURIComponent(this.collection)}`, {
      method: 'PUT',
      body: JSON.stringify({ vectors: { size: dimensions, distance: 'Cosine' } }),
    })
  }

  async upsert(points: Array<{ id: string; vector: number[]; payload: QdrantCardPayload }>) {
    if (points.length === 0) return
    await this.request(`/collections/${encodeURIComponent(this.collection)}/points?wait=true`, {
      method: 'PUT',
      body: JSON.stringify({ points }),
    })
  }

  async search(vector: number[], vaultId: string, limit: number): Promise<QdrantSearchHit[]> {
    const response = await this.request(`/collections/${encodeURIComponent(this.collection)}/points/query`, {
      method: 'POST',
      body: JSON.stringify({
        query: vector,
        filter: { must: [{ key: 'vaultId', match: { value: vaultId } }] },
        limit,
        with_payload: true,
        with_vector: false,
      }),
    })
    const json = await response.json() as { result?: { points?: QdrantSearchHit[] } }
    return Array.isArray(json.result?.points) ? json.result.points : []
  }

  async deleteVault(vaultId: string) {
    const response = await this.request(`/collections/${encodeURIComponent(this.collection)}/points/delete?wait=true`, {
      method: 'POST',
      body: JSON.stringify({ filter: { must: [{ key: 'vaultId', match: { value: vaultId } }] } }),
    }, true)
    if (!response.ok && response.status !== 404) {
      throw new Error(`Qdrant vault cleanup failed: ${response.status}`)
    }
  }

  private async request(path: string, init: RequestInit, allowError = false) {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}${path}`, {
      ...init,
      headers: {
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...(this.apiKey ? { 'api-key': this.apiKey } : {}),
        ...(init.headers || {}),
      },
    })
    if (!allowError && !response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(`Qdrant request failed (${response.status}): ${detail.slice(0, 300)}`)
    }
    return response
  }
}
