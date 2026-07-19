import { mkdir } from 'node:fs/promises'
import { chromium } from '@playwright/test'

const baseUrl = process.env.A3_DECK_URL || 'http://127.0.0.1:4173/'
const screenshotPath = 'test/artifacts/a3-deck-media-check.png'
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
const errors = []

page.on('console', message => {
  if (message.type() === 'error') errors.push(message.text())
})
page.on('pageerror', error => errors.push(error.message))

try {
  await page.goto(`${baseUrl}?record=0#scene-01`, { waitUntil: 'networkidle' })
  await page.waitForSelector('.slide.is-active[data-scene="01"][data-kind="content"]')

  const structure = await page.evaluate(() => ({
    slides: document.querySelectorAll('.slide').length,
    narrationPaths: document.querySelectorAll('.slide[data-narration]').length,
    audioElements: document.querySelectorAll('.slide-narration').length,
    videos: document.querySelectorAll('.v8-video').length,
  }))

  const initialAudioPaused = await page.evaluate(() => (
    document.querySelector('.slide.is-active .slide-narration')?.paused
  ))
  if (initialAudioPaused) await page.click('#narration')
  await page.waitForFunction(() => {
    const audio = document.querySelector('.slide.is-active .slide-narration')
    return audio && !audio.paused && audio.currentTime > 0.2
  })
  const contentPlayback = await page.evaluate(() => {
    const slide = document.querySelector('.slide.is-active')
    const audio = slide?.querySelector('.slide-narration')
    return {
      paused: audio?.paused,
      currentTime: audio?.currentTime,
      buttonPressed: document.querySelector('#narration')?.getAttribute('aria-pressed'),
    }
  })

  await page.click('#next')
  await page.waitForSelector('.slide.is-active[data-scene="01"][data-kind="video"]')
  await page.waitForFunction(() => document.querySelector('.slide.is-active .v8-video-stage')?.classList.contains('is-ready'))
  await page.waitForFunction(() => {
    const slide = document.querySelector('.slide.is-active')
    const audio = slide?.querySelector('.slide-narration')
    const video = slide?.querySelector('.v8-video')
    return audio && video && !audio.paused && audio.currentTime > 0.2 && !video.paused
  })
  const videoPlayback = await page.evaluate(() => {
    const slide = document.querySelector('.slide.is-active')
    const audio = slide?.querySelector('.slide-narration')
    const video = slide?.querySelector('.v8-video')
    return {
      audioPaused: audio?.paused,
      audioTime: audio?.currentTime,
      videoPaused: video?.paused,
      videoTime: video?.currentTime,
      videoMuted: video?.muted,
      narrationStatus: document.querySelector('#narrationStatus')?.textContent,
    }
  })

  await page.click('#next')
  await page.waitForSelector('.slide.is-active[data-scene="22"][data-kind="video"]')
  await page.click('#next')
  await page.waitForSelector('.slide.is-active[data-scene="23"][data-kind="content"]')
  await page.waitForFunction(() => {
    const audio = document.querySelector('.slide.is-active .slide-narration')
    return audio && !audio.paused && audio.currentTime > 0.2
  })
  const nextContentPlayback = await page.evaluate(() => {
    const audio = document.querySelector('.slide.is-active .slide-narration')
    return {
      paused: audio?.paused,
      currentTime: audio?.currentTime,
    }
  })

  await mkdir('test/artifacts', { recursive: true })
  await page.screenshot({ path: screenshotPath, fullPage: true })

  const result = {
    structure,
    contentPlayback,
    videoPlayback,
    nextContentPlayback,
    errors,
    screenshotPath,
  }
  console.log(JSON.stringify(result, null, 2))

  const passed =
    structure.slides === 27 &&
    structure.narrationPaths === 27 &&
    structure.audioElements === 27 &&
    structure.videos === 16 &&
    contentPlayback.paused === false &&
    contentPlayback.buttonPressed === 'true' &&
    videoPlayback.audioPaused === false &&
    videoPlayback.videoPaused === false &&
    videoPlayback.videoMuted === true &&
    nextContentPlayback.paused === false &&
    errors.length === 0

  if (!passed) process.exitCode = 1
} finally {
  await browser.close()
}
