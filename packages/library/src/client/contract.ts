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
  LibraryAssessment,
  LibraryAttempt,
  LibraryBinding,
  LibraryCard,
  LibraryCardQuery,
  LibraryProjectPatch,
  LibraryEvent,
  LibraryOutcome,
  LibraryPage,
  LibraryProject,
  LibraryProjectSummary,
  LibraryResource,
  LibraryReviewRating,
  LibraryRoadmap,
  LibraryTemplate,
  LibraryVerdict,
} from '../types.ts'
import type { createLibraryStore } from './store.ts'
import type { RevealedProject } from './reveal.ts'

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
  getProject: (id: string) => Answer<{ project: LibraryProjectSummary; resources: LibraryResource[] }>
  createProject: (request: { name: string; template: LibraryTemplate; goal?: string }) => Answer<{ project: LibraryProject }>
  updateProject: (projectId: string, patch: LibraryProjectPatch) => Answer<{ project: LibraryProject }>
  /** Delete a project and everything it holds (shelf, paths, pages, cards) — irreversible. */
  deleteProject: (projectId: string) => Answer<{ id: string }>
  /** Remove a shelf entry: its registration, roadmaps and pages go; its cards stay, unhung. */
  removeResource: (projectId: string, resourceId: string) => Answer<{ id: string }>
  /** Switch a textbook between 知识型 and 材料型. */
  setBookKind: (projectId: string, resourceId: string, bookKind: 'knowledge' | 'material') => Answer<{ resource: LibraryResource }>
  /** Move a textbook to another place in the study order (the rest shift). */
  moveResource: (projectId: string, resourceId: string, seq: number) => Answer<{ resources: LibraryResource[] }>
  getRoadmap: (projectId: string, resourceId: string) => Promise<RemoteResult<{ roadmap?: LibraryRoadmap; draft?: LibraryRoadmap }>>
  adoptRoadmap: (projectId: string, resourceId: string) => Answer<{ roadmap: LibraryRoadmap }>
  discardDraft: (projectId: string, resourceId: string) => Answer<{ resourceId: string }>
  markNodeRead: (projectId: string, resourceId: string | undefined, nodeId: string) => Answer<{ roadmap: LibraryRoadmap; unlocked: string[] }>
  listPages: (projectId: string, resourceId: string, nodeId?: string) => Promise<RemoteResult<{ pages: LibraryPage[] }>>
  readPagePhoto: (projectId: string, pageId: string) => Answer<{ data: string; mediaType: string }>
  /** A project's shelf, thick and thin. */
  listResources: (projectId: string) => Promise<RemoteResult<{ resources: LibraryResource[] }>>
  /** A station's acceptance history, newest first. */
  listAttempts: (projectId: string, nodeId?: string, assessmentId?: string) => Promise<RemoteResult<{ attempts: LibraryAttempt[] }>>
  listCards: (query: LibraryCardQuery) => Promise<RemoteResult<{ cards: LibraryCard[]; total: number }>>
  dueCards: (projectId?: string) => Promise<RemoteResult<{ cards: (LibraryCard & { projectId: string })[] }>>
  editCard: (projectId: string, cardId: string, patch: { status?: LibraryCard['status']; gloss?: string }) => Answer<{ card: LibraryCard }>
  undoCards: (projectId: string, ids: readonly string[], at: string) => Answer<{ removed: number; reverted: number }>
  reviewCard: (projectId: string, cardId: string, rating: LibraryReviewRating) => Answer<{ card: LibraryCard }>
  listAssessments: (projectId: string, resourceId?: string, nodeId?: string, type?: 'quiz' | 'practice') => Promise<RemoteResult<{ assessments: LibraryAssessment[] }>>
  getAssessment: (projectId: string, assessmentId: string) => Answer<{ assessment: LibraryAssessment }>
  putAttempt: (projectId: string, assessmentId: string, verdicts: readonly LibraryVerdict[]) => Answer<LibraryAssessResult>
  /** The newest knowledge-point state changes (今日 「最近的变化」). */
  recentChanges: () => Promise<RemoteResult<{ changes: (LibraryEvent & { projectId: string; projectName: string })[] }>>
  /** 订正: a retake paper over a station's open misses (all, or the keys named). */
  /** No station: the whole project's open misses (今日复习). */
  createRetake: (projectId: string, resourceId?: string, nodeId?: string, keys?: readonly string[]) => Answer<{ assessment: LibraryAssessment }>
  recentRecords: () => Promise<RemoteResult<{ records: (LibraryEvent & { projectId: string; projectName: string })[] }>>
  /** The newest event's timestamp anywhere — the pane's change poll (host-side writes otherwise surface only on remount). */
  latestActivity: () => Promise<RemoteResult<{ at?: string; session?: { id: string; at: string } }>>
  /** The session's binding, when it has one. */
  boundTarget: () => Promise<RemoteResult<LibraryBinding | null>>
  /** The project a reveal asks the pane to land on, taken once (see reveal.ts). */
  revealed: Pick<RevealedProject, 'take' | 'subscribe'>
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
