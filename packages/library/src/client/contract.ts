/**
 * Compile-time contract between the library's browser half and its host half.
 *
 * Nothing here executes: this module holds the shapes only, so a change in the
 * Remote surface or in the injected business face breaks compilation at the
 * components that consume them instead of at runtime.
 *
 * @module @khorsheed/dsh-library/client/contract
 */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  GlobalStandardProps, InjectFace, PropsLocale, PropsStore,
} from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the generated Remote API (ctx.remote merge + our namespace).
import type {} from '@khorsheed/dsh-library/remote'
// Type-only: pulls ui-session's GlobalStandardProps merge (`useSessions`).
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {
  LibraryBook,
  LibraryEvent,
  LibraryOutcome,
  LibraryProject,
  LibraryProjectSummary,
  LibraryRoadmap,
  LibraryVocabEntry,
  RoadmapNode,
} from '../types.ts'
import type { createLibraryStore } from './store.ts'

export type { RemoteResult }

/** One parsed chapter, on its way from the ingest to the store. */
export interface LibraryIngestedChapter {
  readonly title: string
  readonly html: string
}

/**
 * The business face every library surface receives from its registration.
 * The wire verbs come straight off the Remote; `primeConversation` is the one
 * local gesture the pane cannot perform itself (it needs the session scope).
 */
export interface LibraryPaneInjected {
  /** The project wall's rows. */
  listProjects: () => Promise<RemoteResult<{ projects: LibraryProjectSummary[] }>>
  /** One project's detail. */
  getProject: (id: string) => Promise<RemoteResult<LibraryOutcome<{
    project: LibraryProject
    books: LibraryBook[]
    roadmap?: LibraryRoadmap
    vocabCount: number
    dueCount: number
  }>>>
  /** Create a project. */
  createProject: (name: string, domain?: string) => Promise<RemoteResult<LibraryOutcome<{ project: LibraryProject }>>>
  /** Delete a project and everything it holds. */
  deleteProject: (id: string) => Promise<RemoteResult<LibraryOutcome<{ id: string }>>>
  /** Store a book this process parsed. */
  storeBook: (request: {
    projectId: string
    title: string
    author?: string
    source: { kind: 'upload' | 'url'; ref: string }
    format: 'epub' | 'md'
    chapters: readonly LibraryIngestedChapter[]
  }) => Promise<RemoteResult<LibraryOutcome<{ book: LibraryBook }>>>
  /** One book's metadata and TOC. */
  getToc: (projectId: string, bookId: string) => Promise<RemoteResult<LibraryOutcome<{ book: LibraryBook }>>>
  /** One project's roadmap, when one was written. */
  getRoadmap: (projectId: string) => Promise<RemoteResult<{ roadmap?: LibraryRoadmap }>>
  /** The vocab book. */
  listVocab: (projectId: string) => Promise<RemoteResult<{ entries: LibraryVocabEntry[] }>>
  /** The audit trail, newest first (the book view's 动态 section). */
  listEvents: (projectId: string, limit?: number) => Promise<RemoteResult<{ events: LibraryEvent[] }>>
  /** Flip nodes on the roadmap (the read node's 「读完」: current → done). */
  putRoadmap: (request: {
    projectId: string
    bookId: string
    nodes: readonly RoadmapNode[]
  }) => Promise<RemoteResult<LibraryOutcome<{ roadmap: LibraryRoadmap }>>>
  /** The cards due for review, across every project (the wall's section). */
  dueVocab: () => Promise<RemoteResult<{ entries: (LibraryVocabEntry & { projectId: string })[] }>>
  /**
   * Prime the session's conversation with a request (the roadmap
   * regeneration's gesture: the coach does the splitting, the pane only
   * drafts the ask). False when this session has no conversation surface.
   */
  primeConversation: (text: string) => boolean
}

/** Full props of the library pane: the seat's session + store + locale + face. */
export type LibraryPaneProps =
  & { sessionId: SessionId }
  & GlobalStandardProps
  & PropsStore<ReturnType<typeof createLibraryStore>>
  & InjectFace<LibraryPaneInjected>
  & PropsLocale<'library'>
