import { createServer } from 'node:http'
import { readFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from '@playwright/test'

const root = process.cwd()
const deckDir = path.resolve(root, 'local-tests/a3-v21-promo-ppt')
const screenshotPath = path.resolve(root, 'test/artifacts/a3-v21-narration-playback.png')
const browserExecutable = process.env.A3_BROWSER_EXECUTABLE
const missingFiles = []
const mime = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mp3', 'audio/mpeg'],
  ['.mp4', 'video/mp4'],
  ['.vtt', 'text/vtt; charset=utf-8'],
])

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', 'http://127.0.0.1')
    const relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)
    const filePath = path.resolve(deckDir, `.${relative}`)
    if (!filePath.startsWith(`${deckDir}${path.sep}`)) {
      response.writeHead(403).end('Forbidden')
      return
    }
    const body = await readFile(filePath)
    response.writeHead(200, {
      'Content-Type': mime.get(path.extname(filePath).toLowerCase()) || 'application/octet-stream',
      'Cache-Control': 'no-store',
    })
    response.end(body)
  } catch (error) {
    missingFiles.push(request.url || '/')
    response.writeHead(404).end('Not found')
  }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port

const browser = await chromium.launch({
  headless: true,
  executablePath: browserExecutable || undefined,
})
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
page.setDefaultTimeout(12_000)
const errors = []
page.on('console', (message) => {
  if (message.type() === 'error' && !message.text().includes('Failed to load resource')) errors.push(message.text())
})
page.on('pageerror', (error) => errors.push(error.message))

try {
  await page.goto(`http://127.0.0.1:${port}/#scene-01`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#scene-01.is-active')
  const initial = await page.evaluate(() => ({
    paused: document.querySelector('#narrationAudio')?.paused,
    src: document.querySelector('#narrationAudio')?.src,
    manualControlPresent: Boolean(document.querySelector('#narrationControl')),
  }))

  await page.keyboard.press('ArrowRight')
  await page.waitForSelector('#scene-02.is-active')
  await page.waitForFunction(() => {
    const audio = document.querySelector('#narrationAudio')
    return audio && audio.src.includes('scene-02-learning-gap.mp3') && !audio.paused && audio.currentTime > 0.2
  })
  const second = await page.evaluate(() => {
    const audio = document.querySelector('#narrationAudio')
    return {
      src: audio?.src,
      paused: audio?.paused,
      currentTime: audio?.currentTime,
      bindings: document.querySelectorAll('.slide[data-narration]').length,
    }
  })

  await page.keyboard.press('ArrowLeft')
  await page.waitForSelector('#scene-01.is-active')
  await page.waitForFunction(() => {
    const audio = document.querySelector('#narrationAudio')
    return audio && audio.src.includes('scene-01-opening.mp3') && !audio.paused && audio.currentTime > 0.2
  })
  const first = await page.evaluate(() => {
    const audio = document.querySelector('#narrationAudio')
    return { src: audio?.src, paused: audio?.paused, currentTime: audio?.currentTime }
  })

  await page.locator('#nav .dot').nth(4).click()
  await page.waitForSelector('#scene-05.is-active')
  await page.waitForFunction(() => {
    const audio = document.querySelector('#narrationAudio')
    const video = document.querySelector('#continuityVideo')
    return audio && video && audio.src.includes('scene-05-vault.mp3') && !audio.paused && audio.currentTime > 0.2 && video.muted && video.readyState >= 2 && !video.paused && video.currentTime > 0.1
  })
  const videoSlide = await page.evaluate(() => {
    const audio = document.querySelector('#narrationAudio')
    const video = document.querySelector('#continuityVideo')
    return {
      audioPaused: audio?.paused,
      audioTime: audio?.currentTime,
      videoMuted: video?.muted,
      videoPaused: video?.paused,
      videoTime: video?.currentTime,
    }
  })

  await page.locator('#narrationControl').click()
  await page.waitForFunction(() => document.querySelector('#narrationAudio')?.paused === true)
  const manualPause = await page.evaluate(() => ({
    paused: document.querySelector('#narrationAudio')?.paused,
    pressed: document.querySelector('#narrationControl')?.getAttribute('aria-pressed'),
    state: document.querySelector('#narrationControl')?.dataset.state,
  }))

  await page.locator('#narrationControl').click()
  await page.waitForFunction(() => {
    const audio = document.querySelector('#narrationAudio')
    const control = document.querySelector('#narrationControl')
    return audio && control && !audio.paused && audio.currentTime > 0.2 && control.dataset.state === 'playing'
  })
  const manualResume = await page.evaluate(() => ({
    paused: document.querySelector('#narrationAudio')?.paused,
    pressed: document.querySelector('#narrationControl')?.getAttribute('aria-pressed'),
    state: document.querySelector('#narrationControl')?.dataset.state,
  }))

  await mkdir(path.dirname(screenshotPath), { recursive: true })
  await page.screenshot({ path: screenshotPath })
  const relevantMissingFiles = missingFiles.filter((url) => !url.includes('favicon.ico'))
  const result = { initial, first, second, videoSlide, manualPause, manualResume, errors, missingFiles: relevantMissingFiles, screenshotPath }
  console.log(JSON.stringify(result, null, 2))

  const passed =
    initial.manualControlPresent === true &&
    first.paused === false &&
    first.src.includes('scene-01-opening.mp3') &&
    second.bindings === 17 &&
    second.paused === false &&
    second.src.includes('scene-02-learning-gap.mp3') &&
    videoSlide.audioPaused === false &&
    videoSlide.videoMuted === true &&
    videoSlide.videoPaused === false &&
    manualPause.paused === true &&
    manualPause.pressed === 'false' &&
    manualPause.state === 'paused' &&
    manualResume.paused === false &&
    manualResume.pressed === 'true' &&
    manualResume.state === 'playing' &&
    relevantMissingFiles.length === 0 &&
    errors.length === 0
  if (!passed) process.exitCode = 1
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
