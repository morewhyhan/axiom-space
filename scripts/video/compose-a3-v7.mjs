import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { sections } from './a3-v7-narration.mjs'

const root = resolve('.')
const work = resolve(root, 'test/artifacts/a3-golden-final')
const assets = resolve(root, 'local-tests/a3-golden-video-card/assets')
const narration = resolve(work, 'narration')
const sectionDir = resolve(work, 'sections')
mkdirSync(sectionDir, { recursive: true })

const raw = n => resolve(assets, `scene-0${n}-${['', 'profile', 'import', 'forge', 'resources', 'galaxy', 'mature-vault'][n]}.mp4`)
const specs = [
  [{ file: raw(3), ss: 36 }],
  [{ file: raw(1), ss: 48 }],
  [{ file: raw(2), ss: 48 }],
  [{ file: raw(3), ss: 18 }],
  [{ file: raw(4), ss: 48 }],
  [{ file: raw(5), ss: 48 }],
  [{ file: raw(6), ss: 48 }],
  [{ file: raw(3), ss: 70 }, { file: raw(4), ss: 92 }, { file: raw(5), ss: 92 }, { file: raw(6), ss: 120 }],
  [{ file: raw(1), ss: 92 }, { file: raw(5), ss: 125 }, { file: raw(6), ss: 170 }]
]

function run(args) {
  console.log(`ffmpeg ${args.join(' ')}`)
  const result = spawnSync('ffmpeg', args, { stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function duration(path) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', path], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`Cannot probe ${path}`)
  return Number(r.stdout.trim())
}

const durations = sections.map(section => duration(resolve(narration, `${section.id}.wav`)))

for (let index = 0; index < sections.length; index += 1) {
  const target = durations[index]
  const parts = specs[index]
  const each = target / parts.length
  const inputs = []
  const filters = []
  for (let p = 0; p < parts.length; p += 1) {
    inputs.push('-ss', String(parts[p].ss), '-t', String(each + 0.2), '-i', parts[p].file)
    filters.push(`[${p}:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x05090f,fps=25,trim=duration=${each.toFixed(3)},setpts=PTS-STARTPTS[v${p}]`)
  }
  const video = parts.length === 1 ? '[v0]' : `${parts.map((_, p) => `[v${p}]`).join('')}concat=n=${parts.length}:v=1:a=0[vout]`
  if (parts.length > 1) filters.push(video)
  inputs.push('-i', resolve(narration, `${sections[index].id}.wav`))
  const map = parts.length === 1 ? '[v0]' : '[vout]'
  run([
    '-hide_banner', '-loglevel', 'warning', '-y', ...inputs,
    '-filter_complex', filters.join(';'), '-map', map, '-map', `${parts.length}:a`,
    '-t', String(target), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000',
    '-movflags', '+faststart', resolve(sectionDir, `${sections[index].id}.mp4`)
  ])
}

const concatFile = resolve(work, 'sections.txt')
writeFileSync(concatFile, sections.map(s => `file '${resolve(sectionDir, `${s.id}.mp4`).replaceAll("'", "'\\''")}'`).join('\n') + '\n')
const clean = resolve(work, 'AXIOM-Space-A3-V7-clean.mp4')
run(['-hide_banner', '-loglevel', 'warning', '-y', '-f', 'concat', '-safe', '0', '-i', concatFile, '-c', 'copy', clean])

const assTime = seconds => {
  const cs = Math.max(0, Math.round(seconds * 100))
  const h = Math.floor(cs / 360000)
  const m = Math.floor((cs % 360000) / 6000)
  const s = Math.floor((cs % 6000) / 100)
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`
}
const esc = text => text.replaceAll('\\', '／').replaceAll('{', '（').replaceAll('}', '）').replaceAll('\n', '\\N')
const splitText = text => (text.match(/[^。！？；]+[。！？；]?/g) || [text]).map(s => s.trim()).filter(Boolean)
let cursor = 0
const events = []
for (let i = 0; i < sections.length; i += 1) {
  const section = sections[i]
  const d = durations[i]
  events.push(`Dialogue: 0,${assTime(cursor + 0.35)},${assTime(cursor + Math.min(4.8, d - 0.1))},Section,,0,0,0,,${String(i + 1).padStart(2, '0')}  ${esc(section.title)}`)
  const chunks = splitText(section.text)
  const weights = chunks.map(c => Math.max(5, [...c].length))
  const total = weights.reduce((a, b) => a + b, 0)
  let local = cursor + 0.25
  for (let j = 0; j < chunks.length; j += 1) {
    const span = d * weights[j] / total
    const end = j === chunks.length - 1 ? cursor + d - 0.08 : local + span
    events.push(`Dialogue: 0,${assTime(local)},${assTime(end)},Default,,0,0,0,,${esc(chunks[j])}`)
    local = end
  }
  cursor += d
}
events.push(`Dialogue: 0,${assTime(cursor - 8)},${assTime(cursor - 0.1)},Outro,,0,0,0,,通用 Agent 通常在答案交付时结束\\NAXIOM Space 让真正学会的东西继续参与下一次学习`)

const ass = `[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding
Style: Default,Noto Sans SC,43,&H00FFFFFF,&H000000FF,&HCC02070D,&HAA02070D,0,0,0,0,100,100,0,0,1,2.2,0,2,150,150,54,1
Style: Section,Noto Sans SC,35,&H00F0D276,&H000000FF,&HCC001014,&H99001014,1,0,0,0,100,100,1,0,3,12,0,7,72,72,58,1
Style: Outro,Noto Sans SC,54,&H00FFFFFF,&H000000FF,&HE000090D,&HC000090D,1,0,0,0,100,100,1,0,3,22,0,5,160,160,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events.join('\n')}
`
const assFile = resolve(work, 'AXIOM-Space-A3-V7.ass')
writeFileSync(assFile, ass, 'utf8')

const final = resolve(work, 'AXIOM-Space-A3黄金案例-V7.mp4')
const fontDir = resolve(assets).replaceAll('\\', '/').replaceAll(':', '\\:').replaceAll("'", "\\'")
const subtitlePath = assFile.replaceAll('\\', '/').replaceAll(':', '\\:').replaceAll("'", "\\'")
run([
  '-hide_banner', '-loglevel', 'warning', '-y', '-i', clean,
  '-vf', `subtitles='${subtitlePath}':fontsdir='${fontDir}'`,
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
  '-c:a', 'copy', '-movflags', '+faststart', final
])

console.log(JSON.stringify({ final, duration: duration(final), sections: durations }, null, 2))
