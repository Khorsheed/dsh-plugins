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
import type { ReaderSourceSummary } from '../types.ts'
import type { ReaderEntry } from './parse-rss.ts'

/** Which slice of the list the pane shows. */
export type ReaderFilter = 'today' | 'all'

/** How the list is ordered. */
export type ReaderSort = 'newest' | 'oldest' | 'source'

/** One source's parsed state, held in memory for the session. */
export interface ReaderParsedSource {
  readonly id: string
  readonly entries: readonly ReaderEntry[]
  /** Why parsing produced nothing, when it did. */
  readonly error?: string
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
  /** Bumped to force a reload of the same source set. */
  rev: number
}

/** Annotation twin of the actions literal below. */
export type ReaderActions = {
  setSources: (draft: ReaderState, sources: ReaderSourceSummary[]) => void
  setParsed: (draft: ReaderState, parsed: ReaderParsedSource) => void
  clearParsed: (draft: ReaderState) => void
  openEntry: (draft: ReaderState, entryId: string, sourceId: string) => void
  setArticle: (draft: ReaderState, html: string, truncated: boolean, error: string | null) => void
  closeEntry: (draft: ReaderState) => void
  setFilter: (draft: ReaderState, filter: ReaderFilter) => void
  setQuery: (draft: ReaderState, query: string) => void
  toggleUnreadOnly: (draft: ReaderState) => void
  setSort: (draft: ReaderState, sort: ReaderSort) => void
  markRead: (draft: ReaderState, entryId: string) => void
  setSchedule: (draft: ReaderState, lastRefreshAt: string | undefined, nextRefreshAt: string | undefined) => void
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
  filter: 'today',
  query: '',
  unreadOnly: false,
  sort: 'newest',
  read: {},
  lastRefreshAt: null,
  nextRefreshAt: null,
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
        d.articleHtml = null
        d.articleTruncated = false
        d.articleError = null
      },
      setFilter: (d, filter) => { d.filter = filter },
      setQuery: (d, query) => { d.query = query },
      toggleUnreadOnly: (d) => { d.unreadOnly = !d.unreadOnly },
      setSort: (d, sort) => { d.sort = sort },
      markRead: (d, entryId) => { d.read = { ...d.read, [entryId]: true } },
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
