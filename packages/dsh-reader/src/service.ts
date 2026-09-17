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
 *   validated afresh). Real feeds redirect cross-origin constantly, so the
 *   service follows those hops ITSELF, re-entering the seam for each one: the
 *   new origin is validated by the host, so the SSRF control is preserved
 *   rather than bypassed. The final URL becomes the source's canonical URL.
 *
 * With no filesystem mounted the service stays fully functional in memory
 * (sources still add, refresh and search) and simply does not survive a
 * restart — a composition must never fail because a deployment has no fs.
 *
 * @module @khorsheed/dsh-reader/service
 */
import type { Context } from '@deepseek-ai/cordis'
import { ReaderStore, ReaderStoreError, emptyStateDoc } from './store.ts'
import {
  defaultSourceLabel,
  errorMessage,
  DEFAULT_CACHE_POLICY,
  type ReaderAddFailure,
  type ReaderAddOutcome,
  type ReaderAddRefusal,
  type ReaderAnnotationOutcome,
  type ReaderEntryAnnotation,
  type ReaderEntryBodyView,
  type ReaderBody,
  type ReaderCapabilities,
  type ReaderMutationOutcome,
  type ReaderRefreshResult,
  type ReaderSource,
  type ReaderSourceSummary,
  type ReaderTag,
  type ReaderStateDoc,
} from './types.ts'
import { delayUntilNext, isCatchUpDue } from './schedule.ts'

/** Cross-origin redirect hops the service will follow before giving up. */
const MAX_REDIRECT_HOPS = 3

/** Upper bound on summaries handed to the browser in one call. */
const SUMMARY_LIMIT = 500

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
   * @param request - the pasted URL and an optional label.
   * @returns the decision, or a domain refusal.
   */
  async addSource(request: { url: string; label?: string }): Promise<ReaderAddOutcome | ReaderAddRefusal | ReaderAddFailure> {
    const url = normalizeUrl(request.url)
    if (url === undefined) return 'invalid-url'
    const doc = await this.currentDoc()
    if (doc.sources.some(source => sameTarget(source.url, url))) return 'duplicate'

    let fetched: FetchOutcome
    try {
      fetched = await this.fetchFollowing(url)
    } catch (error) {
      // The refusal keeps its reason. A bare `fetch-failed` cost a diagnosis
      // round on the acceptance instance: the address that failed there had
      // merely hit a transient network error, and the UI said only "failed".
      if (error instanceof UnsupportedContent) return 'unsupported-content'
      return { outcome: 'fetch-failed', reason: errorMessage(error) }
    }

    const feed = classifyPayload(fetched.raw) === 'feed'
    const label = request.label ?? defaultSourceLabel(fetched.url)
    const now = new Date().toISOString()
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
      raw: fetched.raw,
    }
    await this.commit(current => ({ ...current, sources: [source, ...current.sources] }))
    return { outcome: feed ? 'subscribed' : 'saved-link', kind: source.kind, id: source.id, label }
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
   * @param request - the source id.
   * @returns the outcome, or a domain refusal.
   */
  async removeSource(request: { id: string }): Promise<ReaderMutationOutcome> {
    const doc = await this.currentDoc()
    if (!doc.sources.some(source => source.id === request.id)) return 'not-found'
    await this.commit(current => ({
      ...current,
      sources: current.sources.filter(source => source.id !== request.id),
    }))
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
        patches.set(source.id, {
          ...source,
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
        const message = errorMessage(error)
        // A failed refresh keeps the previous payload (last-known-good) and
        // records why: a transient network error must not erase the reader's
        // copy of an article.
        const previous = base.get(source.id)
        patches.set(source.id, {
          ...(previous ?? source),
          fetchedAt,
          status: 'error',
          error: message,
        })
        results.push({
          id: source.id,
          status: error instanceof UnsupportedContent ? 'unavailable' : 'fetch-failed',
          message,
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
        if (source.raw === undefined) return { id, error: source.error ?? 'no payload stored yet' }
        return { id, raw: source.raw, ...(source.truncated === true ? { truncated: true } : {}) }
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
      return {
        entryId: request.entryId,
        cached: true,
        fresh,
        fromFeed: false,
        fetchedAt: cached.fetchedAt,
        ...(cached.truncated === true ? { truncated: true } : {}),
        ...(fresh && cached.url === request.url ? { html: cached.html } : {}),
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
    try {
      const fetched = await this.fetchFollowing(url)
      return {
        entryId: request.entryId,
        url: fetched.url,
        raw: fetched.raw,
        ...(fetched.truncated ? { truncated: true } : {}),
      }
    } catch (error) {
      const message = errorMessage(error)
      await this.recordFetchFailure(request.entryId, message)
      return { entryId: request.entryId, error: message }
    }
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
  }): Promise<ReaderEntryBodyView> {
    const html = request.html.trim()
    if (html.length === 0) {
      await this.recordFetchFailure(request.entryId, 'empty extraction')
      return { entryId: request.entryId, cached: false, fresh: false, fromFeed: false, error: 'empty extraction' }
    }
    const doc = await this.currentDoc()
    const ttlHours = doc.cache?.ttlHours ?? DEFAULT_CACHE_POLICY.ttlHours
    const now = new Date()
    const body: NonNullable<ReaderEntryAnnotation['body']> = {
      html,
      fetchedAt: now.toISOString(),
      // 0 = keep until the budget evicts it; a far-future date keeps the
      // freshness check a single comparison instead of a special case.
      expiresAt: ttlHours === 0
        ? new Date(now.getTime() + 100 * 365 * 24 * 60 * 60 * 1000).toISOString()
        : new Date(now.getTime() + ttlHours * 60 * 60 * 1000).toISOString(),
      url: request.url,
      ...(request.truncated === true ? { truncated: true } : {}),
    }
    await this.commit(current => {
      const existing = current.annotations?.[request.entryId]
      const tagIds = existing?.tagIds
      return {
        ...current,
        annotations: {
          ...current.annotations,
          [request.entryId]: tagIds === undefined ? { body } : { body, tagIds },
        },
      }
    })
    return {
      entryId: request.entryId,
      cached: true,
      fresh: true,
      fromFeed: false,
      html: body.html,
      fetchedAt: body.fetchedAt,
      ...(body.truncated === true ? { truncated: true } : {}),
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

  /** How long a fetched body is served, and how many are kept. */
  async getCachePolicy(): Promise<{ ttlHours: number; maxEntries: number }> {
    const doc = await this.currentDoc()
    return doc.cache ?? DEFAULT_CACHE_POLICY
  }

  /** Change the cache policy (`ttlHours: 0` = keep until the budget evicts). */
  async setCachePolicy(request: { ttlHours: number; maxEntries?: number }): Promise<ReaderAnnotationOutcome> {
    if (!Number.isFinite(request.ttlHours) || request.ttlHours < 0 || request.ttlHours > 24 * 90) return 'invalid'
    const doc = await this.currentDoc()
    const maxEntries = request.maxEntries ?? doc.cache?.maxEntries ?? DEFAULT_CACHE_POLICY.maxEntries
    await this.commit(current => ({ ...current, cache: { ttlHours: request.ttlHours, maxEntries } }))
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

  /** Record why a fetch produced nothing, so the retry is a decision. */
  private async recordFetchFailure(entryId: string, error: string): Promise<void> {
    await this.commit(current => ({
      ...current,
      annotations: {
        ...current.annotations,
        [entryId]: { ...current.annotations?.[entryId], error, failedAt: new Date().toISOString() },
      },
    }))
  }

  /* --------------------------------------------------------------- internals */

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
   * Fetch a URL, following cross-origin redirects manually.
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
        const target = crossOriginTarget(error)
        if (target === undefined) throw error
        // The seam refused a cross-origin hop; follow it here so the new origin
        // still goes through the host's public-address validation.
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

/** A short stable hash, used only to build ids. */
function hash(input: string): string {
  let value = 0x811c9dc5
  for (let index = 0; index < input.length; index++) {
    value ^= input.charCodeAt(index)
    value = Math.imul(value, 0x01000193)
  }
  return (value >>> 0).toString(36)
}

/** Pull the validated target origin out of a cross-origin redirect refusal. */
function crossOriginTarget(error: unknown): string | undefined {
  const message = errorMessage(error)
  if (!/WEB_REDIRECT_BLOCKED/i.test(message)) return undefined
  return /cross-origin redirect to (\S+)/i.exec(message)?.[1]
}

/** Project one source into the browser-facing summary. */
function summarize(source: ReaderSource): ReaderSourceSummary {
  return {
    id: source.id,
    kind: source.kind,
    url: source.url,
    label: source.label ?? defaultSourceLabel(source.url),
    enabled: source.enabled,
    hasBody: source.raw !== undefined,
    ...(source.fetchedAt !== undefined ? { fetchedAt: source.fetchedAt } : {}),
    ...(source.status !== undefined ? { status: source.status } : {}),
    ...(source.error !== undefined ? { error: source.error } : {}),
    ...(source.truncated === true ? { truncated: true } : {}),
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
    if (entry.body === undefined && (entry.tagIds ?? []).length === 0 && entry.error === undefined) continue
    out[entryId] = (entry.tagIds ?? []).length > 0 ? entry : withoutTags(entry)
  }
  return out
}

/** Whether a cache deadline is still in the future. */
function isFresh(expiresAt: string): boolean {
  const deadline = new Date(expiresAt).getTime()
  return Number.isFinite(deadline) && deadline > Date.now()
}
