import { mkdir } from 'node:fs/promises'
import { chromium } from '@playwright/test'

const baseUrl = process.env.A3_DECK_URL || 'http://127.0.0.1:4173/'
const browser = await chromium.launch({ headless: true })
const viewports = [
  { name: 'desktop', width: 1920, height: 1080 },
  { name: 'compact', width: 1366, height: 768 },
]
const errors = []
const results = []

await mkdir('test/artifacts/a3-story', { recursive: true })

try {
  for (const viewport of viewports) {
    const page = await browser.newPage({
      viewport: { width: viewport.width, height: viewport.height },
    })
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(`${viewport.name}: ${message.text()}`)
    })
    page.on('pageerror', (error) => errors.push(`${viewport.name}: ${error.message}`))

    await page.goto(`${baseUrl}?record=0&videos=0&autoplay=0#scene-01`, {
      waitUntil: 'networkidle',
    })
    await page.waitForSelector('.slide.is-active.has-story-copy')

    const structure = await page.evaluate(() => {
      const videoSlides = [...document.querySelectorAll('.slide[data-kind="video"]')]
      return {
      slides: document.querySelectorAll('.slide').length,
      storySlides: document.querySelectorAll('.slide.has-story-copy').length,
      summaries: document.querySelectorAll('.v8-story-summary').length,
      completeVideoCopy: videoSlides.filter((slide) => {
        const kicker = slide.querySelector('.v8-kicker')?.textContent.trim() || ''
        const heading = slide.querySelector('.v8-title')?.textContent.trim() || ''
        const summary = slide.querySelector('.v8-story-summary')?.textContent.trim() || ''
        const footer = slide.querySelector('.foot > span:first-child')?.textContent.trim() || ''
        return kicker.length >= 10 && heading.length >= 12 && summary.length >= 20 && footer.length >= 10
      }).length,
      audienceNarrations: videoSlides.filter((slide) => {
        const text = slide.querySelector('.notes')?.textContent.trim() || ''
        return /小林|系统|AXIOM|证据|卡片|路径|评估|学习/.test(text) && text.length >= 30
      }).length,
      uniqueVideoKickers: new Set(videoSlides.map((slide) => (
        slide.querySelector('.v8-kicker')?.textContent.trim()
      ))).size,
      rigidVideoLabels: videoSlides.filter((slide) => (
        /AXIOM 的解法|AXIOM 的最终解法|达成结果|主链结果|当前产品结果|产品实录证据层/.test(slide.textContent)
      )).length,
      styleRuleCount: [...document.styleSheets].reduce((total, stylesheet) => {
        try {
          return total + stylesheet.cssRules.length
        } catch {
          return total
        }
      }, 0),
      controlsPosition: getComputedStyle(document.querySelector('.controls')).position,
      documentHeight: document.documentElement.scrollHeight,
      viewportHeight: window.innerHeight,
      phases: new Set(
        [...document.querySelectorAll('.slide .chrome span:last-child')]
          .map((element) => element.textContent.trim()),
      ).size,
      firstHeading: document.querySelector('.slide[data-scene="01"][data-kind="content"] .v8-title')?.textContent.trim(),
      firstSummary: document.querySelector('.slide[data-scene="01"][data-kind="content"] .v8-story-summary')?.textContent.trim(),
      finalHeading: document.querySelector('.slide[data-scene="13"][data-kind="content"] .v8-title')?.textContent.trim(),
      finalSummary: document.querySelector('.slide[data-scene="13"][data-kind="content"] .v8-story-summary')?.textContent.trim(),
    }
    })

    const slides = []
    for (let index = 0; index < 27; index += 1) {
      if (index > 0) await page.click('#next')
      await page.waitForFunction((expected) => (
        document.querySelector('.slide.is-active')?.dataset.page === String(expected)
      ), index + 1)

      const state = await page.evaluate(() => {
        const slide = document.querySelector('.slide.is-active')
        const frame = slide?.querySelector('.frame')?.getBoundingClientRect()
        const pageBox = slide?.querySelector('.v8-page')?.getBoundingClientRect()
        const title = slide?.querySelector('.v8-title')?.getBoundingClientRect()
        const summary = slide?.querySelector('.v8-story-summary')?.getBoundingClientRect()
        const footer = slide?.querySelector('.foot')?.getBoundingClientRect()
        const overlaps = Boolean(
          title &&
          summary &&
          title.bottom > summary.top + 1
        )
        const inFrame = [pageBox, title, summary, footer].every((box) => (
          !box ||
          !frame ||
          (
            box.left >= frame.left - 1 &&
            box.right <= frame.right + 1 &&
            box.top >= frame.top - 1 &&
            box.bottom <= frame.bottom + 1
          )
        ))
        return {
          page: slide?.dataset.page,
          scene: slide?.dataset.scene,
          kind: slide?.dataset.kind,
          title: slide?.querySelector('.v8-title')?.textContent.trim(),
          summary: slide?.querySelector('.v8-story-summary')?.textContent.trim(),
          overlaps,
          inFrame,
        }
      })
      slides.push(state)

      if ([1, 2, 3, 4, 5, 6, 7, 12, 15, 18, 20, 23, 24, 25, 26, 27].includes(index + 1)) {
        await page.screenshot({
          path: `test/artifacts/a3-story/${viewport.name}-${String(index + 1).padStart(2, '0')}.png`,
          fullPage: true,
        })
      }
    }

    results.push({ viewport, structure, slides })
    await page.close()
  }

  const invalidSlides = results.flatMap((result) => (
    result.slides
      .filter((slide) => (
        !slide.title ||
        !slide.summary ||
        slide.overlaps ||
        !slide.inFrame
      ))
      .map((slide) => ({ viewport: result.viewport.name, ...slide }))
  ))
  const structuresValid = results.every(({ structure }) => (
    structure.slides === 27 &&
    structure.storySlides === 27 &&
    structure.summaries === 27 &&
    structure.completeVideoCopy === 16 &&
    structure.audienceNarrations === 16 &&
    structure.uniqueVideoKickers === 16 &&
    structure.rigidVideoLabels === 0 &&
    structure.styleRuleCount > 300 &&
    structure.controlsPosition === 'fixed' &&
    structure.documentHeight <= structure.viewportHeight + 4 &&
    structure.phases === 8 &&
    structure.firstHeading?.includes('通用 Agent') &&
    structure.firstSummary?.includes('因果模型') &&
    structure.finalHeading?.includes('真正懂他的 AI') &&
    structure.finalSummary?.includes('一对一指导')
  ))
  const report = {
    success: structuresValid && invalidSlides.length === 0 && errors.length === 0,
    structuresValid,
    structures: results.map(({ viewport, structure }) => ({ viewport: viewport.name, structure })),
    invalidSlides,
    errors,
    screenshots: 'test/artifacts/a3-story',
  }

  console.log(JSON.stringify(report, null, 2))
  if (!report.success) process.exitCode = 1
} finally {
  await browser.close()
}
