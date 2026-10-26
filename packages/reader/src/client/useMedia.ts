/**
 * The detail view's media half, as one hook: the transcript's state, the
 * 「字幕」 switch, the remembered position, the current paragraph and
 * following it, seeking from a paragraph's time, and the player's size (full,
 * or the mini bar while the reader is down in the transcript).
 *
 * Following: the playing paragraph scrolls into view until the reader
 * scrolls by hand; then it stops — no timer pulls the page back — and
 * 「回到正在播放」 resumes it (2026-10-20).
 *
 * The transcript is the article body (`<p data-t>` blocks, captions.ts). This
 * hook only decorates it — a time chip per paragraph, drawn from a
 * `data-label` through CSS so a selection never picks the time up — and marks
 * the current paragraph with `data-now`. It never rewrites text nodes, which
 * belong to `translate.ts`.
 *
 * @module @khorsheed/dsh-reader/client/useMedia
 */
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import { formatClock } from '../captions.ts'
import type { ReaderMedia } from '../media.ts'
import type { MediaPlayerHandle } from './MediaPlayer.tsx'
import { blockElements } from './notes.ts'

/** Where a media entry's transcript stands. */
export type TranscriptState = 'loading' | 'ready' | 'none' | 'failed'

/** Scrolled this far into the transcript, a video shrinks to the mini bar (px)… */
const MINI_AFTER_PX = 160
/** …and back near the top it opens again. */
const FULL_BEFORE_PX = 24

/** Positions kept per entry, at most. */
const MAX_POSITIONS = 200

const POSITIONS_KEY = 'dsh-reader.mediaPositions'
const HIDDEN_KEY = 'dsh-reader.captionsHidden'
const HINT_KEY = 'dsh-reader.timeHintSeen'

/** A small per-browser record (a convenience: an empty store is a fine answer). */
function readRecord<T>(key: string): Record<string, T> {
  try {
    return JSON.parse(globalThis.localStorage?.getItem(key) ?? '{}') as Record<string, T>
  } catch {
    return {}
  }
}

function writeRecord(key: string, value: Record<string, unknown>): void {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value))
  } catch {
    // Private window / blocked storage: the position simply is not remembered.
  }
}

/** The start time a block carries (`data-t`), when it is a transcript paragraph. */
export function blockTime(element: Element | undefined): number | undefined {
  const value = element?.getAttribute('data-t')
  if (value === null || value === undefined) return undefined
  const seconds = Number(value)
  return Number.isFinite(seconds) ? seconds : undefined
}

/** What the hook reads from the pane. */
export interface UseMediaInput {
  readonly entryId: string | undefined
  readonly media: ReaderMedia | undefined
  readonly articleHtml: string | null
  readonly articleRef: MutableRefObject<HTMLDivElement | null>
  readonly detailRef: MutableRefObject<HTMLDivElement | null>
  /** A time chip's tooltip, from its clock label. */
  readonly chipTitle: (clock: string) => string
  /** A speaker's display name, for paragraphs that carry `data-spk`. */
  readonly speakerLabel: (speaker: number) => string
}

/** What the pane renders from. */
export interface MediaFace {
  readonly media: ReaderMedia | undefined
  readonly transcript: TranscriptState | undefined
  /** Record an entry's transcript state (keyed by entry: an answer for another entry never shows). */
  readonly setTranscript: (entryId: string, state: TranscriptState) => void
  readonly hidden: boolean
  readonly setHidden: (hidden: boolean) => void
  readonly startAt: number
  readonly playerRef: MutableRefObject<MediaPlayerHandle | null>
  readonly onTime: (seconds: number) => void
  /** Following stopped by a hand scroll, with a playing paragraph to go back to. */
  readonly followPaused: boolean
  /** Scroll back to the playing paragraph and follow again. */
  readonly resumeFollow: () => void
  /** The video as the mini bar. */
  readonly mini: boolean
  readonly setMini: (mini: boolean) => void
  /** The one-time 「点时间可以跳转」 hint is still owed. */
  readonly hintOwed: boolean
  readonly dismissHint: () => void
  /** Jump the player to a moment. */
  readonly seek: (seconds: number) => void
}

/**
 * The open entry's media state.
 *
 * @param input - what the pane already holds.
 */
export function useMedia(input: UseMediaInput): MediaFace {
  const { entryId, media, articleHtml, articleRef, detailRef, chipTitle, speakerLabel } = input
  const [transcriptOf, setTranscriptOf] = useState<{ entryId: string; state: TranscriptState } | undefined>(undefined)
  const transcript = transcriptOf !== undefined && transcriptOf.entryId === entryId ? transcriptOf.state : undefined
  const setTranscript = useCallback((id: string, state: TranscriptState) => { setTranscriptOf({ entryId: id, state }) }, [])
  const [hiddenIds, setHiddenIds] = useState<Record<string, boolean>>(() => readRecord<boolean>(HIDDEN_KEY))
  const [followPaused, setFollowPaused] = useState(false)
  const [mini, setMiniState] = useState(false)
  const [hintOwed, setHintOwed] = useState(() => {
    try {
      return globalThis.localStorage?.getItem(HINT_KEY) !== '1'
    } catch {
      return false
    }
  })
  const playerRef = useRef<MediaPlayerHandle | null>(null)
  const nowRef = useRef<Element | null>(null)
  const paused = useRef(false)
  /** A mini bar the reader asked for stays until they open it again. */
  const pinnedMini = useRef(false)
  const ownScroll = useRef(false)
  /** When the playback time last moved (a paused video has nothing to follow). */
  const advancedAt = useRef(0)
  const lastSeconds = useRef<number | undefined>(undefined)
  const lastSaved = useRef(0)

  const startAt = entryId === undefined ? 0 : readRecord<number>(POSITIONS_KEY)[entryId] ?? 0
  const hidden = entryId !== undefined && hiddenIds[entryId] === true

  // A different entry: no paragraph is playing yet, the player opens full.
  useEffect(() => {
    nowRef.current = null
    paused.current = false
    pinnedMini.current = false
    setFollowPaused(false)
    setMiniState(false)
  }, [entryId])

  const setMini = useCallback((value: boolean) => {
    pinnedMini.current = value
    setMiniState(value)
  }, [])

  const dismissHint = useCallback(() => {
    setHintOwed(false)
    try {
      globalThis.localStorage?.setItem(HINT_KEY, '1')
    } catch {
      // The hint shows again next time; harmless.
    }
  }, [])

  const setHidden = useCallback((value: boolean) => {
    if (entryId === undefined) return
    setHiddenIds(current => {
      const next = { ...current }
      if (value) next[entryId] = true
      else delete next[entryId]
      writeRecord(HIDDEN_KEY, next)
      return next
    })
  }, [entryId])

  // Decorate the transcript's paragraphs with their time chip.
  useEffect(() => {
    const article = articleRef.current
    if (article === null || media === undefined) return
    for (const block of blockElements(article)) {
      const seconds = blockTime(block)
      if (seconds === undefined || block.querySelector(':scope > [data-reader-ts]') !== null) continue
      const chip = article.ownerDocument.createElement('button')
      chip.type = 'button'
      chip.setAttribute('data-reader-ts', String(seconds))
      chip.setAttribute('data-label', formatClock(seconds))
      chip.setAttribute('data-reader-no-translate', '1')
      chip.setAttribute('aria-label', chipTitle(formatClock(seconds)))
      chip.title = chipTitle(formatClock(seconds))
      block.prepend(chip)
    }
  }, [articleHtml, media, articleRef, chipTitle])

  // Who speaks: a name at the start of the paragraph where the voice changes
  // (a transcript's habit — not repeated on every paragraph), drawn from CSS
  // content like the time, so selections and translation never take it; kept
  // current as the reader renames a speaker.
  useEffect(() => {
    const article = articleRef.current
    if (article === null || media === undefined) return
    let previous: string | null = null
    for (const block of blockElements(article)) {
      const spk = block.getAttribute('data-spk')
      if (spk === null) continue
      const changes = spk !== previous
      previous = spk
      let label = block.querySelector(':scope > [data-reader-spk]')
      if (!changes) {
        label?.remove()
        continue
      }
      if (label === null) {
        label = article.ownerDocument.createElement('span')
        label.setAttribute('data-reader-spk', spk)
        label.setAttribute('data-reader-no-translate', '1')
        const chip = block.querySelector(':scope > [data-reader-ts]')
        if (chip !== null) chip.after(label)
        else block.prepend(label)
      }
      label.setAttribute('data-label', speakerLabel(Number(spk)))
    }
  }, [articleHtml, media, articleRef, speakerLabel])

  const seek = useCallback((seconds: number) => {
    paused.current = false
    setFollowPaused(false)
    playerRef.current?.seek(seconds)
  }, [])

  // A chip click seeks (capture phase: it must not reach the translation click).
  useEffect(() => {
    const article = articleRef.current
    if (article === null || media === undefined) return
    const onClick = (event: MouseEvent): void => {
      const chip = (event.target as Element | null)?.closest?.('[data-reader-ts]')
      if (chip === null || chip === undefined) return
      event.preventDefault()
      event.stopPropagation()
      seek(Number(chip.getAttribute('data-reader-ts')))
    }
    article.addEventListener('click', onClick, true)
    return () => { article.removeEventListener('click', onClick, true) }
  }, [articleHtml, media, articleRef, seek])

  // A hand scroll stops following (our own scroll does not), and the scroll
  // depth sizes a video: down in the transcript it is the mini bar.
  useEffect(() => {
    const scroller = detailRef.current
    if (scroller === null || media === undefined) return
    const onScroll = (): void => {
      if (media.kind === 'video' && !pinnedMini.current) {
        if (scroller.scrollTop > MINI_AFTER_PX) setMiniState(true)
        else if (scroller.scrollTop < FULL_BEFORE_PX) setMiniState(false)
      }
    }
    // Only the reader's own gestures stop following — a layout change (the
    // player shrinking) scrolls too, and must not count.
    const onHand = (): void => {
      if (ownScroll.current || paused.current || nowRef.current === null) return
      if (Date.now() - advancedAt.current > 3000) return
      paused.current = true
      setFollowPaused(true)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) onHand()
    }
    scroller.addEventListener('scroll', onScroll, { passive: true })
    scroller.addEventListener('wheel', onHand, { passive: true })
    scroller.addEventListener('touchmove', onHand, { passive: true })
    scroller.addEventListener('keydown', onKey)
    return () => {
      scroller.removeEventListener('scroll', onScroll)
      scroller.removeEventListener('wheel', onHand)
      scroller.removeEventListener('touchmove', onHand)
      scroller.removeEventListener('keydown', onKey)
    }
  }, [media, detailRef, entryId])

  const onTime = useCallback((seconds: number) => {
    if (entryId === undefined) return
    if (lastSeconds.current !== undefined && Math.abs(seconds - lastSeconds.current) > 0.05) advancedAt.current = Date.now()
    lastSeconds.current = seconds
    // The position, every few seconds of play (not on every tick).
    if (Math.abs(seconds - lastSaved.current) >= 5) {
      lastSaved.current = seconds
      const positions = readRecord<number>(POSITIONS_KEY)
      delete positions[entryId]
      const next: Record<string, number> = { [entryId]: Math.floor(seconds), ...positions }
      writeRecord(POSITIONS_KEY, Object.fromEntries(Object.entries(next).slice(0, MAX_POSITIONS)))
    }
    const article = articleRef.current
    if (article === null) return
    let current: Element | undefined
    for (const block of blockElements(article)) {
      const t = blockTime(block)
      if (t === undefined) continue
      if (t > seconds + 0.25) break
      current = block
    }
    if (current === undefined || current === nowRef.current) return
    nowRef.current?.removeAttribute('data-now')
    current.setAttribute('data-now', '1')
    nowRef.current = current
    if (!paused.current) {
      ownScroll.current = true
      current.scrollIntoView({ block: 'center', behavior: 'smooth' })
      setTimeout(() => { ownScroll.current = false }, 1200)
    }
  }, [entryId, articleRef])

  const resumeFollow = useCallback(() => {
    paused.current = false
    setFollowPaused(false)
    const current = nowRef.current
    if (current === null) return
    ownScroll.current = true
    current.scrollIntoView({ block: 'center', behavior: 'smooth' })
    setTimeout(() => { ownScroll.current = false }, 1200)
  }, [])

  return {
    media,
    transcript,
    setTranscript,
    hidden,
    setHidden,
    startAt,
    playerRef,
    onTime,
    followPaused,
    resumeFollow,
    mini,
    setMini,
    hintOwed,
    dismissHint,
    seek,
  }
}
