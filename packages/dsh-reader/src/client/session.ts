/**
 * Where the reader was, kept for as long as the page is.
 *
 * The host unmounts the whole right sidebar when another main panel takes over
 * (`RightbarRoot` renders only while `activePanelId === null`), and the pane's
 * store is created per mount — so returning from the side chat used to lose the
 * open article, the reading position, the wall's narrowing and the fact that a
 * translation was on. This module is the fix: one snapshot in module memory.
 *
 * ONE bucket for the whole page, not one per dsh session. The pane is mounted
 * per session, so keying this by `sessionId` meant "open the reader in another
 * conversation" started from scratch — the same wall, the same article, the
 * same translation, all to be set up again. The reader is one person reading one
 * wall; the session id stays what it is genuinely for (the conversation draft,
 * the side-chat context key), and nothing else here is session-bound.
 *
 * Deliberately NOT persisted. Everything here is where the reader was LOOKING,
 * not what they collected: a reload is a fresh visit, and keeping third-party
 * translated text on disk would contradict this package's "the translation never
 * leaves the page" rule. (Surviving a reload would mean `sessionStorage`; that
 * was considered and declined.) The two things that DO outlive a reload are host
 * state and are read from there: the cached article bodies (keyed by entry id in
 * `state.json`) and the 「最近阅读」 list.
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
  /**
   * Where the reader was inside each entry.
   *
   * An ANCHOR, not a pixel offset: the body's height is not final when it first
   * renders (an article's images carry no dimensions, so they grow the document
   * as they load), and a remembered pixel position then points at different
   * content — which is how a reader ends up back at the top of a paper.
   */
  readonly scroll: Record<string, ReaderReadingAnchor>
  /** Where the WALL itself was scrolled to, in pixels. */
  readonly wallScroll?: number
  /** The translation view a reader chose per entry (its presence means "globe was on"). */
  readonly translationView: Record<string, TranslationView>
  /** The source language that view was built for, so the cached session is findable. */
  readonly translationSource: Record<string, string>
}

/**
 * Where the reader was inside one entry.
 *
 * `block` + `offset` name a place in the DOCUMENT (the Nth top-level block, and
 * how far into it the viewport top sat), so it survives everything above it
 * changing height. `top` is the same place as a pixel offset: the fast path when
 * the layout is already settled, and the only thing left when the body is not
 * the one the anchor was taken from.
 */
export interface ReaderReadingAnchor {
  readonly block: number
  readonly offset: number
  readonly top: number
}

type Patch = Partial<ReaderSessionSnapshot>

/** The page's one snapshot. */
let PAGE: Patch = {}

/**
 * What the page remembers, or `{}` when it remembers nothing yet.
 *
 * @returns the snapshot (a copy of the recorded fields).
 */
export function readSession(): Patch {
  return { ...PAGE }
}

/**
 * Record what changed.
 *
 * A field set to `undefined` is dropped rather than stored: "no record" and
 * "recorded as nothing" would otherwise be two spellings of the same state.
 *
 * @param patch - the fields to replace.
 */
export function patchSession(patch: Patch): void {
  const next: Patch = { ...PAGE }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete next[key as keyof Patch]
    else Object.assign(next, { [key]: value })
  }
  PAGE = next
}

/** Drop the snapshot (the specs call this between cases). */
export function forgetSession(): void {
  PAGE = {}
}

/**
 * Remember where the reader was inside one entry.
 *
 * @param entryId - the entry whose body was on screen.
 * @param anchor - the place in the document the viewport top sat at.
 */
export function rememberReadingPosition(entryId: string, anchor: ReaderReadingAnchor): void {
  patchSession({
    scroll: {
      ...PAGE.scroll,
      [entryId]: {
        block: Math.max(0, Math.round(anchor.block)),
        offset: Math.max(0, Math.round(anchor.offset)),
        top: Math.max(0, Math.round(anchor.top)),
      },
    },
  })
}

/**
 * Remember where the reader had scrolled the wall itself.
 *
 * The wall is the other long scroller in this pane, and losing its place is the
 * same complaint as losing the place inside an article.
 *
 * @param top - the wall scroller's offset in pixels.
 */
export function rememberWallScroll(top: number): void {
  patchSession({ wallScroll: Math.max(0, Math.round(top)) })
}

/**
 * Remember that one entry is showing a translation, and in which view.
 *
 * @param entryId - the entry that was translated.
 * @param view - the view that was on screen, or `'orig'` to forget it.
 * @param source - the source language the translator was built for.
 */
export function rememberTranslation(entryId: string, view: TranslationView, source: string): void {
  const translationView = { ...PAGE.translationView }
  const translationSource = { ...PAGE.translationSource }
  if (view === 'orig') {
    // The globe is off: that is the state to restore, and a record that outlived
    // it would turn the globe back on the next time this entry is opened.
    delete translationView[entryId]
    delete translationSource[entryId]
  } else {
    translationView[entryId] = view
    translationSource[entryId] = source
  }
  patchSession({ translationView, translationSource })
}

/**
 * Forget one entry's translation record (a re-fetch replaced its body).
 *
 * @param entryId - the entry whose body changed.
 */
export function forgetTranslation(entryId: string): void {
  if (PAGE.translationView?.[entryId] === undefined) return
  const translationView = { ...PAGE.translationView }
  const translationSource = { ...PAGE.translationSource }
  delete translationView[entryId]
  delete translationSource[entryId]
  patchSession({ translationView, translationSource })
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
