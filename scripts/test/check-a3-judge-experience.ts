import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from '@playwright/test'

const baseUrl = process.env.A3_JUDGE_URL || 'http://127.0.0.1:3002'
const email = process.env.A3_JUDGE_EMAIL || 'demo@axiom.space'
const password = process.env.A3_JUDGE_PASSWORD || 'demo123456'

async function main() {
  await mkdir('test/artifacts/a3-judge-experience', { recursive: true })
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()

  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    const emailInput = page.getByLabel(/邮箱|email/i)
    if (!await emailInput.isVisible().catch(() => false)) {
      const loginButton = page.getByRole('button', { name: /登录|sign in|log in/i }).first()
      await loginButton.waitFor({ state: 'visible', timeout: 30_000 })
      // A cold Next.js page can paint the server-rendered landing buttons a
      // moment before React hydration attaches onClick. Retry the click until
      // the real modal appears so the check measures the product, not that race.
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await loginButton.click()
        if (await page.getByRole('dialog', { name: /登录|sign in|log in/i }).isVisible().catch(() => false)) break
        await page.waitForTimeout(750)
      }
    }
    await emailInput.waitFor({ state: 'visible', timeout: 30_000 })
    await emailInput.fill(email)
    await page.getByLabel(/密码|password/i).fill(password)
    await page.getByRole('button', { name: /登录|sign in|log in/i }).last().click()
    const enterVault = page.getByRole('button', { name: /进入知识库/ })
    await enterVault.waitFor({ state: 'visible', timeout: 30_000 })
    await enterVault.click()

    const matureVault = page.getByRole('button', { name: /设计模式黄金案例·长期档案/ }).first()
    await matureVault.waitFor({ state: 'visible', timeout: 30_000 }).catch(async (error) => {
      console.error((await page.locator('body').innerText()).slice(0, 4000))
      throw error
    })
    await matureVault.click()
    await page.getByTestId('mode-nav-forge').waitFor({ state: 'visible', timeout: 30_000 })
    await page.waitForTimeout(1800)

    assert.equal(
      await page.getByText('欢迎来到 AXIOM 认知操作系统', { exact: true }).isVisible().catch(() => false),
      false,
      '成熟档案不应在新浏览器中弹出首次画像引导',
    )

    await page.getByTestId('mode-nav-cognition').click()
    await page.getByText('怎样更容易理解', { exact: true }).first().waitFor({ state: 'visible', timeout: 30_000 })

    await page.getByTestId('mode-nav-forge').click()
    await page.getByTestId('forge-activity-cards').click()
    await page.getByTestId('forge-left-search-cards').fill('软件设计模式长期资源包')
    const resourcePack = page.getByRole('button', { name: /打开卡片 软件设计模式长期资源包/ })
    await resourcePack.waitFor({ state: 'visible', timeout: 30_000 }).catch(async (error) => {
      console.error((await page.locator('body').innerText()).slice(-4000))
      throw error
    })
    await resourcePack.click()
    await page.getByText('期末答辩 3 分钟动画脚本', { exact: true }).waitFor({ state: 'visible', timeout: 30_000 })

    const fullscreen = page.getByTestId('forge-preview-fullscreen')
    await fullscreen.waitFor({ state: 'visible', timeout: 30_000 })
    await fullscreen.click()
    const preview = page.locator('.forge-ide.preview-fullscreen .forge-ide-editor')
    await preview.waitFor({ state: 'visible', timeout: 10_000 })
    const box = await preview.boundingBox()
    assert(box && box.width >= 1320 && box.height >= 790, `全屏预览尺寸不足：${JSON.stringify(box)}`)

    await page.screenshot({
      path: 'test/artifacts/a3-judge-experience/mature-resource-fullscreen.png',
      fullPage: true,
    })
    console.log(JSON.stringify({
      matureOnboardingSuppressed: true,
      cognitionProfileVisible: true,
      resourcePreviewFullscreen: box,
    }, null, 2))
  } finally {
    await context.close()
    await browser.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
