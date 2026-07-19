import { mkdir, readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { chromium } from '@playwright/test'

const root = process.cwd()
const baseUrl = process.env.A3_RECORD_BASE_URL || 'http://127.0.0.1:3000'
const email = process.env.A3_RECORD_EMAIL || 'demo@axiom.space'
const password = process.env.A3_RECORD_PASSWORD || 'demo123456'
const vaultName = process.env.A3_RECORD_VAULT || 'Java Web 并发控制黄金案例'
const videosDir = path.resolve(root, 'local-tests/a3-golden-video-card/assets/videos')
const tempDir = path.resolve(root, 'test/artifacts/a3-representative-video-recording')

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
const sceneFilter = new Set(
  (process.env.A3_RECORD_SCENES || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean),
)

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} exited ${code}\n${stderr}`))
    })
  })
}

async function visible(locator, timeout = 1200) {
  return locator.isVisible({ timeout }).catch(() => false)
}

async function clickIfVisible(locator) {
  if (await visible(locator)) {
    await locator.click().catch(() => {})
    await wait(700)
    return true
  }
  return false
}

async function fillIfVisible(locator, value) {
  if (await visible(locator)) {
    await locator.fill(value).catch(() => {})
    await wait(300)
    return true
  }
  return false
}

async function loginAndSelectVault(page) {
  page.setDefaultTimeout(10_000)
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.getByText('正在恢复会话...').waitFor({ state: 'hidden', timeout: 60_000 }).catch(() => {})

  const emailInput = page.getByLabel(/邮箱|email/i).first()
  if (!await visible(emailInput)) {
    await clickIfVisible(page.getByRole('button', { name: /登录|sign in|log in/i }).first())
  }

  if (await visible(emailInput)) {
    await fillIfVisible(emailInput, email)
    await fillIfVisible(page.getByLabel(/密码|password/i).first(), password)
    await page.getByRole('button', { name: /登录|sign in|log in/i }).last().click().catch(() => {})
    await wait(2200)
  }

  await clickIfVisible(page.getByRole('button', { name: /进入知识库/ }).first())
  const vault = page.getByRole('button').filter({ hasText: vaultName }).first()
  if (!await visible(vault, 15_000)) {
    const body = await page.locator('body').innerText().catch(() => '')
    throw new Error(`Cannot find vault "${vaultName}". Page text:\n${body.slice(0, 1500)}`)
  }
  await vault.click()
  await page.getByTestId('mode-nav-forge').waitFor({ state: 'visible', timeout: 60_000 })
  await page.keyboard.press('Escape').catch(() => {})
  await wait(1000)
}

async function preparePage(page) {
  page.setDefaultTimeout(8000)
  await page.addStyleTag({
    content: `
      * { scroll-behavior: auto !important; }
      body::after {
        content: "AXIOM Space · A3 产品实录";
        position: fixed;
        right: 14px;
        bottom: 10px;
        z-index: 999999;
        padding: 5px 9px;
        border: 1px solid rgba(99, 102, 241, .22);
        border-radius: 8px;
        background: rgba(12, 15, 22, .78);
        color: rgba(255,255,255,.72);
        font: 600 12px/1.2 system-ui, sans-serif;
        pointer-events: none;
      }
    `,
  }).catch(() => {})
}

async function enterWorkspace(page) {
  await page.goto(`${baseUrl}?recording=1`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.getByText('正在恢复会话...').waitFor({ state: 'hidden', timeout: 60_000 }).catch(() => {})
  if (await visible(page.getByRole('button', { name: /进入知识库/ }).first())) {
    await page.getByRole('button', { name: /进入知识库/ }).first().click()
    await clickIfVisible(page.getByRole('button').filter({ hasText: vaultName }).first())
  }
  await page.getByTestId('mode-nav-forge').waitFor({ state: 'visible', timeout: 60_000 })
  await page.keyboard.press('Escape').catch(() => {})
  await wait(900)
}

async function switchMode(page, mode) {
  await clickIfVisible(page.getByTestId(`mode-nav-${mode}`))
  await wait(1000)
}

async function openForge(page) {
  await switchMode(page, 'forge')
  await clickIfVisible(page.getByTestId('forge-activity-chat'))
  await wait(700)
}

async function openPanel(page, view) {
  await openForge(page)
  await clickIfVisible(page.getByTestId(`forge-activity-${view}`))
  await wait(500)
}

async function openTalk(page, title) {
  await openPanel(page, 'context')
  await clickIfVisible(page.getByTestId('forge-left-tab-talks'))
  await fillIfVisible(page.getByTestId('forge-left-search-context'), title)
  const exact = page.getByRole('button', { name: new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).first()
  const fallback = page.getByRole('button').filter({ hasText: title }).first()
  if (await clickIfVisible(exact) || await clickIfVisible(fallback)) return true
  return false
}

async function openCard(page, title) {
  await openPanel(page, 'cards')
  await fillIfVisible(page.getByTestId('forge-left-search-cards'), title)
  const fallback = page.getByRole('button').filter({ hasText: title }).first()
  if (await clickIfVisible(fallback)) {
    await wait(1000)
    return true
  }
  return false
}

async function scrollMain(page, amount = 420) {
  await page.mouse.wheel(0, amount).catch(() => {})
  await wait(700)
}

async function hold(page, ms = 1600) {
  await page.mouse.move(980, 560, { steps: 14 }).catch(() => {})
  await wait(ms)
}

async function scene01(page) {
  await openTalk(page, '从标准答案到下一步计划')
  await hold(page, 1400)
  await scrollMain(page, 520)
  await hold(page, 1600)
}

async function scene02(page) {
  await openTalk(page, '库存超卖预测诊断')
  await hold(page, 1400)
  await scrollMain(page, 580)
  await hold(page, 1700)
}

async function scene03(page) {
  await switchMode(page, 'cognition')
  await clickIfVisible(page.getByTestId('profile-pill-currentFoundation'))
  await hold(page, 1500)
  await clickIfVisible(page.getByTestId('profile-node-evidence-open').first())
  await hold(page, 1700)
}

async function scene04(page) {
  await switchMode(page, 'learn')
  await hold(page, 1300)
  await openCard(page, '共享旧状态导致超卖')
  await hold(page, 1700)
}

async function scene05(page) {
  await openCard(page, '共享旧状态导致超卖')
  await hold(page, 1200)
  await scrollMain(page, 560)
  await hold(page, 1700)
}

async function scene06(page) {
  await openCard(page, '共享旧状态导致超卖')
  await hold(page, 1100)
  await scrollMain(page, 760)
  await hold(page, 1800)
}

async function scene07(page) {
  await openCard(page, '共享旧状态导致超卖')
  await scrollMain(page, 900)
  await hold(page, 2500)
}

async function scene08(page) {
  await openTalk(page, '库存交错教学动画')
  await hold(page, 1100)
  await openCard(page, '库存超卖互动动画')
  await hold(page, 1200)
  await clickIfVisible(page.getByTestId('forge-preview-fullscreen'))
  await hold(page, 2200)
}

async function scene09(page) {
  await openTalk(page, '最后一张优惠券迁移评估')
  await hold(page, 1200)
  await scrollMain(page, 680)
  await hold(page, 1800)
}

async function scene10(page) {
  await switchMode(page, 'learn')
  await clickIfVisible(page.getByTestId('path-personalization-evidence-toggle'))
  await hold(page, 1500)
  await page.mouse.move(1040, 500, { steps: 12 }).catch(() => {})
  await hold(page, 1700)
}

async function scene11(page) {
  await openCard(page, '共享旧状态导致超卖')
  await hold(page, 1200)
  await openTalk(page, '从标准答案到下一步计划')
  await hold(page, 1400)
}

async function scene12(page) {
  await switchMode(page, 'cognition')
  await clickIfVisible(page.getByTestId('profile-pill-currentFoundation'))
  await clickIfVisible(page.getByTestId('profile-node-evidence-open').first())
  await hold(page, 1400)
  await switchMode(page, 'learn')
  await hold(page, 1600)
}

async function scene13(page) {
  await switchMode(page, 'learn')
  await hold(page, 1100)
  await openCard(page, '并发边界与选型')
  await hold(page, 1300)
  await openCard(page, '跨系统失败补偿')
  await hold(page, 1500)
}

async function recordScene(browser, sceneId, fileName, action) {
  const sceneTmp = path.join(tempDir, `scene-${sceneId}`)
  await rm(sceneTmp, { recursive: true, force: true })
  await mkdir(sceneTmp, { recursive: true })
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    locale: 'zh-CN',
    recordVideo: { dir: sceneTmp, size: { width: 1280, height: 720 } },
  })
  await context.addInitScript(() => {
    localStorage.setItem('axiom-recording-performance', '1')
    localStorage.setItem('axiom-vault-initial-profile-onboarding', '1')
  })
  const page = await context.newPage()
  await preparePage(page)
  await loginAndSelectVault(page)
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
    '-crf', '22',
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
    ],
  })

  const outputs = []
  try {
    for (const [sceneId, fileName, action] of scenes) {
      if (sceneFilter.size && !sceneFilter.has(sceneId)) continue
      console.log(`[a3-representative] scene ${sceneId} -> ${fileName}`)
      const output = await recordScene(browser, sceneId, fileName, action)
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
