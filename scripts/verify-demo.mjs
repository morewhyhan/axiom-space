import { chromium } from '../node_modules/.pnpm/playwright@1.60.0/node_modules/playwright/index.mjs'
import fs from 'node:fs/promises'
import path from 'node:path'

const outDir = path.resolve('artifacts/demo-verify')
await fs.mkdir(outDir, { recursive: true })

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1600 } })

async function shot(name) {
  const file = path.join(outDir, name)
  await page.screenshot({ path: file, fullPage: true })
  console.log(`saved ${file}`)
}

async function logVisible(label) {
  const text = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '')
  console.log(`\n=== ${label} ===`)
  console.log(text.slice(0, 2000))
}

await page.goto('http://localhost:3000', { waitUntil: 'commit', timeout: 60000 })
await page.waitForTimeout(5000)
await shot('01-home.png')
await logVisible('home')

const signInButton = page.getByRole('button', { name: /sign in|login|log in|登录|登入/i }).first()
if (await signInButton.isVisible().catch(() => false)) {
  await signInButton.click()
} else {
  const maybeLink = page.getByText(/sign in|login|log in|登录|登入/i).first()
  if (await maybeLink.isVisible().catch(() => false)) await maybeLink.click()
}

await page.getByLabel(/邮箱|email/i).fill('demo@axiom.space')
await page.getByLabel(/密码|password/i).fill('demo123456')
await shot('02-login-filled.png')

const submit = page.getByRole('button', { name: /sign in|log in|登录/i }).last()
await submit.click()

await page.waitForTimeout(3000)
await page.waitForTimeout(1500)
await shot('03-post-login.png')
await logVisible('post-login')

const vaultTile = page.getByText('Demo Vault').first()
if (await vaultTile.isVisible().catch(() => false)) {
  await vaultTile.click()
}
await page.waitForTimeout(1500)
await shot('04-vault-entered.png')
await logVisible('vault-entered')

const modeButtons = ['Dashboard', 'Forge', 'Galaxy', 'Cognition', 'Learn']
for (const mode of modeButtons) {
  const btn = page.getByRole('button', { name: new RegExp(mode, 'i') }).first()
  if (await btn.isVisible().catch(() => false)) {
    await btn.click()
    await page.waitForTimeout(1200)
    await shot(`${mode.toLowerCase()}.png`)
    await logVisible(mode)
  }
}

const learnInsights = page.getByRole('link', { name: /learn insights|insights/i }).first()
if (await learnInsights.isVisible().catch(() => false)) {
  await learnInsights.click()
  await page.waitForTimeout(3000)
  await page.waitForTimeout(1200)
  await shot('learn-insights.png')
  await logVisible('learn-insights')
}

await browser.close()
