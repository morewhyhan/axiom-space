import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

const root = process.cwd()
const artifactDir = path.join(root, 'test', 'artifacts', 'a3-recording-smoke')

async function main() {
  await mkdir(artifactDir, { recursive: true })

  const browser = await chromium.launch({
    headless: true,
  })
  const context = await browser.newContext({
    viewport: { width: 2560, height: 1440 },
    recordVideo: {
      dir: artifactDir,
      size: { width: 2560, height: 1440 },
    },
  })

  const page = await context.newPage()
  await page.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)

  const register = page.getByRole('button', { name: '注册' })
  await register.click()
  await page.waitForTimeout(2500)

  await page.getByPlaceholder('你的名字').fill('小林')
  await page.getByPlaceholder('you@example.com').fill(`a3-video-smoke-${Date.now()}@axiom.space`)
  await page.getByPlaceholder('至少 8 位').fill('demo123456')
  await page.getByPlaceholder('再次输入密码').fill('demo123456')
  await page.waitForTimeout(3000)

  const video = page.video()
  await context.close()
  await browser.close()

  const videoPath = video ? await video.path() : null
  console.log(JSON.stringify({ artifactDir, videoPath }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
