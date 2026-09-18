/**
 * The reader pane's transient store: what the user is looking at, not what the
 * host stores.
 *
 * Everything here is session state. Sources and their payloads live in the
 * host's `state.json` (see `src/store.ts`), while the parsed entries, the
 * extracted article bodies, the read cursor, the filter and the sort are
 * per-session and deliberately NOT persisted — see the design's storage
 * decision: persisting a per-entry read cursor would need a second,
 * write-heavy document for a feature whose whole value is "what is new since I
 * last looked".
 *
 * @module @khorsheed/dsh-reader/client/store
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { ReaderSourceSummary, ReaderTag } from '../types.ts'
import type { ReaderEntry } from './parse-rss.ts'

/** Which slice of the list the pane shows. */
export type ReaderFilter = 'today' | 'all'

/** Which surface the pane is showing. */
export type ReaderView = 'list' | 'detail' | 'manage'

/** How the list is ordered. */
export type ReaderSort = 'newest' | 'oldest' | 'source'

/** One source's parsed state, held in memory for the session. */
export interface ReaderParsedSource {
  readonly id: string
  readonly entries: readonly ReaderEntry[]
  /** Why parsing produced nothing, when it did. */
  readonly error?: string
  /**
   * True when the payload was cut off by the host's fetch cap, so the entries
   * here are a salvage rather than the whole feed.
   */
  readonly incomplete?: boolean
  /** When the source was last fetched, for the "N 条 · 刷出于 …" line. */
  readonly fetchedAt?: string
}

/** The pane's state. */
export interface ReaderState {
  /** Sources as the host reported them. */
  sources: ReaderSourceSummary[]
  /** Parsed entries per source id. */
  parsed: Record<string, ReaderParsedSource>
  /** The extracted body of the entry currently open, if any. */
  articleHtml: string | null
  /** Whether that body is incomplete, and why nothing could be extracted. */
  articleTruncated: boolean
  articleError: string | null
  /** The open entry's id (null = the list is showing). */
  openEntryId: string | null
  /** The open entry's source id. */
  openSourceId: string | null
  /** The tag vocabulary, with usage counts (from the host). */
  tags: ReaderTag[]
  tagCounts: Record<string, number>
  /** Tag ids per entry id — what the detail view and the filters read. */
  entryTagIds: Record<string, string[]>
  /** Entry ids whose article is being fetched right now. */
  fetching: Record<string, true>
  /** Entry id → whether its cached body is past its deadline. */
  staleBodies: Record<string, true>
  /** The article cache policy, from the host. */
  cacheTtlHours: number
  /** The automatic full-text backfill: how many are wanted, and how many are done. */
  backfill: { total: number; done: number } | null
  /** Entry ids whose body arrived from a backfill (the cards mark them). */
  backfilled: Record<string, true>
  /** Which surface is up: the wall, one entry, or subscription management. */
  view: ReaderView
  /** Which slice of the list to show. */
  filter: ReaderFilter
  /** The live search query. */
  query: string
  /** Whether to show only entries with no read cursor. */
  unreadOnly: boolean
  /** The list order. */
  sort: ReaderSort
  /** Source ids the user has opened (the session's read cursor). */
  read: Record<string, true>
  /** When the host last completed a refresh run, from the handshake. */
  lastRefreshAt: string | null
  /** When the next scheduled refresh is due, from the handshake. */
  nextRefreshAt: string | null
  /** Whether a host round trip is in flight. */
  loading: boolean
  /** A human-readable failure from the last round trip. */
  error: string | null
  /** True while a refresh round trip is in flight (the wall stays visible). */
  refreshing: boolean
  /** Bumped to force a reload of the same source set. */
  rev: number
}

/** Annotation twin of the actions literal below. */
export type ReaderActions = {
  setSources: (draft: ReaderState, sources: ReaderSourceSummary[]) => void
  setParsed: (draft: ReaderState, parsed: ReaderParsedSource) => void
  clearParsed: (draft: ReaderState) => void
  openEntry: (draft: ReaderState, entryId: string, sourceId: string) => void
  setView: (draft: ReaderState, view: ReaderView) => void
  setTags: (draft: ReaderState, tags: ReaderTag[], counts: Record<string, number>) => void
  setEntryTags: (draft: ReaderState, entryId: string, tagIds: string[]) => void
  /** Drop a tag from the vocabulary, from every entry, and from the counts. */
  dropTag: (draft: ReaderState, tagId: string) => void
  setFetching: (draft: ReaderState, entryId: string, fetching: boolean) => void
  setStaleBody: (draft: ReaderState, entryId: string, stale: boolean) => void
  setCacheTtl: (draft: ReaderState, hours: number) => void
  setBackfill: (draft: ReaderState, progress: { total: number; done: number } | null) => void
  noteBackfilled: (draft: ReaderState, entryId: string, filled: boolean) => void
  setRefreshing: (draft: ReaderState, refreshing: boolean) => void
  /** Record that a refresh run finished, including one with failures. */
  noteRefreshed: (draft: ReaderState, at: string) => void
  setArticle: (draft: ReaderState, html: string, truncated: boolean, error: string | null) => void
  closeEntry: (draft: ReaderState) => void
  setFilter: (draft: ReaderState, filter: ReaderFilter) => void
  setQuery: (draft: ReaderState, query: string) => void
  toggleUnreadOnly: (draft: ReaderState) => void
  setSort: (draft: ReaderState, sort: ReaderSort) => void
  markRead: (draft: ReaderState, entryId: string) => void
  setSchedule: (draft: ReaderState, lastRefreshAt: string | undefined, nextRefreshAt: string | undefined) => void
  /** Replace one source's display label (the feed's own title, once parsed). */
  setSourceLabel: (draft: ReaderState, id: string, label: string) => void
  setLoading: (draft: ReaderState, loading: boolean) => void
  setError: (draft: ReaderState, error: string | null) => void
  refresh: (draft: ReaderState) => void
}

const INITIAL: ReaderState = {
  sources: [],
  parsed: {},
  articleHtml: null,
  articleTruncated: false,
  articleError: null,
  openEntryId: null,
  openSourceId: null,
  tags: [],
  tagCounts: {},
  entryTagIds: {},
  fetching: {},
  staleBodies: {},
  cacheTtlHours: 24,
  backfill: null,
  backfilled: {},
  view: 'list',
  // 'all' rather than 'today': a subscription's entries are usually NOT from
  // today (measured: the acceptance instance's feed's newest item was 8 days
  // old), and a freshly subscribed source whose items the default filter hides
  // reads as "the subscribe did not work".
  filter: 'all',
  query: '',
  unreadOnly: false,
  sort: 'newest',
  read: {},
  lastRefreshAt: null,
  nextRefreshAt: null,
  refreshing: false,
  loading: false,
  error: null,
  rev: 0,
}

/**
 * Create the reader pane's store handle.
 *
 * @returns the store handle (spec, type, identity and factory in one).
 */
export function createReaderStore(): EngineStoreHandle<ReaderState, ReaderActions> {
  return defineStore({
    init: (): ReaderState => ({ ...INITIAL, parsed: {}, read: {} }),
    actions: {
      setSources: (d, sources) => {
        d.sources = sources
        d.loading = false
        d.error = null
      },
      setParsed: (d, parsed) => {
        d.parsed = { ...d.parsed, [parsed.id]: parsed }
        d.loading = false
        d.error = null
      },
      clearParsed: (d) => { d.parsed = {} },
      setView: (d, view) => { d.view = view },
      setTags: (d, tags, counts) => { d.tags = tags; d.tagCounts = counts },
      setEntryTags: (d, entryId, tagIds) => {
        d.entryTagIds = { ...d.entryTagIds, [entryId]: tagIds }
      },
      dropTag: (d, tagId) => {
        // Three places hold a tag id, and a deleted tag must leave all of them
        // or the wall keeps drawing a chip that can no longer be clicked.
        d.tags = d.tags.filter(tag => tag.id !== tagId)
        const { [tagId]: _dropped, ...counts } = d.tagCounts
        d.tagCounts = counts
        const entryTagIds: Record<string, string[]> = {}
        for (const [entryId, ids] of Object.entries(d.entryTagIds)) {
          entryTagIds[entryId] = ids.filter(id => id !== tagId)
        }
        d.entryTagIds = entryTagIds
      },
      setFetching: (d, entryId, fetching) => {
        const next = { ...d.fetching }
        if (fetching) next[entryId] = true
        else delete next[entryId]
        d.fetching = next
      },
      setStaleBody: (d, entryId, stale) => {
        const next = { ...d.staleBodies }
        if (stale) next[entryId] = true
        else delete next[entryId]
        d.staleBodies = next
      },
      setCacheTtl: (d, hours) => { d.cacheTtlHours = hours },
      setBackfill: (d, progress) => { d.backfill = progress },
      noteBackfilled: (d, entryId, filled) => {
        d.backfilled = { ...d.backfilled, [entryId]: true }
        // Done counting regardless: a failure also advances the run, and the
        // card simply keeps showing the feed's own text.
        if (d.backfill !== null) d.backfill = { ...d.backfill, done: Math.min(d.backfill.done + 1, d.backfill.total) }
        if (!filled) delete d.backfilled[entryId]
      },
      setRefreshing: (d, refreshing) => { d.refreshing = refreshing },
      noteRefreshed: (d, at) => {
        d.lastRefreshAt = at
        d.refreshing = false
      },
      openEntry: (d, entryId, sourceId) => {
        d.openEntryId = entryId
        d.openSourceId = sourceId
        d.articleHtml = null
        d.articleTruncated = false
        d.articleError = null
        d.read = { ...d.read, [entryId]: true }
      },
      setArticle: (d, html, truncated, error) => {
        d.articleHtml = html
        d.articleTruncated = truncated
        d.articleError = error
      },
      closeEntry: (d) => {
        d.openEntryId = null
        d.openSourceId = null
        d.view = 'list'
        d.articleHtml = null
        d.articleTruncated = false
        d.articleError = null
      },
      setFilter: (d, filter) => { d.filter = filter },
      setQuery: (d, query) => { d.query = query },
      toggleUnreadOnly: (d) => { d.unreadOnly = !d.unreadOnly },
      setSort: (d, sort) => { d.sort = sort },
      markRead: (d, entryId) => { d.read = { ...d.read, [entryId]: true } },
      setSourceLabel: (d, id, label) => {
        d.sources = d.sources.map(source => source.id === id ? { ...source, label } : source)
      },
      setSchedule: (d, lastRefreshAt, nextRefreshAt) => {
        d.lastRefreshAt = lastRefreshAt ?? null
        d.nextRefreshAt = nextRefreshAt ?? null
      },
      setLoading: (d, loading) => { d.loading = loading },
      setError: (d, error) => {
        d.error = error
        d.loading = false
      },
      refresh: (d) => { d.rev += 1 },
    },
  })
}
