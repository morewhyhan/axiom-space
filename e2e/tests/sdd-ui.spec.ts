import { expect, test } from '@playwright/test'

test.describe('SDD UI/E2E contracts', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuthenticatedMvp(page)
  })

  test('user can enter the app and switch Dashboard, Forge, Galaxy, Cognition, and Learn modes', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await page.getByText('SDD E2E Vault').click()

    await expect(page.locator('#mode-nav')).toBeVisible()
    await expect(page.getByRole('button', { name: /DASHBOARD/ })).toHaveClass(/active/)

    await page.getByRole('button', { name: /WORKSPACE/ }).click()
    await expect(page.getByRole('button', { name: /WORKSPACE/ })).toHaveClass(/active/)

    await page.getByRole('button', { name: /GRAPH/ }).click()
    await expect(page.getByRole('button', { name: /GRAPH/ })).toHaveClass(/active/)
    await expect(page.locator('#reset-view-btn')).toBeVisible()

    await page.getByRole('button', { name: /INSIGHTS/ }).click()
    await expect(page.getByRole('button', { name: /INSIGHTS/ })).toHaveClass(/active/)

    await page.getByRole('button', { name: /PATH/ }).click()
    await expect(page.getByRole('button', { name: /PATH/ })).toHaveClass(/active/)
  })

  test('modal actions open and close without mutating current graph data', async ({ page }) => {
    const requests: string[] = []
    page.on('request', (request) => {
      if (request.method() !== 'GET') requests.push(`${request.method()} ${request.url()}`)
    })

    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await page.getByText('SDD E2E Vault').click()

    await page.getByText('+ 新建').first().click()
    await expect(page.locator('.modal-overlay')).toBeVisible()
    await page.locator('.modal-close').first().click()
    await expect(page.locator('.modal-overlay')).toBeHidden()

    await page.getByRole('button', { name: /GRAPH/ }).click()
    await expect(page.locator('#reset-view-btn')).toBeVisible()
    expect(requests.filter((request) => /card|path|session|edge/.test(request))).toEqual([])
  })

  test('keyboard shortcuts change mode but do not create domain objects', async ({ page }) => {
    const requests: string[] = []
    page.on('request', (request) => {
      if (request.method() !== 'GET') requests.push(`${request.method()} ${request.url()}`)
    })

    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await page.getByText('SDD E2E Vault').click()
    await page.keyboard.press('Control+3')
    await expect(page.getByRole('button', { name: /GRAPH/ })).toHaveClass(/active/)
    await page.keyboard.press('Control+5')
    await expect(page.getByRole('button', { name: /PATH/ })).toHaveClass(/active/)

    expect(requests.filter((request) => /card|path|session|edge/.test(request))).toEqual([])
  })

  test('unauthenticated landing path exposes login and registration without loading app modes', async ({ page }) => {
    await page.unroute('**/api/auth/**')
    await page.route('**/api/auth/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(null) }))

    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('button', { name: '登录' })).toBeVisible()
    await expect(page.getByRole('button', { name: '注册' })).toBeVisible()
    await expect(page.locator('#mode-nav')).toBeHidden()
  })
})

async function mockAuthenticatedMvp(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem('axiom-store', JSON.stringify({
      state: {
        hasCompletedOnboarding: true,
        currentVaultId: 'vault-e2e',
        lastVaultId: 'vault-e2e',
      },
      version: 5,
    }))
  })

  await page.route('**/api/auth/**', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        session: { id: 'session-e2e', userId: 'user-e2e', expiresAt: new Date(Date.now() + 3600_000).toISOString() },
        user: { id: 'user-e2e', name: 'E2E User', email: 'e2e@example.com' },
      }),
    })
  })

  await page.route('**/api/vaults', (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, vaults: [{ id: 'vault-e2e', name: 'SDD E2E Vault', cardCount: 2 }] }),
      })
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, vault: { id: 'vault-e2e-new', name: 'New Vault' } }),
    })
  })

  await page.route('**/api/galaxy/nodes**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      success: true,
      nodes: [
        { id: 'card-a', title: 'SDD Card A', type: 'permanent', clusterId: 'cluster-a', clusterName: 'Core', clusterColor: '#22c55e', tags: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        { id: 'card-b', title: 'SDD Card B', type: 'fleeting', clusterId: null, clusterName: null, clusterColor: null, tags: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      ],
    }),
  }))
  await page.route('**/api/galaxy/edges**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ success: true, edges: [{ id: 'edge-a', sourceId: 'card-a', targetId: 'card-b', weight: 1, type: 'related' }] }),
  }))
  await page.route('**/api/galaxy/clusters**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ success: true, clusters: [{ id: 'cluster-a', name: 'Core', color: '#22c55e', position: 0, cardCount: 1 }] }),
  }))
  await page.route('**/api/learning/paths**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      success: true,
      activePath: 'path-a',
      activeStep: 0,
      paths: [{
        id: 'path-a',
        name: 'SDD Path',
        topic: 'First Principles',
        status: 'active',
        progress: 0,
        totalCount: 1,
        doneCount: 0,
        steps: [{ id: 'step-a', index: 1, name: 'Step A', status: 'available', concept: 'Concept A', mastery: 0 }],
      }],
    }),
  }))
  await page.route('**/api/learning/profile**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ success: true, profile: { totalCards: 2, permanentCount: 1, masteryRate: 50, domains: [], recentSessions: [] } }),
  }))
  await page.route('**/api/dashboard**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ success: true, stats: { totalCards: 2, permanentCount: 1, fleetingCount: 1, literatureCount: 0, totalEdges: 1, totalClusters: 1, recentActivity: [] } }),
  }))
  await page.route('**/api/cognition/**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ success: true, stats: {}, gaps: [], observations: [] }),
  }))
  await page.route('**/api/events/unread**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ success: true, count: 0 }),
  }))
  await page.route('**/api/events/stream**', (route) => route.fulfill({
    status: 200,
    contentType: 'text/event-stream',
    body: '',
  }))
}
