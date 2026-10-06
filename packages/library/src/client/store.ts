/**
 * The library pane's transient store: what the learner is looking at, not what
 * the host stores. Everything durable lives in the host's
 * `state/dsh-library/` (see `src/store.ts`); this store holds the view stack,
 * the data the open view is rendering, and the ingest progress — per-session,
 * re-read from the host on every mount, so the pane can never show a stale
 * copy of what the host knows.
 *
 * @module @khorsheed/dsh-library/client/store
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type {
  LibraryBook,
  LibraryEvent,
  LibraryProject,
  LibraryProjectSummary,
  LibraryRoadmap,
  LibraryVocabEntry,
} from '../types.ts'

/** Which surface the pane is showing. */
export type LibraryView = 'projects' | 'project' | 'book' | 'vocab'

/** The ingest pipeline's state, for the drop zone's feedback. */
export type LibraryIngest =
  | { readonly state: 'idle' }
  | { readonly state: 'working'; readonly name: string }
  | { readonly state: 'failed'; readonly reason: string }
  | { readonly state: 'done'; readonly title: string; readonly chapters: number }

/** One project's detail, as the host reports it. */
export interface LibraryProjectDetail {
  readonly project: LibraryProject
  readonly books: LibraryBook[]
  readonly roadmap?: LibraryRoadmap
  readonly vocabCount: number
  readonly dueCount: number
}

/** The pane's state. */
export interface LibraryState {
  /** Which surface is up. */
  view: LibraryView
  /** The project wall's rows. */
  projects: LibraryProjectSummary[]
  /** The cards due across every project (the wall's review section). */
  due: (LibraryVocabEntry & { projectId: string })[]
  /** The open project's id (null on the wall). */
  openProjectId: string | null
  /** The open project's detail. */
  detail: LibraryProjectDetail | null
  /** The open project's audit trail, newest first (the book view's 动态 section). */
  events: LibraryEvent[]
  /** The open book's id (the book view). */
  openBookId: string | null
  /** The vocab view's entries. */
  vocab: LibraryVocabEntry[]
  /** The vocab search box's live query. */
  query: string
  /** The drop zone's ingest state. */
  ingest: LibraryIngest
  /** Whether a host round trip is in flight. */
  loading: boolean
  /** A human-readable failure from the last round trip. */
  error: string | null
  /** Bumped to force a reload of the same view. */
  rev: number
}

/** Annotation twin of the actions literal below. */
export type LibraryActions = {
  setProjects: (draft: LibraryState, projects: LibraryProjectSummary[], due: (LibraryVocabEntry & { projectId: string })[]) => void
  setDetail: (draft: LibraryState, detail: LibraryProjectDetail | null) => void
  setVocab: (draft: LibraryState, entries: LibraryVocabEntry[]) => void
  setEvents: (draft: LibraryState, events: LibraryEvent[]) => void
  openProject: (draft: LibraryState, projectId: string) => void
  openBook: (draft: LibraryState, bookId: string) => void
  openVocab: (draft: LibraryState, projectId: string) => void
  backToProjects: (draft: LibraryState) => void
  backToProject: (draft: LibraryState) => void
  setQuery: (draft: LibraryState, query: string) => void
  setIngest: (draft: LibraryState, ingest: LibraryIngest) => void
  setLoading: (draft: LibraryState, loading: boolean) => void
  setError: (draft: LibraryState, error: string | null) => void
  refresh: (draft: LibraryState) => void
}

const INITIAL: LibraryState = {
  view: 'projects',
  projects: [],
  due: [],
  openProjectId: null,
  detail: null,
  events: [],
  openBookId: null,
  vocab: [],
  query: '',
  ingest: { state: 'idle' },
  loading: false,
  error: null,
  rev: 0,
}

/**
 * Create the library pane's store handle.
 *
 * @returns the store handle (spec, type, identity and factory in one).
 */
export function createLibraryStore(): EngineStoreHandle<LibraryState, LibraryActions> {
  return defineStore({
    init: (): LibraryState => ({ ...INITIAL, due: [], projects: [] }),
    actions: {
      setProjects: (d, projects, due) => {
        d.projects = projects
        d.due = due
        d.loading = false
        d.error = null
      },
      setDetail: (d, detail) => {
        d.detail = detail
        d.loading = false
        d.error = null
      },
      setVocab: (d, entries) => {
        d.vocab = entries
        d.loading = false
        d.error = null
      },
      setEvents: (d, events) => {
        d.events = events
      },
      openProject: (d, projectId) => {
        d.openProjectId = projectId
        d.detail = null
        d.openBookId = null
        d.view = 'project'
        d.ingest = { state: 'idle' }
      },
      openBook: (d, bookId) => {
        d.openBookId = bookId
        d.view = 'book'
      },
      openVocab: (d, projectId) => {
        d.openProjectId = projectId
        d.view = 'vocab'
        d.vocab = []
        d.query = ''
      },
      backToProjects: (d) => {
        d.view = 'projects'
        d.openProjectId = null
        d.openBookId = null
        d.detail = null
        d.ingest = { state: 'idle' }
      },
      backToProject: (d) => {
        d.view = 'project'
        d.openBookId = null
      },
      setQuery: (d, query) => { d.query = query },
      setIngest: (d, ingest) => { d.ingest = ingest },
      setLoading: (d, loading) => { d.loading = loading },
      setError: (d, error) => {
        d.error = error
        d.loading = false
      },
      refresh: (d) => { d.rev += 1 },
    },
  })
}
