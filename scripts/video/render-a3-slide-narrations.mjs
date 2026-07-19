import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import {
  A3_NARRATION_PITCH,
  A3_NARRATION_RATE,
  A3_NARRATION_VOICE,
  A3_NARRATION_VOLUME,
  A3_SLIDE_NARRATIONS,
} from './a3-slide-narration-manifest.mjs'

const root = process.cwd()
const pythonModules = path.resolve(root, 'test/artifacts/a3-tts-python')
const outputDir = path.resolve(root, 'local-tests/a3-golden-video-card/assets/audio')
const selected = new Set(
  (process.env.A3_NARRATION_SLIDES || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
)

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk.toString() })
    child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve(stdout.trim())
      else reject(new Error(`${command} exited ${code}\n${stderr}`))
    })
  })
}

async function duration(filePath) {
  const value = await run('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=nokey=1:noprint_wrappers=1',
    filePath,
  ])
  return Number.parseFloat(value)
}

async function renderNarration(item) {
  const audioPath = path.join(outputDir, item.fileName)
  const subtitlePath = path.join(outputDir, item.fileName.replace(/\.mp3$/i, '.vtt'))
  const rawAudioPath = path.join(outputDir, item.fileName.replace(/\.mp3$/i, '.raw.mp3'))
  const rawSubtitlePath = path.join(outputDir, item.fileName.replace(/\.mp3$/i, '.raw.vtt'))

  await run('python3', [
    '-m', 'edge_tts',
    '--voice', A3_NARRATION_VOICE,
    `--rate=${A3_NARRATION_RATE}`,
    `--pitch=${A3_NARRATION_PITCH}`,
    `--volume=${A3_NARRATION_VOLUME}`,
    '--text', item.text,
    '--write-media', rawAudioPath,
    '--write-subtitles', rawSubtitlePath,
  ], {
    env: {
      ...process.env,
      PYTHONPATH: pythonModules,
    },
  })

  await run('ffmpeg', [
    '-y',
    '-i', rawAudioPath,
    '-af', 'loudnorm=I=-16:LRA=7:TP=-1.5,aresample=48000',
    '-ar', '48000',
    '-ac', '1',
    '-b:a', '96k',
    audioPath,
  ])
  await rm(subtitlePath, { force: true })
  await rename(rawSubtitlePath, subtitlePath)
  await rm(rawAudioPath, { force: true })

  return {
    id: item.id,
    scene: item.scene,
    kind: item.kind,
    fileName: item.fileName,
    audioPath,
    subtitlePath,
    seconds: await duration(audioPath),
    text: item.text,
  }
}

async function main() {
  const expectedSlideCount = 27
  if (A3_SLIDE_NARRATIONS.length !== expectedSlideCount) {
    throw new Error(`Expected ${expectedSlideCount} slide narrations, received ${A3_SLIDE_NARRATIONS.length}`)
  }
  const ids = new Set(A3_SLIDE_NARRATIONS.map((item) => item.id))
  const fileNames = new Set(A3_SLIDE_NARRATIONS.map((item) => item.fileName))
  if (ids.size !== expectedSlideCount || fileNames.size !== expectedSlideCount) {
    throw new Error('Narration ids and filenames must be unique')
  }

  await mkdir(outputDir, { recursive: true })
  const report = []

  for (const item of A3_SLIDE_NARRATIONS) {
    if (selected.size && !selected.has(item.id)) continue
    const rendered = await renderNarration(item)
    report.push(rendered)
    console.log(`[a3-narration] ${item.id} ${rendered.seconds.toFixed(1)}s`)
  }

  const totalSeconds = report.reduce((total, item) => total + item.seconds, 0)
  const summary = {
    success: true,
    slides: report.length,
    totalSeconds,
    voice: A3_NARRATION_VOICE,
    rate: A3_NARRATION_RATE,
    pitch: A3_NARRATION_PITCH,
    volume: A3_NARRATION_VOLUME,
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
