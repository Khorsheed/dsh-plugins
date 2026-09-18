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
}

/** One entry's reader-authored state (see the annotations section below). */
export interface ReaderEntryAnnotation {
  /** The fetched full text, when one was asked for and arrived. */
  readonly body?: ReaderEntryBody
  /** Tag ids on this entry, in the order they were applied. */
  readonly tagIds?: readonly string[]
  /** Why the last fetch failed, so a retry is a decision and not a loop. */
  readonly error?: string
  /** When that failure was recorded (ISO-8601). */
  readonly failedAt?: string
}

/** How long a fetched article body is served before the reader is offered a refetch. */
export interface ReaderCachePolicy {
  /** 0 means "never expires" (the body is kept until the budget evicts it). */
  readonly ttlHours: number
  /** How many entry bodies may be retained at once (oldest evicted first). */
  readonly maxEntries: number
}

/** The default cache policy: a day, and a few hundred articles. */
export const DEFAULT_CACHE_POLICY: ReaderCachePolicy = { ttlHours: 24, maxEntries: 500 }

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
 * How large an EXTRACTED article body may be before it is served but not cached.
 *
 * The subscription budgets above bound feed payloads; this one bounds what an
 * entry's fetched body may add to `state.json`. Measured: a research paper with
 * its figures inlined as base64 (transformer-circuits.pub's emotions paper is a
 * 41 MB HTML document) extracts to tens of megabytes, and the state document is
 * read and rewritten as a whole on every mutation — so a few such articles
 * would turn every reader operation into a multi-megabyte JSON round trip.
 * Past this budget the body is still shown for the session it was fetched in,
 * and the reader is told it was not kept.
 */
export const MAX_CACHED_BODY_CHARS = 4 * 1024 * 1024

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
  /** Whitelist-normalized article markup, ready for the detail view. */
  readonly html: string
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
  /** True when the body was served but deliberately NOT cached (see the budget). */
  readonly tooLarge?: boolean
  /** Why a fetch could not produce a body, when one was attempted. */
  readonly error?: string
}
