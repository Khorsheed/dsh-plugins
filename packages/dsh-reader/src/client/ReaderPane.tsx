/**
 * The inspiration space: the right-Sidebar tab body.
 *
 * It is the only React surface this package ships, and it owns the whole
 * interaction the design settled on:
 *
 * - **the wall** — one card per entry, with a search box, an all/today filter,
 *   an unread-only toggle and a sort menu. All four are local predicates over
 *   entries this process parsed (design decision D14), so none of them costs a
 *   round trip.
 * - **the detail view** — clicking a card opens it. This is the whole point:
 *   the body renders as DOM text, which is what makes passage quoting work
 *   (the QUOTE plugin's own selection menu sees it), and it is why the pane
 *   never hosts a sandboxed iframe.
 * - **the add dialog** — an overlay in the members-tab idiom, because adding is
 *   a momentary act and the wall should stay where it was behind it. The host
 *   decides whether a pasted URL is a feed or an article from what comes back
 *   (D15); this surface reports the verdict, plus the fetch seam's own words
 *   when the fetch failed.
 * - **the subscription page** — every source with its schedule, its pause
 *   switch and its last-fetch status. It exists because "why am I not seeing
 *   anything" and "stop refreshing this one" are questions about SOURCES, and
 *   neither belongs on the wall.
 *
 * The browser has no XML parser on the host side to lean on, so the pane parses
 * payloads itself through `parse-rss` / `extract-article`.
 *
 * @module @khorsheed/dsh-reader/client/ReaderPane
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  IconChevronDownOutlineMedium,
  IconChevronLeftOutlineMedium,
  IconClockOutlineMedium,
  IconCopyOutlineMedium,
  IconGlobeOutlineMedium,
  IconPlusOutlineMedium,
  IconRefreshOutlineMedium,
  IconRightUpOutlineMedium,
  IconSettingsOutlineMedium,
  IconTrashOutlineMedium,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ReaderPaneProps } from './contract.ts'
import {
  kindQuery,
  linkEntryId,
  READER_SOURCE_KINDS,
  type ReaderPreviewFailureCode,
  type ReaderRecentEntry,
  type ReaderSentenceLearn,
  type ReaderSourceKind,
  type ReaderStorageStats,
  type ReaderTag,
} from '../types.ts'
import { extractArticle } from './extract-article.ts'
import { parseFeed, type ReaderEntry } from './parse-rss.ts'
import { absoluteDate, clockOf, formatReaderRef, mergedDraft, provenanceOf, relativeWhen } from './quote.ts'
import {
  TARGET_CANDIDATES, buildArticle, createSession, detectSourceLanguage, detectTranslator, isTargetLanguage,
  primeMemory, restoreArticle, runTranslation, segmentAt, segmentsOf, setPairHover, setView, toggleSegment,
  translateTexts, translationHash,
  type BuiltArticle, type SessionOutcome, type TranslateClasses, type TranslationAvailability,
  type TranslationView, type TranslatorLike, type TranslatorSessionLike,
} from './translate.ts'
import {
  countUnread,
  dedupeRows,
  flattenEntries,
  fetchStateOf,
  LIST_RENDER_LIMIT,
  hueForSource,
  rowFor,
  selectRows,
  sourceQuery,
  tagQuery,
  tileForSource,
  type ReaderRow,
  type SourcePresentation,
} from './selectors.ts'
import {
  cachedTranslator,
  forgetTranslation,
  patchSession,
  readSession,
  rememberReadingPosition,
  rememberTranslation,
  rememberWallScroll,
  rememberTranslator,
  type ReaderReadingAnchor,
  type ReaderSessionSnapshot,
} from './session.ts'
import css from './ReaderPane.module.css'

/** One in-flight fetch's kind, for the verdict message. */
type Verdict = 'subscribed' | 'savedLink' | 'savedLinkNoPreview' | 'duplicate' | 'invalidUrl' | 'unsupportedContent' | 'fetchFailed'

/** A tiny stroke glyph set for the chrome the host has no icon for. */
const STROKE: Readonly<Record<string, string>> = {
  search: 'M7 2.2a4.8 4.8 0 1 0 0 9.6 4.8 4.8 0 0 0 0-9.6Zm3.4 8.2 3 3',
  filter: 'M2.6 3.4h10.8L9.2 8.3v4.1l-2.4-1.3V8.3z',
  funnel: 'M2.6 3.4h10.8L9.2 8.3v4.1l-2.4-1.3V8.3z',
  sort: 'M4.6 3v10M2.4 10.8 4.6 13l2.2-2.2M11.4 13V3M9.2 5.2 11.4 3l2.2 2.2',
  chevron: 'M6.2 3.4 10.7 8l-4.5 4.6',
  close: 'M4.4 4.4 11.6 11.6 M11.6 4.4 4.4 11.6',
  fetch: 'M8 2.6v8.2M4.8 7.8 8 11l3.2-3.2M3 13.4h10',
  check: 'M3.4 8.6 6.6 11.8 12.6 4.6',
  alert: 'M8 3.2v5.4M8 11.6v1.2',
}

/** Render one of the small stroke glyphs. */
function glyph(name: keyof typeof STROKE & string, size = 15): ReactNode {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={STROKE[name]} />
    </svg>
  )
}

/**
 * Whether the body's dominant script is CJK. The article typography differs by
 * script (line height, letter spacing and measure — see the design's D5), and
 * the script is a property of the TEXT, not of the source it came from.
 *
 * @param html - the normalized article markup.
 * @returns true when the body reads mostly as Han/Kana/Hangul.
 */
function isCjk(html: string): boolean {
  const text = html.replace(/<[^>]*>/g, '')
  if (text.length === 0) return false
  const cjk = text.match(/[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g)
  return (cjk?.length ?? 0) / text.length > 0.2
}

/** The wall's tag panel box: the width it is clamped with, and the height
 *  placement estimates from the vocabulary (its real height is bounded by CSS). */
const TAG_PANEL_WIDTH = 236
const TAG_PANEL_MAX_HEIGHT = 296

/**
 * How many sources it takes before the picker's own search box appears. Below
 * it the list is short enough to read at a glance, and an input that filters
 * three rows is noise; above it the list is unbounded and the box is the only
 * way to reach a name without scrolling.
 */
const SOURCE_SEARCH_MIN = 6

/** The one target language this milestone ships: Chinese, in the spellings the
 *  candidate chain in `translate.ts` knows how to try. Only the language PICKER
 *  is deferred — every layer below takes the tag as a parameter. */
const TRANSLATION_TARGET = TARGET_CANDIDATES[0] ?? 'zh'

/** The globe's menu, in the order it renders (view id + dictionary key). */
const TRANSLATION_VIEWS = [
  { view: 'trans', key: 'translate.onlyTranslation' },
  { view: 'both', key: 'translate.bilingual' },
  { view: 'orig', key: 'translate.onlyOriginal' },
] as const

/**
 * The tag vocabulary, as rows: the card panel's checklist and the detail page's
 * inline editor both render this.
 *
 * It replaces the native `<datalist>` those two inputs used to share. The
 * browser draws that popup itself — outside the pane's surface, with no way to
 * mark which tags are already on the entry, and with no way to offer the one
 * action the vocabulary does not already contain: creating the name you typed.
 *
 * @param t - the namespace translator.
 * @param tags - the whole vocabulary, in the host's order.
 * @param applied - the tag ids already on this entry.
 * @param draft - what the input currently holds; empty means "show everything".
 * @param onToggle - apply or remove one tag.
 * @param onCreate - make (or reuse) a tag from the typed name and apply it.
 */
function TagSuggestions({ t, tags, applied, draft, onToggle, onCreate }: {
  readonly t: ReaderPaneProps['t']
  readonly tags: readonly ReaderTag[]
  readonly applied: readonly string[]
  readonly draft: string
  readonly onToggle: (tag: ReaderTag) => void
  readonly onCreate: (name: string) => void
}): ReactNode {
  const name = draft.trim()
  const needle = name.toLowerCase()
  const suggested = needle === '' ? tags : tags.filter(tag => tag.name.toLowerCase().includes(needle))
  const exact = tags.some(tag => tag.name.toLowerCase() === needle)
  return (
    <>
      {suggested.map(tag => {
        const on = applied.includes(tag.id)
        return (
          <button
            key={tag.id}
            type="button"
            className={css.tagRow}
            data-on={on || undefined}
            // Keep the field focused: the detail editor closes on blur, and a
            // mousedown that moves focus would dismiss the list mid-click.
            onMouseDown={event => { event.preventDefault() }}
            onClick={() => { onToggle(tag) }}
          >
            <span className={css.tagRowCheck}>{on ? '✓' : ''}</span>
            <span className={css.tagRowName}>{tag.name}</span>
          </button>
        )
      })}
      {name !== '' && !exact && (
        <button
          type="button"
          className={css.tagCreate}
          onMouseDown={event => { event.preventDefault() }}
          onClick={() => { onCreate(name) }}
        >
          <IconPlusOutlineMedium size={12} />
          <span className={css.tagRowName}>{t('tag.create', { name })}</span>
        </button>
      )}
    </>
  )
}

/** The dictionary key each verdict message lives under. */
const VERDICT_KEY: Readonly<Record<Verdict, 'verdict.subscribed' | 'verdict.savedLink' | 'verdict.savedLinkNoPreview' | 'verdict.duplicate' | 'verdict.invalidUrl' | 'verdict.unsupportedContent' | 'verdict.fetchFailed'>> = {
  subscribed: 'verdict.subscribed',
  savedLink: 'verdict.savedLink',
  savedLinkNoPreview: 'verdict.savedLinkNoPreview',
  duplicate: 'verdict.duplicate',
  invalidUrl: 'verdict.invalidUrl',
  unsupportedContent: 'verdict.unsupportedContent',
  fetchFailed: 'verdict.fetchFailed',
}

/** Map an `addSource` refusal onto its verdict message. */
function verdictForRefusal(refusal: string): Verdict {
  switch (refusal) {
    case 'duplicate': return 'duplicate'
    case 'invalid-url': return 'invalidUrl'
    case 'unsupported-content': return 'unsupportedContent'
    default: return 'fetchFailed'
  }
}

/** The dictionary key for each reason a link cannot be previewed. */
const PREVIEW_KEY: Readonly<Record<ReaderPreviewFailureCode,
  | 'preview.blocked' | 'preview.login' | 'preview.unsupportedType' | 'preview.redirected'
  | 'preview.empty' | 'preview.unreachable' | 'preview.http' | 'preview.unreadable'>> = {
  blocked: 'preview.blocked',
  login: 'preview.login',
  'unsupported-type': 'preview.unsupportedType',
  redirected: 'preview.redirected',
  empty: 'preview.empty',
  unreachable: 'preview.unreachable',
  http: 'preview.http',
  unreadable: 'preview.unreadable',
}

/**
 * The failure causes a real browser can solve: a bot wall, a login wall, a
 * non-web file, a known-unreadable app — each opens fine where a human is
 * driving. The other codes differ per action: `unreachable` is the retryable
 * one, and `http` / `empty` / `redirected` are final (no gesture changes the
 * answer), which is exactly the retry policy `isRetryablePreviewFailure`
 * states host-side.
 */
const OPEN_IN_BROWSER_CODES: ReadonlySet<ReaderPreviewFailureCode> = new Set(['blocked', 'login', 'unsupported-type', 'unreadable'])

/**
 * Why this link has no body to show, in the reader's words.
 *
 * A recorded CODE is preferred over the raw message: the code is the host's
 * classification (a bot wall, a login wall, a PDF) and each one sends the
 * reader somewhere different, while the seam's message is diagnostic text
 * written for whoever debugs this next.
 *
 * @param t - the namespace translator.
 * @param code - the host's classification, when there is one.
 * @param fallback - the message to show when there is no code.
 * @returns the sentence.
 */
function previewReason(t: ReaderPaneProps['t'], code: ReaderPreviewFailureCode | undefined, fallback: string): string {
  return code === undefined ? describeFetchFailure(fallback, t) : t(PREVIEW_KEY[code])
}

/**
 * One "when" phrase, with its count filled in.
 *
 * `when.minutes` / `when.hours` / `when.days` are parameterized copy, so
 * rendering the bare key prints `{count} d ago` at the reader. Every site that
 * shows a relative time goes through here.
 *
 * @param t - the namespace translator.
 * @param iso - the instant, when there is one.
 * @returns the phrase.
 */
function whenLabel(t: ReaderPaneProps['t'], iso: string | undefined): string {
  const when = relativeWhen(iso, new Date())
  return when.count === undefined ? t(when.key) : t(when.key, { count: when.count })
}

/**
 * Turn a fetch/extraction failure into the sentence it deserves.
 *
 * The seam's reasons are distinguishable and the reader needs the distinction: a
 * bot challenge is final, an unreachable host is not, and an unreadable
 * extraction is a third thing again. Claiming "exceeds the fetch cap" for all
 * three was measured wrong on the acceptance instance, whose recorded reason
 * was `web fetch failed: TypeError: fetch failed`.
 *
 * @param reason - the reason the host or the extractor reported.
 * @param t - the namespace translator.
 * @returns the reader-facing sentence.
 */
function describeFetchFailure(reason: string, t: ReaderPaneProps['t']): string {
  if (/^HTTP (401|403)/.test(reason)) return t('sources.blocked')
  if (/^HTTP \d{3}/.test(reason)) return t('sources.httpError')
  if (/fetch failed|timed out|timeout|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|network|socket/i.test(reason)) {
    return t('sources.unreachable')
  }
  return t('detail.fetchFailed', { reason: reason.slice(0, 160) })
}

/** How many entries the automatic backfill fetches at once. */
const BACKFILL_CONCURRENCY = 2

/**
 * How many animation frames a restored reading position keeps trying.
 *
 * A body can still be growing when it first renders (images decoding, fonts
 * settling, the real page arriving after the feed's summary), and an offset that
 * cannot be reached yet is silently clamped. ~half a second of retries covers
 * the first layout; the resize observer below covers the slow part.
 */
const SCROLL_SETTLE_ATTEMPTS = 30

/**
 * How fresh a human scroll gesture must be for a scroll event to count as the
 * reader's.
 *
 * The pane's own writes are caught by the echo guard; a BROWSER's writes are
 * not — when the document shrinks under a scrolled scroller (a translation
 * rebuild, a body swap, the remount's intermediate short states) the browser
 * clamps the offset and fires a scroll event that looks exactly like the
 * reader's. Measured on the live instance: a remount's translation rebuild
 * clamped the scroller and the clamp overwrote the stored anchor with the
 * clamped value, so the reader came back to the top. Only wheel / touchmove /
 * page-key gestures are the reader; a scroll event with no recent one is the
 * browser's and is never recorded.
 */
const SCROLL_GESTURE_WINDOW_MS = 400

/**
 * How long a restored reading position keeps re-anchoring itself.
 *
 * An article's images carry no dimensions, so the document keeps growing well
 * after the body renders — the acceptance instance's paper has 27 of them. While
 * the reader has not scrolled, re-anchoring on every layout change is what keeps
 * them at the same SENTENCE instead of the same pixel. After this window the
 * position is theirs.
 */
const POSITION_SETTLE_MS = 20_000

/**
 * Format the store's character accounting as an approximate size.
 *
 * The host counts CHARACTERS (every budget in the document is written in
 * chars), and this readout must never pretend to a precision the unit does not
 * have — so it says MB/KB of text, one decimal at most.
 */
function formatStorageSize(chars: number): string {
  if (chars >= 1_000_000) return `${(chars / 1_000_000).toFixed(1)} MB`
  return `${Math.max(1, Math.round(chars / 1_000))} KB`
}

/**
 * The article's top-level blocks, ignoring the translation's own reveal lines.
 *
 * The ordinals are what the reading position is anchored to, so the nodes
 * `translate.ts` inserts between blocks must not count: a translated article has
 * one reveal under most paragraphs, and counting them would make a remembered
 * block index point somewhere else entirely.
 */
function articleBlocks(article: HTMLElement): HTMLElement[] {
  return [...article.children].filter(child => child.getAttribute('data-reader-reveal') !== '1') as HTMLElement[]
}

/** The article's geometry, measured in ONE pass (see `measureArticle`). */
interface ArticleMetrics {
  /** The article's top in the scroller's content coordinates. */
  readonly contentTop: number
  /** Each top-level block's geometry and text, relative to the article. */
  readonly blocks: readonly ArticleBlockMetrics[]
  /** The article's own height. */
  readonly height: number
}

/**
 * One top-level block, measured.
 *
 * `textLength` is captured in the same pass so the scroll handler can record a
 * TEXT offset without touching the DOM; `element` is what lets a restore
 * resolve that offset to an exact pixel spot (a Range rect) later.
 */
export interface ArticleBlockMetrics {
  readonly top: number
  readonly height: number
  /** How long the block's text was at measure time. */
  readonly textLength: number
  /** The block itself, for the text-offset resolution. */
  readonly element: HTMLElement
}

/**
 * Measure the article once.
 *
 * Reading layout is what makes Chrome report "forced reflow", and an article can
 * have hundreds of blocks — so this happens when the layout CHANGES (a new body,
 * a resize), never inside a scroll handler. Anchoring then costs no layout read
 * at all, which is what a scroll handler needs.
 *
 * @param scroller - the detail view's scroll container.
 * @param article - the rendered article.
 * @returns the metrics, or `null` when there is no layout to measure.
 */
function measureArticle(scroller: HTMLElement, article: HTMLElement): ArticleMetrics | null {
  const articleRect = article.getBoundingClientRect()
  // No layout (a headless test, or a body that has not been measured yet): an
  // anchor would be meaningless, and the caller falls back to the pixel offset.
  if (articleRect.height <= 0) return null
  const contentTop = articleRect.top - scroller.getBoundingClientRect().top + scroller.scrollTop
  const blocks = articleBlocks(article).map(block => {
    const rect = block.getBoundingClientRect()
    return {
      top: rect.top - articleRect.top,
      height: rect.height,
      textLength: block.textContent?.length ?? 0,
      element: block,
    }
  })
  return { contentTop, blocks, height: articleRect.height }
}

/**
 * Which block the viewport top is in, and how far into it — from the cache.
 *
 * A binary search rather than a walk: this runs on every scroll event, and the
 * walk it replaces is exactly the forced reflow the browser reported.
 *
 * @param metrics - the last measurement.
 * @param visibleY - how far into the article the viewport top sits.
 * @returns the block index and the offset into it.
 */
function blockAt(metrics: ArticleMetrics, visibleY: number): { block: number; offset: number } {
  const blocks = metrics.blocks
  if (blocks.length === 0) return { block: 0, offset: Math.max(0, visibleY) }
  let low = 0
  let high = blocks.length - 1
  let found = 0
  while (low <= high) {
    const middle = (low + high) >> 1
    const block = blocks[middle]!
    if (block.top + block.height > visibleY) {
      found = middle
      high = middle - 1
    } else {
      low = middle + 1
    }
  }
  return { block: found, offset: Math.max(0, visibleY - blocks[found]!.top) }
}

/**
 * How far into the anchor block the viewport top sat, in the CURRENT layout.
 *
 * A pixel offset into a block is only valid for the layout it was measured in,
 * and the translated view IS a different layout: the same paragraph sets
 * different words at a different height, so the recorded `offset` points at the
 * wrong sentence — the drift the reader reported. The recorded TEXT offset is
 * the fix: when the block still holds the same text it resolves to an exact
 * pixel spot (a Range rect over the text node that holds that character); when
 * the words changed, the same FRACTION of the text is the honest place. An
 * anchor written before the text offset existed falls back to the pixel offset,
 * unchanged.
 *
 * Exported for the specs; the pane itself reaches it through
 * `applyReadingPosition`.
 *
 * @param block - the anchor block's CURRENT metrics.
 * @param anchor - the recorded place.
 * @returns pixels into the block.
 */
export function offsetInBlock(block: ArticleBlockMetrics, anchor: ReaderReadingAnchor): number {
  if (anchor.text !== undefined && anchor.text > 0 && anchor.textLength !== undefined && anchor.textLength > 0) {
    if (block.textLength === anchor.textLength) {
      const exact = textOffsetTop(block.element, anchor.text)
      if (exact !== null) return Math.min(exact, block.height)
    }
    // Different words (a translation), or no layout to resolve against: the
    // place is the same fraction of the text.
    return Math.round(Math.min(1, anchor.text / anchor.textLength) * block.height)
  }
  return anchor.offset
}

/**
 * Where a character offset into a block's text sits, in pixels into the block.
 *
 * `null` when there is no layout to answer with (jsdom, an unlaid-out body) —
 * the caller's proportional fallback then applies. This is a layout read, which
 * is why it runs only on restores and view switches, never in a scroll handler.
 *
 * @param block - the block element.
 * @param charOffset - the character offset into its text.
 * @returns pixels from the block's top, or `null`.
 */
function textOffsetTop(block: HTMLElement, charOffset: number): number | null {
  try {
    const doc = block.ownerDocument
    const walker = doc.createTreeWalker(block, 4 /* NodeFilter.SHOW_TEXT */)
    let remaining = charOffset
    let node: Node | null = walker.nextNode()
    while (node !== null) {
      const length = (node.textContent ?? '').length
      if (remaining <= length) break
      remaining -= length
      node = walker.nextNode()
    }
    if (node === null) return null
    const range = doc.createRange()
    range.setStart(node, remaining)
    range.setEnd(node, remaining)
    // jsdom's Range has no geometry at all: the method itself is absent.
    if (typeof range.getBoundingClientRect !== 'function') return null
    const rect = range.getBoundingClientRect()
    // A text position has a line height; an all-zero rect is a stub, not a spot.
    if (rect.height === 0 && rect.width === 0) return null
    return rect.top - block.getBoundingClientRect().top
  } catch {
    return null
  }
}

/**
 * Rebuild one entry from a 「最近阅读」 record.
 *
 * The feed that published an entry may have rolled it out of its window, and
 * the recent list keeps only the four fields it needs — so a row the wall no
 * longer knows is reconstructed here rather than being dropped. `rowFor` then
 * decides whether it can still be opened (its source must still exist).
 *
 * @param item - the stored record.
 * @returns an entry shaped like the ones the wall parses.
 */
function entryFromRecent(item: ReaderRecentEntry): ReaderEntry {
  return {
    id: item.entryId,
    sourceId: item.sourceId,
    title: item.title,
    ...(item.url === undefined ? {} : { link: item.url }),
  }
}

/**
 * The extracted meta a saved link's row carries once its card was upgraded.
 *
 * The `title !== sourceLabel` check is what "upgraded" means: synthesis swaps
 * the URL-derived label for the article's own name when extraction reads one,
 * and only then is there anything worth persisting. Feed rows never carry
 * this — their titles are the publisher's own.
 */
function linkMetaOf(row: ReaderRow): { title: string; excerpt?: string } | undefined {
  if (row.sourceKind !== 'link' || row.entry.title === row.sourceLabel) return undefined
  return { title: row.entry.title, ...(row.entry.summary === undefined ? {} : { excerpt: row.entry.summary }) }
}

/** The reader tab body. */
export function ReaderPane(props: ReaderPaneProps): ReactNode {
  const { sessionId, useStore, actions, t } = props
  const sources = useStore(s => s.sources)
  const parsed = useStore(s => s.parsed)
  const articleHtml = useStore(s => s.articleHtml)
  const articleTruncated = useStore(s => s.articleTruncated)
  const articleError = useStore(s => s.articleError)
  /**
   * True while the OPEN entry's body is being fetched.
   *
   * The detail view pays for its own fetch when it has nothing to show, so it
   * has to say so: an empty body area for the length of a network request reads
   * as "this article has no text", which is the impression the auto-fetch
   * exists to remove.
   */
  const bodyFetching = useStore(s => (s.openEntryId === null ? false : s.fetching[s.openEntryId] === true))
  const openEntryId = useStore(s => s.openEntryId)
  const openSourceId = useStore(s => s.openSourceId)
  const view = useStore(s => s.view)
  const filter = useStore(s => s.filter)
  const query = useStore(s => s.query)
  const unreadOnly = useStore(s => s.unreadOnly)
  const hideDupes = useStore(s => s.hideDupes)
  const sort = useStore(s => s.sort)
  const read = useStore(s => s.read)
  const lastRefreshAt = useStore(s => s.lastRefreshAt)
  const nextRefreshAt = useStore(s => s.nextRefreshAt)
  const refreshing = useStore(s => s.refreshing)
  const tags = useStore(s => s.tags)
  const tagCounts = useStore(s => s.tagCounts)
  const entryTagIds = useStore(s => s.entryTagIds)
  const cacheTtlHours = useStore(s => s.cacheTtlHours)
  const backfill = useStore(s => s.backfill)
  const backfilled = useStore(s => s.backfilled)
  const loading = useStore(s => s.loading)
  const error = useStore(s => s.error)
  const rev = useStore(s => s.rev)

  /* ------------------------------------------- where this pane already was */

  /**
   * Where the reader stood before the host unmounted this pane — read ONCE, at
   * mount, because hydration is a one-shot act: re-reading it later would undo
   * the narrowing the reader is doing right now.
   *
   * The right sidebar unmounts whenever another main panel takes over (hopping
   * to the side chat is the everyday case: `RightbarRoot` renders only while no
   * other panel is active), and this store is created per mount — so the open
   * article, the reading position, the wall's narrowing and the fact that a
   * translation was on all used to be gone on the way back.
   *
   * This is a COPY, and it is deliberately not what the restore steps on the
   * next screens read: those ask `readSession()` directly. A translation the
   * reader turns on during THIS mount is written to the page memory after this
   * copy was taken, so reading the copy there would make the record invisible
   * for exactly the case it exists for (the body being replaced under the
   * reader).
   *
   * The memory is the PAGE's, not this session's: the same wall and the same
   * article should be there in the next conversation too, so switching sessions
   * is not a reason to start over.
   */
  const snapshotRef = useRef<Partial<ReaderSessionSnapshot> | null>(null)
  if (snapshotRef.current === null) snapshotRef.current = readSession()
  // The mount-time copy, narrowed once for the `useState` initializers below
  // (their closures cannot see through the ref's null check).
  const snapshot: Partial<ReaderSessionSnapshot> = snapshotRef.current
  /** The store's first render happens BEFORE the hydration below lands. */
  const hydrateStartedRef = useRef(false)
  /** The mirror effect is skipped once, so a pre-hydration render cannot erase the record. */
  const mirrorStartedRef = useRef(false)
  /** The entry whose translation record has already been honoured (once per open). */
  const restoredTranslationRef = useRef<string | null>(null)
  /** The entry the pane ITSELF opened, so the restore below never re-opens it. */
  const openedRef = useRef<string | null>(null)
  /**
   * The entry the detail view belongs to RIGHT NOW.
   *
   * Opening is async: `getEntryBody` / `fetchEntryBody` resolve whenever the
   * host answers, and an answer that comes back LATE must not land under a
   * newer entry's title — rapid "open A, back, open B" otherwise ends with A's
   * body on B's screen (and the translation restore, keyed on
   * `[openEntryId, articleHtml]`, re-translating a pairing that never was).
   * `open()` sets this synchronously; every continuation that writes article
   * state checks it first.
   */
  const openRequestRef = useRef<string | null>(null)
  /** The entry the restore has dealt with, whether or not it could be reopened. */
  const restoredOpenRef = useRef<string | null>(null)
  /** The offset the LAST programmatic scroll landed on, so its echo is not saved. */
  const scrollEchoRef = useRef<number | null>(null)
  /** True once the reader has scrolled the article's body themselves. */
  const readerScrolledRef = useRef(false)
  /** The last human scroll gesture on each scroller (0 = none): the pane only
      records positions the reader CAUSED — see onDetailScroll. */
  const lastDetailGestureRef = useRef(0)
  const lastWallGestureRef = useRef(0)
  /** The same for the wall's scroller. */
  const wallEchoRef = useRef<number | null>(null)
  /** The wall's position is put back once per entry into the list view. */
  const wallRestoredRef = useRef(false)
  /** True once the host's recent list has been read at least once. */
  const recentLoadedRef = useRef(false)

  // Put the narrowing back before anything reads it. The restore of the OPEN
  // article is a separate step (it needs the entry list, which is still being
  // parsed), and it lives next to `open()`.
  useEffect(() => {
    hydrateStartedRef.current = true
    const patch = snapshotRef.current
    if (patch === null) return
    actions.hydrate({
      ...(patch.view === undefined ? {} : { view: patch.view }),
      ...(patch.openEntryId === undefined ? {} : { openEntryId: patch.openEntryId }),
      ...(patch.openSourceId === undefined ? {} : { openSourceId: patch.openSourceId }),
      ...(patch.filter === undefined ? {} : { filter: patch.filter }),
      ...(patch.query === undefined ? {} : { query: patch.query }),
      ...(patch.sort === undefined ? {} : { sort: patch.sort }),
      ...(patch.unreadOnly === undefined ? {} : { unreadOnly: patch.unreadOnly }),
      ...(patch.hideDupes === undefined ? {} : { hideDupes: patch.hideDupes }),
      ...(patch.read === undefined ? {} : { read: patch.read }),
    })
  }, [actions])

  /**
   * Figures the open body's page draws with its own scripts, which a fetch
   * cannot capture. Session state: the host reports the count with the body
   * (cached or fresh), so reopening an entry shows the same note.
   */
  const [scriptFigures, setScriptFigures] = useState(0)
  /** True while a capture-rendered refetch of the open entry is in flight. */
  const [captureBusy, setCaptureBusy] = useState(false)
  /** Entries whose stored body came from a rendered fetch (the「重新抓取」route reads it). */
  const renderedBodiesRef = useRef(new Set<string>())
  /** Auto-render fires once per entry per pane session; failures leave the manual retry. */
  const autoRenderTriedRef = useRef(new Set<string>())
  /** What the plugin holds per entry, as the host reports it (the 抓取 pills). */
  const fetchStates = useStore(s => s.fetchStates)
  /** What the reader opened, as the host stores it (the 「最近阅读」 page). */
  const recent = useStore(s => s.recent)
  const [addOpen, setAddOpen] = useState(false)
  const [sortOpen, setSortOpen] = useState(false)
  const [draftUrl, setDraftUrl] = useState('')
  const [verdict, setVerdict] = useState<{ kind: Verdict; label?: string; reason?: string; code?: ReaderPreviewFailureCode; url?: string } | null>(null)
  const [draft, setDraft] = useState('')
  const [sideChatAvailable, setSideChatAvailable] = useState(false)
  const [timeOfDay, setTimeOfDay] = useState<string>('10:00')
  const [filterOpen, setFilterOpen] = useState(false)
  /** The filter panel's page: its root, or the drilled-in source list. */
  const [filterPage, setFilterPage] = useState<'root' | 'source'>('root')
  /** The source page's own search box (the list grows without bound). */
  const [sourceFilter, setSourceFilter] = useState('')
  /** The entry whose card menu is open, plus where to anchor it. */
  const [cardMenu, setCardMenu] = useState<{ entryId: string; top: number; left: number } | null>(null)
  /** The failed fetch pill whose reason popover is open, plus where to anchor it. */
  const [pillInfo, setPillInfo] = useState<{ entryId: string; top: number; left: number } | null>(null)
  const [tagDraft, setTagDraft] = useState('')
  const [tagInputOpen, setTagInputOpen] = useState(false)
  /** The entry whose tag panel is open on the wall (and where to anchor it). */
  const [cardTag, setCardTag] = useState<{ entryId: string; top: number; left: number } | null>(null)
  /**
   * The management list's own narrowing and order.
   *
   * Session state, like the wall's filter: it is where the reader is standing,
   * not something the deployment should remember. Sorting by ADD TIME is the
   * default because that is the question the page is usually asked — "I just
   * added something and want to deal with it".
   */
  const [manageKind, setManageKind] = useState<'all' | ReaderSourceKind>('all')
  const [manageSort, setManageSort] = useState<'added' | 'name' | 'fetched'>('added')
  /** The manage page's storage readout, loaded on entry (host aggregates; the tables never cross). */
  const [storageStats, setStorageStats] = useState<ReaderStorageStats | null>(null)
  /** The translation budget draft, in MB (committed on blur/Enter, like the TTL select commits on pick). */
  const [budgetDraft, setBudgetDraft] = useState('')
  /** The clear button's second step: armed once, executed on the next click. */
  const [clearArmed, setClearArmed] = useState(false)

  /* ---------------------------------------------------- on-device translation */

  /** The page's Translator API, read once: no API means no button at all. */
  const translator = useMemo<TranslatorLike | null>(() => detectTranslator(), [])
  const [translateAvailability, setTranslateAvailability] = useState<TranslationAvailability | null>(null)
  const [translatePhase, setTranslatePhase] = useState<'idle' | 'pack' | 'working' | 'ready' | 'failed'>('idle')
  const [translateView, setTranslateView] = useState<TranslationView>('trans')
  const [packProgress, setPackProgress] = useState<number | null>(null)
  const [translateProgress, setTranslateProgress] = useState<{ done: number; total: number } | null>(null)
  const [translateError, setTranslateError] = useState<string | null>(null)
  const [translateMenu, setTranslateMenu] = useState(false)
  const [tipDismissed, setTipDismissed] = useState(false)
  /** The rendered article, so the segmentation can be applied to it. */
  const articleRef = useRef<HTMLDivElement | null>(null)
  /** The detail view's scroller, which is where a reading position lives. */
  const detailRef = useRef<HTMLDivElement | null>(null)
  /** The live segmentation, or null while the article is untouched. */
  const builtRef = useRef<BuiltArticle | null>(null)
  /** The running translation's cancel flag. */
  const cancelRef = useRef<{ cancelled: boolean } | null>(null)
  /** The last translation view, so turning the globe back on returns to it. */
  const lastViewRef = useRef<TranslationView>('trans')
  /* ------------------------------------------------ the wall's card texts */

  /**
   * Whether the wall is showing translated cards (its own switch, its own memory).
   *
   * Initialized from the page's snapshot, like every "where the reader was"
   * field: the mirror below writes these three into that snapshot on every
   * change, so starting from the defaults meant the first post-hydrate mirror
   * ERASED the remembered globe and its card texts with `false`/`false`/`{}`.
   */
  const [wallOn, setWallOn] = useState(snapshot.wallOn ?? false)
  /** Side-by-side on the wall: the original stays under each translated field. */
  const [wallBoth, setWallBoth] = useState(snapshot.wallBoth ?? false)
  const [wallMenu, setWallMenu] = useState(false)
  const [wallAvailability, setWallAvailability] = useState<TranslationAvailability | null>(null)
  /** Translated card fields, by entry id. */
  const [cardTranslations, setCardTranslations] = useState<Record<string, { title?: string; summary?: string }>>(
    () => ({ ...snapshot.cardTranslations }),
  )
  const [wallProgress, setWallProgress] = useState<{ done: number; total: number } | null>(null)
  /**
   * The translated FIELD under the pointer, in the translation-only view.
   *
   * Not the card: hovering a card's blank space, tile or chevron must leave the
   * translation alone — the reader asked for exactly that, because flipping a
   * whole card on any pointer contact made the wall feel like it had to be
   * tiptoed around.
   */
  const [hoverField, setHoverField] = useState<{ id: string; field: 'title' | 'summary' } | null>(null)
  /** Entries whose fields still need translating (filled by the observer). */
  const wallPendingRef = useRef<Set<string>>(new Set())
  const wallRunningRef = useRef(false)
  const wallCancelRef = useRef<{ cancelled: boolean } | null>(null)
  /** The wall's scroll container, so cards are observed where they appear. */
  const wallRef = useRef<HTMLDivElement | null>(null)
  /** The rows the observer resolves ids against (kept fresh for the pass). */
  const rowsRef = useRef<readonly ReaderRow[]>([])

  /**
   * Mirror "where the reader is" into the session memory.
   *
   * One write for the whole crossing rather than a call at every gesture: the
   * values ARE the state, so a new field only has to be named here to be
   * remembered. The FIRST run is skipped because the hydration lands after it in
   * the same commit — without the skip, mounting would overwrite the record with
   * the store's defaults before it had ever been read back.
   */
  useEffect(() => {
    if (!mirrorStartedRef.current) { mirrorStartedRef.current = true; return }
    if (!hydrateStartedRef.current) return
    patchSession({
      view, openEntryId, openSourceId, filter, query, sort, unreadOnly, hideDupes, read,
      wallOn, wallBoth, cardTranslations,
    })
  }, [
    view, openEntryId, openSourceId, filter, query, sort, unreadOnly, hideDupes, read,
    wallOn, wallBoth, cardTranslations,
  ])

  /**
   * The unmount flush: the mirror above is a PASSIVE effect, and a pane that is
   * reseated in the same commit window as the reader's last gesture (a dockkit
   * split moving the tab body) can unmount before the flush — the next mount
   * then hydrates the PREVIOUS narrowing (the 3199 report: source filter set,
   * split, and the box came back empty). Render writes the ref synchronously on
   * every commit, and the cleanup — which DOES always run — records it. The
   * same `hydrateStartedRef` guard as the mirror: a pane that never hydrated
   * must not overwrite the record with the store's defaults.
   */
  const narrowingRef = useRef<Parameters<typeof patchSession>[0] | null>(null)
  narrowingRef.current = {
    view, openEntryId, openSourceId, filter, query, sort, unreadOnly, hideDupes, read,
    wallOn, wallBoth, cardTranslations,
  }
  useEffect(() => () => {
    if (!hydrateStartedRef.current) return
    if (narrowingRef.current !== null) patchSession(narrowingRef.current)
  }, [])

  /** The class names `translate.ts` decorates the article with. */
  const translateClasses = useMemo<TranslateClasses>(
    () => ({
      unit: css.unit ?? 'dsh-reader-unit',
      reveal: css.reveal ?? 'dsh-reader-reveal',
      line: css.revealLine ?? 'dsh-reader-reveal-line',
    }),
    [],
  )

  /** Load the source list and parse whatever payloads the host is holding. */
  const load = useCallback(async () => {
    actions.setLoading(true)
    try {
      const listed = await props.listSources()
      if (!listed.ok) {
        actions.setError(listed.error.message)
        return
      }
      const known = listed.value.sources
      actions.setSources(known)
      // Sources whose payload is wanted: the ones that have a body, PLUS every
      // saved link — a link with no body is still a card the reader must see,
      // and the host answers that request with the reason instead of a payload.
      // (Asking only for sources with bodies made an unreadable link vanish from
      // the wall entirely, which is a worse answer than "link only".)
      const wanted = known.filter(source => source.hasBody || source.kind === 'link')
      if (wanted.length === 0) return
      const bodies = await props.getBodies(wanted.map(source => source.id))
      if (!bodies.ok) {
        actions.setError(bodies.error.message)
        return
      }
      for (const body of bodies.value.bodies) {
        const source = known.find(item => item.id === body.id)
        if (source === undefined) continue
        // `truncated` is a property of the FETCH, not of the payload: the host
        // seam caps a body at its size limit and says so on the envelope. It
        // has to be carried onto the parsed entry here, because that flag is
        // what the detail view's "content shown in part" note reads — and a
        // source whose payload never arrived still needs the entry, or the
        // detail view would show a blank page instead of the reason.
        const cut = body.truncated === true
        if (body.raw === undefined) {
          if (source.kind === 'rss') {
            actions.setParsed({ id: source.id, entries: [], error: body.error ?? t('detail.extractFailed') })
          } else {
            actions.setParsed({
              id: source.id,
              entries: [{
                id: linkEntryId(source.id),
                sourceId: source.id,
                // The captured title/excerpt from a past extraction beat the
                // URL-derived label: the card should name the paper, not the
                // address, even after the payload's eviction.
                title: body.title ?? source.label,
                link: source.url,
                ...(body.excerpt === undefined ? {} : { summary: body.excerpt }),
                // No payload at all: whatever the detail view can show is
                // partial by definition, so it says so instead of pretending.
                truncated: true,
              }],
              error: body.error ?? t('detail.extractFailed'),
            })
          }
          continue
        }
        // A feed is parsed as a feed; a saved link is its own single entry,
        // extracted here so opening it is instant (D7).
        if (source.kind === 'rss') {
          const result = parseFeed(body.raw, source.id)
          const fetchedAt = source.fetchedAt
          // A feed declares its own name, and that is what a reader recognises.
          // The stored label is only the URL-derived fallback (the host cannot
          // parse a feed — it has no XML parser), so the parsed title wins.
          if (result.ok && result.feed.title !== undefined) {
            actions.setSourceLabel(source.id, result.feed.title)
          }
          actions.setParsed(result.ok
            ? {
              id: source.id,
              entries: result.feed.entries.map(entry => cut ? { ...entry, truncated: true } : entry),
              ...(result.feed.incomplete === true ? { incomplete: true } : {}),
              ...(fetchedAt === undefined ? {} : { fetchedAt }),
            }
            : { id: source.id, entries: [], error: result.error, ...(fetchedAt === undefined ? {} : { fetchedAt }) })
        } else {
          const extracted = extractArticle(body.raw, source.url)
          // The card's title/excerpt: the article's own when THIS extraction
          // read one, else the captured ones from an earlier extraction, else
          // the URL-derived label — a saved link's card names the paper.
          const extractedTitle = extracted.ok ? extracted.title : undefined
          const extractedExcerpt = extracted.ok ? extracted.excerpt : undefined
          const excerpt = extractedExcerpt ?? body.excerpt
          actions.setParsed({
            id: source.id,
            entries: [{
              id: linkEntryId(source.id),
              sourceId: source.id,
              title: extractedTitle ?? body.title ?? source.label,
              link: source.url,
              ...(excerpt === undefined ? {} : { summary: excerpt }),
              ...(extracted.ok ? { contentHtml: extracted.html } : {}),
              // The count rides the entry: opening goes through getEntryBody
              // (feedHtml echo), which knows nothing about figures for a fresh
              // link — extraction here is the only place that counted them.
              ...(extracted.ok && extracted.scriptFigures !== undefined && extracted.scriptFigures > 0
                ? { scriptFigures: extracted.scriptFigures }
                : {}),
              // Incompleteness comes from the FETCH, not from extraction: the
              // seam truncated the page, so whatever we extracted is partial.
              ...(cut ? { truncated: true } : {}),
            }],
          })
        }
      }
    } finally {
      actions.setLoading(false)
    }
  }, [actions, props, t])

  const backfillRunning = useRef(false)
  /** Entry ids this session already attempted, so a re-render cannot loop. */
  const backfillTried = useRef(new Set<string>())
  useEffect(() => { void load() }, [load, rev])

  useEffect(() => {
    void props.listTags().then(result => {
      if (result.ok) actions.setTags(result.value.tags, result.value.counts)
    })
    void props.getCachePolicy().then(result => {
      if (result.ok) {
        actions.setCacheTtl(result.value.ttlHours)
        setBudgetDraft(String(Math.round(result.value.translationBudgetChars / 1_000_000)))
      }
    })
  }, [actions, props, rev])

  /** The manage page's storage readout: read on entry, and after a clear. */
  const loadStorageStats = useCallback(async () => {
    const result = await props.getStorageStats()
    if (result.ok) setStorageStats(result.value)
  }, [props])

  useEffect(() => {
    if (view === 'manage') void loadStorageStats()
    else setClearArmed(false)
  }, [view, loadStorageStats])

  /** Commit the translation budget draft (MB) through the cache policy. */
  const commitBudget = useCallback(() => {
    const mb = Number(budgetDraft)
    if (!Number.isFinite(mb) || mb <= 0) return
    void props.setCachePolicy(cacheTtlHours, undefined, Math.round(mb * 1_000_000)).then(result => {
      if (result.ok) void loadStorageStats()
    })
  }, [props, budgetDraft, cacheTtlHours, loadStorageStats])

  /** Clear both translation tiers, on the button's second click. */
  const clearTranslations = useCallback(() => {
    if (!clearArmed) { setClearArmed(true); return }
    setClearArmed(false)
    void props.clearTranslations().then(result => { if (result.ok) void loadStorageStats() })
  }, [props, clearArmed, loadStorageStats])

  useEffect(() => {
    void props.capabilities().then(result => {
      if (!result.ok) return
      setSideChatAvailable(result.value.hasSideChat)
      actions.setSchedule(result.value.lastRefreshAt, result.value.nextRefreshAt)
      if (result.value.nextRefreshAt !== undefined) setTimeOfDay(clockOf(result.value.nextRefreshAt))
    })
  }, [actions, props, rev])

  /**
   * Fetch every enabled source now, then reload the wall.
   *
   * The reload is the point: a refresh that only replaced the host's stored
   * payloads and never re-read them looked like a dead button on the
   * acceptance instance, even though the fetch itself had succeeded.
   */
  const refreshAll = useCallback(async () => {
    actions.setRefreshing(true)
    try {
      const result = await props.refresh()
      actions.noteRefreshed(new Date().toISOString())
      if (!result.ok) actions.setError(result.error.message)
      else actions.refresh()
    } finally {
      actions.setRefreshing(false)
    }
  }, [actions, props])

  const presentation = useMemo(() => {
    const map = new Map<string, SourcePresentation>()
    for (const source of sources) {
      map.set(source.id, {
        id: source.id,
        label: source.label,
        tile: tileForSource(source.label),
        hue: hueForSource(source.label),
        kind: source.kind,
        addedAt: source.addedAt,
      })
    }
    return map
  }, [sources])

  const allEntries = useMemo(() => flattenEntries(parsed), [parsed])
  /** How many entries each source kind contributes, for the filter panel. */
  const kindCounts = useMemo(() => {
    const counts: Record<ReaderSourceKind, number> = { rss: 0, link: 0 }
    for (const entry of allEntries) {
      const kind = presentation.get(entry.sourceId)?.kind
      if (kind !== undefined) counts[kind] += 1
    }
    return counts
  }, [allEntries, presentation])
  /** One sweep at a time: the wall can re-render while an extraction runs. */
  const sweepRunning = useRef(false)

  /** The entry ids currently on the wall, for the fetch-state round trip. */
  const entryIds = useMemo(() => allEntries.map(entry => entry.id), [allEntries])

  /** Ask the host what it holds for the entries on screen. */
  const refreshFetchStates = useCallback(async () => {
    if (entryIds.length === 0) return
    const result = await props.entryFetchStates(entryIds.slice(0, LIST_RENDER_LIMIT))
    if (result.ok) actions.setFetchStates(result.value.states)
  }, [actions, entryIds, props])

  /**
   * Re-read ONE entry's fetch state from the host after something settled it.
   *
   * The host's annotation is the only authority (body presence, the in-flight
   * or stored-raw record, the classified failure with its reason), and the pane
   * mirrors it — so a path that just changed the host's state re-reads the one
   * entry it touched, and the card flips on the same gesture instead of at the
   * next mount. A full-wall poll per fetch would be the same answer at N times
   * the cost.
   */
  const syncFetchState = useCallback(async (entryId: string) => {
    const result = await props.entryFetchStates([entryId])
    if (result.ok) actions.setFetchStates(result.value.states)
  }, [actions, props])

  /**
   * Read the recent list from the host.
   *
   * Host-side state, so it is read when the page opens rather than mirrored in
   * the pane: another tab (or the same reader on another device) may have read
   * something since this pane last looked, and the pane's own write happens on
   * every open anyway.
   */
  const refreshRecent = useCallback(async () => {
    const result = await props.listRecent()
    if (result.ok) {
      actions.setRecent(result.value.entries)
      recentLoadedRef.current = true
    }
  }, [actions, props])

  // Read the list on mount AND whenever the page is showing. The mount read is
  // what lets the detail view resolve an article the feed has rolled out of its
  // window (the record is the only thing left that knows it); the page read
  // covers the return from another panel, where the session snapshot restores
  // the VIEW but can never restore host state.
  useEffect(() => {
    if (view === 'recent' || !recentLoadedRef.current) void refreshRecent()
  }, [view, refreshRecent, rev])

  /**
   * Empty the recent list, here and on the host.
   *
   * The confirm-free gesture is deliberate: the list is a convenience, nothing
   * in it is the reader's only copy of anything (the entries themselves live in
   * the wall and on the sites), and a modal for "forget my history" would make
   * the one action this page owns feel like a hazard.
   */
  const clearRecent = useCallback(async () => {
    const result = await props.clearRecent()
    if (result.ok) actions.setRecent([])
  }, [actions, props])

  /**
   * Turn stored raw payloads into bodies.
   *
   * This is what makes a fetch survive the page: the host writes the payload
   * before it answers, so a browser that went away leaves work here instead of
   * losing the download. Two at a time, like every other network path here.
   */
  const sweepRaw = useCallback(async () => {
    if (sweepRunning.current) return
    const raws = allEntries.filter(entry => fetchStateOf(fetchStates, entry.id).state === 'raw').slice(0, 2)
    if (raws.length === 0) return
    sweepRunning.current = true
    try {
      for (const entry of raws) {
        const stored = await props.getRawBody(entry.id)
        if (!stored.ok || stored.value.raw === undefined) continue
        const url = stored.value.url ?? entry.link ?? ''
        const extracted = extractArticle(stored.value.raw, url)
        if (!extracted.ok) continue
        await props.storeEntryBody({
          entryId: entry.id,
          url,
          html: extracted.html,
          // The map rides the body's identity: a re-extraction of the same
          // payload keeps it, a changed body retires it in the same commit.
          bodyHash: translationHash(extracted.html),
          // The article's own title/excerpt: a saved link's card upgrade.
          ...(extracted.title === undefined ? {} : { title: extracted.title }),
          ...(extracted.excerpt === undefined ? {} : { excerpt: extracted.excerpt }),
          ...(stored.value.truncated === true ? { truncated: true } : {}),
          ...(extracted.scriptFigures === undefined ? {} : { scriptFigures: extracted.scriptFigures }),
        })
        actions.noteExtractedMeta(entry.id, {
          ...(extracted.title === undefined ? {} : { title: extracted.title }),
          ...(extracted.excerpt === undefined ? {} : { excerpt: extracted.excerpt }),
        })
      }
    } finally {
      sweepRunning.current = false
      await refreshFetchStates()
    }
  }, [allEntries, fetchStates, props, refreshFetchStates])

  /**
   * Cache the feed's own full text as the entry's body, on the open that
   * displays it.
   *
   * A fulltext feed has already paid for the article — but the payload lives
   * only inside the feed's window: once the entry rolls off the feed, the host
   * holds nothing and the next open becomes a fetch (or a failure). Storing on
   * the first open costs no request (the text is already on screen), lets the
   * body survive the window, and flips the card's pill to 「已抓取」 on the
   * same gesture. The body hash keeps the entry's translation map riding the
   * same identity rule as a fetched body.
   */
  const persistFeedBody = useCallback((entryId: string, url: string, html: string, truncated: boolean, meta?: { title?: string; excerpt?: string }) => {
    if (html.trim().length === 0) return
    void props.storeEntryBody({
      entryId,
      url,
      html,
      bodyHash: translationHash(html),
      ...(truncated ? { truncated: true } : {}),
      ...(meta?.title === undefined ? {} : { title: meta.title }),
      ...(meta?.excerpt === undefined ? {} : { excerpt: meta.excerpt }),
    }).then((stored) => {
      if (!stored.ok) return
      // The host holds a fresh body now, whichever marker said otherwise (a
      // stale cache this store replaced, or the card's 「抓取」).
      actions.setStaleBody(entryId, false)
      void syncFetchState(entryId)
    })
  }, [actions, props, syncFetchState])

  const rows = useMemo(() => selectRows(allEntries, presentation, {
    filter, query, unreadOnly, sort, read, tags: entryTagIds, now: new Date(),
  }), [allEntries, presentation, filter, query, unreadOnly, sort, read, entryTagIds])

  /**
   * The wall's dedupe: republished articles fold behind one card (survivor and
   * hidden copies per `dedupeRows`). The `dupesBy` map is what the surviving
   * card's badge reads; hiddenCount feeds the footer. When the switch is off
   * the maps are empty and displayRows IS rows — the fold is invisible.
   */
  const { rows: displayRows, dupesBy, hiddenCount } = useMemo(
    () => (hideDupes ? dedupeRows(rows, fetchStates) : { rows, dupesBy: new Map<string, readonly ReaderRow[]>(), hiddenCount: 0 }),
    [hideDupes, rows, fetchStates],
  )
  // The wall's own observer pass reads the displayed rows, like the renderer.
  rowsRef.current = displayRows

  /**
   * One entry by id: the wall's own parse first, the recent record as a fallback.
   *
   * The fallback is what lets the 「最近阅读」 page reopen an article the feed has
   * rolled out of its window — the case this list exists for. Everything the
   * detail view needs is the four stored fields plus the source row, which is
   * still there as long as the reader kept the subscription.
   */
  const entryById = useCallback((id: string): ReaderEntry | undefined => {
    const parsed = allEntries.find(entry => entry.id === id)
    if (parsed !== undefined) return parsed
    const item = recent.find(candidate => candidate.entryId === id)
    return item === undefined ? undefined : entryFromRecent(item)
  }, [allEntries, recent])

  const openEntry = openEntryId === null ? undefined : entryById(openEntryId)
  /** The source the strip is currently narrowing to, if any. */
  const activeSource = sources.find(source => query.trim() === sourceQuery(source.id))?.id ?? null
  /** The source KIND the search box is narrowing to, if any (`#rss` / `#link`). */
  const activeKind = READER_SOURCE_KINDS.find(kind => query.trim() === kindQuery(kind)) ?? null
  /** The label for whichever narrowing the search box currently holds. */
  const kindLabel = activeKind === null ? null : t(activeKind === 'link' ? 'sources.kindLink' : 'sources.kindRss')
  /** The active source's display name, for the filter panel's drill row. */
  const activeSourceLabel = activeSource === null
    ? kindLabel
    : sources.find(source => source.id === activeSource)?.label ?? activeSource
  /** The source page's list, narrowed by its own search box (name or address). */
  const matchingSources = useMemo(() => {
    const needle = sourceFilter.trim().toLowerCase()
    if (needle === '') return sources
    return sources.filter(source =>
      source.label.toLowerCase().includes(needle) || source.url.toLowerCase().includes(needle))
  }, [sources, sourceFilter])
  /** Sources whose payload could not be read whole — what the notice lists. */
  const brokenSources = sources.filter(source => parsed[source.id]?.incomplete === true || parsed[source.id]?.error !== undefined)
  /** The management list: narrowed by kind, ordered by the chosen key. */
  const manageSources = useMemo(() => {
    const filtered = sources.filter(source => manageKind === 'all' || source.kind === manageKind)
    const sorted = [...filtered]
    // `?? ''` on the dates: the host always reports them, but a degraded or
    // older host must not turn the subscription page into a crash — an empty
    // key sorts last, which is the honest place for "unknown when".
    if (manageSort === 'name') sorted.sort((a, b) => a.label.localeCompare(b.label))
    else if (manageSort === 'fetched') sorted.sort((a, b) => (b.fetchedAt ?? '').localeCompare(a.fetchedAt ?? ''))
    else sorted.sort((a, b) => (b.addedAt ?? '').localeCompare(a.addedAt ?? ''))
    return sorted
  }, [sources, manageKind, manageSort])

  /* --------------------------------------------------- the translation flow */

  /**
   * The source language of the open body: the script heuristic first (it cannot
   * tell German from English, but it measures the WHOLE body, so it recognises
   * "already Chinese" reliably), refined by the browser's detector. The detector
   * only sees a 600-character prefix sample, and an arXiv author block is
   * romanized Chinese names — so an answer of "this is Chinese" that contradicts
   * the script measurement is the detector misreading a name list, not a Chinese
   * body, and is distrusted. A wrong source makes `create()` reject for a pair
   * the device does not have — and that error does not name either language,
   * which is why it is worth asking properly.
   */
  const guessSource = articleHtml !== null && isCjk(articleHtml) ? TRANSLATION_TARGET : 'en'
  const [translationSource, setTranslationSource] = useState('en')
  useEffect(() => {
    if (view !== 'detail' || articleHtml === null || articleHtml.length === 0) return
    if (guessSource === TRANSLATION_TARGET) { setTranslationSource(guessSource); return }
    // A new body starts from the script guess, not the previous entry's answer;
    // the detector then refines it asynchronously.
    setTranslationSource(guessSource)
    let cancelled = false
    void (async () => {
      const detected = await detectSourceLanguage(articleHtml.replace(/<[^>]*>/g, ' '), guessSource)
      if (!cancelled) setTranslationSource(detected.split('-')[0] === TRANSLATION_TARGET ? guessSource : detected)
    })()
    return () => { cancelled = true }
  }, [view, articleHtml, guessSource])
  /**
   * Whether the globe belongs on this article at all. Three ways it does not:
   * the browser has no Translator API, the pair is unavailable on this device,
   * or the body is already the target language. All three hide the control
   * rather than offering one that cannot work — the pass's own degradation rule.
   */
  const translationOffered = translator !== null
    && translateAvailability !== null
    && translateAvailability !== 'unavailable'
    && translationSource !== TRANSLATION_TARGET

  // Ask the browser about this pair once per opened article, in every target
  // spelling: the probe is async, and the control appears only once one of them
  // is not `unavailable`.
  useEffect(() => {
    if (view !== 'detail' || translator === null || articleHtml === null || articleHtml.length === 0) return undefined
    if (translationSource === TRANSLATION_TARGET) { setTranslateAvailability('unavailable'); return undefined }
    let cancelled = false
    void (async () => {
      // The detector's answer is only the FIRST source candidate; the script
      // guess is probed behind it, the same chain startTranslation builds
      // sessions with. A wrong detection (the prefix sample reads a pinyin
      // author list as another language) would otherwise probe a pair this
      // device does not have and hide a globe that could have worked.
      const sources = translationSource === guessSource ? [guessSource] : [translationSource, guessSource]
      let best: TranslationAvailability = 'unavailable'
      for (const sourceLanguage of sources) {
        for (const targetLanguage of TARGET_CANDIDATES) {
          try {
            const answer = await translator.availability({ sourceLanguage, targetLanguage }) as TranslationAvailability
            if (answer !== 'unavailable') { best = answer; break }
          } catch {
            // Try the next spelling; only "every candidate said unavailable" hides
            // the globe.
          }
        }
        if (best !== 'unavailable') break
      }
      if (!cancelled) setTranslateAvailability(best)
    })()
    return () => { cancelled = true }
  }, [view, translator, articleHtml, translationSource, guessSource])

  // A new body means a new DOM: the old segmentation dies with the old element,
  // so this effect is the only owner of that lifecycle. The pair probe is reset
  // with it too: the previous entry's answer must neither show nor hide the
  // globe over a body it was never asked about.
  useEffect(() => {
    if (cancelRef.current !== null) cancelRef.current.cancelled = true
    cancelRef.current = null
    const built = builtRef.current
    if (built !== null) restoreArticle(built.root)
    builtRef.current = null
    setTranslatePhase('idle')
    setTranslateView('trans')
    setTranslateProgress(null)
    setPackProgress(null)
    setTranslateError(null)
    setTranslateMenu(false)
    setTranslateAvailability(null)
  }, [openEntryId, articleHtml])

  // Leaving the pane must not leave spans behind in a DOM React will reuse.
  useEffect(() => () => {
    if (cancelRef.current !== null) cancelRef.current.cancelled = true
    const built = builtRef.current
    if (built !== null) restoreArticle(built.root)
    builtRef.current = null
  }, [])

  /** Stop the run and put the article back exactly as the host sent it. */
  const cancelTranslation = useCallback(() => {
    if (cancelRef.current !== null) cancelRef.current.cancelled = true
    cancelRef.current = null
    const built = builtRef.current
    if (built !== null) restoreArticle(built.root)
    builtRef.current = null
    setTranslatePhase('idle')
    setTranslateProgress(null)
    setPackProgress(null)
    setTranslateError(null)
    // The reader asked for the original: that is the state a return to this
    // entry should find, not a translation that switches itself back on.
    if (openEntryId !== null) forgetTranslation(openEntryId)
  }, [openEntryId])

  /**
   * Warm the page's sentence memory from the host's two tiers before a run
   * spends the model.
   *
   * The entry's own exact-fit map answers first — but only while its `bodyHash`
   * is the body's, so a re-fetched body invalidates the map and the global
   * memory still serves every unchanged sentence. Either tier failing is just a
   * miss: the run then pays the model, exactly as before this store existed.
   *
   * @param pair - the run's pair label.
   * @param entryId - the open entry.
   * @param html - the body on screen (its hash gates the entry map).
   * @param built - the segmented article (its sentences are what is asked for).
   */
  const warmMemory = useCallback(async (pair: string, entryId: string, html: string, built: BuiltArticle): Promise<void> => {
    const byHash = new Map<string, string>()
    for (const segment of segmentsOf(built)) byHash.set(translationHash(segment.original), segment.original)
    if (byHash.size === 0) return
    const covered = new Set<string>()
    try {
      const answer = await props.getEntryTranslation(entryId)
      const record = answer.ok ? answer.value.translation : undefined
      if (record !== undefined && record.pair === pair && record.bodyHash === translationHash(html)) {
        const pour: { text: string; translation: string }[] = []
        for (const [hash, translation] of Object.entries(record.segments)) {
          const text = byHash.get(hash)
          if (text !== undefined) { pour.push({ text, translation }); covered.add(hash) }
        }
        primeMemory(pair, pour)
      }
    } catch {
      // A missing or unreadable record is a miss, never an error in the run.
    }
    const missing = [...byHash.keys()].filter(hash => !covered.has(hash))
    if (missing.length === 0) return
    try {
      const slice = await props.getSentenceTranslations({ pair, hashes: missing })
      if (!slice.ok) return
      primeMemory(pair, Object.entries(slice.value.translations).flatMap(([hash, translation]) => {
        const text = byHash.get(hash)
        return text === undefined ? [] : [{ text, translation }]
      }))
    } catch {
      // Same: a miss.
    }
  }, [props])

  /**
   * Persist what one run produced, in one call — batched by run, never per
   * sentence. The recalled sentences ride along: their LRU stamps are what
   * makes the host's budget a use-clock, and they keep the entry's map complete.
   */
  const persistTranslations = useCallback((
    pair: string,
    learned: readonly ReaderSentenceLearn[],
    recalled: readonly ReaderSentenceLearn[],
    entry?: { entryId: string; bodyHash: string },
  ): void => {
    if (learned.length === 0 && recalled.length === 0 && entry === undefined) return
    void props.rememberSentences({
      pair,
      entries: learned,
      recalled,
      ...(entry === undefined ? {} : { entryId: entry.entryId, bodyHash: entry.bodyHash }),
    })
  }, [props])

  /**
   * Get the article translated, reusing a session this page already built.
   *
   * The `Translator` API demands user activation for `create()`, so a session
   * that exists is the ONLY way a translation can be restored after the sidebar
   * remounted without a click. `client/session.ts` holds those sessions for the
   * whole page (the wall and the detail view share them), and this function
   * checks there first: a cache hit skips the pack phase entirely.
   *
   * @param initialView - the view to show once the first units exist.
   * @param sourceOverride - the source language to build for, when the caller is
   * restoring a translation rather than starting one from the detected language.
   */
  const startTranslation = useCallback(async (initialView: TranslationView, sourceOverride?: string) => {
    const api = translator
    const container = articleRef.current
    if (api === null || container === null) return
    // One run at a time. A second start (the reader's retry, or the restore
    // re-applying a translation to a body that was just replaced) must not build
    // its own segmentation over the first one's: two overlapping runs would
    // decorate the same DOM twice and race each other's view updates. Whatever
    // was in flight is cancelled and the article is put back as the host sent it.
    if (cancelRef.current !== null) cancelRef.current.cancelled = true
    const previous = builtRef.current
    if (previous !== null) restoreArticle(previous.root)
    builtRef.current = null
    const cancel = { cancelled: false }
    cancelRef.current = cancel
    setTranslateError(null)
    setTranslateProgress(null)
    // The source candidates: what the browser's detector said, then the script
    // heuristic's answer. The targets: every Chinese spelling the API accepts.
    const sourceLanguage = sourceOverride ?? translationSource
    const sources = sourceLanguage === 'en' ? ['en'] : [sourceLanguage, 'en']
    const existing = cachedTranslator(sources, TARGET_CANDIDATES)
    if (existing !== undefined) {
      setTranslatePhase('working')
    } else {
      setTranslatePhase('pack')
      setPackProgress(0)
    }
    const outcome: SessionOutcome = existing === undefined
      ? await createSession(api, {
        sources,
        targets: TARGET_CANDIDATES,
        monitor: monitor => {
          monitor.addEventListener('downloadprogress', event => { setPackProgress(event.loaded) })
        },
      })
      : { ok: true, session: existing, sourceLanguage, targetLanguage: TARGET_CANDIDATES[0] as string }
    setPackProgress(null)
    if (!outcome.ok) {
      // Say WHICH pair was asked for: the browser's own message names neither
      // language, and a reader who reports it needs to be able to.
      const pairs = outcome.attempts
        .map(attempt => `${attempt.sourceLanguage} → ${attempt.targetLanguage}`)
        .filter((pair, index, all) => all.indexOf(pair) === index)
        .join(' / ')
      const first = outcome.attempts[0]?.reason ?? 'unknown'
      cancelRef.current = null
      if (outcome.unsupported) setTranslateAvailability('unavailable')
      setTranslatePhase('failed')
      setTranslateError(
        outcome.unsupported
          ? t('translate.unsupported', { pair: pairs })
          : t('translate.failed', { reason: `${pairs} · ${first}`.slice(0, 200) }),
      )
      return
    }
    const session = outcome.session
    rememberTranslator(sources, TARGET_CANDIDATES, session)
    if (cancel.cancelled) { setTranslatePhase('idle'); return }
    const built = buildArticle(container, translateClasses)
    if (built === null) {
      // Nothing in this body is prose the browser can translate (all code, an
      // empty body): say so instead of spinning forever.
      cancelRef.current = null
      setTranslatePhase('failed')
      setTranslateError(t('translate.nothing'))
      return
    }
    builtRef.current = built
    lastViewRef.current = initialView
    setTranslateView(initialView)
    setTranslatePhase('working')
    setView(built, initialView, translateClasses)
    // Recorded BEFORE the run: the record is what makes a remounted pane turn
    // the globe back on, and the sentence memory makes the re-run cheap.
    if (openEntryId !== null) rememberTranslation(openEntryId, initialView, sourceLanguage)
    // The host's tiers answer first: the entry's exact-fit map, then the global
    // sentence memory. Only what neither knows is spent on the model.
    const pair = `${sourceLanguage}→${TRANSLATION_TARGET}`
    if (openEntryId !== null && articleHtml !== null) {
      await warmMemory(pair, openEntryId, articleHtml, built)
      if (cancel.cancelled) { setTranslatePhase('idle'); return }
    }
    const result = await runTranslation({
      built,
      session,
      pair,
      cancelled: () => cancel.cancelled,
      onProgress: (done, total) => { setTranslateProgress({ done, total }) },
    })
    // What the run learned (and what it was served) persists in one batch: a
    // reload loses the page's memory, and the next visit pays the model again
    // without this.
    persistTranslations(
      pair,
      result.learned,
      result.recalled,
      openEntryId !== null && articleHtml !== null
        ? { entryId: openEntryId, bodyHash: translationHash(articleHtml) }
        : undefined,
    )
    if (cancel.cancelled) return
    cancelRef.current = null
    if (result.total > 0 && result.done === 0) {
      // Every batch failed: keep the original text, explain, offer the retry in
      // the menu. The spans stay segmented so a retry reuses them.
      setTranslatePhase('failed')
      setTranslateError(t('translate.failedAll'))
      return
    }
    setTranslatePhase('ready')
    setTranslateProgress(null)
    // Re-paint once the first units exist, so the translated typography applies.
    setView(built, initialView, translateClasses)
  }, [translator, translationSource, translateClasses, t, openEntryId, articleHtml, warmMemory, persistTranslations])

  /** Apply one view to a finished translation. */
  const applyView = useCallback((next: TranslationView) => {
    setTranslateView(next)
    if (next !== 'orig') lastViewRef.current = next
    if (openEntryId !== null) rememberTranslation(openEntryId, next, translationSource)
    const built = builtRef.current
    if (built !== null) setView(built, next, translateClasses)
  }, [translateClasses, openEntryId, translationSource])

  /** A menu choice: it also starts the translation when there is none yet. */
  const pickView = useCallback((next: TranslationView) => {
    setTranslateMenu(false)
    if (translatePhase === 'ready' || translatePhase === 'pack' || translatePhase === 'working') {
      applyView(next)
      return
    }
    setTranslateView(next)
    void startTranslation(next)
  }, [translatePhase, applyView, startTranslation])

  /** The globe: start, cancel, or flip between the translation and the original. */
  const toggleGlobe = useCallback(() => {
    if (translatePhase === 'pack' || translatePhase === 'working') { cancelTranslation(); return }
    if (translatePhase === 'ready') {
      applyView(translateView === 'orig' ? lastViewRef.current : 'orig')
      return
    }
    void startTranslation(translateView === 'orig' ? lastViewRef.current : translateView)
  }, [translatePhase, translateView, cancelTranslation, applyView, startTranslation])

  /**
   * The pairing cue: hovering a translated sentence lights its original line,
   * and hovering an original line lights the sentence it belongs to. Nothing is
   * painted by default — the marks are thrown away when the pointer leaves.
   */
  const onArticleHover = useCallback((event: { type: string; target: EventTarget | null }) => {
    if (translatePhase !== 'ready') return
    const built = builtRef.current
    if (built === null) return
    setPairHover(built, event.target, event.type === 'mouseover')
  }, [translatePhase])

  /**
   * One gesture, on the TRANSLATED side only: clicking a sentence opens its
   * original, clicking it again closes it.
   *
   * The original itself is deliberately NOT a control. It is text the reader
   * wants to SELECT — to quote it, or to quote it together with its translation
   * — and a click handler there would fire on the mouseup that ends a drag
   * selection, collapsing the sentence and taking the selection (and the quote
   * overlay with it) away. For the same reason the click is ignored while a
   * selection is active: ending a selection inside a translated sentence must
   * not fold its original either.
   */
  const onArticleClick = useCallback((event: { target: EventTarget | null }) => {
    // Only a finished translation: mid-run a reveal would just duplicate the
    // original text that is still on screen.
    if (translatePhase !== 'ready') return
    if ((window.getSelection()?.toString().length ?? 0) > 0) return
    const built = builtRef.current
    if (built === null) return
    const segment = segmentAt(built, event.target)
    if (segment === null) return
    toggleSegment(built, segment, translateClasses)
  }, [translateClasses, translatePhase])


  /* ---------------------------------------------------- the wall's own pass */

  // The wall has no article to segment: a card's unit is a FIELD (title,
  // summary), and the wall must translate lazily — a wall of forty cards is
  // eighty fields, and firing them all at once would be a burst the sequential
  // API cannot absorb. So: the browser's own IntersectionObserver feeds a queue,
  // one pass drains it, and the translation memory makes a second pass free.
  // (rowsRef is fed where the displayed rows are computed, dedupe included.)
  const wallTranslateOffered = translator !== null && wallAvailability !== null && wallAvailability !== 'unavailable'

  // Probe the browser once for the wall's pair (the wall has no single body, so
  // English is the probe; a card in another language gets its own session below).
  useEffect(() => {
    if (view !== 'list' || translator === null || wallAvailability !== null) return undefined
    let cancelled = false
    void (async () => {
      let best: TranslationAvailability = 'unavailable'
      for (const targetLanguage of TARGET_CANDIDATES) {
        try {
          const answer = await translator.availability({ sourceLanguage: 'en', targetLanguage }) as TranslationAvailability
          if (answer !== 'unavailable') { best = answer; break }
        } catch {
          // Try the next spelling.
        }
      }
      if (!cancelled) setWallAvailability(best)
    })()
    return () => { cancelled = true }
  }, [view, translator, wallAvailability])

  /**
   * A translator for one source language, created once and reused.
   *
   * The cache is the page's, not this mount's (`client/session.ts`): a session
   * the wall built is the one the detail view can restore for free, and it is
   * the only way a translation survives the sidebar being unmounted — Chrome
   * demands user activation for `create()`.
   */
  const wallSession = useCallback(async (language: string): Promise<TranslatorSessionLike | null> => {
    const api = translator
    if (api === null) return null
    const sources = language === 'en' ? ['en'] : [language, 'en']
    const cached = cachedTranslator(sources, TARGET_CANDIDATES)
    if (cached !== undefined) return cached
    const outcome: SessionOutcome = await createSession(api, { sources, targets: TARGET_CANDIDATES })
    if (!outcome.ok) return null
    rememberTranslator(sources, TARGET_CANDIDATES, outcome.session)
    return outcome.session
  }, [translator])

  /**
   * Drain the pending queue: six cards at a time, grouped by detected language
   * (a wall can mix them — that is the point of asking at all), one batch per
   * group through the shared batching contract.
   */
  const runWallPass = useCallback(async () => {
    if (wallRunningRef.current || translator === null) return
    wallRunningRef.current = true
    const cancel = wallCancelRef.current ?? { cancelled: false }
    wallCancelRef.current = cancel
    try {
      while (!cancel.cancelled && wallPendingRef.current.size > 0) {
        const ids = [...wallPendingRef.current].slice(0, 6)
        for (const id of ids) wallPendingRef.current.delete(id)
        const fields: { id: string; field: 'title' | 'summary'; text: string }[] = []
        for (const id of ids) {
          const row = rowsRef.current.find(candidate => candidate.entry.id === id)
          if (row === undefined) continue
          // Chinese cards (and Chinese fields inside a mixed card) are left
          // exactly as they are: translating them to Chinese is not a feature.
          if (!isTargetLanguage(row.entry.title)) fields.push({ id, field: 'title', text: row.entry.title })
          const summary = row.entry.summary
          if (summary !== undefined && summary.length > 0 && !isTargetLanguage(summary)) {
            fields.push({ id, field: 'summary', text: summary })
          }
        }
        if (fields.length === 0) continue
        const groups = new Map<string, typeof fields>()
        for (const field of fields) {
          const detected = await detectSourceLanguage(field.text, 'en')
          const key = detected === 'zh' ? 'en' : detected
          groups.set(key, [...groups.get(key) ?? [], field])
        }
        for (const [language, group] of groups) {
          if (cancel.cancelled) break
          const session = await wallSession(language)
          if (session === null) {
            setWallAvailability('unavailable')
            return
          }
          // The host's memory answers first, one slice call per group: a wall
          // re-translated after a reload should be a read, not a model run.
          const pair = `${language}→${TRANSLATION_TARGET}`
          try {
            const byHash = new Map(group.map(field => [translationHash(field.text), field.text] as const))
            const slice = await props.getSentenceTranslations({ pair, hashes: [...byHash.keys()] })
            if (slice.ok) {
              primeMemory(pair, Object.entries(slice.value.translations).flatMap(([hash, translation]) => {
                const text = byHash.get(hash)
                return text === undefined ? [] : [{ text, translation }]
              }))
            }
          } catch {
            // A miss is the model's job, as before.
          }
          setWallProgress({ done: 0, total: group.length })
          const outcome = await translateTexts(
            group.map(field => field.text),
            pair,
            session,
            () => cancel.cancelled,
            (done, total) => setWallProgress({ done, total }),
          )
          if (cancel.cancelled) break
          persistTranslations(pair, outcome.learned, outcome.recalled)
          setCardTranslations(current => {
            const next = { ...current }
            for (const field of group) {
              const value = outcome.translated.get(field.text)
              if (value === undefined) continue
              next[field.id] = { ...next[field.id], [field.field]: value }
            }
            return next
          })
        }
      }
    } finally {
      wallRunningRef.current = false
      setWallProgress(null)
    }
  }, [translator, wallSession, props, persistTranslations])

  // Enqueue the cards as they become visible. jsdom has no IntersectionObserver,
  // and neither would a very old browser, so the fallback translates what is
  // rendered — the pass is bounded per batch either way.
  useEffect(() => {
    if (!wallOn || translator === null) return undefined
    const container = wallRef.current
    const cards = container === null ? [] : [...container.querySelectorAll('[data-reader-entry]')]
    const ids = cards.map(card => card.getAttribute('data-reader-entry') ?? '').filter(id => id !== '')
    if (typeof IntersectionObserver === 'undefined') {
      for (const id of ids) wallPendingRef.current.add(id)
      void runWallPass()
      return undefined
    }
    const observer = new IntersectionObserver(entries => {
      let added = false
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        const id = (entry.target as HTMLElement).getAttribute('data-reader-entry')
        if (id !== null) { wallPendingRef.current.add(id); added = true }
        observer.unobserve(entry.target)
      }
      if (added) void runWallPass()
    }, { root: container, rootMargin: '120px' })
    for (const card of cards) observer.observe(card)
    return () => { observer.disconnect() }
  }, [wallOn, translator, runWallPass, rows])

  // Turning the wall's translation off cancels the pass and forgets nothing: the
  // memory keeps what came back, so switching on again is instant.
  useEffect(() => {
    if (wallOn) return
    if (wallCancelRef.current !== null) wallCancelRef.current.cancelled = true
    wallCancelRef.current = null
    wallPendingRef.current.clear()
    setWallProgress(null)
    setWallMenu(false)
  }, [wallOn])

  /** Unmount: stop the wall's pass as well as the article's. */
  useEffect(() => () => {
    if (wallCancelRef.current !== null) wallCancelRef.current.cancelled = true
  }, [])

  // Closing the detail (back button, a removed link, a restore that found its
  // entry gone) releases the screen: a fetch still in flight for the closed
  // entry must not write into the next one.
  useEffect(() => {
    if (openEntryId === null) openRequestRef.current = null
  }, [openEntryId])

  /**
   * Fetch one entry's full article, extract it (this process) and show it.
   *
   * Two callers, one contract: the card's own "抓取正文" action, and opening an
   * entry that has no body yet. Both pay exactly one fetch and both record the
   * outcome — a success caches the extracted body, a failure records the reason
   * the host and the extractor gave, which is what the next open reads.
   *
   * @param entryId - the entry whose body is wanted.
   * @param url - the article URL to fetch.
   */
  const fetchBody = useCallback(async (entryId: string, url: string): Promise<number | undefined> => {
    actions.setFetching(entryId, true)
    try {
      const result = await props.fetchEntryBody(entryId, url)
      // A late answer belongs to the entry that ASKED for it: if the detail
      // view has moved on (another entry, or the wall), the article area is no
      // longer this entry's to write. The per-entry records are unaffected —
      // they are keyed by id either way.
      const onScreen = openRequestRef.current === entryId
      if (result.html !== undefined) {
        // A fresh body just landed: the entry is no longer expired, whichever
        // screen is showing.
        actions.setStaleBody(entryId, false)
        // A saved link's card upgrades to the article's own title/excerpt on
        // the same gesture (the action itself refuses feed entries).
        actions.noteExtractedMeta(entryId, {
          ...(result.title === undefined ? {} : { title: result.title }),
          ...(result.excerpt === undefined ? {} : { excerpt: result.excerpt }),
        })
        if (onScreen) {
          actions.setArticle(result.html, result.truncated === true, null)
          setScriptFigures(result.scriptFigures ?? 0)
        }
        // The caller escalates on a shell: a body that still counts script
        // figures wants the rendered fetch next.
        return result.scriptFigures ?? 0
      } else if (result.error !== undefined && onScreen) {
        // Keep whatever is already rendered (a feed summary, say) and add the
        // reason: a failed fetch must not take the little text the reader has.
        // It also leaves the host's copy — and its stale marker — untouched.
        actions.setArticle(articleHtml ?? '', false, result.error)
      }
      return undefined
    } finally {
      actions.setFetching(entryId, false)
      // The card reads the host's annotation through the mirror: re-read the
      // one entry this fetch settled, so the pill flips on this gesture and
      // not at the next mount.
      void syncFetchState(entryId)
    }
  }, [actions, props, articleHtml, syncFetchState])

  /**
   * Refetch the open entry through the capture package's rendered fetch.
   *
   * The captured HTML goes through the SAME whitelist extractor as any fetched
   * page — captured markup is never rendered raw — and the stored body then
   * rides every existing path (the cache, the translation memory, quoting).
   * The slot that calls this renders only while a capture Remote probes
   * present, so a missing package can never reach the middle of this flow.
   *
   * @param entry - the entry on screen.
   */
  const captureBody = useCallback(async (entryId: string, link: string) => {
    const capture = props.captureRemote()
    if (capture === undefined) return
    setCaptureBusy(true)
    try {
      const rendered = await capture.render({ url: link })
      if (!rendered.ok) {
        if (openRequestRef.current === entryId) actions.setArticle(articleHtml ?? '', false, rendered.error.message)
        return
      }
      const finalUrl = rendered.value.finalUrl ?? link
      const extracted = extractArticle(rendered.value.html, finalUrl)
      if (!extracted.ok) {
        if (openRequestRef.current === entryId) actions.setArticle(articleHtml ?? '', false, extracted.error)
        return
      }
      const stored = await props.storeEntryBody({
        entryId,
        url: finalUrl,
        html: extracted.html,
        bodyHash: translationHash(extracted.html),
        ...(rendered.value.truncated === true ? { truncated: true } : {}),
        // A capture render ALWAYS carries its count, zero included: the entry's
        // own load-time count (84 script figures, say) is what the remount
        // falls back to when the body record says nothing — storing the zero
        // is what keeps the notice (and 「渲染抓取」) from rising from the dead
        // on the next open.
        scriptFigures: extracted.scriptFigures ?? 0,
        // …and the body is marked rendered, so 「重新抓取」 re-renders instead
        // of clobbering it with the page's pre-JS shell.
        rendered: true,
      })
      renderedBodiesRef.current.add(entryId)
      if (openRequestRef.current !== entryId) return
      if (stored.ok && stored.value.html !== undefined) {
        actions.setArticle(stored.value.html, stored.value.truncated === true, null)
        setScriptFigures(stored.value.scriptFigures ?? 0)
        actions.setStaleBody(entryId, false)
        void syncFetchState(entryId)
      }
    } finally {
      setCaptureBusy(false)
    }
  }, [actions, props, articleHtml, syncFetchState])

  /**
   * One gesture, the whole pipeline: an explicit per-entry ask (add a link,
   * the card's 「抓取」, opening an entry, the detail's 「重新抓取」) that lands
   * on a script-figure shell continues into the rendered fetch on its own —
   * the gesture already authorized capturing that URL. Fires once per entry
   * per pane session (a failure leaves the manual「渲染抓取」retry); background
   * paths (scheduled feed refresh, backfill) never reach here.
   */
  const maybeAutoRender = useCallback((entryId: string, link: string | undefined, count: number) => {
    if (link === undefined || count <= 0) return
    if (props.captureRemote() === undefined) return
    if (autoRenderTriedRef.current.has(entryId)) return
    autoRenderTriedRef.current.add(entryId)
    void captureBody(entryId, link)
  }, [props, captureBody])

  /** A plain fetch that escalates on a shell — the explicit-gesture fetch path. */
  const fetchThenMaybeRender = useCallback((entryId: string, link: string): void => {
    void fetchBody(entryId, link).then(count => maybeAutoRender(entryId, link, count ?? 0))
  }, [fetchBody, maybeAutoRender])

  /** Open one entry: mark it read and make sure a body is available. */
  const open = useCallback(async (row: ReaderRow) => {
    // Synchronous: every continuation of this call checks the ref before
    // writing article state, so the LAST open (or a close) owns the screen.
    openRequestRef.current = row.entry.id
    openedRef.current = row.entry.id
    actions.openEntry(row.entry.id, row.sourceId)
    actions.setView('detail')
    void loadEntryTags(row.entry.id)
    // The recent list is the READER's record, so it is written on the same
    // gesture that opens the article — including a reopen from that list, which
    // is what moves an entry back to the top. Fire and forget: the page re-reads
    // the host's copy when it opens, and a failure here must not stop the read.
    const recorded: ReaderRecentEntry = {
      entryId: row.entry.id,
      sourceId: row.sourceId,
      title: row.entry.title,
      ...(row.entry.link === undefined ? {} : { url: row.entry.link }),
      readAt: new Date().toISOString(),
    }
    // Mirrored locally as well, so the page is right the first time it is opened
    // in this session instead of after another round trip.
    actions.setRecent([recorded, ...recent.filter(item => item.entryId !== recorded.entryId)])
    void props.recordRead({
      entryId: recorded.entryId,
      sourceId: recorded.sourceId,
      title: recorded.title,
      ...(recorded.url === undefined ? {} : { url: recorded.url }),
    })
    // A cached fetch outlives the feed's own payload, so the host is the one
    // that knows whether there is full text: it returns the fresh cache, else
    // the feed's body, else nothing plus the reason a previous fetch failed.
    if (row.entry.link !== undefined) {
      // A feed that published only a summary still owes the reader an article,
      // whichever branch below supplies the text on screen (the host answers
      // `feedHtml` for the feed's own payload, which is exactly the summary).
      const summaryOwed = row.entry.summaryOnly === true
      const view = await props.getEntryBody({
        entryId: row.entry.id,
        url: row.entry.link,
        ...(row.entry.contentHtml === undefined ? {} : { feedHtml: row.entry.contentHtml }),
      })
      // A per-entry host fact, true no matter which entry is on screen by now,
      // so it is written before the screen guard: whether the host's cached
      // copy is past its deadline (the card's 「已过期」 reads this).
      if (view.ok) actions.setStaleBody(row.entry.id, view.value.cached === true && view.value.fresh === false)
      // The rendered-body flag rides the same answer: 「重新抓取」 re-renders a
      // rendered entry instead of clobbering it with the page's pre-JS shell.
      if (view.ok && view.value.rendered === true) renderedBodiesRef.current.add(row.entry.id)
      // The answer came back to a screen that has moved on: another open (or a
      // close) happened while the host was answering. Writing here would put
      // this entry's body under THAT entry's title.
      if (openRequestRef.current !== row.entry.id) return
      // The mirror the card reads may predate this answer (a body cached after
      // the mount poll, or a recorded failure it has not re-read). When the two
      // disagree, re-read this one entry so the card stops lying.
      const known = fetchStateOf(fetchStates, row.entry.id).state
      if (view.ok && (
        (view.value.cached === true && view.value.html !== undefined && known !== 'ready')
        || (view.value.html === undefined && view.value.error !== undefined && known !== 'failed')
      )) void syncFetchState(row.entry.id)
      if (!view.ok) {
        actions.setArticle('', false, view.error.message)
      } else if (view.value.html !== undefined) {
        actions.setArticle(view.value.html, view.value.truncated === true, null)
        // A stored body carries its count; a fresh link's feedHtml echo is the
        // load-time extraction, whose count rides the entry instead.
        const knownCount = view.value.scriptFigures ?? row.entry.scriptFigures ?? 0
        setScriptFigures(knownCount)
        maybeAutoRender(row.entry.id, row.entry.link, knownCount)
        actions.setStaleBody(row.entry.id, view.value.fresh === false)
        // `html` here is either the FEED's own payload or a body this plugin
        // already fetched and cached — a cached one is paid for already.
        //
        // Re-fetching a cached body was the bug behind "entering the article
        // again makes me translate it all over again": a summary-only feed
        // kept `summaryOwed` true forever, so every look at an article that
        // had already been fetched replaced its DOM (and its translation) with
        // the same text from the network. The body is paid for once; the
        // detail view's own 「重新抓取」 is how a reader asks again.
        if (view.value.fromFeed === true) {
          if (summaryOwed) fetchThenMaybeRender(row.entry.id, row.entry.link as string)
          // Full text the feed itself published: keep it, or it dies with the
          // feed's window (see persistFeedBody).
          else persistFeedBody(row.entry.id, row.entry.link as string, view.value.html, view.value.truncated === true, linkMetaOf(row))
        }
      } else if (row.entry.contentHtml !== undefined) {
        actions.setArticle(row.entry.contentHtml, row.entry.truncated === true, null)
        setScriptFigures(0)
        // The host holds no body at all, and the feed published a summary: show
        // it immediately (better than an empty page) and fetch the real text
        // behind it. A feed FULL text in the same situation is kept instead —
        // there is nothing to fetch for it.
        if (summaryOwed) fetchThenMaybeRender(row.entry.id, row.entry.link as string)
        else persistFeedBody(row.entry.id, row.entry.link as string, row.entry.contentHtml, row.entry.truncated === true, linkMetaOf(row))
      } else {
        // Nothing cached, nothing from the feed, and no recorded reason.
        //
        // For a FEED entry that is the ordinary state of a body the automatic
        // backfill has not reached (or one whose cached body expired): opening
        // an entry IS the reader asking for its text, so pay for one fetch
        // instead of showing a title over blank space. This is the same call
        // the card's own 「抓取正文」 uses, so it extracts, caches, and records
        // a failure reason — which is what the next open reads.
        //
        // For a SAVED LINK with no reason, the payload arrived but did not
        // become a body: that already has its sentence (and a manual retry in
        // the card menu), and fetching again on every open would be a request
        // per look at a page that has already refused to be extracted.
        const reason = view.value.error ?? (row.sourceKind === 'link' ? t('detail.extractFailed') : null)
        actions.setArticle('', false, reason)
        if (row.sourceKind === 'rss' && view.value.error === undefined) {
          fetchThenMaybeRender(row.entry.id, row.entry.link as string)
        }
      }
      return
    }
    if (row.entry.contentHtml !== undefined) {
      actions.setArticle(row.entry.contentHtml, row.entry.truncated === true, null)
      return
    }
    const bodies = await props.getBodies([row.sourceId])
    // Same guard as above: a no-link entry's body also arrives late.
    if (openRequestRef.current !== row.entry.id) return
    if (!bodies.ok) {
      actions.setArticle('', false, bodies.error.message)
      return
    }
    const body = bodies.value.bodies[0]
    if (body?.raw === undefined) {
      actions.setArticle('', false, body?.error ?? t('detail.extractFailed'))
      return
    }
    const truncated = body.truncated === true
    const extracted = extractArticle(body.raw, row.entry.link ?? '')
    if (extracted.ok) {
      actions.setArticle(extracted.html, truncated, null)
      // The link-entry path extracts inline, so the script-figure count (and
      // with it the notice + auto-render escalation) must be set here too — the
      // fetch paths set it from the host's answer, this one computes it locally.
      const count = extracted.scriptFigures ?? 0
      setScriptFigures(count)
      maybeAutoRender(row.entry.id, row.entry.link, count)
    } else actions.setArticle('', truncated, extracted.error)
  }, [actions, props, t, fetchThenMaybeRender, persistFeedBody, recent, fetchStates, syncFetchState, maybeAutoRender])

  /* ------------------------------ coming back to where the reader already was */

  /**
   * Re-open the article the pane had on screen when the sidebar went away.
   *
   * Only the LIST came back with the store snapshot; bodies are host state, so
   * the page has to be re-established by the same call a tap makes — which
   * answers from the host's cache and does not fetch. Waiting for the parsed
   * entries is what makes this safe: until they arrive there is nothing to open.
   */
  useEffect(() => {
    if (allEntries.length === 0) return
    const wanted = readSession().openEntryId
    if (wanted === undefined || wanted === null) return
    if (restoredOpenRef.current === wanted || openedRef.current === wanted) {
      restoredOpenRef.current = wanted
      return
    }
    if (openEntryId !== wanted) { restoredOpenRef.current = wanted; return }
    const entry = entryById(wanted)
    if (entry === undefined) {
      // Two different "not there yet": the wall's parse is still filling in, or
      // the recent list (which may be the only record of this entry) has not
      // been read. Only a settled miss means the entry is gone for good, and
      // then the wall is the honest place to stand — which also means dropping
      // the entry from the store, because the pane now renders the detail
      // surface for as long as an entry is open (a settle that gave up while
      // the id stayed behind would sit on that surface forever).
      if (!loading && recentLoadedRef.current) {
        restoredOpenRef.current = wanted
        actions.closeEntry()
      }
      return
    }
    restoredOpenRef.current = wanted
    const row = rowFor(entry, presentation, read)
    if (row === undefined) return
    void open(row)
  }, [allEntries, openEntryId, presentation, read, loading, open, entryById, actions])

  /**
   * Put the reader back where they were inside the article.
   *
   * The saved ANCHOR is the target — the Nth top-level block and how far into it
   * the viewport top sat — and it is re-applied whenever the body is (re)built:
   * a restored pane, a re-opened entry, a fetch landing after the feed's summary,
   * an element React recreated.
   *
   * A pixel offset alone was not enough, and neither was applying it once. An
   * article's images carry no dimensions (`extract-article` keeps the site's own
   * markup), so the document GROWS as they load: a pixel target recorded against
   * the settled page lands in the middle of a short one, the browser clamps it,
   * and the reader is left at the top while the content keeps moving under them.
   * The anchor names the content, and the retry below keeps naming it.
   */
  /** The last measured article geometry; anchoring reads this, never the DOM. */
  const metricsRef = useRef<ArticleMetrics | null>(null)

  /** Measure the article (one layout pass) and remember the result. */
  const measure = useCallback((): ArticleMetrics | null => {
    const scroller = detailRef.current
    const article = articleRef.current
    if (scroller === null || article === null) return null
    const metrics = measureArticle(scroller, article)
    metricsRef.current = metrics
    return metrics
  }, [])

  /**
   * Put the reader back where they were inside the article.
   *
   * The saved ANCHOR is the target — the Nth top-level block and how far into it
   * the viewport top sat — and it is re-applied whenever the body is (re)built:
   * a restored pane, a re-opened entry, a fetch landing after the feed's summary,
   * an element React recreated.
   *
   * A pixel offset alone was not enough, and neither was applying it once. An
   * article's images carry no dimensions (`extract-article` keeps the site's own
   * markup), so the document GROWS as they load: a pixel target recorded against
   * the settled page lands in the middle of a short one, the browser clamps it,
   * and the reader is left at the top while the content keeps moving under them.
   * The anchor names the content, and this keeps naming it.
   *
   * @returns true when the scroller actually reached the target.
   */
  const applyReadingPosition = useCallback((): boolean => {
    const scroller = detailRef.current
    if (scroller === null || openEntryId === null) return true
    const anchor = readSession().scroll?.[openEntryId]
    if (anchor === undefined || anchor.top <= 0) return true
    let target = anchor.top
    // With no measurement (a test environment, or a body that has not been laid
    // out yet) the pixel offset is all there is to go on.
    const metrics = metricsRef.current
    if (metrics !== null) {
      const block = metrics.blocks[anchor.block]
      if (block !== undefined) {
        target = Math.max(0, metrics.contentTop + block.top + offsetInBlock(block, anchor))
      }
    }
    const before = scroller.scrollTop
    scroller.scrollTop = target
    // The browser's own echo of this write carries what it actually accepted.
    // When the assignment changed nothing there is no echo coming, so the record
    // is cleared — a stale echo is what makes a reader's scroll look like ours.
    scrollEchoRef.current = scroller.scrollTop === before ? null : scroller.scrollTop
    return Math.abs(scroller.scrollTop - target) <= 1
  }, [openEntryId])

  useEffect(() => {
    if (openEntryId === null || articleHtml === null) return undefined
    // A new body is a new chance for the reader to take over by scrolling.
    readerScrolledRef.current = false
    let frame = 0
    let attempt = 0
    const step = (): void => {
      if (readerScrolledRef.current) return
      if (applyReadingPosition()) return
      attempt += 1
      if (attempt < SCROLL_SETTLE_ATTEMPTS) frame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(step) : 0
    }
    // Measured after the body is in the document, once: the first layout of a
    // long article is expensive, and a scroll handler must never pay for it.
    if (typeof requestAnimationFrame === 'function') frame = requestAnimationFrame(() => { measure(); step() })
    else { measure(); step() }

    // Late layout is the common case, not the exception: every `<img>` with no
    // dimensions resizes the document when it arrives. The observer re-measures
    // (the geometry really did change) and re-anchors, until the reader takes
    // over or the window closes.
    const article = articleRef.current
    const deadline = Date.now() + POSITION_SETTLE_MS
    let observer: ResizeObserver | null = null
    if (typeof ResizeObserver === 'function' && article !== null) {
      observer = new ResizeObserver(() => {
        if (readerScrolledRef.current || Date.now() > deadline) return
        measure()
        applyReadingPosition()
      })
      observer.observe(article)
    }
    const giveUp = typeof setTimeout === 'function'
      ? setTimeout(() => { observer?.disconnect() }, POSITION_SETTLE_MS)
      : undefined
    return () => {
      if (frame !== 0 && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame)
      observer?.disconnect()
      if (giveUp !== undefined) clearTimeout(giveUp)
    }
  }, [openEntryId, articleHtml, applyReadingPosition, measure])

  /**
   * A translation rewrites the article's GEOMETRY — different words, different
   * block heights — whenever it lands or changes view, which is typically long
   * after the settle window above has closed. Re-measure and re-anchor on those
   * transitions so the reader stays at the same SENTENCE across an
   * original↔translation switch (the anchor's text offset is what makes "the
   * same sentence" computable; `offsetInBlock` owns the mapping).
   *
   * A view switch is a deliberate one-shot, so the layout read here is fine —
   * the no-layout-reads rule is the scroll handler's. `measure()` answering
   * null (no body on screen yet) skips the apply, and the effect fires on
   * `openEntryId` changes only through `applyReadingPosition`'s identity —
   * harmless, because an unmeasured body is exactly what that skips.
   */
  useEffect(() => {
    if (measure() === null) return
    applyReadingPosition()
  }, [translateView, translatePhase, measure, applyReadingPosition])

  /**
   * The scroller's own gestures, which is how the reader takes over.
   *
   * `wheel`, `touchmove` and the page keys are things only a person produces:
   * every programmatic write this pane makes comes from `scrollTop`, so listening
   * for gestures is a far safer signal than trying to recognise our own echo —
   * mistaking one for the other is what left a reader at the top of an article
   * whose position we had just applied.
   */
  useEffect(() => {
    const scroller = detailRef.current
    if (scroller === null) return undefined
    const takeOver = (): void => {
      readerScrolledRef.current = true
      lastDetailGestureRef.current = Date.now()
    }
    scroller.addEventListener('wheel', takeOver, { passive: true })
    scroller.addEventListener('touchmove', takeOver, { passive: true })
    scroller.addEventListener('keydown', takeOver)
    return () => {
      scroller.removeEventListener('wheel', takeOver)
      scroller.removeEventListener('touchmove', takeOver)
      scroller.removeEventListener('keydown', takeOver)
    }
  }, [openEntryId, articleHtml])

  /**
   * Remember the reading position as it moves.
   *
   * Deliberately unthrottled: the work is a binary search over the measured
   * blocks plus one small record write — no layout reads at all, because reading
   * layout here is what made the browser report a forced reflow on every scroll.
   *
   * Only the READER's own scrolling is recorded. Setting `scrollTop` to restore
   * a position fires this handler too, and saving that echo is how a position
   * gets destroyed: a clamped assignment carries the clamped value, which would
   * overwrite the real target with the short body's height.
   */
  const onDetailScroll = useCallback(() => {
    const scroller = detailRef.current
    if (scroller === null || openEntryId === null) return
    if (scrollEchoRef.current !== null && Math.abs(scroller.scrollTop - scrollEchoRef.current) < 2) {
      scrollEchoRef.current = null
      return
    }
    scrollEchoRef.current = null
    // Only a scroll the reader CAUSED is their position. A programmatic write
    // has its echo above; a browser clamp (the document shrinking under a
    // scrolled scroller — a translation rebuild, a body swap, a remount's
    // intermediate short state) has neither: on 3080 a remount's translation
    // rebuild clamped the scroller and the clamp's scroll event overwrote the
    // stored anchor with the clamped value, so the reader came back to the top.
    // The gesture window is what a scroll event's cause is read from.
    if (Date.now() - lastDetailGestureRef.current > SCROLL_GESTURE_WINDOW_MS) return
    const metrics = metricsRef.current
    const top = Math.round(scroller.scrollTop)
    if (metrics === null) {
      rememberReadingPosition(openEntryId, { block: 0, offset: top, top })
      return
    }
    const visibleY = top - metrics.contentTop
    const { block, offset } = blockAt(metrics, visibleY)
    const anchorBlock = metrics.blocks[block]
    // The same place as a TEXT offset too, so a layout that sets different
    // words (the translated view) can still find the sentence. From the cached
    // metrics only — this handler reads no layout and no DOM. Only a position
    // strictly INSIDE the block gets a text offset: past the last block (the
    // also-in-this-source section), the pixel clamp is the honest restore.
    if (anchorBlock !== undefined && anchorBlock.height > 0 && anchorBlock.textLength > 0 && offset < anchorBlock.height) {
      const text = Math.round(Math.min(1, offset / anchorBlock.height) * anchorBlock.textLength)
      rememberReadingPosition(openEntryId, { block, offset, top, text, textLength: anchorBlock.textLength })
      return
    }
    rememberReadingPosition(openEntryId, { block, offset, top })
  }, [openEntryId])

  /**
   * Remember where the reader had scrolled the WALL itself.
   *
   * Same rule as the article: only the reader's own scrolling is recorded, so
   * the echo of a restore never becomes the new target.
   */
  const onWallScroll = useCallback(() => {
    const scroller = wallRef.current
    if (scroller === null) return
    if (wallEchoRef.current !== null && Math.abs(scroller.scrollTop - wallEchoRef.current) < 2) {
      wallEchoRef.current = null
      return
    }
    wallEchoRef.current = null
    // Same contract as the article's: only a scroll the reader caused is their
    // place — a clamp while the wall's content shrinks is not.
    if (Date.now() - lastWallGestureRef.current > SCROLL_GESTURE_WINDOW_MS) return
    rememberWallScroll(scroller.scrollTop)
  }, [])

  /** The wall scroller's gestures, the same "only a person produces these" signal. */
  useEffect(() => {
    const scroller = wallRef.current
    if (scroller === null) return undefined
    const mark = (): void => { lastWallGestureRef.current = Date.now() }
    scroller.addEventListener('wheel', mark, { passive: true })
    scroller.addEventListener('touchmove', mark, { passive: true })
    scroller.addEventListener('keydown', mark)
    return () => {
      scroller.removeEventListener('wheel', mark)
      scroller.removeEventListener('touchmove', mark)
      scroller.removeEventListener('keydown', mark)
    }
  }, [view, displayRows.length])

  // Put the wall back where it was, once per entry into the list view: a long
  // wall that jumps to the top on every panel switch is the same complaint as a
  // lost reading position. Re-applying it whenever the ROWS change would fight
  // the reader's own filtering.
  useEffect(() => {
    if (view !== 'list') { wallRestoredRef.current = false; return }
    if (wallRestoredRef.current) return
    const scroller = wallRef.current
    if (scroller === null || displayRows.length === 0) return
    wallRestoredRef.current = true
    const target = readSession().wallScroll
    if (target === undefined || target <= 0) return
    scroller.scrollTop = target
    wallEchoRef.current = scroller.scrollTop
  }, [view, displayRows.length])

  /**
   * A rebuilt body means the old segmentation died with the old DOM — so the
   * record gets another chance, keyed on the BODY and not only on the entry.
   *
   * That is the difference between "the globe is on for this entry" and "the
   * globe was on the first time this entry was opened": a body replaced under
   * the reader (a fetch landing after a restore, an expired cache re-fetched, a
   * re-render that recreated the element) used to leave the article on screen
   * untranslated with nothing to put the translation back. The record is the
   * single source of truth, and it is deleted the moment the reader turns the
   * globe off or asks for a fresh fetch.
   */
  useEffect(() => { restoredTranslationRef.current = null }, [openEntryId, articleHtml])

  /**
   * Turn the globe back on for an entry that was translated before the sidebar
   * went away.
   *
   * Only when a translator session for that pair is ALREADY built (the page's
   * cache): `Translator.create()` needs user activation, so a restore that had
   * to build one would fail with an error the reader never asked for. No session
   * means no restore — the record stays, and the reader's next click on the
   * globe costs nothing because the same cache answers it.
   */
  useEffect(() => {
    if (view !== 'detail' || openEntryId === null) return
    if (articleHtml === null || articleHtml.length === 0) return
    if (translatePhase !== 'idle') return
    if (restoredTranslationRef.current === openEntryId) return
    const wanted = readSession().translationView?.[openEntryId]
    if (wanted === undefined) return
    const source = readSession().translationSource?.[openEntryId] ?? translationSource
    const sources = source === 'en' ? ['en'] : [source, 'en']
    if (cachedTranslator(sources, TARGET_CANDIDATES) === undefined) return
    restoredTranslationRef.current = openEntryId
    void startTranslation(wanted, source)
  }, [view, openEntryId, articleHtml, translatePhase, translationSource, startTranslation])

  /** Submit the add form and report the host's verdict. */
  const submit = useCallback(async () => {
    const url = draftUrl.trim()
    if (url.length === 0) return
    setVerdict(null)
    const result = await props.addSource(url)
    if (!result.ok) {
      // A transport-level failure: the host never answered, so the reason is
      // whatever the wire layer said.
      setVerdict({ kind: 'fetchFailed', reason: result.error.message })
      return
    }
    const value = result.value
    if (typeof value === 'string') {
      setVerdict({ kind: verdictForRefusal(value) })
      return
    }
    if (value.outcome === 'fetch-failed') {
      // The fetch failed with a reason of its own ("connect ECONNREFUSED …",
      // "body over the seam's byte cap"). Showing it is the difference between
      // a retry and a report nobody can act on.
      setVerdict({ kind: 'fetchFailed', reason: value.reason })
      return
    }
    if (value.failure !== undefined) {
      // Saved, but there is no body to preview. This is NOT a failure verdict:
      // the link is in the wall, and the sentence names the reason so the
      // reader knows whether it is worth opening in a browser. The URL rides
      // along: for the causes a real browser solves, the verdict itself offers
      // the way out (the moment "why" lands is the moment to act on it).
      setVerdict({
        kind: 'savedLinkNoPreview',
        label: value.label,
        reason: value.failure.message,
        code: value.failure.code,
        url,
      })
      setDraftUrl('')
      actions.refresh()
      return
    }
    setVerdict({
      kind: value.outcome === 'subscribed' ? 'subscribed' : 'savedLink',
      label: value.label,
    })
    setDraftUrl('')
    // Reload so the new entry is on the wall behind the dialog, not only in
    // the host's state.
    actions.refresh()
  }, [actions, draftUrl, props])

  /** Re-fetch one source from the subscription page. */
  const refreshOne = useCallback(async (id: string) => {
    actions.setRefreshing(true)
    try {
      const result = await props.refresh([id])
      if (!result.ok) actions.setError(result.error.message)
      else actions.refresh()
    } finally {
      actions.setRefreshing(false)
    }
  }, [actions, props])

  /** Pause or resume one source from the subscription page. */
  const toggleSource = useCallback(async (id: string, enabled: boolean) => {
    const result = await props.updateSource({ id, enabled })
    if (result.ok) actions.refresh()
  }, [actions, props])

  /** Drop one source (and everything it brought) from the subscription page. */
  const removeSource = useCallback(async (id: string) => {
    // The entries this pane has parsed for the source: their translation maps
    // die with the source (the host never parses feeds, so the caller names
    // them). A rolled-off entry's map is the budget's business, as before.
    const entryIds = allEntries.filter(entry => entry.sourceId === id).map(entry => entry.id)
    const result = await props.removeSource(id, entryIds)
    if (result.ok) {
      actions.clearParsed()
      actions.refresh()
    }
  }, [actions, props, allEntries])

  /**
   * Delete one saved link from wherever the reader is standing.
   *
   * A `link` source IS its single entry, so deleting the entry and deleting the
   * source are the same act — which is why the detail view can offer it. A feed
   * entry has no such button: the source would bring it back on the next
   * refresh, so the honest verbs for it are the subscription ones.
   *
   * @param sourceId - the link source to drop.
   */
  const removeLink = useCallback(async (sourceId: string) => {
    await removeSource(sourceId)
    actions.closeEntry()
  }, [actions, removeSource])

  /**
   * Apply an edited URL and/or label to one source.
   *
   * A URL change is not a cosmetic edit: the next fetch is a different
   * document, so the stored payload is replaced by the fetch that follows and
   * the label falls back to the feed's own title when the editor clears it.
   */
  const saveSource = useCallback(async (id: string, url: string, label: string) => {
    const result = await props.updateSource({
      id,
      url: url.trim(),
      label: label.trim(),
    })
    if (!result.ok) {
      actions.setError(result.error.message)
      return
    }
    await props.refresh([id])
    actions.refresh()
  }, [actions, props])

  /** Move the daily refresh time. */
  const setRefreshTime = useCallback(async (value: string) => {
    setTimeOfDay(value)
    // The host reports `invalid-time` for anything it cannot parse, and the
    // input is a native time field, so a bad value only comes from a manual
    // edit; keep the field's value and let the next handshake correct it.
    await props.updateSource({ id: '', timeOfDay: value })
    actions.refresh()
  }, [actions, props])

  /**
   * Fill in missing full text automatically, a slice per load.
   *
   * This is the package's answer to "the feed gave me a summary": the host says
   * which entries lack text (and which are not worth a retry yet), this process
   * fetches + extracts each one, and the wall marks what arrived. Two requests
   * at a time, because this talks to other people's servers.
   *
   * @param entries - the entries currently on the wall.
   */
  const backfillBodies = useCallback(async (entries: readonly ReaderRow[]) => {
    if (backfillRunning.current) return
    const missing = entries.filter(row =>
      (row.entry.contentHtml === undefined || row.entry.summaryOnly === true)
      && row.entry.link !== undefined
      && !backfillTried.current.has(row.entry.id))
    if (missing.length === 0) return
    backfillRunning.current = true
    try {
      const listed = await props.listBackfillCandidates(missing.map(row => ({
        entryId: row.entry.id,
        url: row.entry.link as string,
        label: row.entry.title,
        hasBody: false,
      })))
      if (!listed.ok) return
      const queue = [...listed.value.candidates]
      if (queue.length === 0) return
      actions.setBackfill({ total: queue.length, done: 0 })
      let filled = 0
      const workers = Array.from({ length: Math.min(BACKFILL_CONCURRENCY, queue.length) }, async () => {
        for (;;) {
          const next = queue.shift()
          if (next === undefined) return
          backfillTried.current.add(next.entryId)
          const result = await props.fetchEntryBody(next.entryId, next.url)
          const got = result.html !== undefined
          if (got) filled += 1
          actions.noteBackfilled(next.entryId, got)
        }
      })
      await Promise.all(workers)
      // Deliberately no `actions.refresh()` here: bumping `rev` would re-enter
      // `load()` and start the whole thing over. Only the DETAIL view re-reads,
      // and it does so when it mounts. But the fetch-state mirror DOES re-read
      // once per run — otherwise a card whose body the backfill just landed
      // keeps saying 抓取 until the next mount (the reported symptom).
      await refreshFetchStates()
    } finally {
      backfillRunning.current = false
      actions.setBackfill(null)
    }
  }, [actions, props, refreshFetchStates])

  // Automatic, after the wall has something to look at — never before, so the
  // reader never waits on the network for a list they already had. A folded
  // duplicate's copy is not fetched while it is hidden: the survivor answers.
  useEffect(() => {
    if (loading || allEntries.length === 0) return
    const pool = selectRows(allEntries, presentation, {
      filter: 'all', query: '', unreadOnly: false, sort, read, tags: entryTagIds, now: new Date(),
    })
    void backfillBodies(hideDupes ? dedupeRows(pool).rows : pool)
  }, [loading, allEntries, presentation, sort, read, entryTagIds, hideDupes, backfillBodies])

  // Any menu/panel dismisses on the next click outside it — the host's own
  // menus behave that way, and a popover that outlives its context is a trap.
  useEffect(() => {
    if (cardMenu === null && cardTag === null && !filterOpen && !translateMenu && !wallMenu && pillInfo === null) return undefined
    const dismiss = (event: MouseEvent): void => {
      const target = event.target as HTMLElement | null
      if (target?.closest('[class*="cardMenu"], [class*="cardTagPanel"], [class*="filterPanel"], [class*="translateWrap"], [class*="pillPop"]') !== null) return
      setCardMenu(null)
      setCardTag(null)
      setFilterOpen(false)
      setTranslateMenu(false)
      setWallMenu(false)
      setPillInfo(null)
    }
    window.addEventListener('mousedown', dismiss)
    return () => window.removeEventListener('mousedown', dismiss)
  }, [cardMenu, cardTag, filterOpen, translateMenu, wallMenu, pillInfo])



  /** Fetch one entry without opening it: the card's own 抓取 action. */
  const startFetch = useCallback(async (entry: ReaderEntry) => {
    if (entry.link === undefined) return
    actions.setFetchStates({ [entry.id]: { state: 'fetching', at: new Date().toISOString() } })
    // `fetchBody` is the same call the detail view makes on open — the host
    // stores the payload first, so leaving the page does not cancel it. It also
    // re-reads this entry's state from the host when the fetch settles, so the
    // pill flips without a full-wall poll here.
    const count = await fetchBody(entry.id, entry.link)
    // One gesture, the whole pipeline: a shell answer continues into the
    // rendered fetch on its own (see maybeAutoRender).
    maybeAutoRender(entry.id, entry.link, count ?? 0)
  }, [actions, fetchBody, maybeAutoRender])

  /** Reload the tags on one entry. */
  const loadEntryTags = useCallback(async (entryId: string) => {
    const result = await props.entryTags(entryId)
    if (result.ok) actions.setEntryTags(entryId, result.value.tags.map(tag => tag.id))
  }, [actions, props])

  /**
   * Fetch this entry's article again, from the detail view.
   *
   * The same call the card's pill makes, with one addition: the translation
   * record is dropped first. The body is about to be a different DOM, and a
   * record that outlived it would switch the globe back on over text it was
   * never built for.
   *
   * @param entry - the entry on screen.
   */
  const refetchEntry = useCallback(async (entry: ReaderEntry) => {
    if (entry.link === undefined) return
    forgetTranslation(entry.id)
    restoredTranslationRef.current = entry.id
    // A rendered body re-renders: a plain fetch would clobber it with the
    // page's pre-JS shell. A manual gesture always allowed (the auto-render
    // loop guard does not apply to it).
    if (renderedBodiesRef.current.has(entry.id) && props.captureRemote() !== undefined) {
      autoRenderTriedRef.current.delete(entry.id)
      await captureBody(entry.id, entry.link)
      return
    }
    await startFetch(entry)
  }, [startFetch, captureBody, props])

  /**
   * Delete a tag from the vocabulary and from every entry carrying it.
   *
   * The vocabulary is the reader's own creation, so it has to be deletable —
   * a tag that can only be made is a one-way door. Two follow-ups are not
   * optional: the active narrowing is dropped when it was that tag (otherwise
   * the wall keeps filtering by something that no longer exists), and the
   * session's tag ids are pruned so no card keeps drawing a dead chip.
   *
   * @param tagId - the tag to delete.
   */
  const removeTag = useCallback(async (tagId: string) => {
    const result = await props.deleteTag(tagId)
    if (!result.ok) return
    if (query.trim() === tagQuery(tagId)) actions.setQuery('')
    actions.dropTag(tagId)
    actions.refresh()
  }, [actions, props, query])

  /**
   * Open the tag panel for one card, without opening the article.
   *
   * The panel is `position: fixed`, so its seat is decided here instead of by a
   * CSS constant: below the card when the viewport has room for it, above the
   * card when it does not, and never past either gutter. The previous version
   * only knew `card.bottom + 4`, which opened a panel that ran off the bottom
   * of a short sidebar.
   */
  const openCardTag = useCallback((entryId: string) => {
    void loadEntryTags(entryId)
    setTagDraft('')
    const box = document.querySelector(`[data-reader-entry="${entryId}"]`)?.getBoundingClientRect()
    // 84px of chrome (header + input + padding) plus one row per tag; the head
    // and the input are fixed here, so this is exact enough to choose a side.
    const height = Math.min(TAG_PANEL_MAX_HEIGHT, 84 + tags.length * 30)
    const left = Math.max(8, Math.min(box?.left ?? 40, window.innerWidth - TAG_PANEL_WIDTH - 8))
    const below = (box?.bottom ?? 120) + 6
    const above = (box?.top ?? 120) - height - 6
    const top = below + height <= window.innerHeight - 8 || above < 8 ? below : above
    setCardTag({ entryId, top, left })
  }, [loadEntryTags, tags.length])

  /** Toggle one tag on one entry. */
  const toggleTag = useCallback(async (entryId: string, tagId: string, on: boolean) => {
    const result = await props.tagEntry(entryId, tagId, on)
    if (!result.ok) return
    await loadEntryTags(entryId)
    const listed = await props.listTags()
    if (listed.ok) actions.setTags(listed.value.tags, listed.value.counts)
  }, [actions, loadEntryTags, props])

  /** Create a tag by name (or reuse the one that already has it) and apply it. */
  const createAndTag = useCallback(async (entryId: string, name: string) => {
    const created = await props.createTag(name)
    if (!created.ok || typeof created.value === 'string') return
    setTagDraft('')
    setTagInputOpen(false)
    await toggleTag(entryId, created.value.id, true)
  }, [props, toggleTag])

  /** Quote the open entry (or a selection) into the conversation draft. */
  const quote = useCallback((explicit?: string) => {
    if (openEntry === undefined) return
    const selection = explicit ?? window.getSelection()?.toString() ?? ''
    const source = presentation.get(openEntry.sourceId)
    const block = formatReaderRef(selection, provenanceOf(openEntry, {
      label: source?.label ?? openEntry.title,
    }))
    const next = mergedDraft(props.readDraft(), block)
    props.setDraft(next)
    setDraft(next)
  }, [openEntry, presentation, props])

  const copyLink = useCallback(async () => {
    if (openEntry?.link === undefined) return
    await props.copyText(openEntry.link)
  }, [openEntry, props])

  /**
   * The way out to a real browser for a page the fetch cannot do justice to.
   *
   * The in-app Sidebar Browser (host 0.1.6-alpha.2+) keeps the reader inside
   * the product; on an older host the same gesture is the ordinary external
   * link. Probed at render, never thrown.
   */
  const browserTab = props.browserTabAvailable()
  /** The capture package's Remote, while one is mounted (M1; absent by default). */
  const captureRemote = props.captureRemote()
  const openElsewhere = useCallback((url: string) => {
    if (props.openBrowserTab(url)) return
    props.openExternal(url)
  }, [props])

  /* ------------------------------------------------------------------ render */

  /**
   * The pane's header.
   *
   * @param back - true on a page that left the wall (detail, subscriptions),
   *   which needs the way back. The wall itself shows none — there is nothing
   *   behind it.
   */
  const header = (back: boolean): ReactNode => (
    <div className={css.head}>
      {back && (
        <button
          type="button"
          className={css.tool}
          title={t('action.back')}
          onClick={() => { actions.setView('list'); actions.closeEntry() }}
        >
          <IconChevronLeftOutlineMedium size={14} />
        </button>
      )}
      <span className={css.headTitle}>
        <IconGlobeOutlineMedium size={14} />
        {t('tab.label')}
        <span className={css.count} title={t('filter.unreadOnly')}>
          {countUnread(displayRows)} {t('foot.unread')}
        </span>
      </span>
      <button
        type="button"
        className={`${css.tool} ${refreshing ? css.toolSpinning : ''}`}
        title={t('action.refresh')}
        disabled={refreshing}
        onClick={() => { void refreshAll() }}
      >
        <IconRefreshOutlineMedium size={15} />
      </button>
      {/* The wall's own controls, in the header row with refresh: the filter
          (every way to narrow the wall), the sort, and the wall's translation
          switch. Each popover hangs off its own button, which is what keeps it
          anchored under the control that opened it now that the buttons no
          longer sit in the search row. */}
        <span className={css.toolWrap}>
          <button
            type="button"
            className={`${css.tool} ${activeSource !== null || activeKind !== null || unreadOnly ? css.toolOn : ''}`}
            title={t('action.filter')}
            onClick={() => {
              setSortOpen(false)
              // Every open starts at the panel's root, with the source page's
              // search box empty: the panel is a place, not a form that keeps
              // yesterday's state.
              if (!filterOpen) { setFilterPage('root'); setSourceFilter('') }
              setFilterOpen(!filterOpen)
            }}
          >
            {glyph('funnel', 15)}
          </button>
          {filterOpen && (
            <div
              className={css.filterPanel}
              onKeyDown={event => { if (event.key === 'Escape') setFilterOpen(false) }}
            >
              {filterPage === 'source' ? (
                <>
                  {/* The source page: the list that grows without bound, so it
                      gets the panel's height, its own scroll AND its own search
                      box. One level down keeps the root short no matter how many
                      subscriptions accumulate (the cascading picker). */}
                  <div className={css.filterPanelHead}>
                    <button
                      type="button"
                      className={css.filterBack}
                      title={t('action.back')}
                      onClick={() => { setFilterPage('root'); setSourceFilter('') }}
                    >
                      <IconChevronLeftOutlineMedium size={12} />
                    </button>
                    <span className={css.filterPanelTitle}>{t('filter.bySource')}</span>
                    <span className={css.filterCount}>{sources.length}</span>
                  </div>
                  {sources.length >= SOURCE_SEARCH_MIN && (
                    <div className={css.filterSearch}>
                      {glyph('search', 11)}
                      <input
                        autoFocus
                        value={sourceFilter}
                        placeholder={t('filter.searchSource')}
                        onChange={event => setSourceFilter(event.target.value)}
                      />
                      {sourceFilter.length > 0 && (
                        <button
                          type="button"
                          className={css.searchClear}
                          title={t('action.clearSearch')}
                          aria-label={t('action.clearSearch')}
                          onClick={() => { setSourceFilter('') }}
                        >
                          {glyph('close', 13)}
                        </button>
                      )}
                    </div>
                  )}
                  <div className={css.filterList}>
                    <button
                      type="button"
                      className={css.filterRow}
                      onClick={() => { actions.setQuery(''); setFilterOpen(false) }}
                    >
                      <span className={css.filterCheck}>{activeSource === null ? '✓' : ''}</span>
                      <span className={css.filterLabel}>{t('filter.all')}</span>
                      <span className={css.filterCount}>{allEntries.length}</span>
                    </button>
                    {matchingSources.map(source => {
                      const group = parsed[source.id]
                      const broken = group?.error !== undefined || group?.incomplete === true
                      return (
                        <button
                          key={source.id}
                          type="button"
                          className={css.filterRow}
                          title={source.url}
                          onClick={() => { actions.setQuery(sourceQuery(source.id)); setFilterOpen(false) }}
                        >
                          <span className={css.filterCheck}>{activeSource === source.id ? '✓' : ''}</span>
                          <span className={css.filterLabel}>{source.label}</span>
                          {broken
                            ? <span className={css.chipBroken} title={t('state.incomplete')}>!</span>
                            : <span className={css.filterCount}>{group?.entries.length ?? 0}</span>}
                        </button>
                      )
                    })}
                    {matchingSources.length === 0 && (
                      <div className={css.filterEmpty}>{t('filter.noSourceMatch')}</div>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <div className={css.filterSection}>{t('filter.readState')}</div>
                  <button type="button" className={css.filterRow} onClick={() => actions.toggleUnreadOnly()}>
                    <span className={css.filterCheck}>{unreadOnly ? '✓' : ''}</span>
                    <span className={css.filterLabel}>{t('filter.unreadOnly')}</span>
                  </button>
                  {/* The dedupe switch lives with the wall's other narrowing:
                      it decides what the wall shows, not how it looks. */}
                  <button type="button" className={css.filterRow} onClick={() => actions.toggleHideDupes()}>
                    <span className={css.filterCheck}>{hideDupes ? '✓' : ''}</span>
                    <span className={css.filterLabel}>{t('filter.hideDupes')}</span>
                  </button>
                  {/* The drill row carries the CURRENT value, so a narrowing
                      filter is never hidden one level down: the reader sees
                      "按来源 · OpenAI" without opening the list. */}
                  <button
                    type="button"
                    className={css.filterRow}
                    onClick={() => { setSourceFilter(''); setFilterPage('source') }}
                  >
                    <span className={css.filterLabel}>{t('filter.bySource')}</span>
                    <span className={css.filterValue}>{activeSourceLabel ?? t('filter.all')}</span>
                    <span className={css.filterChevron}>{glyph('chevron', 12)}</span>
                  </button>
                  {/* By KIND, next to by-source: a saved link and a feed entry
                      are two different things to look for, and "where is the
                      link I just added" is not answerable from a source list
                      once the wall has a few hundred cards. The value lands in
                      the search box like every other narrowing here, so it is
                      visible and clearable. */}
                  <div className={css.filterSection}>{t('filter.byKind')}</div>
                  <button
                    type="button"
                    className={css.filterRow}
                    onClick={() => { actions.setQuery(''); setFilterOpen(false) }}
                  >
                    <span className={css.filterCheck}>{query.trim() === '' ? '✓' : ''}</span>
                    <span className={css.filterLabel}>{t('filter.all')}</span>
                    <span className={css.filterCount}>{allEntries.length}</span>
                  </button>
                  {READER_SOURCE_KINDS.map(kind => (
                    <button
                      key={kind}
                      type="button"
                      className={css.filterRow}
                      onClick={() => { actions.setQuery(kindQuery(kind)); setFilterOpen(false) }}
                    >
                      <span className={css.filterCheck}>{activeKind === kind ? '✓' : ''}</span>
                      <span className={css.filterLabel}>{t(kind === 'link' ? 'sources.kindLink' : 'sources.kindRss')}</span>
                      <span className={css.filterCount}>{kindCounts[kind]}</span>
                    </button>
                  ))}
                  {tags.length > 0 && <div className={css.filterSection}>{t('filter.byTag')}</div>}
                  {tags.map(tag => (
                    <div key={tag.id} className={css.filterTagRow}>
                      <button
                        type="button"
                        className={css.filterRow}
                        onClick={() => { actions.setQuery(tagQuery(tag.id)); setFilterOpen(false) }}
                      >
                        <span className={css.filterCheck}>{query.trim() === tagQuery(tag.id) ? '✓' : ''}</span>
                        <span className={css.filterLabel}>{tag.name}</span>
                        <span className={css.filterCount}>{tagCounts[tag.id] ?? 0}</span>
                      </button>
                      {/* The vocabulary is the reader's own; a tag that can only
                          be created is a one-way door. Deleting is quiet (the
                          × sits at low contrast) but always visible: a control
                          that appears only on hover is invisible on touch. */}
                      <button
                        type="button"
                        className={css.filterTagDelete}
                        title={t('filter.deleteTag')}
                        aria-label={`${t('filter.deleteTag')}: ${tag.name}`}
                        onClick={() => { void removeTag(tag.id) }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </span>
        <span className={css.toolWrap}>
          <button
            type="button"
            className={`${css.tool} ${sort === 'newest' ? '' : css.toolOn}`}
            title={t('sort.title')}
            onClick={() => { setFilterOpen(false); setSortOpen(open => !open) }}
          >
            {glyph('sort', 15)}
          </button>
          {sortOpen && (
            <div className={css.menu}>
              {(['newest', 'oldest', 'source'] as const).map(option => (
                <button
                  key={option}
                  type="button"
                  onClick={() => { actions.setSort(option); setSortOpen(false) }}
                >
                  <span>{t(`sort.${option}`)}</span>
                  {sort === option && <span className={css.check}>✓</span>}
                </button>
              ))}
            </div>
          )}
        </span>
        {/* The wall's own translation switch. Separate from the detail view's on
            purpose: they are two different reading surfaces, each remembers its
            own state, and both share the one translation memory. Hidden when the
            browser has no Translator API or not a single cached pair. */}
        {wallTranslateOffered && (
          <span className={css.translateWrap}>
            <button
              type="button"
              className={`${css.tool}${wallOn ? ` ${css.toolOn}` : ''}`}
              title={t('action.translate')}
              aria-pressed={wallOn}
              onClick={() => {
                setSortOpen(false)
                setFilterOpen(false)
                if (wallOn) { setWallOn(false); return }
                wallCancelRef.current = { cancelled: false }
                setWallOn(true)
                // Cards already on screen are queued by the observer effect; a
                // wall that never scrolls still gets translated in one pass.
                void runWallPass()
              }}
            >
              <IconGlobeOutlineMedium size={15} />
            </button>
            {wallOn && (
              <>
                <button
                  type="button"
                  className={css.translateCaret}
                  aria-expanded={wallMenu}
                  title={t('translate.view')}
                  onClick={() => { setWallMenu(open => !open) }}
                >
                  <IconChevronDownOutlineMedium size={10} />
                </button>
                {wallMenu && (
                  <div className={css.translateMenu} role="menu">
                    <div className={css.translateMenuHead}>{t('translate.local')}</div>
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={!wallBoth}
                      className={css.translateMenuItem}
                      onClick={() => { setWallMenu(false); setWallBoth(false) }}
                    >
                      <span className={css.translateCheck}>{!wallBoth ? '✓' : ''}</span>
                      <span className={css.translateMenuLabel}>{t('translate.onlyTranslation')}</span>
                    </button>
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={wallBoth}
                      className={css.translateMenuItem}
                      onClick={() => { setWallMenu(false); setWallBoth(true) }}
                    >
                      <span className={css.translateCheck}>{wallBoth ? '✓' : ''}</span>
                      <span className={css.translateMenuLabel}>{t('translate.bilingual')}</span>
                    </button>
                  </div>
                )}
              </>
            )}
          </span>
        )}
      {/* The history entry, beside the settings one: both lead to a PAGE rather
          than acting on the wall, and both are asked for in the same breath
          ("where was that article I read"). The count is on the title, not in
          the button — a badge here would fight the unread count already in the
          header and would be wrong the moment an entry is opened. */}
      <button
        type="button"
        className={css.tool}
        title={t('action.recent')}
        onClick={() => { actions.closeEntry(); actions.setView('recent') }}
      >
        {/* The official clock, not a hand-rolled stroke: the custom path filled
            10.8/16 of the box where the Icon*OutlineMedium neighbours fill ~12/16,
            so it read a size smaller beside them. */}
        <IconClockOutlineMedium size={15} />
      </button>
      <button
        type="button"
        className={css.tool}
        title={t('action.manage')}
        onClick={() => { actions.closeEntry(); actions.setView('manage') }}
      >
        {/* A host settings glyph, not the hand-rolled filter stroke: the filter
            stroke is already the unread toggle's icon two buttons to the right,
            and two different controls with one glyph is a coin flip. */}
        <IconSettingsOutlineMedium size={15} />
      </button>
      <button
        type="button"
        className={css.tool}
        title={t('action.add')}
        onClick={() => { setAddOpen(true); setVerdict(null) }}
      >
        <IconPlusOutlineMedium size={15} />
      </button>
    </div>
  )

  /** Load the states once the wall knows which entries it is showing. */
  useEffect(() => { void refreshFetchStates() }, [refreshFetchStates, rev])

  /**
   * Keep the states fresh while anything is in flight, and drain stored payloads.
   *
   * The effect depends on the BOOLEAN alone and reaches the callbacks through
   * refs. Depending on the callbacks themselves made this a loop: a poll
   * replaces `fetchStates`, which recreates `sweepRaw` (it closes over them),
   * which re-runs this effect, which polls again — a render cycle that never
   * settles and a test suite that never finishes.
   */
  const inFlight = Object.values(fetchStates).some(state => state.state === 'fetching' || state.state === 'raw')
  const pollRef = useRef<() => void>(() => {})
  pollRef.current = () => {
    void refreshFetchStates()
    void sweepRaw()
  }
  useEffect(() => {
    if (!inFlight) return undefined
    void pollRef.current()
    const timer = setInterval(() => { pollRef.current() }, 2000)
    return () => { clearInterval(timer) }
  }, [inFlight])

  /** The add dialog: overlay + centered card, Esc and overlay-click close. */
  const dialog = addOpen && (
    <div
      className={css.overlay}
      role="presentation"
      onClick={event => { if (event.target === event.currentTarget) setAddOpen(false) }}
    >
      <div
        className={css.dialog}
        role="dialog"
        aria-modal="true"
        aria-label={t('add.title')}
        onKeyDown={event => { if (event.key === 'Escape') setAddOpen(false) }}
      >
        <h2>{t('add.title')}</h2>
        <p>{t('add.help')}</p>
        <input
          autoFocus
          value={draftUrl}
          placeholder={t('add.placeholder')}
          onChange={event => setDraftUrl(event.target.value)}
          onKeyDown={event => { if (event.key === 'Enter') void submit() }}
        />
        {verdict !== null && (
          <div className={css.verdict}>
            <b>
              {t(VERDICT_KEY[verdict.kind], verdict.kind === 'savedLinkNoPreview'
                ? { label: verdict.label ?? '', reason: previewReason(t, verdict.code, verdict.reason ?? '') }
                : verdict.label === undefined ? {} : { label: verdict.label })}
            </b>
            {/* The seam's own words, when the fetch failed. Without them the
                reader has a verdict and no diagnosis. A classified link-only
                verdict already carries its sentence above, so the raw message
                would only repeat it in a second language. */}
            {verdict.reason !== undefined && verdict.kind === 'fetchFailed' && (
              <span className={css.verdictReason}>{verdict.reason}</span>
            )}
            {/* The way out, when the cause has one: a bot wall, a login wall
                and a non-web file all open fine where a human is driving. The
                retryable and the final causes get no button — re-pressing 抓取
                is the retry, and a final answer has no gesture. */}
            {verdict.url !== undefined && verdict.code !== undefined && OPEN_IN_BROWSER_CODES.has(verdict.code) && (
              <>
                {' '}
                <button
                  type="button"
                  className={css.incompleteLink}
                  onClick={() => { openElsewhere(verdict.url as string) }}
                >
                  {t('action.openExternal')}
                </button>
              </>
            )}
          </div>
        )}
        <div className={css.dialogActions}>
          <button type="button" className={css.ghost} onClick={() => setAddOpen(false)}>
            {verdict !== null && (verdict.kind === 'subscribed' || verdict.kind === 'savedLink' || verdict.kind === 'savedLinkNoPreview')
              ? t('action.done')
              : t('action.cancel')}
          </button>
          <button type="button" className={css.submit} onClick={() => { void submit() }}>
            {t('action.submit')}
          </button>
        </div>
      </div>
    </div>
  )

  /* ------------------------------------------------------------- detail view */

  if (view === 'detail' && (openEntry !== undefined || openEntryId !== null)) {
    /**
     * A restore that has not opened its entry yet.
     *
     * The pane knows from its first render WHICH entry it should be showing (the
     * page memory), but the entry itself comes from the host's payloads, which
     * are still being parsed. Falling through to the wall for that moment is the
     * "the article disappeared and then loaded again" flash — the page it is
     * about to be on is the detail view, so it says so.
     */
    if (openEntry === undefined) {
      return (
        <div className={css.root}>
          <div className={css.bar}>
            <button
              type="button"
              className={css.tool}
              title={t('action.back')}
              onClick={() => { actions.setView('list'); actions.closeEntry() }}
            >
              <IconChevronLeftOutlineMedium size={14} />
            </button>
            <span className={css.barLabel}>{t('tab.label')}</span>
            <span className={css.spacer} />
          </div>
          <div className={css.detailBody}>
            <p className={css.incomplete}>{t('state.loading')}</p>
          </div>
        </div>
      )
    }

    const source = presentation.get(openEntry.sourceId)
    /** The host's own row for this entry's source: the failure code lives here. */
    const sourceSummary = sources.find(item => item.id === openEntry.sourceId)
    const when = relativeWhen(openEntry.publishedAt, new Date())
    const date = absoluteDate(openEntry.publishedAt)
    const alsoFrom = allEntries
      .filter(entry => entry.sourceId === openEntry.sourceId && entry.id !== openEntry.id)
      .slice(0, 3)
    /** How far the pack download, or the translation, has come. */
    const statusPercent = translatePhase === 'pack'
      ? Math.round((packProgress ?? 0) * 100)
      : translateProgress !== null && translateProgress.total > 0
        ? Math.round((translateProgress.done / translateProgress.total) * 100)
        : 0
    return (
      <div className={css.root}>
        <div className={css.bar}>
          <button
            type="button"
            className={css.tool}
            title={t('action.back')}
            onClick={() => { actions.setView('list'); actions.closeEntry() }}
          >
            <IconChevronLeftOutlineMedium size={14} />
          </button>
          <span className={css.barLabel}>{openEntry.title}</span>
          <span className={css.spacer} />
          {/* The globe is a switch, not a verb: lit means this body is showing a
              translation, dark means it is showing the original — and the caret
              holds the view (translation only / side by side / original).
              Everything is hidden when the browser has no Translator API, the
              pair is unavailable, or the body is already Chinese: an offer that
              cannot work is worse than no offer. */}
          {translationOffered && (
            <span className={css.translateWrap}>
              <button
                type="button"
                className={`${css.tool}${translatePhase === 'pack' || translatePhase === 'working' ? ` ${css.toolSpinning}` : ''}${translatePhase === 'ready' && translateView !== 'orig' ? ` ${css.toolOn}` : ''}`}
                title={t('action.translate')}
                aria-pressed={translatePhase === 'ready' && translateView !== 'orig'}
                onClick={toggleGlobe}
              >
                <IconGlobeOutlineMedium size={15} />
              </button>
              <button
                type="button"
                className={css.translateCaret}
                aria-expanded={translateMenu}
                title={t('translate.view')}
                onClick={() => { setTranslateMenu(open => !open) }}
              >
                <IconChevronDownOutlineMedium size={10} />
              </button>
              {translateMenu && (
                <div className={css.translateMenu} role="menu">
                  <div className={css.translateMenuHead}>{t('translate.local')}</div>
                  {TRANSLATION_VIEWS.map(item => (
                    <button
                      key={item.view}
                      type="button"
                      role="menuitemradio"
                      aria-checked={translateView === item.view}
                      className={css.translateMenuItem}
                      onClick={() => { pickView(item.view) }}
                    >
                      <span className={css.translateCheck}>{translateView === item.view ? '✓' : ''}</span>
                      <span className={css.translateMenuLabel}>{t(item.key)}</span>
                    </button>
                  ))}
                  {(translatePhase === 'ready' || translatePhase === 'failed') && (
                    <button
                      type="button"
                      role="menuitem"
                      className={css.translateMenuItem}
                      onClick={() => {
                        setTranslateMenu(false)
                        if (builtRef.current !== null) restoreArticle(builtRef.current.root)
                        builtRef.current = null
                        void startTranslation(lastViewRef.current)
                      }}
                    >
                      <span className={css.translateCheck} />
                      <span className={css.translateMenuLabel}>{t('translate.retry')}</span>
                    </button>
                  )}
                </div>
              )}
            </span>
          )}
          <button type="button" className={css.tool} title={t('action.copyLink')} onClick={() => { void copyLink() }}>
            <IconCopyOutlineMedium size={15} />
          </button>
          <button
            type="button"
            className={css.tool}
            title={t('action.openExternal')}
            onClick={() => { if (openEntry.link !== undefined) props.openExternal(openEntry.link) }}
          >
            <IconRightUpOutlineMedium size={15} />
          </button>
          {/* A saved link is one item, so deleting it HERE is honest. A feed
              entry gets no such button: the next refresh would bring it back,
              and a delete that undoes itself is a lie. */}
          {sourceSummary?.kind === 'link' && (
            <button
              type="button"
              className={`${css.tool} ${css.toolDanger}`}
              title={t('detail.removeLink')}
              onClick={() => { void removeLink(openEntry.sourceId) }}
            >
              <IconTrashOutlineMedium size={15} />
            </button>
          )}
        </div>

        <div className={css.detailBody} ref={detailRef} onScroll={onDetailScroll}>
          <div className={css.kicker}>
            <span className={css.tile} style={{ background: source?.hue }}>{source?.tile}</span>
            <span>{source?.label}</span>
            <span className={css.sep}>·</span>
            <span>{date ?? t(when.key, when.count === undefined ? {} : { count: when.count })}</span>
            {openEntry.author !== undefined && (<><span className={css.sep}>·</span><span>{openEntry.author}</span></>)}
            {/* A resolved link keeps its origin visible: the card landed on the
                paper's arXiv version, but the URL the reader pasted (a DOI) is
                the provenance, and it stays one click away. */}
            {sourceSummary?.resolvedFrom !== undefined && (
              <>
                <span className={css.sep}>·</span>
                <button
                  type="button"
                  className={css.incompleteLink}
                  title={t('detail.resolvedFrom', { url: sourceSummary.resolvedFrom })}
                  onClick={() => { props.openExternal(sourceSummary.resolvedFrom as string) }}
                >
                  {sourceSummary.resolvedFrom.replace(/^https?:\/\//, '')}
                </button>
              </>
            )}
          </div>
          <h1 className={css.detailTitle}>{openEntry.title}</h1>
          {/* The entry's tags, and next to them the one gesture that belongs to
              the ENTRY rather than to its source: fetch the article again.
              Opening an article that was already fetched no longer costs a
              request (the cached body is shown as it stands), so this is how a
              reader asks for a fresh copy — after the site changed, or when the
              extraction came back thin the first time. */}
          {((openEntry.tags ?? []).length > 0 || openEntry.link !== undefined) && (
            <div className={css.tagRow}>
              {(openEntry.tags ?? []).map(tag => <span key={tag} className={css.tag}>{tag}</span>)}
              {openEntry.link !== undefined && (
                <button
                  type="button"
                  className={css.refetch}
                  // A rendered entry's「重新抓取」re-renders through capture —
                  // captureBusy is that in-flight state, or the button looks
                  // dead for minutes.
                  disabled={bodyFetching || captureBusy}
                  title={t('detail.refetchTitle')}
                  onClick={() => { void refetchEntry(openEntry) }}
                >
                  {glyph('fetch', 11)}
                  <span>{bodyFetching || captureBusy ? t('detail.refetching') : t('detail.refetch')}</span>
                </button>
              )}
            </div>
          )}
          <div className={css.rule} />
          {/* One line while the browser prepares or translates, with the cancel
              it needs; it disappears the moment the text is fully translated. */}
          {(translatePhase === 'pack' || translatePhase === 'working') && (
            <div className={css.translateStatus}>
              <span>
                {translatePhase === 'pack'
                  ? t('translate.preparing')
                  : <><b>{t('translate.working')}</b>{translateProgress !== null ? ` ${translateProgress.done}/${translateProgress.total}` : ''}</>}
              </span>
              <span className={css.translateBar}>
                <i style={{ width: `${String(statusPercent)}%` }} />
              </span>
              <button type="button" className={css.incompleteLink} onClick={cancelTranslation}>
                {t('action.cancel')}
              </button>
            </div>
          )}
          {translatePhase === 'failed' && translateError !== null && (
            <div className={css.translateStatus} data-failed="true">
              {translateError}
              <button type="button" className={css.incompleteLink} onClick={cancelTranslation}>
                {t('action.done')}
              </button>
            </div>
          )}
          {/* The click gesture has no other affordance, so it is taught once. */}
          {translatePhase === 'ready' && !tipDismissed && (
            <div className={css.translateTip}>
              {t('translate.tip')}
              <button
                type="button"
                title={t('translate.dismiss')}
                aria-label={t('translate.dismiss')}
                onClick={() => { setTipDismissed(true) }}
              >
                ×
              </button>
            </div>
          )}
          {bodyFetching && (
            <p className={css.incomplete}>{t('detail.fetchingBody')}</p>
          )}
          {/* The page draws these figures at runtime and a fetch runs no
              scripts, so the body has the text and the captions but no
              pictures. Saying so is what keeps "the plugin lost my images"
              from being the reader's only conclusion. */}
          {scriptFigures > 0 && (
            <p className={css.incomplete}>
              {t('detail.scriptFigures', { count: scriptFigures })}{' '}
              {/* The explicit per-entry gesture auto-escalates into the
                  rendered fetch (maybeAutoRender), so this slot is the PROGRESS
                  line while it runs and the manual retry when it failed — a
                  control that cannot work (no capture Remote) never renders. */}
              {captureRemote !== undefined && openEntry.link !== undefined && (
                captureBusy
                  ? <span>{t('detail.rendering')}</span>
                  : (
                    <button
                      type="button"
                      className={css.incompleteLink}
                      onClick={() => { void captureBody(openEntry.id, openEntry.link as string) }}
                    >
                      {t('detail.renderFetch')}
                    </button>
                  )
              )}{' '}
              {openEntry.link !== undefined && (
                <button
                  type="button"
                  className={css.incompleteLink}
                  onClick={() => { openElsewhere(openEntry.link as string) }}
                >
                  {browserTab ? t('action.openExternal') : t('detail.readOriginal')}
                </button>
              )}
            </p>
          )}
          {articleError !== null && (
            <p className={css.incomplete}>
              {/* Say what ACTUALLY happened. The seam's reasons are distinguishable
                  and the reader needs the distinction: a bot challenge is final,
                  a dead network is not, and an unreadable extraction is a third
                  thing again. The old copy claimed "exceeds the fetch cap" for
                  all three, which was measured wrong on the acceptance instance
                  (the recorded reason there was `web fetch failed: TypeError:
                  fetch failed`). When the host classified the failure, its CODE
                  picks the sentence — the raw message stays for diagnosis only. */}
              {previewReason(t, sourceSummary?.failure?.code, articleError)}
              {openEntry.link !== undefined && (
                <>
                  {' '}
                  <button
                    type="button"
                    className={css.incompleteLink}
                    onClick={() => { openElsewhere(openEntry.link as string) }}
                  >
                    {t('detail.readOriginal')}
                  </button>
                </>
              )}
            </p>
          )}
          {/* The feed published only a summary: the paragraph below IS that
              summary, and the full text is being fetched (the line above says
              so while it runs). Once the article arrives this notice goes
              away by itself, because the body is no longer the feed's. */}
          {openEntry.summaryOnly === true && articleHtml !== null && articleHtml === openEntry.contentHtml && (
            <p className={css.incomplete}>{t('detail.summaryOnly')}</p>
          )}
          {articleHtml !== null && articleHtml.length > 0 && (
            <div
              // The markup is the output of this package's own whitelist
              // normalizer (`extract-article`): scripts, styles, forms, iframes
              // and event attributes are already gone, and every URL that
              // survives has been scheme-checked. Re-sanitizing here would mean
              // a second implementation of the same policy.
              //
              // `translate.ts` decorates THIS subtree in place when the reader
              // asks for a translation (text nodes only), so the click handler
              // is delegation: the sentences it creates are not React's.
              ref={articleRef}
              onClick={onArticleClick}
              onMouseOver={onArticleHover}
              onMouseOut={onArticleHover}
              className={`${css.article} ${isCjk(articleHtml) ? css.articleZh : css.articleEn}`}
              dangerouslySetInnerHTML={{ __html: articleHtml }}
            />
          )}
          {/* There is no "fetch the text" button: full text is filled in
              automatically after each refresh (see `backfill` below), and until
              it arrives the reader sees the best text the feed itself carried.
              A publisher that refuses us is explained, not offered a retry. */}
          {/* A feed may publish the full text for some entries and only a
              summary for others (measured: the OpenAI alignment feed is 155 to
              62,044 characters entry by entry). Nothing was truncated there, so
              the cap note would be a lie — this says what actually happened. */}
          {/* One line, at the end, only when the body is known to be partial. */}
          {(articleTruncated || openEntry.truncated === true) && (
            <p className={css.incomplete}>
              {t('detail.incomplete')} —{' '}
              <button
                type="button"
                className={css.incompleteLink}
                onClick={() => { if (openEntry.link !== undefined) props.openExternal(openEntry.link) }}
              >
                {t('detail.readOriginal')}
              </button>
            </p>
          )}
          <div className={css.tagEdit}>
            <span className={css.tagEditLabel}>{t('tag.title')}</span>
            {tags.filter(tag => (entryTagIds[openEntry.id] ?? []).includes(tag.id)).map(tag => (
              <span key={tag.id} className={css.tagChip}>
                {tag.name}
                <button
                  type="button"
                  className={css.tagChipRemove}
                  title={t('action.remove')}
                  onClick={() => { void toggleTag(openEntry.id, tag.id, false) }}
                >
                  ×
                </button>
              </span>
            ))}
            {tagInputOpen
              ? (
                <div className={css.tagEditField}>
                  <input
                    autoFocus
                    className={css.tagInput}
                    value={tagDraft}
                    placeholder={t('tag.placeholder')}
                    onChange={event => setTagDraft(event.target.value)}
                    // A suggestion's mousedown is suppressed, so this fires only
                    // when focus really left the editor.
                    onBlur={() => { setTagInputOpen(false); setTagDraft('') }}
                    onKeyDown={event => {
                      if (event.key === 'Enter' && tagDraft.trim().length > 0) {
                        const existing = tags.find(tag => tag.name.toLowerCase() === tagDraft.trim().toLowerCase())
                        if (existing === undefined) void createAndTag(openEntry.id, tagDraft.trim())
                        else { setTagDraft(''); setTagInputOpen(false); void toggleTag(openEntry.id, existing.id, true) }
                      }
                      if (event.key === 'Escape') { setTagInputOpen(false); setTagDraft('') }
                    }}
                  />
                  {tagDraft.trim().length > 0 && (
                    <div className={css.tagSuggest}>
                      <TagSuggestions
                        t={t}
                        tags={tags}
                        applied={entryTagIds[openEntry.id] ?? []}
                        draft={tagDraft}
                        onToggle={tag => {
                          const on = (entryTagIds[openEntry.id] ?? []).includes(tag.id)
                          void toggleTag(openEntry.id, tag.id, !on)
                        }}
                        onCreate={name => { void createAndTag(openEntry.id, name) }}
                      />
                    </div>
                  )}
                </div>
              )
              : (
                <button type="button" className={css.tagAdd} onClick={() => setTagInputOpen(true)}>
                  <IconPlusOutlineMedium size={12} />
                </button>
              )}
          </div>
          {alsoFrom.length > 0 && (
            <div className={css.alsoFrom}>
              <div className={css.alsoFromLabel}>{t('detail.alsoFrom')}</div>
              {alsoFrom.map(entry => (
                <button
                  key={entry.id}
                  type="button"
                  className={css.alsoFromRow}
                  onClick={() => {
                    void open({
                      entry,
                      sourceId: entry.sourceId,
                      sourceLabel: source?.label ?? '',
                      sourceTile: source?.tile ?? '·',
                      sourceHue: source?.hue ?? '',
                      sourceAddedAt: source?.addedAt ?? '',
                      sourceKind: source?.kind ?? 'rss',
                      unread: read[entry.id] !== true,
                    })
                  }}
                >
                  <span className={css.alsoFromTitle}>{entry.title}</span>
                  <span className={css.when}>
                    {whenLabel(t, entry.publishedAt)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className={css.composer}>
          <div className={css.composerLabel}>{t('detail.composerLabel')}</div>
          <div className={`${css.composerText} ${draft.length === 0 ? css.composerEmpty : ''}`}>
            {draft.length === 0 ? t('detail.composerEmpty') : draft}
          </div>
        </div>
        <div className={css.foot}>
          <button type="button" className={css.incompleteLink} onClick={() => quote()}>
            {t('action.quote')}
          </button>
          {sideChatAvailable && openEntry.link !== undefined && (
            <button
              type="button"
              className={css.incompleteLink}
              onClick={() => {
                void props.quoteToSideChat({
                  contextKey: sessionId,
                  label: openEntry.title,
                  text: formatReaderRef('', provenanceOf(openEntry, { label: source?.label ?? '' })),
                })
              }}
            >
              {t('quote.toSideChat')}
            </button>
          )}
        </div>
      </div>
    )
  }

  /* ------------------------------------------------------ subscriptions page */

  if (view === 'recent') {
    return (
      <div className={css.root}>
        <div className={css.bar}>
          <button
            type="button"
            className={css.tool}
            title={t('action.back')}
            onClick={() => actions.setView('list')}
          >
            <IconChevronLeftOutlineMedium size={14} />
          </button>
          <span className={css.barLabel}>{t('recent.title')}</span>
          <span className={css.spacer} />
          {recent.length > 0 && (
            <button
              type="button"
              className={css.tool}
              title={t('recent.clearTitle')}
              onClick={() => { void clearRecent() }}
            >
              <IconTrashOutlineMedium size={15} />
            </button>
          )}
        </div>
        <div className={css.paneBody}>
          {recent.length === 0
            ? <p className={css.help}>{t('recent.empty')}</p>
            : (
              <>
                <p className={css.help}>{t('recent.help')}</p>
                <div className={css.recentList}>
                  {recent.map(item => {
                    // The wall's own parse wins when the feed still publishes the
                    // entry (it carries the real summary and body); the stored
                    // record is the fallback, which is why this list outlives a
                    // feed's rolling window at all.
                    const row = rowFor(entryById(item.entryId) ?? entryFromRecent(item), presentation, read)
                    const when = relativeWhen(item.readAt, new Date())
                    const label = presentation.get(item.sourceId)?.label ?? item.sourceId
                    return (
                      <button
                        key={item.entryId}
                        type="button"
                        className={css.recentRow}
                        disabled={row === undefined}
                        title={row === undefined ? t('recent.sourceGone') : item.title}
                        onClick={() => { if (row !== undefined) void open(row) }}
                      >
                        <span className={css.recentTitle}>{item.title.length > 0 ? item.title : item.url ?? item.entryId}</span>
                        <span className={css.recentMeta}>
                          <span className={css.recentSource}>{label}</span>
                          <span className={css.sep}>·</span>
                          <span>{t(when.key, when.count === undefined ? {} : { count: when.count })}</span>
                        </span>
                      </button>
                    )
                  })}
                </div>
              </>
            )}
        </div>
      </div>
    )
  }

  if (view === 'manage') {
    return (
      <div className={css.root}>
        <div className={css.bar}>
          <button
            type="button"
            className={css.tool}
            title={t('action.back')}
            onClick={() => actions.setView('list')}
          >
            <IconChevronLeftOutlineMedium size={14} />
          </button>
          <span className={css.barLabel}>{t('sources.title')}</span>
          <span className={css.spacer} />
          <button type="button" className={css.tool} title={t('action.add')} onClick={() => setAddOpen(true)}>
            <IconPlusOutlineMedium size={15} />
          </button>
        </div>
        <div className={css.paneBody}>
          <p className={css.help}>{t('sources.help')}</p>
          {/* One compact settings row instead of two full-width blocks: two
              controls and their explanations should not own three lines of the
              page each. The long help lives in the row's `title`, which is
              where a reader looks for it the second time. */}
          <div className={css.settingsRow}>
            <label className={css.setting} htmlFor="reader-refresh-time" title={t('sources.timeHelp')}>
              <span className={css.settingLabel}>{t('sources.time')}</span>
              <input
                id="reader-refresh-time"
                className={css.settingControl}
                type="time"
                value={timeOfDay}
                onChange={event => { void setRefreshTime(event.target.value) }}
              />
            </label>
            <label className={css.setting} htmlFor="reader-cache-ttl" title={t('sources.cacheHelp')}>
              <span className={css.settingLabel}>{t('sources.cache')}</span>
              <select
                id="reader-cache-ttl"
                className={css.settingControl}
                value={String(cacheTtlHours)}
                onChange={event => {
                  const hours = Number(event.target.value)
                  void props.setCachePolicy(hours).then(result => { if (result.ok) actions.setCacheTtl(hours) })
                }}
              >
                {[12, 24, 168, 0].map(hours => (
                  <option key={hours} value={hours}>{t(hours === 0 ? 'sources.cacheForever' : 'sources.cacheHours', { count: hours }) }</option>
                ))}
              </select>
            </label>
          </div>
          {/* The storage readout: what the two caches currently hold, plus the
              one budget the reader controls. The numbers are aggregated on the
              host — the tables never cross the wire for a settings page. The
              clear button is two-step in place (the pane's confirm idiom is a
              second click, not a modal). */}
          <div className={css.settingsRow}>
            <span className={css.setting} title={t('sources.storageBodiesHelp')}>
              <span className={css.settingLabel}>{t('sources.storageBodies')}</span>
              <span className={css.settingReadout}>
                {storageStats === null
                  ? '—'
                  : t('sources.storageBodiesUsage', {
                    entries: String(storageStats.bodies.entries),
                    size: formatStorageSize(storageStats.bodies.chars),
                  })}
              </span>
            </span>
            <span className={css.setting} title={t('sources.storageTranslationsHelp')}>
              <span className={css.settingLabel}>{t('sources.storageTranslations')}</span>
              <span className={css.settingReadout}>
                {storageStats === null
                  ? '—'
                  : t('sources.storageTranslationsUsage', {
                    maps: String(storageStats.translations.entries),
                    sentences: String(storageStats.translations.memoryEntries),
                    size: formatStorageSize(storageStats.translations.chars + storageStats.translations.memoryChars),
                  })}
              </span>
            </span>
            <label className={css.setting} htmlFor="reader-translation-budget" title={t('sources.translationBudgetHelp')}>
              <span className={css.settingLabel}>{t('sources.translationBudget')}</span>
              <input
                id="reader-translation-budget"
                className={css.settingControl}
                type="number"
                min={1}
                step={1}
                value={budgetDraft}
                onChange={event => { setBudgetDraft(event.target.value) }}
                onBlur={commitBudget}
                onKeyDown={event => { if (event.key === 'Enter') commitBudget() }}
              />
              <span className={css.settingLabel}>MB</span>
            </label>
            <button
              type="button"
              className={css.chip}
              aria-pressed={clearArmed}
              title={t('sources.storageTranslationsHelp')}
              onClick={clearTranslations}
            >
              {t(clearArmed ? 'sources.clearTranslationsConfirm' : 'sources.clearTranslations')}
            </button>
          </div>
          {/* The list grows one entry per pasted URL plus one per feed, and the
              two are different things: narrowing by kind and ordering by
              arrival is how "delete that link I added yesterday" is answered
              without reading the whole list. Grouped and labelled inline, so
              the two rows read as two questions instead of eight loose chips. */}
          {sources.length > 0 && (
            <div className={css.manageTools}>
              <span className={css.chipGroupLabel}>{t('filter.byKind')}</span>
              <div className={css.chipRow} role="group" aria-label={t('sources.kindFilter')}>
                {(['all', ...READER_SOURCE_KINDS] as const).map(kind => (
                  <button
                    key={kind}
                    type="button"
                    className={`${css.chip}${manageKind === kind ? ` ${css.chipOn}` : ''}`}
                    aria-pressed={manageKind === kind}
                    onClick={() => { setManageKind(kind) }}
                  >
                    {kind === 'all'
                      ? t('filter.all')
                      : t(kind === 'link' ? 'sources.kindLink' : 'sources.kindRss')}
                    <span className={css.chipCount}>
                      {kind === 'all' ? sources.length : sources.filter(source => source.kind === kind).length}
                    </span>
                  </button>
                ))}
              </div>
              <span className={css.chipGroupLabel}>{t('sort.title')}</span>
              <div className={css.chipRow} role="group" aria-label={t('sort.title')}>
                {(['added', 'name', 'fetched'] as const).map(option => (
                  <button
                    key={option}
                    type="button"
                    className={`${css.chip}${manageSort === option ? ` ${css.chipOn}` : ''}`}
                    aria-pressed={manageSort === option}
                    onClick={() => { setManageSort(option) }}
                  >
                    {t(option === 'added' ? 'sources.sortAdded' : option === 'name' ? 'sources.sortName' : 'sources.sortFetched')}
                  </button>
                ))}
              </div>
            </div>
          )}
          {sources.length === 0
            ? <div className={css.state}>{t('sources.empty')}</div>
            : manageSources.length === 0
              ? <div className={css.state}>{t('sources.noMatch')}</div>
              : (
              <div className={css.sourceList}>
                {manageSources.map(source => {
                  const group = parsed[source.id]
                  const failed = source.status === 'error'
                  const when = relativeWhen(source.fetchedAt, new Date())
                  return (
                    <div key={source.id} className={css.sourceRow}>
                      <span className={css.tile} style={{ background: hueForSource(source.label) }}>
                        {tileForSource(source.label)}
                      </span>
                      <span className={css.sourceInfo}>
                        <input
                          className={css.sourceNameInput}
                          defaultValue={source.label}
                          aria-label={t('sources.name')}
                          placeholder={t('sources.name')}
                          onBlur={event => {
                            if (event.target.value !== source.label) void saveSource(source.id, source.url, event.target.value)
                          }}
                        />
                        <input
                          className={css.sourceUrlInput}
                          defaultValue={source.url}
                          aria-label={t('sources.url')}
                          placeholder={t('sources.url')}
                          onBlur={event => {
                            if (event.target.value !== source.url) void saveSource(source.id, event.target.value, source.label)
                          }}
                        />
                        <span className={css.sourceMeta}>
                          {t(source.kind === 'rss' ? 'sources.kindRss' : 'sources.kindLink')}
                          {' · '}
                          {source.kind === 'rss' ? t('sources.items', { count: group?.entries.length ?? 0 }) : t('tab.subtitle')}
                          {' · '}
                          {source.fetchedAt === undefined
                            ? t('sources.never')
                            : t('foot.refreshedAt', { when: t(when.key, when.count === undefined ? {} : { count: when.count }) })}
                          {' · '}
                          {source.enabled ? t('sources.enabled') : t('sources.disabled')}
                          {failed && <> {' · '}<span className={css.sourceFailed}>{t('sources.failed')}</span></>}
                        </span>
                        {failed && source.error !== undefined && (
                          // The classified reason, not the seam's raw sentence:
                          // this line is read by the person deciding whether to
                          // refresh, delete, or open the page themselves.
                          <span className={css.sourceError}>
                            {previewReason(t, source.failure?.code, source.error)}
                          </span>
                        )}
                      </span>
                      <button
                        type="button"
                        className={css.rowAction}
                        title={t('action.refreshOne')}
                        onClick={() => { void refreshOne(source.id) }}
                      >
                        <IconRefreshOutlineMedium size={14} />
                      </button>
                      <button
                        type="button"
                        className={css.rowAction}
                        onClick={() => { void toggleSource(source.id, !source.enabled) }}
                      >
                        {source.enabled ? t('action.pause') : t('action.resume')}
                      </button>
                      <button
                        type="button"
                        className={css.rowActionDanger}
                        onClick={() => { void removeSource(source.id) }}
                      >
                        {t('action.remove')}
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
        </div>
        {dialog}
      </div>
    )
  }

  /* ------------------------------------------------------------------- wall */

  return (
    <div className={css.root}>
      {header(false)}

      {/* The field owns its row and its full width. The wall's other controls
          live in the pane's header (the row with refresh), because a search
          field squeezed between three buttons is a field the reader cannot see
          what they typed in on a narrow sidebar. */}
      <div className={css.tools}>
        <div className={css.search}>
          {glyph('search', 12)}
          <input
            value={query}
            placeholder={t('search.placeholder')}
            onChange={event => actions.setQuery(event.target.value)}
          />
          {/* A field the reader typed into needs a way out that is not
              select-all-then-delete: the × clears the whole narrowing, filter
              values included (`#sourceId` / `@tagId` are just queries). */}
          {query.length > 0 && (
            <button
              type="button"
              className={css.searchClear}
              title={t('action.clearSearch')}
              aria-label={t('action.clearSearch')}
              onClick={() => { actions.setQuery('') }}
            >
              {glyph('close', 15)}
            </button>
          )}
        </div>
        {/* Both icon tools sit to the RIGHT of the field, each in its own fixed
            26px box: the search field is the only thing that gives width back on
            a narrow sidebar, so neither tool can squeeze the other out. Each
            popover hangs inside its own button's wrapper, which is what anchors
            it under the button that opened it — the old panes were positioned at
            a magic `top: 62px` on the pane, a value shorter than the toolbar
            itself, so opening the filter panel covered the sort button. */}
      </div>

      {wallProgress !== null && (
        <div className={css.translateStatus}>
          <span><b>{t('translate.working')}</b>{` ${wallProgress.done}/${wallProgress.total}`}</span>
          <span className={css.translateBar}>
            <i style={{ width: `${wallProgress.total > 0 ? Math.round((wallProgress.done / wallProgress.total) * 100) : 0}%` }} />
          </span>
          <button
            type="button"
            className={css.incompleteLink}
            onClick={() => {
              if (wallCancelRef.current !== null) wallCancelRef.current.cancelled = true
              wallPendingRef.current.clear()
              setWallProgress(null)
            }}
          >
            {t('action.cancel')}
          </button>
        </div>
      )}

      <div className={css.scroll} ref={wallRef} onScroll={onWallScroll}>
        {loading && <div className={css.state}>{t('state.loading')}</div>}
        {!loading && error !== null && <div className={css.state}><b>{t('state.error')}</b>{error}</div>}
        {!loading && error === null && sources.length === 0 && (
          // The empty state is the members tab's trailing dashed card, alone:
          // adding is the one thing to do here, so the card IS the action.
          <button
            type="button"
            className={css.emptyCard}
            onClick={() => { setAddOpen(true); setVerdict(null) }}
          >
            <span className={css.emptyTitle}>{t('state.emptyTitle')}</span>
            <span className={css.emptyBody}>{t('state.emptyBody')}</span>
          </button>
        )}
        {!loading && sources.length > 0 && brokenSources.length > 0 && (
          // "Why is this list short?" answered where the reader is looking,
          // once per affected source, with the way to the full text.
          <div className={css.notice}>
            {brokenSources.map(source => (
              <div key={source.id} className={css.noticeRow}>
                <span className={css.noticeText}>
                  {t('state.incomplete')} · {source.label}
                  {parsed[source.id]?.incomplete === true && <> — {t('state.incompleteReason')}</>}
                </span>
                <button
                  type="button"
                  className={css.noticeLink}
                  onClick={() => props.openExternal(source.url)}
                >
                  {t('detail.readOriginal')}
                </button>
              </div>
            ))}
          </div>
        )}
        {!loading && sources.length > 0 && displayRows.length === 0 && (
          <div className={css.state}>
            {/* An empty query is not a failed search. Saying "nothing matches
                "" " told the reader nothing while a whole feed was unreadable. */}
            {query.trim().length === 0 ? t('state.emptyWall') : t('state.noMatch', { query })}
          </div>
        )}
        {!loading && displayRows.length > 0 && (
          <div className={css.list}>
            {displayRows.map(row => {
              // The card's text box is FIXED (two clamped lines per field, see
              // the CSS), because Chinese and English wrap differently: swapping
              // languages must not resize the card or shift the grid.
              const card = cardTranslations[row.entry.id]
              const hovered = hoverField?.id === row.entry.id ? hoverField.field : null
              const peekTitle = wallOn && !wallBoth && hovered === 'title' && card?.title !== undefined
              const summary = row.entry.summary
              const peekSummary = wallOn && !wallBoth && hovered === 'summary' && card?.summary !== undefined
              const titleText = wallOn && !peekTitle && card?.title !== undefined ? card.title : row.entry.title
              const summaryText = wallOn && !peekSummary && card?.summary !== undefined ? card.summary : summary
              const originalTitle = wallOn && wallBoth && card?.title !== undefined ? row.entry.title : null
              const originalSummary = wallOn && wallBoth && card?.summary !== undefined ? summary : null
              // A saved link with no body is a link and nothing more: the card
              // says so, because the alternative — a card that opens onto an
              // empty page — reads as a broken plugin rather than a site that
              // refuses us. Feed entries are excluded: their missing body is
              // the backfill's job and it is already marked when it arrives.
              const rowSource = sources.find(item => item.id === row.sourceId)
              const linkOnly = row.sourceKind === 'link' && row.entry.contentHtml === undefined
              const linkOnlyReason = previewReason(
                t,
                rowSource?.failure?.code,
                parsed[row.sourceId]?.error ?? t('detail.extractFailed'),
              )
              // The duplicates this card stands for, when the wall's dedupe
              // folded them behind it (a badge, never a deletion).
              const dupes = dupesBy.get(row.entry.id) ?? []
              // Only a field that actually has a translation can be peeked: an
              // untranslated (or Chinese) card keeps its ordinary hover.
              const peekable = (field: 'title' | 'summary'): boolean => wallOn && !wallBoth && card?.[field] !== undefined
              const hoverProps = (field: 'title' | 'summary'): { onMouseEnter?: () => void; onMouseLeave?: () => void } =>
                peekable(field)
                  ? {
                    onMouseEnter: () => { setHoverField({ id: row.entry.id, field }) },
                    onMouseLeave: () => { setHoverField(current => (current?.id === row.entry.id && current.field === field ? null : current)) },
                  }
                  : {}
              return (
              <div
                key={row.entry.id}
                className={css.card}
                data-reader-entry={row.entry.id}
                data-translated={wallOn && card !== undefined ? '1' : undefined}
                // Read entries keep their place (never hidden), but they read a
                // step quieter than unread ones: that hierarchy is what makes a
                // wall of cards scannable, and it is the feed-reader habit.
                data-unread={row.unread || undefined}
                role="button"
                tabIndex={0}
                onClick={() => { if (cardMenu !== null || cardTag !== null) { setCardMenu(null); setCardTag(null); return } void open(row) }}
                onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') void open(row) }}
                onContextMenu={event => {
                  // The host's own row-menu gesture: right-click opens the
                  // entry's actions without a click-through into the article.
                  if (row.entry.link === undefined) return
                  event.preventDefault()
                  setCardMenu({ entryId: row.entry.id, top: event.clientY, left: event.clientX })
                }}
              >
                <span className={css.tileWrap}>
                  <span className={css.tile} style={{ background: row.sourceHue }}>{row.sourceTile}</span>
                  {row.unread && <span className={css.unread} />}
                </span>
                <span className={css.meta}>
                  <span className={css.source}>{row.sourceLabel}</span>
                  <span className={css.sep}>·</span>
                  <span className={css.when}>
                    {whenLabel(t, row.entry.publishedAt)}
                  </span>
                </span>
                <span className={css.title} {...hoverProps('title')}>{titleText}</span>
                {originalTitle !== null && <span className={css.cardOrigTitle}>{originalTitle}</span>}
                {summary !== undefined && <span className={css.summary} {...hoverProps('summary')}>{summaryText}</span>}
                {originalSummary !== null && <span className={css.cardOrigSummary}>{originalSummary}</span>}
                <span className={css.tags}>
                  {(row.entry.tags ?? []).slice(0, 2).map(tag => <span key={tag} className={css.tag}>{tag}</span>)}
                  {row.entry.author !== undefined && <span className={css.author}>{row.entry.author}</span>}
                  {backfilled[row.entry.id] === true && (
                    <span className={css.tagOwned} title={t('detail.filledIn')}>{t('detail.filledInBadge')}</span>
                  )}
                  {linkOnly && (
                    <span className={css.tagLinkOnly} title={linkOnlyReason}>{t('detail.linkOnlyBadge')}</span>
                  )}
                  {dupes.length > 0 && (
                    <span
                      className={css.tagOwned}
                      title={t('dedupe.title', { sources: dupes.map(dupe => dupe.sourceLabel).join('、') })}
                    >
                      {t('dedupe.badge', { count: dupes.length })}
                    </span>
                  )}
                  {(entryTagIds[row.entry.id] ?? []).map(tagId => (
                    <span key={tagId} className={css.tagOwned}>
                      {tags.find(tag => tag.id === tagId)?.name ?? tagId}
                    </span>
                  ))}
                  {/* 抓取, where the reader sees the card: one click stores the
                      article so opening it later is instant. The host writes the
                      payload before it answers, so leaving the page does not
                      cancel it — the state pill is what says so. A FAILED pill
                      opens the reason popover (reason + the cause's action):
                      the reason must be one tap away, but the card stays one
                      line tall — an inline reason line broke the wall's grid. */}
                  {row.entry.link !== undefined && (() => {
                    const fetchState = fetchStateOf(fetchStates, row.entry.id)
                    const state = fetchState.state
                    const labelKey = state === 'none' ? 'fetch.none'
                      : state === 'fetching' ? 'fetch.fetching'
                        : state === 'raw' ? 'fetch.raw'
                          : state === 'ready' ? 'fetch.ready' : 'fetch.failed'
                    const failedReason = fetchState.state === 'failed'
                      ? previewReason(t, fetchState.code, fetchState.message)
                      : undefined
                    const failedCode = fetchState.state === 'failed' ? fetchState.code : undefined
                    const failedOpen = failedCode !== undefined && OPEN_IN_BROWSER_CODES.has(failedCode)
                    // Unclassified and transport failures may retry; the rest is final.
                    const failedFinal = fetchState.state === 'failed' && !failedOpen && failedCode !== undefined && failedCode !== 'unreachable'
                    const title = state === 'ready'
                      ? t('fetch.readyTitle')
                      : fetchState.state === 'failed'
                        ? t(failedOpen ? 'fetch.failedOpenTitle' : failedFinal ? 'fetch.failedFinalTitle' : 'fetch.failedTitle', { reason: failedReason ?? '' })
                        : t('fetch.noneTitle')
                    const failed = fetchState.state === 'failed'
                    const openInfo = (anchor: HTMLElement): void => {
                      const box = anchor.getBoundingClientRect()
                      setPillInfo(current => current?.entryId === row.entry.id ? null : {
                        entryId: row.entry.id,
                        top: box.bottom + 6,
                        left: Math.max(8, Math.min(box.left, window.innerWidth - 256)),
                      })
                    }
                    return (
                      <span
                        className={`${css.fetchPill} ${css[`fetchPill_${state === 'raw' ? 'fetching' : state}`] ?? ''}`}
                        {...(state !== 'ready' ? { role: 'button', tabIndex: 0 } : {})}
                        title={title}
                        onClick={event => {
                          event.stopPropagation()
                          if (state === 'ready') return
                          if (failed) openInfo(event.currentTarget as HTMLElement)
                          else void startFetch(row.entry)
                        }}
                        onKeyDown={event => {
                          if (event.key !== 'Enter' && event.key !== ' ') return
                          event.stopPropagation()
                          if (state === 'ready') return
                          if (failed) openInfo(event.currentTarget as HTMLElement)
                          else void startFetch(row.entry)
                        }}
                      >
                        {glyph(state === 'ready' ? 'check' : state === 'failed' ? 'alert' : 'fetch', 10)}
                        <span>{t(labelKey)}</span>
                      </span>
                    )
                  })()}
                  {/* The reader's own tag affordance, in the row where the
                      entry's tags already live — not buried in the detail view. */}
                  <span
                    className={css.tagOnCard}
                    role="button"
                    tabIndex={0}
                    title={t('action.addTag')}
                    onClick={event => { event.stopPropagation(); setCardMenu(null); openCardTag(row.entry.id) }}
                    onKeyDown={event => { if (event.key === 'Enter') { event.stopPropagation(); openCardTag(row.entry.id) } }}
                  >
                    <IconPlusOutlineMedium size={11} />
                  </span>
                </span>
                <span className={css.chevron}>{glyph('chevron', 13)}</span>
              </div>
              )
            })}
          </div>
        )}
      </div>

      {/* The snapshot's age. A reader deciding whether to press refresh needs
          to know how stale this copy is, and a refresh really does go back to
          the network — every enabled source is re-fetched. */}
      {sources.length > 0 && (() => {
        const when = relativeWhen(lastRefreshAt ?? undefined, new Date())
        return (
          <div className={css.metaBar}>
            {/* What a search matched. Without it a narrowed wall and a wall
                that simply has these entries look identical, which is exactly
                how "the search returned six other posts" gets reported. */}
            {query.trim() !== '' && (
              <>
                <span>{t('state.matches', { count: displayRows.length, query: query.trim() })}</span>
                <span className={css.sep}>·</span>
              </>
            )}
            {hiddenCount > 0 && (
              <>
                <span>{t('foot.deduped', { count: hiddenCount })}</span>
                <span className={css.sep}>·</span>
              </>
            )}
            <span>
              {backfill !== null
                ? t('state.backfilling', { done: backfill.done, total: backfill.total })
                : refreshing
                ? t('foot.refreshing')
                : lastRefreshAt === null
                  ? t('foot.never')
                  : t('foot.refreshedAt', { when: t(when.key, when.count === undefined ? {} : { count: when.count }) })}
            </span>
            {nextRefreshAt !== null && (
              <>
                <span className={css.sep}>·</span>
                <span>{t('foot.scheduled', { time: clockOf(nextRefreshAt) })}</span>
              </>
            )}
          </div>
        )
      })()}
      {cardTag !== null && (
        <div className={css.cardTagPanel} style={{ top: cardTag.top, left: cardTag.left }}>
          <div className={css.tagPanelHead}>
            <span className={css.tagPanelTitle}>{t('tag.title')}</span>
            <span className={css.tagPanelHint}>{t('tag.hint')}</span>
          </div>
          <div className={css.tagPanelList}>
            {tags.length === 0 && <div className={css.tagPanelEmpty}>{t('tag.empty')}</div>}
            <TagSuggestions
              t={t}
              tags={tags}
              applied={entryTagIds[cardTag.entryId] ?? []}
              draft={tagDraft}
              onToggle={tag => {
                const on = (entryTagIds[cardTag.entryId] ?? []).includes(tag.id)
                void toggleTag(cardTag.entryId, tag.id, !on)
              }}
              onCreate={name => { void createAndTag(cardTag.entryId, name) }}
            />
          </div>
          <div className={css.tagPanelField}>
            <IconPlusOutlineMedium size={12} />
            <input
              autoFocus
              className={css.tagInput}
              value={tagDraft}
              placeholder={t('tag.placeholder')}
              onChange={event => { setTagDraft(event.target.value) }}
              onKeyDown={event => {
                if (event.key === 'Escape') { setTagDraft(''); setCardTag(null); return }
                if (event.key !== 'Enter' || tagDraft.trim().length === 0) return
                const name = tagDraft.trim()
                const existing = tags.find(tag => tag.name.toLowerCase() === name.toLowerCase())
                if (existing === undefined) void createAndTag(cardTag.entryId, name)
                else { void toggleTag(cardTag.entryId, existing.id, true); setTagDraft('') }
              }}
            />
          </div>
        </div>
      )}
      {/* The failed pill's popover: the reason and the cause's action float
          over the wall, so a failed card stays exactly one line tall. */}
      {pillInfo !== null && (() => {
        const entry = allEntries.find(item => item.id === pillInfo.entryId)
        const fetchState = fetchStateOf(fetchStates, pillInfo.entryId)
        if (entry === undefined || fetchState.state !== 'failed') return null
        const reason = previewReason(t, fetchState.code, fetchState.message)
        const canOpen = fetchState.code !== undefined && OPEN_IN_BROWSER_CODES.has(fetchState.code) && entry.link !== undefined
        const canRetry = fetchState.code === undefined || fetchState.code === 'unreachable'
        return (
          <div
            className={css.pillPop}
            style={{ top: pillInfo.top, left: pillInfo.left }}
            role="dialog"
            aria-label={t('fetch.failed')}
            onKeyDown={event => { if (event.key === 'Escape') setPillInfo(null) }}
          >
            <p className={css.pillPopReason}>{reason}</p>
            {(canRetry || canOpen) && (
              <div className={css.pillPopActions}>
                {canRetry && (
                  <button
                    type="button"
                    className={css.incompleteLink}
                    onClick={() => { setPillInfo(null); void startFetch(entry) }}
                  >
                    {t('detail.refetch')}
                  </button>
                )}
                {canOpen && (
                  <button
                    type="button"
                    className={css.incompleteLink}
                    onClick={() => { setPillInfo(null); openElsewhere(entry.link as string) }}
                  >
                    {browserTab ? t('action.openExternal') : t('detail.readOriginal')}
                  </button>
                )}
              </div>
            )}
          </div>
        )
      })()}
      {cardMenu !== null && (() => {
        const entry = allEntries.find(item => item.id === cardMenu.entryId)
        if (entry === undefined) return null
        const entrySource = sources.find(item => item.id === entry.sourceId)
        return (
          <div className={css.cardMenu} style={{ top: cardMenu.top, left: cardMenu.left }} role="menu">
            {entry.contentHtml === undefined && entry.link !== undefined && (
              <button
                type="button"
                onClick={() => { setCardMenu(null); fetchThenMaybeRender(entry.id, entry.link as string) }}
              >
                {t('action.fetchBody')}
              </button>
            )}
            <button
              type="button"
              onClick={() => { setCardMenu(null); openCardTag(entry.id) }}
            >
              {t('action.addTag')}
            </button>
            {entry.link !== undefined && (
              <button type="button" onClick={() => { setCardMenu(null); props.openExternal(entry.link as string) }}>
                {t('action.openExternal')}
              </button>
            )}
            {entrySource?.kind === 'link' && (
              <button
                type="button"
                className={css.cardMenuDanger}
                onClick={() => { setCardMenu(null); void removeSource(entry.sourceId) }}
              >
                {t('detail.removeLink')}
              </button>
            )}
          </div>
        )
      })()}
      {dialog}
    </div>
  )
}
