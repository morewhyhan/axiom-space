import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium, type Locator, type Page } from '@playwright/test'

const baseUrl = process.env.A3_VISUAL_URL || 'http://127.0.0.1:3002'
const vaultName = process.env.A3_PUSH_VAULT || 'CS408 Knowledge Graph'
const outputDir = path.resolve('test/artifacts/resource-push-box-check')

async function visible(locator: Locator) {
  return locator.isVisible().catch(() => false)
}

async function login(page: Page) {
  console.log('[push-box-check] opening app')
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 180_000 })
  await page.getByText('正在恢复会话...').waitFor({ state: 'hidden', timeout: 90_000 }).catch(() => {})
  const email = page.getByLabel(/邮箱|email/i)
  if (!await visible(email)) {
    const loginButton = page.getByRole('button', { name: /^登录$/ }).first()
    if (await visible(loginButton)) await loginButton.click()
  }
  if (await visible(email)) {
    console.log('[push-box-check] signing in')
    await email.fill('demo@axiom.space')
    await page.getByLabel(/密码|password/i).fill('demo123456')
    await page.getByRole('button', { name: /^登录$/ }).last().click()
    await page.waitForTimeout(2500)
  }
  const enter = page.getByRole('button', { name: /进入知识库/ }).first()
  if (await visible(enter)) {
    console.log('[push-box-check] entering vault')
    await enter.click()
  }
}

async function main() {
  await mkdir(outputDir, { recursive: true })
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const consoleErrors: string[] = []
  const failedRequests: string[] = []
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  page.on('requestfailed', (request) => failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText || ''}`))
  await login(page)
  console.log('[push-box-check] login flow finished', page.url())
  await page.waitForTimeout(2000)
  console.log((await page.locator('body').innerText().catch(() => '')).slice(0, 3000))
  await page.screenshot({ path: path.join(outputDir, '00-after-login.png'), fullPage: true })
  const vault = page.getByRole('button').filter({ hasText: vaultName }).first()
  await vault.waitFor({ state: 'visible', timeout: 90_000 }).catch(() => {})
  if (await visible(vault)) {
    console.log(`[push-box-check] selecting ${vaultName} vault`)
    await vault.click()
    await page.waitForTimeout(2500)
    console.log('[push-box-check] after vault selection')
    console.log((await page.locator('body').innerText().catch(() => '')).slice(0, 3000))
    await page.screenshot({ path: path.join(outputDir, '00-vault-selected.png'), fullPage: true })
    const skipOnboarding = page.getByRole('button', { name: /直接开始使用/ }).first()
    if (await visible(skipOnboarding)) await skipOnboarding.click()
  }

  const vaultChoice = page.getByRole('button', { name: /进入知识库/ }).first()
  if (await visible(vaultChoice)) await vaultChoice.click()
  const learnMode = page.locator('.mode-btn.learn-mode').first()
  await learnMode.waitFor({ state: 'visible', timeout: 120_000 })
  console.log('[push-box-check] opening learn mode')
  await learnMode.click()
  await page.waitForTimeout(3000)
  await page.screenshot({ path: path.join(outputDir, '01-learn.png'), fullPage: true })

  console.log('[push-box-check] checking two push boxes')
  await page.locator('.learn-path-group-label').filter({ hasText: '资源推送' }).last().waitFor({ state: 'visible', timeout: 60_000 })
  await page.locator('.learn-path-group-label').filter({ hasText: '关联推送' }).last().waitFor({ state: 'visible', timeout: 60_000 })
  const pushCapsules = page.locator('.learn-push-capsule')
  const cardCount = await pushCapsules.count()
  const pathCapsuleClassReused = cardCount === 0 || await pushCapsules.first().evaluate((element) => element.classList.contains('learn-path-capsule'))
  assert(pathCapsuleClassReused, 'push entries do not reuse the learning-path capsule style')
  await page.screenshot({ path: path.join(outputDir, '02-two-push-boxes.png'), fullPage: true })

  if (cardCount > 0) {
    await pushCapsules.first().click()
    await page.locator('.learn-push-detail').waitFor({ state: 'visible', timeout: 20_000 })
    await page.screenshot({ path: path.join(outputDir, '03-push-detail.png'), fullPage: true })
  }

  const summary = { cardCount, pathCapsuleClassReused, consoleErrors, failedRequests, url: page.url() }
  await writeFile(path.join(outputDir, 'summary.json'), JSON.stringify(summary, null, 2))
  console.log(JSON.stringify(summary, null, 2))
  await browser.close()
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
