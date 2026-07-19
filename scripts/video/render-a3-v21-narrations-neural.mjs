import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import {
  A3_V21_NARRATION_ENGINE,
  A3_V21_NARRATION_PITCH,
  A3_V21_NARRATION_RATE,
  A3_V21_NARRATION_VOICE,
  A3_V21_NARRATION_VOLUME,
  A3_V21_NARRATIONS,
} from './a3-v21-narration-manifest.mjs'

const root = process.cwd()
const pythonModules = path.resolve(root, 'test/artifacts/a3-tts-python')
const outputDir = path.resolve(
  root,
  process.env.A3_V21_NARRATION_OUTPUT_DIR || 'local-tests/a3-v21-promo-ppt/assets/audio',
)
const selected = new Set(
  (process.env.A3_V21_NARRATION_SLIDES || '')
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
      if (code === 0) resolve({ stdout: stdout.trim(), stderr: stderr.trim() })
      else reject(new Error(`${command} exited ${code}\n${stderr}`))
    })
  })
}

async function duration(filePath) {
  const { stdout } = await run('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=nokey=1:noprint_wrappers=1',
    filePath,
  ])
  return Number.parseFloat(stdout)
}

async function renderNarration(item) {
  const audioPath = path.join(outputDir, item.fileName)
  const subtitlePath = audioPath.replace(/\.mp3$/i, '.vtt')
  const rawAudioPath = audioPath.replace(/\.mp3$/i, '.neural.raw.mp3')
  const rawSubtitlePath = audioPath.replace(/\.mp3$/i, '.neural.raw.vtt')

  await run('python3', [
    '-m', 'edge_tts',
    '--voice', A3_V21_NARRATION_VOICE,
    `--rate=${A3_V21_NARRATION_RATE}`,
    `--pitch=${A3_V21_NARRATION_PITCH}`,
    `--volume=${A3_V21_NARRATION_VOLUME}`,
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
    '-b:a', '128k',
    audioPath,
  ])
  await rm(subtitlePath, { force: true })
  await rename(rawSubtitlePath, subtitlePath)
  await rm(rawAudioPath, { force: true })

  return {
    id: item.id,
    title: item.title,
    fileName: item.fileName,
    audioPath,
    subtitlePath,
    seconds: await duration(audioPath),
    targetSeconds: item.targetSeconds,
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
    console.log(`[a3-v21-neural] ${item.id} ${rendered.seconds.toFixed(2)}s / target ${item.targetSeconds}s`)
  }

  const summary = {
    success: true,
    externalService: 'Microsoft Edge neural TTS',
    engine: A3_V21_NARRATION_ENGINE,
    voice: A3_V21_NARRATION_VOICE,
    rate: A3_V21_NARRATION_RATE,
    pitch: A3_V21_NARRATION_PITCH,
    volume: A3_V21_NARRATION_VOLUME,
    slides: report.length,
    totalSeconds: report.reduce((sum, item) => sum + item.seconds, 0),
    report,
  }
  await writeFile(
    path.join(outputDir, selected.size ? 'narration-preview-manifest.json' : 'narration-manifest.json'),
    `${JSON.stringify(summary, null, 2)}\n`,
    'utf8',
  )
  console.log(JSON.stringify(summary, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
