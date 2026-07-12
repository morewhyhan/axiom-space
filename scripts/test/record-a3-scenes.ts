import assert from 'node:assert/strict'
import { access, mkdir, rename, rm } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test'
import { PrismaClient } from '@prisma/client'

const BASE_URL = process.env.A3_RECORD_URL || 'http://127.0.0.1:3000'
const EMAIL = process.env.A3_RECORD_EMAIL || 'demo@axiom.space'
const PASSWORD = process.env.A3_RECORD_PASSWORD || 'demo123456'
const CLEAN_VAULT = '设计模式黄金案例'
const MATURE_VAULT = '设计模式黄金案例·长期档案'
const artifactDir = path.resolve('test/artifacts/a3-golden-scenes')
const assetDir = path.resolve('local-tests/a3-golden-video-card/assets')
const storageStatePath = path.join(artifactDir, 'storage-state.json')
const prisma = new PrismaClient()

type Scene = {
  number: number
  slug: string
  run: (page: Page, context: BrowserContext) => Promise<void>
}

const sceneResults: Array<{ number: number; slug: string; ok: boolean; error?: string }> = []

async function pause(page: Page, milliseconds = 1200) {
  await page.waitForTimeout(milliseconds)
}

async function visible(locator: Locator) {
  return locator.isVisible().catch(() => false)
}

async function moveClick(page: Page, locator: Locator, waitAfter = 1100) {
  await locator.waitFor({ state: 'visible', timeout: 60_000 })
  await locator.scrollIntoViewIfNeeded().catch(() => {})
  const box = await locator.boundingBox()
  if (!box) {
    await locator.click()
  } else {
    const x = box.x + box.width / 2
    const y = box.y + box.height / 2
    await page.mouse.move(x, y, { steps: 18 })
    await pause(page, 240)
    await locator.click({ timeout: 60_000 })
  }
  await pause(page, waitAfter)
}

async function maybeMoveClick(page: Page, locator: Locator, waitAfter = 900) {
  if (!await visible(locator)) return false
  await moveClick(page, locator, waitAfter)
  return true
}

async function addRecordingCursor(context: BrowserContext) {
  await context.addInitScript(`
    document.addEventListener('DOMContentLoaded', function () {
      if (document.getElementById('axiom-recording-cursor')) return;
      var style = document.createElement('style');
      style.textContent = '#axiom-recording-cursor{position:fixed;z-index:2147483647;width:22px;height:22px;border:2px solid rgba(255,255,255,.96);border-radius:50%;background:rgba(35,211,238,.24);box-shadow:0 0 0 4px rgba(35,211,238,.12),0 4px 18px rgba(0,0,0,.42);pointer-events:none;transform:translate(-50%,-50%);left:50%;top:50%;transition:width .12s ease,height .12s ease,background .12s ease}#axiom-recording-cursor.down{width:15px;height:15px;background:rgba(168,85,247,.72)}.axiom-recording-ripple{position:fixed;z-index:2147483646;width:18px;height:18px;border:2px solid rgba(168,85,247,.82);border-radius:50%;pointer-events:none;transform:translate(-50%,-50%);animation:axiom-ripple .55s ease-out forwards}@keyframes axiom-ripple{to{width:68px;height:68px;opacity:0}}';
      document.head.appendChild(style);
      var cursor = document.createElement('div');
      cursor.id = 'axiom-recording-cursor';
      document.body.appendChild(cursor);
      document.addEventListener('mousemove', function (event) {
        cursor.style.left = event.clientX + 'px';
        cursor.style.top = event.clientY + 'px';
      }, true);
      document.addEventListener('mousedown', function (event) {
        cursor.classList.add('down');
        var ripple = document.createElement('div');
        ripple.className = 'axiom-recording-ripple';
        ripple.style.left = event.clientX + 'px';
        ripple.style.top = event.clientY + 'px';
        document.body.appendChild(ripple);
        setTimeout(function () { ripple.remove(); }, 650);
      }, true);
      document.addEventListener('mouseup', function () { cursor.classList.remove('down'); }, true);
    }, { once: true });
  `)
}

async function gotoHome(page: Page) {
  await page.goto(BASE_URL, { waitUntil: 'commit', timeout: 300_000 })
  await page.waitForLoadState('domcontentloaded', { timeout: 300_000 })
  await pause(page, 2200)
}

async function login(page: Page) {
  const email = page.getByLabel(/邮箱|email/i).first()
  const loginButton = page.getByRole('button', { name: /^登录$/ }).first()
  const enter = page.getByRole('button', { name: /进入知识库/ }).first()
  const selector = page.getByTestId('vault-selector')
  await email.or(loginButton).or(enter).or(selector).first().waitFor({ state: 'visible', timeout: 60_000 }).catch(() => {})
  if (!await visible(email) && await visible(loginButton)) {
    await moveClick(page, loginButton, 850)
    await email.waitFor({ state: 'visible', timeout: 30_000 })
  }
  if (await visible(email)) {
    await email.fill(EMAIL)
    await pause(page, 420)
    await page.getByLabel(/密码|password/i).first().fill(PASSWORD)
    await pause(page, 500)
    await moveClick(page, page.getByRole('button', { name: /^登录$/ }).last(), 2800)
    await enter.or(selector).first().waitFor({ state: 'visible', timeout: 60_000 }).catch(() => {})
  }
}

async function enterVaultPicker(page: Page) {
  const enter = page.getByRole('button', { name: /进入知识库/ }).first()
  const selector = page.getByTestId('vault-selector')
  if (!await visible(selector)) await enter.or(selector).first().waitFor({ state: 'visible', timeout: 60_000 }).catch(() => {})
  await maybeMoveClick(page, enter, 1600)
}

async function selectVault(page: Page, name: string) {
  const landingCard = page.locator('.landing-vault-select').filter({ hasText: name }).first()
  const selector = page.getByTestId('vault-selector')
  if (!await visible(selector)) {
    await landingCard.waitFor({ state: 'visible', timeout: 150_000 }).catch(() => {})
  }
  if (await visible(landingCard)) {
    await moveClick(page, landingCard, 3800)
    return
  }

  await selector.waitFor({ state: 'visible', timeout: 90_000 })
  const current = (await selector.innerText().catch(() => '')).trim()
  if (current === name) return
  await moveClick(page, selector, 700)
  const option = page.getByRole('option').filter({ hasText: name }).first()
  if (await visible(option)) {
    await moveClick(page, option, 4200)
  } else {
    const textOption = page.getByText(name, { exact: true }).last()
    await moveClick(page, textOption, 4200)
  }
  await page.keyboard.press('Escape').catch(() => {})
}

async function openWorkspace(page: Page, vaultName: string) {
  await gotoHome(page)
  const cookies = await page.context().cookies(BASE_URL)
  if (!cookies.some((cookie) => cookie.name.endsWith('session_token'))) await login(page)
  await enterVaultPicker(page)
  await selectVault(page, vaultName)
  await page.getByTestId('mode-nav-dashboard').waitFor({ state: 'visible', timeout: 120_000 })
  await maybeMoveClick(page, page.getByRole('button', { name: '直接开始使用', exact: true }), 900)
}

async function switchMode(page: Page, mode: 'dashboard' | 'forge' | 'galaxy' | 'cognition' | 'learn', waitAfter = 2600) {
  const nav = page.getByTestId(`mode-nav-${mode}`)
  await moveClick(page, nav, waitAfter)
  if (await nav.getAttribute('aria-current') !== 'page') {
    await nav.click({ timeout: 60_000 })
    await pause(page, waitAfter)
  }
}

async function convertToMp4(input: string, output: string) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('ffmpeg', [
      '-y', '-i', input,
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '25',
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', output,
    ], { stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}`)))
  })
}

async function prepareDemoData() {
  const user = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } })
  const vault = await prisma.vault.findFirstOrThrow({ where: { userId: user.id, name: CLEAN_VAULT } })
  const card = await prisma.card.findFirst({ where: { vaultId: vault.id, title: 'Visitor 双重分派' } })
  if (card && !card.content.includes('Agent B · 观察记录')) {
    await prisma.card.update({
      where: { id: card.id },
      data: {
        content: `${card.content}\n\n## 费曼学习输出\n\n我用自己的话解释：第一次由元素真实类型进入 accept；在具体元素方法体中，this 的静态类型让编译器选中对应的 visit 重载；随后再由 Visitor 的真实类型执行重写实现。\n\n## Agent B · 观察记录\n\n- 已记录：用户能够区分编译期重载选择与运行期重写分派。\n- 证据来源：本轮苏格拉底式追问后的费曼解释。\n- 待验证：迁移到陌生 AST 节点，并说明 Visitor 不适用的边界。`,
      },
    })
  }
  const now = new Date()
  const sessionId = `a3-recording-socratic-${vault.id}`
  await prisma.agentSession.upsert({
    where: { id: sessionId },
    update: {
      name: '苏格拉底 × 费曼学习演示',
      messages: JSON.stringify([
        { role: 'assistant', content: '先不背定义。Node n = new PdfNode(); visitor.visit(n) 会进入哪个重载？决定发生在编译期还是运行期？' },
        { role: 'user', content: '我原以为会进入 visit(PdfNode)，但运行结果是 visit(Node)。' },
        { role: 'assistant', content: '很好，先保留这个冲突。请不用术语堆砌，用自己的话解释：accept 到底保留了哪段类型信息？' },
        { role: 'user', content: '第一次由元素真实类型进入 accept；在具体元素方法体里，this 的静态类型让编译器选中对应的 visit 重载；随后再由 Visitor 的真实类型执行重写实现。' },
        { role: 'assistant', content: '这次费曼解释已经闭合核心因果链。Agent B 已把你的原话、判断依据和待验证边界写入右侧卡片；下一步用陌生 AST 场景复测。' },
      ]),
      updatedAt: now,
    },
    create: {
      id: sessionId,
      vaultId: vault.id,
      name: '苏格拉底 × 费曼学习演示',
      messages: JSON.stringify([
        { role: 'assistant', content: '先不背定义。Node n = new PdfNode(); visitor.visit(n) 会进入哪个重载？决定发生在编译期还是运行期？' },
        { role: 'user', content: '我原以为会进入 visit(PdfNode)，但运行结果是 visit(Node)。' },
        { role: 'assistant', content: '很好，先保留这个冲突。请不用术语堆砌，用自己的话解释：accept 到底保留了哪段类型信息？' },
        { role: 'user', content: '第一次由元素真实类型进入 accept；在具体元素方法体里，this 的静态类型让编译器选中对应的 visit 重载；随后再由 Visitor 的真实类型执行重写实现。' },
        { role: 'assistant', content: '这次费曼解释已经闭合核心因果链。Agent B 已把你的原话、判断依据和待验证边界写入右侧卡片；下一步用陌生 AST 场景复测。' },
      ]),
      createdAt: now,
      updatedAt: now,
    },
  })
}

async function sceneProfile(page: Page, context: BrowserContext) {
  await openWorkspace(page, CLEAN_VAULT)
  await pause(page, 1600)
  await switchMode(page, 'cognition', 3600)
  await moveClick(page, page.getByTestId('profile-pill-learningGoal'), 1700)
  const evidence = page.locator('button[title="查看这条画像的证据"]').first()
  if (await visible(evidence)) {
    await moveClick(page, evidence, 1800)
    await maybeMoveClick(page, page.locator('button[title="关闭证据面板"]'), 900)
  }
  await moveClick(page, page.getByTestId('profile-pill-currentFoundation'), 1500)
  await maybeMoveClick(page, page.getByRole('button', { name: '准确', exact: true }).first(), 1800)
  await moveClick(page, page.getByTestId('profile-pill-bestExplanationPath'), 2200)
  await context.storageState({ path: storageStatePath })
}

async function sceneImport(page: Page) {
  await openWorkspace(page, CLEAN_VAULT)
  await switchMode(page, 'dashboard', 1500)
  await moveClick(page, page.getByText('Import Literature', { exact: true }), 1100)
  const title = 'Visitor 双重分派 · 课程讲义演示'
  const material = `# Visitor 双重分派课程讲义\n\n## 目标\n理解 Java 重载与重写发生在不同阶段，并能解释 accept 为什么不能省略。\n\n## 核心材料\n重载在编译期依据参数表达式的静态类型选择方法签名；重写在运行期依据接收者真实类型选择实现。Node n = new PdfNode() 时，直接 visitor.visit(n) 会先锁定 visit(Node)。n.accept(visitor) 先进入 PdfNode.accept，此处 this 的静态类型是 PdfNode，因此选中 visit(PdfNode)。\n\n## 迁移验证\n在陌生 AST 场景中预测调用轨迹，并说明对象结构频繁变化时 Visitor 的维护代价。`
  await page.getByTestId('import-topic').fill(title)
  await pause(page, 450)
  await page.getByTestId('import-file').setInputFiles({
    name: 'Visitor-双重分派课程讲义.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(material, 'utf8'),
  })
  await pause(page, 1400)
  const submit = page.getByTestId('import-submit')
  await moveClick(page, submit, 1500)
  await pause(page, 2500)
  await submit.waitFor({ state: 'hidden', timeout: 75_000 }).catch(() => {})
  if (await visible(submit)) {
    await page.keyboard.press('Escape').catch(() => {})
  }
  await pause(page, 2600)
  if (await visible(page.getByTestId('mode-nav-learn'))) await switchMode(page, 'learn', 2600)
  await pause(page, 1800)
  await switchMode(page, 'dashboard', 4200)
}

async function openCardFromGalaxy(page: Page, title: string) {
  await switchMode(page, 'galaxy', 5200)
  const node = page.getByText(title, { exact: true }).first()
  await moveClick(page, node, 3600)
  if (!await visible(page.getByTestId('forge-resource-panel-context'))) {
    await switchMode(page, 'forge', 3600)
  }
}

async function sceneForge(page: Page) {
  await openWorkspace(page, CLEAN_VAULT)
  await openCardFromGalaxy(page, 'Visitor 双重分派')
  await page.getByTestId('forge-resource-panel-context').waitFor({ state: 'visible', timeout: 90_000 })
  await moveClick(page, page.getByTestId('forge-left-tab-talks'), 1700)
  const talk = page.getByText('苏格拉底 × 费曼学习演示', { exact: true }).first()
  await moveClick(page, talk, 3500)
  const messageScroll = page.locator('.forge-message-scroll').first()
  await messageScroll.hover().catch(() => {})
  await page.mouse.wheel(0, -900)
  await pause(page, 2200)
  await page.mouse.wheel(0, 980)
  await pause(page, 2600)
  await maybeMoveClick(page, page.getByRole('button', { name: 'READ', exact: true }).last(), 2400)
  const reader = page.locator('.forge-paper-read').first()
  if (await visible(reader)) {
    await reader.hover()
    await page.mouse.wheel(0, 900)
    await pause(page, 2600)
  }
}

async function sceneResources(page: Page) {
  await openWorkspace(page, MATURE_VAULT)
  await openCardFromGalaxy(page, 'Visitor 双重分派个性化资源包')
  await maybeMoveClick(page, page.getByRole('button', { name: 'READ', exact: true }).last(), 1800)
  const resources = [
    '因果链讲解文档',
    '机制思维导图',
    '诊断与迁移题库',
    'Java 可运行实操',
    '90 秒交互教学动画',
  ]
  for (const title of resources) {
    const button = page.getByRole('button', { name: new RegExp(title) }).first()
    if (await visible(button)) await moveClick(page, button, title.includes('导图') ? 2600 : 1700)
  }
  const frame = page.locator('.resource-preview-pane iframe').first()
  if (await visible(frame)) {
    const next = page.frames().flatMap((item) => item === page.mainFrame() ? [] : [item]).at(-1)?.getByRole('button', { name: '下一步' })
    if (next && await visible(next)) {
      await moveClick(page, next, 1200)
      await moveClick(page, next, 1200)
    }
  }
  const reader = page.locator('.forge-paper-read').first()
  if (await visible(reader)) {
    await reader.hover()
    await page.mouse.wheel(0, 1350)
    await pause(page, 3000)
  }
}

async function sceneGalaxy(page: Page) {
  await openWorkspace(page, MATURE_VAULT)
  await switchMode(page, 'galaxy', 6000)
  for (const label of ['平面', '环形', '分层', '证据', '星系']) {
    const button = page.getByRole('button', { name: label, exact: true }).first()
    if (await visible(button)) await moveClick(page, button, 2300)
  }
  await maybeMoveClick(page, page.getByRole('button', { name: '跨域连线', exact: true }).first(), 1900)
  await maybeMoveClick(page, page.getByRole('button', { name: '适配', exact: true }).first(), 2400)
}

async function sceneMatureVault(page: Page) {
  await openWorkspace(page, CLEAN_VAULT)
  await switchMode(page, 'dashboard', 1800)
  await selectVault(page, MATURE_VAULT)
  await pause(page, 3200)
  await switchMode(page, 'cognition', 3300)
  await maybeMoveClick(page, page.getByTestId('profile-history-toggle'), 1900)
  await maybeMoveClick(page, page.getByTestId('profile-pill-stuckPattern'), 1800)
  await switchMode(page, 'learn', 3400)
  await maybeMoveClick(page, page.getByTestId('path-personalization-evidence-toggle'), 2200)
  await switchMode(page, 'galaxy', 5200)
  await maybeMoveClick(page, page.getByRole('button', { name: '地形', exact: true }).first(), 2600)
  await switchMode(page, 'dashboard', 3200)
}

async function recordScene(browser: Browser, scene: Scene, useStorageState: boolean) {
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    colorScheme: 'dark',
    ...(useStorageState ? { storageState: storageStatePath } : {}),
    recordVideo: { dir: artifactDir, size: { width: 1920, height: 1080 } },
  })
  await context.addInitScript(`
    try {
      var raw = localStorage.getItem('axiom-store');
      if (raw) {
        var saved = JSON.parse(raw);
        if (saved && saved.state) saved.state.hasCompletedOnboarding = true;
        localStorage.setItem('axiom-store', JSON.stringify(saved));
      }
    } catch (error) {}
  `)
  await addRecordingCursor(context)
  const page = await context.newPage()
  page.setDefaultTimeout(90_000)
  const video = page.video()
  let ok = true
  let errorText: string | undefined
  page.on('pageerror', (error) => console.warn(`[scene ${scene.number}] page error: ${error.message}`))

  try {
    await scene.run(page, context)
    await pause(page, 1400)
  } catch (error) {
    ok = false
    errorText = error instanceof Error ? error.stack || error.message : String(error)
    console.error(`[scene ${scene.number}] ${errorText}`)
    await page.screenshot({ path: path.join(artifactDir, `scene-${String(scene.number).padStart(2, '0')}-error.png`) }).catch(() => {})
    await pause(page, 3000).catch(() => {})
  }

  await context.close()
  const recordedPath = await video?.path()
  assert(recordedPath, `Playwright did not produce video for scene ${scene.number}`)
  const webmPath = path.join(artifactDir, `scene-${String(scene.number).padStart(2, '0')}-${scene.slug}.webm`)
  const mp4Path = path.join(assetDir, `scene-${String(scene.number).padStart(2, '0')}-${scene.slug}.mp4`)
  await rm(webmPath, { force: true })
  await rename(recordedPath, webmPath)
  await convertToMp4(webmPath, mp4Path)
  sceneResults.push({ number: scene.number, slug: scene.slug, ok, ...(errorText ? { error: errorText } : {}) })
  console.log(`[scene ${scene.number}] ${ok ? 'recorded' : 'recorded with fallback'} -> ${mp4Path}`)
}

async function prepareStorageState(browser: Browser) {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, colorScheme: 'dark' })
  const page = await context.newPage()
  page.setDefaultTimeout(150_000)
  try {
    await openWorkspace(page, CLEAN_VAULT)
    await context.storageState({ path: storageStatePath })
  } finally {
    await context.close()
  }
}

async function main() {
  await mkdir(artifactDir, { recursive: true })
  await mkdir(assetDir, { recursive: true })
  await prepareDemoData()

  const scenes: Scene[] = [
    { number: 1, slug: 'profile', run: sceneProfile },
    { number: 2, slug: 'import', run: sceneImport },
    { number: 3, slug: 'forge', run: sceneForge },
    { number: 4, slug: 'resources', run: sceneResources },
    { number: 5, slug: 'galaxy', run: sceneGalaxy },
    { number: 6, slug: 'mature-vault', run: sceneMatureVault },
  ]

  const browser = await chromium.launch({ headless: true })
  try {
    await access(storageStatePath).catch(() => prepareStorageState(browser))
    for (const scene of scenes) {
      await recordScene(browser, scene, true)
    }
  } finally {
    await browser.close()
    await prisma.$disconnect()
  }
  console.log(JSON.stringify(sceneResults, null, 2))
  if (sceneResults.some((item) => !item.ok)) process.exitCode = 2
}

main().catch(async (error) => {
  console.error(error)
  await prisma.$disconnect().catch(() => {})
  process.exitCode = 1
})
