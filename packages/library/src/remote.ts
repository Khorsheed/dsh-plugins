/**
 * The library Remote: the browser-facing wire face, and nothing else.
 *
 * Every method is a one-line delegation to {@link LibraryService}; the value it
 * returns is the BARE domain value (a refusal is a value inside the protocol's
 * own result envelope, never a second `{ ok }` object nested inside the first).
 *
 * @module @khorsheed/dsh-library/remote
 */
import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { LibraryService } from './service.ts'
import type {
  LibraryAssessResult,
  LibraryBook,
  LibraryEvent,
  LibraryOutcome,
  LibraryProject,
  LibraryProjectSummary,
  LibraryQuiz,
  LibraryRoadmap,
  LibraryVerdict,
  LibraryVocabEntry,
  RoadmapNode,
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

  /** The project wall: every project with its books/vocab/due aggregates. */
  @Remote('listProjects')
  listProjects(): Promise<{ projects: LibraryProjectSummary[] }> {
    return this.core.listProjects()
  }

  /** One project's detail: record, books, roadmap, vocab tallies. */
  @Remote('getProject')
  getProject(request: { id: string }): Promise<LibraryOutcome<{
    project: LibraryProject
    books: LibraryBook[]
    roadmap?: LibraryRoadmap
    vocabCount: number
    dueCount: number
  }>> {
    return this.core.getProject(request)
  }

  /** Create a project. */
  @Remote('createProject')
  createProject(request: { name: string; domain?: string }): Promise<LibraryOutcome<{ project: LibraryProject }>> {
    return this.core.createProject(request)
  }

  /** Delete a project and everything it holds. */
  @Remote('deleteProject')
  deleteProject(request: { id: string }): Promise<LibraryOutcome<{ id: string }>> {
    return this.core.deleteProject(request)
  }

  /** Store a book the browser parsed (chapters up, bodies externalized). */
  @Remote('storeBook')
  storeBook(request: {
    projectId: string
    title: string
    author?: string
    source: { kind: 'upload' | 'url'; ref: string }
    format: 'epub' | 'md'
    chapters: readonly { title: string; html: string }[]
    replaceId?: string
  }): Promise<LibraryOutcome<{ book: LibraryBook }>> {
    return this.core.storeBook(request)
  }

  /** One book's metadata and table of contents. */
  @Remote('getToc')
  getToc(request: { projectId: string; bookId: string }): Promise<LibraryOutcome<{ book: LibraryBook }>> {
    return this.core.getToc(request)
  }

  /** One chapter's body, paged under the 100KB budget. */
  @Remote('getChapterBody')
  getChapterBody(request: { projectId: string; bookId: string; chapter: number; offset?: number }): Promise<LibraryOutcome<{
    title: string
    html: string
    offset: number
    nextOffset?: number
    totalChars: number
    chapters: number
  }>> {
    return this.core.getChapterBody(request)
  }

  /** One project's roadmap, when one was written. */
  @Remote('getRoadmap')
  getRoadmap(request: { projectId: string }): Promise<{ roadmap?: LibraryRoadmap }> {
    return this.core.getRoadmap(request)
  }

  /** The audit trail, newest first (the 动态 section reads it this way). */
  @Remote('listEvents')
  listEvents(request: { projectId: string; limit?: number }): Promise<{ events: LibraryEvent[] }> {
    return this.core.listEvents(request)
  }

  /** Write or regenerate the roadmap (state-machine edges checked). */
  @Remote('putRoadmap')
  putRoadmap(request: {
    projectId: string
    bookId: string
    nodes: readonly RoadmapNode[]
    passRatio?: number
    regenerate?: boolean
  }): Promise<LibraryOutcome<{ roadmap: LibraryRoadmap }>> {
    return this.core.putRoadmap(request)
  }

  /** The vocab book (ledger order), optionally one kind. */
  @Remote('listVocab')
  listVocab(request: { projectId: string; kind?: 'vocab' | 'keypoint' }): Promise<{ entries: LibraryVocabEntry[] }> {
    return this.core.listVocab(request)
  }

  /** The entries due for review, lowest box first; cross-project without an id. */
  @Remote('dueVocab')
  dueVocab(request: { projectId?: string; at?: string; limit?: number }): Promise<{ entries: (LibraryVocabEntry & { projectId: string })[] }> {
    return this.core.dueVocab(request)
  }

  /** Append vocab entries (a same-term same-chapter pair merges). */
  @Remote('addVocabEntries')
  addVocabEntries(request: {
    projectId: string
    entries: readonly {
      kind: 'vocab' | 'keypoint'
      term: string
      note: string
      context?: string
      chapterRef: string
      source?: { kind: 'photo' | 'manual' | 'model'; attachmentId?: string; mediaType?: string; bytes?: number; width?: number; height?: number }
    }[]
  }): Promise<LibraryOutcome<{ added: number; merged: number; entries: LibraryVocabEntry[] }>> {
    return this.core.addVocabEntries(request)
  }

  /** A project's quizzes. */
  @Remote('listQuizzes')
  listQuizzes(request: { projectId: string }): Promise<{ quizzes: LibraryQuiz[] }> {
    return this.core.listQuizzes(request)
  }

  /** One quiz, whole. */
  @Remote('getQuiz')
  getQuiz(request: { projectId: string; quizId: string }): Promise<LibraryOutcome<{ quiz: LibraryQuiz }>> {
    return this.core.getQuiz(request)
  }

  /** Store a quiz (the evidence gate applies). */
  @Remote('putQuiz')
  putQuiz(request: {
    projectId: string
    quiz: {
      id?: string
      scope: { bookId: string; nodeId?: string }
      questions: readonly {
        id: string
        kind: 'choice' | 'fill' | 'free'
        prompt: string
        options?: readonly string[]
        chapterRef: string
        evidence: string
        answer: string
        vocabIds?: readonly string[]
      }[]
    }
  }): Promise<LibraryOutcome<{ quiz: LibraryQuiz; warnings: string[] }>> {
    return this.core.putQuiz(request)
  }

  /** Grade a sitting: ledger + vocab mastery + node unlock (the cascade). */
  @Remote('putAttempt')
  putAttempt(request: {
    projectId: string
    quizId: string
    verdicts: readonly LibraryVerdict[]
  }): Promise<LibraryOutcome<LibraryAssessResult>> {
    return this.core.putAttempt(request)
  }

  /** One vocab photo's bytes, base64 — whitelisted to recorded attachment ids. */
  @Remote('readAttachmentBase64')
  readAttachmentBase64(request: { projectId: string; entryId: string }): Promise<LibraryOutcome<{ data: string; mediaType: string }>> {
    return this.core.readAttachmentBase64(request)
  }

  /** The whole-library tally. */
  @Remote('stats')
  stats(): Promise<{
    projects: number
    books: number
    vocab: number
    due: number
    quizzes: number
    attempts: number
    boxHistogram: Record<string, number>
  }> {
    return this.core.stats()
  }
}

export default LibraryRemoteService
