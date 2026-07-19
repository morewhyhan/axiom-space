import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium, type APIResponse, type Page } from '@playwright/test'
import { searchSemanticCards } from '@/server/core/rag/semantic-index-service'

const baseUrl = process.env.A3_JUDGE_URL || 'http://127.0.0.1:3002'
const email = process.env.A3_JUDGE_EMAIL || 'demo@axiom.space'
const password = process.env.A3_JUDGE_PASSWORD || 'demo123456'

async function login(page: Page) {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const emailInput = page.getByLabel(/邮箱|email/i)
  if (!await emailInput.isVisible().catch(() => false)) {
    const loginButton = page.getByRole('button', { name: /登录|sign in|log in/i }).first()
    await loginButton.waitFor({ state: 'visible', timeout: 30_000 })
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await loginButton.click()
      if (await emailInput.isVisible().catch(() => false)) break
      await page.waitForTimeout(750)
    }
  }
  await emailInput.fill(email)
  await page.getByLabel(/密码|password/i).fill(password)
  await page.getByRole('button', { name: /登录|sign in|log in/i }).last().click()
  await page.getByRole('button', { name: /进入知识库/ }).waitFor({ state: 'visible', timeout: 30_000 })
}

async function json(response: APIResponse) {
  const body = await response.json()
  assert(response.ok(), `HTTP ${response.status()}: ${JSON.stringify(body)}`)
  return body
}

async function main() {
  await mkdir('test/artifacts/semantic-index-e2e', { recursive: true })
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const suffix = Date.now().toString(36)
  const vaultName = `语义索引端到端验收-${suffix}`
  let vaultId = ''

  try {
    await login(page)
    const created = await json(await context.request.post(`${baseUrl}/api/vaults`, { data: { name: vaultName } })) as { vault: { id: string } }
    vaultId = created.vault.id
    const title = `运行期分派验收-${suffix}`
    const path = `验收/${title}.md`
    const content = `# ${title}\n\n当接口变量指向具体实现时，重写方法根据接收者的真实类型在运行期选择。这个机制可以与 Visitor 中的第二次分派建立联系。`
    const startedAt = Date.now()
    await json(await context.request.post(`${baseUrl}/api/vault/write`, { data: { path, content, type: 'fleeting', vaultId } }))

    let cardId = ''
    for (let attempt = 0; attempt < 20 && !cardId; attempt += 1) {
      const result = await json(await context.request.get(`${baseUrl}/api/vault/search-titles?q=${encodeURIComponent(title)}&vid=${vaultId}`)) as { results?: Array<{ id: string; title: string }> }
      cardId = result.results?.find((item) => item.title === title)?.id || ''
      if (!cardId) await page.waitForTimeout(250)
    }
    assert(cardId, 'Saved card did not appear through the real vault search API')

    let status: Record<string, unknown> | null = null
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const result = await json(await context.request.get(`${baseUrl}/api/rag/card/${cardId}/status?vid=${vaultId}`)) as { status: Record<string, unknown> }
      status = result.status
      if (status.status === 'indexed') break
      if (status.status === 'failed') throw new Error(`Semantic indexing failed: ${JSON.stringify(status)}`)
      await page.waitForTimeout(1000)
    }
    const searchableMs = Date.now() - startedAt
    assert.equal(status?.status, 'indexed', `Card was not searchable within 60 seconds: ${JSON.stringify(status)}`)
    assert(searchableMs < 120_000, `Semantic indexing exceeded two minutes: ${searchableMs}ms`)

    const query = await json(await context.request.post(`${baseUrl}/api/rag/query?vid=${vaultId}`, {
      data: { query: '接口变量真正执行哪个重写实现，是由编译期还是对象真实类型决定？', mode: 'mix', topK: 5 },
    })) as { result: { references: Array<{ cardId: string }> } }
    assert(query.result.references.some((reference) => reference.cardId === cardId), 'Semantic query did not retrieve the newly created card')

    await page.reload({ waitUntil: 'domcontentloaded', timeout: 120_000 })
    const enterVault = page.getByRole('button', { name: /进入知识库/ })
    await enterVault.waitFor({ state: 'visible', timeout: 30_000 })
    await enterVault.click()
    await page.getByRole('button', { name: new RegExp(vaultName) }).first().click()
    await page.getByTestId('mode-nav-forge').waitFor({ state: 'visible', timeout: 30_000 })
    const skipOnboarding = page.getByRole('button', { name: '直接开始使用' })
    await skipOnboarding.waitFor({ state: 'visible', timeout: 4_000 }).catch(() => null)
    if (await skipOnboarding.isVisible().catch(() => false)) await skipOnboarding.click()
    await page.getByTestId('mode-nav-forge').click()
    await page.getByTestId('forge-activity-cards').waitFor({ state: 'visible', timeout: 30_000 }).catch(async (error) => {
      console.error((await page.locator('body').innerText()).slice(0, 5000))
      throw error
    })
    await page.getByTestId('forge-activity-cards').click()
    await page.getByTestId('forge-left-search-cards').fill(title)
    await page.getByRole('button', { name: new RegExp(`打开卡片 ${title}`) }).click()
    await page.getByText('已可语义搜索', { exact: true }).waitFor({ state: 'visible', timeout: 30_000 })
    if ((status?.graph as { status?: string } | null)?.status === 'indexing') {
      await page.getByText(/后台图谱增强中/).waitFor({ state: 'visible', timeout: 30_000 })
    }
    await page.screenshot({ path: 'test/artifacts/semantic-index-e2e/searchable-with-background-graph.png', fullPage: true })

    await json(await context.request.delete(`${baseUrl}/api/vaults/${vaultId}`, { data: { confirmName: vaultName } }))
    const deletedHits = await searchSemanticCards(vaultId, '运行期分派', 5)
    assert.equal(deletedHits.length, 0, 'Deleting a vault must remove its Qdrant vectors')
    vaultId = ''

    console.log(JSON.stringify({
      cardSaved: true,
      semanticProvider: status?.provider,
      searchableMs,
      semanticQueryRetrievedCard: true,
      frontendSearchableStatusVisible: true,
      qdrantCleanupVerified: true,
      graphStatusAtSearchable: (status?.graph as { status?: string } | null)?.status || 'not-started',
    }, null, 2))
  } finally {
    if (vaultId) {
      await context.request.delete(`${baseUrl}/api/vaults/${vaultId}`, { data: { confirmName: vaultName } }).catch(() => null)
    }
    await context.close()
    await browser.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
