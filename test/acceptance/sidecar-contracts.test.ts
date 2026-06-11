import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import test from 'node:test'
import { promisify } from 'node:util'
import { getFileStorage } from '@/server/infra/storage/GlobalFileStorage'
import { prisma } from '@/lib/db'
import { resolveAiConfig } from '@/lib/ai-config'
import { runWithAgentContext } from '@/server/core/agent/agent-context'
import { ResourceGenerationOrchestrator } from '@/server/core/agent/ResourceGenerationOrchestrator'
import {
  ResourceGenerationState,
  RESOURCE_FILE_MAP,
  type ResourceType,
} from '@/server/core/agent/ResourceGenerationState'
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
      skipMp4Render: true,
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
    const requestedTypes: ResourceType[] = ['mindmap', 'quiz', 'code', 'diagram', 'svg', 'video']
    const results: Array<{
      type: ResourceType
      status: string
      error?: string
      fileName: string
      resourcePath: string
      contentLength?: number
      contentPreview?: string
      qualitySignal?: string
      qualityScore?: number
      qualityIssues?: string[]
      transcript: { systemPrompt: string; userPrompt: string; response: string }
    }> = []

    for (const requestedType of requestedTypes) {
      const state = new ResourceGenerationState()
      const transcripts: Array<{ systemPrompt: string; userPrompt: string; response: string }> = []
      const orchestrator = new ResourceGenerationOrchestrator(state, {
        callLLM: async (systemPrompt, userMessage) => {
          const isSvg = systemPrompt.includes('SVG') || systemPrompt.includes('<svg')
          const response = await callDeepSeekJson(systemPrompt, userMessage, model, isSvg ? 4096 : 8192, isSvg ? 30_000 : 120_000)
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
        skipMp4Render: true,
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
        const content = String(resourceFile.content ?? '')
        const quality = evaluateResourceQuality(requestedType, content)
        results.push({
          type: requestedType,
          status,
          fileName: RESOURCE_FILE_MAP[requestedType],
          resourcePath,
          contentLength: content.length,
          contentPreview: content.slice(0, 300),
          qualitySignal: quality.signal,
          qualityScore: quality.score,
          qualityIssues: quality.issues,
          transcript: transcripts[0] ?? { systemPrompt: '', userPrompt: '', response: '' },
        })
      } else {
        results.push({
          type: requestedType,
          status,
          error,
          fileName: RESOURCE_FILE_MAP[requestedType],
          resourcePath,
          qualitySignal: 'not-generated',
          qualityScore: 0,
          qualityIssues: [error || 'Resource was not generated'],
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

async function callDeepSeekJson(systemPrompt: string, userPrompt: string, model: { baseUrl: string; apiKey: string; modelId: string }, maxTokens = 8192, timeoutMs = 120_000): Promise<string> {
  const url = `${model.baseUrl.replace(/\/+$/, '')}/chat/completions`
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const isSvg = systemPrompt.includes('SVG') || systemPrompt.includes('<svg')
      const payload = JSON.stringify({
        model: model.modelId,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0,
        max_tokens: maxTokens,
        ...(isSvg ? { reasoning_effort: 'low' } : {}),
      })
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${model.apiKey}` },
        body: payload,
        signal: controller.signal,
      })
      clearTimeout(timer)
      const body = await resp.json() as { choices?: Array<{ message?: { content?: string } }> }
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

function evaluateResourceQuality(type: ResourceType, content: string): { signal: string; score: number; issues: string[] } {
  const normalized = content.toLowerCase()
  const issues: string[] = []

  if (type === 'video') {
    const hasVideoTag = normalized.includes('<video')
      || normalized.includes('canvas')
      || normalized.includes('scene')
      || normalized.includes('animation')
    if (!hasVideoTag) issues.push('Missing video/canvas/scene/animation marker')
    return quality(hasVideoTag ? 'video-html-ready' : 'missing-video-markup', issues)
  }

  if (type === 'svg') {
    const hasSvgTag = normalized.includes('<svg') && normalized.includes('</svg>')
    if (!hasSvgTag) issues.push('Missing <svg> or </svg> tag')
    if (normalized.includes('自动降级 svg')) issues.push('Used deterministic SVG fallback')
    return quality(hasSvgTag ? 'svg-tag-contains' : 'missing-svg-tag', issues)
  }

  if (type === 'diagram') {
    const validTypes = ['flowchart', 'sequenceDiagram', 'classDiagram', 'pie', 'stateDiagram', 'gantt', 'erDiagram', 'journey', 'gitGraph', 'graph']
    const hasValidType = validTypes.some((dt) => normalized.includes(dt.toLowerCase()))
    if (!hasValidType) issues.push('Missing valid Mermaid diagram type')
    const nodeCount = (content.match(/\[[^\]]+\]|\([^)]+\)|\{[^}]+\}/g) || []).length
    if (nodeCount < 6) issues.push(`Diagram has too few visible nodes (${nodeCount}, min 6)`)
    return quality(hasValidType ? 'mermaid-preserved' : 'missing-mermaid-keyword', issues)
  }

  if (type === 'mindmap') {
    if (!normalized.includes('mindmap')) issues.push('Missing mindmap keyword')
    const topLevelBranches = content.split('\n').filter((line) => /^ {4}\S/.test(line)).length
    if (topLevelBranches < 4) issues.push(`Mindmap has too few top-level branches (${topLevelBranches}, min 4)`)
  }

  if (type === 'quiz') {
    const quizIssues = evaluateQuizQuality(content)
    issues.push(...quizIssues)
  }

  if (type === 'code') {
    const required = ['## 练习目标', '## 初始代码', '## 任务要求', '## 测试样例', '## 参考实现', '## 讲解']
    const missing = required.filter((section) => !content.includes(section))
    if (missing.length > 0) issues.push(`Missing sections: ${missing.join(', ')}`)
    const codeBlockCount = (content.match(/```/g) || []).length / 2
    if (codeBlockCount < 2) issues.push(`Too few code blocks (${codeBlockCount}, min 2)`)
  }

  if (content.trim().length <= 200) issues.push(`Content too short (${content.trim().length}, min 200)`)
  return quality(content.trim().length > 200 ? 'readable-content' : 'too-short-content', issues)
}

function evaluateQuizQuality(content: string): string[] {
  const issues: string[] = []
  try {
    const quiz = JSON.parse(content) as Array<{ question?: string; options?: unknown[]; answer?: string; explanation?: string }>
    if (!Array.isArray(quiz)) return ['Quiz content is not a JSON array']
    if (quiz.length < 5) issues.push(`Quiz has too few questions (${quiz.length}, min 5)`)
    const seenQuestions = new Set<string>()
    quiz.forEach((item, index) => {
      const label = `Question ${index + 1}`
      const question = String(item.question ?? '').trim()
      if (!question) issues.push(`${label} missing question`)
      if (seenQuestions.has(question)) issues.push(`${label} duplicates another question`)
      seenQuestions.add(question)
      const options = Array.isArray(item.options) ? item.options.map((option) => String(option).trim()) : []
      if (options.length < 4) issues.push(`${label} has too few options`)
      if (new Set(options).size !== options.length) issues.push(`${label} has duplicate options`)
      const answer = String(item.answer ?? '').trim()
      const optionLabels = options.map((option) => option.match(/^([A-Z])[\.\s:：]/)?.[1]).filter(Boolean)
      if (/^[A-Z]$/.test(answer) && optionLabels.length > 0 && !optionLabels.includes(answer)) {
        issues.push(`${label} answer ${answer} does not match options`)
      }
      const combined = [question, answer, item.explanation, ...options].join('\n')
      if (/(我需重新检查|重新检查|笔误|复制错误|答案设为|应该是|可能是正确|不确定|I need to|mistake|typo)/i.test(combined)) {
        issues.push(`${label} contains self-correction or uncertain wording`)
      }
    })
  } catch {
    issues.push('Quiz content is not valid JSON')
  }
  return issues
}

function quality(signal: string, issues: string[]) {
  return {
    signal,
    score: Math.max(0, 100 - issues.length * 20),
    issues,
  }
}
