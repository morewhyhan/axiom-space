import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { LightRAGClient } from '@/server/infra/rag/lightrag-client'

async function run() {
  const requests: Array<{ url: string; workspace: string | undefined; body: Record<string, unknown> }> = []
  const server = createServer(async (request, response) => {
    let raw = ''
    for await (const chunk of request) raw += Buffer.from(chunk).toString('utf8')
    requests.push({
      url: request.url || '',
      workspace: typeof request.headers['lightrag-workspace'] === 'string' ? request.headers['lightrag-workspace'] : undefined,
      body: raw ? JSON.parse(raw) : {},
    })
    response.setHeader('content-type', 'application/json')
    response.end(request.url === '/query'
      ? JSON.stringify({ response: 'ok', references: [] })
      : JSON.stringify({ status: 'success', track_id: 'track-1' }))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert(address && typeof address === 'object')
  const client = new LightRAGClient({ baseUrl: `http://127.0.0.1:${address.port}` })

  await client.insertText({ content: 'Visitor content', documentId: 'axiom:vault-a:card:1', workspace: 'axiom_vault_a' })
  await client.insertTexts({
    texts: ['Visitor content', 'Strategy content'],
    documentIds: ['axiom:vault-a:card:1', 'axiom:vault-a:card:2'],
    workspace: 'axiom_vault_a',
  })
  await client.query({ query: 'Visitor', workspace: 'axiom_vault_a', mode: 'mix', topK: 7 })
  server.close()
  await once(server, 'close')

  assert.equal(requests.length, 3)
  assert.equal(requests[0].workspace, 'axiom_vault_a')
  assert.equal(requests[1].workspace, 'axiom_vault_a')
  assert.equal(requests[2].workspace, 'axiom_vault_a')
  assert.equal('workspace' in requests[0].body, false, 'workspace must not be silently ignored in JSON body')
  assert.equal(requests[1].url, '/documents/texts')
  assert.deepEqual(requests[1].body.file_sources, ['axiom:vault-a:card:1', 'axiom:vault-a:card:2'])
  assert.equal(requests[2].body.include_references, true)
  assert.equal(requests[2].body.top_k, 7)
  assert.equal(requests[2].body.chunk_top_k, 7)
  assert.equal(
    requests[2].body.query,
    'AXIOM_WORKSPACE:axiom_vault_a\nVisitor',
    'query must carry the vault scope because the deployed LightRAG store is physically shared',
  )
  assert.deepEqual(requests[2].body.ll_keywords, ['AXIOM_WORKSPACE:axiom_vault_a'])
  console.log('lightrag-client-workspace: all assertions passed')
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
