import * as storyModule from './v18-story.js?v=20260717l'

const rawUnits = storyModule.A3_UNITS
  || storyModule.V18_STORY
  || storyModule.A3_STORY
  || storyModule.default
  || []

const EXPECTED_UNIT_COUNT = 15
const query = new URLSearchParams(location.search)
const prefersReducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
const autoAdvance = query.get('autoadvance') === '1'
const autoplayRequested = query.get('autoplay') === '1'
const videosEnabled = query.get('videos') !== '0'
const narrationEnabled = query.get('narration') !== '0'

const elements = {
  deck: document.getElementById('deck'),
  progressFill: document.getElementById('progressFill'),
  pageCounter: document.getElementById('pageCounter'),
  prevBtn: document.getElementById('prevBtn'),
  nextBtn: document.getElementById('nextBtn'),
  playBtn: document.getElementById('playBtn'),
  notesBtn: document.getElementById('notesBtn'),
  directorBtn: document.getElementById('directorBtn'),
  fullscreenBtn: document.getElementById('fullscreenBtn'),
  notesPanel: document.getElementById('notesPanel'),
  notesTitle: document.getElementById('notesTitle'),
  notesNarration: document.getElementById('notesNarration'),
  notesBeats: document.getElementById('notesBeats'),
  closeNotes: document.getElementById('closeNotes'),
}

const legacyHashMap = {
  'scene-22-video': 'unit-01',
  'scene-23': 'unit-02',
  'scene-24-video': 'unit-03',
  'scene-19-video': 'unit-04',
  'scene-25-video': 'unit-05',
  'scene-15-video': 'unit-06',
  'scene-10': 'unit-07',
  'scene-02': 'unit-07',
  'scene-02-video': 'unit-07',
  'scene-03': 'unit-07',
  'scene-03-video': 'unit-07',
  'scene-04': 'unit-08',
  'scene-04-video': 'unit-09',
  'scene-17-video': 'unit-09',
  'scene-06-video': 'unit-09',
  'scene-05-video': 'unit-10',
  'scene-05': 'unit-11',
  'scene-20-video': 'unit-12',
  'scene-21-video': 'unit-13',
  'scene-13': 'unit-15',
}

function asArray(value) {
  if (value == null || value === '') return []
  return Array.isArray(value) ? value.filter(Boolean) : [value]
}

function asNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function stripHtml(value = '') {
  const holder = document.createElement('div')
  holder.innerHTML = String(value).replace(/<br\s*\/?\s*>/gi, '\n')
  return holder.textContent?.trim() || ''
}

function titleDescriptor(unit) {
  if (unit.title && typeof unit.title === 'object' && !Array.isArray(unit.title)) {
    return {
      lines: asArray(unit.title.lines || unit.title.text || unit.title.label).map(String),
      accentLine: asNumber(unit.title.accentLine, -1),
    }
  }

  const raw = unit.title || unit.heading || unit.headingHtml || unit.shortTitle || ''
  const clean = Array.isArray(raw) ? '' : stripHtml(raw)
  const semanticBreak = clean.length > 15
    ? clean.match(/^(.{4,22}?)[，；：]\s*(.{4,})$/)
    : null
  const lines = Array.isArray(raw)
    ? raw.map(String)
    : semanticBreak
      ? [semanticBreak[1].trim(), semanticBreak[2].trim()]
      : clean.split(/\n+/).map(line => line.trim()).filter(Boolean)

  return {
    lines,
    accentLine: asNumber(unit.accentLine, lines.length > 1 ? lines.length - 1 : -1),
  }
}

function normalizeCandidate(candidate, index) {
  if (typeof candidate === 'string') {
    return { src: candidate, label: `候选素材 ${index + 1}` }
  }

  if (!candidate || typeof candidate !== 'object') return null
  const src = candidate.src || candidate.path || candidate.url
  if (!src) return null
  return {
    src,
    label: candidate.label || candidate.title || `候选素材 ${index + 1}`,
  }
}

function normalizeMedia(unit, index) {
  if (index === EXPECTED_UNIT_COUNT - 1 || unit.mode === 'static') return null

  const media = unit.media && typeof unit.media === 'object' ? unit.media : {}
  const status = String(media.status || unit.mediaStatus || (media.src ? 'ready' : 'missing')).toLowerCase()
  const candidates = [
    ...asArray(media.candidates),
    ...asArray(media.fallbackCandidates),
    ...asArray(media.candidateSrc),
    ...asArray(unit.candidateVideos),
  ].map(normalizeCandidate).filter(Boolean)

  const primarySrc = media.src || unit.videoSrc || unit.video
  const sources = []
  if (primarySrc && status !== 'missing') {
    sources.push({
      src: primarySrc,
      label: status === 'ready' ? '正式素材' : '候选主素材',
      candidate: status !== 'ready',
    })
  }
  candidates.forEach(candidate => {
    if (!sources.some(source => source.src === candidate.src)) {
      sources.push({ ...candidate, candidate: true })
    }
  })

  return {
    status,
    group: media.group || media.groupId || media.master || unit.mediaGroup || `unit-${String(index + 1).padStart(2, '0')}`,
    plannedSrc: media.plannedFile || media.plannedSrc || primarySrc || '',
    sources,
    in: Math.max(0, asNumber(media.in ?? media.startAt ?? media.clipStart, 0)),
    out: Math.max(0, asNumber(media.out ?? media.endAt ?? media.clipEnd, 0)),
    poster: media.poster || '',
    ariaLabel: media.ariaLabel || unit.ariaLabel || unit.shortTitle || `第 ${index + 1} 单元产品实录`,
    missing: asArray(media.missing),
    note: media.note || '',
  }
}

function normalizeNarration(unit, index) {
  if (typeof unit.narration === 'string') {
    return {
      text: unit.narration,
      src: unit.narrationSrc || unit.audioSrc || `assets/audio/v18/unit-${String(index + 1).padStart(2, '0')}.mp3`,
      captions: unit.captions || '',
    }
  }

  const narration = unit.narration && typeof unit.narration === 'object' ? unit.narration : {}
  return {
    text: narration.text || narration.script || unit.notes || '',
    src: narration.src || unit.narrationSrc || unit.audioSrc || '',
    captions: narration.captions || narration.vtt || unit.captions || '',
  }
}

function normalizeEvidence(unit) {
  const evidence = unit.evidence ?? unit.support ?? unit.mechanism ?? unit.subtitle ?? unit.summary ?? ''
  if (typeof evidence === 'string') {
    const separator = evidence.includes('→') ? '→' : evidence.includes('｜') ? '｜' : ''
    if (separator) {
      return {
        type: 'flow',
        text: '',
        items: evidence.split(separator).map(item => item.trim()).filter(Boolean),
      }
    }
    return { type: 'text', text: evidence, items: [] }
  }
  if (Array.isArray(evidence)) return { type: 'list', text: '', items: evidence }
  if (!evidence || typeof evidence !== 'object') return { type: 'text', text: '', items: [] }

  return {
    type: evidence.type || (evidence.items || evidence.steps ? 'flow' : 'text'),
    text: evidence.text || evidence.label || evidence.title || '',
    items: asArray(evidence.items || evidence.steps || evidence.labels || evidence.values),
  }
}

function parseTimeRange(value) {
  if (typeof value === 'number') return { start: value, end: null }
  if (typeof value !== 'string') return { start: null, end: null }

  const range = value.trim().match(/^(\d+(?:\.\d+)?)\s*[-–—]\s*(\d+(?:\.\d+)?)$/)
  if (range) return { start: Number(range[1]), end: Number(range[2]) }
  const point = Number(value)
  return Number.isFinite(point) ? { start: point, end: null } : { start: null, end: null }
}

function normalizeBeat(beat, index, beats, duration) {
  const parsed = parseTimeRange(beat?.time)
  const start = Math.max(0, asNumber(beat?.at ?? beat?.start ?? parsed.start, 0))
  const next = beats[index + 1]
  const nextParsed = parseTimeRange(next?.time)
  const inferredEnd = next ? asNumber(next?.at ?? next?.start ?? nextParsed.start, duration) : duration
  const explicitEnd = beat?.until ?? beat?.end ?? parsed.end
  const end = Math.max(start, asNumber(explicitEnd, inferredEnd || Number.POSITIVE_INFINITY))

  return {
    id: beat?.id || `beat-${index + 1}`,
    type: beat?.type || beat?.kind || 'caption',
    text: beat?.text || beat?.label || beat?.title || '',
    items: asArray(beat?.items || beat?.steps),
    start,
    end,
    activeIndex: Number.isInteger(beat?.activeIndex) ? beat.activeIndex : null,
    tone: beat?.tone || '',
    position: beat?.position || '',
    target: beat?.target || null,
    visual: beat?.visual || '',
  }
}

function normalizeUnit(unit, index) {
  const number = index + 1
  const id = unit.id || `unit-${String(number).padStart(2, '0')}`
  const requestedDuration = Math.max(0, asNumber(unit.duration?.seconds ?? unit.duration ?? unit.expectedDuration, 0))
  const rawBeats = asArray(unit.beats || unit.cues)
  const mode = number === EXPECTED_UNIT_COUNT ? 'static' : (unit.mode || unit.type || 'hybrid')
  const normalizedBeats = rawBeats.map((beat, beatIndex) => normalizeBeat(beat, beatIndex, rawBeats, requestedDuration))
  const inferredDuration = normalizedBeats.reduce((maximum, beat) => Number.isFinite(beat.end) ? Math.max(maximum, beat.end) : maximum, 0)
  const duration = requestedDuration || inferredDuration
  const mediaPlaceholder = unit.media && typeof unit.media === 'object' ? unit.media : {}

  const visualLayout = unit.visual?.layout || unit.layout || `${mode}-default`
  const layoutAliases = {
    'vault-entry-proof': 'hero-video',
    'adaptive-dialogue': 'profile-dialogue',
    'insight-evidence-zoom': 'profile-insights',
    'import-transformation': 'import',
    'dashboard-card-boxes': 'dashboard',
    'node-continuity-trace': 'continuity',
    'three-party-evidence-chain': 'agents',
    'review-panel-freeze': 'review-rules',
    'review-state-transition': 'review-loop',
    'active-resource-request': 'resource-request',
    'recommendation-evidence-card': 'recommendation',
    'six-resource-grid': 'resources',
    'graph-source-modes': 'graph-modes',
    'graph-mastery-path-modes': 'graph-modes',
    'closing-evidence-montage': 'final',
  }
  const title = titleDescriptor(unit)

  return {
    ...unit,
    id,
    number,
    mode,
    layout: number === EXPECTED_UNIT_COUNT ? 'final' : (layoutAliases[visualLayout] || visualLayout),
    visualLayout,
    phase: unit.phase || unit.chapter || `第 ${number} 单元`,
    subject: unit.subject || unit.productSubject || unit.eyebrow || unit.kicker || '',
    title,
    evidence: normalizeEvidence(unit),
    result: unit.result || unit.value || unit.vision || unit.finalVision || '',
    results: asArray(unit.results || unit.outcomes),
    narration: normalizeNarration(unit, index),
    media: normalizeMedia({ ...unit, mode }, index),
    duration,
    beats: normalizedBeats,
    placeholder: unit.placeholder && typeof unit.placeholder === 'object'
      ? unit.placeholder
      : {
          title: unit.placeholder || title.lines.join(' ') || '产品实录待补充',
          shots: asArray(mediaPlaceholder.missing),
          note: mediaPlaceholder.note || '',
        },
    footer: unit.footer || unit.footerText || '',
    legacyHashes: asArray(unit.legacyHashes),
  }
}

const orderedRawUnits = [...asArray(rawUnits)].sort((left, right) => {
  const leftSequence = asNumber(left?.sequence, Number.POSITIVE_INFINITY)
  const rightSequence = asNumber(right?.sequence, Number.POSITIVE_INFINITY)
  return leftSequence - rightSequence
})
const units = orderedRawUnits.map(normalizeUnit)
const duplicateIds = units.filter((unit, index) => units.findIndex(other => other.id === unit.id) !== index)

if (units.length !== EXPECTED_UNIT_COUNT) {
  console.error(`V18 演示应包含 ${EXPECTED_UNIT_COUNT} 个单元，当前读取到 ${units.length} 个。`)
}
if (duplicateIds.length) {
  console.error('V18 演示存在重复单元 ID：', duplicateIds.map(unit => unit.id))
}

const slides = []
const beatNodes = new Map()
const directorOnlyNodes = new Set()
let currentIndex = 0
let currentMediaToken = 0
let currentSourceIndex = -1
let mediaReady = false
let activeSource = null
let rafId = 0
let timerStartedAt = 0
let timerOffset = 0
let timerPlaying = false
let internalMediaAction = false
let narrationReady = false
let narrationFailed = false
let notesReturnFocus = null
let directorMode = query.get('director') === '1'
  || (query.get('director') !== '0' && document.body.classList.contains('director'))
let recordingMode = query.get('record') === '1'

const sharedVideo = document.createElement('video')
sharedVideo.className = 'v18-video'
sharedVideo.controls = true
sharedVideo.playsInline = true
sharedVideo.preload = 'none'
sharedVideo.muted = true
sharedVideo.defaultMuted = true
sharedVideo.style.background = 'var(--paper, #f4f7f5)'

const sharedAudio = document.createElement('audio')
sharedAudio.className = 'v18-narration'
sharedAudio.preload = 'none'
sharedAudio.hidden = true
document.body.append(sharedAudio)

function createElement(tag, className, text) {
  const element = document.createElement(tag)
  if (className) element.className = className
  if (text != null && text !== '') element.textContent = String(text)
  return element
}

function renderTitle(unit) {
  const title = createElement(unit.number === 1 ? 'h1' : 'h2', 'v18-title')
  unit.title.lines.forEach((line, lineIndex) => {
    const row = createElement('span', 'v18-title-line', line)
    if (lineIndex === unit.title.accentLine) row.classList.add('is-accent')
    title.append(row)
  })
  return title
}

function renderEvidence(unit) {
  if (!unit.evidence.text && !unit.evidence.items.length) return null

  const evidence = createElement('div', `v18-evidence v18-evidence--${unit.evidence.type}`)
  if (unit.evidence.text) evidence.append(createElement('p', 'v18-evidence-text', unit.evidence.text))

  if (unit.evidence.items.length) {
    const list = createElement('div', 'v18-evidence-items')
    unit.evidence.items.forEach((item, index) => {
      if (index > 0 && unit.evidence.type === 'flow') list.append(createElement('i', 'v18-flow-arrow', '→'))
      const text = typeof item === 'string' ? item : item?.text || item?.label || item?.title || ''
      const node = createElement('span', 'v18-evidence-item', text)
      node.dataset.evidenceIndex = String(index)
      list.append(node)
    })
    evidence.append(list)
  }

  return evidence
}

function appendVisualStep(parent, content, index, className = '') {
  const node = createElement('div', className)
  node.dataset.visualStep = String(index)
  if (content instanceof Node) node.append(content)
  else node.textContent = String(content || '')
  parent.append(node)
  return node
}

function renderModeRail(items, className = 'v18-graph-modes') {
  const rail = createElement('div', className)
  asArray(items).forEach((item, index) => {
    const node = createElement('div', 'v18-graph-mode')
    node.dataset.visualStep = String(index)
    node.append(
      createElement('b', '', item?.label || item?.title || String(item || '')),
      createElement('span', '', item?.question || item?.meaning || ''),
    )
    rail.append(node)
  })
  return rail
}

function renderVisualOverlay(unit) {
  const visual = unit.visual && typeof unit.visual === 'object' ? unit.visual : {}
  const overlay = createElement('div', `v18-visual-overlay visual-${unit.visualLayout}`)

  if (unit.number === 2) {
    const rail = createElement('div', 'v18-step-rail')
    asArray(visual.profileDimensions).forEach((label, index) => appendVisualStep(rail, label, index))
    overlay.append(rail)
  } else if (unit.number === 3) {
    const stack = createElement('div', 'v18-insight-stack')
    asArray(visual.callouts).forEach((label, index) => appendVisualStep(stack, label, index))
    overlay.append(stack)
  } else if (unit.number === 4) {
    const flow = createElement('div', 'v18-import-flow')
    asArray(visual.pipeline).forEach((label, index) => appendVisualStep(flow, label, index))
    overlay.append(flow)
  } else if (unit.number === 5) {
    const boxes = createElement('div', 'v18-card-boxes')
    asArray(visual.cardBoxes).forEach((box, index) => {
      const node = createElement('article', `v18-card-box ${box.type || ''}`)
      node.dataset.visualStep = String(index)
      node.append(
        createElement('small', '', ['文献卡', '灵感卡', '永久卡'][index] || box.type),
        createElement('b', '', box.meaning || ''),
        createElement('span', '', ['保留原始资料', '正在形成理解', '通过输出与迁移审核'][index] || ''),
      )
      boxes.append(node)
    })
    overlay.append(boxes)
  } else if (unit.number === 6) {
    const rail = createElement('div', 'v18-step-rail')
    ;[visual.sourceSurface, '同一知识节点', visual.targetSurface].filter(Boolean)
      .forEach((label, index) => appendVisualStep(rail, label, index))
    overlay.append(rail)
  } else if (unit.number === 7) {
    const roles = createElement('div', 'v18-agent-roles')
    const roleEntries = [
      ['Agent A', visual.roles?.agentA, ''],
      ['学生', visual.roles?.student, 'is-student'],
      ['Agent B', visual.roles?.agentB, ''],
    ]
    roleEntries.forEach(([name, detail, className], index) => {
      const node = createElement('article', `v18-agent ${className}`)
      node.dataset.visualStep = String(index)
      node.append(createElement('b', '', name), createElement('span', '', detail || ''))
      roles.append(node)
    })
    const memory = createElement('div', 'v18-memory-bridge')
    memory.dataset.visualStep = '3'
    memory.append(
      createElement('small', '', visual.retrievalBadge || '语义 / 向量检索'),
      createElement('b', '', '旧知只负责搭桥'),
      createElement('span', '', visual.retrievalBoundary || ''),
    )
    overlay.append(roles, memory)
  } else if (unit.number === 8) {
    const rules = createElement('div', 'v18-review-rules')
    asArray(visual.reviewCriteria).forEach((label, index) => appendVisualStep(rules, label, index))
    overlay.append(rules)
  } else if (unit.number === 9) {
    const loop = createElement('div', 'v18-review-loop')
    ;['未通过', '追问缺口', '新情境', '复审', '通过'].forEach((label, index) => {
      const className = index === 0 ? 'is-fail' : index === 4 ? 'is-pass' : ''
      appendVisualStep(loop, label, index, className)
    })
    const cardState = createElement('div', 'v18-card-state', '灵感卡＝尚未掌握')
    overlay.append(loop, cardState)
  } else if (unit.number === 10) {
    const choices = createElement('div', 'v18-resource-choice')
    ;[visual.currentGap, visual.requestedResource, visual.deliveryProof].filter(Boolean)
      .forEach((label, index) => appendVisualStep(choices, label, index))
    overlay.append(choices)
  } else if (unit.number === 11) {
    const card = createElement('div', 'v18-recommendation-card')
    const fields = [
      ['当前缺口', '锁方案选择与失效边界'],
      ['学习偏好', '分步可视化＋边界练习'],
      ['推荐理由', asArray(visual.recommendation).join('＋')],
      ['证据与结果', '显示强度与预期结果'],
    ]
    fields.forEach(([label, detail], index) => {
      const node = createElement('div', '')
      node.dataset.visualStep = String(index)
      node.append(createElement('small', '', label), createElement('b', '', detail))
      card.append(node)
    })
    const actions = createElement('div', 'v18-recommendation-actions')
    actions.append(createElement('span', '', '忽略'), createElement('span', 'primary', '确认后生成'))
    card.append(actions)
    overlay.append(card)
  } else if (unit.number === 12) {
    const grid = createElement('div', 'v18-resource-grid')
    const labels = {
      document: '文档', mindmap: '导图', quiz: '题目', code: '代码', diagram: '图示', video: '视频',
    }
    Object.entries(visual.resourcePurposes || {}).forEach(([key, purpose], index) => {
      const node = createElement('article', 'v18-resource-card')
      node.dataset.visualStep = String(index)
      node.append(createElement('small', '', labels[key] || key), createElement('b', '', purpose))
      grid.append(node)
    })
    overlay.append(grid)
  } else if (unit.number === 13 || unit.number === 14) {
    const modes = renderModeRail(visual.modes)
    const explanation = createElement('div', 'v18-graph-explanation', visual.invariant || visual.truthNote || '')
    const key = createElement('div', 'v18-node-key')
    if (unit.number === 14) {
      key.append(
        createElement('span', 'fleeting', '尚未掌握'),
        createElement('span', 'permanent', '已经掌握'),
      )
      key.querySelectorAll('span').forEach(node => node.prepend(createElement('i')))
    }
    overlay.append(modes, explanation, key)
  }

  return overlay.childElementCount ? overlay : null
}

function renderFinal(unit) {
  const final = createElement('div', 'v18-final final')
  final.append(createElement('p', 'v18-final-product product', unit.subject || 'AXIOM Space｜给高校学生使用的 AI 掌握学习系统'))
  const heading = createElement('h1', 'v18-final-title')
  unit.title.lines.forEach((line, index) => {
    const row = createElement('span', `v18-title-line${index === unit.title.accentLine ? ' is-accent' : ''}`, line)
    heading.append(row)
  })
  const mark = createElement('div', 'v18-final-mark')
  mark.setAttribute('aria-hidden', 'true')
  final.append(
    heading,
    createElement('p', 'v18-final-vision vision', unit.result || '让高质量、个性化、可持续的学习反馈更容易获得'),
    mark,
  )
  return final
}

function renderPlaceholder(unit) {
  const placeholder = createElement('div', 'v18-media-placeholder v18-placeholder')
  placeholder.style.background = 'linear-gradient(135deg, var(--paper, #f4f7f5), var(--paper-soft, #eaf0ee))'
  placeholder.style.color = 'var(--graphite, #172326)'
  placeholder.setAttribute('role', 'status')

  const label = createElement('small', 'v18-placeholder-label', unit.media?.status === 'partial' ? '候选素材 · 仍需复核' : '产品实录 · 待补充')
  const title = createElement('strong', 'v18-placeholder-title', unit.placeholder.title || unit.title.lines.join(' '))
  const summary = createElement('p', 'v18-placeholder-summary', unit.evidence.text || unit.footer || '该单元不会显示黑屏；素材完成前使用当前结构占位。')
  placeholder.append(label, title, summary)

  const shots = asArray(unit.placeholder.shots || unit.placeholder.steps || unit.placeholder.checklist || unit.media?.missing)
  if (shots.length) {
    const shotList = createElement('ol', 'v18-placeholder-shots v18-shot-list director-only')
    shots.forEach(shot => shotList.append(createElement('li', '', typeof shot === 'string' ? shot : shot?.text || shot?.label || '')))
    placeholder.append(shotList)
    directorOnlyNodes.add(shotList)
  }

  const planned = unit.media?.plannedSrc
  if (planned) {
    const path = createElement('code', 'v18-placeholder-path director-only', planned)
    placeholder.append(path)
    directorOnlyNodes.add(path)
  }

  if (unit.placeholder.note) {
    const note = createElement('p', 'director-only', unit.placeholder.note)
    placeholder.append(note)
    directorOnlyNodes.add(note)
  }

  return placeholder
}

function beatText(beat, unit) {
  if (beat.text) return beat.text
  if (beat.type === 'subject') return unit.subject
  if (beat.type === 'title') return unit.title.lines.join(' ')
  if (beat.type === 'evidence' || beat.type === 'flow') return unit.evidence.text
  return ''
}

function renderBeat(beat, unit) {
  const topCaptionPages = new Set([5, 7, 8, 9, 10, 12, 13, 14])
  const positionClass = topCaptionPages.has(unit.number) ? ' is-top is-right' : ''
  const toneClass = beat.tone === 'fail' ? ' is-fail' : ''
  const node = createElement('div', `v18-beat v18-cue v18-caption v18-beat--${beat.type}${positionClass}${toneClass}`)
  node.dataset.cue = beat.id
  node.dataset.beatId = beat.id
  node.dataset.start = String(beat.start)
  node.dataset.end = String(beat.end)
  if (beat.tone) node.dataset.tone = beat.tone
  if (beat.position) node.dataset.position = beat.position
  if (beat.activeIndex != null) node.dataset.activeIndex = String(beat.activeIndex)

  const text = beatText(beat, unit)
  if (text) node.append(createElement('strong', 'v18-beat-text', text))
  if (beat.items.length) {
    const items = createElement('div', 'v18-beat-items')
    beat.items.forEach(item => items.append(createElement('span', '', typeof item === 'string' ? item : item?.text || item?.label || '')))
    node.append(items)
  }

  if (beat.target && typeof beat.target === 'object') {
    node.classList.add('v18-beat--highlight')
    for (const [key, value] of Object.entries(beat.target)) {
      if (['x', 'y', 'width', 'height', 'w', 'h'].includes(key) && Number.isFinite(Number(value))) {
        const cssKey = key === 'w' ? 'width' : key === 'h' ? 'height' : key
        node.style.setProperty(`--target-${cssKey}`, `${value}%`)
      }
    }
  }

  node.classList.remove('is-active')
  node.setAttribute('aria-hidden', 'true')
  node.style.opacity = '0'
  node.style.pointerEvents = 'none'
  return node
}

function renderUnit(unit) {
  const slide = createElement('section', `slide v18-unit v18-slide v18-slide--${unit.mode} v18-layout--${unit.layout} layout-${unit.layout}`)
  slide.dataset.unit = unit.id
  slide.dataset.number = String(unit.number)
  slide.dataset.mode = unit.mode
  slide.dataset.layout = unit.layout
  slide.dataset.mediaStatus = unit.media?.status || 'none'
  const previous = units[unit.number - 2]
  if (previous?.media?.group && previous.media.group === unit.media?.group) {
    slide.dataset.continuity = 'same-media'
    slide.classList.add('is-continuous')
  }
  slide.setAttribute('role', 'group')
  slide.setAttribute('aria-roledescription', '幻灯片')
  slide.setAttribute('aria-label', `${String(unit.number).padStart(2, '0')} / ${String(units.length).padStart(2, '0')}：${unit.title.lines.join(' ')}`)

  const frame = createElement('div', 'frame')
  const chrome = createElement('header', 'chrome')
  chrome.append(
    createElement('span', '', `${String(unit.number).padStart(2, '0')} · ${unit.title.lines.join(' ')}`),
    createElement('span', '', unit.phase),
  )

  const page = createElement('div', 'v18-page v18-unit-page')
  const copy = createElement('div', 'v18-copy-layer')
  if (unit.subject) copy.append(createElement('p', 'v18-subject', unit.subject))
  copy.append(renderTitle(unit))
  const evidence = renderEvidence(unit)
  if (evidence) copy.append(evidence)
  unit.results.forEach(result => copy.append(createElement('p', 'v18-result', typeof result === 'string' ? result : result?.text || result?.label || '')))
  if (unit.result) copy.append(createElement('p', 'v18-result v18-result--final', typeof unit.result === 'string' ? unit.result : unit.result?.text || unit.result?.label || ''))

  page.append(copy)

  if (unit.mode !== 'static') {
    const stage = createElement('div', 'v18-media-stage')
    stage.style.background = 'linear-gradient(135deg, var(--paper-soft, #eaf0ee), var(--paper, #f4f7f5))'
    const slot = createElement('div', 'v18-media-slot')
    const wash = createElement('div', 'v18-media-wash')
    const badge = createElement('div', 'v18-media-status v18-status-chip director-only')
    badge.hidden = true
    const placeholder = renderPlaceholder(unit)
    stage.append(slot, wash, badge, placeholder)
    page.append(stage)
    slide._v18 = { stage, slot, badge, placeholder }
  } else {
    slide.classList.add('has-static-ending')
    copy.hidden = true
    page.append(renderFinal(unit))
    slide._v18 = { stage: null, slot: null, badge: null, placeholder: null }
  }

  const cueLayer = createElement('div', 'v18-cue-layer')
  const visualOverlay = unit.mode === 'static' ? null : renderVisualOverlay(unit)
  if (visualOverlay) cueLayer.append(visualOverlay)
  const nodes = unit.mode === 'static' ? [] : unit.beats.map(beat => renderBeat(beat, unit))
  nodes.forEach(node => cueLayer.append(node))
  beatNodes.set(unit.id, nodes)
  page.append(cueLayer)

  const footer = createElement('footer', 'foot')
  footer.append(
    createElement('span', '', unit.footer),
    createElement('span', '', `${String(unit.number).padStart(2, '0')} / ${String(units.length).padStart(2, '0')}`),
  )
  const notes = createElement('aside', 'notes', unit.narration.text)
  frame.append(chrome, page, footer, notes)
  slide.append(frame)
  return slide
}

function renderFatal(message) {
  if (!elements.deck) return
  const slide = createElement('section', 'slide v18-slide is-active')
  const frame = createElement('div', 'frame')
  const page = createElement('div', 'v18-page v18-fatal')
  page.style.background = 'linear-gradient(135deg, var(--paper, #f4f7f5), var(--paper-soft, #eaf0ee))'
  page.append(
    createElement('p', 'v18-subject', 'AXIOM Space · V18'),
    createElement('h1', 'v18-title', '演示数据尚未就绪'),
    createElement('p', 'v18-result', message),
  )
  frame.append(page)
  slide.append(frame)
  elements.deck.replaceChildren(slide)
}

function renderDeck() {
  if (!elements.deck) return
  if (!units.length) {
    renderFatal('未从 v18-story.js 读取到 A3_UNITS。')
    return
  }

  const fragment = document.createDocumentFragment()
  units.forEach(unit => {
    const slide = renderUnit(unit)
    slides.push(slide)
    fragment.append(slide)
  })
  elements.deck.replaceChildren(fragment)
}

renderDeck()

function currentUnit() {
  return units[currentIndex] || null
}

function currentSlide() {
  return slides[currentIndex] || null
}

function candidateLabel(source, unit) {
  if (!source) return ''
  if (!source.candidate && unit.media?.status === 'ready') return ''
  return `${source.label || '候选素材'} · 尚未完成最终真实性复核`
}

function setStageState(slide, state, detail = '') {
  if (!slide?._v18?.stage) return
  const { stage, placeholder, badge } = slide._v18
  stage.dataset.state = state
  stage.classList.toggle('has-media', state === 'ready' || state === 'candidate')
  stage.classList.toggle('is-candidate', state === 'candidate')
  stage.classList.toggle('is-missing', state === 'missing' || state === 'error')
  stage.classList.toggle('is-loading', state === 'loading')

  if (placeholder) {
    const showPlaceholder = !['ready', 'candidate'].includes(state)
    placeholder.hidden = !showPlaceholder
    placeholder.classList.toggle('is-visible', showPlaceholder)
    placeholder.setAttribute('aria-hidden', String(!showPlaceholder))
  }
  if (badge) {
    badge.textContent = detail
    badge.hidden = !detail
  }
}

function resetSharedVideo() {
  internalMediaAction = true
  sharedVideo.pause()
  sharedVideo.removeAttribute('src')
  sharedVideo.removeAttribute('poster')
  sharedVideo.load()
  internalMediaAction = false
  mediaReady = false
  activeSource = null
  currentSourceIndex = -1
}

function seekVideoToUnitStart(unit) {
  if (!unit?.media || !mediaReady) return
  const target = unit.media.in
  if (Number.isFinite(sharedVideo.duration)) {
    sharedVideo.currentTime = Math.min(target, Math.max(0, sharedVideo.duration - 0.01))
  } else {
    sharedVideo.currentTime = target
  }
}

function tryMediaSource(unit, sourceIndex, token) {
  const slide = currentSlide()
  const source = unit.media?.sources[sourceIndex]
  if (!slide || !source || token !== currentMediaToken) {
    setStageState(slide, 'missing')
    return
  }

  currentSourceIndex = sourceIndex
  activeSource = source
  mediaReady = false
  setStageState(slide, 'loading', source.candidate ? candidateLabel(source, unit) : '')

  internalMediaAction = true
  sharedVideo.pause()
  sharedVideo.src = source.src
  sharedVideo.poster = unit.media.poster || ''
  sharedVideo.setAttribute('aria-label', unit.media.ariaLabel)
  sharedVideo.preload = 'metadata'
  sharedVideo.load()
  internalMediaAction = false
}

function configureMedia(unit) {
  const slide = currentSlide()
  currentMediaToken += 1
  const token = currentMediaToken

  if (!slide?._v18?.slot || unit.mode === 'static') {
    resetSharedVideo()
    return
  }

  slide._v18.slot.append(sharedVideo)
  if (!videosEnabled || !unit.media || !unit.media.sources.length) {
    resetSharedVideo()
    setStageState(slide, 'missing')
    return
  }

  const currentAbsolute = sharedVideo.currentSrc || sharedVideo.src
  const preferred = unit.media.sources[0]
  const preferredAbsolute = preferred ? new URL(preferred.src, location.href).href : ''
  if (mediaReady && preferredAbsolute && currentAbsolute === preferredAbsolute) {
    activeSource = preferred
    currentSourceIndex = 0
    seekVideoToUnitStart(unit)
    setStageState(slide, preferred.candidate || unit.media.status !== 'ready' ? 'candidate' : 'ready', candidateLabel(preferred, unit))
    return
  }

  tryMediaSource(unit, 0, token)
}

sharedVideo.addEventListener('loadedmetadata', () => {
  const unit = currentUnit()
  const slide = currentSlide()
  if (!unit?.media || !slide?._v18?.stage) return
  mediaReady = true
  seekVideoToUnitStart(unit)
  const candidate = Boolean(activeSource?.candidate || unit.media.status !== 'ready')
  setStageState(slide, candidate ? 'candidate' : 'ready', candidate ? candidateLabel(activeSource, unit) : '')
  updatePlayButton()
})

sharedVideo.addEventListener('error', () => {
  const unit = currentUnit()
  const token = currentMediaToken
  if (!unit?.media) return
  const nextIndex = currentSourceIndex + 1
  if (nextIndex < unit.media.sources.length) {
    tryMediaSource(unit, nextIndex, token)
  } else {
    mediaReady = false
    setStageState(currentSlide(), 'error', '素材不可读取 · 已保留浅色占位')
    updatePlayButton()
  }
})

function narrationSource(unit) {
  return narrationEnabled ? unit?.narration?.src?.trim() || '' : ''
}

function configureNarration(unit) {
  narrationReady = false
  narrationFailed = false
  internalMediaAction = true
  sharedAudio.pause()
  sharedAudio.removeAttribute('src')
  if (narrationSource(unit)) {
    sharedAudio.src = narrationSource(unit)
    sharedAudio.preload = 'metadata'
    sharedAudio.load()
  }
  internalMediaAction = false
}

sharedAudio.addEventListener('loadedmetadata', () => {
  narrationReady = true
  narrationFailed = false
  updatePlayButton()
})

sharedAudio.addEventListener('error', () => {
  narrationFailed = true
  narrationReady = false
  updatePlayButton()
})

function relativeTime() {
  const unit = currentUnit()
  if (!unit) return 0
  if (narrationSource(unit) && !narrationFailed && Number.isFinite(sharedAudio.currentTime)) return sharedAudio.currentTime
  if (unit.media && mediaReady && Number.isFinite(sharedVideo.currentTime)) return Math.max(0, sharedVideo.currentTime - unit.media.in)
  if (timerPlaying) return timerOffset + (performance.now() - timerStartedAt) / 1000
  return timerOffset
}

function applyBeats(time = 0) {
  const unit = currentUnit()
  const slide = currentSlide()
  if (!unit || !slide) return

  const nodes = beatNodes.get(unit.id) || []
  let activeEvidenceIndex = null
  let activeBeatIndex = 0
  nodes.forEach((node, index) => {
    const beat = unit.beats[index]
    const redundantTitleCue = /主标题|产品主语/.test(beat.text || '')
    const active = time >= beat.start && time < beat.end && time >= 3 && !redundantTitleCue
    node.classList.toggle('is-active', active)
    node.setAttribute('aria-hidden', String(!active))
    node.style.opacity = active ? '1' : '0'
    node.style.visibility = active ? 'visible' : 'hidden'
    if (time >= beat.start && time < beat.end) {
      activeBeatIndex = index
      if (beat.activeIndex != null) activeEvidenceIndex = beat.activeIndex
    }
  })

  if (unit.mode !== 'static') {
    slide.dataset.cuePhase = time < 3 ? 'intro' : 'action'
    slide.dataset.copyState = time < 3 ? 'hero' : 'compact'
  }

  slide.querySelectorAll('.v18-evidence-item').forEach(item => {
    const itemIndex = Number(item.dataset.evidenceIndex)
    item.classList.toggle('is-active', activeEvidenceIndex == null || itemIndex === activeEvidenceIndex)
    item.classList.toggle('is-muted', activeEvidenceIndex != null && itemIndex !== activeEvidenceIndex)
  })

  const offsets = { 2: 1, 3: 1, 4: 1, 5: 2, 8: 1, 11: 1, 12: 1, 13: 1 }
  const visualItems = [...slide.querySelectorAll('[data-visual-step]')]
  const steps = [...new Set(visualItems.map(item => Number(item.dataset.visualStep)).filter(Number.isFinite))]
  const visualStep = steps.length
    ? Math.max(0, Math.min(Math.max(...steps), activeBeatIndex - (offsets[unit.number] || 0)))
    : -1
  visualItems.forEach(item => {
    const current = Number(item.dataset.visualStep) === visualStep
    item.classList.toggle('is-current', current)
    if (current) item.setAttribute('aria-current', 'true')
    else item.removeAttribute('aria-current')
  })

  if (unit.number === 9) {
    const card = slide.querySelector('.v18-card-state')
    const permanent = time >= 38
    card?.classList.toggle('is-permanent', permanent)
    if (card) card.textContent = permanent ? '永久卡＝已经掌握' : '灵感卡＝尚未掌握'
  }
}

function syncVideoToNarration() {
  const unit = currentUnit()
  if (!unit?.media || !mediaReady || !narrationSource(unit) || narrationFailed) return
  const desired = unit.media.in + sharedAudio.currentTime
  const upper = unit.media.out > unit.media.in ? unit.media.out : sharedVideo.duration
  const target = Number.isFinite(upper) ? Math.min(desired, Math.max(unit.media.in, upper - 0.02)) : desired
  if (Math.abs(sharedVideo.currentTime - target) > 0.38) sharedVideo.currentTime = target
}

function unitDuration(unit) {
  if (!unit) return 0
  if (unit.duration > 0) return unit.duration
  if (unit.media?.out > unit.media?.in) return unit.media.out - unit.media.in
  if (narrationReady && Number.isFinite(sharedAudio.duration)) return sharedAudio.duration
  return 0
}

function finishPlayback() {
  timerPlaying = false
  cancelAnimationFrame(rafId)
  rafId = 0
  const unit = currentUnit()
  const finishingTime = unitDuration(unit) || relativeTime()
  applyBeats(Math.max(0, finishingTime - 0.001))
  internalMediaAction = true
  sharedAudio.pause()
  sharedVideo.pause()
  internalMediaAction = false
  updatePlayButton()

  if (autoAdvance && currentIndex < units.length - 1) {
    showUnit(currentIndex + 1, { autoplay: true })
  }
}

function tick() {
  const unit = currentUnit()
  if (!unit) return
  const time = relativeTime()
  applyBeats(time)
  syncVideoToNarration()

  if (!narrationSource(unit) && unit.media?.out > unit.media?.in && mediaReady && sharedVideo.currentTime >= unit.media.out - 0.03) {
    finishPlayback()
    return
  }
  const duration = unitDuration(unit)
  if (!narrationSource(unit) && !mediaReady && duration > 0 && time >= duration) {
    finishPlayback()
    return
  }
  rafId = requestAnimationFrame(tick)
}

function startTicker() {
  cancelAnimationFrame(rafId)
  rafId = requestAnimationFrame(tick)
}

async function playCurrent() {
  const unit = currentUnit()
  if (!unit) return
  const playback = []
  internalMediaAction = true

  if (narrationSource(unit) && !narrationFailed) {
    if (sharedAudio.ended) sharedAudio.currentTime = 0
    playback.push(sharedAudio.play())
  }

  if (mediaReady && unit.mode !== 'static') {
    if (unit.media?.out > unit.media?.in && sharedVideo.currentTime >= unit.media.out - 0.03) seekVideoToUnitStart(unit)
    sharedVideo.muted = true
    playback.push(sharedVideo.play())
  }

  if (!playback.length) {
    const duration = unitDuration(unit)
    if (duration > 0 || unit.beats.length) {
      timerStartedAt = performance.now()
      timerPlaying = true
    }
  }

  internalMediaAction = false
  const results = await Promise.allSettled(playback)
  const narrationRejected = results[0]?.status === 'rejected' && narrationSource(unit)
  if (narrationRejected) {
    const error = results[0].reason
    if (error?.name !== 'NotAllowedError') narrationFailed = true
  }
  const hasSuccessfulPlayback = results.some(result => result.status === 'fulfilled')
  if (!hasSuccessfulPlayback && (unitDuration(unit) > 0 || unit.beats.length)) {
    timerStartedAt = performance.now()
    timerPlaying = true
  }
  startTicker()
  updatePlayButton()
}

function pauseCurrent() {
  timerOffset = relativeTime()
  timerPlaying = false
  internalMediaAction = true
  sharedAudio.pause()
  sharedVideo.pause()
  internalMediaAction = false
  cancelAnimationFrame(rafId)
  rafId = 0
  applyBeats(timerOffset)
  updatePlayButton()
}

function isPlaying() {
  const unit = currentUnit()
  if (!unit) return false
  if (narrationSource(unit) && !narrationFailed) return !sharedAudio.paused && !sharedAudio.ended
  if (mediaReady && unit.mode !== 'static') return !sharedVideo.paused && !sharedVideo.ended
  return timerPlaying
}

function togglePlayback() {
  if (isPlaying()) pauseCurrent()
  else playCurrent().catch(error => console.error('V18 播放失败：', error))
}

function updatePlayButton() {
  const button = elements.playBtn
  if (!button) return
  const unit = currentUnit()
  const canPlay = Boolean(
    unit && (
      narrationSource(unit)
      || mediaReady
      || unit.duration > 0
      || unit.beats.length
    )
  )
  const playing = isPlaying()
  button.disabled = !canPlay
  button.textContent = playing ? 'Ⅱ' : '▶'
  button.setAttribute('aria-pressed', String(playing))
  button.setAttribute('aria-label', playing ? '暂停本页讲解' : '播放本页讲解')
  button.title = narrationFailed && mediaReady ? '旁白未就绪，播放候选视频' : (playing ? '暂停' : '播放')
}

sharedAudio.addEventListener('play', () => {
  if (internalMediaAction) return
  timerPlaying = false
  startTicker()
  updatePlayButton()
})
sharedAudio.addEventListener('pause', updatePlayButton)
sharedAudio.addEventListener('timeupdate', () => {
  applyBeats(relativeTime())
  syncVideoToNarration()
})
sharedAudio.addEventListener('ended', finishPlayback)

sharedVideo.addEventListener('play', () => {
  if (internalMediaAction) return
  const unit = currentUnit()
  if (narrationSource(unit) && !narrationFailed && sharedAudio.paused) {
    const relative = Math.max(0, sharedVideo.currentTime - (unit.media?.in || 0))
    if (narrationReady && Number.isFinite(sharedAudio.duration)) sharedAudio.currentTime = Math.min(relative, sharedAudio.duration)
    sharedAudio.play().catch(() => {})
  }
  startTicker()
  updatePlayButton()
})

sharedVideo.addEventListener('pause', () => {
  if (internalMediaAction) return
  if (!sharedAudio.paused && !sharedAudio.ended) sharedAudio.pause()
  updatePlayButton()
})

sharedVideo.addEventListener('seeking', () => {
  const unit = currentUnit()
  if (!unit || !narrationReady || narrationFailed) return
  const relative = Math.max(0, sharedVideo.currentTime - (unit.media?.in || 0))
  if (Number.isFinite(sharedAudio.duration)) sharedAudio.currentTime = Math.min(relative, sharedAudio.duration)
  applyBeats(relative)
})

function populateNotes(unit) {
  if (elements.notesTitle) elements.notesTitle.textContent = `${String(unit.number).padStart(2, '0')} · ${unit.title.lines.join(' ')}`
  if (elements.notesNarration) elements.notesNarration.textContent = unit.narration.text || '本页暂无旁白。'
  if (!elements.notesBeats) return

  elements.notesBeats.replaceChildren()
  if (!unit.beats.length) {
    elements.notesBeats.append(createElement('p', 'notes-empty', '本页没有时间 beat。'))
    return
  }

  const list = createElement('ol', 'notes-beat-list')
  unit.beats.forEach(beat => {
    const end = Number.isFinite(beat.end) ? `–${beat.end.toFixed(1)}s` : '+'
    const visual = beat.visual ? `｜画面：${beat.visual}` : ''
    list.append(createElement('li', '', `${beat.start.toFixed(1)}s${end} · ${beatText(beat, unit) || beat.type}${visual}`))
  })
  elements.notesBeats.append(list)
}

function updateNavigation() {
  const total = units.length
  const page = currentIndex + 1
  if (elements.pageCounter) elements.pageCounter.textContent = `${String(page).padStart(2, '0')} / ${String(total).padStart(2, '0')}`
  if (elements.progressFill) {
    elements.progressFill.style.width = `${total ? (page / total) * 100 : 0}%`
    elements.progressFill.setAttribute('aria-valuenow', String(page))
    elements.progressFill.setAttribute('aria-valuemax', String(total))
  }
  elements.prevBtn?.toggleAttribute('disabled', currentIndex <= 0)
  elements.nextBtn?.toggleAttribute('disabled', currentIndex >= total - 1)
}

function syncHash() {
  const unit = currentUnit()
  if (!unit) return
  const hash = `#unit-${String(unit.number).padStart(2, '0')}`
  if (location.hash !== hash) history.replaceState(null, '', hash)
}

function indexFromHash() {
  const raw = decodeURIComponent(location.hash.slice(1)).trim()
  if (!raw) return 0

  const direct = units.findIndex(unit => unit.id === raw || unit.legacyHashes.includes(raw))
  if (direct >= 0) return direct

  const mapped = legacyHashMap[raw]
  if (mapped) {
    const mappedIndex = units.findIndex(unit => unit.id === mapped)
    if (mappedIndex >= 0) return mappedIndex
    const mappedUnit = mapped.match(/^unit-(\d{1,2})$/)
    if (mappedUnit) return Math.max(0, Math.min(units.length - 1, Number(mappedUnit[1]) - 1))
  }

  const unitMatch = raw.match(/^unit-(\d{1,2})$/)
  if (unitMatch) return Math.max(0, Math.min(units.length - 1, Number(unitMatch[1]) - 1))
  const numeric = Number.parseInt(raw, 10)
  return Number.isFinite(numeric) ? Math.max(0, Math.min(units.length - 1, numeric - 1)) : 0
}

function showUnit(index, { updateHash = true, autoplay = false } = {}) {
  if (!units.length) return
  pauseCurrent()
  currentIndex = Math.max(0, Math.min(units.length - 1, index))
  timerOffset = 0
  timerPlaying = false

  slides.forEach((slide, slideIndex) => {
    const active = slideIndex === currentIndex
    slide.classList.toggle('is-active', active)
    slide.classList.toggle('is-before', slideIndex < currentIndex)
    slide.hidden = !active
    slide.setAttribute('aria-hidden', String(!active))
    slide.toggleAttribute('inert', !active)
    slide.tabIndex = active ? 0 : -1
    if (active) slide.setAttribute('aria-current', 'page')
    else slide.removeAttribute('aria-current')
  })

  const unit = currentUnit()
  configureNarration(unit)
  configureMedia(unit)
  applyBeats(0)
  populateNotes(unit)
  updateNavigation()
  updatePlayButton()
  document.title = `${String(unit.number).padStart(2, '0')} · ${unit.title.lines.join(' ')}｜AXIOM Space`
  if (updateHash) syncHash()

  if (autoplay || autoplayRequested) {
    playCurrent().catch(() => updatePlayButton())
  }
}

function setDirectorMode(enabled) {
  directorMode = Boolean(enabled)
  document.body.classList.toggle('director', directorMode)
  document.body.classList.toggle('director-mode', directorMode)
  elements.directorBtn?.setAttribute('aria-pressed', String(directorMode))
  if (elements.directorBtn) elements.directorBtn.textContent = directorMode ? '导演开' : '导演'
  directorOnlyNodes.forEach(node => { node.hidden = !directorMode })
}

function setRecordingMode(enabled) {
  recordingMode = Boolean(enabled)
  document.body.classList.toggle('recording', recordingMode)
  document.body.dataset.recording = String(recordingMode)
  if (recordingMode) toggleNotes(false)
}

function toggleNotes(force) {
  const panel = elements.notesPanel
  if (!panel) return
  const wasOpen = panel.classList.contains('is-open')
  const open = typeof force === 'boolean' ? force : !wasOpen
  if (open && !wasOpen) notesReturnFocus = document.activeElement

  panel.classList.toggle('is-open', open)
  panel.hidden = !open
  panel.setAttribute('aria-hidden', String(!open))
  panel.toggleAttribute('inert', !open)
  elements.notesBtn?.setAttribute('aria-expanded', String(open))

  if (open) elements.closeNotes?.focus()
  else if (wasOpen && notesReturnFocus instanceof HTMLElement && document.contains(notesReturnFocus)) notesReturnFocus.focus({ preventScroll: true })
}

async function toggleFullscreen() {
  if (!document.fullscreenElement) await document.documentElement.requestFullscreen()
  else await document.exitFullscreen()
}

function isInteractiveTarget(target) {
  return target instanceof Element && Boolean(target.closest([
    'a[href]', 'button', 'input', 'textarea', 'select', 'video', 'audio',
    '[contenteditable="true"]', '[role="button"]', '[role="slider"]',
    '#notesPanel', '.v18-media-stage',
  ].join(', ')))
}

elements.prevBtn?.addEventListener('click', () => showUnit(currentIndex - 1))
elements.nextBtn?.addEventListener('click', () => showUnit(currentIndex + 1))
elements.playBtn?.addEventListener('click', togglePlayback)
elements.notesBtn?.addEventListener('click', () => toggleNotes())
elements.closeNotes?.addEventListener('click', () => toggleNotes(false))
elements.directorBtn?.addEventListener('click', () => setDirectorMode(!directorMode))
elements.fullscreenBtn?.addEventListener('click', () => toggleFullscreen().catch(() => {}))

addEventListener('hashchange', () => showUnit(indexFromHash(), { updateHash: false }))
addEventListener('fullscreenchange', () => {
  elements.fullscreenBtn?.setAttribute('aria-pressed', String(Boolean(document.fullscreenElement)))
})

addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    toggleNotes(false)
    return
  }
  if (isInteractiveTarget(event.target)) return

  if (['ArrowRight', 'PageDown', 'Enter', ' '].includes(event.key)) {
    event.preventDefault()
    showUnit(currentIndex + 1)
  } else if (['ArrowLeft', 'PageUp'].includes(event.key)) {
    event.preventDefault()
    showUnit(currentIndex - 1)
  } else if (event.key === 'Home') {
    event.preventDefault()
    showUnit(0)
  } else if (event.key === 'End') {
    event.preventDefault()
    showUnit(units.length - 1)
  } else if (event.key.toLowerCase() === 'p') {
    event.preventDefault()
    togglePlayback()
  } else if (event.key.toLowerCase() === 'n') {
    event.preventDefault()
    toggleNotes()
  } else if (event.key.toLowerCase() === 'd') {
    event.preventDefault()
    setDirectorMode(!directorMode)
  } else if (event.key.toLowerCase() === 'r') {
    event.preventDefault()
    setRecordingMode(!recordingMode)
  } else if (event.key.toLowerCase() === 'f') {
    event.preventDefault()
    toggleFullscreen().catch(() => {})
  }
})

let pointerGesture = null
addEventListener('pointerdown', event => {
  if (!event.isPrimary || event.button !== 0 || isInteractiveTarget(event.target)) {
    pointerGesture = null
    return
  }
  pointerGesture = { id: event.pointerId, x: event.clientX, y: event.clientY }
})

addEventListener('pointerup', event => {
  if (!pointerGesture || event.pointerId !== pointerGesture.id) return
  const deltaX = event.clientX - pointerGesture.x
  const deltaY = event.clientY - pointerGesture.y
  pointerGesture = null
  if (Math.abs(deltaX) > 72 && Math.abs(deltaX) > Math.abs(deltaY) * 1.2) {
    showUnit(currentIndex + (deltaX < 0 ? 1 : -1))
  }
})

addEventListener('pointercancel', () => { pointerGesture = null })
addEventListener('beforeunload', () => {
  cancelAnimationFrame(rafId)
  sharedAudio.pause()
  sharedVideo.pause()
})

document.documentElement.classList.toggle('reduced-motion', prefersReducedMotion)
setDirectorMode(directorMode)
setRecordingMode(recordingMode)
toggleNotes(false)
showUnit(indexFromHash(), { updateHash: true, autoplay: autoplayRequested })
document.documentElement.dataset.deckVersion = 'V18-integrated'
document.documentElement.dataset.unitCount = String(units.length)
