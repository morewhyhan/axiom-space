import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import {
  A3_V21_LOCAL_FALLBACK_RATE,
  A3_V21_LOCAL_FALLBACK_VOICE,
  A3_V21_NARRATIONS,
} from './a3-v21-narration-manifest.mjs'

const root = process.cwd()
const outputDir = path.resolve(root, 'local-tests/a3-v21-promo-ppt/assets/audio')
const synthScript = path.resolve(root, 'scripts/video/synthesize-onecore.ps1')
const powershellBin = process.env.A3_V21_POWERSHELL || 'powershell.exe'
const ffmpegBin = process.env.A3_V21_FFMPEG || 'ffmpeg'
const voice = process.env.A3_V21_LOCAL_VOICE || A3_V21_LOCAL_FALLBACK_VOICE
const speakingRate = process.env.A3_V21_LOCAL_RATE || String(A3_V21_LOCAL_FALLBACK_RATE)
const selected = new Set(
  (process.env.A3_V21_NARRATION_SLIDES || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
)

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

async function duration(filePath) {
  const result = await run(ffmpegBin, [
    '-hide_banner',
    '-i', filePath,
    '-f', 'null',
    '-',
  ])
  const match = result.stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/)
  if (!match) throw new Error(`Unable to read audio duration for ${filePath}`)
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
}

function timestamp(seconds) {
  const safe = Math.max(0, seconds)
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const remainder = safe % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${remainder.toFixed(3).padStart(6, '0')}`
}

function subtitles(text, seconds) {
  const sentences = text
    .split(/(?<=[。！？；])/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
  const totalWeight = sentences.reduce((sum, sentence) => sum + sentence.length, 0) || 1
  let cursor = 0
  const cues = sentences.map((sentence, index) => {
    const isLast = index === sentences.length - 1
    const length = isLast ? seconds - cursor : seconds * sentence.length / totalWeight
    const end = Math.min(seconds, cursor + length)
    const cue = `${timestamp(cursor)} --> ${timestamp(end)}\n${sentence}`
    cursor = end
    return cue
  })
  return `WEBVTT\n\n${cues.join('\n\n')}\n`
}

async function renderNarration(item) {
  const audioPath = path.join(outputDir, item.fileName)
  const subtitlePath = audioPath.replace(/\.mp3$/i, '.vtt')
  const rawAudioPath = audioPath.replace(/\.mp3$/i, '.onecore.wav')

  await run(powershellBin, [
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', synthScript,
    '-Text', item.text,
    '-OutputPath', rawAudioPath,
    '-VoiceDisplayName', voice,
    '-SpeakingRate', speakingRate,
  ])
  await run(ffmpegBin, [
    '-y',
    '-i', rawAudioPath,
    '-af', 'loudnorm=I=-16:LRA=7:TP=-1.5,aresample=48000',
    '-ar', '48000',
    '-ac', '1',
    '-b:a', '112k',
    audioPath,
  ])
  await rm(rawAudioPath, { force: true })
  const seconds = await duration(audioPath)
  await writeFile(subtitlePath, subtitles(item.text, seconds), 'utf8')
  return {
    id: item.id,
    title: item.title,
    fileName: item.fileName,
    targetSeconds: item.targetSeconds,
    seconds,
    deltaSeconds: seconds - item.targetSeconds,
    text: item.text,
  }
}

async function main() {
  if (A3_V21_NARRATIONS.length !== 17) {
    throw new Error(`Expected 17 narrations, received ${A3_V21_NARRATIONS.length}`)
  }
  await mkdir(outputDir, { recursive: true })
  const report = []
  for (const item of A3_V21_NARRATIONS) {
    if (selected.size && !selected.has(item.id)) continue
    const rendered = await renderNarration(item)
    report.push(rendered)
    console.log(`[a3-v21-local] ${item.id} ${rendered.seconds.toFixed(1)}s / target ${item.targetSeconds}s`)
  }
  const summary = {
    success: true,
    engine: 'Windows OneCore offline',
    voice,
    speakingRate: Number(speakingRate),
    slides: report.length,
    totalSeconds: report.reduce((sum, item) => sum + item.seconds, 0),
    report,
  }
  if (!selected.size) {
    await writeFile(
      path.join(outputDir, 'narration-manifest.json'),
      `${JSON.stringify(summary, null, 2)}\n`,
      'utf8',
    )
  }
  console.log(JSON.stringify(summary, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
