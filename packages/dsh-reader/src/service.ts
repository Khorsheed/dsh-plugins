/**
 * The reader service core: owns the fetch, the state document, and the daily
 * refresh. Everything the browser can ask for is implemented here; the Remote
 * class next door is a thin adapter with no logic of its own.
 *
 * Two seams shape the whole module:
 *
 * - **Fetch goes through `ctx.web.fetch`** — the host's sanctioned outbound
 *   HTTP face, which brings public-address resolution, connection pinning, a
 *   byte cap and a timeout. Its provider caps the decoded body at 100 000
 *   characters by default, so a payload that comes back `truncated` is stored
 *   as-is and FLAGGED; nothing here pretends it is a whole document. A
 *   truncated feed cannot be parsed and a truncated page yields half an
 *   article, so the browser half reports "incomplete" rather than guessing.
 * - **The provider follows same-origin redirects only** — a cross-origin hop is
 *   refused with `WEB_REDIRECT_BLOCKED` by design (each new origin must be
 *   validated afresh), and the refusal names the target ORIGIN alone, never the
 *   path it was headed for. So the service re-enters the seam only for a hop it
 *   can reconstruct faithfully — the same host under a different scheme or port
 *   (`http://host/feed` → `https://host/feed`, the common upgrade). A hop that
 *   changes the HOST is reported as such instead of being followed to the bare
 *   origin, which would fetch some other page and file it under the reader's
 *   URL. The final URL becomes the source's canonical URL.
 * - **A failed fetch is still a saved link.** A URL the reader pasted is one
 *   they own; the classification below records WHY there is no readable body
 *   (bot wall, login wall, non-web file, redirect to another site, empty page,
 *   transport error) instead of discarding the URL, and only the transport
 *   failure is retried automatically. Losing the link is worse than a card
 *   that says it can only be opened in a browser.
 *
 * With no filesystem mounted the service stays fully functional in memory
 * (sources still add, refresh and search) and simply does not survive a
 * restart — a composition must never fail because a deployment has no fs.
 *
 * @module @khorsheed/dsh-reader/service
 */
import type { Context } from '@deepseek-ai/cordis'
import {
  MAX_RECENT_ENTRIES,
  ReaderStore,
  ReaderStoreError,
  boundTranslations,
  emptyStateDoc,
  memoryTableChars,
  TRANSLATION_MEMORY_FILE,
} from './store.ts'
import {
  defaultSourceLabel,
  errorMessage,
  isRetryablePreviewFailure,
  linkEntryId,
  DEFAULT_CACHE_POLICY,
  DEFAULT_TRANSLATION_BUDGET_CHARS,
  INLINE_BODY_MAX_CHARS,
  TRANSLATION_STORAGE_VERSION,
  type ReaderAddFailure,
  type ReaderAddOutcome,
  type ReaderAddRefusal,
  type ReaderAnnotationOutcome,
  type ReaderBackfillCandidate,
  type ReaderEntryAnnotation,
  type ReaderEntryBodyView,
  type ReaderBody,
  type ReaderCapabilities,
  type ReaderMutationOutcome,
  type ReaderEntryFetchState,
  type ReaderEntryTranslation,
  type ReaderEntryTranslationView,
  type ReaderPreviewFailure,
  type ReaderPreviewFailureCode,
  type ReaderRecentEntry,
  type ReaderRefreshResult,
  type ReaderSentenceLearn,
  type ReaderSource,
  type ReaderSourceSummary,
  type ReaderStateDoc,
  type ReaderStorageStats,
  type ReaderTag,
  type ReaderTranslationMemoryEntry,
  type ReaderTranslationMemoryTable,
} from './types.ts'
import { delayUntilNext, isCatchUpDue } from './schedule.ts'
import { arxivHtmlUrl } from './arxiv.ts'
import { resolveLink, type LinkResolution, type ResolverFetch } from './link-resolvers.ts'

/**
 * How many entries one automatic backfill run may fetch.
 *
 * A wall of 300 summary-only entries must not turn one refresh into 300
 * requests to other people's servers; the run takes a slice and the next
 * refresh takes the next one.
 */
export const BACKFILL_MAX_PER_RUN = 8

/** How long a FAILED fetch is left alone before it may be retried (6 hours). */
export const BACKFILL_RETRY_MS = 6 * 60 * 60 * 1000

/** Cross-origin redirect hops the service will follow before giving up. */
const MAX_REDIRECT_HOPS = 3

/** Upper bound on summaries handed to the browser in one call. */
const SUMMARY_LIMIT = 500

/** How many sentence hashes one memory-slice read answers (the table never crosses). */
const TRANSLATION_SLICE_LIMIT = 2000

/** How many sentences one write batch may carry (a long article is ~500). */
const TRANSLATION_WRITE_LIMIT = 2000

/** One sentence's source or translation is never longer than a few paragraphs. */
const TRANSLATION_TEXT_LIMIT = 4_000

/** The shape of one `ctx.web.fetch` result, declared structurally. */
interface WebFetchResult {
  readonly url: string
  readonly statusCode: number
  readonly body: { readonly kind: 'html' | 'text'; readonly content: string }
  readonly truncated: boolean
}

/** The probed web seam — structural, so no host package is imported. */
interface WebSeam {
  fetch(request: { readonly url: string }, signal?: AbortSignal): Promise<WebFetchResult>
}

/** The probed side-chat service — structural, never imported. */
interface SideChatSeam {
  openWith(input: {
    contextKey: string
    label: string
    refs: Array<{ label: string; text: string }>
  }): Promise<unknown>
}

/** One fetch attempt's result. */
interface FetchOutcome {
  readonly url: string
  readonly raw: string
  readonly truncated: boolean
}

/** Thrown when a payload cannot become a source. */
class UnsupportedContent extends Error {}

/**
 * Whether a failed fetch is the HTML endpoint's "this paper has no HTML
 * version" — a bare 404 from the content fetch, and nothing else. A refusal
 * (403/401) or a transport error is a fact about the REQUEST, not about which
 * face of the paper exists, and must not silently reroute to another page.
 */
function isNoHtmlVersion(error: unknown): boolean {
  return error instanceof UnsupportedContent && error.message === 'HTTP 404'
}

/**
 * Thrown when the FETCH itself failed — a refused connection, a timeout, a
 * response over the seam's byte cap. Carries the seam's own message: the
 * difference between "the host has no egress" and "that host timed out" is the
 * whole diagnosis, and a bare "failed" tells the reader neither.
 */
export class FetchFailure extends Error {
  /**
   * @param message - the seam's message, verbatim.
   * @param cause - the original error, when there was one.
   */
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'FetchFailure'
  }
}

/**
 * Classify a fetched payload as a feed or an article page.
 *
 * The decision comes from the CONTENT, not from asking the user: nobody pasting
 * a URL can be expected to know whether it is a feed, and guessing wrong used
 * to mean silently creating an empty subscription.
 *
 * @param raw - the decoded payload.
 * @returns which kind of source this payload can become.
 */
export function classifyPayload(raw: string): 'feed' | 'page' {
  const head = raw.slice(0, 512).trimStart().toLowerCase()
  if (head.startsWith('<?xml')) return 'feed'
  if (/^<rss[\s>]/.test(head)) return 'feed'
  if (/^<feed[\s>]/.test(head)) return 'feed'
  if (/^<rdf:rdf[\s>]/.test(head)) return 'feed'
  return 'page'
}

/** The reader service. */
export class ReaderService {
  private readonly store: ReaderStore
  private readonly ctx: Context
  private timer: ReturnType<typeof setTimeout> | undefined
  private disposed = false
  /** The document of record when no filesystem is mounted. */
  private memoryDoc: ReaderStateDoc | undefined

  /**
   * @param ctx - owning context.
   * @param config - optional state-root override.
   */
  constructor(ctx: Context, config: { stateRoot?: string } = {}) {
    this.ctx = ctx
    this.store = new ReaderStore(config)
    ctx.effect(() => () => {
      this.disposed = true
      if (this.timer !== undefined) clearTimeout(this.timer)
    }, 'reader: daily refresh')
    // The store resolves its own root against the deployment (native fs, not
    // the session-fenced `ctx.fs` — see the store's module note), so the
    // schedule can be armed immediately.
    void this.armSchedule()
  }

  /** Capabilities the browser may rely on. */
  async capabilities(): Promise<ReaderCapabilities> {
    const doc = await this.currentDoc()
    return {
      protocolVersion: 1,
      hasFs: this.store.available,
      ...(doc.lastRefreshAt === undefined ? {} : { lastRefreshAt: doc.lastRefreshAt }),
      hasSideChat: this.sideChat() !== undefined,
      ...(doc.refresh.enabled
        ? { nextRefreshAt: new Date(Date.now() + delayUntilNext(new Date(), doc.refresh.timeOfDay)).toISOString() }
        : {}),
    }
  }

  /** The source list, without payloads. */
  async listSources(): Promise<{ sources: ReaderSourceSummary[] }> {
    const doc = await this.currentDoc()
    return { sources: doc.sources.slice(0, SUMMARY_LIMIT).map(summarize) }
  }

  /**
   * Add a source, deciding what it is from what comes back.
   *
   * The one rule this method exists to enforce: **a URL the reader pasted is
   * never thrown away.** A fetch that fails, a bot challenge, a login wall and
   * a PDF all end the same way — a `link` source that exists, carries the
   * reason it has no previewable body, and can be opened, tagged, refreshed
   * manually or deleted. Only a URL that cannot be a source at all
   * (`invalid-url`) or one already present (`duplicate`) is refused.
   *
   * @param request - the pasted URL and an optional label.
   * @returns the decision, or a domain refusal.
   */
  async addSource(request: { url: string; label?: string }): Promise<ReaderAddOutcome | ReaderAddRefusal | ReaderAddFailure> {
    const url = normalizeUrl(request.url)
    if (url === undefined) return 'invalid-url'
    const doc = await this.currentDoc()
    if (doc.sources.some(source => sameTarget(source.url, url))) return 'duplicate'

    const now = new Date().toISOString()
    // Paper links are recognized BEFORE the first page fetch (the ingest
    // proposal's D3): a DOI is a cross-origin redirect this seam refuses by
    // design, and OpenReview is measured unreadable server-side — for those
    // hosts "the ordinary path" is a guaranteed or misleading failure.
    const resolution = await this.resolvePaper(url)
    if (resolution?.kind === 'link-only') {
      return await this.saveLinkOnly(
        { url, ...(request.label === undefined ? {} : { label: request.label }) },
        { code: resolution.code, message: resolution.message, at: now },
        now,
      )
    }
    // What the first fetch aims at: a resolved paper's HTML version, a pasted
    // arXiv link's HTML upgrade, or the URL itself. A resolved candidate whose
    // HTML version is missing (404) falls back to the paper's ABSTRACT page —
    // the API vouched the paper exists — while a pasted link falls back to
    // itself. The resolved URL joins the duplicate check either way.
    const resolvedId = resolution?.kind === 'arxiv' ? resolution.id : undefined
    const upgrade = resolvedId === undefined ? arxivHtmlUrl(url) : `https://arxiv.org/html/${resolvedId}`
    const fallbackUrl = resolvedId === undefined ? url : `https://arxiv.org/abs/${resolvedId}`
    const resolvedFrom = resolvedId === undefined ? undefined : url
    if (upgrade !== undefined && doc.sources.some(source => sameTarget(source.url, upgrade))) return 'duplicate'
    let fetched: FetchOutcome
    try {
      fetched = await this.fetchFollowing(upgrade ?? url)
    } catch (error) {
      if (upgrade !== undefined && isNoHtmlVersion(error)) {
        // The paper has no HTML version (the endpoint answers a bare 404). The
        // fallback goes through the ordinary path: an /abs page is a fine
        // article, a /pdf is the honest not-a-web-page card.
        try {
          fetched = await this.fetchFollowing(fallbackUrl)
        } catch (fallbackError) {
          return await this.saveLinkOnly(
            { url, ...(request.label === undefined ? {} : { label: request.label }), ...(resolvedFrom === undefined ? {} : { resolvedFrom }) },
            classifyFetchFailure(fallbackError, now),
            now,
          )
        }
      } else {
        return await this.saveLinkOnly(
          { url, ...(request.label === undefined ? {} : { label: request.label }), ...(resolvedFrom === undefined ? {} : { resolvedFrom }) },
          classifyFetchFailure(error, now),
          now,
        )
      }
    }

    const feed = classifyPayload(fetched.raw) === 'feed'
    if (!feed) {
      // A page that fetched fine can still have nothing to read: a bot
      // challenge, a login interstitial, an empty shell. Classify BEFORE the
      // payload is stored, so a challenge page never becomes the card's body —
      // which is exactly how an OpenReview PDF link became a card showing
      // somebody's anti-bot page.
      const problem = inspectPreview(fetched.raw, fetched.url, upgrade ?? url)
      if (problem !== undefined) {
        return await this.saveLinkOnly(
          {
            url: fetched.url,
            ...(request.label === undefined ? {} : { label: request.label }),
            ...(resolvedFrom === undefined ? {} : { resolvedFrom }),
          },
          { code: problem.code, message: problem.message, at: now },
          now,
        )
      }
    }

    const label = request.label ?? (resolution?.kind === 'arxiv' ? resolution.title : undefined) ?? defaultSourceLabel(fetched.url)
    const source: ReaderSource = {
      id: `${feed ? 'rss' : 'link'}-${hash(fetched.url)}`,
      kind: feed ? 'rss' : 'link',
      url: fetched.url,
      label,
      enabled: true,
      addedAt: now,
      fetchedAt: now,
      status: 'ok',
      ...(fetched.truncated ? { truncated: true } : {}),
      ...(resolvedFrom === undefined ? {} : { resolvedFrom }),
      raw: fetched.raw,
    }
    await this.commit(current => ({ ...current, sources: [source, ...current.sources] }))
    return { outcome: feed ? 'subscribed' : 'saved-link', kind: source.kind, id: source.id, label }
  }

  /**
   * Persist a link the reader owns even though its body cannot be previewed.
   *
   * Two records, because two consumers ask different questions: the SOURCE
   * carries the failure so the wall can mark the card and the backfill can
   * leave a permanent wall alone, while the ENTRY annotation carries it so
   * `getEntryBody` — the one call the detail view makes — explains itself
   * instead of answering with a blank article.
   *
   * @param request - the final URL, an optional label, and the pasted URL when
   *   this link was resolved to a canonical version.
   * @param failure - the classified reason, with its timestamp.
   * @param now - the commit instant.
   * @returns the add outcome the browser reports.
   */
  private async saveLinkOnly(
    request: { url: string; label?: string; resolvedFrom?: string },
    failure: ReaderPreviewFailure,
    now: string,
  ): Promise<ReaderAddOutcome> {
    const label = request.label ?? defaultSourceLabel(request.url)
    const source: ReaderSource = {
      // A failed fetch has no content to classify, so the source is a `link`:
      // claiming "subscription" for something never read as a feed would be a
      // guess dressed as a fact.
      id: `link-${hash(request.url)}`,
      kind: 'link',
      url: request.url,
      label,
      enabled: true,
      addedAt: now,
      fetchedAt: now,
      status: 'error',
      error: failure.message,
      failure,
      ...(request.resolvedFrom === undefined ? {} : { resolvedFrom: request.resolvedFrom }),
    }
    await this.commit(current => ({ ...current, sources: [source, ...current.sources] }))
    await this.recordFetchFailure(linkEntryId(source.id), failure.message)
    return {
      outcome: 'saved-link',
      kind: 'link',
      id: source.id,
      label,
      failure: { code: failure.code, message: failure.message },
    }
  }

  /**
   * Update a source's mutable fields, or the global refresh time.
   *
   * @param request - the id plus the fields to change.
   * @returns the outcome, or a domain refusal.
   */
  async updateSource(request: {
    id: string
    enabled?: boolean
    label?: string
    url?: string
    timeOfDay?: string
  }): Promise<ReaderMutationOutcome> {
    const doc = await this.currentDoc()
    if (!doc.sources.some(source => source.id === request.id)) return 'not-found'
    if (request.timeOfDay !== undefined && !/^\d{1,2}:\d{2}$/.test(request.timeOfDay)) return 'invalid-time'
    // A URL edit is validated the same way an add is; an empty string means
    // "back to the feed's own title", which the next fetch resolves.
    const url = request.url === undefined || request.url === '' ? undefined : normalizeUrl(request.url)
    if (request.url !== undefined && request.url !== '' && url === undefined) return 'invalid-url'
    await this.commit(current => ({
      ...current,
      sources: current.sources.map(source => source.id === request.id
        ? {
          ...source,
          ...(request.enabled !== undefined ? { enabled: request.enabled } : {}),
          ...(request.label !== undefined && request.label !== '' ? { label: request.label } : {}),
          ...(url !== undefined ? { url, status: 'ok' as const } : {}),
        }
        : source),
      ...(request.timeOfDay !== undefined
        ? { refresh: { ...current.refresh, timeOfDay: request.timeOfDay } }
        : {}),
    }))
    if (request.timeOfDay !== undefined) await this.armSchedule()
    return 'ok'
  }

  /**
   * Remove a source.
   *
   * Its entries' TRANSLATIONS go with it: the entries themselves are unreachable
   * once the source is gone (the recent page disables them), so their exact-fit
   * maps are dead weight. The host never parses feeds, so the caller passes the
   * entry ids it has parsed; a link source's single entry id is derivable here
   * regardless. The cached BODIES stay — the body budget owns their lifetime,
   * unchanged.
   *
   * @param request - the source id, plus the entries the caller knows belong to it.
   * @returns the outcome, or a domain refusal.
   */
  async removeSource(request: { id: string; entryIds?: readonly string[] }): Promise<ReaderMutationOutcome> {
    const doc = await this.currentDoc()
    if (!doc.sources.some(source => source.id === request.id)) return 'not-found'
    const entryIds = new Set(request.entryIds ?? [])
    entryIds.add(linkEntryId(request.id))
    await this.commit(current => {
      let annotations = current.annotations
      const touched: Record<string, ReaderEntryAnnotation> = {}
      let changed = false
      for (const id of entryIds) {
        const annotation = annotations?.[id]
        if (annotation?.translation === undefined) continue
        const { translation: _gone, ...rest } = annotation
        touched[id] = rest
        changed = true
      }
      if (changed) annotations = { ...annotations, ...touched }
      return {
        ...current,
        sources: current.sources.filter(source => source.id !== request.id),
        ...(changed ? { annotations } : {}),
      }
    })
    return 'ok'
  }

  /**
   * Refresh the enabled sources, or the named ones.
   *
   * @param request - optional id list.
   * @returns one result per attempted source.
   */
  async refresh(request: { ids?: string[] } = {}): Promise<{ results: ReaderRefreshResult[] }> {
    const doc = await this.currentDoc()
    const wanted = request.ids === undefined
      ? doc.sources.filter(source => source.enabled)
      : doc.sources.filter(source => request.ids?.includes(source.id) === true)
    const results: ReaderRefreshResult[] = []
    const patches = new Map<string, ReaderSource>()
    const base = new Map(doc.sources.map(source => [source.id, source]))

    for (const source of wanted) {
      const fetchedAt = new Date().toISOString()
      try {
        const fetched = await this.fetchFollowing(source.url)
        // The same classification the add performs: a refresh that comes back
        // with a challenge page or a PDF must not replace a good body with it,
        // and must record why there is nothing to read.
        const problem = source.kind === 'link' ? inspectPreview(fetched.raw, fetched.url, source.url) : undefined
        if (problem !== undefined) {
          const failure: ReaderPreviewFailure = { code: problem.code, message: problem.message, at: fetchedAt }
          patches.set(source.id, {
            // Keep the last-known-good payload: a site that starts refusing us
            // must not erase the article the reader already had.
            ...withoutFailure({ ...source, url: fetched.url, ...(source.raw === undefined ? {} : { raw: source.raw }) }),
            fetchedAt,
            status: 'error',
            error: failure.message,
            failure,
          })
          await this.recordFetchFailure(linkEntryId(source.id), failure.message)
          results.push({ id: source.id, status: 'unavailable', message: failure.message })
          continue
        }
        patches.set(source.id, {
          ...withoutFailure(source),
          url: fetched.url,
          raw: fetched.raw,
          fetchedAt,
          status: 'ok',
          truncated: fetched.truncated,
        })
        results.push({
          id: source.id,
          status: fetched.truncated ? 'truncated' : 'ok',
          ...(fetched.truncated ? { message: "payload hit the fetch seam's size cap" } : {}),
        })
      } catch (error) {
        const failure = classifyFetchFailure(error, fetchedAt)
        // A failed refresh keeps the previous payload (last-known-good) and
        // records why: a transient network error must not erase the reader's
        // copy of an article.
        const previous = base.get(source.id)
        patches.set(source.id, {
          ...(previous ?? source),
          fetchedAt,
          status: 'error',
          error: failure.message,
          failure,
        })
        results.push({
          id: source.id,
          status: error instanceof UnsupportedContent ? 'unavailable' : 'fetch-failed',
          message: failure.message,
        })
      }
    }

    if (patches.size > 0) {
      await this.commit(current => ({
        ...current,
        lastRefreshAt: new Date().toISOString(),
        sources: current.sources.map(source => patches.get(source.id) ?? source),
      }))
    }
    return { results }
  }

  /**
   * Hand back raw payloads for the browser to parse.
   *
   * @param request - the source ids whose payloads are wanted.
   * @returns one body per requested id; an error instead of a payload when
   *   nothing usable is stored.
   */
  async getBodies(request: { ids: string[] }): Promise<{ bodies: ReaderBody[] }> {
    const doc = await this.currentDoc()
    const byId = new Map(doc.sources.map(source => [source.id, source]))
    return {
      bodies: request.ids.map(id => {
        const source = byId.get(id)
        if (source === undefined) return { id, error: 'not-found' }
        // A saved link's single entry: the captured title/excerpt join the
        // answer, so the card can show the paper's own name even after the
        // payload's eviction. Feed sources never join — their entries' titles
        // are already the publisher's.
        const meta = source.kind === 'link' ? doc.annotations?.[linkEntryId(source.id)] : undefined
        const carried = {
          ...(meta?.title === undefined ? {} : { title: meta.title }),
          ...(meta?.excerpt === undefined ? {} : { excerpt: meta.excerpt }),
        }
        if (source.raw === undefined) return { id, error: source.error ?? 'no payload stored yet', ...carried }
        return { id, raw: source.raw, ...(source.truncated === true ? { truncated: true } : {}), ...carried }
      }),
    }
  }

  /**
   * Pass a ref block to the side-chat service when one is composed.
   *
   * @param request - the target context, its label, and the ref text.
   * @returns `'ok'`, or `'unavailable'` when no side chat is mounted.
   */
  async quoteToSideChat(request: {
    contextKey: string
    label: string
    text: string
  }): Promise<'ok' | 'unavailable'> {
    const sideChat = this.sideChat()
    if (sideChat === undefined) return 'unavailable'
    try {
      await sideChat.openWith({
        contextKey: request.contextKey,
        label: request.label,
        refs: [{ label: request.label, text: request.text }],
      })
      return 'ok'
    } catch {
      return 'unavailable'
    }
  }

  /* -------------------------------------------------- entry bodies and tags */

  /**
   * The body the detail view should render for one entry, if any.
   *
   * The order is the whole contract: a fresh cached fetch wins (it is full text
   * the reader already paid for), then the feed's own payload, and only when
   * neither exists does the view offer to fetch. A STALE cache entry reports
   * `fresh: false` and no html — the detail view then offers the fetch again
   * rather than quietly serving yesterday's copy.
   *
   * @param request - the entry and the payload the feed gave for it.
   * @returns what there is to show, and whether a fetch is worth offering.
   */
  async getEntryBody(request: {
    entryId: string
    url: string
    feedHtml?: string
  }): Promise<ReaderEntryBodyView> {
    const doc = await this.currentDoc()
    const cached = doc.annotations?.[request.entryId]?.body
    if (cached !== undefined) {
      const fresh = isFresh(cached.expiresAt)
      // A large body lives in `bodies/`; a missing file means no cache, and the
      // view then offers the fetch rather than pretending to have the text.
      const html = cached.file === undefined
        ? cached.html
        : (fresh && cached.url === request.url ? this.store.readBody(cached.file) : undefined)
      return {
        entryId: request.entryId,
        cached: true,
        fresh,
        fromFeed: false,
        fetchedAt: cached.fetchedAt,
        ...(cached.truncated === true ? { truncated: true } : {}),
        ...(cached.scriptFigures === undefined ? {} : { scriptFigures: cached.scriptFigures }),
        ...(html === undefined || !fresh || cached.url !== request.url ? {} : { html }),
      }
    }
    if (request.feedHtml !== undefined && request.feedHtml.length > 0) {
      return { entryId: request.entryId, cached: false, fresh: true, fromFeed: true, html: request.feedHtml }
    }
    const failure = doc.annotations?.[request.entryId]
    return {
      entryId: request.entryId,
      cached: false,
      fresh: true,
      fromFeed: false,
      ...(failure?.error === undefined ? {} : { error: failure.error }),
    }
  }

  /**
   * Fetch one entry's article and hand the raw HTML to the browser.
   *
   * The HOST does not extract: extraction needs a DOM, and this runtime has no
   * XML/HTML parser at all (the same reason feed parsing lives in the browser
   * half). So this verb is the network half only — it returns what came back,
   * and `storeEntryBody` persists what the browser made of it.
   *
   * Fetching here is deliberately NOT automatic on refresh: doing it for every
   * summary-only entry would make this a crawler of other people's sites, which
   * the design refuses. One entry, one fetch, on the reader's request.
   *
   * @param request - the entry and its article URL.
   * @returns the raw payload, or why there is none.
   */
  async fetchEntryBody(request: {
    entryId: string
    url: string
  }): Promise<{ entryId: string; url?: string; raw?: string; truncated?: boolean; error?: string }> {
    const url = normalizeUrl(request.url)
    if (url === undefined) {
      await this.recordFetchFailure(request.entryId, 'invalid-url')
      return { entryId: request.entryId, error: 'invalid-url' }
    }
    await this.markFetching(request.entryId)
    try {
      const fetched = await this.fetchFollowing(url)
      // The raw payload is written to disk BEFORE the caller gets it, so a
      // browser that goes away mid-request does not cost the reader the
      // download: the next visit finds the stored payload and extracts it.
      const rawFile = await this.storeRaw(request.entryId, fetched.raw, fetched.url, fetched.truncated)
      return {
        entryId: request.entryId,
        url: fetched.url,
        raw: fetched.raw,
        ...(rawFile === undefined ? {} : { rawFile }),
        ...(fetched.truncated ? { truncated: true } : {}),
      }
    } catch (error) {
      const failure = classifyFetchFailure(error, new Date().toISOString())
      await this.recordFetchFailure(request.entryId, failure.message, failure.code)
      return { entryId: request.entryId, error: failure.message }
    }
  }

  /**
   * Which entries have a body, a stored raw payload, or a recorded failure.
   *
   * The wall needs this per ENTRY (entries come from the browser's parse of a
   * feed), so it cannot ride the source summaries. `raw` means "fetched, not yet
   * extracted" — the browser half turns those into bodies on its next load.
   *
   * @param request - the entry ids the caller is showing.
   * @returns one state per requested id.
   */
  async entryFetchStates(request: { entryIds: readonly string[] }): Promise<{ states: Record<string, ReaderEntryFetchState> }> {
    const doc = await this.currentDoc()
    const states: Record<string, ReaderEntryFetchState> = {}
    const now = Date.now()
    for (const entryId of request.entryIds) {
      const annotation = doc.annotations?.[entryId]
      if (annotation?.body !== undefined && isFresh(annotation.body.expiresAt)) {
        states[entryId] = { state: 'ready', ...(annotation.body.fetchedAt === undefined ? {} : { at: annotation.body.fetchedAt }) }
        continue
      }
      const fetch = annotation?.fetch
      if (fetch?.state === 'raw') {
        states[entryId] = { state: 'raw', at: fetch.at }
        continue
      }
      if (fetch?.state === 'fetching' && isRecent(fetch.at, now, FETCH_STALE_MS)) {
        states[entryId] = { state: 'fetching', at: fetch.at }
        continue
      }
      if (annotation?.error !== undefined && annotation.failedAt !== undefined) {
        states[entryId] = {
          state: 'failed',
          at: annotation.failedAt,
          message: annotation.error,
          ...(annotation.failureCode === undefined ? {} : { code: annotation.failureCode }),
        }
        continue
      }
      states[entryId] = { state: 'none' }
    }
    return { states }
  }

  /**
   * Hand back a stored raw payload so the browser can extract it.
   *
   * @param request - the entry whose payload is wanted.
   * @returns the payload, or why there is none.
   */
  async getRawBody(request: { entryId: string }): Promise<{ entryId: string; raw?: string; url?: string; truncated?: boolean; error?: string }> {
    const doc = await this.currentDoc()
    const annotation = doc.annotations?.[request.entryId]
    const file = annotation?.fetch?.state === 'raw' ? annotation.fetch.rawFile : undefined
    if (file === undefined) return { entryId: request.entryId, error: 'no stored payload' }
    const raw = this.store.readBody(file)
    if (raw === undefined) return { entryId: request.entryId, error: 'stored payload is gone' }
    return {
      entryId: request.entryId,
      raw,
      ...(annotation?.fetch?.url === undefined ? {} : { url: annotation.fetch.url }),
      ...(annotation?.fetch?.truncated === true ? { truncated: true } : {}),
    }
  }

  /** Record that a fetch is in flight, so a wall reopened later can say so. */
  private async markFetching(entryId: string): Promise<void> {
    await this.commit(current => ({
      ...current,
      annotations: { ...current.annotations, [entryId]: { ...current.annotations?.[entryId], fetch: { state: 'fetching', at: new Date().toISOString() } } },
    }))
  }

  /**
   * Store one raw payload for later extraction.
   *
   * @param entryId - the entry it belongs to.
   * @param raw - the payload.
   * @returns the file name, or `undefined` when the deployment has no fs.
   */
  private async storeRaw(entryId: string, raw: string, url: string, truncated: boolean): Promise<string | undefined> {
    if (!this.store.available) return undefined
    const file = this.store.writeBody(`${entryId}#raw`, raw)
    await this.commit(current => ({
      ...current,
      annotations: {
        ...current.annotations,
        [entryId]: {
          ...current.annotations?.[entryId],
          fetch: {
            state: 'raw',
            at: new Date().toISOString(),
            rawFile: file,
            chars: raw.length,
            // The URL and the cap flag travel with the payload: the extraction
            // pass needs both, and it runs in a browser that never saw the fetch.
            url,
            ...(truncated ? { truncated: true } : {}),
          },
        },
      },
    }))
    return file
  }

  /**
   * Cache the markup the browser extracted for one entry.
   *
   * The deadline is computed here, not on the client, so the policy has exactly
   * one owner (this service's document) — a client that guessed the TTL would
   * be a second implementation of it.
   *
   * @param request - the entry, the markup, and the URL it came from.
   * @returns the stored view.
   */
  async storeEntryBody(request: {
    entryId: string
    url: string
    html: string
    truncated?: boolean
    scriptFigures?: number
    /** The caller's hash of `html`; the entry's translation map dies with a body it no longer matches. */
    bodyHash?: string
    /** The article's own title, as the extraction read it — a saved link's card upgrade. */
    title?: string
    /** A short excerpt (abstract / first paragraph), with the title. */
    excerpt?: string
  }): Promise<ReaderEntryBodyView> {
    const html = request.html.trim()
    if (html.length === 0) {
      await this.recordFetchFailure(request.entryId, 'empty extraction')
      return { entryId: request.entryId, cached: false, fresh: false, fromFeed: false, error: 'empty extraction' }
    }
    const doc = await this.currentDoc()
    const ttlHours = doc.cache?.ttlHours ?? DEFAULT_CACHE_POLICY.ttlHours
    const now = new Date()
    // A large body goes to its own file and the document keeps the file name and
    // its size: the cache policy (ttl, maxEntries) then governs it exactly like
    // an inline body, and `state.json` stays small.
    const sidecar = html.length > INLINE_BODY_MAX_CHARS ? this.store.writeBody(request.entryId, html) : undefined
    const body: NonNullable<ReaderEntryAnnotation['body']> = {
      ...(sidecar === undefined ? { html } : { file: sidecar, chars: html.length }),
      fetchedAt: now.toISOString(),
      // 0 = keep until the budget evicts it; a far-future date keeps the
      // freshness check a single comparison instead of a special case.
      expiresAt: ttlHours === 0
        ? new Date(now.getTime() + 100 * 365 * 24 * 60 * 60 * 1000).toISOString()
        : new Date(now.getTime() + ttlHours * 60 * 60 * 1000).toISOString(),
      url: request.url,
      ...(request.truncated === true ? { truncated: true } : {}),
      ...(request.scriptFigures === undefined || request.scriptFigures === 0
        ? {}
        : { scriptFigures: request.scriptFigures }),
    }
    await this.commit(current => {
      const existing = current.annotations?.[request.entryId]
      const tagIds = existing?.tagIds
      // The entry's translation map rides the body's identity: a stored body
      // whose hash no longer matches makes the map dead weight, and it goes in
      // the same commit (unchanged sentences still hit the GLOBAL memory). A
      // re-store of the SAME body keeps it.
      const translation = existing?.translation !== undefined
        && request.bodyHash !== undefined
        && existing.translation.bodyHash === request.bodyHash
        ? existing.translation
        : undefined
      // The article's own title/excerpt ride the same write: supplied beats
      // stored, stored beats absent — a store that carries no meta keeps the
      // captured values.
      const title = metaText(request.title, 300) ?? existing?.title
      const excerpt = metaText(request.excerpt, 1000) ?? existing?.excerpt
      // The stored raw payload has been consumed: the fetch record goes with it,
      // so the wall now reads `ready` from the body alone.
      return {
        ...current,
        annotations: {
          ...current.annotations,
          [request.entryId]: {
            body,
            ...(tagIds === undefined ? {} : { tagIds }),
            ...(translation === undefined ? {} : { translation }),
            ...(title === undefined ? {} : { title }),
            ...(excerpt === undefined ? {} : { excerpt }),
          },
        },
      }
    })
    return {
      entryId: request.entryId,
      cached: true,
      fresh: true,
      fromFeed: false,
      html,
      fetchedAt: body.fetchedAt,
      ...(body.truncated === true ? { truncated: true } : {}),
      ...(body.scriptFigures === undefined ? {} : { scriptFigures: body.scriptFigures }),
    }
  }

  /**
   * Which entries still need their full text, and which may be retried.
   *
   * The host is the only side that can answer this: it holds the cache, the
   * recorded failures and the policy. A failure is retried only after
   * `BACKFILL_RETRY_MS` — an entry whose publisher refuses us must not be
   * hammered once per refresh, which would make this a crawler with a grudge.
   *
   * @param request - the entries the caller is looking at (id, url, label) and
   *   whether the caller already has full text for them (the feed's own payload).
   * @returns the candidates, capped so one refresh cannot start a stampede.
   */
  async listBackfillCandidates(request: {
    entries: readonly { entryId: string; url: string; label: string; hasBody: boolean }[]
    limit?: number
  }): Promise<{ candidates: ReaderBackfillCandidate[] }> {
    const doc = await this.currentDoc()
    const limit = Math.max(1, Math.min(request.limit ?? BACKFILL_MAX_PER_RUN, BACKFILL_MAX_PER_RUN))
    const candidates: ReaderBackfillCandidate[] = []
    const now = Date.now()
    for (const entry of request.entries) {
      if (entry.url === '') continue
      if (entry.hasBody) continue
      // A reason that will answer the same way forever — a bot wall, a login
      // wall, a PDF, a 404 — is not retried on a timer: that is a crawler with
      // a grudge, not a reader. The manual refresh in the subscription page
      // stays available, and it clears the recorded failure on success. The
      // match is restricted to `link` sources: a saved link's single entry
      // carries the source's own URL, and a same-URL feed entry must not
      // inherit somebody else's verdict.
      const source = doc.sources.find(item => item.kind === 'link' && sameTarget(item.url, entry.url))
      if (source?.failure !== undefined && !isRetryablePreviewFailure(source.failure.code)) continue
      const annotation = doc.annotations?.[entry.entryId]
      if (annotation?.body !== undefined && isFresh(annotation.body.expiresAt)) continue
      if (annotation?.failedAt !== undefined) {
        const failedAt = new Date(annotation.failedAt).getTime()
        if (Number.isFinite(failedAt) && now - failedAt < BACKFILL_RETRY_MS) continue
      }
      candidates.push({
        entryId: entry.entryId,
        url: entry.url,
        label: entry.label,
        ...(annotation?.error === undefined ? {} : { lastError: annotation.error }),
      })
      if (candidates.length >= limit) break
    }
    return { candidates }
  }

  /* -------------------------------------------------- translation memory */

  /**
   * One entry's exact-fit translation record, with its segment map resolved.
   *
   * A record from an older storage schema, or one whose sidecar file is gone,
   * reads as absent — the caller falls back to the global memory, and the stale
   * record is carried out by the next write or budget pass (lazy, never wiped).
   *
   * @param request - the entry.
   * @returns the record, or nothing usable.
   */
  async getEntryTranslation(request: { entryId: string }): Promise<{ translation?: ReaderEntryTranslationView }> {
    const doc = await this.currentDoc()
    const record = doc.annotations?.[request.entryId]?.translation
    if (record === undefined || record.version !== TRANSLATION_STORAGE_VERSION) return {}
    const segments = record.segments !== undefined
      ? { ...record.segments }
      : record.file === undefined
        ? undefined
        : readSegmentsFile(this.store.readBody(record.file))
    if (segments === undefined) return {}
    return {
      translation: {
        pair: record.pair,
        bodyHash: record.bodyHash,
        segments,
      },
    }
  }

  /**
   * The translations for exactly the sentences asked about, of one pair.
   *
   * The client hashes the body's sentences itself, so the slice is precise and
   * the whole table never crosses the wire. Reads do not rewrite the file:
   * the LRU stamp moves when the sentence next serves (the client's batched
   * report of what it reused), not when a list of hashes arrives.
   *
   * @param request - the pair label and the sentence hashes wanted.
   * @returns hash → translation for the hits.
   */
  async getSentenceTranslations(request: { pair: string; hashes: readonly string[] }): Promise<{ translations: Record<string, string> }> {
    const memory = await this.translationMemory()
    const translations: Record<string, string> = {}
    for (const hash of request.hashes.slice(0, TRANSLATION_SLICE_LIMIT)) {
      if (typeof hash !== 'string' || hash.length === 0) continue
      const hit = memory[`${request.pair}:${hash}`]
      if (hit !== undefined) translations[hash] = hit.target
    }
    return { translations }
  }

  /**
   * Persist what one translation run produced, in one batch.
   *
   * `entries` are the sentences the model just translated: they upsert into the
   * global memory AND the entry's exact-fit map. `recalled` are the sentences
   * the run was served from memory: their lastUsedAt bumps (that is what makes
   * the budget's LRU a use-clock rather than a write-clock), and they join the
   * entry map too, so the map stays the complete record of this body. When
   * `entryId` + `bodyHash` are present the entry map is REWRITTEN to the run's
   * full sentence set — the run saw the whole body, so a merge would only
   * preserve sentences the current body no longer has.
   *
   * @param request - the pair, the learned and recalled sentences, and the
   *   entry identity when this run was an article's.
   * @returns how many sentences were newly learned.
   */
  async rememberSentences(request: {
    pair: string
    entries: readonly ReaderSentenceLearn[]
    recalled?: readonly ReaderSentenceLearn[]
    entryId?: string
    bodyHash?: string
  }): Promise<{ stored: number }> {
    const pair = request.pair.trim()
    if (pair.length === 0) return { stored: 0 }
    const learned = normalizeLearns(request.entries)
    const recalled = normalizeLearns(request.recalled ?? [])
    const now = new Date().toISOString()
    const doc = await this.currentDoc()
    const budget = doc.cache?.translationBudgetChars ?? DEFAULT_TRANSLATION_BUDGET_CHARS

    // The global table: upsert the learned, bump the recalled.
    const memory = { ...await this.translationMemory() }
    let memoryChanged = false
    for (const learn of [...learned, ...recalled]) {
      memory[`${pair}:${learn.hash}`] = { source: learn.source, target: learn.target, lastUsedAt: now }
      memoryChanged = true
    }

    // The entry map, when this run was an article's: the complete sentence set,
    // sidecarred when it outgrows the inline limit — exactly like bodies.
    let entryWrite: { entryId: string; translation: ReaderEntryTranslation } | undefined
    if (request.entryId !== undefined && request.bodyHash !== undefined) {
      const segments: Record<string, string> = {}
      for (const learn of [...learned, ...recalled]) segments[learn.hash] = learn.target
      const entryId = request.entryId
      let translation: ReaderEntryTranslation = {
        version: TRANSLATION_STORAGE_VERSION,
        pair,
        bodyHash: request.bodyHash,
        translatedAt: doc.annotations?.[entryId]?.translation?.translatedAt ?? now,
        lastUsedAt: now,
      }
      const serialized = JSON.stringify(segments)
      if (serialized.length > INLINE_BODY_MAX_CHARS) {
        translation = { ...translation, file: this.store.writeBody(`${entryId}#translation`, serialized), chars: serialized.length }
      } else {
        translation = { ...translation, segments, chars: serialized.length }
      }
      entryWrite = { entryId, translation }
    }

    // The budget eviction runs against the document just read: its outcome (the
    // final table + the evicted entry ids) is what the commit applies, so the
    // memory file on disk always matches the manifest that names it.
    const bounded = boundTranslations(memory, {
      ...(doc.annotations ?? {}),
      ...(entryWrite === undefined ? {} : { [entryWrite.entryId]: { ...doc.annotations?.[entryWrite.entryId], translation: entryWrite.translation } }),
    }, budget)
    if (bounded.evictedMemoryKeys.length > 0) memoryChanged = true
    if (memoryChanged) {
      // File before document — the same order `storeRaw` uses — so a crash
      // leaves an unreferenced file for the next prune, never a dangling name.
      const table: ReaderTranslationMemoryTable = { version: TRANSLATION_STORAGE_VERSION, entries: bounded.memory }
      this.store.writeNamedBody(TRANSLATION_MEMORY_FILE, JSON.stringify(table))
    }
    await this.commit(current => {
      let annotations: Record<string, ReaderEntryAnnotation> | undefined
      if (entryWrite !== undefined || bounded.evictedEntryIds.length > 0) {
        annotations = { ...current.annotations }
        if (entryWrite !== undefined) {
          annotations[entryWrite.entryId] = { ...annotations[entryWrite.entryId], translation: entryWrite.translation }
        }
        for (const id of bounded.evictedEntryIds) {
          const annotation = annotations[id]
          if (annotation?.translation === undefined) continue
          const { translation: _evicted, ...rest } = annotation
          annotations[id] = rest
        }
      }
      return {
        ...current,
        ...(annotations === undefined ? {} : { annotations }),
        ...(memoryChanged
          ? {
            translationMemory: {
              version: TRANSLATION_STORAGE_VERSION,
              file: TRANSLATION_MEMORY_FILE,
              entries: Object.keys(bounded.memory).length,
              chars: memoryTableChars(bounded.memory),
              updatedAt: now,
            },
          }
          : {}),
      }
    })
    return { stored: learned.length }
  }

  /**
   * How much the two caches currently hold, aggregated on the host.
   *
   * The tables themselves never cross the wire for a settings readout: counts
   * and characters only. The characters are the store's own accounting unit —
   * the same numbers the budgets bound.
   *
   * @returns per-tier usage.
   */
  async getStorageStats(): Promise<ReaderStorageStats> {
    const doc = await this.currentDoc()
    let bodyEntries = 0
    let bodyChars = 0
    let translationEntries = 0
    let translationChars = 0
    for (const annotation of Object.values(doc.annotations ?? {})) {
      const body = annotation.body
      if (body !== undefined) {
        bodyEntries += 1
        bodyChars += body.chars ?? (body as { html?: string }).html?.length ?? 0
      }
      const translation = annotation.translation
      if (translation !== undefined) {
        translationEntries += 1
        translationChars += translation.chars ?? Object.entries(translation.segments ?? {})
          .reduce((sum, [hash, target]) => sum + hash.length + target.length + 2, 0)
      }
    }
    return {
      bodies: { entries: bodyEntries, chars: bodyChars },
      translations: {
        entries: translationEntries,
        chars: translationChars,
        memoryEntries: doc.translationMemory?.entries ?? 0,
        memoryChars: doc.translationMemory?.chars ?? 0,
      },
    }
  }

  /**
   * Forget every translation: the global sentence memory AND every entry map.
   *
   * The manage page's one gesture for it, after its own confirm. Bodies, tags,
   * the recent list and the sources are untouched — the reader is clearing a
   * derived cache, not their library. The commit's own `pruneBodies` sweep
   * takes the files once the document no longer names them.
   *
   * @returns how many entry maps went, and whether the memory table went.
   */
  async clearTranslations(): Promise<{ clearedEntries: number; clearedMemory: boolean }> {
    const doc = await this.currentDoc()
    const clearedEntries = Object.values(doc.annotations ?? {}).filter(annotation => annotation.translation !== undefined).length
    const clearedMemory = doc.translationMemory !== undefined
    if (clearedEntries === 0 && !clearedMemory) return { clearedEntries: 0, clearedMemory: false }
    await this.commit(current => {
      const annotations: Record<string, ReaderEntryAnnotation> = {}
      for (const [id, annotation] of Object.entries(current.annotations ?? {})) {
        if (annotation.translation === undefined) { annotations[id] = annotation; continue }
        const { translation: _cleared, ...rest } = annotation
        annotations[id] = rest
      }
      const { translationMemory: _dropped, ...rest } = current
      return { ...rest, annotations }
    })
    return { clearedEntries, clearedMemory }
  }

  /**
   * The global sentence memory's table, from its sidecar file.
   *
   * Read per call, not cached: the file is the truth, and the service's own
   * commits are the only writes — a cache keyed on the manifest would save a
   * few MB of JSON parsing per translation run at the price of a coherence
   * story. An absent, unreadable, or stale-version file reads as empty (the
   * lazy half of the schema version).
   */
  private async translationMemory(): Promise<Record<string, ReaderTranslationMemoryEntry>> {
    const doc = await this.currentDoc()
    const manifest = doc.translationMemory
    if (manifest === undefined) return {}
    const raw = this.store.readBody(manifest.file)
    if (raw === undefined) return {}
    try {
      const table = JSON.parse(raw) as ReaderTranslationMemoryTable
      if (table.version !== TRANSLATION_STORAGE_VERSION || typeof table.entries !== 'object' || table.entries === null) return {}
      return { ...table.entries }
    } catch {
      return {}
    }
  }


  /** The tag vocabulary plus which entry ids carry each tag. */
  async listTags(): Promise<{ tags: ReaderTag[]; counts: Record<string, number> }> {
    const doc = await this.currentDoc()
    const tags = Object.values(doc.tags ?? {}).sort((a, b) => a.name.localeCompare(b.name))
    const counts: Record<string, number> = {}
    for (const annotation of Object.values(doc.annotations ?? {})) {
      for (const id of annotation.tagIds ?? []) counts[id] = (counts[id] ?? 0) + 1
    }
    return { tags, counts }
  }

  /**
   * Create a tag, or return the existing one with the same name.
   *
   * Names are matched case-insensitively on purpose: "AI" and "ai" becoming two
   * tags is what makes a tag system useless for filtering, and the reader
   * cannot be expected to remember which spelling they used.
   *
   * @param request - the name to create or find.
   * @returns the tag id, or a refusal.
   */
  async createTag(request: { name: string }): Promise<ReaderTag | ReaderAnnotationOutcome> {
    const name = request.name.trim().slice(0, 40)
    if (name.length === 0) return 'empty'
    const doc = await this.currentDoc()
    const existing = Object.values(doc.tags ?? {}).find(tag => tag.name.toLowerCase() === name.toLowerCase())
    if (existing !== undefined) return existing
    const tag: ReaderTag = { id: `tag-${hash(name.toLowerCase())}`, name, createdAt: new Date().toISOString() }
    await this.commit(current => ({ ...current, tags: { ...current.tags, [tag.id]: tag } }))
    return tag
  }

  /** Rename a tag (its id, and therefore every entry that carries it, is untouched). */
  async renameTag(request: { id: string; name: string }): Promise<ReaderAnnotationOutcome> {
    const name = request.name.trim().slice(0, 40)
    if (name.length === 0) return 'empty'
    const doc = await this.currentDoc()
    if (doc.tags?.[request.id] === undefined) return 'not-found'
    await this.commit(current => ({
      ...current,
      tags: { ...current.tags, [request.id]: { ...current.tags?.[request.id], id: request.id, name } as ReaderTag },
    }))
    return 'ok'
  }

  /** Drop a tag from the vocabulary and from every entry that carried it. */
  async deleteTag(request: { id: string }): Promise<ReaderAnnotationOutcome> {
    const doc = await this.currentDoc()
    if (doc.tags?.[request.id] === undefined) return 'not-found'
    await this.commit(current => {
      const annotations: Record<string, ReaderEntryAnnotation> = {}
      for (const [entryId, entry] of Object.entries(current.annotations ?? {})) {
        const tagIds = (entry.tagIds ?? []).filter(id => id !== request.id)
        annotations[entryId] = tagIds.length > 0
          ? { ...entry, tagIds }
          : withoutTags(entry)
      }
      const { [request.id]: _removed, ...tags } = current.tags ?? {}
      return { ...current, tags, annotations: cleanupAnnotations(annotations) }
    })
    return 'ok'
  }

  /** Add or remove one tag on one entry. */
  async tagEntry(request: { entryId: string; tagId: string; on: boolean }): Promise<ReaderAnnotationOutcome> {
    const doc = await this.currentDoc()
    if (doc.tags?.[request.tagId] === undefined) return 'not-found'
    await this.commit(current => {
      const entry = current.annotations?.[request.entryId] ?? {}
      const ids = new Set(entry.tagIds ?? [])
      if (request.on) ids.add(request.tagId)
      else ids.delete(request.tagId)
      const tagIds = [...ids]
      return {
        ...current,
        annotations: {
          ...current.annotations,
          [request.entryId]: tagIds.length > 0 ? { ...entry, tagIds } : withoutTags(entry),
        },
      }
    })
    return 'ok'
  }

  /** The tags on one entry. */
  async entryTags(request: { entryId: string }): Promise<{ tags: ReaderTag[] }> {
    const doc = await this.currentDoc()
    const ids = new Set(doc.annotations?.[request.entryId]?.tagIds ?? [])
    return { tags: Object.values(doc.tags ?? {}).filter(tag => ids.has(tag.id)) }
  }

  /** How long a fetched body is served, and how large the translation store may grow. */
  async getCachePolicy(): Promise<{ ttlHours: number; maxEntries: number; translationBudgetChars: number }> {
    const doc = await this.currentDoc()
    return {
      ttlHours: doc.cache?.ttlHours ?? DEFAULT_CACHE_POLICY.ttlHours,
      maxEntries: doc.cache?.maxEntries ?? DEFAULT_CACHE_POLICY.maxEntries,
      translationBudgetChars: doc.cache?.translationBudgetChars ?? DEFAULT_TRANSLATION_BUDGET_CHARS,
    }
  }

  /** Change the cache policy (`ttlHours: 0` = keep until the budget evicts). */
  async setCachePolicy(request: { ttlHours: number; maxEntries?: number; translationBudgetChars?: number }): Promise<ReaderAnnotationOutcome> {
    if (!Number.isFinite(request.ttlHours) || request.ttlHours < 0 || request.ttlHours > 24 * 90) return 'invalid'
    if (request.translationBudgetChars !== undefined
      && (!Number.isFinite(request.translationBudgetChars) || request.translationBudgetChars <= 0 || request.translationBudgetChars > 1024 * 1024 * 1024)) {
      return 'invalid'
    }
    const doc = await this.currentDoc()
    const maxEntries = request.maxEntries ?? doc.cache?.maxEntries ?? DEFAULT_CACHE_POLICY.maxEntries
    const translationBudgetChars = request.translationBudgetChars ?? doc.cache?.translationBudgetChars ?? DEFAULT_TRANSLATION_BUDGET_CHARS
    await this.commit(current => ({ ...current, cache: { ttlHours: request.ttlHours, maxEntries, translationBudgetChars } }))
    return 'ok'
  }

  /** Drop tags no entry references any more. */
  async pruneTags(): Promise<{ removed: number }> {
    const doc = await this.currentDoc()
    const used = new Set(Object.values(doc.annotations ?? {}).flatMap(entry => entry.tagIds ?? []))
    const kept: Record<string, ReaderTag> = {}
    let removed = 0
    for (const [id, tag] of Object.entries(doc.tags ?? {})) {
      if (used.has(id)) kept[id] = tag
      else removed += 1
    }
    if (removed > 0) await this.commit(current => ({ ...current, tags: kept }))
    return { removed }
  }

  /**
   * Record that the reader opened one entry.
   *
   * One row per ENTRY (not per source): the question the recent page answers is
   * about the articles that were read, and an RSS entry has no source-level
   * page to point at. Reopening an entry moves it to the top rather than
   * duplicating it, and the list is capped — see `MAX_RECENT_ENTRIES`.
   *
   * The write is deliberately not batched: opening is a human-paced gesture,
   * and a queue that had not flushed yet would lose the item on a restart.
   *
   * @param request - the entry, its source, and what to call it in the list.
   * @returns how many entries the list holds afterwards.
   */
  async recordRead(request: {
    entryId: string
    sourceId: string
    title: string
    url?: string
  }): Promise<{ entries: number }> {
    const entryId = request.entryId.trim()
    const sourceId = request.sourceId.trim()
    if (entryId.length === 0 || sourceId.length === 0) {
      return { entries: (await this.currentDoc()).recent?.length ?? 0 }
    }
    const title = request.title.trim().slice(0, 300)
    const url = request.url === undefined || request.url.length === 0 ? undefined : request.url
    const readAt = new Date().toISOString()
    await this.commit(current => {
      const kept = (current.recent ?? []).filter(item => item.entryId !== entryId)
      return {
        ...current,
        recent: [{ entryId, sourceId, title, ...(url === undefined ? {} : { url }), readAt }, ...kept]
          .slice(0, MAX_RECENT_ENTRIES),
      }
    })
    return { entries: (await this.currentDoc()).recent?.length ?? 0 }
  }

  /**
   * The entries the reader opened, newest first.
   *
   * @returns the recent list as the page renders it.
   */
  async listRecent(): Promise<{ entries: ReaderRecentEntry[] }> {
    const doc = await this.currentDoc()
    return { entries: [...(doc.recent ?? [])] }
  }

  /**
   * Forget every recent entry.
   *
   * The reader's own list is theirs to erase: a "recently read" page that can
   * only grow is one nobody wants to open in company.
   *
   * @returns how many entries were dropped.
   */
  async clearRecent(): Promise<{ removed: number }> {
    const doc = await this.currentDoc()
    const removed = doc.recent?.length ?? 0
    if (removed > 0) await this.commit(current => ({ ...current, recent: [] }))
    return { removed }
  }

  /**
   * Record why a fetch produced nothing, so the retry is a decision.
   *
   * The failure also carries its classified CODE when there is one: the wall's
   * card button explains a red state with the same sentence the detail view
   * uses, instead of the seam's raw words.
   *
   * @param entryId - the entry.
   * @param error - the message to keep, verbatim.
   * @param code - the classified reason, when one was derived.
   */
  private async recordFetchFailure(entryId: string, error: string, code?: ReaderPreviewFailureCode): Promise<void> {
    await this.commit(current => {
      const { fetch: _cleared, ...rest } = current.annotations?.[entryId] ?? {}
      return {
        ...current,
        annotations: {
          ...current.annotations,
          [entryId]: {
            ...rest,
            error,
            ...(code === undefined ? {} : { failureCode: code }),
            failedAt: new Date().toISOString(),
          },
        },
      }
    })
  }

  /* --------------------------------------------------------------- internals */

  /**
   * Ask the link-resolver table what a pasted URL names.
   *
   * Runs on the ADD path only, and never breaks it: the table's own failure
   * (a resolver bug, an answer shape nobody planned for) reads as "no answer"
   * and the ordinary fetch path takes over. Resolvers that need the network
   * ride the same sanctioned seam as every fetch here; with no seam mounted
   * their fetch throws, they answer `null`, and the ordinary path reports the
   * missing capability — while a resolver that needs no network (OpenReview's
   * known-unreadable verdict) still answers.
   */
  private async resolvePaper(url: string): Promise<LinkResolution | null> {
    const web = this.web()
    const fetch: ResolverFetch = async target => {
      if (web === undefined) throw new UnsupportedContent('no web capability is mounted')
      const result = await web.fetch({ url: target })
      return { statusCode: result.statusCode, body: result.body.content }
    }
    try {
      return await resolveLink(url, fetch)
    } catch {
      return null
    }
  }

  /** The probed web seam (no host import, no boot-time dependency). */
  private web(): WebSeam | undefined {
    return this.ctx.get('web') as WebSeam | undefined
  }

  /** The probed side-chat service. */
  private sideChat(): SideChatSeam | undefined {
    return this.ctx.get('sideChat') as SideChatSeam | undefined
  }

  /**
   * The document of record: from disk when one is mounted, else the in-memory
   * copy the service has been accumulating.
   */
  private async currentDoc(): Promise<ReaderStateDoc> {
    if (!this.store.available) return this.memoryDoc ?? emptyStateDoc()
    try {
      const { doc } = await this.store.read()
      this.memoryDoc = doc
      return doc
    } catch (error) {
      if (!(error instanceof ReaderStoreError)) throw error
      // A corrupt file must not take the plugin down; the service reports what
      // it can and the corrupt document stays on disk for its owner to fix.
      this.ctx.logger.warn(`reader: state document unusable — ${error.message}`)
      return this.memoryDoc ?? emptyStateDoc()
    }
  }

  /**
   * Apply a mutation to the document of record.
   *
   * Without a filesystem the mutation lands in memory so the session still
   * works; with one it goes through the store's version guard.
   *
   * @param mutate - pure function from the current document to the next.
   */
  private async commit(mutate: (doc: ReaderStateDoc) => ReaderStateDoc): Promise<void> {
    if (!this.store.available) {
      this.memoryDoc = mutate(this.memoryDoc ?? emptyStateDoc())
      return
    }
    this.memoryDoc = await this.store.update(mutate)
  }

  /**
   * Fetch a URL, following the cross-origin hops that can be reconstructed.
   *
   * The seam refuses a cross-origin hop and names only the target ORIGIN, so
   * there is exactly one hop this method can follow without inventing a URL:
   * a same-host scheme/port change, which keeps the path and query
   * (`http://host/feed` → `https://host/feed`). A hop to a DIFFERENT host is
   * re-thrown untouched — the caller classifies it, and the reader is told the
   * address moves to another site rather than being served some other page
   * under the URL they pasted.
   *
   * @param url - the initial URL.
   * @returns the final URL and its decoded payload.
   */
  private async fetchFollowing(url: string): Promise<FetchOutcome> {
    const web = this.web()
    if (web === undefined) throw new UnsupportedContent('no web capability is mounted')
    let current = url
    for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
      try {
        const result = await web.fetch({ url: current })
        if (result.statusCode < 200 || result.statusCode >= 300) {
          throw new UnsupportedContent(
            result.statusCode === 403 || result.statusCode === 401
              ? `HTTP ${result.statusCode}: the site refuses non-browser requests, so its page cannot be read here — use the original page`
              : `HTTP ${result.statusCode}`,
          )
        }
        return { url: result.url, raw: result.body.content, truncated: result.truncated }
      } catch (error) {
        const target = crossOriginRetarget(error, current)
        if (target === undefined) throw error
        current = target
      }
    }
    throw new UnsupportedContent(`more than ${MAX_REDIRECT_HOPS} cross-origin redirects`)
  }

  /** Arm (or re-arm) the daily refresh timer against the current document. */
  private async armSchedule(): Promise<void> {
    if (this.disposed) return
    if (this.timer !== undefined) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    const doc = await this.currentDoc()
    if (!doc.refresh.enabled) return
    const now = new Date()
    const lastRun = doc.lastRefreshAt === undefined ? undefined : new Date(doc.lastRefreshAt)
    const runThenRearm = (): void => {
      void this.refresh().then(() => this.armSchedule(), () => this.armSchedule())
    }
    if (isCatchUpDue(lastRun, now, doc.refresh.timeOfDay, doc.refresh.enabled)) {
      runThenRearm()
      return
    }
    this.timer = setTimeout(runThenRearm, delayUntilNext(now, doc.refresh.timeOfDay))
    // A day-long timer must not hold the process open on shutdown.
    this.timer.unref?.()
  }
}

/** Parse and normalize a pasted URL; reject anything that is not http(s). */
export function normalizeUrl(input: string): string | undefined {
  try {
    const url = new URL(input.trim())
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    if (url.username.length > 0 || url.password.length > 0) return undefined
    return url.toString()
  } catch {
    return undefined
  }
}

/** Whether two URLs point at the same target, ignoring a trailing slash. */
function sameTarget(a: string, b: string): boolean {
  const strip = (value: string): string => value.replace(/\/+$/, '')
  return strip(a) === strip(b)
}

/** A captured title/excerpt, trimmed and capped; empty reads as absent. */
function metaText(value: string | undefined, cap: number): string | undefined {
  if (value === undefined) return undefined
  const trimmed = value.trim()
  return trimmed.length === 0 ? undefined : trimmed.slice(0, cap)
}

/** A short stable hash, used only to build ids. */
function hash(input: string): string {
  let value = 0x811c9dc5
  for (let index = 0; index < input.length; index++) {
    value ^= input.charCodeAt(index)
    value = Math.imul(value, 0x01000193)
  }
  return (value >>> 0).toString(36)
}

/**
 * The next URL a cross-origin refusal can be followed to — or `undefined`.
 *
 * The host seams throw a `WEB_REDIRECT_BLOCKED` error whose CODE is a property
 * and whose message names only the target origin. The original implementation
 * tested the message for the code text, which it never contains, so the whole
 * follow path was dead code and every cross-origin redirect surfaced as a raw
 * seam error. This reads the code where it actually lives.
 *
 * @param error - the value the seam threw.
 * @param current - the URL whose request was refused.
 * @returns the same path and query on the new origin, when the HOST is
 *   unchanged (a scheme or port upgrade); otherwise `undefined`.
 */
export function crossOriginRetarget(error: unknown, current: string): string | undefined {
  if (errorCode(error) !== 'WEB_REDIRECT_BLOCKED') return undefined
  const origin = /cross-origin redirect to (\S+)/i.exec(errorMessage(error))?.[1]
  if (origin === undefined) return undefined
  let target: URL
  let from: URL
  try {
    target = new URL(origin)
    from = new URL(current)
  } catch {
    return undefined
  }
  if (target.hostname !== from.hostname) return undefined
  return `${target.origin}${from.pathname}${from.search}`
}

/**
 * The machine-readable code a harness error carries.
 *
 * @param error - any thrown value.
 * @returns the code when it has one, else `undefined`.
 */
function errorCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | undefined)?.code
  return typeof code === 'string' ? code : undefined
}

/** Marker words a bot wall leaves on an otherwise empty page. */
const BOT_WALL_PATTERN = /just a moment|checking your browser|cf-chl|cf_chl|attention required|unusual traffic|captcha|verifying you are human|enable javascript and cookies|access denied|are you a robot|验证码|人机验证|访问验证|安全验证/

/** Marker words an authentication interstitial leaves behind. */
const LOGIN_WALL_PATTERN = /cookie required|requires? cookies|sign in|sign-in|log in|login|please log|single sign|sso|qurl=|ezproxy|shibboleth|访问权限|请登录|登录后/

/** Hosts whose NAME alone says the hop is an authentication wall. */
const LOGIN_HOST_PATTERN = /(^|[.-])(login|sso|auth|signin|idp|cas)([.-]|$)/i

/**
 * The smallest amount of visible text that still counts as a readable page.
 *
 * Deliberately small: this only runs on a freshly fetched page, and its job is
 * to catch interstitials — a bot challenge, a cookie notice, an empty shell —
 * not to judge whether an article is long enough to be worth reading.
 */
export const MIN_PREVIEW_TEXT_CHARS = 200

/**
 * Whether a fetched page can be previewed at all, and why not when it cannot.
 *
 * The host has no DOM, so this is a deliberately crude reading of the payload:
 * strip script/style/tags, count what is left, and only when that is
 * vanishingly small look for the words a wall leaves behind. A page with real
 * text is never second-guessed.
 *
 * @param raw - the decoded payload.
 * @param finalUrl - where the fetch actually landed.
 * @param requestedUrl - the URL the reader pasted.
 * @returns the reason when there is nothing to preview, else `undefined`.
 */
export function inspectPreview(
  raw: string,
  finalUrl: string,
  requestedUrl: string,
): { code: ReaderPreviewFailureCode; message: string } | undefined {
  const text = visibleTextLength(raw)
  if (text >= MIN_PREVIEW_TEXT_CHARS) return undefined
  const haystack = `${finalUrl}\n${raw.slice(0, 8000)}`.toLowerCase()
  const host = hostOf(finalUrl)
  if (BOT_WALL_PATTERN.test(haystack)) {
    return { code: 'blocked', message: `the site answered a bot challenge instead of the page (${finalUrl})` }
  }
  if (LOGIN_WALL_PATTERN.test(haystack) || LOGIN_HOST_PATTERN.test(host)) {
    return { code: 'login', message: `the page is an authentication interstitial (${finalUrl})` }
  }
  if (hostOf(requestedUrl) !== host) {
    return { code: 'redirected', message: `the address redirected to ${finalUrl}, which yielded no readable page` }
  }
  return { code: 'empty', message: `the page yielded ${text} characters of text (${finalUrl})` }
}

/**
 * Classify a thrown fetch failure into the reason the reader sees.
 *
 * Everything here is per-case diagnosable: the seam's own message is kept
 * verbatim, and only the CODE decides which sentence the browser shows and
 * whether an automatic retry is allowed.
 *
 * @param error - the value the fetch threw.
 * @param at - the failure instant (ISO-8601).
 * @returns the recorded failure.
 */
export function classifyFetchFailure(error: unknown, at: string): ReaderPreviewFailure {
  const message = errorMessage(error)
  const code = errorCode(error)
  if (code === 'WEB_UNSUPPORTED_CONTENT_TYPE' || /unsupported content type/i.test(message)) {
    return { code: 'unsupported-type', message, at }
  }
  if (code === 'WEB_REDIRECT_BLOCKED' || /cross-origin redirect/i.test(message)) {
    // A hop to a host whose name says "login" is a login wall, not merely a
    // move: the reader's next action differs (sign in elsewhere vs paste the
    // destination URL).
    const origin = /cross-origin redirect to (\S+)/i.exec(message)?.[1]
    const loginish = origin !== undefined && LOGIN_HOST_PATTERN.test(hostOf(origin))
    return { code: loginish ? 'login' : 'redirected', message, at }
  }
  const status = /\bHTTP (\d{3})\b/.exec(message)?.[1]
  if (status === '401' || status === '403') return { code: 'blocked', message, at }
  if (status !== undefined) return { code: 'http', message, at }
  return { code: 'unreachable', message, at }
}

/** The host of a URL, or an empty string when it cannot be parsed. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

/**
 * How much visible text a payload carries.
 *
 * Script, style and markup are stripped; entities collapse to a single space.
 * This is a measurement, not a parser: its only job is to separate "a page"
 * from "an interstitial that is technically HTML".
 *
 * @param raw - the decoded payload.
 * @returns the visible character count.
 */
export function visibleTextLength(raw: string): number {
  return raw
    .replace(/<script[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .length
}

/** The same source with any recorded preview failure removed. */
function withoutFailure(source: ReaderSource): ReaderSource {
  const { failure: _removed, ...rest } = source
  return rest
}

/** Project one source into the browser-facing summary. */
function summarize(source: ReaderSource): ReaderSourceSummary {
  return {
    id: source.id,
    kind: source.kind,
    url: source.url,
    label: source.label ?? defaultSourceLabel(source.url),
    enabled: source.enabled,
    addedAt: source.addedAt,
    hasBody: source.raw !== undefined,
    ...(source.fetchedAt !== undefined ? { fetchedAt: source.fetchedAt } : {}),
    ...(source.status !== undefined ? { status: source.status } : {}),
    ...(source.error !== undefined ? { error: source.error } : {}),
    ...(source.truncated === true ? { truncated: true } : {}),
    ...(source.failure === undefined
      ? {}
      : { failure: { code: source.failure.code, message: source.failure.message } }),
    ...(source.resolvedFrom === undefined ? {} : { resolvedFrom: source.resolvedFrom }),
  }
}

/**
 * The same annotation with no `tagIds` key at all.
 *
 * Under `exactOptionalPropertyTypes` an explicit `undefined` is not the same as
 * an absent optional field, and this document is serialized straight to disk —
 * so an empty tag list must be an ABSENT key, not a null one.
 *
 * @param entry - the annotation to strip.
 * @returns the annotation without its tag list.
 */
function withoutTags(entry: ReaderEntryAnnotation): ReaderEntryAnnotation {
  const { tagIds: _removed, ...rest } = entry
  return rest
}

/**
 * Drop annotations that carry nothing, so the document does not accumulate
 * empty objects as tags are removed.
 *
 * @param annotations - the table to clean.
 * @returns the table with empty entries removed.
 */
function cleanupAnnotations(
  annotations: Record<string, ReaderEntryAnnotation>,
): Record<string, ReaderEntryAnnotation> {
  const out: Record<string, ReaderEntryAnnotation> = {}
  for (const [entryId, entry] of Object.entries(annotations)) {
    // A fetch record alone is load-bearing (the payload is on disk waiting to
    // be extracted), and a translation is the costly-to-rebuild kind of record
    // this document exists to keep — neither may be swept as "empty". Neither
    // may a captured title/excerpt: it is the card's memory of what the paper
    // was, and it must outlive the body it came from.
    if (entry.body === undefined && (entry.tagIds ?? []).length === 0 && entry.error === undefined
      && entry.fetch === undefined && entry.translation === undefined
      && entry.title === undefined && entry.excerpt === undefined) continue
    out[entryId] = (entry.tagIds ?? []).length > 0 ? entry : withoutTags(entry)
  }
  return out
}

/**
 * Parse a translation sidecar's segment map, tolerating a damaged file.
 *
 * @param raw - the file's content, or `undefined` when it is gone.
 * @returns the map, or `undefined` when the file holds none.
 */
function readSegmentsFile(raw: string | undefined): Record<string, string> | undefined {
  if (raw === undefined) return undefined
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return undefined
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(([, target]) => typeof target === 'string'),
    ) as Record<string, string>
  } catch {
    return undefined
  }
}

/**
 * Coerce one batch of learned sentences: bounded in count and in size, each
 * carrying its hash and both texts.
 *
 * @param entries - the client's batch.
 * @returns the entries worth storing.
 */
function normalizeLearns(entries: readonly ReaderSentenceLearn[]): ReaderSentenceLearn[] {
  const out: ReaderSentenceLearn[] = []
  for (const entry of entries.slice(0, TRANSLATION_WRITE_LIMIT)) {
    if (typeof entry.hash !== 'string' || entry.hash.length === 0 || entry.hash.length > 64) continue
    if (typeof entry.source !== 'string' || typeof entry.target !== 'string') continue
    if (entry.source.length === 0 || entry.target.length === 0) continue
    out.push({
      hash: entry.hash,
      source: entry.source.slice(0, TRANSLATION_TEXT_LIMIT),
      target: entry.target.slice(0, TRANSLATION_TEXT_LIMIT),
    })
  }
  return out
}

/** How old a `fetching` record may be before it is treated as abandoned. */
const FETCH_STALE_MS = 10 * 60 * 1000

/** Whether an ISO instant is recent enough to still mean "in flight". */
function isRecent(iso: string, now: number, windowMs: number): boolean {
  const at = new Date(iso).getTime()
  return Number.isFinite(at) && now - at <= windowMs
}

/** Whether a cache deadline is still in the future. */
function isFresh(expiresAt: string): boolean {
  const deadline = new Date(expiresAt).getTime()
  return Number.isFinite(deadline) && deadline > Date.now()
}
