/**
 * The library Remote: the browser-facing wire face, and nothing else.
 *
 * Every method is a one-line delegation to {@link LibraryService}; the value it
 * returns is the BARE domain value (a refusal is a value inside the protocol's
 * own result envelope, never a second `{ ok }` object nested inside the first).
 * Session-bound methods take the calling `agent` first (the canvas precedent):
 * its session is the one bound.
 *
 * @module @khorsheed/dsh-library/remote
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { LibraryService } from './service.ts'
import type {
  LibraryAssessResult,
  LibraryAttachmentRef,
  LibraryBinding,
  LibraryBook,
  LibraryCapabilities,
  LibraryCard,
  LibraryCardInput,
  LibraryCardQuery,
  LibraryCardWriteResult,
  LibraryColor,
  LibraryIcon,
  LibraryProjectPatch,
  LibraryEvent,
  LibraryEventType,
  LibraryMark,
  LibraryOutcome,
  LibraryPage,
  LibraryProject,
  LibraryProjectSummary,
  LibraryQuiz,
  LibraryReviewRating,
  LibraryRoadmap,
  LibraryTemplate,
  LibraryVerdict,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    libraryRemote: LibraryRemoteService
  }
}

/** Reserved for future config-driven knobs; the service owns today's config. */
export interface LibraryRemoteConfig {}

/** The wire namespace is `library`: the browser calls `remote.library.*`. */
export class LibraryRemoteService extends TypertRemoteService<LibraryRemoteConfig> {
  static inject = ['library']

  constructor(ctx: Context, _config: LibraryRemoteConfig = {}) {
    super(ctx, 'libraryRemote', { namespace: 'library' })
  }

  /** The service core this face delegates to. */
  private get core(): LibraryService {
    return this.ctx.library
  }

  /* -------------------------------------------------------- capabilities */

  /** What this composition can do: storage and attachments, with the reason — the display contract. */
  @Remote('capabilities')
  capabilities(): Promise<LibraryCapabilities> {
    return this.core.capabilities()
  }

  /* ------------------------------------------------------------ projects */

  /** Every project with its books' progress and card tallies. */
  @Remote('listProjects')
  listProjects(): Promise<{ projects: LibraryProjectSummary[] }> {
    return this.core.listProjects()
  }

  /** One project's summary plus its books. */
  @Remote('getProject')
  getProject(request: { id: string }): Promise<LibraryOutcome<{ project: LibraryProjectSummary; books: LibraryBook[] }>> {
    return this.core.getProject(request)
  }

  /** Create a project. */
  @Remote('createProject')
  createProject(request: { name: string; template?: LibraryTemplate; templateNote?: string; goal?: string; color?: LibraryColor; icon?: LibraryIcon }): Promise<LibraryOutcome<{ project: LibraryProject }>> {
    return this.core.createProject(request)
  }

  /** Change a project's look, goal or name. */
  @Remote('updateProject')
  updateProject(request: { id: string; patch: LibraryProjectPatch }): Promise<LibraryOutcome<{ project: LibraryProject }>> {
    return this.core.updateProject(request)
  }

  /** Delete a project and everything it holds. */
  @Remote('deleteProject')
  deleteProject(request: { id: string }): Promise<LibraryOutcome<{ id: string }>> {
    return this.core.deleteProject(request)
  }

  /* --------------------------------------------------------------- books */

  /** One book with its table of contents. */
  @Remote('getBook')
  getBook(request: { projectId: string; bookId: string }): Promise<LibraryOutcome<{ book: LibraryBook }>> {
    return this.core.getBook(request)
  }

  /** Remove a book (its cards stay, unhung). */
  @Remote('deleteBook')
  deleteBook(request: { projectId: string; bookId: string }): Promise<LibraryOutcome<{ id: string }>> {
    return this.core.deleteBook(request)
  }

  /* ------------------------------------------------------------- roadmap */

  /** One book's adopted roadmap and its pending draft. */
  @Remote('getRoadmap')
  getRoadmap(request: { projectId: string; bookId: string }): Promise<{ roadmap?: LibraryRoadmap; draft?: LibraryRoadmap }> {
    return this.core.getRoadmap(request)
  }

  /** The learner's 采用. */
  @Remote('adoptRoadmap')
  adoptRoadmap(request: { projectId: string; bookId: string }): Promise<LibraryOutcome<{ roadmap: LibraryRoadmap }>> {
    return this.core.adoptRoadmap(request)
  }

  /** Drop a draft. */
  @Remote('discardDraft')
  discardDraft(request: { projectId: string; bookId: string }): Promise<LibraryOutcome<{ bookId: string }>> {
    return this.core.discardDraft(request)
  }

  /** 「读完」 a read node. */
  @Remote('markNodeRead')
  markNodeRead(request: { projectId: string; bookId: string; nodeId: string }): Promise<LibraryOutcome<{ roadmap: LibraryRoadmap; unlocked: string[] }>> {
    return this.core.markNodeRead(request)
  }

  /* --------------------------------------------------------------- pages */

  /** One book's pages, optionally one node's. */
  @Remote('listPages')
  listPages(request: { projectId: string; bookId: string; nodeId?: string }): Promise<{ pages: LibraryPage[] }> {
    return this.core.listPages(request)
  }

  /** One page's photo, base64 — whitelisted to recorded pages. */
  @Remote('readPagePhoto')
  readPagePhoto(request: { projectId: string; pageId: string }): Promise<LibraryOutcome<{ data: string; mediaType: string }>> {
    return this.core.readPagePhoto(request)
  }

  /** Save a browser-uploaded photo into the attachment store. */
  @Remote('savePhoto')
  savePhoto(request: { data: string; mediaType: string }): Promise<LibraryOutcome<{ attachment: LibraryAttachmentRef }>> {
    return this.core.savePhoto(request)
  }

  /** Record a recognized page and card its marks. */
  @Remote('recordPage')
  recordPage(request: {
    projectId: string
    bookId: string
    nodeId?: string
    label?: string
    attachment: LibraryAttachmentRef
    text: string
    marks: readonly LibraryMark[]
  }): Promise<LibraryOutcome<{ page: LibraryPage; cards: LibraryCardWriteResult; uncertain: string[] }>> {
    return this.core.recordPage(request)
  }

  /* --------------------------------------------------------------- cards */

  /** Cards, filtered and sorted. */
  @Remote('listCards')
  listCards(request: LibraryCardQuery): Promise<{ cards: LibraryCard[]; total: number }> {
    return this.core.listCards(request)
  }

  /** Due cards across projects (or one). */
  @Remote('dueCards')
  dueCards(request: { projectId?: string; limit?: number }): Promise<{ cards: (LibraryCard & { projectId: string })[] }> {
    return this.core.dueCards(request)
  }

  /** Record cards by hand. */
  @Remote('writeCards')
  writeCards(request: { projectId: string; bookId?: string; cards: readonly LibraryCardInput[] }): Promise<LibraryOutcome<LibraryCardWriteResult>> {
    return this.core.writeCards(request)
  }

  /** Edit one card. */
  @Remote('editCard')
  editCard(request: {
    projectId: string
    cardId: string
    patch: { term?: string; gloss?: string; userGloss?: string; aliases?: readonly string[]; status?: LibraryCard['status']; bookId?: string | null }
  }): Promise<LibraryOutcome<{ card: LibraryCard }>> {
    return this.core.editCard(request)
  }

  /** The toast's 撤销. */
  @Remote('undoCards')
  undoCards(request: { projectId: string; ids: readonly string[]; at: string }): Promise<LibraryOutcome<{ removed: number; reverted: number }>> {
    return this.core.undoCards(request)
  }

  /** One flashcard review. */
  @Remote('reviewCard')
  reviewCard(request: { projectId: string; cardId: string; rating: LibraryReviewRating }): Promise<LibraryOutcome<{ card: LibraryCard }>> {
    return this.core.reviewCard(request)
  }

  /* -------------------------------------------------------------- quizzes */

  /** A project's quizzes, optionally one book's / node's. */
  @Remote('listQuizzes')
  listQuizzes(request: { projectId: string; bookId?: string; nodeId?: string }): Promise<{ quizzes: LibraryQuiz[] }> {
    return this.core.listQuizzes(request)
  }

  /** One quiz, whole. */
  @Remote('getQuiz')
  getQuiz(request: { projectId: string; quizId: string }): Promise<LibraryOutcome<{ quiz: LibraryQuiz }>> {
    return this.core.getQuiz(request)
  }

  /** Grade a sitting answered in the sidebar (choice / fill judged in the page). */
  @Remote('putAttempt')
  putAttempt(request: { projectId: string; quizId: string; verdicts: readonly LibraryVerdict[] }): Promise<LibraryOutcome<LibraryAssessResult>> {
    return this.core.putAttempt(request)
  }

  /* ------------------------------------------------------------- bindings */

  /** The calling session's binding, or null. */
  @Remote('boundTarget')
  async boundTarget(agent: Agent): Promise<LibraryBinding | null> {
    return this.core.getBinding(String(agent.session.id)) ?? null
  }

  /** Bind the calling session to a project / book (null unbinds). */
  @Remote('bindTarget')
  bindTarget(agent: Agent, request: { binding: LibraryBinding | null }): Promise<LibraryOutcome<{ binding: LibraryBinding | null }>> {
    return this.core.setBinding(String(agent.session.id), request.binding)
  }

  /* --------------------------------------------------------------- events */

  /** One project's audit trail, newest first. */
  @Remote('listEvents')
  listEvents(request: { projectId: string; limit?: number; types?: readonly LibraryEventType[] }): Promise<{ events: LibraryEvent[] }> {
    return this.core.listEvents(request)
  }

  /** 「教练最近记下」 across projects. */
  @Remote('recentRecords')
  recentRecords(request: { limit?: number }): Promise<{ records: (LibraryEvent & { projectId: string; projectName: string })[] }> {
    return this.core.recentRecords(request)
  }

  /** The whole-library tally. */
  @Remote('stats')
  stats(): Promise<{ projects: number; books: number; cards: number; due: number; quizzes: number; attempts: number }> {
    return this.core.stats()
  }
}

export default LibraryRemoteService
