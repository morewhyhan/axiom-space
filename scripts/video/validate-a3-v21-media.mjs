import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..', '..')
const htmlPath = resolve(repoRoot, 'local-tests', 'a3-v21-promo-ppt', 'index.html')
const html = readFileSync(htmlPath, 'utf8')

const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].map((match) => ({
  attributes: match[1],
  source: match[2],
}))
const syntaxErrors = []
scripts.forEach(({ attributes, source }, index) => {
  if (/\bsrc\s*=/.test(attributes)) return
  try {
    if (/\btype\s*=\s*["']module["']/.test(attributes)) {
      Function(`return (async () => {\n${source}\n})`)
    } else {
      Function(source)
    }
  } catch (error) {
    syntaxErrors.push({ script: index + 1, error: error instanceof Error ? error.message : String(error) })
  }
})

const mediaRefs = [...html.matchAll(/data-video-src="([^"]*)"/g)]
  .flatMap((match) => match[1].split('|'))
  .map((source) => source.trim())
  .filter(Boolean)

const media = [...new Set(mediaRefs)].map((source) => {
  const absolutePath = resolve(dirname(htmlPath), source)
  const exists = existsSync(absolutePath)
  return { source, exists, size: exists ? statSync(absolutePath).size : 0 }
})

const readAttribute = (attributes, name) => {
  const match = attributes.match(new RegExp(`\\b${name}="([^"]*)"`))
  return match ? match[1] : ''
}

const copyMismatches = []
const phaseSyncMismatches = []
for (const match of html.matchAll(/<section\b([^>]*)>([\s\S]*?)<\/section>/gi)) {
  const attributes = match[1]
  const body = match[2]
  const id = readAttribute(attributes, 'id') || '(unknown section)'
  const clips = readAttribute(attributes, 'data-video-src').split('|').map((value) => value.trim()).filter(Boolean)
  if (!clips.length) continue

  const captions = readAttribute(attributes, 'data-video-captions').split('||').map((value) => value.trim()).filter(Boolean)
  if (captions.length && captions.length !== clips.length) {
    copyMismatches.push({ id, clips: clips.length, captions: captions.length })
  }

  if (readAttribute(attributes, 'data-phase-sync') === 'clip') {
    const phases = [...body.matchAll(/class="([^"]*)"/g)]
      .filter((classMatch) => classMatch[1].split(/\s+/).includes('phase')).length
    if (phases !== clips.length) phaseSyncMismatches.push({ id, clips: clips.length, phases })
  }
}

const report = {
  htmlPath,
  inlineScripts: scripts.length,
  syntaxErrors,
  mediaCount: media.length,
  missingMedia: media.filter((item) => !item.exists),
  emptyMedia: media.filter((item) => item.exists && item.size < 100_000),
  copyMismatches,
  phaseSyncMismatches,
}

console.log(JSON.stringify(report, null, 2))
if (syntaxErrors.length || report.missingMedia.length || report.emptyMedia.length || copyMismatches.length || phaseSyncMismatches.length) process.exitCode = 1
