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
 * The PLACE is persisted, the CONTENT is not. `sessionStorage` carries the four
 * fields that say where the reader was (the open entry, the view, the article
 * anchors, the wall's offset), because "where I was reading" is not third-party
 * content and the reader's report was exactly that a reload — or anything else
 * that restarts the page — lost it. What stays out of every storage is the
 * translated text and the translator sessions: those are a third party's words,
 * and this package's rule is that they never leave the page. So after a reload
 * the article and the position come back, and the globe does not (there is no
 * session to restore it with, and rebuilding one needs a gesture).
 *
 * Everything else — the wall's narrowing, the read cursor, the wall's own
 * translation switch and its card texts — is memory only: it is about this
 * visit. Host state (cached bodies, sources, the 「最近阅读」 list) is read from
 * the host, as always.
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
  /** Whether the wall folds republished duplicates (default ON). */
  readonly hideDupes: boolean
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
 *
 * `text` is the same place once more, as a CHARACTER offset into the block's
 * text. A pixel offset into a block is only valid for the layout it was
 * measured in: the translated view sets different words (Chinese runs shorter
 * than English), so the same paragraph is a different height and `offset`
 * points at the wrong sentence. `text` restores exactly (a Range rect) when the
 * block still holds the same text, and as the same FRACTION of the text when it
 * does not. `textLength` is how the restore tells those two apart. Both are
 * optional: anchors written before them restore via the pixel offset, as
 * before.
 */
export interface ReaderReadingAnchor {
  readonly block: number
  readonly offset: number
  readonly top: number
  readonly text?: number
  readonly textLength?: number
}

type Patch = Partial<ReaderSessionSnapshot>

/**
 * The fields that survive the page restarting: where the reader was, and nothing
 * that came from a third party.
 *
 * Mutable on purpose — this layer is read at boot, kept in step by every write,
 * and handed to `sessionStorage`; the snapshot's own fields are readonly.
 */
interface PersistedPlace {
  view?: ReaderView
  openEntryId?: string | null
  openSourceId?: string | null
  scroll?: Record<string, ReaderReadingAnchor>
  wallScroll?: number
}

const PLACE_KEY = 'dsh-reader:place'

/**
 * The persisted layer, read ONCE at module load.
 *
 * It is a separate layer from the page's memory rather than something rebuilt
 * from it: the memory only holds the fields this page has touched, so writing
 * the place from the memory alone erased everything the page had not touched yet
 * — which is exactly the case a page restart creates, and it made the restore
 * find nothing on the very first mount.
 */
let PLACE: PersistedPlace | null = null

/** The persisted layer, read on first use (so the module can be imported before
 * storage exists — and so a test can seed it before mounting the pane). */
function place(): PersistedPlace {
  if (PLACE === null) PLACE = loadPlace()
  return PLACE
}

/** The page's one snapshot. */
let PAGE: Patch = {}

/** The place as `sessionStorage` has it, field by field. */
function loadPlace(): PersistedPlace {
  try {
    const raw = globalThis.sessionStorage?.getItem(PLACE_KEY)
    if (raw === null || raw === undefined || raw === '') return {}
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return {}
    const record = parsed as Record<string, unknown>
    // Field by field: the value in storage is from an older revision of this
    // package as often as not, and one bad field must not poison the rest.
    return {
      ...(record.view === 'list' || record.view === 'detail' || record.view === 'manage' || record.view === 'recent' ? { view: record.view } : {}),
      ...(typeof record.openEntryId === 'string' || record.openEntryId === null ? { openEntryId: record.openEntryId } : {}),
      ...(typeof record.openSourceId === 'string' || record.openSourceId === null ? { openSourceId: record.openSourceId } : {}),
      ...(typeof record.scroll === 'object' && record.scroll !== null ? { scroll: record.scroll as Record<string, ReaderReadingAnchor> } : {}),
      ...(typeof record.wallScroll === 'number' ? { wallScroll: record.wallScroll } : {}),
    }
  } catch {
    // A sandboxed or full storage is not an error: the pane still works, it just
    // forgets where it was when the page restarts.
    return {}
  }
}

/** Persist the place; a storage that refuses is a degraded pane, not a failure. */
function writePlace(): void {
  try {
    globalThis.sessionStorage?.setItem(PLACE_KEY, JSON.stringify(place()))
  } catch {
    // ignore
  }
}

/** Bring the persisted layer in step with a patch, for the fields it owns. */
function updatePlace(patch: Patch): void {
  const next: PersistedPlace = { ...place() }
  if ('view' in patch) next.view = patch.view
  if ('openEntryId' in patch) next.openEntryId = patch.openEntryId
  if ('openSourceId' in patch) next.openSourceId = patch.openSourceId
  if ('scroll' in patch) next.scroll = patch.scroll
  if ('wallScroll' in patch) next.wallScroll = patch.wallScroll
  PLACE = next
  writePlace()
}

/**
 * What the page remembers, or `{}` when it remembers nothing yet.
 *
 * The persisted place sits UNDER the in-memory snapshot: within one page the
 * memory is the truth (it has fields the place does not), and after a restart
 * the place is all there is.
 *
 * @returns the snapshot (a copy of the recorded fields).
 */
export function readSession(): Patch {
  return { ...place(), ...PAGE }
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
  updatePlace(patch)
}

/** Drop the snapshot, here and in storage (the specs call this between cases). */
export function forgetSession(): void {
  PAGE = {}
  // Back to "not read yet", not to "nothing": the next read must consult storage
  // again (clearing it first, so what it finds is the truth).
  PLACE = null
  try {
    globalThis.sessionStorage?.removeItem(PLACE_KEY)
  } catch {
    // ignore
  }
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
        // Optional, so an anchor the scroll handler cannot measure (a block
        // with no text) keeps the old shape exactly.
        ...(anchor.text === undefined ? {} : { text: Math.max(0, Math.round(anchor.text)) }),
        ...(anchor.textLength === undefined ? {} : { textLength: Math.max(0, Math.round(anchor.textLength)) }),
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
