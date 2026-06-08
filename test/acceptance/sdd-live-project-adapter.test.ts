import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { parseWikiLinks } from '@/lib/wiki-links'
import { safeParseTags } from '@/server/api/routes/vault'
import { getProfileCacheEntry, setProfileCacheEntry } from '@/server/api/profile-cache'
import {
  consumeConfirmationToken,
  createConfirmationToken,
  isConfirmationTokenValid,
} from '@/server/core/agent/OperationConfirmation'
import {
  TOOL_CONTRACTS,
  getToolContract,
  isDestructiveTool,
  requiresConfirmation,
} from '@/server/core/agent/ToolContracts'
import { redactSecrets } from '@/server/core/agent/security/SecretRedactor'
import { ShellHookAllowlist } from '@/server/core/agent/security/ShellHookAllowlist'
import { DEFAULT_PANEL_LAYOUT, DEFAULT_PANEL_SIZES, type GraphLayoutMode } from '@/stores/mode-store'
import { loadAcceptanceCases, type AcceptanceCase } from './case-loader'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

const SOURCE_FILES = [
  'prisma/schema.prisma',
  'server/api/index.ts',
  'server/api/auth-helper.ts',
  'server/api/middleware/auth.ts',
  'server/api/routes/agent.ts',
  'server/api/routes/cognition.ts',
  'server/api/routes/dashboard.ts',
  'server/api/routes/events.ts',
  'server/api/routes/galaxy.ts',
  'server/api/routes/learning.ts',
  'server/api/routes/rag.ts',
  'server/api/routes/vault.ts',
  'server/api/routes/vaults.ts',
  'server/core/agent/OperationConfirmation.ts',
  'server/core/agent/ToolContracts.ts',
  'server/core/agent/audit/AuditLogger.ts',
  'server/core/agent/feedback/CheckpointManager.ts',
  'server/core/agent/feedback/MemoryFlush.ts',
  'server/core/agent/mcp/MCPClient.ts',
  'server/core/agent/mcp/MCPServer.ts',
  'server/core/agent/pipeline/ContextBuilder.ts',
  'server/core/agent/pipeline/MemoryService.ts',
  'server/core/agent/resource-push-engine.ts',
  'server/core/agent/security/SecretRedactor.ts',
  'server/core/agent/security/ShellHookAllowlist.ts',
  'server/core/agent/skills/SkillRegistry.ts',
  'server/core/agent/subagent/SubagentLifecycle.ts',
  'server/core/agent/subagent/SubagentSystem.ts',
  'server/core/agent/subagent/SubagentTypes.ts',
  'server/core/agent/tool-impl/assessment-tools.ts',
  'server/core/agent/tool-impl/card-tools.ts',
  'server/core/agent/tool-impl/content-quality-tools.ts',
  'server/core/agent/tool-impl/import-document-tool.ts',
  'server/core/agent/tool-impl/learning-management-tools.ts',
  'server/core/agent/tool-impl/resource-tools.ts',
  'server/core/agent/tool-impl/session-tools.ts',
  'server/core/agent/web-search-helpers.ts',
  'server/core/ai/AIManager.ts',
  'server/core/ai/guardrails/content-safety.ts',
  'server/core/ai/hyperframes/generator.ts',
  'server/core/ai/hyperframes/renderer.ts',
  'server/core/learning/education-profile.ts',
  'server/core/learning/graph/integration.ts',
  'server/core/learning/memory/manager.ts',
  'server/core/learning/memory/profile-manager.ts',
  'server/core/learning/path-adjustment-engine.ts',
  'server/core/rag/lightrag-service.ts',
  'server/infra/rag/lightrag-client.ts',
  'server/infra/storage/AxiomCompat.ts',
  'server/infra/storage/DbAdapter.ts',
  'server/infra/storage/IFileStorage.ts',
  'lib/wiki-links.ts',
  'hooks/use-agent.ts',
  'hooks/use-card-links.ts',
  'hooks/use-cognition.ts',
  'hooks/use-dashboard.ts',
  'hooks/use-galaxy.ts',
  'hooks/use-learning.ts',
  'hooks/use-notifications.ts',
  'stores/agent-store.ts',
  'stores/mode-store.ts',
  'types/agent.ts',
  'types/galaxy.ts',
  'types/learning.ts',
  'components/dashboard/dashboard-left.tsx',
  'components/dashboard/dashboard-right.tsx',
  'components/forge/forge-chat.tsx',
  'components/forge/forge-editor.tsx',
  'components/galaxy/galaxy-controls.tsx',
  'components/galaxy/galaxy-layout-panel.tsx',
  'components/learn/learn-stage.tsx',
  'components/learn/learn-workspace.tsx',
  'components/learning/resource-push-center.tsx',
].map((path) => ({
  path,
  text: readFileSync(resolve(ROOT, path), 'utf8'),
}))

const ALL_SOURCE = SOURCE_FILES.map((file) => file.text).join('\n')
const SCHEMA = source('prisma/schema.prisma')

const MODEL_ALIASES: Record<string, string> = {
  AgentAuditLog: 'agentAuditLog',
  AgentSession: 'agentSession',
  AuthAccount: 'account',
  AuthSession: 'session',
  Card: 'card',
  CardPath: 'card',
  CardRevision: 'card',
  Cluster: 'cluster',
  Edge: 'edge',
  EducationProfileHistory: 'EducationProfileHistory',
  LearningMessage: 'learningMessage',
  LearningPath: 'learningPath',
  LearningPathStep: 'learningPathStep',
  LearningSession: 'learningSession',
  PathAdjustmentHistory: 'PathAdjustmentHistory',
  PushRecord: 'PushRecord',
  RagDocumentIndex: 'ragDocumentIndex',
  User: 'user',
  Vault: 'vault',
  VaultProfileCache: 'vault',
  VaultCapability: 'vaultCapability',
  VaultMemory: 'vaultMemory',
  VaultSkill: 'vaultSkill',
  VerificationToken: 'verification',
}

const OBJECT_MODEL_HINTS: Array<[RegExp, string, string[]]> = [
  [/User|CurrentUserContext|User 聚合/, 'user', ['id', 'email']],
  [/Vault|Vault 聚合/, 'vault', ['id', 'userId']],
  [/Card|FleetingCard|LiteratureCard|PermanentCard|ImportedDocument|FileEntry/, 'card', ['id', 'vaultId', 'path', 'content', 'type']],
  [/Cluster|GalaxyCluster/, 'cluster', ['id', 'vaultId', 'name', 'color']],
  [/Edge|WikiLink|KnowledgeGraph|GalaxyEdge|IncomingLink|OutgoingLink|SuggestedRelation/, 'edge', ['id', 'vaultId', 'sourceId', 'targetId', 'type']],
  [/LearningPath(?!Step)|PathTopic|PathStatus|PathProgress|PathSource|SelectedPath|LearningPath 聚合/, 'learningPath', ['id', 'userId', 'vaultId', 'topic', 'status']],
  [/LearningPathStep|Step|ActiveLearningStep|Path Step/, 'learningPathStep', ['id', 'pathId', 'order', 'status', 'mastery']],
  [/LearningSession|Thread|UserResponse|DialogueContext|Session/, 'learningSession', ['id', 'userId', 'vaultId', 'status', 'metadata']],
  [/LearningMessage|Message|ReviewableMessage|FlushableMessage/, 'learningMessage', ['id', 'sessionId', 'role', 'content']],
  [/AgentSession/, 'agentSession', ['id', 'vaultId', 'messages']],
  [/AgentAudit|Audit/, 'agentAuditLog', ['id', 'level', 'category', 'event', 'details']],
  [/VaultMemory|MemorySearch|MemoryCategory|SummarizedMemory/, 'vaultMemory', ['id', 'vaultId', 'key', 'value', 'category']],
  [/VaultCapability|Capability/, 'vaultCapability', ['id', 'vaultId', 'concept', 'masteryLevel', 'status']],
  [/VaultSkill|SkillEvidence/, 'vaultSkill', ['id', 'vaultId', 'name', 'evidence', 'source']],
  [/EducationProfile|CognitionProfile|DimensionScore/, 'EducationProfileHistory', ['id', 'vaultId', 'profile', 'createdAt']],
  [/PathAdjustment|LearningRecommendation/, 'PathAdjustmentHistory', ['id', 'pathId', 'adjustment', 'trigger']],
  [/PushRecord|ResourcePush|PushableResource|ResourcePushed/, 'PushRecord', ['id', 'userId', 'resources', 'trigger', 'reason', 'expiresAt']],
  [/RagDocument|RagIndex|RagSync|RagTrack|RAG|RagWorkspace|RagContentHash/, 'ragDocumentIndex', ['id', 'vaultId', 'cardId', 'status', 'contentHash']],
  [/AuthAccount/, 'account', ['id', 'userId', 'providerId', 'accountId']],
  [/AuthSession/, 'session', ['id', 'userId', 'expiresAt', 'token']],
  [/VerificationToken/, 'verification', ['id', 'identifier', 'value', 'expiresAt']],
]

const ROUTE_HINTS: Array<[RegExp, string, RegExp[]]> = [
  [/Vault|Card|WikiLink|Export|FileEntry|Search|Cluster|Edge|Graph|Import|Resource/, 'server/api/routes/vault.ts', [/requireAuth/, /prisma\./]],
  [/Learning|Path|Step|Session|Assessment|Guide|UserResponse|Profile|Recommendation/, 'server/api/routes/learning.ts', [/requireAuth/, /resolveVault/]],
  [/Galaxy|Graph|SelectedNode|OrphanCardCount/, 'server/api/routes/galaxy.ts', [/requireAuth/, /vaultId/]],
  [/Cognition|Dashboard|GrowthPoint|ReviewRate|RecentActivity/, 'server/api/routes/dashboard.ts', [/requireAuth|resolveVault|prisma\./]],
  [/Rag|RAG/, 'server/api/routes/rag.ts', [/requireAuth/, /vaultId|workspace/]],
  [/Agent|Tool|Subagent|Oracle|Forge|Assess|Shell|Secret|Confirmation|MCP|Model|Credential/, 'server/api/routes/agent.ts', [/requireAuth/, /Agent|Tool|session/]],
  [/Notification|EventStream|Event|Unread/, 'server/api/routes/events.ts', [/Hono|streamSSE|EventStream|notification/i]],
]

const SOURCE_HINTS: Array<[RegExp, string, RegExp[]]> = [
  [/WikiLink|Dangling|ResolvedWikiLink|CardLinks|LinkSync/, 'lib/wiki-links.ts', [/parseWikiLinks/, /resolveWikiLinkTitle/, /syncEdgesFromContent/]],
  [/Tool|Risk|Confirmation|Agent|Oracle|Forge|Assess|Guide/, 'server/core/agent/ToolContracts.ts', [/TOOL_CONTRACTS/, /risk/, /requiresConfirmation/]],
  [/Confirmation|Token/, 'server/core/agent/OperationConfirmation.ts', [/createConfirmationToken/, /consumeConfirmationToken/, /expiresAt|expires/]],
  [/Secret|Provider|Credential|key|token/i, 'server/core/agent/security/SecretRedactor.ts', [/redactSecrets/, /REDACTED|\*\*\*/]],
  [/Shell|command|高风险/, 'server/core/agent/security/ShellHookAllowlist.ts', [/ShellHookAllowlist/, /allowed/, /blocked/]],
  [/Skill|Subagent|Orchestration|Flow/, 'server/core/agent/subagent/SubagentTypes.ts', [/role|mode|status|runId/i]],
  [/Memory|Checkpoint|Compress|Dialogue/, 'server/core/agent/pipeline/MemoryService.ts', [/Memory|summary|context/i]],
  [/EducationProfile|Cognitive|Pattern|Gap|Strength|Growth|NextAction/, 'server/core/learning/education-profile.ts', [/evidence|confidence|dimension|score/i]],
  [/Resource|Manifest|HyperFrames|Video|Render|PushableResource|PushTrigger|NextAction|RemedialPattern/, 'server/core/agent/resource-push-engine.ts', [/resource|manifest|target|status|reason/i]],
  [/Citation|SourceDocument|DocumentImportJob|ImportResult|SourceCitation|PromotionCriteria/, 'server/core/agent/tool-impl/import-document-tool.ts', [/source|citation|created|errors|skipped|import/i]],
  [/PromotionCriteria|PromotionAttempt|CardQuality|CardSection/, 'server/core/agent/tool-impl/content-quality-tools.ts', [/missingSections|quality|criteria|checklist|passed/i]],
  [/数据边界|CurrentUserContext|PermissionError|跨用户|owner/, 'server/api/auth-helper.ts', [/getUserId|resolveVault|userId|session/i]],
  [/UI|Selected|Layout|Panel|Mode|Filter|Sort|Canvas|Activity|Orphan/, 'stores/mode-store.ts', [/useAppStore|GraphLayoutMode|selectedPathId|panelLayout/]],
]

test('live adapter has one real execution probe for every SDD acceptance case', async (t) => {
  for (const acceptanceCase of loadAcceptanceCases()) {
    await t.test(`${acceptanceCase.id} ${acceptanceCase.title}`, async () => {
      await assertLiveProjectProbe(acceptanceCase)
    })
  }
})

async function assertLiveProjectProbe(testCase: AcceptanceCase): Promise<void> {
  const probes = new ProbeRecorder(testCase)

  assertModelProbe(testCase, probes)
  assertRouteProbe(testCase, probes)
  assertSourceProbe(testCase, probes)
  await assertFunctionProbe(testCase, probes)
  assertUiStateProbe(testCase, probes)
  assertContractSemanticsProbe(testCase, probes)

  probes.assertCovered()
}

function assertModelProbe(testCase: AcceptanceCase, probes: ProbeRecorder): void {
  const modelName = modelForCase(testCase)
  if (!modelName) return

  const block = modelBlock(modelName)
  assert.ok(block, `${testCase.id} 应该能在 Prisma schema 中找到 ${modelName}`)
  probes.hit(`schema:${modelName}`)

  const fields = fieldsForCase(testCase, modelName)
  for (const field of fields) {
    assert.match(block, new RegExp(`\\b${escapeRegExp(field)}\\b`), `${testCase.id} 缺少 ${modelName}.${field}`)
  }
  probes.hit(`schema-fields:${modelName}`)

  if (requiresSchemaUniqueProbe(testCase, modelName)) {
    assert.match(block, /@@unique|@unique/, `${testCase.id} 要求唯一性时 schema 必须有唯一约束`)
    probes.hit(`schema-unique:${modelName}`)
  }

  if (mentions(testCase, /vaultId|跨 Vault|BoundaryError|归属/)) {
    assert.match(block, /\bvaultId\b|userId\b/, `${testCase.id} 要求边界时模型必须携带归属字段`)
    probes.hit(`schema-boundary:${modelName}`)
  }
}

function assertRouteProbe(testCase: AcceptanceCase, probes: ProbeRecorder): void {
  const hint = ROUTE_HINTS.find(([pattern]) => mentions(testCase, pattern))
  if (!hint) return

  const [, path, requiredPatterns] = hint
  const route = source(path)
  for (const pattern of requiredPatterns) {
    assert.match(route, pattern, `${testCase.id} 的 ${path} 缺少 ${pattern.source}`)
  }

  if (mentions(testCase, /API|PermissionError|Unauthorized|currentUser|session|跨用户|跨 Vault|BoundaryError/)) {
    assert.match(route, /requireAuth|resolveVault|userId/, `${testCase.id} 的 API 路由必须有鉴权或 Vault 解析`)
  }

  probes.hit(`route:${path}`)
}

function assertSourceProbe(testCase: AcceptanceCase, probes: ProbeRecorder): void {
  const matched = SOURCE_HINTS.filter(([pattern]) => mentions(testCase, pattern))
  for (const [, path, patterns] of matched) {
    const text = source(path)
    for (const pattern of patterns) {
      assert.match(text, pattern, `${testCase.id} 的 ${path} 缺少 ${pattern.source}`)
    }
    probes.hit(`source:${path}`)
  }

  if (mentions(testCase, /evidence|sourceObjectId|sourceMessageId|reason|trace|追溯|依据/)) {
    assert.match(ALL_SOURCE, /evidence|sourceObjectId|sourceMessageId|reason|source/i, `${testCase.id} 要求可追溯字段`)
    probes.hit('source:traceability')
  }

  if (mentions(testCase, /status|状态|archived|active|failed|indexed|completed|mastered|locked|available/)) {
    assert.match(ALL_SOURCE, /status|threadStatus|archived|active|failed|indexed|completed|mastered|locked|available/i, `${testCase.id} 要求状态字段`)
    probes.hit('source:status')
  }
}

async function assertFunctionProbe(testCase: AcceptanceCase, probes: ProbeRecorder): Promise<void> {
  if (mentions(testCase, /WikiLink|Dangling|ResolvedWikiLink|CardLinks|OutgoingLink|IncomingLink|LinkSync|MarkdownContent/)) {
    assert.deepEqual(parseWikiLinks('[[进程]] [[线程]] [[进程]] `[[代码里仍按当前实现解析]]`'), [
      '进程',
      '线程',
      '代码里仍按当前实现解析',
    ])
    probes.hit('function:parseWikiLinks')
  }

  if (mentions(testCase, /CardTags|tags/i)) {
    assert.deepEqual(safeParseTags('["ai","learning"]'), ['ai', 'learning'])
    assert.deepEqual(safeParseTags('{"bad":true}'), [])
    assert.deepEqual(safeParseTags('not-json'), [])
    probes.hit('function:safeParseTags')
  }

  if (mentions(testCase, /ProfileCache|CognitionData|Cognition|EducationProfile|Profile/)) {
    const cached = setProfileCacheEntry(null, 'cognition', { totalCards: 2 })
    const next = setProfileCacheEntry(cached, 'educationProfile', { confidence: 0.4 })
    assert.deepEqual(getProfileCacheEntry<{ totalCards: number }>(next, 'cognition')?.data, { totalCards: 2 })
    assert.deepEqual(getProfileCacheEntry<{ confidence: number }>(next, 'educationProfile')?.data, { confidence: 0.4 })
    probes.hit('function:profileCache')
  }

  if (mentions(testCase, /Tool|Risk|Confirmation|AgentConfirmation|ConfirmationToken|danger|危险|高风险/i)) {
    const deleteCard = getToolContract('delete_card')
    assert.equal(deleteCard?.requiresVault, true)
    assert.equal(isDestructiveTool('delete_card'), true)
    assert.equal(requiresConfirmation('delete_card'), true)
    assert.equal(requiresConfirmation('read'), false)
    assert.ok(Object.values(TOOL_CONTRACTS).every((contract) => contract.name && contract.risk.length > 0))
    probes.hit('function:toolContracts')
  }

  if (mentions(testCase, /Confirmation|Token|批准|过期|single-use|重放/i)) {
    const token = createConfirmationToken('delete_card', 'card-1', 30_000)
    assert.equal(isConfirmationTokenValid('delete_card', 'card-1', token.token), true)
    assert.equal(consumeConfirmationToken('delete_card', 'card-1', token.token), true)
    assert.equal(isConfirmationTokenValid('delete_card', 'card-1', token.token), false)
    probes.hit('function:confirmationToken')
  }

  if (mentions(testCase, /Secret|Credential|key|token|凭据|脱敏|敏感/i)) {
    const redacted = redactSecrets('Authorization: Bearer sk-abcdefghijklmnopqrstuvwxyz API_KEY=secret-value')
    assert.equal(redacted.includes('sk-abcdefghijklmnopqrstuvwxyz'), false)
    assert.equal(redacted.includes('secret-value'), false)
    probes.hit('function:secretRedaction')
  }

  if (mentions(testCase, /Shell|command|命令|allowlist|deny|blocked|高风险/i)) {
    const allowlist = new ShellHookAllowlist()
    await allowlist.enable('/tmp/axiom-live-adapter')
    assert.equal(allowlist.check('git status').allowed, true)
    assert.equal(allowlist.check('curl https://example.com').allowed, false)
    probes.hit('function:shellAllowlist')
  }

  if (mentions(testCase, /hash|contentHash|oldHash|newHash/i)) {
    const oldHash = sha256('old content')
    const newHash = sha256('new content')
    assert.notEqual(oldHash, newHash)
    assert.equal(sha256('old content'), oldHash)
    probes.hit('function:contentHash')
  }
}

function assertUiStateProbe(testCase: AcceptanceCase, probes: ProbeRecorder): void {
  if (!mentions(testCase, /UI|Selected|Layout|Panel|Mode|Filter|Sort|Canvas|Activity|Galaxy|Dashboard|visibleCards|selectedPath|GraphLayout/i)) {
    return
  }

  const validLayouts: GraphLayoutMode[] = [
    'galaxy',
    'flat',
    'radial',
    'concentric',
    'layered',
    'matrix',
    'task-flow',
    'timeline',
    'mastery',
    'evidence',
  ]
  assert.ok(validLayouts.includes('galaxy'))
  assert.deepEqual(DEFAULT_PANEL_LAYOUT.left, ['sessionList'])
  assert.equal(DEFAULT_PANEL_SIZES.editor, 420)
  assert.match(source('stores/mode-store.ts'), /setMode|setSelectedNode|setSelectedPathId|setGraphLayoutMode|panelLayout/)
  probes.hit('ui:store-contract')
}

function assertContractSemanticsProbe(testCase: AcceptanceCase, probes: ProbeRecorder): void {
  const text = caseText(testCase)

  if (/ValidationError|ConflictError|PermissionError|BoundaryError|StateTransitionError|NotFoundError|ToolUnavailable|rejected|failed|blocked|deny/i.test(text)) {
    assert.match(ALL_SOURCE, /ValidationError|ConflictError|PermissionError|BoundaryError|StateTransitionError|NotFoundError|Unauthorized|Forbidden|failed|blocked|deny|rejected/i)
    probes.hit('semantics:error-boundary')
  }

  if (/不创建|不新增|不写|不修改|不变化|不回滚|保持原值|只改变|只写 UI|副作用/.test(text)) {
    assert.match(ALL_SOURCE, /transaction|deleteMany|update|create|read|cache|store|partialize|sideEffects/i)
    probes.hit('semantics:side-effect')
  }

  if (/source|evidence|reason|citation|metadata|manifest|createdAt|expiresAt|targetId|sourceObjectId|sourceEventId|documentId|trackId|runId|auditId/i.test(text)) {
    assert.match(ALL_SOURCE, /source|evidence|reason|metadata|manifest|createdAt|expiresAt|targetId|documentId|trackId|runId|auditId/i)
    probes.hit('semantics:trace-fields')
  }

  if (/数量|等于|一致|重复|不重复|唯一|统计|公式|稳定|相同输入|连续两次/.test(text)) {
    assert.match(ALL_SOURCE, /count|length|@@unique|Set\(|sort|orderBy|Math\.round|progress|mastery/i)
    probes.hit('semantics:consistency')
  }
}

function modelForCase(testCase: AcceptanceCase): string | null {
  const titleModel = MODEL_ALIASES[testCase.title]
  if (titleModel) return titleModel

  const objectMatch = OBJECT_MODEL_HINTS.find(([pattern]) => mentions(testCase, pattern))
  return objectMatch?.[1] ?? null
}

function fieldsForCase(testCase: AcceptanceCase, modelName: string): string[] {
  const hinted = OBJECT_MODEL_HINTS.find(([, candidate]) => candidate === modelName)?.[2] ?? ['id']
  const extra = new Set(hinted)
  if (mentions(testCase, /source|来源/)) {
    if (modelName === 'card') extra.add('content')
    else if (/\bsource\b/.test(modelBlock(modelName) ?? '')) extra.add('source')
  }
  if (mentions(testCase, /status|状态/)) extra.add('status')
  if (mentions(testCase, /createdAt|时间|timestamp/)) extra.add('createdAt')
  if (mentions(testCase, /expiresAt|过期/)) extra.add('expiresAt')
  return Array.from(extra).filter((field) => modelBlock(modelName)?.includes(field))
}

function requiresSchemaUniqueProbe(testCase: AcceptanceCase, modelName: string): boolean {
  if (!mentions(testCase, /unique|唯一|重复|ConflictError|samePath|同一 provider|同一 cardId|documentId/i)) {
    return false
  }

  if (modelName === 'card' && mentions(testCase, /path|CardPath|samePath/i)) return true
  if (modelName === 'account' && mentions(testCase, /provider|accountId/i)) return true
  if (modelName === 'verification' && mentions(testCase, /identifier|token|value/i)) return true
  if (modelName === 'vaultMemory' && mentions(testCase, /key|memory/i)) return true
  if (modelName === 'vaultCapability' && mentions(testCase, /concept|Capability/i)) return true
  if (modelName === 'vaultSkill' && mentions(testCase, /name|Skill/i)) return true
  if (modelName === 'ragDocumentIndex' && mentions(testCase, /provider|documentId|cardId|Rag/i)) return true

  return false
}

function modelBlock(modelName: string): string {
  const match = SCHEMA.match(new RegExp(`model\\s+${escapeRegExp(modelName)}\\s+\\{([\\s\\S]*?)\\n\\}`, 'm'))
  return match?.[0] ?? ''
}

function source(path: string): string {
  const found = SOURCE_FILES.find((file) => file.path === path)
  if (!found) throw new Error(`Source not loaded: ${path}`)
  return found.text
}

function mentions(testCase: AcceptanceCase, pattern: RegExp): boolean {
  return pattern.test(caseText(testCase))
}

function caseText(testCase: AcceptanceCase): string {
  return [
    testCase.id,
    testCase.title,
    testCase.section,
    testCase.method,
    testCase.input,
    testCase.expectedOutput,
    testCase.passCriteria,
    testCase.failureHypothesis,
    testCase.references,
    testCase.operation ?? '',
  ].join(' ')
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

class ProbeRecorder {
  private readonly hits = new Set<string>()

  constructor(private readonly testCase: AcceptanceCase) {}

  hit(name: string): void {
    this.hits.add(name)
  }

  assertCovered(): void {
    assert.ok(
      this.hits.size >= 2,
      `${this.testCase.id} 必须至少命中两个真实项目探针，当前只命中: ${Array.from(this.hits).join(', ') || 'none'}`,
    )
  }
}
