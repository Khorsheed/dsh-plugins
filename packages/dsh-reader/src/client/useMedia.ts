/**
 * The detail view's media half, as one hook: the transcript's state, the
 * 「字幕」 switch, the remembered position, the current paragraph and
 * following it, and seeking from a paragraph's time.
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

/** How long a hand scroll pauses following (ms). */
const FOLLOW_PAUSE_MS = 6000

/** Positions kept per entry, at most. */
const MAX_POSITIONS = 200

const POSITIONS_KEY = 'dsh-reader.mediaPositions'
const HIDDEN_KEY = 'dsh-reader.captionsHidden'

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
  readonly follow: boolean
  readonly setFollow: (on: boolean) => void
  /** Jump the player to a moment. */
  readonly seek: (seconds: number) => void
}

/**
 * The open entry's media state.
 *
 * @param input - what the pane already holds.
 */
export function useMedia(input: UseMediaInput): MediaFace {
  const { entryId, media, articleHtml, articleRef, detailRef } = input
  const [transcriptOf, setTranscriptOf] = useState<{ entryId: string; state: TranscriptState } | undefined>(undefined)
  const transcript = transcriptOf !== undefined && transcriptOf.entryId === entryId ? transcriptOf.state : undefined
  const setTranscript = useCallback((id: string, state: TranscriptState) => { setTranscriptOf({ entryId: id, state }) }, [])
  const [hiddenIds, setHiddenIds] = useState<Record<string, boolean>>(() => readRecord<boolean>(HIDDEN_KEY))
  const [follow, setFollow] = useState(true)
  const playerRef = useRef<MediaPlayerHandle | null>(null)
  const nowRef = useRef<Element | null>(null)
  const pausedUntil = useRef(0)
  const ownScroll = useRef(false)
  const lastSaved = useRef(0)

  const startAt = entryId === undefined ? 0 : readRecord<number>(POSITIONS_KEY)[entryId] ?? 0
  const hidden = entryId !== undefined && hiddenIds[entryId] === true

  // A different entry: no paragraph is playing yet.
  useEffect(() => { nowRef.current = null }, [entryId])

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
      chip.setAttribute('aria-label', formatClock(seconds))
      block.prepend(chip)
    }
  }, [articleHtml, media, articleRef])

  const seek = useCallback((seconds: number) => {
    pausedUntil.current = 0
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

  // A hand scroll pauses following for a moment; our own scroll does not.
  useEffect(() => {
    const scroller = detailRef.current
    if (scroller === null || media === undefined) return
    const onScroll = (): void => {
      if (ownScroll.current) return
      pausedUntil.current = Date.now() + FOLLOW_PAUSE_MS
    }
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => { scroller.removeEventListener('scroll', onScroll) }
  }, [media, detailRef, entryId])

  const onTime = useCallback((seconds: number) => {
    if (entryId === undefined) return
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
    if (follow && Date.now() >= pausedUntil.current) {
      ownScroll.current = true
      current.scrollIntoView({ block: 'center', behavior: 'smooth' })
      setTimeout(() => { ownScroll.current = false }, 800)
    }
  }, [entryId, articleRef, follow])

  return {
    media,
    transcript,
    setTranscript,
    hidden,
    setHidden,
    startAt,
    playerRef,
    onTime,
    follow,
    setFollow,
    seek,
  }
}
