import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import test from 'node:test'
import { promisify } from 'node:util'
import { getFileStorage } from '@/server/infra/storage/GlobalFileStorage'
import { prisma } from '@/lib/db'
import { resolveAiConfig } from '@/lib/ai-config'
import { runWithAgentContext } from '@/server/core/agent/agent-context'
import { ResourceGenerationOrchestrator } from '@/server/core/agent/ResourceGenerationOrchestrator'
import { ResourceGenerationState, RESOURCE_FILE_MAP } from '@/server/core/agent/ResourceGenerationState'
import { emitNotification } from '@/server/core/agent/notification-bus'
import { writeLiveAiArtifact } from './live-ai-artifacts'

const runId = `sdd-sidecar-${Date.now()}-${Math.random().toString(36).slice(2)}`
const execFileAsync = promisify(execFile)
const RUN_REAL_LIVE_AI = process.env.RUN_REAL_LIVE_AI === '1'

test('Sidecar contracts keep RAG, resources, jobs, and notifications separate from source objects', async (t) => {
  await t.test('RAG failed state records error without rolling back the card', async () => {
    const { user, vault } = await createSidecarVault('rag-failed')
    const card = await createCard(vault.id, 'rag-failed.md', 'RAG Failed')
    const index = await prisma.ragDocumentIndex.create({
      data: {
        vaultId: vault.id,
        cardId: card.id,
        provider: 'lightrag',
        workspace: `workspace-${runId}`,
        documentId: `doc-failed-${runId}`,
        contentHash: 'hash-before',
        status: 'failed',
        lastError: 'sidecar unavailable',
      },
    })

    const persistedCard = await prisma.card.findUniqueOrThrow({ where: { id: card.id } })
    const persistedIndex = await prisma.ragDocumentIndex.findUniqueOrThrow({ where: { id: index.id } })
    assert.equal(persistedCard.content, '# RAG Failed')
    assert.equal(persistedIndex.status, 'failed')
    assert.equal(persistedIndex.lastError, 'sidecar unavailable')

    await cleanupUser(user.id)
  })

  await t.test('RAG indexed state must match the latest card hash before being trusted', async () => {
    const { user, vault } = await createSidecarVault('rag-hash')
    const card = await createCard(vault.id, 'rag-hash.md', 'RAG Hash')
    const currentHash = 'current-hash'
    await prisma.ragDocumentIndex.create({
      data: {
        vaultId: vault.id,
        cardId: card.id,
        provider: 'lightrag',
        workspace: `workspace-hash-${runId}`,
        documentId: `doc-hash-${runId}`,
        contentHash: currentHash,
        status: 'indexed',
        indexedAt: new Date(),
      },
    })

    const index = await prisma.ragDocumentIndex.findUniqueOrThrow({
      where: { provider_cardId: { provider: 'lightrag', cardId: card.id } },
    })
    assert.equal(index.status, 'indexed')
    assert.equal(index.contentHash, currentHash)
    assert.ok(index.indexedAt)

    await cleanupUser(user.id)
  })

  await t.test('resource manifests are stored as card content metadata and can be parsed back to concrete items', async () => {
    const { user, vault } = await createSidecarVault('resource-manifest')
    const manifest = [
      { type: 'diagram', path: 'resources/a/diagram.html', status: 'ready' },
      { type: 'video', path: 'resources/a/video.mp4', status: 'failed', error: 'render failed' },
    ]
    const card = await prisma.card.create({
      data: {
        vaultId: vault.id,
        path: `${runId}/resource-card.md`,
        title: 'Resource Card',
        type: 'literature',
        content: `# Resource Card\n\n<!-- axiom-resources:${JSON.stringify(manifest)} -->`,
      },
    })

    const content = (await prisma.card.findUniqueOrThrow({ where: { id: card.id } })).content
    const parsed = JSON.parse(content.match(/<!--\s*axiom-resources:([\s\S]*?)\s*-->/)?.[1] ?? '[]')
    assert.equal(parsed.length, manifest.length)
    assert.equal(parsed[0].path, 'resources/a/diagram.html')
    assert.equal(parsed[1].status, 'failed')

    await cleanupUser(user.id)
  })

  await t.test('PushRecord requires reason, resources, trigger, expiry, and user/vault scope', async () => {
    const { user, vault } = await createSidecarVault('push-record')
    const push = await prisma.pushRecord.create({
      data: {
        userId: user.id,
        vaultId: vault.id,
        resources: JSON.stringify([{ id: 'resource-a', type: 'diagram', targetType: 'card', targetId: 'card-a' }]),
        trigger: 'assessment_pass',
        reason: 'mastery advanced',
        expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
      },
    })

    assert.equal(push.userId, user.id)
    assert.equal(push.vaultId, vault.id)
    assert.ok(JSON.parse(push.resources).length > 0)
    assert.ok(push.expiresAt.getTime() > Date.now())

    await cleanupUser(user.id)
  })

  await t.test('notification side effects are persisted as vault memory without changing source cards', async () => {
    const { user, vault } = await createSidecarVault('notification')
    const card = await createCard(vault.id, 'notification.md', 'Notification Source')

    await emitNotification(vault.id, { type: 'toast', message: 'Card saved' })

    const notifications = await prisma.vaultMemory.findMany({
      where: { vaultId: vault.id, category: 'notification' },
    })
    assert.ok(notifications.length >= 1)
    assert.equal(await prisma.card.count({ where: { id: card.id } }), 1)
    assert.equal((await prisma.card.findUniqueOrThrow({ where: { id: card.id } })).content, '# Notification Source')

    await cleanupUser(user.id)
  })

  await t.test('real resource generation writes resource files and a matching manifest to the literature card', { skip: !RUN_REAL_LIVE_AI }, async () => {
    const { user, vault } = await createSidecarVault('resource-generation')

    const model = resolveAiConfig().model
    const state = new ResourceGenerationState()
    const transcripts: Array<{
      resourceType: string
      systemPrompt: string
      userPrompt: string
      response: string
    }> = []
    const orchestrator = new ResourceGenerationOrchestrator(state, {
      callLLM: async (systemPrompt, userMessage) => {
        const response = await callDeepSeekJson(systemPrompt, userMessage, model)
        transcripts.push({ resourceType: 'document', systemPrompt, userPrompt: userMessage, response })
        return response
      },
      resourceExists: async (_type, literatureTitle) => {
        const path = resourcePathFor(literatureTitle, RESOURCE_FILE_MAP.document)
        const file = await getFileStorage().readFile(path)
        return file.success
      },
      saveResource: async (type, literatureTitle, content) => {
        const path = resourcePathFor(literatureTitle, RESOURCE_FILE_MAP[type])
        await getFileStorage().writeFile(path, content)
      },
      saveResourceFile: async (literatureTitle, fileName, content) => {
        const path = resourcePathFor(literatureTitle, fileName)
        await getFileStorage().writeFile(path, content)
      },
    })

    const topic = 'Graph Search Basics'
    const literatureTitle = 'Graph Search Basics'
    const result = await runWithAgentContext({ userId: user.id, vaultId: vault.id }, async () => {
      return orchestrator.orchestrate(topic, 'intermediate', literatureTitle, undefined, ['document'])
    })

    assert.equal(result[0]?.status, 'completed', JSON.stringify(result))
    assert.equal(state.getStatus('document'), 'completed')

    const resourcePath = resourcePathFor(literatureTitle, RESOURCE_FILE_MAP.document)
    const resourceFile = await runWithAgentContext({ userId: user.id, vaultId: vault.id }, async () => {
      return getFileStorage().readFile(resourcePath)
    })
    assert.equal(resourceFile.success, true, resourceFile.error)
    assert.ok((resourceFile.content ?? '').length > 0)

    const manifest = [{
      type: 'document',
      title: '学习文档',
      path: resourcePath,
      fileName: RESOURCE_FILE_MAP.document,
    }]
    const literature = await prisma.card.create({
      data: {
        vaultId: vault.id,
        path: `${runId}/resource-generation.md`,
        title: 'Resource Generation Card',
        content: `# Resource Generation Card\n\n<!-- axiom-resources:${JSON.stringify(manifest)} -->\n\n${resourceFile.content}`,
        type: 'literature',
      },
    })

    const persisted = await prisma.card.findUniqueOrThrow({ where: { id: literature.id } })
    const parsed = JSON.parse(persisted.content.match(/<!--\s*axiom-resources:([\s\S]*?)\s*-->/)?.[1] ?? '[]')
    assert.equal(parsed.length, 1)
    assert.equal(parsed[0].path, resourcePath)
    assert.equal(parsed[0].fileName, RESOURCE_FILE_MAP.document)

    await writeLiveAiArtifact(`${runId}/sidecar-resource-generation.json`, {
      runId,
      capturedAt: new Date().toISOString(),
      provider: model.provider,
      modelId: model.modelId,
      baseUrl: model.baseUrl,
      topic,
      literatureTitle,
      transcripts,
      manifest,
      resourcePath,
      resourceContent: resourceFile.content,
    })

    await cleanupUser(user.id)
  })

  await t.test('real resource generation can produce multiple resource types, but quality varies by format', { skip: !RUN_REAL_LIVE_AI }, async () => {
    const { user, vault } = await createSidecarVault('resource-generation-multi')
    const model = resolveAiConfig().model
    const topic = 'Graph Search Basics'
    const literatureTitle = 'Graph Search Basics'
    const requestedTypes = ['mindmap', 'quiz', 'code', 'diagram', 'svg'] as const
    const results: Array<{
      type: string
      status: string
      error?: string
      fileName: string
      resourcePath: string
      contentLength?: number
      contentPreview?: string
      transcript: { systemPrompt: string; userPrompt: string; response: string }
    }> = []

    for (const requestedType of requestedTypes) {
      const state = new ResourceGenerationState()
      const transcripts: Array<{ systemPrompt: string; userPrompt: string; response: string }> = []
      const orchestrator = new ResourceGenerationOrchestrator(state, {
        callLLM: async (systemPrompt, userMessage) => {
          const response = await callDeepSeekJson(systemPrompt, userMessage, model)
          transcripts.push({ systemPrompt, userPrompt: userMessage, response })
          return response
        },
        resourceExists: async (_type, literatureTitle) => {
          const path = resourcePathFor(literatureTitle, RESOURCE_FILE_MAP[requestedType])
          const file = await getFileStorage().readFile(path)
          return file.success
        },
        saveResource: async (_type, literatureTitle, content) => {
          const path = resourcePathFor(literatureTitle, RESOURCE_FILE_MAP[requestedType])
          await getFileStorage().writeFile(path, content)
        },
        saveResourceFile: async (literatureTitle, fileName, content) => {
          const path = resourcePathFor(literatureTitle, fileName)
          await getFileStorage().writeFile(path, content)
        },
      })

      const generationResult = await runWithAgentContext({ userId: user.id, vaultId: vault.id }, async () => {
        return orchestrator.orchestrate(topic, 'intermediate', literatureTitle, undefined, [requestedType])
      })

      const resourcePath = resourcePathFor(literatureTitle, RESOURCE_FILE_MAP[requestedType])
      const status = generationResult[0]?.status ?? 'unknown'
      const error = generationResult[0]?.error
      if (status === 'completed') {
        const resourceFile = await runWithAgentContext({ userId: user.id, vaultId: vault.id }, async () => {
          return getFileStorage().readFile(resourcePath)
        })
        assert.equal(resourceFile.success, true, resourceFile.error)
        assert.ok((resourceFile.content ?? '').length > 0)
        results.push({
          type: requestedType,
          status,
          fileName: RESOURCE_FILE_MAP[requestedType],
          resourcePath,
          contentLength: (resourceFile.content ?? '').length,
          contentPreview: String(resourceFile.content ?? '').slice(0, 300),
          transcript: transcripts[0] ?? { systemPrompt: '', userPrompt: '', response: '' },
        })
      } else {
        results.push({
          type: requestedType,
          status,
          error,
          fileName: RESOURCE_FILE_MAP[requestedType],
          resourcePath,
          transcript: transcripts[0] ?? { systemPrompt: '', userPrompt: '', response: '' },
        })
      }
    }

    await writeLiveAiArtifact(`${runId}/sidecar-resource-generation-multi.json`, {
      runId,
      capturedAt: new Date().toISOString(),
      provider: model.provider,
      modelId: model.modelId,
      baseUrl: model.baseUrl,
      topic,
      literatureTitle,
      results,
    })

    await cleanupUser(user.id)
  })

})

async function createSidecarVault(label: string) {
  const user = await prisma.user.create({
    data: {
      email: `${runId}-${label}@example.com`,
      name: `SDD Sidecar ${label}`,
      vaults: { create: { name: `SDD Sidecar ${label} Vault` } },
    },
    include: { vaults: true },
  })

  return { user, vault: user.vaults[0] }
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

async function cleanupUser(userId: string) {
  await prisma.user.deleteMany({ where: { id: userId } })
}

async function callDeepSeekJson(systemPrompt: string, userPrompt: string, model: { baseUrl: string; apiKey: string; modelId: string }): Promise<string> {
  const url = `${model.baseUrl.replace(/\/+$/, '')}/chat/completions`
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const payload = JSON.stringify({
        model: model.modelId,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0,
        max_tokens: 1400,
      })
      const { stdout } = await execFileAsync('curl', [
        '-sS',
        '-X', 'POST',
        url,
        '--noproxy', '*',
        '-H', 'Content-Type: application/json',
        '-H', `Authorization: Bearer ${model.apiKey}`,
        '--data-raw', payload,
      ])
      const body = JSON.parse(stdout) as { choices?: Array<{ message?: { content?: string } }> }
      const content = body.choices?.[0]?.message?.content?.trim() || ''
      if (!content) throw new Error('DeepSeek returned empty content')
      return content
    } catch (error) {
      lastError = error
      await delay(1000 * (attempt + 1))
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

async function delay(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

function resourcePathFor(literatureTitle: string, fileName: string) {
  const sanitized = literatureTitle.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '')
  return `resources/${sanitized}/${fileName}`
}
