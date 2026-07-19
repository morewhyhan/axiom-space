import { mkdir, rename } from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import {
  A3_VOICE,
  A3_VOICEOVERS,
  A3_VOICE_PITCH,
  A3_VOICE_RATE,
} from './a3-voiceover-manifest.mjs'

const root = process.cwd()
const pythonModules = path.resolve(root, 'test/artifacts/a3-tts-python')
const audioDir = path.resolve(root, 'test/artifacts/a3-voiceovers')
const rawVideoDir = path.resolve(root, 'test/artifacts/a3-cap-raw')
const outputDir = path.resolve(root, 'local-tests/a3-golden-video-card/assets/videos')
const mode = process.env.A3_VOICE_MODE || 'all'
const selected = new Set(
  (process.env.A3_VOICE_SCENES || '')
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
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
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

async function generateVoiceover(scene) {
  const stem = path.parse(scene.fileName).name
  const audioPath = path.join(audioDir, `${stem}.mp3`)
  const subtitlePath = path.join(audioDir, `${stem}.vtt`)
  await run('python3', [
    '-m', 'edge_tts',
    '--voice', A3_VOICE,
    `--rate=${A3_VOICE_RATE}`,
    `--pitch=${A3_VOICE_PITCH}`,
    '--text', scene.text,
    '--write-media', audioPath,
    '--write-subtitles', subtitlePath,
  ], {
    env: {
      ...process.env,
      PYTHONPATH: pythonModules,
    },
  })
  return { audioPath, subtitlePath, seconds: await duration(audioPath) }
}

async function muxVoiceover(scene) {
  const stem = path.parse(scene.fileName).name
  const rawPath = path.join(rawVideoDir, scene.fileName)
  const audioPath = path.join(audioDir, `${stem}.mp3`)
  const outputPath = path.join(outputDir, scene.fileName)
  const tempPath = path.join(outputDir, `${stem}.voiced.mp4`)
  const [videoSeconds, audioSeconds] = await Promise.all([
    duration(rawPath),
    duration(audioPath),
  ])
  const startSeconds = Math.min(
    Math.max(0, scene.startSeconds || 0),
    Math.max(0, videoSeconds - 0.1),
  )
  const targetSeconds = audioSeconds + 1
  const usableVideoSeconds = Math.max(0, videoSeconds - startSeconds)
  const videoPadding = Math.max(0, targetSeconds - usableVideoSeconds)

  await run('ffmpeg', [
    '-y',
    '-i', rawPath,
    '-i', audioPath,
    '-filter_complex',
    `[0:v]trim=start=${startSeconds.toFixed(3)},setpts=PTS-STARTPTS,scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:black,fps=30,tpad=stop_mode=clone:stop_duration=${videoPadding.toFixed(3)},format=yuv420p[v];[1:a]adelay=500|500,loudnorm=I=-16:TP=-1.5:LRA=7,apad=pad_dur=${targetSeconds.toFixed(3)}[a]`,
    '-map', '[v]',
    '-map', '[a]',
    '-t', targetSeconds.toFixed(3),
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '21',
    '-c:a', 'aac',
    '-b:a', '160k',
    '-movflags', '+faststart',
    tempPath,
  ])
  await rename(tempPath, outputPath)
  return {
    outputPath,
    startSeconds,
    seconds: await duration(outputPath),
  }
}

async function main() {
  await Promise.all([
    mkdir(audioDir, { recursive: true }),
    mkdir(rawVideoDir, { recursive: true }),
    mkdir(outputDir, { recursive: true }),
  ])

  const report = []
  for (const scene of A3_VOICEOVERS) {
    if (selected.size && !selected.has(scene.id)) continue
    const item = { id: scene.id, fileName: scene.fileName }
    if (mode === 'all' || mode === 'generate') {
      item.voiceover = await generateVoiceover(scene)
    }
    if (mode === 'all' || mode === 'mux') {
      item.video = await muxVoiceover(scene)
    }
    report.push(item)
    console.log(`[a3-voiceover] scene ${scene.id} complete`)
  }

  console.log(JSON.stringify({ success: true, mode, report }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
