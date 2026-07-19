import { access, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { A3_SLIDE_NARRATIONS } from '../video/a3-slide-narration-manifest.mjs'

const root = process.cwd()
const deckPath = path.resolve(root, 'local-tests/a3-golden-video-card')
const audioDir = path.join(deckPath, 'assets/audio')

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
    run('ffprobe', [
      '-v', 'error',
      '-show_entries', 'stream=codec_name,sample_rate,channels:format=duration',
      '-of', 'json',
      audioPath,
    ]),
    stat(audioPath),
    stat(subtitlePath),
  ])
  await run('ffmpeg', ['-v', 'error', '-i', audioPath, '-f', 'null', '-'])

  const metadata = JSON.parse(metadataResult.stdout)
  const stream = metadata.streams?.[0] || {}
  return {
    id: item.id,
    fileName: item.fileName,
    bytes: audioStat.size,
    subtitleBytes: subtitleStat.size,
    seconds: Number.parseFloat(metadata.format?.duration),
    codec: stream.codec_name,
    sampleRate: Number.parseInt(stream.sample_rate, 10),
    channels: stream.channels,
  }
}

const expectedSlideCount = 27

if (A3_SLIDE_NARRATIONS.length !== expectedSlideCount) {
  throw new Error(`Expected ${expectedSlideCount} narration entries, received ${A3_SLIDE_NARRATIONS.length}`)
}

const html = await readFile(path.join(deckPath, 'index.html'), 'utf8')
const htmlAudioPaths = [...html.matchAll(/data-narration="assets\/audio\/([^"]+)"/g)]
  .map((match) => match[1])
const expectedFiles = A3_SLIDE_NARRATIONS.map((item) => item.fileName)

const missingHtmlAudio = expectedFiles.filter((fileName) => !htmlAudioPaths.includes(fileName))
if (missingHtmlAudio.length) {
  throw new Error(`HTML is missing active narration paths: ${missingHtmlAudio.join(', ')}`)
}

const report = []
for (const item of A3_SLIDE_NARRATIONS) report.push(await inspectAudio(item))

const invalid = report.filter((item) => (
  item.bytes < 50_000 ||
  item.subtitleBytes < 100 ||
  !Number.isFinite(item.seconds) ||
  item.seconds < 8 ||
  item.seconds > 45 ||
  item.codec !== 'mp3' ||
  item.sampleRate !== 48_000 ||
  item.channels !== 1
))
const totalSeconds = report.reduce((total, item) => total + item.seconds, 0)
const result = {
  success: invalid.length === 0,
  slides: report.length,
  totalSeconds,
  shortestSeconds: Math.min(...report.map((item) => item.seconds)),
  longestSeconds: Math.max(...report.map((item) => item.seconds)),
  invalid,
  report,
}

console.log(JSON.stringify(result, null, 2))
if (invalid.length) process.exitCode = 1
