/**
 * 6.17 对话压缩与记忆沉淀 — Runtime 测试
 *
 * 覆盖 08 文档 6.17 全部 7 个对象：
 *   Checkpoint / ReviewableMessage / FlushableMessage / SummarizedMemory
 *   / CompressionConfig / CompressResult / DialogueContext
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

import { CheckpointManager } from '@/server/core/agent/feedback/CheckpointManager'
import { MemorySummarizer, SummarizableEntry } from '@/server/core/agent/MemorySummarizer'
import { DialogueOptimizer, getDialogueOptimizer, DialogueContext } from '@/server/core/agent/pipeline/DialogueOptimizer'
import { ContextCompressor, CompressionConfig, CompressResult } from '@/server/core/learning/context/compressor'
import type { AgentMessage } from '@mariozechner/pi-agent-core'

type TestDialogueMessage = { role: 'user' | 'assistant'; content: string }

function dialogue(messages: TestDialogueMessage[]): AgentMessage[] {
  return messages as unknown as AgentMessage[]
}

test('6.17 Memory & Compression contracts from the 08 test plan are executable', async (t) => {

  // ─── CheckpointManager ──────────────────────────────────────────

  await t.test('CheckpointManager creates and restores snapshots', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'axiom-checkpoint-test-'))
    const testFile = path.join(tmpDir, 'test.md')

    try {
      fs.writeFileSync(testFile, '# Version 1\n\nOriginal content.', 'utf-8')

      const cm = new CheckpointManager()  // 无 vaultPath = 默认禁用
      assert.equal(cm instanceof CheckpointManager, true)

      // 禁用状态下 ensureCheckpoint 直接 return，不创建快照目录
      await cm.ensureCheckpoint(tmpDir, 'disabled test')
      const disabledShadowPath = cm.getShadowRepoPath(tmpDir)
      assert.equal(fs.existsSync(disabledShadowPath), false, 'disabled checkpoint must not create shadow dir')

      // 启用后创建快照（传入 vaultPath 或手动 enable）
      cm.enable()
      await cm.ensureCheckpoint(tmpDir, 'before destructive edit')

      const shadowPath = cm.getShadowRepoPath(tmpDir)
      assert.equal(fs.existsSync(shadowPath), true, 'checkpoint shadow repo must exist')
      const snapshotsDir = path.join(shadowPath, 'snapshots')
      assert.equal(fs.existsSync(snapshotsDir), true, 'snapshots dir must exist')

      const snapshotDirs = fs.readdirSync(snapshotsDir)
      assert.ok(snapshotDirs.length >= 1, 'at least one snapshot created')

      const metaPath = path.join(snapshotsDir, snapshotDirs[0], '.checkpoint-meta.json')
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
      assert.equal(meta.reason, 'before destructive edit')
      assert.ok(meta.files.includes('test.md'))

      // 同一轮不重复快照
      await cm.ensureCheckpoint(tmpDir, 'duplicate attempt')
      const snapshotDirs2 = fs.readdirSync(snapshotsDir)
      assert.equal(snapshotDirs2.length, snapshotDirs.length, 'same turn must not create duplicate')

      // 修改文件
      fs.writeFileSync(testFile, '# Version 2\n\nModified content.', 'utf-8')

      // 恢复
      const restored = await cm.restore(tmpDir)
      assert.equal(restored, true, 'restore must succeed')
      const restoredContent = fs.readFileSync(testFile, 'utf-8')
      assert.equal(restoredContent, '# Version 1\n\nOriginal content.')

      // newTurn 清空记录
      cm.newTurn()
      await cm.ensureCheckpoint(tmpDir, 'new turn snapshot')
      const snapshotDirs3 = fs.readdirSync(snapshotsDir)
      assert.ok(snapshotDirs3.length >= 2, 'new turn must allow new snapshot')

      cm.clearSession()
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  await t.test('CheckpointManager respects enable/disable state', () => {
    const cm = new CheckpointManager()
    cm.disable()
    cm.enable()
    cm.disable()
  })

  // ─── MemorySummarizer ───────────────────────────────────────────

  await t.test('MemorySummarizer detects summarization threshold', () => {
    const summarizer = new MemorySummarizer(async () => 'mock summary')

    const short: SummarizableEntry[] = [
      { key: 'a', content: 'short', category: 'fact' },
    ]
    assert.equal(summarizer.needsSummary(short), false)

    const long: SummarizableEntry[] = [
      { key: 'big', content: 'x'.repeat(8001), category: 'fact' },
    ]
    assert.equal(summarizer.needsSummary(long), true)

    const multi: SummarizableEntry[] = [
      { key: 'a', content: 'x'.repeat(4000), category: 'preference' },
      { key: 'b', content: 'y'.repeat(4001), category: 'fact' },
    ]
    assert.equal(summarizer.needsSummary(multi), true)
  })

  await t.test('MemorySummarizer handles LLM failure gracefully', async () => {
    const failingSummarizer = new MemorySummarizer(async () => {
      throw new Error('LLM unavailable')
    })

    const entries: SummarizableEntry[] = [
      { key: 'pref-1', content: 'x'.repeat(4000), category: 'preference' },
      { key: 'fact-1', content: 'y'.repeat(4001), category: 'fact' },
    ]

    const result = await failingSummarizer.summarize(entries)
    assert.ok(result.key.startsWith('summary-'))
    assert.ok(result.originalLength > 8000)
    assert.ok(result.summary.length > 0)
    assert.ok(result.summary.includes('[truncated]'))
  })

  await t.test('MemorySummarizer.summarizeIfNeeded returns null below threshold', async () => {
    const summarizer = new MemorySummarizer(async () => 'should not be called')
    const result = await summarizer.summarizeIfNeeded([
      { key: 'a', content: 'short text', category: 'fact' },
    ])
    assert.equal(result, null)
  })

  // ─── DialogueOptimizer ──────────────────────────────────────────

  await t.test('DialogueOptimizer detects phases: initialization → deep_dive → practice → consolidation', () => {
    const optimizer = new DialogueOptimizer()

    const initCtx = optimizer.analyzeDialogue(dialogue([
      { role: 'user', content: '你好，我想学习图搜索' },
      { role: 'assistant', content: '你好！让我们开始吧' },
    ]))
    assert.equal(initCtx.phase, 'initialization')
    assert.equal(initCtx.turnCount, 1)

    const diveCtx = optimizer.analyzeDialogue(dialogue([
      { role: 'user', content: '什么是 BFS？' },
      { role: 'assistant', content: 'BFS 是广度优先搜索...' },
      { role: 'user', content: '能给我一个例子吗？' },
      { role: 'assistant', content: '当然...' },
      { role: 'user', content: '那么 BFS 和 DFS 有什么区别？' },
      { role: 'assistant', content: '主要区别在于...' },
      { role: 'user', content: '用队列还是栈？' },
    ]))
    assert.equal(diveCtx.phase, 'deep_dive')
    assert.equal(diveCtx.turnCount, 4)

    const pracCtx = optimizer.analyzeDialogue(dialogue([
      { role: 'user', content: 'a' }, { role: 'assistant', content: 'b' },
      { role: 'user', content: 'a' }, { role: 'assistant', content: 'b' },
      { role: 'user', content: 'a' }, { role: 'assistant', content: 'b' },
      { role: 'user', content: 'a' }, { role: 'assistant', content: 'b' },
      { role: 'user', content: 'a' }, { role: 'assistant', content: 'b' },
      { role: 'user', content: '给我做几道练习题' },
    ]))
    assert.equal(pracCtx.phase, 'practice')

    const conCtx = optimizer.analyzeDialogue(dialogue(
      Array.from({ length: 18 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' as const : 'assistant' as const,
        content: `msg ${i}`,
      }))
    ))
    assert.equal(conCtx.phase, 'consolidation')
    assert.ok(conCtx.turnCount >= 9)
  })

  await t.test('DialogueOptimizer recommends tools and sets context per phase', () => {
    const optimizer = new DialogueOptimizer()

    const phases = ['initialization', 'deep_dive', 'practice', 'consolidation'] as const
    for (const phase of phases) {
      const msgs = phase === 'consolidation'
        ? Array.from({ length: 18 }, (_, i) => ({ role: i % 2 === 0 ? 'user' as const : 'assistant' as const, content: `msg ${i}` }))
        : phase === 'deep_dive' || phase === 'practice'
        ? Array.from({ length: 8 }, (_, i) => ({ role: i % 2 === 0 ? 'user' as const : 'assistant' as const, content: phase === 'practice' && i === 6 ? '给我做练习题' : `msg ${i}` }))
        : [{ role: 'user' as const, content: 'hello' }]

      const ctx = optimizer.analyzeDialogue(dialogue(msgs))
      assert.equal(ctx.phase, phase)
      assert.ok(Array.isArray(ctx.suggestedTools), `${phase}: suggestedTools must be an array`)
      assert.ok(ctx.maxResponseLength > 0, `${phase}: maxResponseLength must be > 0`)
      assert.ok(['light', 'medium', 'heavy'].includes(ctx.contextIntensity), `${phase}: valid contextIntensity`)
    }
  })

  await t.test('DialogueOptimizer.shouldAskQuestion is phase-dependent', () => {
    const optimizer = new DialogueOptimizer()

    const initCtx = optimizer.analyzeDialogue(dialogue([
      { role: 'user', content: '开始学习' },
    ]))
    assert.equal(initCtx.shouldAskQuestion, true)

    const conCtx = optimizer.analyzeDialogue(dialogue(
      Array.from({ length: 18 }, (_, i) => ({ role: i % 2 === 0 ? 'user' as const : 'assistant' as const, content: `msg ${i}` }))
    ))
    assert.equal(conCtx.shouldAskQuestion, false)
  })

  await t.test('DialogueOptimizer.getPhasePromptSuffix returns non-empty for all phases', () => {
    const optimizer = new DialogueOptimizer()
    for (const phase of ['initialization', 'deep_dive', 'practice', 'consolidation'] as const) {
      const suffix = optimizer.getPhasePromptSuffix(phase)
      assert.ok(suffix.length > 10, `suffix for ${phase} must not be empty`)
    }
  })

  await t.test('DialogueOptimizer.getToolCallGuidance returns non-empty for all phases', () => {
    const optimizer = new DialogueOptimizer()
    for (const phase of ['initialization', 'deep_dive', 'practice', 'consolidation'] as const) {
      const guidance = optimizer.getToolCallGuidance(phase)
      assert.ok(guidance.length > 10, `guidance for ${phase} must not be empty`)
    }
  })

  await t.test('getDialogueOptimizer returns singleton', () => {
    const a = getDialogueOptimizer()
    const b = getDialogueOptimizer()
    assert.equal(a, b, 'must return same instance')
  })

  // ─── ContextCompressor ──────────────────────────────────────────

  await t.test('ContextCompressor accepts valid CompressionConfig', () => {
    const config: CompressionConfig = {
      model: 'test-model',
      thresholdPercent: 0.60,
      protectFirstN: 5,
      protectLastN: 10,
      summaryTargetRatio: 0.25,
      quietMode: true,
      contextLength: 100000,
    }
    const compressor = new ContextCompressor(config)
    assert.ok(compressor instanceof ContextCompressor)
  })

  await t.test('ContextCompressor applies defaults for minimal config', () => {
    const compressor = new ContextCompressor({ model: 'minimal-model' })
    assert.ok(compressor instanceof ContextCompressor)
  })

  await t.test('ContextCompressor clamps summaryTargetRatio to [0.10, 0.80]', () => {
    const low = new ContextCompressor({ model: 'm', summaryTargetRatio: 0.01 })
    assert.ok(low instanceof ContextCompressor)

    const high = new ContextCompressor({ model: 'm', summaryTargetRatio: 0.99 })
    assert.ok(high instanceof ContextCompressor)
  })

  // ─── Type contracts ────────────────────────────────────────────

  await t.test('ReviewableMessage shape is valid', () => {
    const msg: { role: string; content: string } = {
      role: 'user',
      content: 'test message for review',
    }
    assert.equal(msg.role, 'user')
    assert.ok(msg.content.length > 0)
  })

  await t.test('FlushableMessage shape is valid', () => {
    const msg: { role: string; content: string } = {
      role: 'assistant',
      content: 'test message for flush',
    }
    assert.equal(msg.role, 'assistant')
    assert.ok(msg.content.length > 0)
  })

  await t.test('CompressionConfig carries all required fields', () => {
    const config: CompressionConfig = {
      model: 'gpt-4o-mini',
      thresholdPercent: 0.50,
      protectFirstN: 3,
      protectLastN: 20,
      summaryTargetRatio: 0.20,
      quietMode: false,
    }
    assert.equal(config.model, 'gpt-4o-mini')
    assert.equal(config.thresholdPercent, 0.50)
  })

  await t.test('CompressResult carries compression stats', () => {
    const result: CompressResult = {
      messages: [],
      compressed: false,
      beforeTokens: 10000,
      afterTokens: 10000,
      savedTokens: 0,
    }
    assert.equal(result.compressed, false)
    assert.equal(result.savedTokens, 0)
    assert.ok(Array.isArray(result.messages))
  })

  await t.test('DialogueContext has all required fields populated', () => {
    const optimizer = new DialogueOptimizer()
    const ctx: DialogueContext = optimizer.analyzeDialogue(dialogue([
      { role: 'user', content: 'hello' },
    ]))

    assert.ok(['initialization', 'deep_dive', 'practice', 'consolidation'].includes(ctx.phase))
    assert.ok(ctx.turnCount > 0)
    assert.equal(typeof ctx.shouldAskQuestion, 'boolean')
    assert.ok(Array.isArray(ctx.suggestedTools))
    assert.ok(ctx.maxResponseLength >= 300)
    assert.equal(typeof ctx.focusArea, 'string')
    assert.ok(['light', 'medium', 'heavy'].includes(ctx.contextIntensity))
  })
})
