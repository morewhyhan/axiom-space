import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { QdrantClient } from '@/server/infra/rag/qdrant-client'

async function run() {
  const requests: Array<{ method: string; url: string; body: Record<string, unknown> }> = []
  const server = createServer(async (request, response) => {
    let raw = ''
    for await (const chunk of request) raw += Buffer.from(chunk).toString('utf8')
    requests.push({ method: request.method || '', url: request.url || '', body: raw ? JSON.parse(raw) : {} })
    response.setHeader('content-type', 'application/json')
    if (request.method === 'GET') response.end(JSON.stringify({ result: { status: 'green' } }))
    else if (request.url?.includes('/points/query')) response.end(JSON.stringify({ result: { points: [{ id: 'card-1', score: 0.9, payload: { vaultId: 'vault-a', cardId: 'card-1', title: 'Visitor', path: 'visitor.md', type: 'permanent', contentHash: 'hash' } }] } }))
    else response.end(JSON.stringify({ result: { status: 'completed' } }))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert(address && typeof address === 'object')
  const client = new QdrantClient(`http://127.0.0.1:${address.port}`, 'axiom_cards')

  await client.ensureCollection(1024)
  await client.upsert([{ id: 'card-1', vector: [0.1, 0.2], payload: { vaultId: 'vault-a', cardId: 'card-1', title: 'Visitor', path: 'visitor.md', type: 'permanent', contentHash: 'hash' } }])
  const hits = await client.search([0.1, 0.2], 'vault-a', 8)
  server.close()
  await once(server, 'close')

  assert.equal(hits[0]?.payload.cardId, 'card-1')
  const search = requests.find((item) => item.url.includes('/points/query'))
  assert(search)
  assert.deepEqual(search.body.filter, { must: [{ key: 'vaultId', match: { value: 'vault-a' } }] })
  assert.equal(search.body.limit, 8)
  console.log('qdrant-client: all assertions passed')
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
