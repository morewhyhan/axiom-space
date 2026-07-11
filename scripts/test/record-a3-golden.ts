import assert from 'node:assert/strict'
import { mkdir, rename } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { chromium, type Page } from '@playwright/test'

const BASE_URL = process.env.A3_RECORD_URL || 'http://localhost:3000'
const EMAIL = process.env.A3_RECORD_EMAIL || 'golden.rehearsal.20260711@axiom.local'
const PASSWORD = process.env.A3_RECORD_PASSWORD || 'AxiomGolden2026'
const outputDir = path.resolve('test/artifacts/a3-golden-recording')
const webmPath = path.join(outputDir, 'a3-golden-walkthrough.webm')
const mp4Path = path.join(outputDir, 'a3-golden-walkthrough.mp4')

async function pause(page: Page, milliseconds = 2200) {
  await page.waitForTimeout(milliseconds)
}

async function clickIfVisible(page: Page, name: string | RegExp) {
  const button = page.getByRole('button', { name }).first()
  if (await button.isVisible().catch(() => false)) {
    await button.click()
    await pause(page)
    return true
  }
  return false
}

async function requireText(page: Page, value: string | RegExp, label: string) {
  const visible = await page.getByText(value).first().isVisible().catch(() => false)
  if (!visible) {
    console.log((await page.locator('body').innerText().catch(() => '')).slice(0, 2400))
  }
  assert(visible, `${label} is not visible in the recording viewport`)
}

async function switchMode(page: Page, mode: 'dashboard' | 'galaxy' | 'cognition' | 'learn') {
  await page.getByTestId(`mode-nav-${mode}`).click()
  await pause(page, 2800)
}

async function selectVaultFromHeader(page: Page, name: RegExp, label: string) {
  await page.getByTestId('vault-selector').click()
  await pause(page)
  const option = page.getByRole('option', { name }).first()
  if (!await option.isVisible().catch(() => false)) {
    console.log((await page.locator('body').innerText().catch(() => '')).slice(-2400))
  }
  assert(await option.isVisible().catch(() => false), `${label} vault is not selectable`)
  await option.click()
  await pause(page, 4500)
  await page.keyboard.press('Escape')
  await pause(page, 1200)
}

async function convertToMp4(input: string, output: string) {
  await new Promise<void>((resolve, reject) => {
    const process = spawn('ffmpeg', ['-y', '-i', input, '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output], { stdio: 'inherit' })
    process.once('error', reject)
    process.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}`)))
  })
}

async function main() {
  await mkdir(outputDir, { recursive: true })
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, recordVideo: { dir: outputDir, size: { width: 1440, height: 900 } } })
  const page = await context.newPage()
  const video = page.video()

  await page.goto(BASE_URL, { waitUntil: 'commit', timeout: 300_000 })
  await page.waitForLoadState('domcontentloaded', { timeout: 300_000 }).catch(() => {})
  await pause(page, 5000)
  const emailInput = page.getByLabel(/邮箱|email/i)
  if (!await emailInput.isVisible().catch(() => false)) {
    await clickIfVisible(page, /登录|sign in|log in/i)
  }
  if (await emailInput.isVisible().catch(() => false)) {
    await emailInput.fill(EMAIL)
    await page.getByLabel(/密码|password/i).fill(PASSWORD)
    await page.getByRole('button', { name: /登录|sign in|log in/i }).last().click()
    await pause(page, 4000)
  }

  await clickIfVisible(page, /进入知识库/)
  const cleanVault = page.getByRole('button', { name: /小林·Visitor\s*黄金案例/ }).first()
  if (!await cleanVault.isVisible().catch(() => false)) {
    console.log((await page.locator('body').innerText().catch(() => '')).slice(0, 2400))
  }
  assert(await cleanVault.isVisible().catch(() => false), 'Clean golden-case vault is not selectable')
  await cleanVault.click()
  await pause(page, 4500)
  await page.keyboard.press('Escape')
  await pause(page, 1200)

  await switchMode(page, 'cognition')
  await requireText(page, 'Competing_Hypotheses', 'Competing hypotheses')
  await page.getByTestId('hypothesis-evidence-toggle').click()
  await pause(page, 4500)
  await page.getByTestId('assessment-evidence-toggle').click()
  await pause(page, 5000)

  await switchMode(page, 'learn')
  await requireText(page, /Visitor/, 'Visitor learning path')
  const visitorPath = page.getByRole('button', { name: /Visitor.*\d+\/\d+/ }).first()
  if (await visitorPath.isVisible().catch(() => false)) await visitorPath.click()
  const evidenceToggle = page.getByTestId('path-personalization-evidence-toggle')
  assert(await evidenceToggle.isVisible().catch(() => false), 'Personalized path evidence toggle is missing')
  await evidenceToggle.click()
  await pause(page, 6000)

  await switchMode(page, 'dashboard')
  await pause(page, 4000)
  await switchMode(page, 'galaxy')
  await pause(page, 4000)

  await selectVaultFromHeader(page, /选择知识库 小林·设计模式学期档案/, 'Mature semester')
  await switchMode(page, 'cognition')
  await requireText(page, /正式评估/, 'Long-term assessment history')
  await pause(page, 6000)
  await switchMode(page, 'learn')
  await pause(page, 5000)

  await page.close()
  const recordedPath = await video?.path()
  await context.close()
  await browser.close()
  assert(recordedPath, 'Playwright did not produce a video')
  await rename(recordedPath, webmPath)
  await convertToMp4(webmPath, mp4Path)
  console.log(`Recorded ${mp4Path}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
