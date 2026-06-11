import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import test from 'node:test'
import { promisify } from 'node:util'
import {
  consumeConfirmationToken,
  createConfirmationToken,
  getConfirmationTokenExpiry,
  isConfirmationTokenValid,
} from '@/server/core/agent/OperationConfirmation'
import {
  TOOL_CONTRACTS,
  getToolContract,
  isDestructiveTool,
  requiresConfirmation,
  type ToolContract,
} from '@/server/core/agent/ToolContracts'
import { resolveAiConfig } from '@/lib/ai-config'
import { AGENT_ROLES, SubagentRole } from '@/server/core/agent/subagent/SubagentTypes'
import { redactSecrets } from '@/server/core/agent/security/SecretRedactor'
import { ShellHookAllowlist } from '@/server/core/agent/security/ShellHookAllowlist'
import { ResourcePushEngine, type PushTrigger } from '@/server/core/agent/resource-push-engine'
import { subscribeResourceProgress, emitResourceProgress } from '@/server/core/agent/notification-bus'
import { LLMUsageTracker } from '@/server/core/agent/LLMUsageTracker'
import { writeLiveAiArtifact } from './live-ai-artifacts'

const execFileAsync = promisify(execFile)
const RUN_REAL_LIVE_AI = process.env.RUN_REAL_LIVE_AI === '1'
const runId = `sdd-agent-${Date.now()}-${Math.random().toString(36).slice(2)}`

test('Agent runtime contracts from the 08 test plan are explicit and executable', async (t) => {
  await t.test('every registered ToolContract has identity, risk, vault boundary, and side-effect metadata', () => {
    const contracts = Object.values(TOOL_CONTRACTS)
    assert.ok(contracts.length >= 10)

    for (const contract of contracts) {
      assertToolContractShape(contract)
      if (contract.requiresConfirmation) {
        assert.equal(contract.risk.includes('destructive') || contract.risk.includes('network'), true)
      }
    }

    assert.equal(getToolContract('delete_card')?.requiresVault, true)
    assert.equal(isDestructiveTool('delete_card'), true)
    assert.equal(requiresConfirmation('delete_card'), true)
    assert.equal(requiresConfirmation('read'), false)
  })

  await t.test('confirmation tokens are scoped, expiring, single-use, and action-bound', () => {
    const confirmation = createConfirmationToken('delete_card', 'card-a', 60_000)

    assert.ok(confirmation.token.length > 8)
    assert.ok((getConfirmationTokenExpiry('delete_card', 'card-a', confirmation.token) ?? 0) > Date.now())
    assert.equal(isConfirmationTokenValid('delete_card', 'card-a', confirmation.token), true)
    assert.equal(isConfirmationTokenValid('delete_card', 'card-b', confirmation.token), false)
    assert.equal(isConfirmationTokenValid('rename_file', 'card-a', confirmation.token), false)

    assert.equal(consumeConfirmationToken('delete_card', 'card-a', confirmation.token), true)
    assert.equal(consumeConfirmationToken('delete_card', 'card-a', confirmation.token), false)
  })

  await t.test('secret redaction strips provider keys, bearer tokens, and plain env secrets', () => {
    const output = redactSecrets([
      'Authorization: Bearer sk-abcdefghijklmnopqrstuvwxyz',
      'OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz',
      'X-Token: plain-secret-value',
    ].join('\n'))

    assert.equal(output.includes('sk-abcdefghijklmnopqrstuvwxyz'), false)
    assert.equal(output.includes('plain-secret-value'), false)
    assert.match(output, /\*\*\*|\[REDACTED\]/)
  })

  await t.test('shell hook allowlist allows low-risk local commands and blocks unlisted external commands', async () => {
    const allowlist = new ShellHookAllowlist()
    assert.equal(allowlist.check('curl https://example.com').allowed, true)

    await allowlist.enable('/tmp/axiom-agent-contract')
    assert.equal(allowlist.check('git status').allowed, true)
    assert.equal(allowlist.check('ls notes').allowed, true)
    assert.equal(allowlist.check('curl https://example.com').allowed, false)
    assert.equal(allowlist.check('rm -rf /tmp/axiom-agent-contract').allowed, false)

    allowlist.addRule({ pattern: 'pnpm test*', description: 'test command' })
    assert.equal(allowlist.check('pnpm test:acceptance').allowed, true)
  })

  await t.test('resource push trigger detection has reasons, priority, target concept, and bounded resource types', async () => {
    const engine = new ResourcePushEngine()
    const triggers = await engine.detectTriggers('user-a', {
      lastActivityTime: Date.now() - 8 * 24 * 3600 * 1000,
      recentAssessments: [{ score: 30, maxScore: 100, toolName: 'feynman_test' }],
      profile: {
        dimensions: {
          abstraction: { score: 20, confidence: 0.9 },
        },
      },
    })

    assert.ok(triggers.length >= 2)
    for (const trigger of triggers) {
      assertPushTriggerShape(trigger)
    }
  })

  await t.test('resource progress events are best-effort and scoped by vaultId', () => {
    const receivedA: unknown[] = []
    const receivedB: unknown[] = []
    const unsubscribeA = subscribeResourceProgress('vault-a', (event) => receivedA.push(event))
    const unsubscribeB = subscribeResourceProgress('vault-b', (event) => receivedB.push(event))

    emitResourceProgress('vault-a', {
      topic: 'Topic',
      resourceType: 'diagram',
      label: 'Diagram',
      status: 'generating',
      progress: 40,
      message: 'generating',
    })

    assert.equal(receivedA.length, 1)
    assert.equal(receivedB.length, 0)

    unsubscribeA()
    unsubscribeB()
  })

  await t.test('LLM usage tracking records provider, model, tokens, and estimated cost', () => {
    const tracker = new LLMUsageTracker()
    tracker.record({
      timestamp: Date.now(),
      model: 'gpt-4o-mini',
      provider: 'openai',
      promptTokens: 120,
      completionTokens: 80,
      sessionId: 'session-a',
    })
    tracker.record({
      timestamp: Date.now(),
      model: 'custom-model',
      provider: 'custom',
      promptTokens: 0,
      completionTokens: 0,
    })

    const summary = tracker.getSessionSummary()
    assert.equal(summary.totalCalls, 2)
    assert.equal(summary.byModel['gpt-4o-mini'].calls, 1)
    assert.equal(summary.byModel['gpt-4o-mini'].tokens, 200)
    assert.ok(summary.byModel['gpt-4o-mini'].cost > 0)
    assert.equal(summary.byModel['custom-model'].cost, 0)
    assert.equal(tracker.isOverBudget(summary.totalCost - 0.000001), true)
    assert.equal(tracker.isOverBudget(summary.totalCost + 1), false)
  })

  await t.test('LLM usage records are complete, contain no secrets, and survive memory-cap trimming', () => {
    const tracker = new LLMUsageTracker()

    // 1. field completeness — every record must have provider, model, tokens, cost
    const record = {
      timestamp: Date.now(),
      model: 'claude-sonnet-4-20250514',
      provider: 'anthropic',
      promptTokens: 1500,
      completionTokens: 600,
      sessionId: 'sess-integration',
    }
    tracker.record(record)

    const summary = tracker.getSessionSummary()
    assert.equal(summary.totalCalls, 1)
    assert.equal(summary.totalTokens, 2100)
    assert.ok(summary.totalCost > 0, 'cost must be > 0 for known model')
    assert.ok(summary.byModel['claude-sonnet-4-20250514'], 'must group by model')

    // 2. no secret fields leak into UsageRecord shape
    const knownSafeKeys = new Set([
      'timestamp', 'model', 'provider', 'promptTokens',
      'completionTokens', 'estimatedCost', 'sessionId',
    ])
    for (const r of (tracker as any).records as Array<Record<string, unknown>>) {
      for (const key of Object.keys(r)) {
        assert.ok(knownSafeKeys.has(key), `UsageRecord must not contain secret field: ${key}`)
      }
    }

    // 3. memory cap — generate 1001 records, ensure retention window
    const capTracker = new LLMUsageTracker()
    for (let i = 0; i < 1001; i++) {
      capTracker.record({
        timestamp: Date.now() + i,
        model: 'gpt-4o-mini',
        provider: 'openai',
        promptTokens: 10,
        completionTokens: 10,
      })
    }
    const capSummary = capTracker.getSessionSummary()
    assert.ok(capSummary.totalCalls <= 1000, 'must not exceed memory cap')
    assert.ok(capSummary.totalCalls >= 500, 'must retain recent window after trimming')
    assert.ok(capSummary.totalCost > 0, 'total cost must be recalculated after trim')

    // 4. resetSession clears session total but retains records for inspection
    capTracker.resetSession()
    const resetSummary = capTracker.getSessionSummary()
    assert.equal(resetSummary.totalCost, 0, 'session total cost must reset to 0')
    // records survive resetSession (only sessionTotal is cleared)
    assert.ok(resetSummary.totalCalls >= 500, 'records array survives reset')
    assert.ok(resetSummary.totalTokens > 0, 'token count survives reset')

    // 5. zero-token record (e.g. failed call) is tracked but costs zero
    const zeroTracker = new LLMUsageTracker()
    zeroTracker.record({
      timestamp: Date.now(),
      model: 'deepseek-chat',
      provider: 'deepseek',
      promptTokens: 0,
      completionTokens: 0,
    })
    const zeroSummary = zeroTracker.getSessionSummary()
    assert.equal(zeroSummary.totalCalls, 1)
    assert.equal(zeroSummary.totalTokens, 0)
    assert.equal(zeroSummary.totalCost, 0)
  })

  await t.test('real role prompts execute against the live model and return structured output', { skip: !RUN_REAL_LIVE_AI }, async () => {
    const model = resolveAiConfig().model
    const transcripts: Array<{
      role: SubagentRole
      token: string
      systemPrompt: string
      userPrompt: string
      response: string
      parsed: { role: string; token: string; status: string; summary: string }
    }> = []
    const scenarios = [
      { role: SubagentRole.Oracle, token: 'oracle' },
      { role: SubagentRole.Profile, token: 'profile' },
      { role: SubagentRole.Forge, token: 'forge' },
      { role: SubagentRole.Guide, token: 'guide' },
      { role: SubagentRole.Assess, token: 'assess' },
    ] as const

    for (const scenario of scenarios) {
      const systemPrompt = AGENT_ROLES[scenario.role].systemPrompt
      const userPrompt = [
        '只输出一个 JSON 对象，不要解释，不要 markdown。',
        `字段必须包含 role, token, status, summary.`,
        `role 必须是 ${scenario.role}.`,
        `token 必须是 ${scenario.token}.`,
        'status 必须是 ok.',
        'summary 必须是一句话中文总结。',
      ].join(' ')
      const response = await callDeepSeekJson(
        systemPrompt,
        userPrompt,
        model,
      )

      const payload = parseJsonObject(response)
      assert.equal(payload.role, scenario.role)
      assert.equal(payload.token, scenario.token)
      assert.equal(payload.status, 'ok')
      assert.equal(typeof payload.summary, 'string')
      assert.ok(payload.summary.length > 0)

      transcripts.push({
        role: scenario.role,
        token: scenario.token,
        systemPrompt,
        userPrompt,
        response,
        parsed: payload,
      })
    }

    await writeLiveAiArtifact(`${runId}/agent-role-prompts.json`, {
      runId,
      capturedAt: new Date().toISOString(),
      provider: model.provider,
      modelId: model.modelId,
      baseUrl: model.baseUrl,
      transcripts,
    })
  })
})

function assertToolContractShape(contract: ToolContract) {
  assert.equal(typeof contract.name, 'string')
  assert.ok(contract.name.length > 0)
  assert.ok(contract.risk.length > 0)
  assert.equal(typeof contract.requiresVault, 'boolean')
  assert.equal(typeof contract.idempotent, 'boolean')
  assert.ok(Array.isArray(contract.sideEffects))
}

function assertPushTriggerShape(trigger: PushTrigger) {
  assert.ok(trigger.triggerId)
  assert.ok(trigger.type)
  assert.ok(trigger.resourceRecommendation.concept)
  assert.ok(trigger.resourceRecommendation.reason)
  assert.ok(['high', 'normal', 'low'].includes(trigger.resourceRecommendation.priority))
  assert.ok(trigger.resourceRecommendation.resourceTypes.length > 0)
  for (const type of trigger.resourceRecommendation.resourceTypes) {
    assert.ok(['document', 'quiz', 'code', 'diagram', 'video'].includes(type))
  }
}

function parseJsonObject(text: string): { role: string; token: string; status: string; summary: string } {
  const match = text.match(/\{[\s\S]*\}/)
  assert.ok(match, `assistant output did not include JSON: ${text.slice(0, 400)}`)
  return JSON.parse(match[0])
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
        max_tokens: 1200,
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

      const body = JSON.parse(stdout) as {
        choices?: Array<{ message?: { content?: string } }>
      }
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
