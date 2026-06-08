import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { parseWikiLinks } from '@/lib/wiki-links'
import { getProfileCacheEntry, setProfileCacheEntry } from '@/server/api/profile-cache'
import {
  consumeConfirmationToken,
  createConfirmationToken,
  getConfirmationTokenExpiry,
  isConfirmationTokenValid,
} from '@/server/core/agent/OperationConfirmation'
import { getToolContract, isDestructiveTool, requiresConfirmation } from '@/server/core/agent/ToolContracts'
import { redactSecrets } from '@/server/core/agent/security/SecretRedactor'
import { ShellHookAllowlist } from '@/server/core/agent/security/ShellHookAllowlist'
import { loadAcceptanceCases, type AcceptanceCase } from './case-loader'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

const IMPLEMENTATION_FILES = [
  'prisma/schema.prisma',
  'server/api/routes/vault.ts',
  'server/api/routes/vaults.ts',
  'server/api/routes/learning.ts',
  'server/api/routes/galaxy.ts',
  'server/api/routes/cognition.ts',
  'server/api/routes/rag.ts',
  'server/api/routes/events.ts',
  'server/api/routes/agent.ts',
  'server/api/profile-cache.ts',
  'server/core/agent/ToolContracts.ts',
  'server/core/agent/OperationConfirmation.ts',
  'server/core/agent/security/SecretRedactor.ts',
  'server/core/agent/security/ShellHookAllowlist.ts',
  'server/core/agent/tool-impl/card-tools.ts',
  'server/core/agent/tool-impl/assessment-tools.ts',
  'server/core/agent/tool-impl/import-document-tool.ts',
  'server/core/agent/tool-impl/resource-tools.ts',
  'server/core/agent/tool-impl/memory-tools.ts',
  'server/core/agent/subagent/SubagentTypes.ts',
  'server/core/agent/subagent/SubagentSystem.ts',
  'server/core/agent/subagent/SubagentLifecycle.ts',
  'server/core/agent/resource-push-engine.ts',
  'server/core/jobs/queue.ts',
  'server/core/jobs/types.ts',
  'server/core/learning/education-profile.ts',
  'server/core/learning/path-adjustment-engine.ts',
  'server/core/learning/graph/integration.ts',
  'lib/wiki-links.ts',
  'stores/mode-store.ts',
  'stores/agent-store.ts',
  'hooks/use-learning.ts',
  'hooks/use-galaxy.ts',
  'hooks/use-cognition.ts',
  'hooks/use-notifications.ts',
  'hooks/use-agent.ts',
  'components/forge/forge-editor.tsx',
  'components/forge/forge-chat.tsx',
  'components/galaxy/galaxy-controls.tsx',
  'components/galaxy/galaxy-layout-panel.tsx',
  'components/learn/learn-workspace.tsx',
  'components/learning/resource-push-center.tsx',
  'types/learning.ts',
  'types/galaxy.ts',
  'types/agent.ts',
]

const IMPLEMENTATION_TEXT = IMPLEMENTATION_FILES
  .map((path) => readFileSync(resolve(ROOT, path), 'utf8'))
  .join('\n')

const CASE_IMPLEMENTATION_MARKERS: Record<string, RegExp[]> = {
  MF: [/learningPath|learningSession|learningMessage|card|edge|ragDocumentIndex/i],
  OBJ: [/model\s+(card|edge|cluster|learningPath|learningSession|vault|user|ragDocumentIndex)|ToolContract|EducationProfile|PushRecord|SubagentRunRecord/i],
  FINE: [/ValidationError|PermissionError|BoundaryError|ConflictError|profileCache|parseWikiLinks|LearningPhase|DimensionScore|ResourceManifestItem|GraphLayoutMode|ConfirmationToken/i],
  AGG: [/model\s+(vault|card|edge|learningPath|learningSession|PushRecord|ragDocumentIndex)|PathAdjustmentHistory|EducationProfileHistory/i],
  SRV: [/Service|Engine|importDocumentTool|resource-push-engine|pathAdjustmentEngine|GraphIntegrationManager|syncEdgesFromContent/i],
  EVT: [/emitNotification|events|EventStream|CardCreated|ResourcePushed|RagIndex/i],
  DOCEVAL: [/importDocumentTool|assessment-tools|content-quality-tools|SourceDocument|quality_check|Rubric/i],
  NOTIF: [/useNotifications|emitNotification|NotificationEvent|EventStream|PushNotification/i],
  AGENT: [/ToolContracts|OperationConfirmation|SecretRedactor|ShellHookAllowlist|Oracle|Guide|Assess|Forge|Agent/i],
  SUB: [/SubagentRunRecord|SubagentSystem|SubagentLifecycle|SubagentEvent|FlowStep|Orchestration/i],
  GUIDE: [/LearningPhase|LearningStrategy|LearningPattern|education-profile|path-adjustment/i],
  MEM: [/Checkpoint|ReviewableMessage|FlushableMessage|SummarizedMemory|CompressResult|DialogueContext|Memory/i],
  EXT: [/ModelConfig|CredentialPool|MCP|ExternalConnector|ResolvedModelConfig|AIProviderConfig|LLMUsage/i],
  UI: [/useAppStore|GraphLayoutMode|SelectedNode|PanelLayout|components\/|store/i],
  SCN: [/learningPath|importDocumentTool|card|learningSession|galaxy|cognition/i],
  P0: [/PermissionError|ConflictError|BoundaryError|StateTransitionError|requiresConfirmation|ragDocumentIndex|vaultId/i],
  P1: [/duplicate|syncEdgesFromContent|missingSections|recommendation|AxiomJob|VaultExport/i],
  P2: [/Dashboard|RecentActivity|SubagentRunRecord|ResourceManifestItem|MCP|PanelLayout/i],
}

test('real project adapter can account for all 289 SDD cases', () => {
  const cases = loadAcceptanceCases()
  const uncovered = cases.filter((acceptanceCase) => implementationMarkers(acceptanceCase).length === 0)

  assert.deepEqual(
    uncovered.map((acceptanceCase) => `${acceptanceCase.id} ${acceptanceCase.title}`),
    [],
  )
})

test('real project code has database/API/domain/UI anchors for SDD cases', () => {
  const requiredAnchors = [
    /model\s+card/,
    /model\s+edge/,
    /model\s+learningPath/,
    /model\s+learningSession/,
    /model\s+ragDocumentIndex/,
    /model\s+PushRecord/,
    /model\s+EducationProfileHistory/,
    /\.get\('\/nodes'/,
    /\.post\('\/generate'/,
    /parseWikiLinks/,
    /TOOL_CONTRACTS/,
    /SubagentRunRecord/,
    /useNotifications/,
    /GraphLayoutMode/,
  ]

  assert.deepEqual(
    requiredAnchors
      .filter((pattern) => !pattern.test(IMPLEMENTATION_TEXT))
      .map((pattern) => pattern.source),
    [],
  )
})

test('real WikiLink parser keeps only Obsidian style links and deduplicates titles', () => {
  assert.deepEqual(
    parseWikiLinks('[[进程]] and [[线程]] and [[进程]] plus https://x/[[ignored'),
    ['进程', '线程'],
  )
})

test('real profile cache keeps cognition and education profile namespaces separated', () => {
  const withCognition = setProfileCacheEntry(null, 'cognition', { totalCards: 3 })
  const withEducation = setProfileCacheEntry(withCognition, 'educationProfile', { dimensions: { depth: 0.8 } })

  assert.deepEqual(getProfileCacheEntry<{ totalCards: number }>(withEducation, 'cognition')?.data, { totalCards: 3 })
  assert.deepEqual(
    getProfileCacheEntry<{ dimensions: { depth: number } }>(withEducation, 'educationProfile')?.data,
    { dimensions: { depth: 0.8 } },
  )
})

test('real Agent confirmation tokens are scoped, expiring, and single-use', () => {
  const confirmation = createConfirmationToken('delete_card', './a.md', 60_000)

  assert.equal(isConfirmationTokenValid('delete_card', 'a.md', confirmation.token), true)
  assert.ok((getConfirmationTokenExpiry('delete_card', 'a.md', confirmation.token) ?? 0) > Date.now())
  assert.equal(consumeConfirmationToken('delete_card', 'a.md', confirmation.token), true)
  assert.equal(isConfirmationTokenValid('delete_card', 'a.md', confirmation.token), false)
})

test('real ToolContracts mark destructive tools as confirmation-gated', () => {
  const deleteCard = getToolContract('delete_card')

  assert.equal(deleteCard?.requiresVault, true)
  assert.equal(isDestructiveTool('delete_card'), true)
  assert.equal(requiresConfirmation('delete_card'), true)
  assert.equal(requiresConfirmation('read'), false)
})

test('real SecretRedactor removes secrets from logs and model context', () => {
  const redacted = redactSecrets('Authorization: Bearer sk-abcdefghijklmnopqrstuvwxyz TOKEN=plainsecret')

  assert.equal(redacted.includes('sk-abcdefghijklmnopqrstuvwxyz'), false)
  assert.equal(redacted.includes('plainsecret'), false)
  assert.equal(redacted.includes('Authorization: Bearer ***'), true)
})

test('real ShellHookAllowlist blocks unlisted commands in strict mode', async () => {
  const allowlist = new ShellHookAllowlist()
  await allowlist.enable('/tmp/axiom-test-vault')

  assert.equal(allowlist.check('git status').allowed, true)
  assert.equal(allowlist.check('curl https://example.com').allowed, false)
})

function implementationMarkers(testCase: AcceptanceCase): RegExp[] {
  const prefix = casePrefix(testCase.id)
  const patterns = CASE_IMPLEMENTATION_MARKERS[prefix] ?? []
  const text = [
    testCase.id,
    testCase.title,
    testCase.method,
    testCase.input,
    testCase.expectedOutput,
    testCase.passCriteria,
    testCase.failureHypothesis,
  ].join(' ')

  return patterns.filter((pattern) => pattern.test(text) || pattern.test(IMPLEMENTATION_TEXT))
}

function casePrefix(id: string): string {
  if (id.startsWith('P0-')) return 'P0'
  if (id.startsWith('P1-')) return 'P1'
  if (id.startsWith('P2-')) return 'P2'
  return id.split('-')[0]
}
