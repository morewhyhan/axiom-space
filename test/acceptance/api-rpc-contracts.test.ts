import assert from 'node:assert/strict'
import test from 'node:test'
import { Hono } from 'hono'
import { handleError } from '@/server/api/error'
import vaultRoutes from '@/server/api/routes/vault'
import galaxyRoutes from '@/server/api/routes/galaxy'
import learningRoutes from '@/server/api/routes/learning'
import eventRoutes from '@/server/api/routes/events'
import dashboardRoutes from '@/server/api/routes/dashboard'
import cognitionRoutes from '@/server/api/routes/cognition'
import ragRoutes from '@/server/api/routes/rag'
import { prisma } from '@/lib/db'
import { syncEdgesFromContent } from '@/lib/wiki-links'
import { writeLiveAiArtifact } from './live-ai-artifacts'

process.env.DEV_MODE = 'true'

const runId = `sdd-api-${Date.now()}-${Math.random().toString(36).slice(2)}`
const app = new Hono()
  .basePath('/api')
  .onError(handleError)
  .route('/vault', vaultRoutes)
  .route('/galaxy', galaxyRoutes)
  .route('/learning', learningRoutes)
  .route('/events', eventRoutes)
  .route('/dashboard', dashboardRoutes)
  .route('/cognition', cognitionRoutes)
  .route('/rag', ragRoutes)

test('API/RPC contracts follow the 08 test plan for vault, graph, learning, events, and boundaries', async (t) => {
  await t.test('vault write/read/update/link/delete round trip preserves ownership and link state', async () => {
    const { vault } = await createApiVault('vault-roundtrip')
    const target = await prisma.card.create({
      data: {
        vaultId: vault.id,
        path: `${runId}/target.md`,
        title: '目标概念',
        content: '# 目标概念',
        type: 'permanent',
      },
    })

    const write = await apiJson('/api/vault/write', {
      method: 'POST',
      body: {
        vaultId: vault.id,
        path: `${runId}/source.md`,
        title: 'Source',
        content: '# Source\n\n[[目标概念]]',
        type: 'fleeting',
      },
    })
    assert.equal(write.status, 200)
    assert.equal(write.body.success, true, `vault write failed: ${JSON.stringify(write.body)}`)

    const source = await prisma.card.findUniqueOrThrow({
      where: { vaultId_path: { vaultId: vault.id, path: `${runId}/source.md` } },
    })
    assert.equal(source.vaultId, vault.id)
    assert.equal(source.type, 'fleeting')

    const read = await apiJson(`/api/vault/card/${source.id}?vid=${vault.id}`)
    assert.equal(read.status, 200)
    assert.equal(read.body.card.id, source.id)

    const update = await apiJson(`/api/vault/card/${source.id}?vid=${vault.id}`, {
      method: 'PUT',
      body: {
        title: 'Source Updated',
        content: '# Source Updated\n\n[[目标概念]]',
        type: 'permanent',
      },
    })
    assert.equal(update.status, 200)
    assert.equal(update.body.card.type, 'permanent')

    const links = await apiJson(`/api/vault/card/${source.id}/links?vid=${vault.id}`)
    assert.equal(links.status, 200)
    assert.equal(links.body.links.outgoing.some((card: { id: string }) => card.id === target.id), true)
    assert.deepEqual(links.body.links.dangling, [])

    const deleted = await apiJson(`/api/vault/card/${source.id}?vid=${vault.id}`, { method: 'DELETE' })
    assert.equal(deleted.status, 200)
    assert.equal(deleted.body.success, true)
    assert.equal(await prisma.edge.count({ where: { sourceId: source.id } }), 0)

    await cleanupVault(vault.id)
  })

  await t.test('cross-vault API access returns an error without leaking target data', async () => {
    const { user, vault } = await createApiVault('boundary-owner')
    const otherUser = await prisma.user.create({
      data: {
        email: `${runId}-boundary-other@example.com`,
        name: 'Boundary Other',
        vaults: { create: { name: 'Boundary Other Vault' } },
      },
      include: { vaults: true },
    })
    const otherVault = otherUser.vaults[0]
    const otherCard = await prisma.card.create({
      data: {
        vaultId: otherVault.id,
        path: `${runId}/secret.md`,
        title: 'Secret Other Card',
        content: 'secret-other-content',
        type: 'permanent',
      },
    })

    const response = await apiJson(`/api/vault/card/${otherCard.id}?vid=${otherVault.id}`)
    assert.notEqual(response.status, 200)
    assert.equal(JSON.stringify(response.body).includes('secret-other-content'), false)
    assert.equal(JSON.stringify(response.body).includes('Secret Other Card'), false)

    assert.ok(user.id)
    await cleanupVault(vault.id)
    await prisma.user.deleteMany({ where: { id: otherUser.id } })
  })

  await t.test('galaxy API exposes clusters, nodes, edges, and cluster assignment as read models', async () => {
    const { vault } = await createApiVault('galaxy')
    const source = await createCard(vault.id, 'galaxy-source.md', 'Galaxy Source')
    const target = await createCard(vault.id, 'galaxy-target.md', 'Galaxy Target')
    const edge = await prisma.edge.create({
      data: { vaultId: vault.id, sourceId: source.id, targetId: target.id, type: 'related' },
    })

    const clusterCreate = await apiJson(`/api/galaxy/clusters?vid=${vault.id}`, {
      method: 'POST',
      body: { name: 'Graph Cluster', color: '#22c55e' },
    })
    assert.equal(clusterCreate.status, 200)
    assert.equal(clusterCreate.body.cluster.name, 'Graph Cluster')

    const assign = await apiJson(`/api/galaxy/cards/${source.id}/cluster?vid=${vault.id}`, {
      method: 'PUT',
      body: { clusterId: clusterCreate.body.cluster.id },
    })
    assert.equal(assign.status, 200)
    assert.equal(assign.body.success, true)

    const nodes = await apiJson(`/api/galaxy/nodes?vid=${vault.id}`)
    assert.equal(nodes.body.nodes.some((node: { id: string }) => node.id === source.id), true)
    assert.equal(nodes.body.nodes.some((node: { id: string }) => node.id === target.id), true)

    const edges = await apiJson(`/api/galaxy/edges?vid=${vault.id}`)
    assert.equal(edges.body.edges.some((item: { id: string }) => item.id === edge.id), true)

    const unassign = await apiJson(`/api/galaxy/cards/${source.id}/cluster?vid=${vault.id}`, { method: 'DELETE' })
    assert.equal(unassign.body.success, true)
    assert.equal((await prisma.card.findUniqueOrThrow({ where: { id: source.id } })).clusterId, null)

    await cleanupVault(vault.id)
  })

  await t.test('learning execute and progress APIs bind path, step, card, and session in one vault', async () => {
    const { user, vault } = await createApiVault('learning')
    const path = await prisma.learningPath.create({
      data: {
        userId: user.id,
        vaultId: vault.id,
        name: 'API Learning Path',
        topic: 'API Topic',
        totalSteps: 1,
        steps: {
          create: {
            order: 1,
            title: 'API Step',
            concept: 'API Concept',
            status: 'available',
          },
        },
      },
      include: { steps: true },
    })

    const execute = await apiJson(`/api/learning/path/${path.id}/execute?vid=${vault.id}`, {
      method: 'POST',
      body: { stepId: path.steps[0].id },
    })
    assert.equal(execute.status, 200)
    assert.equal(execute.body.success, true)
    assert.equal(execute.body.session.pathId, path.id)
    assert.equal(execute.body.session.stepId, path.steps[0].id)
    assert.ok(execute.body.session.cardId)
    const session = await prisma.learningSession.findUniqueOrThrow({ where: { id: execute.body.session.id } })
    const metadata = JSON.parse(session.metadata ?? '{}') as Record<string, unknown>
    assert.equal(metadata.pathId, path.id)
    assert.equal(metadata.stepId, path.steps[0].id)
    assert.equal(metadata.cardId, execute.body.session.cardId)

    const progress = await apiJson(`/api/learning/path/${path.id}/step/${path.steps[0].id}/progress?vid=${vault.id}`, {
      method: 'POST',
      body: { status: 'completed', mastery: 80, sessionId: execute.body.session.id },
    })
    assert.equal(progress.status, 200)
    assert.equal(progress.body.success, true)

    const refreshedPath = await prisma.learningPath.findUniqueOrThrow({
      where: { id: path.id },
      include: { steps: true },
    })
    assert.equal(refreshedPath.steps[0].status, 'completed')

    await cleanupVault(vault.id)
  })

  await t.test('learning progress is recalculated from persisted step states and unlocks the next eligible step', async () => {
    const { user, vault } = await createApiVault('learning-progress')
    const path = await prisma.learningPath.create({
      data: {
        userId: user.id,
        vaultId: vault.id,
        name: 'Progress Path',
        topic: 'Progress Topic',
        totalSteps: 2,
        steps: {
          create: [
            { order: 1, title: 'Progress Step 1', concept: 'Concept 1', status: 'available' },
            { order: 2, title: 'Progress Step 2', concept: 'Concept 2', status: 'locked' },
          ],
        },
      },
      include: { steps: { orderBy: { order: 'asc' } } },
    })

    const firstStep = path.steps[0]
    const secondStep = path.steps[1]
    const progress = await apiJson(`/api/learning/path/${path.id}/step/${firstStep.id}/progress?vid=${vault.id}`, {
      method: 'POST',
      body: { status: 'completed', mastery: 72 },
    })

    assert.equal(progress.status, 200)
    assert.equal(progress.body.success, true)
    assert.equal(progress.body.doneCount, 1)
    assert.equal(progress.body.totalSteps, 2)

    const refreshedPath = await prisma.learningPath.findUniqueOrThrow({
      where: { id: path.id },
      include: { steps: { orderBy: { order: 'asc' } } },
    })
    assert.equal(refreshedPath.doneSteps, 1)
    assert.equal(refreshedPath.status, 'active')
    assert.equal(refreshedPath.steps[0].status, 'completed')
    assert.equal(refreshedPath.steps[0].mastery, 72)
    assert.equal(refreshedPath.steps[1].id, secondStep.id)
    assert.equal(refreshedPath.steps[1].status, 'available')

    await cleanupVault(vault.id)
  })

  await t.test('invalid learning progress input returns an error and leaves source objects unchanged', async () => {
    const { user, vault } = await createApiVault('learning-invalid-progress')
    const path = await prisma.learningPath.create({
      data: {
        userId: user.id,
        vaultId: vault.id,
        name: 'Invalid Progress Path',
        topic: 'Invalid Progress Topic',
        totalSteps: 1,
        steps: {
          create: {
            order: 1,
            title: 'Invalid Progress Step',
            concept: 'Invalid Concept',
            status: 'available',
            mastery: 0,
          },
        },
      },
      include: { steps: true },
    })

    const step = path.steps[0]
    const invalid = await apiJson(`/api/learning/path/${path.id}/step/${step.id}/progress?vid=${vault.id}`, {
      method: 'POST',
      body: { status: 'finished', mastery: 100 },
    })

    assert.equal(invalid.status, 400)
    assert.equal(invalid.body.success, false)
    assert.equal(invalid.body.error, 'INVALID_STATUS')

    const unchangedStep = await prisma.learningPathStep.findUniqueOrThrow({ where: { id: step.id } })
    const unchangedPath = await prisma.learningPath.findUniqueOrThrow({ where: { id: path.id } })
    assert.equal(unchangedStep.status, 'available')
    assert.equal(unchangedStep.mastery, 0)
    assert.equal(unchangedPath.doneSteps, 0)
    assert.equal(unchangedPath.status, 'active')

    await cleanupVault(vault.id)
  })

  await t.test('promoting a card to permanent archives only its bound card thread', async () => {
    const { user, vault } = await createApiVault('promotion-thread')
    const promotedCard = await createCard(vault.id, 'promotion-source.md', 'Promotion Source')
    const unrelatedCard = await createCard(vault.id, 'promotion-other.md', 'Promotion Other')
    const promotedSession = await prisma.learningSession.create({
      data: {
        userId: user.id,
        vaultId: vault.id,
        domain: '__agent__',
        concept: promotedCard.title ?? 'Promotion Source',
        status: 'active',
        phase: 'explore',
        metadata: JSON.stringify({ cardId: promotedCard.id, threadStatus: 'active' }),
      },
    })
    const unrelatedSession = await prisma.learningSession.create({
      data: {
        userId: user.id,
        vaultId: vault.id,
        domain: '__agent__',
        concept: unrelatedCard.title ?? 'Promotion Other',
        status: 'active',
        phase: 'explore',
        metadata: JSON.stringify({ cardId: unrelatedCard.id, threadStatus: 'active' }),
      },
    })

    const update = await apiJson(`/api/vault/card/${promotedCard.id}?vid=${vault.id}`, {
      method: 'PUT',
      body: {
        title: promotedCard.title,
        content: `${promotedCard.content}\n\n## 定义\n可说明。\n\n## 例子\n可举例。`,
        type: 'permanent',
      },
    })

    assert.equal(update.status, 200)
    assert.equal(update.body.card.type, 'permanent')

    const archived = await prisma.learningSession.findUniqueOrThrow({ where: { id: promotedSession.id } })
    const stillActive = await prisma.learningSession.findUniqueOrThrow({ where: { id: unrelatedSession.id } })
    const archivedMetadata = JSON.parse(archived.metadata ?? '{}') as Record<string, unknown>
    assert.equal(archived.status, 'completed')
    assert.equal(archived.phase, 'archived')
    assert.equal(archivedMetadata.cardId, promotedCard.id)
    assert.equal(archivedMetadata.cardType, 'permanent')
    assert.equal(archivedMetadata.threadStatus, 'archived')
    assert.equal(typeof archivedMetadata.archivedAt, 'string')
    assert.equal(stillActive.status, 'active')
    assert.equal(stillActive.phase, 'explore')

    await cleanupVault(vault.id)
  })

  await t.test('events API reports unread notifications and dismisses without mutating domain objects', async () => {
    const { vault } = await createApiVault('events')
    const card = await createCard(vault.id, 'event-card.md', 'Event Card')
    await prisma.vaultMemory.create({
      data: {
        vaultId: vault.id,
        key: `notif_test_${runId}`,
        value: JSON.stringify({ type: 'toast', message: 'hello', timestamp: Date.now() }),
        category: 'notification',
      },
    })

    const unread = await apiJson(`/api/events/unread?vid=${vault.id}`)
    assert.equal(unread.status, 200)
    assert.ok(unread.body.count >= 1)

    const dismiss = await apiJson(`/api/events/dismiss?vid=${vault.id}`, { method: 'POST', body: { all: true } })
    assert.equal(dismiss.status, 200)
    assert.equal(dismiss.body.success, true)
    assert.equal(await prisma.card.count({ where: { id: card.id } }), 1)

    await cleanupVault(vault.id)
  })

  await t.test('dashboard and cognition read models expose source-backed data without mutating source tables', async () => {
    const { user, vault } = await createApiVault('read-models')
    const cluster = await prisma.cluster.create({
      data: { vaultId: vault.id, name: 'Read Model Cluster', color: '#14b8a6' },
    })
    const source = await prisma.card.create({
      data: {
        vaultId: vault.id,
        clusterId: cluster.id,
        path: `${runId}/read-source.md`,
        title: 'Read Source',
        content: '# Read Source\n\nA rich permanent card with enough content for cognition.',
        type: 'permanent',
        tags: JSON.stringify(['read-model', 'cognition']),
      },
    })
    const target = await createCard(vault.id, 'read-target.md', 'Read Target')
    await prisma.edge.create({
      data: { vaultId: vault.id, sourceId: source.id, targetId: target.id, type: 'related', weight: 1 },
    })
    await prisma.learningSession.create({
      data: {
        userId: user.id,
        vaultId: vault.id,
        domain: 'read-model',
        concept: 'Read Model',
        status: 'completed',
        phase: 'completed',
      },
    })

    const before = await sourceTableSnapshot(vault.id)
    const dashboard = await apiJson(`/api/dashboard?vid=${vault.id}`)
    assert.equal(dashboard.status, 200)
    assert.equal(dashboard.body.success, true)
    assert.equal(dashboard.body.stats.totalNodes, 2)
    assert.equal(dashboard.body.stats.totalEdges, 1)
    assert.equal(dashboard.body.stats.permanent, 1)
    assert.equal(dashboard.body.stats.fleeting, 1)

    const cognition = await apiJson(`/api/cognition/stats?vid=${vault.id}`)
    assert.equal(cognition.status, 200)
    assert.equal(cognition.body.success, true)
    assert.equal(cognition.body.stats.totalCards, 2)
    assert.equal(cognition.body.stats.permanentCards, 1)
    assert.equal(Array.isArray(cognition.body.nextActions), true)

    const after = await sourceTableSnapshot(vault.id)
    assert.deepEqual(after, before)

    await cleanupVault(vault.id)
  })

  await t.test('vault search routes return scoped matches and titles for the active vault only', async () => {
    const { vault } = await createApiVault('search')
    const otherUser = await prisma.user.create({
      data: {
        email: `${runId}-search-other@example.com`,
        name: 'Search Other',
        vaults: { create: { name: 'Search Other Vault' } },
      },
      include: { vaults: true },
    })
    const otherVault = otherUser.vaults[0]

    const matchCard = await prisma.card.create({
      data: {
        vaultId: vault.id,
        path: `${runId}/search-match.md`,
        title: 'Search Match',
        content: '# Search Match\n\nAlpha keyword appears here.',
        type: 'fleeting',
      },
    })
    await prisma.card.create({
      data: {
        vaultId: otherVault.id,
        path: `${runId}/search-match-other.md`,
        title: 'Search Match Other',
        content: '# Search Match Other\n\nAlpha keyword should not leak.',
        type: 'fleeting',
      },
    })

    const titleResults = await apiJson(`/api/vault/search-titles?q=Search&vid=${vault.id}`)
    assert.equal(titleResults.status, 200)
    assert.equal(titleResults.body.success, true)
    assert.equal(titleResults.body.results.some((item: { id: string }) => item.id === matchCard.id), true)
    assert.equal(titleResults.body.results.some((item: { title: string }) => item.title === 'Search Match Other'), false)

    const contentResults = await apiJson(`/api/vault/search?q=Alpha&vid=${vault.id}`)
    assert.equal(contentResults.status, 200)
    assert.equal(contentResults.body.success, true)
    assert.equal(Array.isArray(contentResults.body.results), true)
    assert.equal(contentResults.body.results.some((item: { title: string }) => item.title === 'Search Match Other'), false)

    await cleanupVault(vault.id)
    await prisma.user.deleteMany({ where: { id: otherUser.id } })
  })

  await t.test('rag routes expose disabled status and reject foreign cards without leaking data', async () => {
    const { vault } = await createApiVault('rag')
    const card = await prisma.card.create({
      data: {
        vaultId: vault.id,
        path: `${runId}/rag-card.md`,
        title: 'RAG Card',
        content: '# RAG Card\n\nZyphor-Alpha-2026 is a unique integration token for the real LightRAG test.',
        type: 'permanent',
      },
    })
    const otherUser = await prisma.user.create({
      data: {
        email: `${runId}-rag-other@example.com`,
        name: 'RAG Other',
        vaults: { create: { name: 'RAG Other Vault' } },
      },
      include: { vaults: true },
    })
    const otherVault = otherUser.vaults[0]
    const foreignCard = await createCard(otherVault.id, 'rag-foreign.md', 'Foreign RAG Card')

    const status = await apiJson(`/api/rag/status?vid=${vault.id}`)
    assert.equal(status.status, 200)
    assert.equal(status.body.success, true)
    assert.equal(status.body.status.provider, 'lightrag')
    assert.equal(status.body.status.enabled, true)
    assert.equal(status.body.status.health.ok, true)

    const sync = await apiJson(`/api/rag/card/${card.id}/sync?vid=${vault.id}`, { method: 'POST' })
    assert.equal(sync.status, 200)
    assert.equal(sync.body.success, true)

    const ownCardStatus = await waitForRagCardStatus(vault.id, card.id, 'indexed')
    assert.equal(ownCardStatus.provider, 'lightrag')
    assert.equal(ownCardStatus.synced, true)

    const query = await apiJson(`/api/rag/query?vid=${vault.id}`, {
      method: 'POST',
      body: { query: 'Zyphor-Alpha-2026', mode: 'mix', topK: 3 },
    })
    assert.equal(query.status, 200)
    assert.equal(query.body.success, true)
    assert.equal(query.body.result.enabled, true)
    assert.equal(typeof query.body.result.answer, 'string')
    assert.equal(query.body.result.answer.length > 0, true)
    assert.equal(Array.isArray(query.body.result.references), true)
    assert.equal(query.body.result.references.some((ref: { cardId: string | null }) => ref.cardId === card.id), true)

    const foreignSync = await apiJson(`/api/rag/card/${foreignCard.id}/sync?vid=${vault.id}`, { method: 'POST' })
    assert.equal(foreignSync.status, 404)
    assert.equal(JSON.stringify(foreignSync.body).includes('Foreign RAG Card'), false)

    await cleanupVault(vault.id)
    await prisma.user.deleteMany({ where: { id: otherUser.id } })
  })

  await t.test('real DeepSeek extraction can seed the real LightRAG index and be queried back', async () => {
    const { vault } = await createApiVault('import-document-real')
    const document = [
      '# Zeta Graph',
      '',
      'Zeta Graph uses ownership, borrowing, and lifetime rules to keep memory safe.',
      'The document explicitly introduces one core concept and one supporting example.',
      '',
      '## Ownership',
      'Ownership decides which value is responsible for releasing memory.',
      '',
      '## Borrowing',
      'Borrowing allows temporary access without transferring ownership.',
    ].join('\n')

    const extracted = await extractStructuredDocumentWithDeepSeek({
      document,
      topic: 'Zeta Graph',
      sourceTitle: 'Zeta Graph Primer',
    })

    assert.equal(extracted.title.length > 0, true)
    assert.equal(extracted.concepts.length > 0, true)

    const cluster = await prisma.cluster.create({
      data: {
        vaultId: vault.id,
        name: 'Zeta Graph',
        color: '#7c3aed',
      },
    })

    const conceptCards: Array<{ id: string; title: string }> = []
    for (const concept of extracted.concepts) {
      const card = await prisma.card.create({
        data: {
          vaultId: vault.id,
          clusterId: cluster.id,
          path: `${runId}/import-document-real/concepts/${concept.name.replace(/[/\\]/g, '_')}.md`,
          title: concept.name,
          content: `## ${concept.name}\n\n${concept.description}\n\n---\n_Real DeepSeek extraction for LightRAG integration test_`,
          type: 'permanent',
          tags: JSON.stringify(['Zeta Graph', 'core']),
        },
      })
      conceptCards.push({ id: card.id, title: card.title })
    }

    for (const fleeting of extracted.fleetingCards) {
      const linksSection = fleeting.linksTo && fleeting.linksTo.length > 0
        ? `\n\n**关联概念：** ${[...new Set(fleeting.linksTo)].map((t) => `[[${t}]]`).join('、')}`
        : ''
      await prisma.card.create({
        data: {
          vaultId: vault.id,
          clusterId: cluster.id,
          path: `${runId}/import-document-real/fleeting/${fleeting.title.replace(/[/\\]/g, '_')}.md`,
          title: fleeting.title,
          content: `## ${fleeting.title}\n\n${fleeting.content}${linksSection}\n\n---\n_Real DeepSeek extraction for LightRAG integration test_`,
          type: 'fleeting',
          tags: JSON.stringify(['Zeta Graph', 'idea']),
        },
      })
    }

    const literature = await prisma.card.create({
      data: {
        vaultId: vault.id,
        clusterId: cluster.id,
        path: `${runId}/import-document-real/literature/${extracted.title.replace(/[/\\]/g, '_')}.md`,
        title: extracted.title,
        content: `## ${extracted.title}\n\n> Real DeepSeek extraction source.\n\n**主题：** Zeta Graph\n\n---\n_Real DeepSeek extraction for LightRAG integration test_`,
        type: 'literature',
        tags: JSON.stringify(['Zeta Graph', 'reference']),
      },
    })

    await syncEdgesFromContentForVault(vault.id)

    const sync = await apiJson(`/api/rag/card/${conceptCards[0].id}/sync?vid=${vault.id}`, {
      method: 'POST',
    })
    assert.equal(sync.status, 200)
    assert.equal(sync.body.success, true)

    const indexed = await waitForRagCardStatus(vault.id, conceptCards[0].id, 'indexed')
    assert.equal(indexed.synced, true)

    const query = await apiJson(`/api/rag/query?vid=${vault.id}`, {
      method: 'POST',
      body: { query: conceptCards[0].title, mode: 'mix', topK: 3 },
    })
    assert.equal(query.status, 200)
    assert.equal(query.body.success, true)
    assert.equal(query.body.result.enabled, true)
    assert.equal(typeof query.body.result.answer, 'string')
    assert.equal(query.body.result.answer.length > 0, true)
    assert.equal(query.body.result.references.some((ref: { cardId: string | null }) => ref.cardId === conceptCards[0].id), true)

    assert.equal(await prisma.card.count({ where: { id: literature.id } }), 1)
    await cleanupVault(vault.id)
  })

  await t.test('learning path adjustments are persisted and can be accepted through the API', async () => {
    const { user, vault } = await createApiVault('path-adjustments')
    const pathCard = await prisma.card.create({
      data: {
        vaultId: vault.id,
        path: `${runId}/adjustment-card.md`,
        title: 'Adjustment Card',
        content: '# Adjustment Card\n\nExplain how the step works.',
        type: 'fleeting',
      },
    })
    const path = await prisma.learningPath.create({
      data: {
        userId: user.id,
        vaultId: vault.id,
        name: 'Adjustment Path',
        topic: 'Adjustment Topic',
        totalSteps: 1,
        steps: {
          create: {
            order: 1,
            title: 'Adjustment Step',
            concept: 'Adjustment Concept',
            status: 'available',
            cardId: pathCard.id,
          },
        },
      },
      include: { steps: true },
    })

    const session = await prisma.learningSession.create({
      data: {
        userId: user.id,
        vaultId: vault.id,
        domain: '__agent__',
        concept: 'Adjustment Step',
        status: 'active',
        phase: 'explore',
        metadata: JSON.stringify({ pathId: path.id, stepId: path.steps[0].id, cardId: pathCard.id }),
      },
    })
    await prisma.learningMessage.create({
      data: {
        sessionId: session.id,
        role: 'user',
        content: 'I can explain this step in my own words.',
      },
    })

    const progress = await apiJson(`/api/learning/path/${path.id}/step/${path.steps[0].id}/progress?vid=${vault.id}`, {
      method: 'POST',
      body: { status: 'completed', mastery: 50, sessionId: session.id },
    })
    assert.equal(progress.status, 200)
    assert.equal(progress.body.success, true)

    const adjustments = await apiJson(`/api/learning/path-adjustments?vid=${vault.id}&pathId=${path.id}`)
    assert.equal(adjustments.status, 200)
    assert.equal(adjustments.body.success, true)
    assert.ok(adjustments.body.adjustmentHistory.length >= 1)
    assert.equal(adjustments.body.adjustmentHistory[0].trigger, 'assessment')
    assert.ok(adjustments.body.adjustmentHistory[0].adjustment.reason)

    await writeLiveAiArtifact(`${runId}/learning-path-adjustments.json`, {
      runId,
      capturedAt: new Date().toISOString(),
      vaultId: vault.id,
      pathId: path.id,
      response: adjustments.body,
    })

    const adjustmentId = adjustments.body.adjustmentHistory[0].id as string
    const accept = await apiJson(`/api/learning/path/${path.id}/adjustment/${adjustmentId}/accept?vid=${vault.id}`, {
      method: 'POST',
      body: { feedback: 'acknowledged' },
    })
    assert.equal(accept.status, 200)
    assert.equal(accept.body.success, true)

    const persistedAdjustment = await prisma.pathAdjustmentHistory.findUniqueOrThrow({ where: { id: adjustmentId } })
    const parsedFeedback = JSON.parse(persistedAdjustment.feedback ?? '{}') as Record<string, unknown>
    assert.equal(parsedFeedback.userFeedback, 'acknowledged')
    assert.ok(parsedFeedback.acceptedAt)

    await cleanupVault(vault.id)
  })

  await t.test('learning memory search returns content-scoped matches within the active vault', async () => {
    const { user } = await createApiVault('learning-memory')
    const vault = await prisma.vault.findFirstOrThrow({
      where: { userId: user.id },
      orderBy: { createdAt: 'asc' },
    })
    const matchCard = await prisma.card.create({
      data: {
        vaultId: vault.id,
        path: `${runId}/learning-memory-match.md`,
        title: 'Learning Memory Match',
        content: '# Learning Memory Match\n\nStacks are last-in first-out structures.',
        type: 'fleeting',
      },
    })
    await prisma.card.create({
      data: {
        vaultId: vault.id,
        path: `${runId}/learning-memory-other.md`,
        title: 'Learning Memory Other',
        content: '# Learning Memory Other\n\nQueues are first-in first-out structures.',
        type: 'fleeting',
      },
    })

    const result = await apiJson('/api/learning/memory', {
      method: 'POST',
      body: { query: 'Stacks', limit: 5 },
    })

    assert.equal(result.status, 200)
    assert.equal(result.body.success, true)
    assert.equal(Array.isArray(result.body.results), true)
    assert.equal(result.body.results.some((item: { id: string }) => item.id === matchCard.id), true)
    assert.equal(result.body.results.some((item: { title: string }) => item.title === 'Learning Memory Other'), false)

    await cleanupVault(vault.id)
  })

  await t.test('learning import-document rejects invalid payloads before any AI work starts', async () => {
    const { vault } = await createApiVault('import-document-invalid')

    const missingFields = await apiJson('/api/learning/import-document', {
      method: 'POST',
      body: { document: '', topic: '' },
    })
    assert.equal(missingFields.status, 400)
    assert.equal(missingFields.body.success, false)
    assert.equal(missingFields.body.error, 'DOCUMENT_AND_TOPIC_REQUIRED')

    const tooLong = await apiJson('/api/learning/import-document', {
      method: 'POST',
      body: {
        document: 'x'.repeat(50001),
        topic: 'Too Long Topic',
      },
    })
    assert.equal(tooLong.status, 400)
    assert.equal(tooLong.body.success, false)
    assert.equal(tooLong.body.error, 'DOCUMENT_TOO_LONG')

    assert.equal(await prisma.card.count({ where: { vaultId: vault.id } }), 0)

    await cleanupVault(vault.id)
  })

  await t.test('learning push resource APIs filter expired pushes and persist feedback', async () => {
    const { user } = await createApiVault('push-resources')
    const vault = await prisma.vault.findFirstOrThrow({
      where: { userId: user.id },
      orderBy: { createdAt: 'asc' },
    })
    await prisma.pushRecord.deleteMany({
      where: { userId: user.id, vaultId: vault.id },
    })
    const activePush = await prisma.pushRecord.create({
      data: {
        userId: user.id,
        vaultId: vault.id,
        resources: JSON.stringify([{ id: 'resource-a', type: 'diagram', targetType: 'card', targetId: 'card-a' }]),
        trigger: 'assessment_pass',
        reason: 'mastery advanced',
        expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      },
    })
    await prisma.pushRecord.create({
      data: {
        userId: user.id,
        vaultId: vault.id,
        resources: JSON.stringify([{ id: 'resource-b', type: 'diagram', targetType: 'card', targetId: 'card-b' }]),
        trigger: 'scheduled',
        reason: 'expired',
        expiresAt: new Date(Date.now() - 24 * 3600 * 1000),
      },
    })

    const list = await apiJson(`/api/learning/push-resources?vid=${vault.id}`)
    assert.equal(list.status, 200)
    assert.equal(list.body.success, true)
    assert.equal(list.body.records.length, 1)
    assert.equal(list.body.records[0].id, activePush.id)

    const feedback = await apiJson(`/api/learning/push-feedback?vid=${vault.id}`, {
      method: 'POST',
      body: {
        pushId: activePush.id,
        engagedResourceIds: ['resource-a'],
        feedbackText: 'useful',
      },
    })
    assert.equal(feedback.status, 200)
    assert.equal(feedback.body.success, true)

    const updatedPush = await prisma.pushRecord.findUniqueOrThrow({ where: { id: activePush.id } })
    const parsedFeedback = JSON.parse(updatedPush.feedback ?? '{}') as Record<string, unknown>
    assert.equal(updatedPush.viewedAt instanceof Date, true)
    assert.equal(updatedPush.engagedCount, 1)
    assert.deepEqual(parsedFeedback.engagedResourceIds, ['resource-a'])

    await cleanupVault(vault.id)
  })

  await t.test('vault export is permission scoped and does not mutate exported source objects', async () => {
    const { vault } = await createApiVault('export')
    const exportedCard = await createCard(vault.id, 'export-card.md', 'Export Card')
    const otherUser = await prisma.user.create({
      data: {
        email: `${runId}-export-other@example.com`,
        name: 'Export Other',
        vaults: { create: { name: 'Export Other Vault' } },
      },
      include: { vaults: true },
    })
    const otherVault = otherUser.vaults[0]

    const before = await sourceTableSnapshot(vault.id)
    const exportResponse = await apiRaw(`/api/vault/export?vid=${vault.id}`)
    const exportFailureBody = exportResponse.status === 200 ? '' : await exportResponse.clone().text()
    assert.equal(exportResponse.status, 200, exportFailureBody)
    assert.match(exportResponse.headers.get('content-type') ?? '', /application\/zip/)
    assert.match(exportResponse.headers.get('content-disposition') ?? '', /vault-export\.zip/)
    assert.ok((await exportResponse.arrayBuffer()).byteLength > 0)
    assert.deepEqual(await sourceTableSnapshot(vault.id), before)
    assert.equal(await prisma.card.count({ where: { id: exportedCard.id } }), 1)

    const forbidden = await apiJson(`/api/vault/export?vid=${otherVault.id}`)
    assert.equal(forbidden.status, 403)
    assert.equal(forbidden.body.success, false)
    assert.equal(JSON.stringify(forbidden.body).includes(otherVault.name), false)

    await cleanupVault(vault.id)
    await prisma.user.deleteMany({ where: { id: otherUser.id } })
  })

  await t.test('deleting a literature card removes manifest resource cards and graph edges in the same vault', async () => {
    const { vault } = await createApiVault('resource-delete')
    const resourcePath = 'resources/resource-pack/document.md'
    const resourceCard = await prisma.card.create({
      data: {
        vaultId: vault.id,
        path: resourcePath,
        title: 'Generated Resource Document',
        content: '# Generated Resource Document',
        type: 'literature',
      },
    })
    const literatureCard = await prisma.card.create({
      data: {
        vaultId: vault.id,
        path: `${runId}/resource-pack.md`,
        title: 'Resource Pack',
        type: 'literature',
        content: `# Resource Pack\n\n<!-- axiom-resources:${JSON.stringify([
          { type: 'document', path: resourcePath, status: 'ready' },
        ])} -->`,
      },
    })
    const edge = await prisma.edge.create({
      data: {
        vaultId: vault.id,
        sourceId: literatureCard.id,
        targetId: resourceCard.id,
        type: 'related',
      },
    })

    const deleted = await apiJson(`/api/vault/card/${literatureCard.id}?vid=${vault.id}`, { method: 'DELETE' })
    assert.equal(deleted.status, 200)
    assert.equal(deleted.body.success, true)
    assert.deepEqual(deleted.body.deletedResourceCardIds, [resourceCard.id])
    assert.equal(await prisma.card.count({ where: { id: literatureCard.id } }), 0)
    assert.equal(await prisma.card.count({ where: { id: resourceCard.id } }), 0)
    assert.equal(await prisma.edge.count({ where: { id: edge.id } }), 0)

    await cleanupVault(vault.id)
  })
})

async function createApiVault(label: string) {
  let user = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } })
  if (!user) {
    user = await prisma.user.create({
      data: {
        email: `${runId}-${label}@example.com`,
        name: `SDD API ${label}`,
      },
    })
  }

  const vault = await prisma.vault.create({
    data: {
      userId: user.id,
      name: `SDD API ${label} Vault`,
    },
  })

  return { user, vault }
}

function createCard(vaultId: string, path: string, title: string) {
  return prisma.card.create({
    data: {
      vaultId,
      path: `${runId}/${path}`,
      title,
      content: `# ${title}`,
      type: 'fleeting',
    },
  })
}

async function apiJson(path: string, init: { method?: string; body?: unknown } = {}) {
  const response = await apiRaw(path, init)
  const text = await response.text()
  const body = text ? JSON.parse(text) : null
  return { status: response.status, body }
}

function apiRaw(path: string, init: { method?: string; body?: unknown } = {}) {
  return app.request(path, {
    method: init.method ?? 'GET',
    headers: init.body ? { 'content-type': 'application/json' } : undefined,
    body: init.body ? JSON.stringify(init.body) : undefined,
  })
}

async function waitForRagCardStatus(vaultId: string, cardId: string, expectedStatus: string, timeoutMs = 120_000) {
  const startedAt = Date.now()
  let lastStatus = 'unknown'

  while (Date.now() - startedAt < timeoutMs) {
    const response = await apiJson(`/api/rag/card/${cardId}/status?vid=${vaultId}`)
    const current = response.body?.status?.status
    if (typeof current === 'string') {
      lastStatus = current
      if (current === expectedStatus) return response.body.status
      if (current === 'failed') {
        throw new Error(`LightRAG indexing failed for ${cardId}: ${JSON.stringify(response.body.status)}`)
      }
    }
    await delay(2000)
  }

  throw new Error(`Timed out waiting for LightRAG card ${cardId} to reach ${expectedStatus}; last status: ${lastStatus}`)
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function syncEdgesFromContentForVault(vaultId: string) {
  const cards = await prisma.card.findMany({
    where: { vaultId, content: { contains: '[[' } },
    select: { id: true, content: true },
  })
  for (const card of cards) {
    await syncEdgesFromContent(prisma, card.id, vaultId, card.content)
  }
}

async function extractStructuredDocumentWithDeepSeek(params: {
  document: string
  topic: string
  sourceTitle: string
}): Promise<{
  title: string
  concepts: Array<{ name: string; description: string }>
  fleetingCards: Array<{ title: string; content: string; linksTo: string[] }>
  relations: Array<{ from: string; to: string; type: 'prerequisite' | 'related' | 'derived' }>
}> {
  const apiKey = process.env.AI_API_KEY?.trim()
  if (!apiKey) throw new Error('AI_API_KEY is required for the real DeepSeek integration test')

  const systemPrompt = [
    'You extract structured learning content from a document.',
    'Return JSON only, no markdown, no explanation.',
    'The JSON object must contain title, concepts, fleetingCards, and relations.',
    'The exact schema is:',
    '{"title":"string","concepts":[{"name":"string","description":"string"}],"fleetingCards":[{"title":"string","content":"string","linksTo":["string"]}],"relations":[{"from":"string","to":"string","type":"prerequisite|related|derived"}]}',
  ].join(' ')
  const userPrompt = [
    'Extract a compact JSON object from the document below.',
    'Rules:',
    '- title must be a string',
    '- concepts must contain 1-4 items and each item must have name and description',
    '- fleetingCards must contain 1-4 items and each item must have title, content, and linksTo',
    '- relations may be empty but each item must have from, to, and type',
    '- linksTo must reference concept names that exist in concepts',
    '- use the exact field names in the schema above',
    '',
    `Topic: ${params.topic}`,
    `Source title: ${params.sourceTitle}`,
    '',
    'Document:',
    params.document,
  ].join('\n')

  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      temperature: 0,
      max_tokens: 2048,
      messages: [
        {
          role: 'system',
          content: systemPrompt,
        },
        {
          role: 'user',
          content: userPrompt,
        },
      ],
    }),
  })

  if (!response.ok) {
    throw new Error(`DeepSeek API error ${response.status}: ${await response.text()}`)
  }

  const body = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const content = body.choices?.[0]?.message?.content
  if (typeof content !== 'string') {
    throw new Error(`DeepSeek returned no textual content: ${JSON.stringify(body).slice(0, 1000)}`)
  }
  const cleaned = content.replace(/```(?:json)?\s*/g, '').replace(/\s*```/g, '')
  const match = cleaned.match(/\{[\s\S]*\}/)
  if (!match) throw new Error(`DeepSeek returned non-JSON content: ${content.slice(0, 500)}`)

  const parsed = JSON.parse(match[0]) as {
    title?: unknown
    concepts?: Array<Record<string, unknown>>
    fleetingCards?: Array<Record<string, unknown>>
    relations?: Array<Record<string, unknown>>
  }

  const concepts = (parsed.concepts ?? [])
    .map((item) => ({
      name: String(item.name ?? item.title ?? item.concept ?? '').trim(),
      description: String(item.description ?? item.content ?? '').trim(),
    }))
    .filter((item) => item.name.length > 0 && item.description.length > 0)

  const fleetingCards = (parsed.fleetingCards ?? [])
    .map((item) => ({
      title: String(item.title ?? item.name ?? '').trim(),
      content: String(item.content ?? item.description ?? '').trim(),
      linksTo: Array.isArray(item.linksTo)
        ? item.linksTo.map((value) => String(value).trim()).filter(Boolean)
        : [],
    }))
    .filter((item) => item.title.length > 0 && item.content.length > 0)

  const relations = (parsed.relations ?? [])
    .map((item) => ({
      from: String(item.from ?? item.source ?? '').trim(),
      to: String(item.to ?? item.target ?? '').trim(),
      type: String(item.type ?? 'related') as 'prerequisite' | 'related' | 'derived',
    }))
    .filter((item) => item.from.length > 0 && item.to.length > 0)

  await writeLiveAiArtifact(`${runId}/api-real-deepseek.json`, {
    runId,
    capturedAt: new Date().toISOString(),
    apiKeyPresent: true,
    provider: 'deepseek',
    modelId: 'deepseek-chat',
    systemPrompt,
    userPrompt,
    rawResponse: content,
    cleanedResponse: cleaned,
    parsed: {
      title: parsed.title,
      concepts: parsed.concepts,
      fleetingCards: parsed.fleetingCards,
      relations: parsed.relations,
    },
    normalized: {
      title: String(parsed.title ?? params.sourceTitle ?? params.topic).trim(),
      concepts,
      fleetingCards,
      relations,
    },
  })

  return {
    title: String(parsed.title ?? params.sourceTitle ?? params.topic).trim(),
    concepts,
    fleetingCards,
    relations,
  }
}

async function sourceTableSnapshot(vaultId: string) {
  const [cards, edges, sessions, capabilities, memories, skills, histories] = await Promise.all([
    prisma.card.findMany({ where: { vaultId }, select: { id: true, path: true, title: true, content: true, type: true, clusterId: true, tags: true }, orderBy: { id: 'asc' } }),
    prisma.edge.findMany({ where: { vaultId }, select: { id: true, sourceId: true, targetId: true, type: true, weight: true }, orderBy: { id: 'asc' } }),
    prisma.learningSession.findMany({ where: { vaultId }, select: { id: true, status: true, phase: true, metadata: true }, orderBy: { id: 'asc' } }),
    prisma.vaultCapability.findMany({ where: { vaultId }, select: { id: true, concept: true, masteryLevel: true, status: true, weakAreas: true, strongAreas: true }, orderBy: { id: 'asc' } }),
    prisma.vaultMemory.findMany({ where: { vaultId, category: { not: 'notification' } }, select: { id: true, key: true, value: true, category: true }, orderBy: { id: 'asc' } }),
    prisma.vaultSkill.findMany({ where: { vaultId }, select: { id: true, name: true, evidence: true, source: true }, orderBy: { id: 'asc' } }),
    prisma.educationProfileHistory.findMany({ where: { vaultId }, select: { id: true, profile: true, snapshot: true }, orderBy: { id: 'asc' } }),
  ])
  return { cards, edges, sessions, capabilities, memories, skills, histories }
}

async function cleanupVault(vaultId: string) {
  await prisma.vault.deleteMany({ where: { id: vaultId } })
}
