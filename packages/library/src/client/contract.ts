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
  LibraryAssessResult,
  LibraryAttempt,
  LibraryBinding,
  LibraryBook,
  LibraryCard,
  LibraryCardQuery,
  LibraryProjectPatch,
  LibraryEvent,
  LibraryOutcome,
  LibraryPage,
  LibraryProject,
  LibraryProjectSummary,
  LibraryQuiz,
  LibraryResource,
  LibraryReviewRating,
  LibraryRoadmap,
  LibraryTemplate,
  LibraryVerdict,
} from '../types.ts'
import type { createLibraryStore } from './store.ts'

export type { RemoteResult }

/** A Remote call's answer: the protocol envelope around a domain outcome. */
type Answer<T> = Promise<RemoteResult<LibraryOutcome<T>>>

/**
 * The business face every library surface receives from its registration:
 * the wire verbs straight off the Remote, plus the two session gestures the
 * pane cannot perform itself (priming the conversation, binding the session).
 */
export interface LibraryPaneInjected {
  listProjects: () => Promise<RemoteResult<{ projects: LibraryProjectSummary[] }>>
  getProject: (id: string) => Answer<{ project: LibraryProjectSummary; books: LibraryBook[] }>
  createProject: (request: { name: string; template: LibraryTemplate; goal?: string }) => Answer<{ project: LibraryProject }>
  updateProject: (projectId: string, patch: LibraryProjectPatch) => Answer<{ project: LibraryProject }>
  /** Delete a project and everything it holds (books, paths, pages, cards) — irreversible. */
  deleteProject: (projectId: string) => Answer<{ id: string }>
  /** Delete a book: its registration, roadmaps and pages go; its cards stay, unhung. */
  deleteBook: (projectId: string, bookId: string) => Answer<{ id: string }>
  getRoadmap: (projectId: string, bookId?: string) => Promise<RemoteResult<{ roadmap?: LibraryRoadmap; draft?: LibraryRoadmap }>>
  adoptRoadmap: (projectId: string, bookId?: string) => Answer<{ roadmap: LibraryRoadmap }>
  discardDraft: (projectId: string, bookId?: string) => Answer<{ bookId?: string }>
  markNodeRead: (projectId: string, bookId: string | undefined, nodeId: string) => Answer<{ roadmap: LibraryRoadmap; unlocked: string[] }>
  listPages: (projectId: string, bookId: string, nodeId?: string) => Promise<RemoteResult<{ pages: LibraryPage[] }>>
  readPagePhoto: (projectId: string, pageId: string) => Answer<{ data: string; mediaType: string }>
  /** A project's shelf links (the resource section under the shelf). */
  listResources: (projectId: string) => Promise<RemoteResult<{ resources: LibraryResource[] }>>
  /** One practice station's acceptance history, newest first. */
  listAttempts: (projectId: string, nodeId: string) => Promise<RemoteResult<{ attempts: LibraryAttempt[] }>>
  listCards: (query: LibraryCardQuery) => Promise<RemoteResult<{ cards: LibraryCard[]; total: number }>>
  dueCards: (projectId?: string) => Promise<RemoteResult<{ cards: (LibraryCard & { projectId: string })[] }>>
  editCard: (projectId: string, cardId: string, patch: { status?: LibraryCard['status']; gloss?: string }) => Answer<{ card: LibraryCard }>
  undoCards: (projectId: string, ids: readonly string[], at: string) => Answer<{ removed: number; reverted: number }>
  reviewCard: (projectId: string, cardId: string, rating: LibraryReviewRating) => Answer<{ card: LibraryCard }>
  listQuizzes: (projectId: string, bookId: string | undefined, nodeId?: string) => Promise<RemoteResult<{ quizzes: LibraryQuiz[] }>>
  getQuiz: (projectId: string, quizId: string) => Answer<{ quiz: LibraryQuiz }>
  putAttempt: (projectId: string, quizId: string, verdicts: readonly LibraryVerdict[]) => Answer<LibraryAssessResult>
  recentRecords: () => Promise<RemoteResult<{ records: (LibraryEvent & { projectId: string; projectName: string })[] }>>
  /** The newest event's timestamp anywhere — the pane's change poll (host-side writes otherwise surface only on remount). */
  latestActivity: () => Promise<RemoteResult<{ at?: string }>>
  /** The session's binding, when it has one. */
  boundTarget: () => Promise<RemoteResult<LibraryBinding | null>>
  /** Bind the session (null unbinds). */
  bindTarget: (binding: LibraryBinding | null) => Answer<{ binding: LibraryBinding | null }>
  /**
   * Prime the session's conversation with a request (the coach does the
   * work; the pane drafts the ask). False when the session has no input.
   */
  primeConversation: (text: string) => boolean
  /**
   * Send a message in the session for the learner (it shows in the chat as
   * theirs). False when the session has no input or is busy admitting.
   */
  sendMessage: (text: string) => boolean
  /** Send a photo with a message in the session for the learner (the 拍照 gesture). */
  sendPhoto: (file: File, text: string) => boolean
}

/** Full props of the library pane: the seat's session + store + locale + face. */
export type LibraryPaneProps =
  & { sessionId: SessionId }
  & GlobalStandardProps
  & PropsStore<ReturnType<typeof createLibraryStore>>
  & InjectFace<LibraryPaneInjected>
  & PropsLocale<'library'>
