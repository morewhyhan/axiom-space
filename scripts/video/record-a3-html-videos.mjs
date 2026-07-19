import { mkdir, readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { chromium } from '@playwright/test'

const root = process.cwd()
const baseUrl = process.env.A3_RECORD_BASE_URL || 'http://127.0.0.1:3002'
const email = process.env.A3_RECORD_EMAIL || 'demo@axiom.space'
const password = process.env.A3_RECORD_PASSWORD || 'demo123456'
const vaultName = process.env.A3_RECORD_VAULT || 'Java Web 并发控制黄金案例'
const deckDir = path.resolve(root, 'local-tests/a3-golden-video-card')
const videosDir = path.join(deckDir, 'assets/videos')
const tempDir = path.resolve(root, 'test/artifacts/a3-html-video-recording')

const scenes = [
  ['01', 'scene-01-answer-is-not-mastery.mp4', scene01],
  ['02', 'scene-02-diagnose-the-gap.mp4', scene02],
  ['03', 'scene-03-profile-changes-teaching.mp4', scene03],
  ['04', 'scene-04-course-to-workbench.mp4', scene04],
  ['05', 'scene-05-recall-prior-knowledge.mp4', scene05],
  ['06', 'scene-06-dialogue-to-card.mp4', scene06],
  ['07', 'scene-07-review-rejects-card.mp4', scene07],
  ['08', 'scene-08-generate-only-video.mp4', scene08],
  ['09', 'scene-09-transfer-and-pass.mp4', scene09],
  ['10', 'scene-10-evidence-changes-next-step.mp4', scene10],
  ['11', 'scene-11-resume-long-term-state.mp4', scene11],
  ['12', 'scene-12-trace-evidence.mp4', scene12],
  ['13', 'scene-13-learning-compounds.mp4', scene13],
]

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} exited ${code}\n${stderr}`))
    })
  })
}

async function visible(locator) {
  return locator.isVisible().catch(() => false)
}

async function waitHidden(page, text, timeout = 60_000) {
  await page.getByText(text).waitFor({ state: 'hidden', timeout }).catch(() => {})
}

async function login(page) {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 180_000 })
  await waitHidden(page, '正在恢复会话...', 90_000)

  const emailInput = page.getByLabel(/邮箱|email/i)
  if (!await visible(emailInput)) {
    const loginButton = page.getByRole('button', { name: /登录|sign in|log in/i }).first()
    await loginButton.waitFor({ state: 'visible', timeout: 45_000 })
    for (let attempt = 0; attempt < 4 && !await visible(emailInput); attempt += 1) {
      await loginButton.click()
      await wait(500)
    }
  }

  if (await visible(emailInput)) {
    await emailInput.fill(email)
    await page.getByLabel(/密码|password/i).fill(password)
    await page.getByRole('button', { name: /登录|sign in|log in/i }).last().click()
  }

  const enterVault = page.getByRole('button', { name: /进入知识库/ }).first()
  await enterVault.waitFor({ state: 'visible', timeout: 60_000 })
  await enterVault.click()
  const vault = page.getByRole('button').filter({ hasText: vaultName }).first()
  await vault.waitFor({ state: 'visible', timeout: 60_000 })
  await vault.click()
  await page.getByTestId('mode-nav-forge').waitFor({ state: 'visible', timeout: 90_000 })
  await wait(1200)
}

async function preparePage(page) {
  page.setDefaultTimeout(30_000)
  await page.addStyleTag({
    content: `
      * { scroll-behavior: auto !important; }
      body::after {
        content: "AXIOM Space · 黄金案例实录";
        position: fixed;
        right: 18px;
        bottom: 12px;
        z-index: 999999;
        padding: 6px 10px;
        border: 1px solid rgba(25,121,132,.22);
        border-radius: 8px;
        background: rgba(248,250,249,.9);
        color: #125f68;
        font: 600 12px/1.2 system-ui, sans-serif;
        pointer-events: none;
      }
    `,
  }).catch(() => {})
}

async function openForge(page) {
  await page.getByTestId('mode-nav-forge').click()
  await page.getByTestId('forge-activity-context').waitFor({ state: 'visible', timeout: 60_000 })
  const chatToggle = page.getByTestId('forge-activity-chat')
  if (await chatToggle.getAttribute('aria-pressed') !== 'true') await chatToggle.click()
  await page.locator('.forge-console-panel').waitFor({ state: 'visible', timeout: 60_000 })
}

async function ensureForgeResourcePanel(page, view) {
  const panel = page.getByTestId(`forge-resource-panel-${view}`)
  if (!await visible(panel)) await page.getByTestId(`forge-activity-${view}`).click()
  await panel.waitFor({ state: 'visible', timeout: 30_000 })
  return panel
}

async function openTalk(page, title) {
  await openForge(page)
  await ensureForgeResourcePanel(page, 'context')
  await page.getByTestId('forge-left-tab-talks').click()
  await page.getByTestId('forge-left-search-context').fill(title)
  const talk = page.getByRole('button', { name: `打开对话 ${title}` }).first()
  await talk.waitFor({ state: 'visible', timeout: 45_000 })
  await talk.click()
  await wait(900)
}

async function openCard(page, title) {
  await openForge(page)
  await ensureForgeResourcePanel(page, 'cards')
  await page.getByTestId('forge-left-search-cards').fill(title)
  const card = page.getByRole('button', { name: `打开卡片 ${title}` }).first()
  await card.waitFor({ state: 'visible', timeout: 45_000 })
  await card.click()
  await page.locator('.forge-paper-header').getByText(title, { exact: true }).waitFor({ state: 'visible', timeout: 45_000 })
  await wait(900)
}

async function scrollPanel(page, selector, amount = 520) {
  await page.locator(selector).first().evaluate((element, y) => element.scrollBy({ top: y, behavior: 'smooth' }), amount).catch(() => {})
  await wait(1000)
}

async function hold(page, ms = 1800) {
  await page.mouse.move(1100, 620, { steps: 18 }).catch(() => {})
  await wait(ms)
}

async function scene01(page) {
  await openTalk(page, '从标准答案到下一步计划')
  await page.getByText('通用 Agent 已经给我列了事务、锁和原子更新', { exact: false }).waitFor()
  await hold(page)
  await scrollPanel(page, '.forge-console-panel', 360)
  await page.getByText('还不能，这次先保留为待验证', { exact: false }).waitFor()
  await hold(page, 2200)
}

async function scene02(page) {
  await openTalk(page, '库存超卖预测诊断')
  await page.getByText('我预测 A 看到 1，B 看到 0', { exact: false }).waitFor()
  await hold(page, 1200)
  await scrollPanel(page, '.forge-console-panel', 560)
  await page.getByText('A read stock=1', { exact: false }).waitFor()
  await page.getByText('同一份过期库存', { exact: false }).waitFor()
  await hold(page, 2200)
}

async function scene03(page) {
  await page.getByTestId('mode-nav-cognition').click()
  await page.getByTestId('profile-pill-currentFoundation').waitFor({ state: 'visible', timeout: 60_000 })
  await hold(page, 1300)
  await page.getByTestId('profile-pill-currentFoundation').click()
  await page.getByText('开始买', { exact: false }).waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {})
  await hold(page, 1800)
  const evidence = page.getByTestId('profile-node-evidence-open').first()
  if (await visible(evidence)) await evidence.click()
  await hold(page, 2200)
}

async function scene04(page) {
  await page.getByTestId('mode-nav-learn').click()
  await page.getByText('并发库存个性化学习路径', { exact: true }).first().waitFor({ state: 'visible', timeout: 60_000 })
  await hold(page, 1400)
  await page.getByText('用时间线解释共享旧状态', { exact: false }).first().click().catch(() => {})
  await hold(page, 1400)
  await openCard(page, '共享旧状态导致超卖')
  await hold(page, 1800)
}

async function scene05(page) {
  await openCard(page, '共享旧状态导致超卖')
  await page.getByText('两个窗口同时修改一份在线表格', { exact: false }).first().waitFor({ state: 'visible', timeout: 45_000 }).catch(() => {})
  await hold(page, 1400)
  const ref = page.getByText('两个窗口同时修改一份在线表格', { exact: false }).first()
  if (await visible(ref)) await ref.click().catch(() => {})
  await hold(page, 2200)
}

async function scene06(page) {
  await openCard(page, '共享旧状态导致超卖')
  await page.getByText('每个人单独看都没错', { exact: false }).waitFor()
  await hold(page, 1200)
  await scrollPanel(page, '.forge-paper-read', 520)
  await hold(page, 1600)
  await scrollPanel(page, '.forge-console-panel', 500)
  await hold(page, 1800)
}

async function scene07(page) {
  await openCard(page, '共享旧状态导致超卖')
  await page.getByText('第一次独立审核结果', { exact: false }).waitFor({ state: 'visible', timeout: 45_000 }).catch(() => {})
  await hold(page, 1300)
  await scrollPanel(page, '.forge-console-panel', 620)
  await page.getByText('不能升级永久卡', { exact: false }).waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {})
  await hold(page, 2200)
}

async function scene08(page) {
  await openTalk(page, '库存交错教学动画')
  await page.getByText('本次没有生成题库、导图或额外 Markdown 卡片', { exact: false }).waitFor({ state: 'visible', timeout: 45_000 })
  await hold(page, 1100)
  await openCard(page, '库存超卖交互动画')
  await page.locator('.forge-paper-panel iframe').first().waitFor({ state: 'visible', timeout: 45_000 })
  await hold(page, 1100)
  const fullscreen = page.getByTestId('forge-preview-fullscreen')
  if (await visible(fullscreen)) await fullscreen.click()
  await hold(page, 2400)
  if (await visible(fullscreen)) await fullscreen.click().catch(() => {})
}

async function scene09(page) {
  await openTalk(page, '最后一张优惠券迁移评估')
  await page.getByText('两个请求都会读到“未领取”', { exact: false }).waitFor({ state: 'visible', timeout: 45_000 })
  await hold(page, 1200)
  await scrollPanel(page, '.forge-console-panel', 720)
  await page.getByText('独立评估', { exact: false }).waitFor({ state: 'visible', timeout: 30_000 })
  await hold(page, 1900)
  await openCard(page, '共享旧状态导致超卖')
  await hold(page, 1200)
}

async function scene10(page) {
  await page.getByTestId('mode-nav-learn').click()
  await page.getByText('并发库存个性化学习路径', { exact: true }).first().waitFor({ state: 'visible', timeout: 60_000 })
  const evidenceToggle = page.getByTestId('path-personalization-evidence-toggle')
  if (await visible(evidenceToggle)) await evidenceToggle.click()
  await hold(page, 1500)
  await page.getByTestId('push-box-link').waitFor({ state: 'visible', timeout: 45_000 })
  await page.getByTestId('push-box-resource').waitFor({ state: 'visible', timeout: 45_000 })
  await hold(page, 2200)
}

async function scene11(page) {
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.getByTestId('mode-nav-forge').waitFor({ state: 'visible', timeout: 90_000 })
  await openCard(page, '共享旧状态导致超卖')
  await hold(page, 1300)
  await openTalk(page, '从标准答案到下一步计划')
  await hold(page, 1800)
}

async function scene12(page) {
  await page.getByTestId('mode-nav-cognition').click()
  await page.getByTestId('profile-pill-currentFoundation').waitFor({ state: 'visible', timeout: 60_000 })
  await page.getByTestId('profile-pill-currentFoundation').click()
  const evidenceButton = page.getByTestId('profile-node-evidence-open').first()
  if (await visible(evidenceButton)) await evidenceButton.click()
  await hold(page, 1200)
  const sourceLink = page.locator('[data-testid^="profile-evidence-source-link-learningMessage-"]').first()
  if (await visible(sourceLink)) await sourceLink.click()
  await hold(page, 1800)
  await page.getByTestId('mode-nav-learn').click()
  await hold(page, 1800)
}

async function scene13(page) {
  await page.getByTestId('mode-nav-learn').click()
  await page.getByText('比较原子 SQL、乐观锁与悲观锁边界', { exact: false }).first().waitFor({ state: 'visible', timeout: 60_000 })
  await hold(page, 1300)
  await openCard(page, '并发边界与选型')
  await hold(page, 1700)
  await openCard(page, '跨系统失败补偿')
  await hold(page, 1700)
}

async function recordScene(browser, storageState, sceneId, fileName, action) {
  const sceneTmp = path.join(tempDir, `scene-${sceneId}`)
  await rm(sceneTmp, { recursive: true, force: true })
  await mkdir(sceneTmp, { recursive: true })
  const context = await browser.newContext({
    storageState,
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    locale: 'zh-CN',
    recordVideo: { dir: sceneTmp, size: { width: 1280, height: 720 } },
  })
  await context.addInitScript(() => {
    localStorage.setItem('axiom-recording-performance', '1')
  })
  const page = await context.newPage()
  await preparePage(page)
  await page.goto(`${baseUrl}?recording=1`, { waitUntil: 'domcontentloaded', timeout: 180_000 })
  await page.getByTestId('mode-nav-forge').waitFor({ state: 'visible', timeout: 120_000 })
  await action(page)
  await wait(500)
  await context.close()

  const files = await readdir(sceneTmp)
  const webm = files.find((name) => name.endsWith('.webm'))
  if (!webm) throw new Error(`scene ${sceneId} did not produce a Playwright video`)
  const input = path.join(sceneTmp, webm)
  const output = path.join(videosDir, fileName)
  await run('ffmpeg', [
    '-y',
    '-i', input,
    '-vf', 'fps=30,scale=1280:720:flags=lanczos,format=yuv420p',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '23',
    '-movflags', '+faststart',
    '-an',
    output,
  ])
  return output
}

async function main() {
  await mkdir(videosDir, { recursive: true })
  await mkdir(tempDir, { recursive: true })

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--autoplay-policy=no-user-gesture-required',
    ],
  })

  const authContext = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    locale: 'zh-CN',
  })
  await authContext.addInitScript(() => {
    localStorage.setItem('axiom-recording-performance', '1')
  })
  const authPage = await authContext.newPage()
  await login(authPage)
  const storageState = await authContext.storageState()
  await authContext.close()

  const outputs = []
  try {
    for (const [sceneId, fileName, action] of scenes) {
      console.log(`[a3-record] scene ${sceneId} -> ${fileName}`)
      const output = await recordScene(browser, storageState, sceneId, fileName, action)
      outputs.push(path.relative(root, output))
    }
  } finally {
    await browser.close()
  }

  console.log(JSON.stringify({ success: true, outputs }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
