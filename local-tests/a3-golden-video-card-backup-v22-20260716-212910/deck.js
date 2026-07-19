import { A3_STORY } from './story.js?v=22'

async function ensureDeckStyles() {
  const link = document.querySelector('link[data-deck-style]')
  let stylesheetLoaded = false

  try {
    stylesheetLoaded = Boolean(link?.sheet?.cssRules?.length)
  } catch {
    stylesheetLoaded = Boolean(link?.sheet)
  }

  if (stylesheetLoaded) return

  const response = await fetch(link?.href || './deck.css?v=22', { cache: 'no-store' })
  if (!response.ok) throw new Error(`Unable to load deck styles: ${response.status}`)

  const style = document.createElement('style')
  style.dataset.deckStyleFallback = 'true'
  style.textContent = await response.text()
  document.head.append(style)
  if (link) link.disabled = true
}

await ensureDeckStyles();

(() => {
  const EXPECTED_SLIDE_COUNT = 15
  const allSlides = [...document.querySelectorAll('.slide')]

  if (!allSlides.length) return
  if (allSlides.length !== EXPECTED_SLIDE_COUNT) {
    console.warn(`AXIOM V14 预期 ${EXPECTED_SLIDE_COUNT} 页，当前读取到 ${allSlides.length} 页。`)
  }

  const storyById = new Map(A3_STORY.map(item => [item.id, item]))
  if (storyById.size !== EXPECTED_SLIDE_COUNT) {
    console.warn(`AXIOM 逐页稿预期 ${EXPECTED_SLIDE_COUNT} 条，当前读取到 ${storyById.size} 条。`)
  }

  allSlides.forEach(slide => {
    const id = `${slide.dataset.scene}-${slide.dataset.kind}`
    const story = storyById.get(id)
    if (!story) {
      console.warn(`未找到 ${id} 的逐页叙事稿。`)
      return
    }

    slide.dataset.title = story.shortTitle
    slide.classList.add('has-story-copy')

    const headerParts = slide.querySelectorAll('.chrome > span')
    const pageSuffix = story.kind === 'content' ? 'A' : 'B'
    if (headerParts[0]) headerParts[0].textContent = `${story.scene}${pageSuffix} · ${story.shortTitle}`
    if (headerParts[1]) headerParts[1].textContent = story.phase

    const kicker = slide.querySelector('.v8-kicker')
    const title = slide.querySelector('.v8-title')
    const footer = slide.querySelector('.foot > span:first-child')
    const notes = slide.querySelector('.notes')
    if (kicker) kicker.textContent = story.kicker
    if (title) title.innerHTML = story.headingHtml
    if (footer) footer.textContent = story.footer
    if (notes) notes.textContent = story.narration

    const summary = document.createElement('p')
    summary.className = 'v8-story-summary'
    summary.textContent = story.summary

    if (story.kind === 'video') {
      const heading = slide.querySelector('.v8-video-heading')
      heading?.after(summary)
      slide.querySelector('.v8-video-page')?.classList.add('has-story-summary')

      const placeholder = slide.querySelector('.v8-video-empty')
      const placeholderLabel = placeholder?.querySelector('span')
      const placeholderTitle = placeholder?.querySelector('strong')
      const placeholderSummary = placeholder?.querySelector('p')
      if (placeholderLabel) placeholderLabel.textContent = `SCENE ${story.scene}B · 小林案例实录`
      if (placeholderTitle) placeholderTitle.textContent = title?.textContent.trim() || story.shortTitle
      if (placeholderSummary) placeholderSummary.textContent = story.summary
    } else {
      slide.querySelector('.v8-lead')?.append(summary)
    }
  })

  const query = new URLSearchParams(location.search)
  const recordingMode = query.get('record') === '1'
  const videosEnabled = query.get('videos') !== '0'
  const narrationEnabled = query.get('narration') !== '0'
  const narrationAutoplayRequested = query.get('autoplay') !== '0'
  const slides = allSlides

  if (!slides.length) return

  const counter = document.getElementById('counter')
  const progress = document.getElementById('progress')
  const progressTrack = progress?.parentElement
  const panel = document.getElementById('notesPanel')
  const notesTitle = document.getElementById('notesTitle')
  const notesText = document.getElementById('notesText')
  const prevButton = document.getElementById('prev')
  const nextButton = document.getElementById('next')
  const notesButton = document.getElementById('notes')
  const closeNotesButton = document.getElementById('closeNotes')
  const fullscreenButton = document.getElementById('fullscreen')
  const narrationButton = document.getElementById('narration')
  const narrationStatus = document.getElementById('narrationStatus')
  document.body.classList.add('director')
  document.body.classList.toggle('recording', recordingMode)
  const videoEntries = [...document.querySelectorAll('.v8-video')]
    .filter(video => video instanceof HTMLVideoElement)
    .map(video => {
      const stage = video.closest('.v8-video-stage')
      const placeholder = stage?.querySelector('.v8-video-empty') || null

      video.preload = 'none'
      video.muted = true
      video.defaultMuted = true
      placeholder?.setAttribute('aria-hidden', 'false')

      return {
        video,
        stage,
        placeholder,
        slide: video.closest('.slide'),
        sources: [...video.querySelectorAll('source[data-src]')],
        failedSources: new Set(),
        state: 'idle'
      }
    })
  const narrationEntries = slides
    .map(slide => {
      const src = slide.dataset.narration?.trim()
      if (!src) return null

      const audio = document.createElement('audio')
      audio.className = 'slide-narration'
      audio.preload = 'none'
      audio.src = src
      audio.hidden = true
      slide.append(audio)

      return {
        audio,
        slide,
        src,
        state: 'idle'
      }
    })
    .filter(Boolean)

  const totalLabel = String(slides.length).padStart(2, '0')

  counter?.setAttribute('aria-live', 'polite')
  counter?.setAttribute('aria-atomic', 'true')
  progress?.setAttribute('aria-hidden', 'true')
  progressTrack?.setAttribute('role', 'progressbar')
  progressTrack?.setAttribute('aria-label', '演示进度')
  progressTrack?.setAttribute('aria-valuemin', '1')
  progressTrack?.setAttribute('aria-valuemax', String(slides.length))
  panel?.setAttribute('aria-hidden', 'true')
  panel?.toggleAttribute('inert', true)
  notesButton?.setAttribute('aria-expanded', 'false')
  notesButton?.setAttribute('aria-controls', 'notesPanel')
  fullscreenButton?.setAttribute('aria-pressed', 'false')
  narrationButton?.setAttribute('aria-pressed', 'false')

  allSlides.forEach(slide => {
    const index = slides.indexOf(slide)
    const isVisible = index >= 0

    slide.hidden = !isVisible
    slide.setAttribute('aria-hidden', 'true')
    slide.toggleAttribute('inert', true)
    if (!isVisible) return

    const pageLabel = String(index + 1).padStart(2, '0')
    const slideTitle = slide.dataset.title || `第 ${index + 1} 页`
    const page = slide.querySelector('.foot span:last-child')

    slide.dataset.page = String(index + 1)
    slide.setAttribute('role', 'group')
    slide.setAttribute('aria-roledescription', '幻灯片')
    slide.setAttribute('aria-label', `${pageLabel} / ${totalLabel}：${slideTitle}`)
    if (page) page.textContent = `${pageLabel} / ${totalLabel}`
  })

  function pageFromHash() {
    const hash = decodeURIComponent(location.hash.slice(1))
    const sceneMatch = hash.match(/^scene-(\d{2})(-video)?$/)
    if (sceneMatch) {
      const [, scene, videoSuffix] = sceneMatch
      const requestedKind = videoSuffix ? 'video' : 'content'
      const exactIndex = slides.findIndex(slide => slide.dataset.scene === scene && slide.dataset.kind === requestedKind)
      if (exactIndex >= 0) return exactIndex

      const contentIndex = slides.findIndex(slide => slide.dataset.scene === scene && slide.dataset.kind === 'content')
      return contentIndex >= 0 ? contentIndex : 0
    }

    const raw = Number.parseInt(hash, 10)
    return Number.isFinite(raw) ? raw - 1 : 0
  }

  function clamp(index) {
    return Math.max(0, Math.min(slides.length - 1, index))
  }

  let current = clamp(pageFromHash())
  let narrationAutoplayActive = narrationEnabled && narrationAutoplayRequested
  let narrationAutoplayBlocked = false

  function narrationForSlide(slide) {
    return narrationEntries.find(entry => entry.slide === slide) || null
  }

  function videoForSlide(slide) {
    return videoEntries.find(entry => entry.slide === slide) || null
  }

  function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '00:00'
    const minutes = Math.floor(seconds / 60)
    const remainder = Math.floor(seconds % 60)
    return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
  }

  function loadNarration(entry) {
    if (!narrationEnabled || !entry || entry.state !== 'idle') return
    entry.state = 'loading'
    entry.audio.preload = 'metadata'
    entry.audio.load()
  }

  function updateNarrationUi() {
    const entry = narrationForSlide(slides[current])
    const available = narrationEnabled && Boolean(entry) && entry?.state !== 'error'
    const playing = available && !entry.audio.paused && !entry.audio.ended

    narrationButton?.toggleAttribute('disabled', !available)
    narrationButton?.setAttribute('aria-pressed', String(playing))
    narrationButton?.setAttribute('aria-label', playing ? '暂停自动讲解' : '播放并开启自动讲解')
    narrationButton?.setAttribute('title', playing ? '暂停自动讲解' : '播放并开启自动讲解')
    if (narrationButton) narrationButton.textContent = playing ? 'Ⅱ' : '▶'

    if (!narrationStatus) return
    if (!narrationEnabled) {
      narrationStatus.textContent = '讲解关闭'
    } else if (!entry) {
      narrationStatus.textContent = '无讲解'
    } else if (entry.state === 'error') {
      narrationStatus.textContent = '讲解未就绪'
    } else if (narrationAutoplayBlocked && entry.audio.paused) {
      narrationStatus.textContent = '点击播放，开启逐页自动讲解'
    } else if (entry.audio.ended) {
      narrationStatus.textContent = '本页讲解完成'
    } else if (Number.isFinite(entry.audio.duration)) {
      narrationStatus.textContent = `${formatTime(entry.audio.currentTime)} / ${formatTime(entry.audio.duration)}`
    } else {
      narrationStatus.textContent = '讲解'
    }
  }

  async function playNarration(entry) {
    if (!narrationEnabled || !entry) return
    loadNarration(entry)

    const videoEntry = videoForSlide(entry.slide)
    const playback = [entry.audio.play()]
    if (videoEntry && videosEnabled) {
      loadVideo(videoEntry)
      videoEntry.video.muted = true
      if (videoEntry.video.ended) videoEntry.video.currentTime = 0
      if (
        Number.isFinite(videoEntry.video.duration) &&
        Math.abs(videoEntry.video.currentTime - entry.audio.currentTime) > 0.4
      ) {
        videoEntry.video.currentTime = Math.min(entry.audio.currentTime, videoEntry.video.duration)
      }
      playback.push(videoEntry.video.play())
    }
    const [audioResult] = await Promise.allSettled(playback)
    if (audioResult.status === 'rejected') throw audioResult.reason

    narrationAutoplayBlocked = false
    updateNarrationUi()
  }

  function handleNarrationPlayFailure(entry, error) {
    if (error?.name === 'NotAllowedError') {
      narrationAutoplayBlocked = true
    } else {
      entry.state = 'error'
    }
    updateNarrationUi()
  }

  function pauseNarration(entry) {
    if (!entry) return
    entry.audio.pause()
    videoForSlide(entry.slide)?.video.pause()
    updateNarrationUi()
  }

  function toggleNarration() {
    const entry = narrationForSlide(slides[current])
    if (!entry || !narrationEnabled) return

    if (entry.audio.paused || entry.audio.ended) {
      narrationAutoplayActive = true
      narrationAutoplayBlocked = false
      if (entry.audio.ended) entry.audio.currentTime = 0
      playNarration(entry).catch(error => handleNarrationPlayFailure(entry, error))
    } else {
      narrationAutoplayActive = false
      pauseNarration(entry)
    }
  }

  function syncHash() {
    const slide = slides[current]
    const suffix = slide.dataset.kind === 'video' ? '-video' : ''
    const hash = `#scene-${slide.dataset.scene}${suffix}`
    if (location.hash !== hash) history.replaceState(null, '', hash)
  }

  function markVideoReady(entry) {
    if (entry.state === 'error') return

    entry.state = 'ready'
    entry.stage?.classList.remove('is-loading', 'is-error')
    entry.stage?.classList.add('is-ready', 'has-video')
    if (entry.placeholder) {
      entry.placeholder.style.display = 'none'
      entry.placeholder.setAttribute('aria-hidden', 'true')
    }
  }

  function markVideoError(entry) {
    if (entry.state === 'error') return

    entry.state = 'error'
    entry.video.pause()
    entry.video.removeAttribute('src')
    entry.sources.forEach(source => source.removeAttribute('src'))
    entry.stage?.classList.remove('is-loading', 'is-ready', 'has-video')
    entry.stage?.classList.add('is-error')

    if (!entry.placeholder) return

    entry.placeholder.style.display = 'grid'
    entry.placeholder.setAttribute('aria-hidden', 'false')
    entry.placeholder.setAttribute('role', 'alert')
  }

  function loadVideo(entry) {
    if (!videosEnabled || entry.state !== 'idle') return

    const sources = entry.sources.filter(source => source.dataset.src?.trim())
    if (!sources.length) {
      markVideoError(entry)
      return
    }

    entry.state = 'loading'
    entry.failedSources.clear()
    entry.stage?.classList.remove('is-ready', 'is-error', 'has-video')
    entry.stage?.classList.add('is-loading')
    if (entry.placeholder) {
      // Keep the placeholder visible while the browser resolves metadata. This
      // also overrides the legacy :has(source[src]) rule until the media is ready.
      entry.placeholder.style.display = 'grid'
      entry.placeholder.setAttribute('aria-hidden', 'false')
      entry.placeholder.setAttribute('role', 'status')
    }

    entry.video.preload = 'metadata'
    sources.forEach(source => { source.src = source.dataset.src.trim() })
    entry.video.load()
  }

  videoEntries.forEach(entry => {
    entry.video.addEventListener('loadedmetadata', () => markVideoReady(entry))
    entry.video.addEventListener('canplay', () => markVideoReady(entry))
    entry.video.addEventListener('error', () => {
      if (entry.state === 'loading') markVideoError(entry)
    })
    entry.video.addEventListener('play', () => {
      if (entry.slide !== slides[current]) return
      const narration = narrationForSlide(entry.slide)
      if (!narration || !narrationEnabled || !narration.audio.paused) return
      narrationAutoplayActive = true
      loadNarration(narration)
      if (Number.isFinite(narration.audio.duration)) {
        narration.audio.currentTime = Math.min(entry.video.currentTime, narration.audio.duration)
      }
      narration.audio.play().catch(() => {})
    })
    entry.video.addEventListener('pause', () => {
      if (entry.slide !== slides[current] || entry.video.ended) return
      const narration = narrationForSlide(entry.slide)
      if (narration && !narration.audio.paused) narration.audio.pause()
    })
    entry.video.addEventListener('seeking', () => {
      const narration = narrationForSlide(entry.slide)
      if (!narration || !Number.isFinite(narration.audio.duration)) return
      narration.audio.currentTime = Math.min(entry.video.currentTime, narration.audio.duration)
    })
    entry.sources.forEach(source => {
      source.addEventListener('error', () => {
        if (entry.state !== 'loading') return
        entry.failedSources.add(source)
        if (entry.failedSources.size === entry.sources.length) markVideoError(entry)
      })
    })
  })

  narrationEntries.forEach(entry => {
    entry.audio.addEventListener('loadedmetadata', () => {
      entry.state = 'ready'
      if (entry.slide === slides[current]) updateNarrationUi()
    })
    entry.audio.addEventListener('play', () => {
      if (entry.slide !== slides[current]) return
      narrationAutoplayBlocked = false
      const videoEntry = videoForSlide(entry.slide)
      if (videoEntry && videosEnabled && videoEntry.video.paused && !videoEntry.video.ended) {
        videoEntry.video.muted = true
        videoEntry.video.play().catch(() => {})
      }
      updateNarrationUi()
    })
    entry.audio.addEventListener('pause', updateNarrationUi)
    entry.audio.addEventListener('timeupdate', () => {
      if (entry.slide !== slides[current]) return
      const videoEntry = videoForSlide(entry.slide)
      if (
        videoEntry &&
        !videoEntry.video.paused &&
        !videoEntry.video.ended &&
        Math.abs(videoEntry.video.currentTime - entry.audio.currentTime) > 0.55
      ) {
        videoEntry.video.currentTime = Math.min(entry.audio.currentTime, videoEntry.video.duration || entry.audio.currentTime)
      }
      updateNarrationUi()
    })
    entry.audio.addEventListener('ended', () => {
      videoForSlide(entry.slide)?.video.pause()
      updateNarrationUi()
    })
    entry.audio.addEventListener('error', () => {
      entry.state = 'error'
      if (entry.slide === slides[current]) updateNarrationUi()
    })
  })

  function show(index, { updateHash = true } = {}) {
    current = clamp(index)
    const activeSlide = slides[current]

    videoEntries.forEach(entry => {
      if (entry.slide !== activeSlide) {
        entry.video.pause()
        entry.video.currentTime = 0
      }
    })
    narrationEntries.forEach(entry => {
      if (entry.slide !== activeSlide) {
        entry.audio.pause()
        entry.audio.currentTime = 0
      }
    })

    allSlides.forEach(slide => {
      const slideIndex = slides.indexOf(slide)
      const isVisible = slideIndex >= 0
      const isActive = slide === activeSlide
      slide.classList.toggle('is-active', isActive)
      slide.classList.toggle('is-before', isVisible && slideIndex < current)
      slide.setAttribute('aria-hidden', String(!isActive))
      slide.toggleAttribute('inert', !isActive)
      slide.tabIndex = isActive ? 0 : -1
      if (isActive) slide.setAttribute('aria-current', 'page')
      else slide.removeAttribute('aria-current')
    })

    const pageLabel = String(current + 1).padStart(2, '0')
    const slideTitle = slides[current].dataset.title || `第 ${current + 1} 页`

    if (counter) counter.textContent = `${pageLabel} / ${totalLabel}`
    if (progress) progress.style.width = `${((current + 1) / slides.length) * 100}%`
    progressTrack?.setAttribute('aria-valuenow', String(current + 1))
    progressTrack?.setAttribute('aria-valuetext', `第 ${current + 1} 页，共 ${slides.length} 页`)
    if (notesTitle) notesTitle.textContent = `${pageLabel} · ${slideTitle}`
    if (notesText) notesText.textContent = slides[current].querySelector('.notes')?.textContent.trim() || ''

    prevButton?.toggleAttribute('disabled', current === 0)
    nextButton?.toggleAttribute('disabled', current === slides.length - 1)
    document.title = `${pageLabel} · ${slideTitle}｜AXIOM Space`
    if (updateHash) syncHash()

    videoEntries.forEach(entry => {
      if (entry.slide === activeSlide) loadVideo(entry)
    })
    const activeNarration = narrationForSlide(activeSlide)
    loadNarration(activeNarration)
    updateNarrationUi()
    if (narrationAutoplayActive && activeNarration) {
      playNarration(activeNarration).catch(error => handleNarrationPlayFailure(activeNarration, error))
    }
  }

  let notesReturnFocus = null

  function toggleNotes(force) {
    if (!panel) return
    if (!document.body.classList.contains('director')) return
    const wasOpen = panel.classList.contains('is-open')
    const open = typeof force === 'boolean' ? force : !panel.classList.contains('is-open')

    if (open && !wasOpen) {
      notesReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : notesButton
    }

    panel.classList.toggle('is-open', open)
    panel.setAttribute('aria-hidden', String(!open))
    panel.toggleAttribute('inert', !open)
    notesButton?.setAttribute('aria-expanded', String(open))
    if (open) {
      closeNotesButton?.focus()
    } else if (wasOpen) {
      const focusTarget = notesReturnFocus instanceof HTMLElement && document.contains(notesReturnFocus)
        ? notesReturnFocus
        : notesButton
      focusTarget?.focus({ preventScroll: true })
      notesReturnFocus = null
    }
  }

  function toggleRecording() {
    const willRecord = !document.body.classList.contains('recording')
    document.body.classList.toggle('recording', willRecord)
    toggleNotes(false)
  }

  async function toggleFullscreen() {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen()
    else await document.exitFullscreen()
  }

  prevButton?.addEventListener('click', () => {
    show(current - 1)
    prevButton.blur()
  })
  nextButton?.addEventListener('click', () => {
    show(current + 1)
    nextButton.blur()
  })
  narrationButton?.addEventListener('click', () => {
    toggleNarration()
    narrationButton.blur()
  })
  notesButton?.addEventListener('click', () => toggleNotes())
  closeNotesButton?.addEventListener('click', () => toggleNotes(false))
  fullscreenButton?.addEventListener('click', () => toggleFullscreen().catch(() => {}))

  addEventListener('hashchange', () => show(pageFromHash(), { updateHash: false }))
  addEventListener('fullscreenchange', () => {
    fullscreenButton?.setAttribute('aria-pressed', String(Boolean(document.fullscreenElement)))
  })

  const interactiveSelector = [
    'a[href]',
    'button',
    'input',
    'textarea',
    'select',
    'video',
    'audio',
    '[contenteditable="true"]',
    '[role="button"]',
    '[role="slider"]'
  ].join(', ')

  function isInteractiveTarget(target) {
    return target instanceof Element && Boolean(target.closest(interactiveSelector))
  }

  addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      toggleNotes(false)
      return
    }

    // Let focused buttons and native media controls own Enter/Space so their
    // click or playback action cannot also advance the deck.
    if (isInteractiveTarget(event.target)) return

    if (['ArrowRight', 'PageDown', 'Enter', ' '].includes(event.key)) {
      event.preventDefault()
      show(current + 1)
    } else if (['ArrowLeft', 'PageUp'].includes(event.key)) {
      event.preventDefault()
      show(current - 1)
    } else if (event.key === 'Home') {
      event.preventDefault()
      show(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      show(slides.length - 1)
    } else if (event.key.toLowerCase() === 'n') {
      event.preventDefault()
      toggleNotes()
    } else if (event.key.toLowerCase() === 'r') {
      event.preventDefault()
      toggleRecording()
    } else if (event.key.toLowerCase() === 'f') {
      event.preventDefault()
      toggleFullscreen().catch(() => {})
    } else if (event.key.toLowerCase() === 'p') {
      event.preventDefault()
      toggleNarration()
    }
  })

  let pointerGesture = null
  addEventListener('pointerdown', event => {
    const target = event.target
    const isBlocked = target instanceof Element && Boolean(target.closest('.v8-video-stage, .controls, .notes-panel'))
    if (!event.isPrimary || event.button !== 0 || isInteractiveTarget(target) || isBlocked) {
      pointerGesture = null
      return
    }

    pointerGesture = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY
    }
  })
  addEventListener('pointerup', event => {
    if (!pointerGesture || event.pointerId !== pointerGesture.id) return

    const deltaX = event.clientX - pointerGesture.x
    const deltaY = event.clientY - pointerGesture.y
    pointerGesture = null
    if (Math.abs(deltaX) > 80 && Math.abs(deltaX) > Math.abs(deltaY) * 1.2) {
      show(current + (deltaX < 0 ? 1 : -1))
    } else if (narrationAutoplayActive && narrationAutoplayBlocked) {
      const entry = narrationForSlide(slides[current])
      if (entry) playNarration(entry).catch(error => handleNarrationPlayFailure(entry, error))
    }
  })
  addEventListener('pointercancel', () => { pointerGesture = null })

  show(current)
})()
