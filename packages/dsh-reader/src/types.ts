/**
 * Shared vocabulary of `@khorsheed/dsh-reader`: the persisted state document,
 * the Remote wire payloads, and the pure helpers both faces share.
 *
 * Two responsibilities are deliberately split across the process boundary:
 *
 * - the HOST half owns the network (the sanctioned `ctx.web` fetch seam) and
 *   the disk (one version-guarded JSON document over `ctx.fs`). It stores the
 *   LAST RAW PAYLOAD per source — feed XML or article HTML — plus fetch
 *   metadata, and never parses either.
 * - the BROWSER half owns parsing. The host runtime has no XML/DOM parser at
 *   all (Node's `globalThis.DOMParser` is absent), so the single parser lives
 *   in the browser where `DOMParser` is native, and its output never needs to
 *   be persisted: entries and extracted article bodies are session state.
 *
 * @module @khorsheed/dsh-reader/types
 */

/* ------------------------------------------------------------------ sources */

/** What a source is: a syndication feed, or one manually saved article link. */
export type ReaderSourceKind = 'rss' | 'link'

/** Fetch state of one source's most recent attempt. */
export type ReaderFetchStatus = 'ok' | 'fetching' | 'error'

/**
 * Why a source has no previewable body.
 *
 * A saved link is a link the reader OWNS even when its body cannot be read
 * here, so these are not add failures: they are the reason the card says
 * "link only" and the detail view offers the original instead of a blank
 * page. The set is deliberately small and each member has its own sentence —
 * "collected but not previewable" with no cause is a worse answer than a
 * wrong one, and the three real causes (a bot wall, a login wall, a
 * non-web file) send the reader to different actions.
 */
export type ReaderPreviewFailureCode =
  /** The site refuses non-browser requests, or answered with a bot challenge. */
  | 'blocked'
  /** The target sits behind an authentication wall (institutional proxy, SSO). */
  | 'login'
  /** The response is not a web page at all (a PDF or another file type). */
  | 'unsupported-type'
  /** The address hops to a different site, which the host seam refuses to follow. */
  | 'redirected'
  /** The page yielded nothing to read (an interstitial, an empty shell). */
  | 'empty'
  /** The request never completed: network, timeout, or a 5xx. The retryable one. */
  | 'unreachable'
  /** The address answered with an HTTP error status (404 and friends). */
  | 'http'
  /**
   * The host is KNOWN to be unreadable server-side without a request (a
   * script-rendered app behind an anti-bot wall — OpenReview, measured). The
   * sentence for it carries the way out (paste the arXiv version / open in a
   * browser), so it is not folded into `blocked`, which means "we tried and
   * the site answered a wall".
   */
  | 'unreadable'

/**
 * Whether an automatic retry is worth the request.
 *
 * Only a transport failure is: a bot wall, a login wall, a PDF and a 404 all
 * answer the same way forever, so retrying them on a timer would be a crawler
 * with a grudge rather than a reader. The manual refresh stays available.
 *
 * @param code - the recorded failure.
 * @returns true when the entry may be retried automatically.
 */
export function isRetryablePreviewFailure(code: ReaderPreviewFailureCode): boolean {
  return code === 'unreachable'
}

/** A recorded reason that a source has no previewable body. */
export interface ReaderPreviewFailure {
  readonly code: ReaderPreviewFailureCode
  /** The seam's or the classifier's own words, kept for diagnosis. */
  readonly message: string
  /** When the failure was recorded (ISO-8601). */
  readonly at: string
}

/**
 * One source of entries.
 *
 * A `link` source always holds exactly one entry (the article itself) and is
 * created by pasting a URL; an `rss` source holds however many items its feed
 * declares.
 */
export interface ReaderSource {
  readonly id: string
  readonly kind: ReaderSourceKind
  /** Feed URL (normalized after redirects), or the article URL for a link. */
  readonly url: string
  /** User-facing name; falls back to the URL's host plus last path segment. */
  readonly label?: string
  readonly enabled: boolean
  /** ISO-8601 timestamp of when the user added it. */
  readonly addedAt: string
  /** ISO-8601 timestamp of the last completed fetch attempt. */
  readonly fetchedAt?: string
  readonly status?: ReaderFetchStatus
  /** Human-readable failure of the last attempt, when `status` is `error`. */
  readonly error?: string
  /**
   * True when the host's fetch seam cut the payload at its size limit
   * (`maxBodyChars`, 100 000 by default). A truncated XML document cannot be
   * parsed and a truncated HTML page yields a partial article, so every
   * consumer treats this as "incomplete" and says so rather than guessing.
   */
  readonly truncated?: boolean
  /**
   * Why this source has no previewable body, when it has none.
   *
   * A saved link keeps its identity and its URL even when the body cannot be
   * read, so this is recorded instead of the source being dropped: losing a
   * link the reader deliberately saved is a worse outcome than a card that
   * says it can only be opened in a browser.
   */
  readonly failure?: ReaderPreviewFailure
  /**
   * The URL the reader pasted, when this source was resolved to a canonical
   * version of the same work (a DOI that gated into its arXiv version). The
   * source's own `url` is the resolved one — it is what refreshes fetch — and
   * this keeps the provenance visible.
   */
  readonly resolvedFrom?: string
  /** The last raw payload: feed XML for `rss`, article HTML for `link`. */
  readonly raw?: string
}

/** The whole persisted document: one JSON file under the plugin's state root. */
export interface ReaderStateDoc {
  readonly version: 1
  readonly sources: readonly ReaderSource[]
  readonly refresh: ReaderRefreshConfig
  /** How long fetched article bodies are served, and how many are kept. */
  readonly cache?: ReaderCachePolicy
  /** The reader's tag vocabulary, keyed by tag id. */
  readonly tags?: Readonly<Record<string, ReaderTag>>
  /** ISO-8601 timestamp of the last completed refresh run. */
  readonly lastRefreshAt?: string
  /**
   * The reader's own annotations, keyed by ENTRY id.
   *
   * Deliberately a separate table from the sources: an entry belongs to a feed
   * that may drop it tomorrow, while a tag the reader put on it is theirs and
   * must outlive the feed's window. It is also the only place a fetched article
   * body can live — the sources hold raw payloads, not per-entry markup.
   */
  readonly annotations?: Readonly<Record<string, ReaderEntryAnnotation>>
  /**
   * The global sentence memory's manifest; the TABLE lives in its own
   * `bodies/` file.
   *
   * Kept out of the document body on purpose: the table is bounded at 50 000
   * sentences (several MB of JSON), and this document is read and rewritten
   * whole on every commit — including one per article opened (`recordRead`).
   * The manifest is all the commit path needs.
   */
  readonly translationMemory?: ReaderTranslationMemoryManifest
  /**
   * What the reader opened, newest first (the 「最近阅读」 page).
   *
   * Persisted, unlike the pane's session memory: "what was I reading" is a fact
   * about the reader's own behaviour that has to outlive a reload and a restart,
   * and it holds no third-party text — a title and a URL the reader already
   * asked for. It is NOT the read cursor (that stays per session, in the pane).
   */
  readonly recent?: readonly ReaderRecentEntry[]
}

/**
 * One entry the reader opened, as the 「最近阅读」 page lists it.
 *
 * The title and URL are stored rather than looked up because the feed that
 * published the entry may have rolled it out of its window: a recent list that
 * silently drops yesterday's article is not a record of what was read.
 */
export interface ReaderRecentEntry {
  readonly entryId: string
  readonly sourceId: string
  readonly title: string
  /** The article URL, for reopening an entry the feed no longer publishes. */
  readonly url?: string
  /** When it was opened (ISO-8601). */
  readonly readAt: string
}

/**
 * What the plugin holds for one entry: a body, a stored raw payload, or why not.
 *
 * `raw` is the state that makes a fetch resumable: the payload is on disk and the
 * browser half has not extracted it yet, so closing the page costs nothing.
 */
export type ReaderEntryFetchState =
  | { readonly state: 'none' }
  | { readonly state: 'fetching'; readonly at: string }
  | { readonly state: 'raw'; readonly at: string }
  | { readonly state: 'ready'; readonly at?: string }
  | {
    readonly state: 'failed'
    readonly at: string
    readonly message: string
    readonly code?: ReaderPreviewFailureCode
  }

/** The persisted twin of the in-flight/raw half of {@link ReaderEntryFetchState}. */
export interface ReaderEntryFetchRecord {
  readonly state: 'fetching' | 'raw'
  readonly at: string
  /** The `bodies/` file holding the raw payload, once it has been written. */
  readonly rawFile?: string
  /** The payload's character count (the document itself stays out of `state.json`). */
  readonly chars?: number
  /** Where the payload came from, so an edited URL is detectable. */
  readonly url?: string
  /** True when the seam capped the payload. */
  readonly truncated?: boolean
}

/** One entry's reader-authored state (see the annotations section below). */
export interface ReaderEntryAnnotation {
  /** The fetched full text, when one was asked for and arrived. */
  readonly body?: ReaderEntryBody
  /** Tag ids on this entry, in the order they were applied. */
  readonly tagIds?: readonly string[]
  /** A fetch in flight, or a payload fetched and still waiting to be extracted. */
  readonly fetch?: ReaderEntryFetchRecord
  /** Why the last fetch failed, so a retry is a decision and not a loop. */
  readonly error?: string
  /** The classified reason, so the wall can show the same sentence as the detail. */
  readonly failureCode?: ReaderPreviewFailureCode
  /** When that failure was recorded (ISO-8601). */
  readonly failedAt?: string
  /**
   * This entry's translated segment map (a hash→translation table, never
   * markup). No TTL: a translation costs a gesture plus per-sentence model work
   * to rebuild, so only the shared translation budget evicts it.
   */
  readonly translation?: ReaderEntryTranslation
}

/** How long a fetched article body is served before the reader is offered a refetch. */
export interface ReaderCachePolicy {
  /** 0 means "never expires" (the body is kept until the budget evicts it). */
  readonly ttlHours: number
  /** How many entry bodies may be retained at once (oldest evicted first). */
  readonly maxEntries: number
  /**
   * How large the two translation tiers may grow together, in characters.
   *
   * Absent means {@link DEFAULT_TRANSLATION_BUDGET_CHARS}. Translations carry no
   * TTL (rebuilding one costs a user gesture plus per-sentence model work, so
   * they must not inherit the body TTL) — this budget, LRU by last use across
   * both tiers, is the only eviction.
   */
  readonly translationBudgetChars?: number
}

/** The default cache policy: a day, and a few hundred articles. */
export const DEFAULT_CACHE_POLICY: ReaderCachePolicy = { ttlHours: 24, maxEntries: 500 }

/* ---------------------------------------------------- translation memory */

/**
 * The schema version of the persisted translation tiers (the global sentence
 * memory's table, and each entry's segment map). A browser Translator model
 * upgrade quietly changes what the same sentence translates to, and a
 * segmentation change here changes what a "sentence" is — bumping this turns
 * every old record into a MISS. Records are evicted LAZILY (the next write or
 * budget pass drops them), never wiped eagerly.
 */
export const TRANSLATION_STORAGE_VERSION = 1

/**
 * The default total budget for both translation tiers, in characters — 64 MB
 * worth of text. Counted in characters, like every other budget in this
 * document (a CJK sentence costs more bytes than that reads; the approximation
 * is the store's existing convention).
 */
export const DEFAULT_TRANSLATION_BUDGET_CHARS = 64 * 1024 * 1024

/** How many sentences the global memory keeps before its own LRU end is evicted. */
export const MAX_TRANSLATION_MEMORY_ENTRIES = 50_000

/** One remembered sentence translation — the global tier's value. */
export interface ReaderTranslationMemoryEntry {
  /** The source sentence, verbatim (the hash in the entry's key is over this). */
  readonly source: string
  /** What the translator answered. */
  readonly target: string
  /** The LRU clock: when the entry last served a translation (or was written). */
  readonly lastUsedAt: string
}

/** The global memory file's content; the table lives in `bodies/`, not inline. */
export interface ReaderTranslationMemoryTable {
  readonly version: number
  readonly entries: Readonly<Record<string, ReaderTranslationMemoryEntry>>
}

/** The document's pointer at the global memory file. */
export interface ReaderTranslationMemoryManifest {
  readonly version: number
  /** The `bodies/` file holding the table (a fixed, safe name). */
  readonly file: string
  readonly entries: number
  readonly chars: number
  readonly updatedAt: string
}

/**
 * One entry's translation of its body: a map of sentence hash to translation —
 * never translated markup, so a body re-fetched with minor edits still reuses
 * every unchanged sentence through the global tier, while a `bodyHash`
 * mismatch invalidates only this exact-fit record.
 */
export interface ReaderEntryTranslation {
  readonly version: number
  /** The `<src>→<tgt>` label the map was built under. */
  readonly pair: string
  /** Hash of the normalized body the segments were cut from. */
  readonly bodyHash: string
  /** sentenceHash → translation, inline while the map is small. */
  readonly segments?: Readonly<Record<string, string>>
  /** The `bodies/` file holding the segment map once it is large. */
  readonly file?: string
  /** The map's serialized size, for the shared budget. */
  readonly chars?: number
  readonly translatedAt: string
  /** The shared-budget LRU clock. */
  readonly lastUsedAt: string
}

/** One sentence the browser half learned (or was served), as it reports it. */
export interface ReaderSentenceLearn {
  /** The client's `translationHash(source)`, stored opaquely. */
  readonly hash: string
  readonly source: string
  readonly target: string
}

/** An entry translation as the wire serves it: the segment map resolved. */
export interface ReaderEntryTranslationView {
  readonly pair: string
  readonly bodyHash: string
  readonly segments: Record<string, string>
}

/**
 * How much the two caches currently hold, aggregated on the host.
 *
 * Counts and characters only — the tables themselves never cross the wire for
 * a settings readout. `chars` is the store's accounting unit (characters, the
 * same unit the budgets are written in).
 */
export interface ReaderStorageStats {
  /** The cached article bodies (what TTL + maxEntries govern). */
  readonly bodies: {
    readonly entries: number
    readonly chars: number
  }
  /** The two translation tiers: per-entry maps, and the global sentence memory. */
  readonly translations: {
    /** How many entries carry a segment map. */
    readonly entries: number
    /** The maps' combined size. */
    readonly chars: number
    /** The global memory's sentence count (0 when no table exists). */
    readonly memoryEntries: number
    /** The global memory's size (0 when no table exists). */
    readonly memoryChars: number
  }
}

export interface ReaderRefreshConfig {
  readonly enabled: boolean
  /** Local time of day as `HH:MM`; defaults to `10:00`. */
  readonly timeOfDay: string
}

/* ------------------------------------------------------------------ entries */

/**
 * One parsed entry. Produced by the browser half and never persisted.
 *
 * `contentHtml` is the best body the reader could assemble: a feed's
 * `<content:encoded>` / `<content>` when it ships full text, otherwise the
 * article body extracted from the fetched page. It is always the output of the
 * whitelist normalizer, never raw third-party markup.
 */
export interface ReaderEntry {
  /** Stable id: the feed's guid/id, else the link, else a title+link hash. */
  readonly id: string
  readonly sourceId: string
  readonly title: string
  readonly link?: string
  readonly author?: string
  /** ISO-8601 publication timestamp, when the feed declares one. */
  readonly publishedAt?: string
  readonly tags?: readonly string[]
  /** Short plain-text excerpt for the card. */
  readonly summary?: string
  /** Normalized article body for the detail view. */
  readonly contentHtml?: string
  /**
   * True when {@link contentHtml} is only the FEED's own summary.
   *
   * A feed that publishes no `content:encoded` / `<content>` still gets its
   * description rendered in the detail view (an empty page would be worse), so
   * the browser half has to be able to tell "the feed gave me its summary" from
   * "this is the article" — otherwise the entry looks complete and nothing ever
   * fetches the page behind it. The automatic backfill and opening an entry
   * both treat this as a body still owed.
   */
  readonly summaryOnly?: boolean
  /** True when the body is known to be incomplete (see {@link ReaderSource.truncated}). */
  readonly truncated?: boolean
  /**
   * True when the ENTRY itself is a salvage of a payload the host capped: its
   * text is real but stops where the cap landed. The detail view says so.
   */
  readonly partial?: boolean
}

/* ------------------------------------------------------------------ wire payloads */

/** One source as the browser sees it (no payload: bodies are fetched on demand). */
export interface ReaderSourceSummary {
  readonly id: string
  readonly kind: ReaderSourceKind
  readonly url: string
  readonly label: string
  readonly enabled: boolean
  /**
   * When the reader added it (ISO-8601).
   *
   * The browser needs this to order the wall and the management list by
   * "when did this arrive": a saved link carries no publication date at all,
   * so without this field it sorts as the oldest thing on the wall — which is
   * exactly where a reader who just added it will not look.
   */
  readonly addedAt: string
  readonly fetchedAt?: string
  readonly status?: ReaderFetchStatus
  readonly error?: string
  readonly truncated?: boolean
  readonly hasBody: boolean
  /** Present when this source has no previewable body (see {@link ReaderPreviewFailure}). */
  readonly failure?: { readonly code: ReaderPreviewFailureCode; readonly message: string }
  /** The URL the reader pasted, when the source was resolved to a canonical version (see {@link ReaderSource.resolvedFrom}). */
  readonly resolvedFrom?: string
}

/** Capability handshake: what the browser may rely on in this composition. */
export interface ReaderCapabilities {
  readonly protocolVersion: 1
  /** False when no filesystem is mounted: state lives in memory and is lost on restart. */
  readonly hasFs: boolean
  /** False when no side-chat service is mounted: the side-chat gesture must hide. */
  readonly hasSideChat: boolean
  /** ISO-8601 timestamp of the next scheduled refresh, when one is armed. */
  readonly nextRefreshAt?: string
  /**
   * ISO-8601 timestamp of the last completed refresh run, when there was one.
   * The list shows it so a reader can decide whether the snapshot is stale
   * enough to be worth a fetch.
   */
  readonly lastRefreshAt?: string
}

/** Outcome of a mutating source verb. A domain refusal, never an exception. */
export type ReaderMutationOutcome =
  | 'ok'
  | 'not-found'
  | 'invalid-url'
  | 'invalid-time'
  | 'duplicate'
  | 'unavailable'

/** What `addSource` decided a pasted URL was. */
export interface ReaderAddOutcome {
  readonly outcome: 'subscribed' | 'saved-link'
  readonly kind: ReaderSourceKind
  readonly id: string
  readonly label: string
  /**
   * Present when the source was saved but its body cannot be previewed.
   *
   * The add still succeeded: the URL is a link the reader now owns. This is
   * the verdict's reason, not a failure — which is why it rides the outcome
   * instead of becoming one more refusal that loses the link.
   */
  readonly failure?: { readonly code: ReaderPreviewFailureCode; readonly message: string }
}

/**
 * A refusal from `addSource`: the mutation outcomes that make sense for "turn
 * this URL into a source", plus the two fetch-stage refusals that have no
 * meaning for the other verbs. Kept as its own union so the wire type states
 * exactly what this verb can answer.
 */
export type ReaderAddRefusal =
  | Extract<ReaderMutationOutcome, 'invalid-url' | 'duplicate' | 'unavailable'>
  | 'unsupported-content'
  | 'fetch-failed'

/**
 * The fetch itself failed, with the seam's own reason attached.
 *
 * A separate shape rather than one more string in {@link ReaderAddRefusal}:
 * "the request did not complete" is a different conversation from "that URL
 * cannot be a source", and only the first one has something to show the reader
 * beyond the verdict. Without the reason the UI can only say "failed", which
 * is not a diagnosis.
 */
export interface ReaderAddFailure {
  readonly outcome: 'fetch-failed'
  /** The fetch seam's message, verbatim — a refused connection, a timeout, a byte cap. */
  readonly reason: string
}

/**
 * One entry the host would like full text for.
 *
 * The host decides WHICH entries need it (it owns the cache, the failures and
 * the policy); the browser decides what the page says (it owns the DOM). This
 * is the split that makes automatic backfill possible at all.
 */
export interface ReaderBackfillCandidate {
  readonly entryId: string
  readonly url: string
  readonly label: string
  /** Why a previous attempt failed, when one did (and when it is worth retrying). */
  readonly lastError?: string
}

/** Per-source result of a refresh run. */
export interface ReaderRefreshResult {
  readonly id: string
  readonly status: 'ok' | 'fetch-failed' | 'truncated' | 'unavailable'
  readonly message?: string
}

/** One raw payload, requested on demand for parsing in the browser. */
export interface ReaderBody {
  readonly id: string
  readonly raw?: string
  readonly truncated?: boolean
  /** Present when the payload could not be produced (fetch failed, no fs, …). */
  readonly error?: string
}

/* ------------------------------------------------------------------ helpers */

/** Default state root segment under `$DSH_HOME/state`. */
export const STATE_ROOT_SEGMENT = 'dsh-reader'

/** Default daily refresh time. */
export const DEFAULT_REFRESH_TIME = '10:00'

/**
 * Per-source raw-payload budget in characters.
 *
 * Sized to the HOST's egress cap rather than below it: a deployment can raise
 * `web-fetch-http`'s `maxBodyChars` (the acceptance instance runs it at
 * 2,000,000), and a per-source budget smaller than what the seam is willing to
 * deliver would silently re-truncate every large feed here — the reader would
 * pay for the fetch and still get half a document, with the note blaming the
 * fetch. The fetch cap is the outer bound; this one must not be the inner one.
 */
export const MAX_BODY_CHARS_PER_SOURCE = 2 * 1024 * 1024

/** Total raw-payload budget in characters across all sources (newest kept). */
export const MAX_TOTAL_BODY_CHARS = 12 * 1024 * 1024

/**
 * How large an extracted body may be before it lives in its own file.
 *
 * `state.json` is read and rewritten as a whole on every mutation, so a research
 * paper whose figures are inlined as base64 (transformer-circuits.pub's emotions
 * paper is a 41.8 MB HTML document and extracts to tens of megabytes) would make
 * every reader operation pay a multi-megabyte JSON round trip. Above this
 * threshold the body is written to one file under `bodies/` and the document
 * keeps only its metadata — so the cache policy (`ttlHours`, `maxEntries`) still
 * governs it exactly like an inline body, and eviction deletes the file.
 */
export const INLINE_BODY_MAX_CHARS = 256 * 1024

/**
 * Build a display label for a source from its URL: the registrable-ish host
 * plus the last meaningful path segment, which is what distinguishes several
 * feeds from one publisher.
 *
 * @param url - the source URL (any string; a malformed one degrades to its own head).
 * @returns a short human label.
 */
export function defaultSourceLabel(url: string): string {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.replace(/^www\./, '')
    const segments = parsed.pathname.split('/').filter(segment => segment.length > 0)
    const last = segments.at(-1) ?? ''
    // Drop a bare feed file name that repeats the host ("example.com/feed.xml"
    // reads better as "example.com/feed"); keep the host alone when nothing
    // useful is left.
    const tail = last.replace(/\.(xml|rss|atom|json)$/i, '')
    return tail.length > 0 ? `${host}/${tail}` : host
  } catch {
    return url.slice(0, 60)
  }
}

/**
 * Build a stable entry id. Feeds are inconsistent about identifiers, so the
 * order is: explicit guid/id, then the entry link, then a hash over title and
 * link together (a feed with neither must still deduplicate across refreshes).
 *
 * @param entry - the identifying fields an entry may carry.
 * @returns an id stable across refreshes of the same feed content.
 */
export function stableEntryId(entry: { title: string; link?: string; guid?: string }): string {
  const explicit = entry.guid?.trim()
  if (explicit !== undefined && explicit.length > 0) return `g:${explicit}`
  const link = entry.link?.trim()
  if (link !== undefined && link.length > 0) return `l:${link}`
  return `h:${hash32(`${entry.title}\u0000${entry.link ?? ''}`).toString(36)}`
}

/**
 * The entry id a saved link's single entry carries.
 *
 * A `link` source is exactly one entry, so the host must be able to name that
 * entry when it records a per-entry annotation (the fetch failure the detail
 * view reads). Both halves use this one function: a magic string duplicated
 * across the process boundary is a bug waiting for a rename.
 *
 * @param sourceId - the link source's id.
 * @returns the entry id the browser will build for it.
 */
export function linkEntryId(sourceId: string): string {
  return `link:${sourceId}`
}

/**
 * The query that selects every entry of one source KIND.
 *
 * The same local-predicate mechanism as a source or tag filter, so a kind
 * narrowing is visible in the search box and can be cleared there. The prefix
 * cannot collide with a real source id: ids are always `<kind>-<hash>`.
 *
 * @param kind - the source kind to select.
 * @returns the query string.
 */
export function kindQuery(kind: ReaderSourceKind): string {
  return `#${kind}`
}

/** The source kinds a kind query can name, for the predicate that reads one. */
export const READER_SOURCE_KINDS: readonly ReaderSourceKind[] = ['rss', 'link']

/**
 * Shorten a summary for a card, collapsing whitespace so multi-line feed
 * descriptions do not blow up the layout.
 *
 * @param text - the raw summary or content text.
 * @param maxLength - the maximum returned length, ellipsis included.
 * @returns the collapsed, shortened text, or `undefined` when there is none.
 */
export function summarize(text: string | undefined, maxLength = 280): string | undefined {
  if (text === undefined) return undefined
  const collapsed = text.replace(/\s+/g, ' ').trim()
  if (collapsed.length === 0) return undefined
  if (collapsed.length <= maxLength) return collapsed
  return `${collapsed.slice(0, maxLength - 1)}…`
}

/** Coerce an unknown thrown value into a message string. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 32-bit FNV-1a hash, used only to build stable ids (never for security). */
function hash32(input: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/* ----------------------------------------------------------- entry annotations */

/**
 * One entry's cached article body, keyed by the entry's stable id.
 *
 * A feed may publish full text for some entries and only a summary for others
 * (measured: the OpenAI alignment feed runs 155 to 62,044 characters entry by
 * entry), so this is where the full text of a summary-only entry lives once the
 * reader has asked for it. Keyed by entry id — NOT by the source — because the
 * id is derived from the entry's guid/link and therefore survives every
 * refresh; keying by "position in the feed" would mix entries up on the next
 * fetch.
 */
export interface ReaderEntryBody {
  /** Whitelist-normalized article markup, when it is small enough to inline. */
  readonly html?: string
  /**
   * The `bodies/` file holding this body, when it is too large to inline.
   *
   * A bare file name, never a path: the store owns the directory, and a document
   * that carried an absolute path would break the moment the state root moves.
   */
  readonly file?: string
  /** The body's character count, so the document can report its size without it. */
  readonly chars?: number
  /** When it was fetched (ISO-8601), for the "fetched just now" line and pruning. */
  readonly fetchedAt: string
  /**
   * When it stops being served without asking again (ISO-8601).
   *
   * A cached body is an optimization, not an archive: the acceptance decision
   * was 24h, because a reader re-opens an article within the day or not at all.
   * Past the deadline the detail view offers the fetch again rather than
   * silently serving yesterday's copy.
   */
  readonly expiresAt: string
  /** The URL it was fetched from, so a source edit is detectable. */
  readonly url: string
  /** True when the fetch hit the seam's cap (the note then says so honestly). */
  readonly truncated?: boolean
  /** Figures the page draws with its own scripts (dropped; the note counts them). */
  readonly scriptFigures?: number
}

/** One user-defined tag. */
export interface ReaderTag {
  /** Stable id — renaming a tag must not rewrite every entry that carries it. */
  readonly id: string
  /** The reader-facing name, unique case-insensitively. */
  readonly name: string
  readonly createdAt: string
}

/** A mutation on the annotation face, as a bare domain value. */
export type ReaderAnnotationOutcome = 'ok' | 'not-found' | 'invalid' | 'duplicate' | 'unavailable' | 'empty'

/**
 * What the pane asks for when it opens one entry.
 *
 * `html` present means the detail view can render immediately. Absent means
 * there is nothing beyond the feed summary and the view should offer the fetch.
 */
export interface ReaderEntryBodyView {
  readonly entryId: string
  /** True when this body is a cached fetch rather than the feed's own payload. */
  readonly cached: boolean
  /** False when the cache's deadline has passed: the view offers the fetch. */
  readonly fresh: boolean
  /** True when the feed's payload already carries full text for this entry. */
  readonly fromFeed: boolean
  readonly html?: string
  readonly fetchedAt?: string
  readonly truncated?: boolean
  /** Figures this page draws with scripts — the detail view says so. */
  readonly scriptFigures?: number
  /** Why a fetch could not produce a body, when one was attempted. */
  readonly error?: string
}
