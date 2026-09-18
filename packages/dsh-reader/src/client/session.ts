/**
 * Where the reader was, kept for as long as the page is.
 *
 * The host unmounts the whole right sidebar when another main panel takes over
 * (`RightbarRoot` renders only while `activePanelId === null`), and the pane's
 * store is created per mount — so returning from the side chat used to lose the
 * open article, the reading position, the wall's narrowing and the fact that a
 * translation was on. This module is the fix: one snapshot per session, in
 * module memory.
 *
 * Deliberately NOT persisted. Everything here is where the reader was LOOKING,
 * not what they collected: a reload is a fresh visit, and keeping third-party
 * translated text on disk would contradict this package's "the translation never
 * leaves the page" rule. (Surviving a reload would mean `sessionStorage`; that
 * was considered and declined.)
 *
 * @module @khorsheed/dsh-reader/client/session
 */
import type { ReaderFilter, ReaderSort, ReaderView } from './store.ts'
import type { TranslationView, TranslatorSessionLike } from './translate.ts'

/** One session's worth of "where the reader was". */
export interface ReaderSessionSnapshot {
  readonly view: ReaderView
  readonly openEntryId: string | null
  readonly openSourceId: string | null
  readonly filter: ReaderFilter
  readonly query: string
  readonly sort: ReaderSort
  readonly unreadOnly: boolean
  readonly read: Record<string, true>
  /** Which surface was translated on the wall, and how it was shown. */
  readonly wallOn: boolean
  readonly wallBoth: boolean
  /** Card translations already produced (small: title and summary per entry). */
  readonly cardTranslations: Record<string, { title?: string; summary?: string }>
  /** Reading position per entry, in pixels. */
  readonly scroll: Record<string, number>
  /** The translation view a reader chose per entry (its presence means "globe was on"). */
  readonly translationView: Record<string, TranslationView>
  /** The source language that view was built for, so the cached session is findable. */
  readonly translationSource: Record<string, string>
}

type Patch = Partial<ReaderSessionSnapshot>

/**
 * How many sessions keep a snapshot.
 *
 * A page holds a handful of sessions at most, but the map must not grow without
 * a bound in a long-lived tab; the oldest session is dropped first (Map keeps
 * insertion order, and a write re-inserts).
 */
const MAX_SESSIONS = 12

const SESSIONS = new Map<string, Patch>()

/**
 * The snapshot for one session, or `{}` when it has none.
 *
 * @param sessionId - the pane's session.
 * @returns the snapshot (a copy of the recorded fields).
 */
export function readSession(sessionId: string): Patch {
  const stored = SESSIONS.get(sessionId)
  return stored === undefined ? {} : { ...stored }
}

/**
 * Record what changed for one session.
 *
 * A field set to `undefined` is dropped rather than stored: "no record" and
 * "recorded as nothing" would otherwise be two spellings of the same state.
 *
 * @param sessionId - the pane's session.
 * @param patch - the fields to replace.
 */
export function patchSession(sessionId: string, patch: Patch): void {
  const current = SESSIONS.get(sessionId) ?? {}
  const next: Patch = { ...current }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete next[key as keyof Patch]
    else Object.assign(next, { [key]: value })
  }
  // Re-insertion is what makes the map's order an LRU: a touched session moves
  // to the end, so the eviction below drops the one nobody came back to.
  SESSIONS.delete(sessionId)
  SESSIONS.set(sessionId, next)
  while (SESSIONS.size > MAX_SESSIONS) {
    const oldest = SESSIONS.keys().next()
    if (oldest.done === true) break
    SESSIONS.delete(oldest.value)
  }
}

/** Drop one session's snapshot (the specs call this between cases). */
export function forgetSession(sessionId: string): void {
  SESSIONS.delete(sessionId)
}

/**
 * Remember where the reader had scrolled inside one entry.
 *
 * @param sessionId - the pane's session.
 * @param entryId - the entry whose body was on screen.
 * @param top - the scroller's offset in pixels.
 */
export function rememberScroll(sessionId: string, entryId: string, top: number): void {
  const snapshot = readSession(sessionId)
  patchSession(sessionId, { scroll: { ...snapshot.scroll, [entryId]: Math.max(0, Math.round(top)) } })
}

/**
 * Remember that one entry is showing a translation, and in which view.
 *
 * @param sessionId - the pane's session.
 * @param entryId - the entry that was translated.
 * @param view - the view that was on screen, or `'orig'` to forget it.
 * @param source - the source language the translator was built for.
 */
export function rememberTranslation(sessionId: string, entryId: string, view: TranslationView, source: string): void {
  const snapshot = readSession(sessionId)
  const translationView = { ...snapshot.translationView }
  const translationSource = { ...snapshot.translationSource }
  if (view === 'orig') {
    // The globe is off: that is the state to restore, and a record that outlived
    // it would turn the globe back on the next time this entry is opened.
    delete translationView[entryId]
    delete translationSource[entryId]
  } else {
    translationView[entryId] = view
    translationSource[entryId] = source
  }
  patchSession(sessionId, { translationView, translationSource })
}

/**
 * Forget one entry's translation record (a re-fetch replaced its body).
 *
 * @param sessionId - the pane's session.
 * @param entryId - the entry whose body changed.
 */
export function forgetTranslation(sessionId: string, entryId: string): void {
  const snapshot = readSession(sessionId)
  if (snapshot.translationView?.[entryId] === undefined) return
  const translationView = { ...snapshot.translationView }
  const translationSource = { ...snapshot.translationSource }
  delete translationView[entryId]
  delete translationSource[entryId]
  patchSession(sessionId, { translationView, translationSource })
}

/* ------------------------------------------------------- translator sessions */

/**
 * Translator sessions that are already built, keyed by language pair.
 *
 * Both halves of the pane share this: a session the wall built is the one the
 * detail view reuses, and — more importantly — a session that already exists can
 * translate WITHOUT a fresh `Translator.create()`, which is what Chrome requires
 * user activation for. That is what makes "the globe is still on when you come
 * back" possible without asking for a click.
 */
const TRANSLATOR_SESSIONS = new Map<string, TranslatorSessionLike>()

/** The cache key for one language pair. */
export function translationKey(sources: readonly string[], targets: readonly string[]): string {
  return `${sources.join(',')}→${targets.join(',')}`
}

/**
 * A built session for this pair, when one exists in this page.
 *
 * @param sources - source language candidates, in priority order.
 * @param targets - target language candidates, in priority order.
 * @returns the session, or `undefined`.
 */
export function cachedTranslator(sources: readonly string[], targets: readonly string[]): TranslatorSessionLike | undefined {
  return TRANSLATOR_SESSIONS.get(translationKey(sources, targets))
}

/**
 * Remember a session this page built.
 *
 * @param sources - source language candidates, in priority order.
 * @param targets - target language candidates, in priority order.
 * @param session - the built session.
 */
export function rememberTranslator(sources: readonly string[], targets: readonly string[], session: TranslatorSessionLike): void {
  TRANSLATOR_SESSIONS.set(translationKey(sources, targets), session)
}

/** Drop the translator sessions (the specs call this between cases). */
export function forgetTranslators(): void {
  TRANSLATOR_SESSIONS.clear()
}
