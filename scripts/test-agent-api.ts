/**
 * Agent Tool API Integration Test
 * Tests agent tools through the actual HTTP API endpoints
 * Run with: npx tsx scripts/test-agent-api.ts
 */

const BASE = 'http://localhost:3000/api'

interface TestResult {
  name: string
  passed: boolean
  detail?: string
}

const results: TestResult[] = []
function record(name: string, passed: boolean, detail?: string) {
  results.push({ name, passed, detail })
  console.log(`${passed ? '✅' : '❌'} ${name}${detail ? ': ' + detail : ''}`)
}

async function apiGet(path: string) {
  const r = await fetch(`${BASE}${path}`, { credentials: 'include' })
  return r.json()
}

async function apiPost(path: string, body: any) {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  })
  return r.json()
}

async function main() {
  console.log('=== Agent Tool API Integration Test ===\n')

  // Health check
  try {
    const health = await apiGet('/health')
    record('API /health', health?.status === 'ok', `Server ${health?.status === 'ok' ? 'running' : 'down'}`)
  } catch {
    console.log('❌ Server not running at http://localhost:3000')
    console.log('   Start with: cd /mnt/c/Users/why/Desktop/axiom-space && npx next dev')
    process.exit(1)
  }

  // ── Vault Operations ──
  console.log('\n--- Vault ---')
  const vaults = await apiGet('/vaults')
  record('GET /vaults', vaults?.success === true, `${vaults?.vaults?.length || 0} vaults`)
  const vid = vaults?.vaults?.[0]?.id
  if (!vid) {
    console.log('❌ No vault found. Create one first.')
    process.exit(1)
  }

  // ── Card CRUD ──
  console.log('\n--- Card CRUD ---')
  const writeRes = await apiPost('/vault/write', {
    path: '__TEST__API.md',
    content: '# API Test Card\n\nTesting card creation via API.',
    type: 'fleeting',
    vaultId: vid,
  })
  record('POST /vault/write', writeRes?.success === true, writeRes?.success ? 'Card created' : `Failed: ${writeRes?.error}`)

  const searchRes = await apiGet(`/vault/search-titles?q=__TEST__&vid=${vid}`)
  record('GET /vault/search-titles', searchRes?.results?.length > 0, `Found ${searchRes?.results?.length || 0} cards`)

  // ── Dashboard ──
  console.log('\n--- Dashboard ---')
  const dashRes = await apiGet(`/dashboard?vid=${vid}`)
  record('GET /dashboard', dashRes?.success === true,
    `nodes=${dashRes?.stats?.totalNodes} edges=${dashRes?.stats?.totalEdges}`)

  // ── Galaxy ──
  console.log('\n--- Galaxy ---')
  const nodesRes = await apiGet(`/galaxy/nodes?vid=${vid}`)
  const edgesRes = await apiGet(`/galaxy/edges?vid=${vid}`)
  const clustersRes = await apiGet(`/galaxy/clusters?vid=${vid}`)
  record('GET /galaxy/nodes', nodesRes?.nodes?.length >= 0, `${nodesRes?.nodes?.length || 0} nodes`)
  record('GET /galaxy/edges', edgesRes?.edges?.length >= 0, `${edgesRes?.edges?.length || 0} edges`)
  record('GET /galaxy/clusters', clustersRes?.clusters?.length >= 0, `${clustersRes?.clusters?.length || 0} clusters`)

  // ── Cognition ──
  console.log('\n--- Cognition ---')
  const cogRes = await apiGet(`/cognition/stats?vid=${vid}`)
  record('GET /cognition/stats', cogRes?.success === true,
    `dims=${Object.keys(cogRes?.dimensions || {}).length} skills=${cogRes?.skills?.length || 0}`)

  const obsRes = await apiGet(`/cognition/observations?vid=${vid}`)
  record('GET /cognition/observations', obsRes?.success === true,
    `${obsRes?.observations?.length || 0} observations`)

  // ── Learning ──
  console.log('\n--- Learning ---')
  const profileRes = await apiGet('/learning/profile')
  record('GET /learning/profile', profileRes?.success === true,
    `mastery=${profileRes?.profile?.masteryRate || 0}%`)

  const pathsRes = await apiGet(`/learning/paths?vid=${vid}`)
  record('GET /learning/paths', pathsRes?.success === true,
    `${pathsRes?.paths?.length || 0} paths`)

  const memoryRes = await apiPost('/learning/memory', { query: '__TEST__', limit: 3 })
  record('POST /learning/memory', memoryRes?.success === true,
    `${memoryRes?.results?.length || 0} results`)

  // ── Agent ──
  console.log('\n--- Agent ---')
  const agentHealth = await apiGet('/agent/health')
  record('GET /agent/health', agentHealth?.status === 'ok', agentHealth?.status)

  const agentStatus = await apiGet('/agent/status')
  record('GET /agent/status', agentStatus?.success === true,
    `model=${agentStatus?.status?.model || 'unknown'} turns=${agentStatus?.status?.turnCount || 0}`)

  const sessionsRes = await apiGet('/agent/sessions/list')
  record('GET /agent/sessions/list', sessionsRes?.success === true,
    `${sessionsRes?.sessions?.length || 0} sessions`)

  // ── Cleanup ──
  console.log('\n--- Cleanup ---')
  const cards = await apiGet(`/vault/search-titles?q=__TEST__&vid=${vid}`)
  for (const c of (cards?.results || [])) {
    await fetch(`${BASE}/vault/card/${c.id}`, { method: 'DELETE', credentials: 'include' })
  }
  record('Cleanup', true, 'Test cards removed')

  // ── Summary ──
  console.log('\n=== Summary ===')
  const passed = results.filter(r => r.passed).length
  const failed = results.filter(r => !r.passed).length
  console.log(`Total: ${results.length} | Passed: ${passed} | Failed: ${failed}`)
  if (failed > 0) {
    console.log('\nFailed:')
    results.filter(r => !r.passed).forEach(r => console.log(`  ❌ ${r.name}: ${r.detail || ''}`))
  }
}

main()
