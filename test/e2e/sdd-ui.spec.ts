import { expect, test } from '@playwright/test'

test.describe('SDD UI/E2E contracts', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuthenticatedMvp(page)
  })

  test('user can enter the app and switch Dashboard, Forge, Galaxy, Cognition, and Learn modes', async ({ page }) => {
    await enterAuthenticatedWorkspace(page)

    await expect(page.locator('#mode-nav')).toBeVisible()
    await expect(page.getByRole('button', { name: /DASHBOARD/ })).toHaveClass(/active/)

    await clickMode(page, /WORKSPACE/)
    await expect(page.getByRole('button', { name: /WORKSPACE/ })).toHaveClass(/active/)

    await clickMode(page, /GRAPH/)
    await expect(page.getByRole('button', { name: /GRAPH/ })).toHaveClass(/active/)
    await expect(page.locator('#reset-view-btn')).toBeVisible()

    await clickMode(page, /INSIGHTS/)
    await expect(page.getByRole('button', { name: /INSIGHTS/ })).toHaveClass(/active/)

    await clickMode(page, /PATH/)
    await expect(page.getByRole('button', { name: /PATH/ })).toHaveClass(/active/)
  })

  test('modal actions open and close without mutating current graph data', async ({ page }) => {
    const requests: string[] = []
    page.on('request', (request) => {
      if (request.method() !== 'GET') requests.push(`${request.method()} ${request.url()}`)
    })

    await enterAuthenticatedWorkspace(page)

    await page.getByText('+ 新建').first().click()
    await expect(page.locator('.modal-overlay')).toBeVisible()
    await page.locator('.modal-close').first().click()
    await expect(page.locator('.modal-overlay')).toBeHidden()

    await clickMode(page, /GRAPH/)
    await expect(page.locator('#reset-view-btn')).toBeVisible()
    expect(requests.filter((request) => /card|path|session|edge/.test(request))).toEqual([])
  })

  test('Forge left panel pills are clickable and keep their own selection state', async ({ page }) => {
    await enterAuthenticatedWorkspace(page)

    await clickMode(page, /WORKSPACE/)
    await page.getByTitle('路径与会话').click()

    const leftPanel = page.locator('.forge-left-panel')
    const contextTabs = page.locator('.forge-left-tabs').first()
    await expect(contextTabs).toBeVisible()
    await expect(contextTabs.getByRole('tab', { name: /任务/ })).toHaveAttribute('aria-selected', 'true')
    await expect(contextTabs.getByRole('tab', { name: /对话/ })).toHaveAttribute('aria-selected', 'false')
    await expect(leftPanel.getByText('SDD Path')).toBeVisible()
    await expectLeftPillHitTargets(page)

    const taskRow = leftPanel.getByRole('button', { name: /SDD Path/ }).first()
    await taskRow.click({ timeout: 30_000 })
    await expect(leftPanel.getByRole('button', { name: /Step A 可开始/ })).toBeVisible()
    await taskRow.click({ timeout: 30_000 })
    await expect(leftPanel.getByRole('button', { name: /Step A 可开始/ })).toBeHidden()

    await contextTabs.getByRole('tab', { name: /对话/ }).click()
    await expect(contextTabs.getByRole('tab', { name: /对话/ })).toHaveAttribute('aria-selected', 'true')
    await expect(leftPanel.getByText('SDD Talk')).toBeVisible()
    await leftPanel.getByRole('button', { name: /SDD Talk/ }).click({ timeout: 30_000 })
    await expect(page.getByText('Card Preview')).toBeVisible()

    await contextTabs.getByRole('tab', { name: /任务/ }).click()
    await expect(contextTabs.getByRole('tab', { name: /任务/ })).toHaveAttribute('aria-selected', 'true')
    await expect(leftPanel.getByText('SDD Path')).toBeVisible()

    await page.getByTitle('卡片库').click()
    const cardTabs = page.locator('.forge-left-tabs').first()
    await expect(cardTabs.getByRole('tab', { name: '全部' })).toHaveAttribute('aria-selected', 'true')
    await expectLeftPillHitTargets(page)

    await cardTabs.getByRole('tab', { name: '永久' }).click()
    await expect(cardTabs.getByRole('tab', { name: '永久' })).toHaveAttribute('aria-selected', 'true')
    await expect(leftPanel.getByText('SDD Card A')).toBeVisible()
    await expect(leftPanel.getByText('SDD Card B')).toBeHidden()

    await cardTabs.getByRole('tab', { name: '灵感' }).click()
    await expect(cardTabs.getByRole('tab', { name: '灵感' })).toHaveAttribute('aria-selected', 'true')
    await expect(leftPanel.getByText('SDD Card B')).toBeVisible()
    await expect(leftPanel.getByText('SDD Card A')).toBeHidden()

    await cardTabs.getByRole('tab', { name: '全部' }).click()
    await expect(cardTabs.getByRole('tab', { name: '全部' })).toHaveAttribute('aria-selected', 'true')
    await expect(leftPanel.getByText('SDD Card A')).toBeVisible()
    await expect(leftPanel.getByText('SDD Card B')).toBeVisible()

    await cardTabs.getByRole('tab', { name: '文献' }).click()
    await expect(cardTabs.getByRole('tab', { name: '文献' })).toHaveAttribute('aria-selected', 'true')
    await expect(leftPanel.getByText('没有匹配的卡片')).toBeVisible()

    await page.getByTitle('路径与会话').click()
    await expect(contextTabs.getByRole('tab', { name: /任务/ })).toHaveAttribute('aria-selected', 'true')

    await page.getByTitle('卡片库').click()
    await expect(cardTabs.getByRole('tab', { name: '文献' })).toHaveAttribute('aria-selected', 'true')
  })

  test('visible controls are not covered by inactive app layers', async ({ page }) => {
    await enterAuthenticatedWorkspace(page)

    await expectVisibleControlsUncovered(page, 'dashboard')

    const modes = [
      { name: /WORKSPACE/, label: 'forge' },
      { name: /GRAPH/, label: 'galaxy' },
      { name: /INSIGHTS/, label: 'cognition' },
      { name: /PATH/, label: 'learn' },
      { name: /DASHBOARD/, label: 'dashboard-again' },
    ]

    for (const mode of modes) {
      await clickMode(page, mode.name)
      await page.waitForTimeout(500)
      await expectVisibleControlsUncovered(page, mode.label)
    }
  })

  test('keyboard shortcuts change mode but do not create domain objects', async ({ page }) => {
    const requests: string[] = []
    page.on('request', (request) => {
      if (request.method() !== 'GET') requests.push(`${request.method()} ${request.url()}`)
    })

    await enterAuthenticatedWorkspace(page)
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    })
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

async function enterAuthenticatedWorkspace(page: import('@playwright/test').Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: /进入应用|进入知识库/ }).click()
  if (await page.locator('.landing-vault-select').first().isVisible().catch(() => false)) {
    await page.locator('.landing-vault-select').first().click()
  }
  await page.waitForSelector('#mode-nav', { timeout: 15_000 })
}

async function clickMode(page: import('@playwright/test').Page, name: RegExp) {
  await page.getByRole('button', { name }).click({ timeout: 30_000 })
}

async function expectLeftPillHitTargets(page: import('@playwright/test').Page) {
  const hits = await page.locator('.forge-left-tabs button').evaluateAll((buttons) => {
    return buttons.map((button) => {
      const rect = button.getBoundingClientRect()
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
      return {
        text: button.textContent?.trim() || '',
        hitText: hit?.textContent?.trim() || '',
        hitTag: hit?.tagName || '',
        hitClass: typeof hit?.className === 'string' ? hit.className : '',
        buttonStage: button.closest('.mode-stage')?.className || '',
        hitStage: hit?.closest('.mode-stage')?.className || '',
        hitStagePointerEvents: hit?.closest('.mode-stage')
          ? window.getComputedStyle(hit.closest('.mode-stage') as Element).pointerEvents
          : '',
        hitStageVisibility: hit?.closest('.mode-stage')
          ? window.getComputedStyle(hit.closest('.mode-stage') as Element).visibility
          : '',
        hitPointerEvents: hit ? window.getComputedStyle(hit).pointerEvents : '',
        hitVisibility: hit ? window.getComputedStyle(hit).visibility : '',
        ok: hit === button || button.contains(hit),
      }
    })
  })
  expect(hits.filter((hit) => !hit.ok)).toEqual([])
}

async function expectVisibleControlsUncovered(page: import('@playwright/test').Page, label: string) {
  const failures = await page.evaluate(() => {
    const selector = [
      'button',
      'a[href]',
      'input',
      'textarea',
      'select',
      '[role="button"]',
      '[role="tab"]',
      '[role="switch"]',
      '[role="slider"]',
    ].join(',')

    const isTargetOrDescendant = (target: Element, hit: Element | null) => {
      if (!hit) return false
      if (target === hit || target.contains(hit)) return true
      const nearestControl = hit.closest(selector)
      return nearestControl === target
    }

    const isPainted = (target: HTMLElement) => {
      let current: HTMLElement | null = target
      while (current && current !== document.body) {
        const style = window.getComputedStyle(current)
        if (
          style.display === 'none'
          || style.visibility === 'hidden'
          || style.visibility === 'collapse'
          || Number(style.opacity) <= 0.05
        ) {
          return false
        }
        current = current.parentElement
      }
      return true
    }

    return Array.from(document.querySelectorAll<HTMLElement>(selector))
      .map((target) => {
        const style = window.getComputedStyle(target)
        const rect = target.getBoundingClientRect()
        const x = rect.left + rect.width / 2
        const y = rect.top + rect.height / 2
        const outsideViewport = x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight
        if (!isPainted(target) || outsideViewport || rect.width < 4 || rect.height < 4) return null

        const hit = document.elementFromPoint(x, y)
        if (isTargetOrDescendant(target, hit)) return null

        return {
          text: target.textContent?.trim().replace(/\s+/g, ' ').slice(0, 80) || '',
          ariaLabel: target.getAttribute('aria-label') || '',
          title: target.getAttribute('title') || '',
          targetTag: target.tagName,
          targetClass: typeof target.className === 'string' ? target.className : '',
          targetStage: target.closest('.mode-stage')?.className || '',
          hitText: hit?.textContent?.trim().replace(/\s+/g, ' ').slice(0, 80) || '',
          hitTag: hit?.tagName || '',
          hitClass: typeof hit?.className === 'string' ? hit.className : '',
          hitStage: hit?.closest('.mode-stage')?.className || '',
        }
      })
      .filter(Boolean)
  })

  expect(failures, `${label} has visible controls covered by another layer`).toEqual([])
}

async function mockAuthenticatedMvp(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem('axiom-vault-onboarding:vault-e2e', '1')
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
  await page.route('**/api/agent/sessions/list**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      success: true,
      sessions: [{
        id: 'talk-a',
        title: 'SDD Talk',
        preview: 'Continue the free conversation',
        updatedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        status: 'active',
        cardId: null,
        cardTitle: null,
        cardType: null,
        threadStatus: null,
        pathId: null,
        pathTitle: null,
        stepId: null,
        stepTitle: null,
        sessionKind: 'conversation',
      }],
    }),
  }))
  await page.route('**/api/agent/history**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ success: true, messages: [] }),
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
