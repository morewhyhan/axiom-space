import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium, type Locator, type Page } from '@playwright/test'

const baseUrl = process.env.A3_VISUAL_URL || 'http://127.0.0.1:3002'
const outputDir = path.resolve('test/artifacts/resource-visual-check')

async function visible(locator: Locator) {
  return locator.isVisible().catch(() => false)
}

async function login(page: Page) {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 180_000 })
  await page.getByText('正在恢复会话...').waitFor({ state: 'hidden', timeout: 60_000 }).catch(() => {})
  const email = page.getByLabel(/邮箱|email/i)
  if (!await visible(email)) {
    const loginButton = page.getByRole('button', { name: /登录|sign in|log in/i }).first()
    if (await visible(loginButton)) {
      await loginButton.click()
      await email.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {})
    }
  }
  if (await visible(email)) {
    await email.fill('demo@axiom.space')
    await page.getByLabel(/密码|password/i).fill('demo123456')
    await page.getByRole('button', { name: /登录|sign in|log in/i }).last().click()
    await page.waitForTimeout(2500)
  }
  const enter = page.getByRole('button', { name: /进入知识库/ })
  if (await visible(enter)) await enter.click()
}

async function main() {
  await mkdir(outputDir, { recursive: true })
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 })
  const page = await context.newPage()
  const consoleErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  await login(page)

  const mature = page.getByRole('button', { name: /设计模式黄金案例·长期档案/ }).first()
  await mature.waitFor({ state: 'visible', timeout: 60_000 }).catch(async (error) => {
    await page.screenshot({ path: path.join(outputDir, 'failure-before-vault.png'), fullPage: true })
    console.error((await page.locator('body').innerText().catch(() => '')).slice(0, 5000))
    throw error
  })
  await mature.click()
  await page.waitForTimeout(3000)
  await page.keyboard.press('Escape')
  await page.getByTestId('mode-nav-galaxy').click()
  await page.waitForTimeout(5000)

  const pack = page.getByText('Visitor 双重分派个性化资源包', { exact: true }).first()
  await pack.waitFor({ state: 'visible', timeout: 60_000 })
  await pack.click()
  await page.waitForTimeout(4500)

  const expected = ['因果链讲解文档', '机制思维导图', '诊断与迁移题库', 'Java 可运行实操', '双重分派时序图', '90 秒交互教学动画']
  const results: Array<Record<string, unknown>> = []
  for (const [index, title] of expected.entries()) {
    const button = page.getByRole('button', { name: new RegExp(title) }).first()
    assert(await visible(button), `${title} resource selector is not visible`)
    await button.click()
    await page.waitForTimeout(title.includes('导图') || title.includes('时序图') ? 3500 : 1500)
    const pane = page.locator('.resource-preview-pane').first()
    assert(await visible(pane), `${title} preview pane is not visible`)
    const box = await pane.boundingBox()
    assert(box && box.width > 300 && box.height > 180, `${title} preview pane has invalid dimensions`)
    const text = (await pane.innerText().catch(() => '')).trim()
    const svgCount = await pane.locator('svg').count()
    const iframeCount = await pane.locator('iframe').count()
    const questionCount = title.includes('题库') ? await pane.locator('text=/答案：/').count() : 0
    assert(text.length > 40 || svgCount > 0 || iframeCount > 0, `${title} preview is visually empty`)
    if (title.includes('导图') || title.includes('时序图')) assert(svgCount > 0, `${title} Mermaid did not render to SVG`)
    if (title.includes('题库')) assert(questionCount >= 3, `${title} did not render at least three questions`)
    if (title.includes('动画')) assert(iframeCount > 0, `${title} animation iframe is missing`)
    const screenshot = path.join(outputDir, `${String(index + 1).padStart(2, '0')}-${title}.png`)
    await pane.screenshot({ path: screenshot })
    results.push({ title, textLength: text.length, svgCount, iframeCount, questionCount, width: box.width, height: box.height, screenshot })
  }

  await page.screenshot({ path: path.join(outputDir, 'resource-panel-full.png'), fullPage: true })
  await writeFile(path.join(outputDir, 'summary.json'), JSON.stringify({ baseUrl, results, consoleErrors }, null, 2))
  await browser.close()
  console.log(JSON.stringify({ results, consoleErrors }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
