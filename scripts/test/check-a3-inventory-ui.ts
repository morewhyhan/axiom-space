import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium, type Locator, type Page } from '@playwright/test'

const baseUrl = process.env.A3_INVENTORY_UI_URL || 'http://127.0.0.1:3000'
const email = process.env.A3_INVENTORY_UI_EMAIL || 'demo@axiom.space'
const password = process.env.A3_INVENTORY_UI_PASSWORD || 'demo123456'
const vaultName = process.env.A3_INVENTORY_UI_VAULT || 'Java Web 并发控制黄金案例'
const outputDir = path.resolve('test/artifacts/a3-inventory-ui')

type CheckResult = {
  name: string
  status: 'passed' | 'failed'
  durationMs: number
  details?: unknown
  error?: string
}

type PreviewResult = {
  title: string
  textLength: number
  iframeCount: number
  svgCount: number
  questionAnswerCount: number
  width: number
  height: number
}

const checks: CheckResult[] = []
const screenshots: string[] = []
const consoleErrors: string[] = []
const failedRequests: string[] = []
const serverErrors: string[] = []
const resourceProgressResponses: Array<{ url: string; status: number; body: string }> = []
const startedAt = Date.now()

async function visible(locator: Locator) {
  return locator.isVisible().catch(() => false)
}

async function waitUntil(
  condition: () => Promise<boolean>,
  message: string,
  timeoutMs = 30_000,
  intervalMs = 250,
) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await condition()) return
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  throw new Error(message)
}

async function runCheck<T>(name: string, operation: () => Promise<T>): Promise<T> {
  const started = Date.now()
  try {
    const details = await operation()
    checks.push({ name, status: 'passed', durationMs: Date.now() - started, details })
    console.log(`[a3-inventory-ui] PASS ${name}`)
    return details
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    checks.push({ name, status: 'failed', durationMs: Date.now() - started, error: message })
    console.error(`[a3-inventory-ui] FAIL ${name}: ${message}`)
    throw error
  }
}

async function screenshot(page: Page, fileName: string, target?: Locator) {
  const filePath = path.join(outputDir, fileName)
  if (target) await target.screenshot({ path: filePath })
  else await page.screenshot({ path: filePath, fullPage: true })
  screenshots.push(path.relative(process.cwd(), filePath))
}

async function loginAndOpenVault(page: Page) {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 180_000 })
  await page.getByText('正在恢复会话...').waitFor({ state: 'hidden', timeout: 90_000 }).catch(() => {})

  const emailInput = page.getByLabel(/邮箱|email/i)
  if (!await visible(emailInput)) {
    const loginButton = page.getByRole('button', { name: /登录|sign in|log in/i }).first()
    await loginButton.waitFor({ state: 'visible', timeout: 45_000 })
    for (let attempt = 0; attempt < 4 && !await visible(emailInput); attempt += 1) {
      await loginButton.click()
      await page.waitForTimeout(700)
    }
  }

  if (await visible(emailInput)) {
    await emailInput.fill(email)
    await page.getByLabel(/密码|password/i).fill(password)
    await page.getByRole('button', { name: /登录|sign in|log in/i }).last().click()
  }

  const enterVault = page.getByRole('button', { name: /进入知识库/ }).first()
  await enterVault.waitFor({ state: 'visible', timeout: 45_000 })
  await enterVault.click()

  const vault = page.getByRole('button').filter({ hasText: vaultName }).first()
  await vault.waitFor({ state: 'visible', timeout: 60_000 })
  await vault.click()
  const forgeMode = page.getByTestId('mode-nav-forge')
  await forgeMode.waitFor({ state: 'visible', timeout: 60_000 })
  await page.waitForTimeout(1800)
  await page.keyboard.press('Escape')
  await forgeMode.click()
  await page.getByTestId('forge-activity-context').waitFor({ state: 'visible', timeout: 60_000 })
  const chatToggle = page.getByTestId('forge-activity-chat')
  if (await chatToggle.getAttribute('aria-pressed') !== 'true') await chatToggle.click()
  await page.locator('.forge-console-panel').waitFor({ state: 'visible', timeout: 60_000 })
  await page.waitForTimeout(1200)

  assert.equal(
    await page.getByText('欢迎来到 AXIOM 认知操作系统', { exact: true }).isVisible().catch(() => false),
    false,
    '长期黄金案例不应再次弹出首次画像引导',
  )
  const selectedVault = await page.getByTestId('vault-selector').innerText()
  assert.match(selectedVault, /Java Web 并发控制黄金案例/)
  return { selectedVault: selectedVault.trim(), url: page.url() }
}

async function ensureForgeResourcePanel(page: Page, view: 'context' | 'cards') {
  const panel = page.getByTestId(`forge-resource-panel-${view}`)
  if (!await visible(panel)) {
    await page.getByTestId(`forge-activity-${view}`).click()
  }
  await panel.waitFor({ state: 'visible', timeout: 30_000 })
  return panel
}

async function openTalk(page: Page, title: string) {
  await ensureForgeResourcePanel(page, 'context')
  await page.getByTestId('forge-left-tab-talks').click()
  const search = page.getByTestId('forge-left-search-context')
  await search.fill(title)
  const talk = page.getByRole('button', { name: `打开对话 ${title}` }).first()
  await talk.waitFor({ state: 'visible', timeout: 30_000 })
  await talk.click()
}

async function openCard(page: Page, title: string) {
  await ensureForgeResourcePanel(page, 'cards')
  const search = page.getByTestId('forge-left-search-cards')
  await search.fill(title)
  const card = page.getByRole('button', { name: `打开卡片 ${title}` }).first()
  await card.waitFor({ state: 'visible', timeout: 45_000 })
  await card.click()
  await page.locator('.forge-paper-header').getByText(title, { exact: true }).waitFor({ state: 'visible', timeout: 45_000 })
}

async function inspectProgress(page: Page, expectedTypes: string[]) {
  const panel = page.getByTestId('resource-progress-panel').last()
  await panel.waitFor({ state: 'visible', timeout: 30_000 })
  await waitUntil(
    async () => Number(await panel.getAttribute('data-progress')) === 100,
    '资源生成总进度没有恢复到 100%',
  )

  const items = panel.getByTestId('resource-progress-item')
  await waitUntil(
    async () => await items.count() === expectedTypes.length,
    `资源进度项数量应为 ${expectedTypes.length}`,
  )
  const types = (await items.evaluateAll((elements) => elements.map((element) => element.getAttribute('data-resource-type') || ''))).sort()
  const statuses = await items.evaluateAll((elements) => elements.map((element) => element.getAttribute('data-resource-status') || ''))
  assert.deepEqual(types, [...expectedTypes].sort(), '当前会话恢复了不属于该请求的资源类型')
  assert(statuses.every((status) => status === 'completed' || status === 'ready'), `存在未完成的资源项：${statuses.join(', ')}`)
  return { progress: Number(await panel.getAttribute('data-progress')), types, statuses, itemCount: await items.count() }
}

async function inspectResourcePreview(page: Page, title: string): Promise<PreviewResult> {
  const selector = page.getByRole('button').filter({ hasText: title }).first()
  await selector.waitFor({ state: 'visible', timeout: 45_000 })
  await selector.click()
  const pane = page.locator('.resource-preview-pane').first()
  await pane.waitFor({ state: 'visible', timeout: 30_000 })
  if (title.includes('思维导图')) {
    await pane.locator('svg').first().waitFor({ state: 'visible', timeout: 30_000 })
  }
  const box = await pane.boundingBox()
  assert(box && box.width > 300 && box.height > 180, `${title} 的预览区域尺寸无效：${JSON.stringify(box)}`)
  const text = (await pane.innerText().catch(() => '')).trim()
  const iframeCount = await pane.locator('iframe').count()
  const svgCount = await pane.locator('svg').count()
  const questionAnswerCount = await pane.getByText(/答案：/).count()
  assert(text.length > 40 || iframeCount > 0 || svgCount > 0, `${title} 的预览内容为空`)
  if (title.includes('思维导图')) assert(svgCount > 0, '思维导图没有渲染成 SVG')
  if (title.includes('诊断与迁移题')) assert(questionAnswerCount >= 3, '题目资源没有渲染至少三道带答案的题')
  if (title.includes('交错证据图') || title.includes('教学动画')) assert(iframeCount > 0, `${title} 缺少 iframe 预览`)
  return {
    title,
    textLength: text.length,
    iframeCount,
    svgCount,
    questionAnswerCount,
    width: Math.round(box.width),
    height: Math.round(box.height),
  }
}

async function main() {
  await mkdir(outputDir, { recursive: true })
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
    locale: 'zh-CN',
  })
  const page = await context.newPage()
  page.setDefaultTimeout(30_000)
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('requestfailed', (request) => {
    failedRequests.push(`${request.method()} ${request.url()} — ${request.failure()?.errorText || 'unknown'}`)
  })
  page.on('response', (response) => {
    if (response.status() >= 500) serverErrors.push(`${response.status()} ${response.request().method()} ${response.url()}`)
    if (response.url().includes('/api/events/resource-progress')) {
      void response.text()
        .then((body) => resourceProgressResponses.push({ url: response.url(), status: response.status(), body: body.slice(0, 5000) }))
        .catch(() => {})
    }
  })

  let fatalError: unknown = null
  try {
    await runCheck('登录并进入库存黄金案例', () => loginAndOpenVault(page))

    await runCheck('普通对话保持未绑定状态', async () => {
      let activeConversation = '从标准答案到下一步计划'
      await openTalk(page, activeConversation).catch(async () => {
        // Compatibility for an already-running browser check while the
        // upgraded golden seed is being re-imported.
        activeConversation = '课程进度与下一步'
        await openTalk(page, activeConversation)
      })
      await page.getByText('我想先知道这门课还剩什么，这次不要绑定具体卡片。', { exact: true }).waitFor({ state: 'visible', timeout: 30_000 })
      const freeChatInput = page.locator('textarea[placeholder*="继续自由对话"]')
      await freeChatInput.waitFor({ state: 'visible', timeout: 30_000 })
      assert.equal(await freeChatInput.isEnabled(), true, '普通对话输入框应当可继续输入')
      await page.locator('.forge-paper-header').getByText('未选择卡片', { exact: true }).waitFor({ state: 'visible', timeout: 30_000 })
      assert.equal(await page.locator('.forge-focus-card').getByText('PERM', { exact: true }).count(), 0, '普通会话不应伪装成卡片线程')
      return {
        activeConversation,
        cardBound: false,
        inputEnabled: true,
        focusLabel: (await page.locator('.forge-focus-card').innerText()).trim(),
      }
    })
    await screenshot(page, '01-forge-ordinary-conversation.png')

    const singleProgress = await runCheck('单视频会话只恢复一个 100% 视频任务', async () => {
      await openTalk(page, '库存交错教学动画')
      await page.getByText('本次没有生成题库、导图或额外 Markdown 卡片。', { exact: false }).waitFor({ state: 'visible', timeout: 30_000 })
      return inspectProgress(page, ['video'])
    })
    await screenshot(page, '02-single-video-session-progress.png')

    const packProgress = await runCheck('全部生成会话恢复六类独立资源任务', async () => {
      await openTalk(page, '并发库存六类资源包')
      await page.getByText('六类资源已全部完成', { exact: false }).waitFor({ state: 'visible', timeout: 30_000 })
      return inspectProgress(page, ['document', 'mindmap', 'quiz', 'code', 'svg', 'video'])
    })
    await screenshot(page, '03-six-resource-session-progress.png')

    await runCheck('永久卡片同步刷新右侧正文和专属对话', async () => {
      await openCard(page, '共享旧状态导致超卖')
      await page.getByText('第一次独立审核没有通过', { exact: false }).waitFor({ state: 'visible', timeout: 30_000 })
      await page.locator('.forge-paper-read').getByText('小林的原话', { exact: true }).waitFor({ state: 'visible', timeout: 30_000 })
      assert.equal(
        await page.getByText('我想先知道这门课还剩什么，这次不要绑定具体卡片。', { exact: true }).count(),
        0,
        '打开卡片后，中间面板仍残留普通对话',
      )
      return { card: '共享旧状态导致超卖', threadEvidence: '第一次独立审核没有通过', previewEvidence: '小林的原话' }
    })
    await screenshot(page, '04-card-bound-thread-and-preview.png')

    await runCheck('单视频文献节点可预览并真正铺满全屏', async () => {
      await openCard(page, '库存超卖交互动画')
      const iframe = page.locator('.forge-paper-panel iframe[title="库存超卖交互动画"]').first()
      await iframe.waitFor({ state: 'visible', timeout: 45_000 })
      const before = await iframe.boundingBox()
      assert(before && before.width > 300 && before.height >= 250, `单视频预览尺寸无效：${JSON.stringify(before)}`)

      await page.getByTestId('forge-preview-fullscreen').click()
      const fullscreen = page.locator('.forge-ide.preview-fullscreen .forge-paper-panel')
      await fullscreen.waitFor({ state: 'visible', timeout: 15_000 })
      const fullscreenBox = await fullscreen.boundingBox()
      const expandedIframe = await iframe.boundingBox()
      assert(fullscreenBox && fullscreenBox.width >= 1380 && fullscreenBox.height >= 950, `右侧面板没有占满视口：${JSON.stringify(fullscreenBox)}`)
      assert(expandedIframe && expandedIframe.width >= 1200 && expandedIframe.height >= 650, `全屏后内部动画没有同步放大：${JSON.stringify(expandedIframe)}`)
      await screenshot(page, '05-single-video-fullscreen.png')
      await page.getByTestId('forge-preview-fullscreen').click()
      return { before, fullscreen: fullscreenBox, contentFullscreen: expandedIframe }
    })

    const previewResults = await runCheck('六类资源包均可在右侧独立渲染', async () => {
      await openCard(page, '并发库存个性化资源包')
      const expected = [
        '并发超卖因果链讲解',
        '并发超卖思维导图',
        '并发诊断与迁移题',
        '原子扣减可运行实验',
        '双请求交错证据图',
        '库存超卖交互教学动画',
      ]
      const results: PreviewResult[] = []
      for (const title of expected) results.push(await inspectResourcePreview(page, title))
      return results
    })
    await screenshot(page, '06-six-resource-pack-preview.png')

    await runCheck('认知洞察显示六维画像和长期更新时间线', async () => {
      await page.getByTestId('mode-nav-cognition').click()
      const dimensions = ['learningGoal', 'currentFoundation', 'bestExplanationPath', 'stuckPattern', 'paceAndLoad', 'masteryCheck']
      for (const dimension of dimensions) {
        await page.getByTestId(`profile-pill-${dimension}`).waitFor({ state: 'visible', timeout: 45_000 })
      }
      const archive = page.getByTestId('profile-history-archive')
      await archive.waitFor({ state: 'visible', timeout: 45_000 })
      const toggle = page.getByTestId('profile-history-toggle')
      await toggle.waitFor({ state: 'visible', timeout: 30_000 })
      await toggle.click()
      const historyTimeline = page.getByTestId('profile-history-timeline')
      await historyTimeline.waitFor({ state: 'visible', timeout: 30_000 })
      const profileSnapshots = historyTimeline.getByTestId('profile-history-snapshot')
      await waitUntil(async () => await profileSnapshots.count() >= 2, '画像历史没有同时呈现初始版本与当前版本')

      const evidenceTimeline = page.getByTestId('cognition-evidence-timeline')
      await evidenceTimeline.waitFor({ state: 'visible', timeout: 30_000 })
      await evidenceTimeline.getByText('独立测评 2', { exact: true }).waitFor({ state: 'visible', timeout: 15_000 })
      assert.match(await evidenceTimeline.innerText(), /画像假设 [1-9]\d*/)
      assert.match(await evidenceTimeline.innerText(), /教学干预 [1-9]\d*/)
      const evidenceToggle = page.getByTestId('cognition-evidence-toggle')
      if (await visible(evidenceToggle)) await evidenceToggle.click()
      const evidenceList = page.getByTestId('cognition-evidence-list')
      await evidenceList.waitFor({ state: 'visible', timeout: 15_000 })
      const assessmentEntries = await evidenceList.locator('[data-testid^="cognition-evidence-assessment-"]').count()
      const hypothesisEntries = await evidenceList.locator('[data-testid^="cognition-evidence-hypothesis-"]').count()
      const interventionEntries = await evidenceList.locator('[data-testid^="cognition-evidence-intervention-"]').count()
      assert.equal(assessmentEntries, 2, '认知证据闭环应显示两次独立测评')
      assert(hypothesisEntries >= 1, '认知证据闭环缺少画像假设')
      assert(interventionEntries >= 1, '认知证据闭环缺少教学干预')
      return {
        dimensions,
        historyVisible: true,
        timelineVisible: true,
        profileSnapshotCount: await profileSnapshots.count(),
        evidenceLoop: { assessmentEntries, hypothesisEntries, interventionEntries },
      }
    })
    await screenshot(page, '07-cognition-six-dimensions-history.png')

    await runCheck('画像证据可回跳到产生判断的原始对话', async () => {
      await page.getByTestId('profile-pill-currentFoundation').click()
      const evidenceButton = page.getByTestId('profile-node-evidence-open').first()
      await evidenceButton.waitFor({ state: 'visible', timeout: 30_000 })
      await evidenceButton.click()
      const trace = page.getByTestId('profile-evidence-trace')
      await trace.waitFor({ state: 'visible', timeout: 20_000 })
      const sourceLink = trace.locator('[data-testid^="profile-evidence-source-link-learningMessage-"]').first()
      await sourceLink.waitFor({ state: 'visible', timeout: 20_000 })
      await sourceLink.click()
      await page.getByText('我预测 A 看到 1，B 看到 0。', { exact: false }).waitFor({ state: 'visible', timeout: 45_000 })
      await page.getByTestId('mode-nav-forge').waitFor({ state: 'visible', timeout: 15_000 })
      return { sourceType: 'learningMessage', destination: '库存超卖预测诊断' }
    })
    await screenshot(page, '08-profile-evidence-backlink.png')

    await runCheck('学习路径、个性化依据与两类推送真实可见', async () => {
      await page.getByTestId('mode-nav-learn').click()
      await page.getByText('并发库存个性化学习路径', { exact: true }).first().waitFor({ state: 'visible', timeout: 45_000 })
      await page.getByText('3/5 steps', { exact: true }).waitFor({ state: 'visible', timeout: 30_000 })
      await page.getByText('60%', { exact: true }).first().waitFor({ state: 'visible', timeout: 30_000 })

      const evidenceToggle = page.getByTestId('path-personalization-evidence-toggle')
      await evidenceToggle.waitFor({ state: 'visible', timeout: 45_000 })
      await evidenceToggle.click()
      const evidence = page.getByTestId('path-personalization-evidence')
      await evidence.waitFor({ state: 'visible', timeout: 30_000 })
      await evidence.getByText('通用默认方案', { exact: true }).waitFor({ state: 'visible', timeout: 15_000 })
      await evidence.getByText('本次个性化方案', { exact: true }).waitFor({ state: 'visible', timeout: 15_000 })

      const resourceGroup = page.getByTestId('push-box-resource')
      const linkGroup = page.getByTestId('push-box-link')
      await resourceGroup.waitFor({ state: 'visible', timeout: 30_000 })
      await linkGroup.waitFor({ state: 'visible', timeout: 30_000 })
      const resourceSuggestions = await resourceGroup.locator('.learn-push-capsule').count()
      const linkSuggestions = await linkGroup.locator('.learn-push-capsule').count()
      assert(resourceSuggestions >= 1, '资源推送箱没有待确认建议')
      assert(linkSuggestions >= 1, '关联推送箱没有待确认建议')
      const linkHistory = page.getByTestId('push-history-link')
      await linkHistory.waitFor({ state: 'visible', timeout: 30_000 })
      await linkHistory.locator('summary').click()
      const executedHistory = linkHistory.getByText('已执行', { exact: true }).first()
      await executedHistory.waitFor({ state: 'visible', timeout: 15_000 })
      await linkHistory.locator('.learn-push-capsule').first().click()
      await page.getByTestId('push-suggestion-terminal-status').getByText('已由用户确认并真实执行', { exact: true }).waitFor({ state: 'visible', timeout: 15_000 })
      return {
        path: '并发库存个性化学习路径',
        progress: 60,
        resourceSuggestions,
        linkSuggestions,
        personalizationEvidence: true,
        executedHistoryVisible: true,
      }
    })
    await screenshot(page, '09-learning-path-and-push-boxes.png')

    assert.equal(serverErrors.length, 0, `浏览器流程出现服务端 5xx：${serverErrors.join(' | ')}`)

    const result = {
      success: true,
      baseUrl,
      vaultName,
      durationMs: Date.now() - startedAt,
      checks,
      evidence: { singleProgress, packProgress, previewResults },
      screenshots,
      diagnostics: { consoleErrors, failedRequests, serverErrors, resourceProgressResponses },
    }
    await writeFile(path.join(outputDir, 'summary.json'), JSON.stringify(result, null, 2))
    console.log(JSON.stringify(result, null, 2))
  } catch (error) {
    fatalError = error
    await screenshot(page, 'failure.png').catch(() => {})
    const result = {
      success: false,
      baseUrl,
      vaultName,
      durationMs: Date.now() - startedAt,
      checks,
      screenshots,
      diagnostics: { consoleErrors, failedRequests, serverErrors, resourceProgressResponses },
      error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error),
      page: { url: page.url(), body: (await page.locator('body').innerText().catch(() => '')).slice(0, 12_000) },
    }
    await writeFile(path.join(outputDir, 'summary.json'), JSON.stringify(result, null, 2))
    console.error(JSON.stringify(result, null, 2))
  } finally {
    await context.close()
    await browser.close()
  }

  if (fatalError) throw fatalError
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
