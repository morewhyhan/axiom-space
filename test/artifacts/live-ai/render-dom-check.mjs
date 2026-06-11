import { chromium } from '@playwright/test'
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 2200 } })
const errors = []
page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })
page.on('pageerror', err => errors.push(err.message))
await page.goto('http://127.0.0.1:3000/render-check-ai', { waitUntil: 'networkidle', timeout: 60000 })
await page.screenshot({ path: 'test/artifacts/live-ai/render-check-fullpage.png', fullPage: true })
const result = await page.evaluate(() => {
  const text = document.body.innerText
  return {
    title: text.includes('Graph Search Basics'),
    resourceCountLabel: text.includes('7 items') || text.includes('Resources: 7'),
    renderedResourceCards: Array.from(document.querySelectorAll('button[title="放大查看"]')).length,
    mermaidError: text.includes('Mermaid 渲染失败'),
    svgCount: document.querySelectorAll('svg').length,
    iframeCount: document.querySelectorAll('iframe').length,
    videoCard: text.includes('教学视频') && text.includes('video.html'),
    quizAnswer: text.includes('答案：'),
    codeVisible: text.includes('class Graph'),
    documentVisible: text.includes('核心概念'),
    diagramVisible: text.includes('Mermaid 图表'),
    svgVisible: text.includes('SVG 图解') || text.includes('diagram.svg'),
    provenanceVisible: text.includes('DB ready') && text.includes('hash'),
    bodyLength: text.length,
  }
})
console.log(JSON.stringify({ result, errors }, null, 2))
await browser.close()
