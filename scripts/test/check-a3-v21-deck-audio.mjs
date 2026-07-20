import { access, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { A3_V21_NARRATIONS } from '../video/a3-v21-narration-manifest.mjs'

const root = process.cwd()
const deckDir = path.resolve(root, 'local-tests/a3-v21-promo-ppt')
const audioDir = path.join(deckDir, 'assets/audio')
const ffmpegBin = process.env.A3_V21_FFMPEG || 'ffmpeg'

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk.toString() })
    child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout: stdout.trim(), stderr: stderr.trim() })
      else reject(new Error(`${command} exited ${code}\n${stderr}`))
    })
  })
}

async function inspectAudio(item) {
  const audioPath = path.join(audioDir, item.fileName)
  const subtitlePath = audioPath.replace(/\.mp3$/i, '.vtt')
  await Promise.all([access(audioPath), access(subtitlePath)])
  const [metadataResult, audioStat, subtitleStat] = await Promise.all([
    run(ffmpegBin, [
      '-hide_banner',
      '-i', audioPath,
      '-f', 'null',
      '-',
    ]),
    stat(audioPath),
    stat(subtitlePath),
  ])
  const durationMatch = metadataResult.stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/)
  const audioMatch = metadataResult.stderr.match(/Audio:\s*([^,]+),\s*(\d+)\s*Hz,\s*([^,]+)/)
  const seconds = durationMatch
    ? Number(durationMatch[1]) * 3600 + Number(durationMatch[2]) * 60 + Number(durationMatch[3])
    : Number.NaN
  return {
    id: item.id,
    fileName: item.fileName,
    bytes: audioStat.size,
    subtitleBytes: subtitleStat.size,
    seconds,
    targetSeconds: item.targetSeconds,
    codec: audioMatch?.[1]?.trim(),
    sampleRate: Number.parseInt(audioMatch?.[2], 10),
    channels: audioMatch?.[3]?.trim() === 'mono' ? 1 : 2,
  }
}

if (A3_V21_NARRATIONS.length !== 17) {
  throw new Error(`Expected 17 narration entries, received ${A3_V21_NARRATIONS.length}`)
}

const html = await readFile(path.join(deckDir, 'index.html'), 'utf8')
const htmlAudioPaths = [...html.matchAll(/data-narration="\.\/assets\/audio\/([^"]+)"/g)]
  .map((match) => match[1])
const expectedFiles = A3_V21_NARRATIONS.map((item) => item.fileName)
const missingHtmlAudio = expectedFiles.filter((fileName) => !htmlAudioPaths.includes(fileName))
if (htmlAudioPaths.length !== 17 || new Set(htmlAudioPaths).size !== 17 || missingHtmlAudio.length) {
  throw new Error(`HTML narration bindings are incomplete: ${missingHtmlAudio.join(', ') || htmlAudioPaths.length}`)
}
if (!html.includes('id="narrationAudio"') || !html.includes('window.__syncNarration')) {
  throw new Error('Narration player or slide synchronization hook is missing')
}
if (!html.includes('id="narrationControl"') || !html.includes('autoplay playsinline hidden')) {
  throw new Error('Narration must keep both the manual control and automatic playback')
}

const classicScripts = [...html.matchAll(/<script(?![^>]*type="module")(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
  .map((match) => match[1].trim())
  .filter(Boolean)
classicScripts.forEach((source, index) => {
  try { new Function(source) }
  catch (error) { throw new Error(`Classic script ${index + 1} has invalid syntax: ${error.message}`) }
})

const report = []
for (const item of A3_V21_NARRATIONS) report.push(await inspectAudio(item))
const invalid = report.filter((item) => (
  item.bytes < 40_000 ||
  item.subtitleBytes < 80 ||
  !Number.isFinite(item.seconds) ||
  item.seconds < 6 ||
  item.seconds > 62 ||
  !item.codec?.startsWith('mp3') ||
  item.sampleRate !== 48_000 ||
  item.channels !== 1
))
const totalSeconds = report.reduce((sum, item) => sum + item.seconds, 0)
const result = {
  success: invalid.length === 0 && totalSeconds >= 360 && totalSeconds < 420,
  slides: report.length,
  totalSeconds,
  shortestSeconds: Math.min(...report.map((item) => item.seconds)),
  longestSeconds: Math.max(...report.map((item) => item.seconds)),
  invalid,
  report,
}

console.log(JSON.stringify(result, null, 2))
if (!result.success) process.exitCode = 1
