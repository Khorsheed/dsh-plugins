/**
 * The library service core: owns the store and every rule the data answers
 * to. The Remote face next door is a thin adapter with no logic of its own;
 * the model tools (`tool-definition.ts`) translate these same outcomes into
 * thrown, teaching errors.
 *
 * The rules that live here and nowhere else:
 *
 * - **The roadmap state machine** has exactly the edges `locked → current →
 *   done` (plus staying put). A `putRoadmap` that revisits an existing
 *   roadmap may only move a node along those edges; a wholesale regeneration
 *   (`regenerate: true`) is the model's documented way to re-split a book.
 * - **The evidence gate**: a quiz question must name a real chapter
 *   (`ch:<n>`) and carry the original-text fragment it grades against; a
 *   fragment the chapter does not contain is reported as a warning, never
 *   silently blessed.
 * - **The assess cascade** (`putAttempt`) is the only cascading write:
 *   verdicts land in the append-only ledger, then move vocab mastery (right
 *   climbs one Leitner box, wrong resets to box 0 due tomorrow), then update
 *   the gated node's quiz stats, and a node at or above its pass ratio
 *   completes and unlocks its dependents.
 * - **Photo provenance** is a reference, never a copy: a vocab entry carries
 *   the host attachment's durable reference fields, and reading the bytes
 *   back is whitelisted to attachment ids a vocab entry actually records.
 *
 * @module @khorsheed/dsh-library/service
 */
import type { Context } from '@deepseek-ai/cordis'
import {
  chapterOfRef,
  CHAPTER_PAGE_BUDGET,
  DEFAULT_PASS_RATIO,
  LEITNER_INTERVAL_DAYS,
  libraryErrorMessage,
  MAX_BOX,
  type LibraryAssessResult,
  type LibraryAttempt,
  type LibraryBook,
  type LibraryErrorCode,
  type LibraryOutcome,
  type LibraryProject,
  type LibraryProjectSummary,
  type LibraryQuiz,
  type LibraryRefusal,
  type LibraryRoadmap,
  type LibraryTocEntry,
  type LibraryVerdict,
  type LibraryVocabEntry,
  type RoadmapNode,
} from './types.ts'
import {
  LibraryStore,
  LibraryStoreError,
  mintLibraryId,
} from './store.ts'

/** The attachment store's read face, mirrored structurally (probed, never injected). */
interface AttachmentsSlice {
  readImage(ref: {
    attachmentId: string
    mediaType: string
    bytes: number
    width: number
    height: number
  }): Promise<{ data: Uint8Array; ref: { mediaType: string } }>
}

/** A refusal in one line. */
function refuse(error: LibraryErrorCode, message: string): LibraryRefusal {
  return { ok: false, error, message }
}

/** Wrap a store failure as a refusal (the service's error channel is values). */
function storeRefusal(error: unknown): LibraryRefusal {
  if (error instanceof LibraryStoreError) {
    const code: LibraryErrorCode = error.kind === 'corrupt' ? 'corrupt' : error.kind === 'unavailable' ? 'storage-unavailable' : 'io'
    return refuse(code, error.message)
  }
  return refuse('io', `library: ${libraryErrorMessage(error)}`)
}

/** The Leitner due date for a box: box b waits INTERVALS[min(b, 4)] days. */
export function leitnerDueAt(box: number, from: Date = new Date()): string {
  const days = LEITNER_INTERVAL_DAYS[Math.min(Math.max(box, 0), LEITNER_INTERVAL_DAYS.length - 1)]!
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000).toISOString()
}

/** Strip markup to plain text, whitespace-normalized (the evidence anchor's comparison form). */
export function chapterPlainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, '\'')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Normalize a fragment the same way before comparing. */
function normalizeFragment(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * The library's service core. Constructing it never throws and never touches
 * the disk: the store probes writability lazily, so a read-only deployment
 * boots and answers `storage-unavailable` on writes.
 */
export class LibraryService {
  /** The store; public for the package's own tests and diagnostics. */
  readonly store: LibraryStore

  constructor(
    private readonly ctx: Context,
    config: { stateRoot?: string } = {},
  ) {
    this.store = new LibraryStore(config)
  }

  /* ------------------------------------------------------------ projects */

  /** The project wall: every project with its cheap aggregates. */
  async listProjects(): Promise<{ projects: LibraryProjectSummary[] }> {
    const index = this.store.readIndex()
    const now = new Date().toISOString()
    const projects: LibraryProjectSummary[] = []
    for (const project of index.projects) {
      const books = this.store.listBooks(project.id)
      const vocab = this.store.readVocab(project.id)
      const roadmap = this.store.readRoadmap(project.id)
      const current = roadmap?.nodes.find(node => node.state === 'current')
      projects.push({
        ...project,
        books: books.map(book => book.id),
        vocabCount: vocab.length,
        dueCount: vocab.filter(entry => entry.mastery.dueAt <= now).length,
        ...(roadmap === undefined ? {} : {
          roadmap: {
            done: roadmap.nodes.filter(node => node.state === 'done').length,
            total: roadmap.nodes.length,
          },
        }),
        ...(current === undefined ? {} : {
          current: {
            bookTitle: books.find(book => book.id === roadmap?.bookId)?.title ?? roadmap?.bookId ?? '',
            nodeTitle: current.title,
          },
        }),
      })
    }
    return { projects }
  }

  /** One project's detail: its record, books, roadmap and vocab tallies. */
  async getProject(request: { id: string }): Promise<LibraryOutcome<{
    project: LibraryProject
    books: LibraryBook[]
    roadmap?: LibraryRoadmap
    vocabCount: number
    dueCount: number
  }>> {
    const project = this.readProjectOrRefusal(request.id)
    if ('error' in project) return project
    const now = new Date().toISOString()
    const vocab = this.store.readVocab(project.value.id)
    const roadmap = this.store.readRoadmap(project.value.id)
    return {
      ok: true,
      project: project.value,
      books: this.store.listBooks(project.value.id),
      ...(roadmap === undefined ? {} : { roadmap }),
      vocabCount: vocab.length,
      dueCount: vocab.filter(entry => entry.mastery.dueAt <= now).length,
    }
  }

  /** Create a project; the name is the wall's label. */
  async createProject(request: { name: string; domain?: string }): Promise<LibraryOutcome<{ project: LibraryProject }>> {
    const name = request.name.trim()
    if (name === '') {
      return refuse('invalid', 'library_write · project needs a non-empty name — call it what the learner calls it (「神经科学」, 「雅思英语」)')
    }
    try {
      return await this.store.withIndexLock(async () => {
        const index = this.store.readIndex()
        if (index.projects.some(project => project.name === name)) {
          return refuse('exists', `a project named ${JSON.stringify(name)} already exists — open it (library_read · projects lists every project) instead of creating a twin`)
        }
        const project: LibraryProject = {
          id: mintLibraryId('p'),
          name,
          ...(request.domain === undefined || request.domain.trim() === '' ? {} : { domain: request.domain.trim() }),
          createdAt: new Date().toISOString(),
        }
        this.store.writeProject(project)
        this.store.writeIndex({ ...index, projects: [...index.projects, project] })
        return { ok: true as const, project }
      })
    } catch (error) {
      return storeRefusal(error)
    }
  }

  /** Delete a project and everything it holds. */
  async deleteProject(request: { id: string }): Promise<LibraryOutcome<{ id: string }>> {
    try {
      return await this.store.withIndexLock(async () => {
        const index = this.store.readIndex()
        if (!index.projects.some(project => project.id === request.id)) {
          return refuse('not-found', `no project ${JSON.stringify(request.id)} — library_read · projects lists the ones that exist`)
        }
        this.store.removeProject(request.id)
        this.store.writeIndex({ ...index, projects: index.projects.filter(project => project.id !== request.id) })
        return { ok: true as const, id: request.id }
      })
    } catch (error) {
      return storeRefusal(error)
    }
  }

  /* --------------------------------------------------------------- books */

  /**
   * Store a book the browser already parsed: metadata plus every chapter body.
   * Re-storing under a returned id replaces the book whole (a re-ingest).
   */
  async storeBook(request: {
    projectId: string
    title: string
    author?: string
    source: { kind: 'upload' | 'url'; ref: string }
    format: 'epub' | 'md'
    chapters: readonly { title: string; html: string }[]
    /** Re-ingest: replace this existing book id. */
    replaceId?: string
  }): Promise<LibraryOutcome<{ book: LibraryBook }>> {
    const title = request.title.trim()
    if (title === '') return refuse('invalid', 'storeBook needs a title — the book\'s own, from its metadata')
    if (request.chapters.length === 0) {
      return refuse('invalid', 'storeBook needs at least one chapter — an EPUB with an unreadable spine or a Markdown with no content parses to nothing; the ingest reports WHY (see the drop zone\'s error), it does not store an empty book')
    }
    if (request.chapters.some(chapter => chapter.html.trim() === '')) {
      return refuse('invalid', 'every chapter needs a non-empty body — a chapter that parsed to nothing is an ingest failure to report, not a chapter to store')
    }
    const project = this.readProjectOrRefusal(request.projectId)
    if ('error' in project) return project
    try {
      return await this.store.withProjectLock(project.value.id, async () => {
        if (request.replaceId !== undefined) {
          const existing = this.store.readBook(project.value.id, request.replaceId)
          if (existing === undefined) {
            return refuse('not-found', `no book ${JSON.stringify(request.replaceId)} in this project — omit replaceId to store a new book`)
          }
        }
        const id = request.replaceId ?? mintLibraryId('b')
        const toc: LibraryTocEntry[] = request.chapters.map((chapter, index) => ({
          n: index + 1,
          title: chapter.title.trim() === '' ? `第 ${index + 1} 章` : chapter.title.trim(),
          chars: chapter.html.length,
        }))
        const book: LibraryBook = {
          id,
          title,
          ...(request.author === undefined || request.author.trim() === '' ? {} : { author: request.author.trim() }),
          source: request.source,
          format: request.format,
          toc,
          createdAt: this.store.readBook(project.value.id, id)?.createdAt ?? new Date().toISOString(),
        }
        this.store.writeBook(
          project.value.id,
          book,
          request.chapters.map((chapter, index) => ({ n: index + 1, html: chapter.html })),
        )
        return { ok: true as const, book }
      })
    } catch (error) {
      return storeRefusal(error)
    }
  }

  /** One book's table of contents. */
  async getToc(request: { projectId: string; bookId: string }): Promise<LibraryOutcome<{ book: LibraryBook }>> {
    const book = this.store.readBook(request.projectId, request.bookId)
    if (book === undefined) return refuse('not-found', `no book ${JSON.stringify(request.bookId)} — library_read · books lists the project's`)
    return { ok: true, book }
  }

  /**
   * One chapter's body, paged under the 100KB budget: a page ends at a closing
   * tag when one fits, so the model never reads half a paragraph tag.
   */
  async getChapterBody(request: {
    projectId: string
    bookId: string
    chapter: number
    offset?: number
  }): Promise<LibraryOutcome<{
    title: string
    html: string
    offset: number
    nextOffset?: number
    totalChars: number
    chapters: number
  }>> {
    const book = this.store.readBook(request.projectId, request.bookId)
    if (book === undefined) return refuse('not-found', `no book ${JSON.stringify(request.bookId)} — library_read · books lists the project's`)
    const entry = book.toc.find(candidate => candidate.n === request.chapter)
    if (entry === undefined) {
      return refuse('not-found', `book ${JSON.stringify(book.title)} has chapters 1..${book.toc.length} — ${String(request.chapter)} is outside them (library_read · toc lists them with titles)`)
    }
    const body = this.store.readChapter(request.projectId, request.bookId, request.chapter)
    if (body === undefined) return refuse('io', `chapter ${request.chapter}'s body file is missing — the book was stored half-written; re-ingest it`)
    const offset = Math.max(0, request.offset ?? 0)
    if (offset >= body.length && body.length > 0) {
      return refuse('invalid', `offset ${offset} is past the chapter's end (${body.length} chars) — the previous page's nextOffset is the next page's offset`)
    }
    let end = Math.min(offset + CHAPTER_PAGE_BUDGET, body.length)
    if (end < body.length) {
      const closing = body.lastIndexOf('</', end)
      if (closing > offset) {
        const tagEnd = body.indexOf('>', closing)
        if (tagEnd !== -1 && tagEnd < end + 64) end = tagEnd + 1
      }
    }
    return {
      ok: true,
      title: entry.title,
      html: body.slice(offset, end),
      offset,
      ...(end < body.length ? { nextOffset: end } : {}),
      totalChars: body.length,
      chapters: book.toc.length,
    }
  }

  /* ------------------------------------------------------------- roadmap */

  /** One project's roadmap, when one was written. */
  async getRoadmap(request: { projectId: string }): Promise<{ roadmap?: LibraryRoadmap }> {
    const roadmap = this.store.readRoadmap(request.projectId)
    return roadmap === undefined ? {} : { roadmap }
  }

  /**
   * Write (or regenerate) the roadmap. Structural rules: unique ids, goals and
   * chapter ranges that name the book's real chapters, dependsOn pointing
   * backwards, and a state that only leads where its deps allow. Against an
   * existing roadmap, per-node states move along the state machine's edges —
   * unless `regenerate` re-splits the book from scratch.
   */
  async putRoadmap(request: {
    projectId: string
    bookId: string
    nodes: readonly RoadmapNode[]
    passRatio?: number
    regenerate?: boolean
  }): Promise<LibraryOutcome<{ roadmap: LibraryRoadmap }>> {
    const project = this.readProjectOrRefusal(request.projectId)
    if ('error' in project) return project
    const book = this.store.readBook(project.value.id, request.bookId)
    if (book === undefined) {
      return refuse('not-found', `no book ${JSON.stringify(request.bookId)} in project ${JSON.stringify(project.value.name)} — a roadmap rides a book; library_read · books lists them, then name one`)
    }
    if (request.nodes.length === 0) {
      return refuse('invalid', 'a roadmap needs at least one node — read the TOC (library_read · toc) and split the book into learning units; each node: { id, title, goals, chapterRanges, dependsOn, state }')
    }
    const shapeError = validateRoadmapShape(request.nodes, book)
    if (shapeError !== undefined) return refuse('invalid', shapeError)
    const existing = this.store.readRoadmap(project.value.id)
    if (existing !== undefined && request.regenerate !== true) {
      const edgeError = validateRoadmapEdges(existing, request.nodes)
      if (edgeError !== undefined) return refuse('state-machine', edgeError)
    }
    const roadmap: LibraryRoadmap = {
      bookId: book.id,
      nodes: request.nodes.map(node => ({
        ...node,
        quizStats: node.quizStats ?? { attempts: 0 },
      })),
      ...(request.passRatio === undefined ? {} : { passRatio: request.passRatio }),
      generatedAt: new Date().toISOString(),
    }
    try {
      return await this.store.withProjectLock(project.value.id, async () => {
        this.store.writeRoadmap(project.value.id, roadmap)
        return { ok: true as const, roadmap }
      })
    } catch (error) {
      return storeRefusal(error)
    }
  }

  /* --------------------------------------------------------------- vocab */

  /** The vocab book, newest last (ledger order), optionally one kind. */
  async listVocab(request: { projectId: string; kind?: 'vocab' | 'keypoint' }): Promise<{ entries: LibraryVocabEntry[] }> {
    const entries = this.store.readVocab(request.projectId)
    return { entries: request.kind === undefined ? entries : entries.filter(entry => entry.kind === request.kind) }
  }

  /**
   * The entries due for review: `dueAt` not in the future, lowest box first
   * (the weakest cards are the review). Without a project id, every project's.
   */
  async dueVocab(request: { projectId?: string; at?: string; limit?: number }): Promise<{ entries: (LibraryVocabEntry & { projectId: string })[] }> {
    const at = request.at ?? new Date().toISOString()
    const projectIds = request.projectId !== undefined
      ? [request.projectId]
      : this.store.readIndex().projects.map(project => project.id)
    const due: (LibraryVocabEntry & { projectId: string })[] = []
    for (const projectId of projectIds) {
      for (const entry of this.store.readVocab(projectId)) {
        if (entry.mastery.dueAt <= at) due.push({ ...entry, projectId })
      }
    }
    due.sort((a, b) => a.mastery.box - b.mastery.box || a.mastery.dueAt.localeCompare(b.mastery.dueAt))
    return { entries: due.slice(0, request.limit ?? 100) }
  }

  /**
   * Append vocab entries. A (term, chapterRef) pair the book already holds
   * MERGES (fresh note/context win, mastery is never reset by a re-sighting);
   * everything else lands as a new card at box 0, due now.
   */
  async addVocabEntries(request: {
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
    const project = this.readProjectOrRefusal(request.projectId)
    if ('error' in project) return project
    if (request.entries.length === 0) {
      return refuse('invalid', 'library_write · notes needs at least one entry — each: { kind: vocab|keypoint, term, note, chapterRef } (chapterRef is ch:<n>, e.g. ch:3)')
    }
    for (const [index, entry] of request.entries.entries()) {
      if (entry.term.trim() === '' || entry.note.trim() === '') {
        return refuse('invalid', `entries[${index}] needs both term and note — a card with no gloss teaches nothing`)
      }
      if (chapterOfRef(entry.chapterRef) === undefined) {
        return refuse('invalid', `entries[${index}] (${JSON.stringify(entry.term)}) has chapterRef ${JSON.stringify(entry.chapterRef)} — the convention is ch:<n> with the 1-based chapter number (ch:3, ch:3.2); library_read · toc lists the chapters`)
      }
    }
    try {
      return await this.store.withProjectLock(project.value.id, async () => {
        const existing = this.store.readVocab(project.value.id)
        const byKey = new Map(existing.map(entry => [`${entry.term.toLowerCase()} | ${entry.chapterRef}`, entry]))
        const fresh: LibraryVocabEntry[] = []
        const mergedEntries: LibraryVocabEntry[] = []
        let merged = 0
        const now = new Date()
        for (const input of request.entries) {
          const key = `${input.term.trim().toLowerCase()} | ${input.chapterRef.trim()}`
          const prior = byKey.get(key)
          if (prior !== undefined) {
            const next: LibraryVocabEntry = {
              ...prior,
              note: input.note.trim(),
              ...(input.context === undefined ? {} : { context: input.context }),
              source: input.source === undefined ? prior.source : {
                kind: input.source.kind,
                ...(input.source.attachmentId === undefined ? {} : { attachmentId: input.source.attachmentId }),
                ...(input.source.mediaType === undefined ? {} : { mediaType: input.source.mediaType }),
                ...(input.source.bytes === undefined ? {} : { bytes: input.source.bytes }),
                ...(input.source.width === undefined ? {} : { width: input.source.width }),
                ...(input.source.height === undefined ? {} : { height: input.source.height }),
              },
            }
            byKey.set(key, next)
            merged += 1
            mergedEntries.push(next)
            continue
          }
          const entry: LibraryVocabEntry = {
            id: mintLibraryId('v'),
            kind: input.kind,
            term: input.term.trim(),
            note: input.note.trim(),
            ...(input.context === undefined || input.context.trim() === '' ? {} : { context: input.context.trim() }),
            chapterRef: input.chapterRef.trim(),
            source: input.source === undefined ? { kind: 'manual' } : {
              kind: input.source.kind,
              ...(input.source.attachmentId === undefined ? {} : { attachmentId: input.source.attachmentId }),
              ...(input.source.mediaType === undefined ? {} : { mediaType: input.source.mediaType }),
              ...(input.source.bytes === undefined ? {} : { bytes: input.source.bytes }),
              ...(input.source.width === undefined ? {} : { width: input.source.width }),
              ...(input.source.height === undefined ? {} : { height: input.source.height }),
            },
            mastery: { box: 0, dueAt: now.toISOString(), streak: 0 },
            createdAt: now.toISOString(),
          }
          byKey.set(key, entry)
          fresh.push(entry)
          mergedEntries.push(entry)
        }
        const all = [...byKey.values()]
        this.store.rewriteVocab(project.value.id, all)
        return { ok: true as const, added: fresh.length, merged, entries: mergedEntries }
      })
    } catch (error) {
      return storeRefusal(error)
    }
  }

  /* -------------------------------------------------------------- quizzes */

  /** A project's quizzes, metadata only (the list the client renders). */
  async listQuizzes(request: { projectId: string }): Promise<{ quizzes: LibraryQuiz[] }> {
    return { quizzes: this.store.listQuizzes(request.projectId) }
  }

  /** One quiz, whole. */
  async getQuiz(request: { projectId: string; quizId: string }): Promise<LibraryOutcome<{ quiz: LibraryQuiz }>> {
    const quiz = this.store.readQuiz(request.projectId, request.quizId)
    if (quiz === undefined) {
      return refuse('not-found', `no quiz ${JSON.stringify(request.quizId)} — library_read · quiz without an id lists the project's`)
    }
    return { ok: true, quiz }
  }

  /**
   * Store a quiz behind the evidence gate: every question names a real chapter
   * of the scoped book (`ch:<n>`) and carries the original-text fragment its
   * answer grades against. A fragment the chapter does not literally contain
   * comes back in `warnings` — stored, but flagged for the coach to own.
   */
  async putQuiz(request: {
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
    const project = this.readProjectOrRefusal(request.projectId)
    if ('error' in project) return project
    const book = this.store.readBook(project.value.id, request.quiz.scope.bookId)
    if (book === undefined) {
      return refuse('not-found', `quiz scope names book ${JSON.stringify(request.quiz.scope.bookId)}, which project ${JSON.stringify(project.value.name)} does not hold — library_read · books lists them`)
    }
    if (request.quiz.questions.length === 0) {
      return refuse('invalid', 'a quiz needs at least one question — each: { id, kind: choice|fill|free, prompt, chapterRef: "ch:<n>", evidence, answer }')
    }
    if (request.quiz.scope.nodeId !== undefined) {
      const roadmap = this.store.readRoadmap(project.value.id)
      if (roadmap !== undefined && !roadmap.nodes.some(node => node.id === request.quiz.scope.nodeId)) {
        return refuse('not-found', `quiz scope names node ${JSON.stringify(request.quiz.scope.nodeId)}, which the roadmap does not hold — library_read · roadmap lists the nodes`)
      }
    }
    const seenIds = new Set<string>()
    const warnings: string[] = []
    for (const [index, question] of request.quiz.questions.entries()) {
      const label = `questions[${index}]${question.id === '' ? '' : ` (${question.id})`}`
      if (question.id === '' || seenIds.has(question.id)) {
        return refuse('evidence-gate', `${label} needs a unique id — q1, q2, … is plenty`)
      }
      seenIds.add(question.id)
      if (question.prompt.trim() === '' || question.answer.trim() === '') {
        return refuse('evidence-gate', `${label} needs both a prompt and an answer — a question without its answer cannot be graded`)
      }
      const chapter = chapterOfRef(question.chapterRef)
      if (chapter === undefined) {
        return refuse('evidence-gate', `${label} has chapterRef ${JSON.stringify(question.chapterRef)} — every question must name its chapter as ch:<n> (ch:3, ch:3.2), so grading can re-read the passage; library_read · toc lists the chapters`)
      }
      if (book.toc.find(entry => entry.n === chapter) === undefined) {
        return refuse('evidence-gate', `${label} names chapter ${chapter}, but 《${book.title}》 has chapters 1..${book.toc.length} — point chapterRef at a real chapter`)
      }
      const evidence = normalizeFragment(question.evidence)
      if (evidence.length < 8) {
        return refuse('evidence-gate', `${label} carries no usable evidence — quote the original passage the answer comes from (a sentence or two, verbatim) so grading can point at the book, not at memory`)
      }
      const body = this.store.readChapter(project.value.id, book.id, chapter)
      if (body !== undefined && !chapterPlainText(body).includes(evidence)) {
        warnings.push(`${label}: its evidence is not a verbatim fragment of chapter ${chapter} — stored, but the quote should be re-read from the chapter (library_read · chapter)`)
      }
      if (question.kind === 'choice' && (question.options === undefined || question.options.length < 2)) {
        return refuse('evidence-gate', `${label} is a choice question with fewer than two options — give options: ["A …", "B …", …]`)
      }
    }
    const quiz: LibraryQuiz = {
      id: request.quiz.id ?? mintLibraryId('q'),
      scope: {
        bookId: book.id,
        ...(request.quiz.scope.nodeId === undefined ? {} : { nodeId: request.quiz.scope.nodeId }),
      },
      questions: request.quiz.questions,
      createdAt: new Date().toISOString(),
    }
    try {
      return await this.store.withProjectLock(project.value.id, async () => {
        this.store.writeQuiz(quiz, project.value.id)
        return { ok: true as const, quiz, warnings }
      })
    } catch (error) {
      return storeRefusal(error)
    }
  }

  /* ------------------------------------------------------------- attempts */

  /**
   * Grade a sitting — the only cascading write. Verdicts (the model has
   * already judged; this verb never judges) land in the append-only ledger,
   * move every probed vocab entry's Leitner box (right climbs one, wrong
   * resets to box 0 due tomorrow), update the gated node's quiz stats, and a
   * node at or above its pass ratio completes and unlocks its dependents.
   */
  async putAttempt(request: {
    projectId: string
    quizId: string
    verdicts: readonly LibraryVerdict[]
  }): Promise<LibraryOutcome<LibraryAssessResult>> {
    const project = this.readProjectOrRefusal(request.projectId)
    if ('error' in project) return project
    const quiz = this.store.readQuiz(project.value.id, request.quizId)
    if (quiz === undefined) {
      return refuse('not-found', `no quiz ${JSON.stringify(request.quizId)} — store the quiz first (library_write · quiz), then assess it`)
    }
    if (request.verdicts.length === 0) {
      return refuse('invalid', 'library_assess needs the verdicts — one per question, the dataseek.verdict/1 shape: { task: <question id>, criterion, pass, ratio?, evidence, by }')
    }
    const questionById = new Map(quiz.questions.map(question => [question.id, question]))
    for (const [index, verdict] of request.verdicts.entries()) {
      if (!questionById.has(verdict.task)) {
        return refuse('invalid', `verdicts[${index}] judges task ${JSON.stringify(verdict.task)}, which quiz ${quiz.id} does not ask — its questions are: ${quiz.questions.map(question => question.id).join(', ')}`)
      }
      if (verdict.criterion.trim() === '' || verdict.evidence.trim() === '') {
        return refuse('invalid', `verdicts[${index}] (${verdict.task}) needs criterion and evidence — a verdict says WHAT was judged and WHERE the passage says it`)
      }
      if (verdict.by !== 'llm' && verdict.by !== 'self' && verdict.by !== 'user') {
        return refuse('invalid', `verdicts[${index}].by must be llm | self | user — who graded it`)
      }
    }
    const ratio = request.verdicts.reduce((sum, verdict) => sum + (verdict.ratio ?? (verdict.pass ? 1 : 0)), 0) / request.verdicts.length
    try {
      return await this.store.withProjectLock(project.value.id, async () => {
        const attempt: LibraryAttempt = {
          id: mintLibraryId('a'),
          quizId: quiz.id,
          verdicts: request.verdicts,
          ratio,
          at: new Date().toISOString(),
        }
        this.store.appendAttempt(project.value.id, attempt)

        // Vocab mastery: every verdict moves the cards its question probed.
        const vocab = this.store.readVocab(project.value.id)
        const verdictByQuestion = new Map(request.verdicts.map(verdict => [verdict.task, verdict]))
        const moved = new Map<string, LibraryVocabEntry>()
        const now = new Date()
        for (const question of quiz.questions) {
          const verdict = verdictByQuestion.get(question.id)
          if (verdict === undefined || question.vocabIds === undefined) continue
          for (const vocabId of question.vocabIds) {
            const entry = vocab.find(candidate => candidate.id === vocabId)
            if (entry === undefined) continue
            const box = verdict.pass ? Math.min(entry.mastery.box + 1, MAX_BOX) : 0
            const next: LibraryVocabEntry = {
              ...entry,
              mastery: {
                box,
                dueAt: leitnerDueAt(box, now),
                streak: verdict.pass ? entry.mastery.streak + 1 : 0,
              },
            }
            moved.set(entry.id, next)
          }
        }
        const vocabUpdates = [...moved.values()].map(entry => ({ id: entry.id, mastery: entry.mastery }))
        if (moved.size > 0) {
          this.store.rewriteVocab(project.value.id, vocab.map(entry => moved.get(entry.id) ?? entry))
        }

        // The gated node's stats, its completion, and what that unlocks.
        const unlocked: string[] = []
        let completed: string | undefined
        const roadmap = this.store.readRoadmap(project.value.id)
        if (roadmap !== undefined && quiz.scope.nodeId !== undefined) {
          const nodeId = quiz.scope.nodeId
          const passRatio = roadmap.passRatio ?? DEFAULT_PASS_RATIO
          const nodes = roadmap.nodes.map(node => {
            if (node.id !== nodeId) return node
            const stats = node.quizStats ?? { attempts: 0 }
            const next: RoadmapNode = {
              ...node,
              quizStats: {
                attempts: stats.attempts + 1,
                lastRatio: ratio,
                bestRatio: Math.max(stats.bestRatio ?? 0, ratio),
              },
            }
            if (ratio >= passRatio && node.state === 'current') {
              completed = nodeId
              return { ...next, state: 'done' as const }
            }
            return next
          })
          if (completed !== undefined) {
            const doneIds = new Set(nodes.filter(node => node.state === 'done').map(node => node.id))
            for (const [index, node] of nodes.entries()) {
              if (node.state === 'locked' && node.dependsOn.every(dep => doneIds.has(dep))) {
                nodes[index] = { ...node, state: 'current' }
                unlocked.push(node.id)
              }
            }
          }
          if (quiz.scope.nodeId !== undefined) {
            this.store.writeRoadmap(project.value.id, { ...roadmap, nodes })
          }
        }
        return {
          ok: true as const,
          attempt,
          vocabUpdates,
          unlocked,
          ...(completed === undefined ? {} : { completed }),
        }
      })
    } catch (error) {
      return storeRefusal(error)
    }
  }

  /* ---------------------------------------------------------- attachments */

  /**
   * Read one vocab photo's bytes back, as base64 — the 图书馆页's way to show
   * the notebook photo a card came from. Whitelisted: the attachmentId must be
   * one a vocab entry of THIS project records, and the entry must carry the
   * full durable reference (the model copies it off the message's image block
   * when it logs the card). The attachments service absent degrades to
   * `unavailable`; an id nothing records is `not-found`.
   */
  async readAttachmentBase64(request: { projectId: string; entryId: string }): Promise<LibraryOutcome<{ data: string; mediaType: string }>> {
    const entry = this.store.readVocab(request.projectId).find(candidate => candidate.id === request.entryId)
    if (entry === undefined) return refuse('not-found', `no vocab entry ${JSON.stringify(request.entryId)}`)
    const { source } = entry
    if (source.kind !== 'photo' || source.attachmentId === undefined) {
      return refuse('invalid', `entry ${entry.id} has no photo provenance — only a photo-sourced card carries an attachment to read back`)
    }
    if (source.mediaType === undefined || source.bytes === undefined || source.width === undefined || source.height === undefined) {
      return refuse('ref-incomplete', `entry ${entry.id} records only the attachment id — the durable reference (mediaType/bytes/width/height) is what readImage verifies against; re-log the card from the message's image block to fill it`)
    }
    const attachments = this.ctx.get('attachments') as AttachmentsSlice | undefined
    if (attachments === undefined) {
      return refuse('unavailable', 'this deployment mounts no attachment store — the photo cannot be read back here')
    }
    try {
      const stored = await attachments.readImage({
        attachmentId: source.attachmentId,
        mediaType: source.mediaType,
        bytes: source.bytes,
        width: source.width,
        height: source.height,
      })
      return { ok: true, data: Buffer.from(stored.data).toString('base64'), mediaType: stored.ref.mediaType }
    } catch (error) {
      return refuse('io', `the attachment could not be read — ${libraryErrorMessage(error)}`)
    }
  }

  /* --------------------------------------------------------------- stats */

  /** The whole-library tally (the tool's `stats` answer). */
  async stats(): Promise<{
    projects: number
    books: number
    vocab: number
    due: number
    quizzes: number
    attempts: number
    boxHistogram: Record<string, number>
  }> {
    const index = this.store.readIndex()
    const now = new Date().toISOString()
    let books = 0
    let vocab = 0
    let due = 0
    let quizzes = 0
    let attempts = 0
    const boxHistogram: Record<string, number> = {}
    for (const project of index.projects) {
      books += this.store.listBooks(project.id).length
      quizzes += this.store.listQuizzes(project.id).length
      attempts += this.store.readAttempts(project.id).length
      for (const entry of this.store.readVocab(project.id)) {
        vocab += 1
        if (entry.mastery.dueAt <= now) due += 1
        boxHistogram[String(entry.mastery.box)] = (boxHistogram[String(entry.mastery.box)] ?? 0) + 1
      }
    }
    return { projects: index.projects.length, books, vocab, due, quizzes, attempts, boxHistogram }
  }

  /* -------------------------------------------------------------- helpers */

  /** The project, or a not-found refusal that teaches where the list lives. */
  private readProjectOrRefusal(id: string): { value: LibraryProject } | (LibraryRefusal & { error: LibraryErrorCode }) {
    const project = this.store.readProject(id)
    if (project === undefined) {
      return refuse('not-found', `no project ${JSON.stringify(id)} — library_read · projects lists every project; create one with library_write · project`)
    }
    return { value: project }
  }
}

/** Structural validation of a roadmap's nodes; returns the teaching error or undefined. */
export function validateRoadmapShape(nodes: readonly RoadmapNode[], book: LibraryBook): string | undefined {
  const seen = new Set<string>()
  for (const [index, node] of nodes.entries()) {
    if (node.id === '' || seen.has(node.id)) return `nodes[${index}] needs a unique id (n1, n2, … is plenty)`
    seen.add(node.id)
    if (node.title.trim() === '') return `nodes[${index}] (${node.id}) needs a title — what the learner masters here`
    for (const range of node.chapterRanges) {
      if (!Number.isInteger(range.from) || !Number.isInteger(range.to) || range.from < 1 || range.to < range.from) {
        return `nodes[${index}] (${node.id}) has a bad chapterRange [${String(range.from)}, ${String(range.to)}] — ranges are 1-based and inclusive: { from: 3, to: 5 }`
      }
      if (range.to > book.toc.length) {
        return `nodes[${index}] (${node.id}) covers up to chapter ${range.to}, but 《${book.title}》 has ${book.toc.length} chapters — library_read · toc lists them`
      }
    }
    for (const dep of node.dependsOn) {
      const depIndex = nodes.findIndex(candidate => candidate.id === dep)
      if (depIndex === -1) return `nodes[${index}] (${node.id}) depends on ${JSON.stringify(dep)}, which the roadmap does not declare`
      if (depIndex >= index) return `nodes[${index}] (${node.id}) depends on ${JSON.stringify(dep)}, which comes AFTER it — list a node after everything it depends on`
    }
    if (node.state !== 'locked') {
      const unmet = node.dependsOn.filter(dep => nodes.find(candidate => candidate.id === dep)?.state !== 'done')
      if (unmet.length > 0) {
        return `nodes[${index}] (${node.id}) is ${node.state} but depends on ${unmet.join(', ')} — only a node whose deps are all done may be current or done`
      }
    }
  }
  return undefined
}

/**
 * Transition validation against an existing roadmap: each surviving node's
 * state may stay or move exactly one edge forward (locked → current → done).
 * Returns the teaching error or undefined.
 */
export function validateRoadmapEdges(existing: LibraryRoadmap, nodes: readonly RoadmapNode[]): string | undefined {
  const prior = new Map(existing.nodes.map(node => [node.id, node.state]))
  const order: Record<RoadmapNode['state'], number> = { locked: 0, current: 1, done: 2 }
  for (const node of nodes) {
    const before = prior.get(node.id)
    if (before === undefined) continue
    const legal = node.state === before
      || (before === 'locked' && node.state === 'current')
      || (before === 'current' && node.state === 'done')
    if (!legal) {
      return `node ${JSON.stringify(node.id)} may not move ${before} → ${node.state}: the state machine's only edges are locked → current → done (a quiz at ≥ the pass ratio completes a current node; to re-split the book, pass regenerate: true). It moved ${order[before]} → ${order[node.state]}.`
    }
  }
  return undefined
}
