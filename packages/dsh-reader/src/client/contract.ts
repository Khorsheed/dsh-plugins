/**
 * Compile-time contract between the reader's browser half and its host half.
 *
 * Nothing here executes: this module holds the shapes only, so a change in the
 * Remote surface or in the injected business face breaks compilation at the
 * components that consume them instead of at runtime.
 *
 * @module @khorsheed/dsh-reader/client/contract
 */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  GlobalStandardProps, InjectFace, PropsLocale, PropsStore,
} from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the generated Remote API (ctx.remote merge + our namespace).
import type {} from '@khorsheed/dsh-reader/remote'
// Type-only: pulls ui-session's GlobalStandardProps merge (`useSessions`).
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {
  ReaderAddFailure,
  ReaderAddOutcome,
  ReaderAddRefusal,
  ReaderAnnotationOutcome,
  ReaderBackfillCandidate,
  ReaderEntryBodyView,
  ReaderEntryFetchState,
  ReaderBody,
  ReaderCapabilities,
  ReaderEntryTranslationView,
  ReaderImageResult,
  ReaderMutationOutcome,
  ReaderRefreshResult,
  ReaderRecentEntry,
  ReaderSentenceLearn,
  ReaderSourceSummary,
  ReaderStorageStats,
  ReaderTag,
} from '../types.ts'
import type { createReaderStore } from './store.ts'

export type { RemoteResult }

/** The result of extracting one article, as the detail view consumes it. */
export interface ReaderArticle {
  /** Whitelisted body markup, ready to render. */
  readonly html: string
  /** True when the body is known to be incomplete (size cap or partial parse). */
  readonly truncated: boolean
  /** Set when nothing usable could be extracted. */
  readonly error?: string
}

/**
 * The capture package's Remote face (the ingest proposal's M1), mirrored
 * structurally — never imported. Absent namespaces probe as undefined.
 */
export interface ReaderCaptureRemote {
  /** Render a URL in the managed browser and hand back the serialized page. */
  render: (request: { url: string; timeoutMs?: number }) => Promise<RemoteResult<{
    html: string
    finalUrl?: string
    title?: string
    truncated?: boolean
  }>>
}

/**
 * What the pane's own extraction read from the article, beyond the stored body:
 * the article's own title and a short excerpt. A saved link's card upgrades
 * from the URL-derived label to these; a feed entry's title is already the
 * publisher's and is never overridden.
 */
export interface ReaderExtractedMeta {
  readonly title?: string
  readonly excerpt?: string
}

/**
 * The business face every reader surface receives from its registration.
 *
 * The wire verbs come straight off the Remote; the last four are local
 * gestures the pane cannot perform itself (they need the session scope, the
 * clipboard, or the browser), so `client/index.ts` injects them.
 */
export interface ReaderPaneInjected {
  /** Round-trip the capability handshake. */
  capabilities: () => Promise<RemoteResult<ReaderCapabilities>>
  /** The configured sources, newest first. */
  listSources: () => Promise<RemoteResult<{ sources: ReaderSourceSummary[] }>>
  /** Add a feed or a pasted article; the host decides which by content. */
  addSource: (url: string) => Promise<RemoteResult<ReaderAddOutcome | ReaderAddRefusal | ReaderAddFailure>>
  /** Change a source's label/enabled flag, or the global refresh time. */
  updateSource: (request: {
    id: string
    enabled?: boolean
    label?: string
    url?: string
    timeOfDay?: string
  }) => Promise<RemoteResult<ReaderMutationOutcome>>
  /** Drop a source. Its entries' translation maps go with it (the caller passes the ids it parsed). */
  removeSource: (id: string, entryIds?: readonly string[]) => Promise<RemoteResult<ReaderMutationOutcome>>
  /** Fetch the named sources, or every enabled one. */
  refresh: (ids?: string[]) => Promise<RemoteResult<{ results: ReaderRefreshResult[] }>>
  /** Raw payloads, for this process to parse (the host never parses). */
  getBodies: (ids: string[]) => Promise<RemoteResult<{ bodies: ReaderBody[] }>>
  /** Offer a ref block to the side-chat service when one is composed. */
  quoteToSideChat: (request: {
    contextKey: string
    label: string
    text: string
  }) => Promise<RemoteResult<'ok' | 'unavailable'>>
  /* ---------------------------------------------------- bodies and tags */

  /** What the plugin holds per entry: a body, a stored payload, or a failure. */
  entryFetchStates: (entryIds: readonly string[]) => Promise<RemoteResult<{ states: Record<string, ReaderEntryFetchState> }>>
  /** Cache body markup this process holds (the sweep's extractions, or a feed's own full text on open). */
  storeEntryBody: (request: {
    entryId: string
    url: string
    html: string
    truncated?: boolean
    scriptFigures?: number
    /** This body came from the capture rendered fetch; 「重新抓取」 re-renders rather than plain-fetches it. */
    rendered?: boolean
    /** `translationHash(html)` — the entry's translation map dies with a body it no longer matches. */
    bodyHash?: string
    /** The article's own title, as extracted — a saved link's card upgrade. */
    title?: string
    /** A short excerpt (the first substantial paragraph), with the title. */
    excerpt?: string
  }) => Promise<RemoteResult<ReaderEntryBodyView>>
  /** A payload the host stored, so this process can extract it (late or never). */
  getRawBody: (entryId: string) => Promise<RemoteResult<{ entryId: string; raw?: string; url?: string; truncated?: boolean; error?: string }>>
  /**
   * The entries whose full text still has to be filled in (the automatic
   * backfill's work list; the host owns the policy, this process owns the DOM).
   */
  listBackfillCandidates: (entries: readonly {
    entryId: string
    url: string
    label: string
    hasBody: boolean
  }[]) => Promise<RemoteResult<{ candidates: ReaderBackfillCandidate[] }>>
  /**
   * What the host has for one entry: a fresh cached body, else the feed's own
   * payload, else nothing (plus why a previous fetch failed).
   */
  getEntryBody: (request: {
    entryId: string
    url: string
    feedHtml?: string
  }) => Promise<RemoteResult<ReaderEntryBodyView>>
  /**
   * Fetch one entry's article, extract it in THIS process (the host has no
   * parser) and cache what came out. One call from the view's perspective; the
   * extracted title/excerpt ride along for the card upgrade.
   */
  fetchEntryBody: (entryId: string, url: string) => Promise<ReaderEntryBodyView & ReaderExtractedMeta>
  /**
   * Fetch one image through the host, for an `<img>` the browser already
   * failed on (CORP/hotlink protection — the bytes answer 200 to a direct
   * fetch but are withheld from a cross-origin page). The pane re-points the
   * image at a `data:` URI built from the answer; a host without the verb (or
   * an origin that refuses the host too) leaves the broken image alone.
   */
  fetchImage: (url: string) => Promise<RemoteResult<ReaderImageResult>>
  /** The tags on one entry. */
  entryTags: (entryId: string) => Promise<RemoteResult<{ tags: ReaderTag[] }>>
  /** The tag vocabulary, with per-tag usage counts. */
  listTags: () => Promise<RemoteResult<{ tags: ReaderTag[]; counts: Record<string, number> }>>
  /** Create a tag, or return the existing one whose name matches. */
  createTag: (name: string) => Promise<RemoteResult<ReaderTag | ReaderAnnotationOutcome>>
  /** Add or remove one tag on one entry. */
  tagEntry: (entryId: string, tagId: string, on: boolean) => Promise<RemoteResult<ReaderAnnotationOutcome>>
  /** Rename a tag. */
  renameTag: (id: string, name: string) => Promise<RemoteResult<ReaderAnnotationOutcome>>
  /** Delete a tag everywhere. */
  deleteTag: (id: string) => Promise<RemoteResult<ReaderAnnotationOutcome>>
  /** Drop tags nothing references any more. */
  pruneTags: () => Promise<RemoteResult<{ removed: number }>>
  /** Record that the reader opened one entry (the 「最近阅读」 page's write half). */
  recordRead: (request: {
    entryId: string
    sourceId: string
    title: string
    url?: string
  }) => Promise<RemoteResult<{ entries: number }>>
  /** The entries the reader opened, newest first. */
  listRecent: () => Promise<RemoteResult<{ entries: ReaderRecentEntry[] }>>
  /** Forget every recent entry. */
  clearRecent: () => Promise<RemoteResult<{ removed: number }>>
  /** Read / set the article cache policy (and the translation budget). */
  getCachePolicy: () => Promise<RemoteResult<{ ttlHours: number; maxEntries: number; translationBudgetChars: number }>>
  setCachePolicy: (ttlHours: number, maxEntries?: number, translationBudgetChars?: number) => Promise<RemoteResult<ReaderAnnotationOutcome>>
  /* ------------------------------------------- the persistent translation tiers */

  /** One entry's exact-fit translation record, when the host holds a usable one. */
  getEntryTranslation: (entryId: string) => Promise<RemoteResult<{ translation?: ReaderEntryTranslationView }>>
  /** Translations for exactly the asked sentence hashes of one pair (never the table). */
  getSentenceTranslations: (request: {
    pair: string
    hashes: readonly string[]
  }) => Promise<RemoteResult<{ translations: Record<string, string> }>>
  /**
   * Persist what one translation run learned (and refresh what it reused), in
   * one batch — the caller batches by run, so this is never a per-sentence call.
   */
  rememberSentences: (request: {
    pair: string
    entries: readonly ReaderSentenceLearn[]
    recalled?: readonly ReaderSentenceLearn[]
    entryId?: string
    bodyHash?: string
  }) => Promise<RemoteResult<{ stored: number }>>
  /** Per-tier cache usage, aggregated on the host (the manage page's readout). */
  getStorageStats: () => Promise<RemoteResult<ReaderStorageStats>>
  /** Forget every translation: the global memory and every entry map. */
  clearTranslations: () => Promise<RemoteResult<{ clearedEntries: number; clearedMemory: boolean }>>
  /** Read the current conversation draft (the merge `setDraft` needs). */
  readDraft: () => string
  /** Replace the conversation draft with `merged`; a no-op without a session surface. */
  setDraft: (merged: string) => void
  /** Copy text to the clipboard; resolves false when the API is unavailable. */
  copyText: (text: string) => Promise<boolean>
  /** Open a URL in the user's browser; false when the platform refuses. */
  openExternal: (url: string) => boolean
  /**
   * Whether the host's in-app Sidebar Browser is mounted (probed live: the tab
   * kind `browser` exists on host 0.1.6-alpha.2+). When it is, fetches that
   * need a real browser — a page that draws its figures with scripts, a bot
   * wall — get an in-app way out instead of only an external link.
   */
  browserTabAvailable: () => boolean
  /**
   * Open a URL in the in-app Sidebar Browser; false when the seam is absent or
   * refuses, so the caller falls back to {@link ReaderPaneInjected.openExternal}.
   */
  openBrowserTab: (url: string) => boolean
  /**
   * The capture package's Remote, when one is mounted — the 「渲染抓取」 slot
   * renders only while this answers. M0 ships no capture package (it is the
   * ingest proposal's M1), so the probe is the whole point today: probed live,
   * never cached, never thrown.
   */
  captureRemote: () => ReaderCaptureRemote | undefined
}

/** Full props of the reader pane: the seat's session + store + locale + face. */
export type ReaderPaneProps =
  & { sessionId: SessionId }
  & GlobalStandardProps
  & PropsStore<ReturnType<typeof createReaderStore>>
  & InjectFace<ReaderPaneInjected>
  & PropsLocale<'reader'>
