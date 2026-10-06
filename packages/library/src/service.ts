/**
 * The library service core: owns the store and every rule the data answers
 * to. The Remote face next door is a thin adapter with no logic of its own;
 * the model tools (`tool-definition.ts`) translate these same outcomes into
 * thrown, teaching errors.
 *
 * The rules that live here and nowhere else:
 *
 * - **Books are registered, never uploaded**: title, edition, kind and a
 *   table of contents with its source.
 * - **Roadmaps are drafted by the coach and adopted by the learner.** A draft
 *   is free to change; adoption initializes the state machine (roots
 *   `current`, the rest `locked`) and keeps the progress of nodes that survive
 *   a re-split. The adopted path only moves forward: `locked → current →
 *   done`, by an assessed quiz (quiz nodes) or 「读完」 (read nodes).
 * - **Cards dedupe on the write path** (`cards.ts`): an exact key merges,
 *   a near match is held back with candidates for the coach to decide.
 * - **Quiz questions carry two axes** — target (marked / asked / missed /
 *   topic) and evidence (photo / web / knowledge) — and a material book never
 *   takes a knowledge-backed question about its content.
 * - **The assess cascade** is the only cascading write: verdicts land in the
 *   ledger, then move the probed cards (mastery and weakness), then the gated
 *   node's stats; a node at or above its pass ratio completes and unlocks.
 * - **Photo provenance is a reference, never a copy**, and reading the bytes
 *   back is whitelisted to pages the project recorded.
 *
 * @module @khorsheed/dsh-library/service
 */
import type { Context } from '@deepseek-ai/cordis'
import {
  DEFAULT_PASS_RATIO,
  LEITNER_INTERVAL_DAYS,
  libraryErrorMessage,
  MAX_BOX,
  MAX_WEAKNESS,
  type LibraryAssessResult,
  type LibraryAttachmentRef,
  type LibraryAttempt,
  type LibraryBinding,
  type LibraryBook,
  type LibraryBookKind,
  type LibraryBookProgress,
  type LibraryCardQuery,
  type LibraryCard,
  type LibraryCardInput,
  type LibraryCardKind,
  type LibraryCardPending,
  type LibraryCardUpdate,
  type LibraryCardWriteResult,
  type LibraryErrorCode,
  type LibraryEvent,
  type LibraryEventType,
  type LibraryMark,
  type LibraryOutcome,
  type LibraryPage,
  type LibraryProject,
  type LibraryProjectSummary,
  type LibraryQuiz,
  type LibraryQuizQuestion,
  type LibraryRefusal,
  type LibraryReviewRating,
  type LibraryRoadmap,
  type LibraryTemplate,
  type LibraryTocSource,
  type LibraryVerdict,
  type RoadmapNode,
} from './types.ts'
import { cardKey, cardKeys, cardMatchesQuery, exactMatch, nearMatches } from './cards.ts'
import { LibraryStore, LibraryStoreError, mintLibraryId } from './store.ts'

/** The attachment store's faces, mirrored structurally (probed, never injected). */
interface AttachmentsSlice {
  readImage(ref: LibraryAttachmentRef): Promise<{ data: Uint8Array; ref: { mediaType: string } }>
  saveImage?(input: { data: Uint8Array; mediaType: string }): Promise<LibraryAttachmentRef>
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

const DAY_MS = 24 * 60 * 60 * 1000

/** The Leitner due date for a box: box b waits INTERVALS[min(b, 4)] days. */
export function leitnerDueAt(box: number, from: Date = new Date()): string {
  const days = LEITNER_INTERVAL_DAYS[Math.min(Math.max(box, 0), LEITNER_INTERVAL_DAYS.length - 1)]!
  return new Date(from.getTime() + days * DAY_MS).toISOString()
}

/** Whitespace-normalize a quote before comparing it with a page's text. */
function normalizeFragment(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase()
}

/** Clamp a weakness score into 0..MAX. */
function clampWeakness(value: number): number {
  return Math.min(Math.max(value, 0), MAX_WEAKNESS)
}

/** Live = not deleted. */
function live(card: LibraryCard): boolean {
  return card.status !== 'deleted'
}

/**
 * The library's service core. Constructing it never throws and never touches
 * the disk: the store probes writability lazily, so a read-only deployment
 * boots and answers `storage-unavailable` on writes.
 */
export class LibraryService {
  /** The store; public for the package's own tests and diagnostics. */
  readonly store: LibraryStore
  /** Listeners told after every project mutation (the tab's live refresh, the context cache). */
  private readonly listeners = new Set<(projectId: string) => void>()

  constructor(
    private readonly ctx: Context,
    config: { stateRoot?: string } = {},
  ) {
    this.store = new LibraryStore(config)
  }

  /** Subscribe to project mutations; returns the unsubscribe. */
  onChange(listener: (projectId: string) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private changed(projectId: string): void {
    for (const listener of this.listeners) {
      try {
        listener(projectId)
      } catch {
        // A listener's failure is its own.
      }
    }
  }

  /** Run a project mutation under its lock, then notify. */
  private async mutate<T>(projectId: string, fn: () => Promise<LibraryOutcome<T>> | LibraryOutcome<T>): Promise<LibraryOutcome<T>> {
    try {
      const outcome = await this.store.withProjectLock(projectId, fn)
      if (outcome.ok) this.changed(projectId)
      return outcome
    } catch (error) {
      return storeRefusal(error)
    }
  }

  private event(projectId: string, type: LibraryEventType, fields: Omit<LibraryEvent, 'type' | 'at'> & { at?: string } = {}): void {
    this.store.appendEvents(projectId, [{ at: fields.at ?? new Date().toISOString(), type, ...fields }])
  }

  /* ------------------------------------------------------------ projects */

  /** One book's progress row. */
  private bookProgress(projectId: string, book: LibraryBook): LibraryBookProgress {
    const roadmap = this.store.readRoadmap(projectId, book.id)
    const current = roadmap?.nodes.find(node => node.state === 'current')
    return {
      id: book.id,
      title: book.title,
      ...(roadmap === undefined ? {} : {
        roadmap: { done: roadmap.nodes.filter(node => node.state === 'done').length, total: roadmap.nodes.length },
      }),
      ...(current === undefined ? {} : { current: { id: current.id, title: current.title } }),
      hasDraft: this.store.readRoadmap(projectId, book.id, 'draft') !== undefined,
    }
  }

  private summarize(project: LibraryProject): LibraryProjectSummary {
    const now = new Date().toISOString()
    const cards = this.store.readCards(project.id).filter(live)
    return {
      ...project,
      books: this.store.listBooks(project.id).map(book => this.bookProgress(project.id, book)),
      cardCount: cards.length,
      dueCount: cards.filter(card => card.status === 'active' && card.mastery.dueAt <= now).length,
    }
  }

  /** Every project with its books' progress and card tallies. */
  async listProjects(): Promise<{ projects: LibraryProjectSummary[] }> {
    return { projects: this.store.readIndex().projects.map(project => this.summarize(project)) }
  }

  /** One project's summary plus its books' metadata. */
  async getProject(request: { id: string }): Promise<LibraryOutcome<{ project: LibraryProjectSummary; books: LibraryBook[] }>> {
    const project = this.readProjectOrRefusal(request.id)
    if ('error' in project) return project
    return { ok: true, project: this.summarize(project.value), books: this.store.listBooks(project.value.id) }
  }

  /** Create a project. */
  async createProject(request: {
    name: string
    template?: LibraryTemplate
    templateNote?: string
    goal?: string
  }): Promise<LibraryOutcome<{ project: LibraryProject }>> {
    const name = request.name.trim()
    if (name === '') {
      return refuse('invalid', 'a project needs a name — what the learner calls the subject (「神经科学」「雅思」)')
    }
    if (request.template !== undefined && !['language', 'subject', 'custom'].includes(request.template)) {
      return refuse('invalid', 'template is language | subject | custom — language: marks are words; subject: marks are concepts')
    }
    try {
      const outcome = await this.store.withIndexLock(async () => {
        const index = this.store.readIndex()
        if (index.projects.some(project => project.name === name)) {
          return refuse('exists', `a project named ${JSON.stringify(name)} already exists — open it (library_read · projects) instead of creating a twin`)
        }
        const project: LibraryProject = {
          id: mintLibraryId('p'),
          name,
          template: request.template ?? 'subject',
          ...(request.templateNote === undefined || request.templateNote.trim() === '' ? {} : { templateNote: request.templateNote.trim() }),
          ...(request.goal === undefined || request.goal.trim() === '' ? {} : { goal: request.goal.trim() }),
          createdAt: new Date().toISOString(),
        }
        this.store.writeProject(project)
        this.store.writeIndex({ ...index, projects: [...index.projects, project] })
        return { ok: true as const, project }
      })
      if (outcome.ok) this.changed(outcome.project.id)
      return outcome
    } catch (error) {
      return storeRefusal(error)
    }
  }

  /** Delete a project and everything it holds. */
  async deleteProject(request: { id: string }): Promise<LibraryOutcome<{ id: string }>> {
    try {
      const outcome = await this.store.withIndexLock(async () => {
        const index = this.store.readIndex()
        if (!index.projects.some(project => project.id === request.id)) {
          return refuse('not-found', `no project ${JSON.stringify(request.id)} — library_read · projects lists the ones that exist`)
        }
        this.store.removeProject(request.id)
        this.store.writeIndex({ ...index, projects: index.projects.filter(project => project.id !== request.id) })
        return { ok: true as const, id: request.id }
      })
      if (outcome.ok) this.changed(request.id)
      return outcome
    } catch (error) {
      return storeRefusal(error)
    }
  }

  /* --------------------------------------------------------------- books */

  /**
   * Register a book (or correct one: pass `bookId`). The table of contents is
   * the coach's — verified on the web whenever it can be — and roadmap ranges
   * count its rows.
   */
  async putBook(request: {
    projectId: string
    bookId?: string
    title: string
    author?: string
    edition?: string
    isbn?: string
    bookKind: LibraryBookKind
    toc: readonly { title: string; part?: string }[]
    tocSource: LibraryTocSource
  }): Promise<LibraryOutcome<{ book: LibraryBook }>> {
    const title = request.title.trim()
    if (title === '') return refuse('invalid', 'a book needs its title — and the edition, when the book has several')
    if (request.bookKind !== 'knowledge' && request.bookKind !== 'material') {
      return refuse('invalid', 'bookKind is knowledge | material — knowledge: a textbook or popular science (its content is domain knowledge); material: exam papers, novels, anthologies (specific text you cannot recall)')
    }
    const toc = request.toc.filter(entry => entry.title.trim() !== '')
    if (toc.length === 0) {
      return refuse('invalid', 'a book needs its table of contents — search the web for the edition\'s contents (publisher page, library catalog), or ask the learner to photograph the contents page; each row: { title, part? }')
    }
    if (!['web', 'model', 'photo'].includes(request.tocSource.by)) {
      return refuse('invalid', 'tocSource.by is web | model | photo — say where the contents came from; web needs the url')
    }
    if (request.tocSource.by === 'web' && (request.tocSource.url === undefined || !/^https?:\/\//.test(request.tocSource.url))) {
      return refuse('invalid', 'a web-sourced table of contents carries the url it came from (tocSource.url) — the learner checks it on the draft card')
    }
    const project = this.readProjectOrRefusal(request.projectId)
    if ('error' in project) return project
    return await this.mutate(project.value.id, () => {
      const existing = request.bookId === undefined ? undefined : this.store.readBook(project.value.id, request.bookId)
      if (request.bookId !== undefined && existing === undefined) {
        return refuse('not-found', `no book ${JSON.stringify(request.bookId)} in this project — omit bookId to add a new book`)
      }
      if (existing === undefined && this.store.listBooks(project.value.id).some(book => book.title === title && book.edition === request.edition?.trim())) {
        return refuse('exists', `《${title}》 is already on this project's shelf — pass its bookId to correct it`)
      }
      const now = new Date().toISOString()
      const book: LibraryBook = {
        id: existing?.id ?? mintLibraryId('b'),
        title,
        ...(request.author === undefined || request.author.trim() === '' ? {} : { author: request.author.trim() }),
        ...(request.edition === undefined || request.edition.trim() === '' ? {} : { edition: request.edition.trim() }),
        ...(request.isbn === undefined || request.isbn.trim() === '' ? {} : { isbn: request.isbn.trim() }),
        bookKind: request.bookKind,
        toc: toc.map((entry, index) => ({
          n: index + 1,
          title: entry.title.trim(),
          ...(entry.part === undefined || entry.part.trim() === '' ? {} : { part: entry.part.trim() }),
        })),
        tocSource: { ...request.tocSource, verifiedAt: request.tocSource.verifiedAt ?? now },
        createdAt: existing?.createdAt ?? now,
      }
      this.store.writeBook(project.value.id, book)
      if (existing === undefined) this.event(project.value.id, 'book.added', { id: book.id, title: book.title, bookId: book.id, count: book.toc.length })
      return { ok: true as const, book }
    })
  }

  /** Remove a book: its metadata, roadmaps and pages (cards stay, unhung). */
  async deleteBook(request: { projectId: string; bookId: string }): Promise<LibraryOutcome<{ id: string }>> {
    const project = this.readProjectOrRefusal(request.projectId)
    if ('error' in project) return project
    return await this.mutate(project.value.id, () => {
      if (this.store.readBook(project.value.id, request.bookId) === undefined) {
        return refuse('not-found', `no book ${JSON.stringify(request.bookId)} in this project`)
      }
      this.store.removeBook(project.value.id, request.bookId)
      const cards = this.store.readCards(project.value.id)
      if (cards.some(card => card.bookId === request.bookId)) {
        this.store.writeCards(project.value.id, cards.map(card => {
          if (card.bookId !== request.bookId) return card
          const { bookId: _dropped, ...rest } = card
          return rest
        }))
      }
      return { ok: true as const, id: request.bookId }
    })
  }

  /** One book with its table of contents. */
  async getBook(request: { projectId: string; bookId: string }): Promise<LibraryOutcome<{ book: LibraryBook }>> {
    const book = this.store.readBook(request.projectId, request.bookId)
    if (book === undefined) return refuse('not-found', `no book ${JSON.stringify(request.bookId)} — library_read · books lists the project's`)
    return { ok: true, book }
  }

  /* ------------------------------------------------------------- roadmap */

  /** One book's adopted roadmap and its pending draft. */
  async getRoadmap(request: { projectId: string; bookId: string }): Promise<{ roadmap?: LibraryRoadmap; draft?: LibraryRoadmap }> {
    const roadmap = this.store.readRoadmap(request.projectId, request.bookId)
    const draft = this.store.readRoadmap(request.projectId, request.bookId, 'draft')
    return { ...(roadmap === undefined ? {} : { roadmap }), ...(draft === undefined ? {} : { draft }) }
  }

  /**
   * Write the coach's draft for one book. Shape rules: unique ids, a kind,
   * ranges inside the table of contents, dependencies pointing backwards.
   * States are not the coach's to set — adoption initializes them.
   */
  async draftRoadmap(request: {
    projectId: string
    bookId: string
    nodes: readonly { id: string; title: string; kind: RoadmapNode['kind']; goals?: readonly string[]; chapterRanges?: readonly { from: number; to: number }[]; dependsOn?: readonly string[] }[]
    passRatio?: number
    note?: string
  }): Promise<LibraryOutcome<{ draft: LibraryRoadmap }>> {
    const project = this.readProjectOrRefusal(request.projectId)
    if ('error' in project) return project
    const book = this.store.readBook(project.value.id, request.bookId)
    if (book === undefined) {
      return refuse('not-found', `no book ${JSON.stringify(request.bookId)} in project ${JSON.stringify(project.value.name)} — a roadmap rides a book; library_read · books lists them`)
    }
    if (request.nodes.length === 0) {
      return refuse('invalid', 'a roadmap needs at least one node — split the table of contents into learning units; each: { id, title, kind: "quiz"|"read", goals, chapterRanges: [{ from, to }], dependsOn }')
    }
    if (request.passRatio !== undefined && !(request.passRatio > 0 && request.passRatio <= 1)) {
      return refuse('invalid', 'passRatio is a fraction in (0, 1] — 0.8 means 8 of 10 right')
    }
    const nodes: RoadmapNode[] = request.nodes.map(node => ({
      id: node.id,
      title: node.title,
      kind: node.kind,
      goals: node.goals ?? [],
      chapterRanges: node.chapterRanges ?? [],
      dependsOn: node.dependsOn ?? [],
      state: 'locked',
    }))
    const shapeError = validateRoadmapShape(nodes, book)
    if (shapeError !== undefined) return refuse('invalid', shapeError)
    return await this.mutate(project.value.id, () => {
      const draft: LibraryRoadmap = {
        bookId: book.id,
        status: 'draft',
        nodes,
        ...(request.passRatio === undefined ? {} : { passRatio: request.passRatio }),
        ...(request.note === undefined || request.note.trim() === '' ? {} : { note: request.note.trim() }),
        generatedAt: new Date().toISOString(),
      }
      this.store.writeRoadmap(project.value.id, draft)
      this.event(project.value.id, 'roadmap.drafted', { id: book.id, title: book.title, bookId: book.id, count: nodes.length })
      return { ok: true as const, draft }
    })
  }

  /**
   * The learner's 采用: the draft becomes the book's path. Nodes whose deps are
   * all done start `current`; a node that survives a re-split (same id) keeps
   * its state and quiz stats, so re-planning never erases progress.
   */
  async adoptRoadmap(request: { projectId: string; bookId: string }): Promise<LibraryOutcome<{ roadmap: LibraryRoadmap }>> {
    const project = this.readProjectOrRefusal(request.projectId)
    if ('error' in project) return project
    return await this.mutate(project.value.id, () => {
      const draft = this.store.readRoadmap(project.value.id, request.bookId, 'draft')
      if (draft === undefined) return refuse('not-found', 'this book has no draft to adopt — ask the coach to draft a roadmap first')
      const prior = new Map((this.store.readRoadmap(project.value.id, request.bookId)?.nodes ?? []).map(node => [node.id, node]))
      const nodes: RoadmapNode[] = []
      for (const node of draft.nodes) {
        const kept = prior.get(node.id)
        const doneIds = new Set(nodes.filter(candidate => candidate.state === 'done').map(candidate => candidate.id))
        const ready = node.dependsOn.every(dep => doneIds.has(dep))
        const state: RoadmapNode['state'] = kept?.state === 'done' && ready ? 'done' : ready ? 'current' : 'locked'
        nodes.push({
          ...node,
          state,
          ...(node.kind === 'quiz' ? { quizStats: kept?.quizStats ?? { attempts: 0 } } : {}),
        })
      }
      const now = new Date().toISOString()
      const roadmap: LibraryRoadmap = { ...draft, status: 'adopted', nodes, adoptedAt: now }
      this.store.writeRoadmap(project.value.id, roadmap)
      this.store.removeDraft(project.value.id, request.bookId)
      const book = this.store.readBook(project.value.id, request.bookId)
      this.event(project.value.id, 'roadmap.adopted', { at: now, id: request.bookId, title: book?.title ?? '', bookId: request.bookId, count: nodes.length })
      return { ok: true as const, roadmap }
    })
  }

  /** Drop a book's draft without adopting it. */
  async discardDraft(request: { projectId: string; bookId: string }): Promise<LibraryOutcome<{ bookId: string }>> {
    const project = this.readProjectOrRefusal(request.projectId)
    if ('error' in project) return project
    return await this.mutate(project.value.id, () => {
      this.store.removeDraft(project.value.id, request.bookId)
      return { ok: true as const, bookId: request.bookId }
    })
  }

  /** 「读完」: a current read node completes and unlocks what it gates. */
  async markNodeRead(request: { projectId: string; bookId: string; nodeId: string }): Promise<LibraryOutcome<{ roadmap: LibraryRoadmap; unlocked: string[] }>> {
    const project = this.readProjectOrRefusal(request.projectId)
    if ('error' in project) return project
    return await this.mutate(project.value.id, () => {
      const roadmap = this.store.readRoadmap(project.value.id, request.bookId)
      const node = roadmap?.nodes.find(candidate => candidate.id === request.nodeId)
      if (roadmap === undefined || node === undefined) return refuse('not-found', `no node ${JSON.stringify(request.nodeId)} on this book's adopted path`)
      if (node.kind !== 'read') return refuse('state-machine', `${node.title} is a quiz node — it completes by passing its chapter quiz, not by 读完`)
      if (node.state !== 'current') return refuse('state-machine', `${node.title} is ${node.state} — only a current node can be marked read`)
      const now = new Date().toISOString()
      const completed = roadmap.nodes.map(candidate => candidate.id === node.id ? { ...candidate, state: 'done' as const } : candidate)
      const { nodes, unlocked } = unlockReady(completed)
      const next: LibraryRoadmap = { ...roadmap, nodes }
      this.store.writeRoadmap(project.value.id, next)
      this.store.appendEvents(project.value.id, [
        { at: now, type: 'node.completed', id: node.id, title: node.title, bookId: request.bookId },
        ...unlocked.map(nodeId => ({ at: now, type: 'node.unlocked' as const, id: nodeId, title: titleOf(nodes, nodeId), bookId: request.bookId })),
      ])
      return { ok: true as const, roadmap: next, unlocked }
    })
  }

  /* --------------------------------------------------------------- pages */

  /**
   * Record one photographed page and card every mark at once (「一键全收」).
   * Uncertain marks are kept on the page but never carded — the learner
   * decides them. Each card's gloss is the mark's recognized gloss, else the
   * learner's handwriting, else a placeholder the learner can fill in.
   */
  async recordPage(request: {
    projectId: string
    bookId: string
    nodeId?: string
    label?: string
    attachment: LibraryAttachmentRef
    text: string
    marks: readonly LibraryMark[]
  }): Promise<LibraryOutcome<{ page: LibraryPage; cards: LibraryCardWriteResult; uncertain: string[] }>> {
    const project = this.readProjectOrRefusal(request.projectId)
    if ('error' in project) return project
    const book = this.store.readBook(project.value.id, request.bookId)
    if (book === undefined) return refuse('not-found', `no book ${JSON.stringify(request.bookId)} in this project — a page belongs to a book`)
    const ref = request.attachment
    if (typeof ref?.attachmentId !== 'string' || typeof ref.mediaType !== 'string' || typeof ref.bytes !== 'number' || typeof ref.width !== 'number' || typeof ref.height !== 'number') {
      return refuse('ref-incomplete', 'attachment needs the image block\'s whole durable reference — { attachmentId, mediaType, bytes, width, height }, copied verbatim; the photo itself is never copied')
    }
    if (request.text.trim() === '') {
      return refuse('invalid', 'text is the page\'s printed text as recognized — a photo-backed question quotes it, so transcribe the page, not only the marks')
    }
    const marks = request.marks.filter(mark => mark.text.trim() !== '')
    const pageId = mintLibraryId('pg')
    const nodeId = request.nodeId
    if (nodeId !== undefined) {
      const roadmap = this.store.readRoadmap(project.value.id, book.id)
      if (roadmap !== undefined && !roadmap.nodes.some(node => node.id === nodeId)) {
        return refuse('not-found', `no node ${JSON.stringify(nodeId)} on this book's path — omit nodeId or read the roadmap`)
      }
    }
    const kind: LibraryCardKind = project.value.template === 'language' ? 'word' : 'concept'
    const inputs: LibraryCardInput[] = marks.filter(mark => mark.uncertain !== true).map(mark => ({
      kind,
      term: mark.text,
      gloss: mark.gloss ?? mark.handNote ?? '（待补释义）',
      ...(mark.handNote === undefined ? {} : { userGloss: mark.handNote }),
      ...(mark.sentence === undefined ? {} : { context: { sentence: mark.sentence, pageId, ...(nodeId === undefined ? {} : { nodeId }) } }),
      source: { type: 'photo' as const, ref: pageId, ...(request.label === undefined ? {} : { note: request.label }) },
      bookId: book.id,
    }))
    return await this.mutate(project.value.id, () => {
      const cards = this.applyCardInputs(project.value.id, inputs, book.id, { mergeNear: kind === 'word' })
      const page: LibraryPage = {
        id: pageId,
        bookId: book.id,
        ...(nodeId === undefined ? {} : { nodeId }),
        ...(request.label === undefined || request.label.trim() === '' ? {} : { label: request.label.trim() }),
        attachment: { attachmentId: ref.attachmentId, mediaType: ref.mediaType, bytes: ref.bytes, width: ref.width, height: ref.height },
        text: request.text,
        marks,
        cardIds: [...cards.added, ...cards.merged].map(card => card.id),
        at: new Date().toISOString(),
      }
      this.store.appendPage(project.value.id, page)
      this.event(project.value.id, 'page.recorded', { id: page.id, title: page.label ?? book.title, bookId: book.id, count: cards.added.length, count2: cards.merged.length })
      return { ok: true as const, page, cards, uncertain: marks.filter(mark => mark.uncertain === true).map(mark => mark.text) }
    })
  }

  /** One book's pages, optionally one node's. */
  async listPages(request: { projectId: string; bookId: string; nodeId?: string }): Promise<{ pages: LibraryPage[] }> {
    const pages = this.store.readPages(request.projectId, request.bookId)
    return { pages: request.nodeId === undefined ? pages : pages.filter(page => page.nodeId === request.nodeId) }
  }

  /** Find one page anywhere in the project. */
  private findPage(projectId: string, pageId: string): LibraryPage | undefined {
    for (const book of this.store.listBooks(projectId)) {
      const page = this.store.readPages(projectId, book.id).find(candidate => candidate.id === pageId)
      if (page !== undefined) return page
    }
    return undefined
  }

  /**
   * One page's photo, as base64 — whitelisted: the page must be one this
   * project recorded, so the Remote never reads an arbitrary attachment.
   */
  async readPagePhoto(request: { projectId: string; pageId: string }): Promise<LibraryOutcome<{ data: string; mediaType: string }>> {
    const page = this.findPage(request.projectId, request.pageId)
    if (page === undefined) return refuse('not-found', `no page ${JSON.stringify(request.pageId)} in this project`)
    const attachments = this.ctx.get('attachments') as AttachmentsSlice | undefined
    if (attachments === undefined) return refuse('unavailable', 'this deployment mounts no attachment store — the photo cannot be read back here')
    try {
      const stored = await attachments.readImage(page.attachment)
      return { ok: true, data: Buffer.from(stored.data).toString('base64'), mediaType: stored.ref.mediaType }
    } catch (error) {
      return refuse('io', `the photo could not be read — ${libraryErrorMessage(error)}`)
    }
  }

  /** Save a browser-uploaded photo into the host attachment store (the sidebar's 拍照). */
  async savePhoto(request: { data: string; mediaType: string }): Promise<LibraryOutcome<{ attachment: LibraryAttachmentRef }>> {
    const attachments = this.ctx.get('attachments') as AttachmentsSlice | undefined
    if (attachments?.saveImage === undefined) return refuse('unavailable', 'this deployment mounts no attachment store — photos cannot be saved here')
    try {
      const attachment = await attachments.saveImage({ data: Buffer.from(request.data, 'base64'), mediaType: request.mediaType })
      return { ok: true, attachment }
    } catch (error) {
      return refuse('invalid', `the photo was refused — ${libraryErrorMessage(error)}`)
    }
  }

  /* --------------------------------------------------------------- cards */

  /**
   * Apply card inputs to the project's cards (call inside the project lock).
   * Exact keys merge; near matches are held back unless `mergeNear` (photo
   * words — a plural or a case away is the same word) or the input decides.
   */
  private applyCardInputs(
    projectId: string,
    inputs: readonly LibraryCardInput[],
    defaultBookId: string | undefined,
    options: { mergeNear?: boolean } = {},
  ): LibraryCardWriteResult & { at: string } {
    const cards = this.store.readCards(projectId)
    const byId = new Map(cards.map(card => [card.id, card]))
    const order = cards.map(card => card.id)
    const added: LibraryCard[] = []
    const merged: LibraryCard[] = []
    const pending: LibraryCardPending[] = []
    const now = new Date().toISOString()
    for (const [index, input] of inputs.entries()) {
      const keys = [input.term, ...(input.aliases ?? [])].map(cardKey).filter(key => key !== '')
      const pool = [...byId.values()]
      let target: LibraryCard | undefined
      if (input.mergeInto !== undefined) {
        target = byId.get(input.mergeInto)
      } else if (input.asNew !== true) {
        target = exactMatch(pool, keys)
        if (target === undefined) {
          const near = nearMatches(pool, keys)
          if (near.length > 0) {
            if (options.mergeNear === true) {
              target = near[0]
            } else {
              pending.push({ index, term: input.term, candidates: near.map(card => ({ id: card.id, term: card.term, gloss: card.gloss })) })
              continue
            }
          }
        }
      }
      const bookId = input.bookId ?? defaultBookId
      const source = {
        type: input.source.type,
        ...(input.source.ref === undefined ? {} : { ref: input.source.ref }),
        ...(input.source.note === undefined || input.source.note.trim() === '' ? {} : { note: input.source.note.trim() }),
        ...(input.weaken === true ? { weakened: true } : {}),
        at: now,
      }
      const context = input.context === undefined || input.context.sentence.trim() === ''
        ? undefined
        : {
          sentence: input.context.sentence.trim(),
          ...(bookId === undefined ? {} : { bookId }),
          ...(input.context.pageId === undefined ? {} : { pageId: input.context.pageId }),
          ...(input.context.nodeId === undefined ? {} : { nodeId: input.context.nodeId }),
        }
      if (target !== undefined) {
        const aliases = new Set(target.aliases)
        const ownKeys = new Set(cardKeys(target))
        if (!ownKeys.has(cardKey(input.term))) aliases.add(input.term.trim())
        for (const alias of input.aliases ?? []) if (!ownKeys.has(cardKey(alias))) aliases.add(alias.trim())
        const placeholder = target.gloss === '（待补释义）'
        const next: LibraryCard = {
          ...target,
          aliases: [...aliases],
          gloss: placeholder ? input.gloss.trim() : target.gloss,
          ...(target.userGloss === undefined && input.userGloss !== undefined ? { userGloss: input.userGloss.trim() } : {}),
          contexts: context === undefined || target.contexts.some(existing => existing.sentence === context.sentence)
            ? target.contexts
            : [...target.contexts, context],
          ...(target.bookId === undefined && bookId !== undefined ? { bookId } : {}),
          sources: [...target.sources, source],
          weakness: clampWeakness(target.weakness + (input.weaken === true ? 1 : 0)),
          // A card met again is active again — a re-sighting never resets mastery.
          status: target.status === 'deleted' ? 'active' : target.status,
          updatedAt: now,
        }
        byId.set(next.id, next)
        merged.push(next)
        continue
      }
      const card: LibraryCard = {
        id: mintLibraryId('c'),
        kind: input.kind,
        term: input.term.trim(),
        aliases: (input.aliases ?? []).map(alias => alias.trim()).filter(alias => alias !== '' && cardKey(alias) !== cardKey(input.term)),
        gloss: input.gloss.trim(),
        ...(input.userGloss === undefined || input.userGloss.trim() === '' ? {} : { userGloss: input.userGloss.trim() }),
        contexts: context === undefined ? [] : [context],
        ...(bookId === undefined ? {} : { bookId }),
        sources: [source],
        weakness: input.weaken === true || input.source.type === 'chat' ? 1 : 0,
        mastery: { box: 0, dueAt: now, streak: 0 },
        status: 'active',
        createdAt: now,
        updatedAt: now,
      }
      byId.set(card.id, card)
      order.push(card.id)
      added.push(card)
    }
    if (added.length > 0 || merged.length > 0) {
      this.store.writeCards(projectId, order.map(cardId => byId.get(cardId)!))
      const touched = [...added, ...merged]
      const sourceType = inputs[0]?.source.type
      this.event(projectId, 'cards.recorded', {
        at: now,
        title: touched.map(card => card.term).join('、').slice(0, 300),
        ids: touched.map(card => card.id),
        ...(sourceType === undefined ? {} : { source: sourceType }),
        ...(defaultBookId === undefined ? {} : { bookId: defaultBookId }),
        count: added.length,
        count2: merged.length,
      })
    }
    return { added, merged, pending, at: now }
  }

  /**
   * Record cards (the coach's 「记下」, a manual add). Near-duplicates come back
   * in `pending` with their candidates — resend each with `mergeInto` or `asNew`.
   */
  async writeCards(request: {
    projectId: string
    bookId?: string
    cards: readonly LibraryCardInput[]
  }): Promise<LibraryOutcome<LibraryCardWriteResult>> {
    const project = this.readProjectOrRefusal(request.projectId)
    if ('error' in project) return project
    if (request.cards.length === 0) {
      return refuse('invalid', 'cards needs at least one card — each: { kind: word|concept, term, gloss, context?, source: { type: chat|photo|quiz|manual, note? }, weaken? }')
    }
    for (const [index, input] of request.cards.entries()) {
      if (input.kind !== 'word' && input.kind !== 'concept') return refuse('invalid', `cards[${index}].kind is word | concept`)
      if (input.term.trim() === '' || input.gloss.trim() === '') {
        return refuse('invalid', `cards[${index}] needs term and gloss — the gloss is the in-context meaning (a word) or a one-line explanation (a concept)`)
      }
      if (!['photo', 'chat', 'quiz', 'manual'].includes(input.source?.type)) {
        return refuse('invalid', `cards[${index}].source.type is chat | photo | quiz | manual — chat: the learner asked / got stuck in conversation`)
      }
    }
    const cards = this.store.readCards(project.value.id)
    for (const [index, input] of request.cards.entries()) {
      if (input.mergeInto !== undefined && !cards.some(card => card.id === input.mergeInto && live(card))) {
        return refuse('not-found', `cards[${index}].mergeInto names ${JSON.stringify(input.mergeInto)}, which is not a live card — use an id from the pending candidates`)
      }
    }
    if (request.bookId !== undefined && this.store.readBook(project.value.id, request.bookId) === undefined) {
      return refuse('not-found', `no book ${JSON.stringify(request.bookId)} in this project — omit bookId for a project-level card`)
    }
    return await this.mutate(project.value.id, () => {
      const { at: _at, ...result } = this.applyCardInputs(project.value.id, request.cards, request.bookId)
      return { ok: true as const, ...result }
    })
  }

  /** Cards, filtered and sorted (the sidebar list, the coach's search). */
  async listCards(request: LibraryCardQuery): Promise<{ cards: LibraryCard[]; total: number }> {
    const now = new Date().toISOString()
    let cards = this.store.readCards(request.projectId).filter(live)
    if (request.includeMastered !== true) cards = cards.filter(card => card.status === 'active')
    if (request.bookId !== undefined) cards = cards.filter(card => card.bookId === request.bookId)
    if (request.nodeId !== undefined) cards = cards.filter(card => card.contexts.some(context => context.nodeId === request.nodeId))
    if (request.kind !== undefined) cards = cards.filter(card => card.kind === request.kind)
    if (request.source !== undefined) cards = cards.filter(card => card.sources.some(source => source.type === request.source))
    if (request.weakMin !== undefined) cards = cards.filter(card => card.weakness >= request.weakMin!)
    if (request.due === true) cards = cards.filter(card => card.mastery.dueAt <= now)
    if (request.query !== undefined && request.query.trim() !== '') cards = cards.filter(card => cardMatchesQuery(card, request.query!))
    const sort = request.sort ?? 'weak'
    cards.sort((a, b) => sort === 'recent'
      ? b.updatedAt.localeCompare(a.updatedAt)
      : sort === 'due'
        ? a.mastery.dueAt.localeCompare(b.mastery.dueAt)
        : b.weakness - a.weakness || a.mastery.dueAt.localeCompare(b.mastery.dueAt))
    return { cards: cards.slice(0, request.limit ?? 200), total: cards.length }
  }

  /** The cards due for review across projects (or one), weakest first. */
  async dueCards(request: { projectId?: string; limit?: number }): Promise<{ cards: (LibraryCard & { projectId: string })[] }> {
    const now = new Date().toISOString()
    const projectIds = request.projectId !== undefined ? [request.projectId] : this.store.readIndex().projects.map(project => project.id)
    const due: (LibraryCard & { projectId: string })[] = []
    for (const projectId of projectIds) {
      for (const card of this.store.readCards(projectId)) {
        if (card.status === 'active' && card.mastery.dueAt <= now) due.push({ ...card, projectId })
      }
    }
    due.sort((a, b) => a.mastery.box - b.mastery.box || b.weakness - a.weakness || a.mastery.dueAt.localeCompare(b.mastery.dueAt))
    return { cards: due.slice(0, request.limit ?? 200) }
  }

  /** Edit a card by hand: its words, or its status (mastered / deleted / active). */
  async editCard(request: {
    projectId: string
    cardId: string
    patch: { term?: string; gloss?: string; userGloss?: string; aliases?: readonly string[]; status?: LibraryCard['status']; bookId?: string | null }
  }): Promise<LibraryOutcome<{ card: LibraryCard }>> {
    const project = this.readProjectOrRefusal(request.projectId)
    if ('error' in project) return project
    return await this.mutate(project.value.id, () => {
      const cards = this.store.readCards(project.value.id)
      const card = cards.find(candidate => candidate.id === request.cardId)
      if (card === undefined) return refuse('not-found', `no card ${JSON.stringify(request.cardId)}`)
      const patch = request.patch
      if (patch.term !== undefined && patch.term.trim() === '') return refuse('invalid', 'a card keeps a term')
      if (patch.gloss !== undefined && patch.gloss.trim() === '') return refuse('invalid', 'a card keeps a gloss')
      const { bookId: _old, ...rest } = card
      const next: LibraryCard = {
        ...(patch.bookId === null ? rest : card),
        ...(patch.term === undefined ? {} : { term: patch.term.trim() }),
        ...(patch.gloss === undefined ? {} : { gloss: patch.gloss.trim() }),
        ...(patch.userGloss === undefined ? {} : { userGloss: patch.userGloss.trim() }),
        ...(patch.aliases === undefined ? {} : { aliases: patch.aliases.map(alias => alias.trim()).filter(alias => alias !== '') }),
        ...(patch.status === undefined ? {} : { status: patch.status }),
        ...(typeof patch.bookId === 'string' ? { bookId: patch.bookId } : {}),
        updatedAt: new Date().toISOString(),
      }
      this.store.writeCards(project.value.id, cards.map(candidate => candidate.id === card.id ? next : candidate))
      this.event(project.value.id, 'card.edited', { id: card.id, title: next.term })
      return { ok: true as const, card: next }
    })
  }

  /**
   * Undo one recording (the toast's 撤销): cards it created are deleted; cards
   * it merged into lose the source it stacked (and the weakness it added).
   */
  async undoCards(request: { projectId: string; ids: readonly string[]; at: string }): Promise<LibraryOutcome<{ removed: number; reverted: number }>> {
    const project = this.readProjectOrRefusal(request.projectId)
    if ('error' in project) return project
    return await this.mutate(project.value.id, () => {
      const wanted = new Set(request.ids)
      let removed = 0
      let reverted = 0
      const cards = this.store.readCards(project.value.id).map(card => {
        if (!wanted.has(card.id)) return card
        if (card.createdAt === request.at) {
          removed += 1
          return { ...card, status: 'deleted' as const, updatedAt: new Date().toISOString() }
        }
        const dropped = card.sources.filter(source => source.at === request.at)
        if (dropped.length === 0) return card
        reverted += 1
        return {
          ...card,
          sources: card.sources.filter(source => source.at !== request.at),
          weakness: clampWeakness(card.weakness - dropped.filter(source => source.weakened === true).length),
          updatedAt: new Date().toISOString(),
        }
      })
      this.store.writeCards(project.value.id, cards)
      return { ok: true as const, removed, reverted }
    })
  }

  /**
   * One flashcard review (the daily 复习): only the schedule moves — forgot
   * resets to box 0 (tomorrow), fuzzy keeps the box, recalled climbs one.
   * Reviews never unlock nodes and never touch weakness.
   */
  async reviewCard(request: { projectId: string; cardId: string; rating: LibraryReviewRating }): Promise<LibraryOutcome<{ card: LibraryCard }>> {
    if (!['forgot', 'fuzzy', 'recalled'].includes(request.rating)) return refuse('invalid', 'rating is forgot | fuzzy | recalled')
    const project = this.readProjectOrRefusal(request.projectId)
    if ('error' in project) return project
    return await this.mutate(project.value.id, () => {
      const cards = this.store.readCards(project.value.id)
      const card = cards.find(candidate => candidate.id === request.cardId && live(candidate))
      if (card === undefined) return refuse('not-found', `no card ${JSON.stringify(request.cardId)}`)
      const now = new Date()
      const box = request.rating === 'forgot' ? 0 : request.rating === 'fuzzy' ? card.mastery.box : Math.min(card.mastery.box + 1, MAX_BOX)
      const next: LibraryCard = {
        ...card,
        mastery: {
          box,
          dueAt: leitnerDueAt(box, now),
          streak: request.rating === 'recalled' ? card.mastery.streak + 1 : 0,
        },
        updatedAt: now.toISOString(),
      }
      this.store.writeCards(project.value.id, cards.map(candidate => candidate.id === card.id ? next : candidate))
      return { ok: true as const, card: next }
    })
  }

  /* -------------------------------------------------------------- quizzes */

  /** A project's quizzes, optionally one book's / node's. */
  async listQuizzes(request: { projectId: string; bookId?: string; nodeId?: string }): Promise<{ quizzes: LibraryQuiz[] }> {
    return {
      quizzes: this.store.listQuizzes(request.projectId).filter(quiz =>
        (request.bookId === undefined || quiz.scope.bookId === request.bookId)
        && (request.nodeId === undefined || quiz.scope.nodeId === request.nodeId)),
    }
  }

  /** One quiz, whole. */
  async getQuiz(request: { projectId: string; quizId: string }): Promise<LibraryOutcome<{ quiz: LibraryQuiz }>> {
    const quiz = this.store.readQuiz(request.projectId, request.quizId)
    if (quiz === undefined) return refuse('not-found', `no quiz ${JSON.stringify(request.quizId)} — library_read · quiz without an id lists the project's`)
    return { ok: true, quiz }
  }

  /**
   * Store a quiz behind the two-axis checks. Target: a marked / asked / missed
   * question names the live cards it probes. Evidence: a photo quote names a
   * recorded page (a quote the page text lacks comes back as a warning); a web
   * quote carries its url; knowledge is allowed on knowledge books, and on
   * material books only for card drills — never for the book's content.
   */
  async putQuiz(request: {
    projectId: string
    quiz: { scope: { bookId: string; nodeId?: string }; questions: readonly LibraryQuizQuestion[] }
  }): Promise<LibraryOutcome<{ quiz: LibraryQuiz; warnings: string[] }>> {
    const project = this.readProjectOrRefusal(request.projectId)
    if ('error' in project) return project
    const book = this.store.readBook(project.value.id, request.quiz.scope.bookId)
    if (book === undefined) {
      return refuse('not-found', `quiz scope names book ${JSON.stringify(request.quiz.scope.bookId)}, which project ${JSON.stringify(project.value.name)} does not hold — library_read · books lists them`)
    }
    if (request.quiz.questions.length === 0) {
      return refuse('invalid', 'a quiz needs at least one question — each: { id, kind, prompt, options?, answer, explanation?, target: { kind, cardIds? }, evidence: { kind, pageId?, url?, quote? } }')
    }
    const nodeId = request.quiz.scope.nodeId
    if (nodeId !== undefined) {
      const roadmap = this.store.readRoadmap(project.value.id, book.id)
      const node = roadmap?.nodes.find(candidate => candidate.id === nodeId)
      if (node === undefined) return refuse('not-found', `quiz scope names node ${JSON.stringify(nodeId)}, which this book's adopted path does not hold — library_read · roadmap lists the nodes`)
      if (node.kind === 'read') return refuse('invalid', `${node.title} is a read node — it has no quiz gate; quiz a quiz-kind node, or leave scope.node off for a free practice quiz`)
    }
    const liveCards = new Set(this.store.readCards(project.value.id).filter(live).map(card => card.id))
    const pages = new Map(this.store.readPages(project.value.id, book.id).map(page => [page.id, page]))
    const seenIds = new Set<string>()
    const warnings: string[] = []
    for (const [index, question] of request.quiz.questions.entries()) {
      const label = `questions[${index}]${question.id === '' ? '' : ` (${question.id})`}`
      if (question.id === '' || seenIds.has(question.id)) return refuse('evidence-gate', `${label} needs a unique id — q1, q2, … is plenty`)
      seenIds.add(question.id)
      if (!['choice', 'fill', 'free'].includes(question.kind)) return refuse('evidence-gate', `${label}.kind is choice | fill | free`)
      if (question.prompt.trim() === '' || question.answer.trim() === '') {
        return refuse('evidence-gate', `${label} needs both a prompt and an answer — a question without its answer cannot be graded`)
      }
      if (question.kind === 'choice' && (question.options === undefined || question.options.length < 2)) {
        return refuse('evidence-gate', `${label} is a choice question with fewer than two options`)
      }
      const target = question.target
      if (target === undefined || !['marked', 'asked', 'missed', 'topic'].includes(target.kind)) {
        return refuse('evidence-gate', `${label} needs target: { kind: marked|asked|missed|topic, cardIds? } — what the question aims at: the learner's marked cards, the points they asked about, the ones they missed before, or the chapter's topic`)
      }
      if (target.kind !== 'topic') {
        if (target.cardIds === undefined || target.cardIds.length === 0) {
          return refuse('evidence-gate', `${label} targets ${target.kind} cards but names none — target.cardIds lists the cards it probes (library_read · cards finds them)`)
        }
        const unknown = target.cardIds.filter(cardId => !liveCards.has(cardId))
        if (unknown.length > 0) return refuse('evidence-gate', `${label} names cards that do not exist: ${unknown.join(', ')} — use ids from library_read · cards`)
      }
      const evidence = question.evidence
      if (evidence === undefined || !['photo', 'web', 'knowledge'].includes(evidence.kind)) {
        return refuse('evidence-gate', `${label} needs evidence: { kind: photo|web|knowledge, … } — what the answer rests on`)
      }
      if (evidence.kind === 'photo') {
        const page = evidence.pageId === undefined ? undefined : pages.get(evidence.pageId)
        if (page === undefined) return refuse('evidence-gate', `${label} rests on a photo but names no page of this book — evidence.pageId comes from library_read · pages`)
        const quote = normalizeFragment(evidence.quote ?? '')
        if (quote.length < 4) return refuse('evidence-gate', `${label} rests on a photo — quote the printed passage (evidence.quote) the answer comes from`)
        if (!normalizeFragment(page.text).includes(quote)) warnings.push(`${label}: its quote is not verbatim in page ${page.label ?? page.id}'s text — stored; re-read the page and fix the quote`)
      }
      if (evidence.kind === 'web') {
        if (evidence.url === undefined || !/^https?:\/\//.test(evidence.url)) return refuse('evidence-gate', `${label} rests on the web — evidence.url is the page the quote is from`)
        if (normalizeFragment(evidence.quote ?? '').length < 8) return refuse('evidence-gate', `${label} rests on the web — quote the passage (a sentence or two) so the learner can check it`)
      }
      if (evidence.kind === 'knowledge' && book.bookKind === 'material' && target.kind === 'topic') {
        return refuse('evidence-gate', `${label} asks about 《${book.title}》's content from memory — it is a material book (specific text you cannot recall reliably). Quote a photographed page (evidence.kind photo) or a web copy (web, with url), or drill the learner's cards instead`)
      }
    }
    return await this.mutate(project.value.id, () => {
      const quiz: LibraryQuiz = {
        id: mintLibraryId('q'),
        scope: { bookId: book.id, ...(nodeId === undefined ? {} : { nodeId }) },
        questions: request.quiz.questions,
        createdAt: new Date().toISOString(),
      }
      this.store.writeQuiz(project.value.id, quiz)
      this.event(project.value.id, 'quiz.created', { at: quiz.createdAt, id: quiz.id, bookId: book.id, count: quiz.questions.length })
      return { ok: true as const, quiz, warnings }
    })
  }

  /* ------------------------------------------------------------- attempts */

  /**
   * Grade a sitting — the only cascading write. Void verdicts count for
   * nothing. Every probed card moves: a pass climbs a Leitner box and eases
   * weakness by one; a fail resets to box 0 (due tomorrow) and adds weakness.
   * A failed question with no card gets one (`missedCard`, or its prompt).
   * The gated node's stats update; at or above the pass ratio it completes
   * and unlocks its dependents.
   */
  async putAttempt(request: {
    projectId: string
    quizId: string
    verdicts: readonly LibraryVerdict[]
  }): Promise<LibraryOutcome<LibraryAssessResult>> {
    const project = this.readProjectOrRefusal(request.projectId)
    if ('error' in project) return project
    const quiz = this.store.readQuiz(project.value.id, request.quizId)
    if (quiz === undefined) return refuse('not-found', `no quiz ${JSON.stringify(request.quizId)} — store the quiz first (library_write · quiz), then assess it`)
    if (request.verdicts.length === 0) {
      return refuse('invalid', 'library_assess needs the verdicts — one per question: { task: <question id>, criterion, pass, ratio?, evidence, by, void?, missedCard? }')
    }
    const questionById = new Map(quiz.questions.map(question => [question.id, question]))
    for (const [index, verdict] of request.verdicts.entries()) {
      if (!questionById.has(verdict.task)) {
        return refuse('invalid', `verdicts[${index}] judges task ${JSON.stringify(verdict.task)}, which quiz ${quiz.id} does not ask — its questions are: ${quiz.questions.map(question => question.id).join(', ')}`)
      }
      if (verdict.criterion.trim() === '' || verdict.evidence.trim() === '') {
        return refuse('invalid', `verdicts[${index}] (${verdict.task}) needs criterion and evidence — WHAT was judged and WHERE the answer is grounded`)
      }
      if (verdict.by !== 'llm' && verdict.by !== 'self' && verdict.by !== 'user') return refuse('invalid', `verdicts[${index}].by must be llm | self | user`)
      if (verdict.ratio !== undefined && !(verdict.ratio >= 0 && verdict.ratio <= 1)) return refuse('invalid', `verdicts[${index}].ratio is partial credit in [0, 1]`)
    }
    const counted = request.verdicts.filter(verdict => verdict.void !== true)
    const ratio = counted.length === 0 ? 0 : counted.reduce((sum, verdict) => sum + (verdict.ratio ?? (verdict.pass ? 1 : 0)), 0) / counted.length
    return await this.mutate(project.value.id, () => {
      const now = new Date()
      const at = now.toISOString()
      const attempt: LibraryAttempt = { id: mintLibraryId('a'), quizId: quiz.id, verdicts: request.verdicts, ratio, at }
      this.store.appendAttempt(project.value.id, attempt)

      // Cards: every counted verdict moves the cards its question probed.
      const cards = this.store.readCards(project.value.id)
      const byId = new Map(cards.map(card => [card.id, card]))
      const order = cards.map(card => card.id)
      const touched = new Map<string, LibraryCardUpdate>()
      const book = this.store.readBook(project.value.id, quiz.scope.bookId)
      for (const verdict of counted) {
        const question = questionById.get(verdict.task)!
        const credit = verdict.ratio ?? (verdict.pass ? 1 : 0)
        const passed = verdict.pass && credit >= 0.5
        const cardIds = [...(question.target.cardIds ?? [])]
        if (cardIds.length === 0 && !passed) {
          const created = this.missedCardFor(question, verdict, quiz, book?.id, project.value.template, at)
          const existing = exactMatch([...byId.values()], [cardKey(created.term)])
          if (existing === undefined) {
            byId.set(created.id, created)
            order.push(created.id)
            touched.set(created.id, { id: created.id, term: created.term, weakness: created.weakness, mastery: created.mastery, created: true })
            continue
          }
          cardIds.push(existing.id)
        }
        for (const cardId of cardIds) {
          const card = byId.get(cardId)
          if (card === undefined || !live(card)) continue
          const box = passed ? Math.min(card.mastery.box + 1, MAX_BOX) : 0
          const next: LibraryCard = {
            ...card,
            mastery: { box, dueAt: leitnerDueAt(box, now), streak: passed ? card.mastery.streak + 1 : 0 },
            weakness: clampWeakness(card.weakness + (passed ? -1 : 1)),
            sources: passed ? card.sources : [...card.sources, { type: 'quiz', ref: quiz.id, note: verdict.criterion.slice(0, 120), weakened: true, at }],
            updatedAt: at,
          }
          byId.set(card.id, next)
          touched.set(card.id, { id: card.id, term: card.term, weakness: next.weakness, mastery: next.mastery })
        }
      }
      if (touched.size > 0) this.store.writeCards(project.value.id, order.map(cardId => byId.get(cardId)!))

      // The gated node's stats, its completion, and what that unlocks.
      let unlocked: string[] = []
      let completed: string | undefined
      const roadmap = this.store.readRoadmap(project.value.id, quiz.scope.bookId)
      const passRatio = roadmap?.passRatio ?? DEFAULT_PASS_RATIO
      const gated = quiz.scope.nodeId === undefined ? undefined : roadmap?.nodes.find(node => node.id === quiz.scope.nodeId)
      if (roadmap !== undefined && gated !== undefined && gated.kind === 'quiz') {
        const updated = roadmap.nodes.map(node => {
          if (node.id !== gated.id) return node
          const stats = node.quizStats ?? { attempts: 0 }
          const next: RoadmapNode = {
            ...node,
            quizStats: { attempts: stats.attempts + 1, lastRatio: ratio, bestRatio: Math.max(stats.bestRatio ?? 0, ratio) },
          }
          if (ratio >= passRatio && node.state === 'current') {
            completed = node.id
            return { ...next, state: 'done' as const }
          }
          return next
        })
        const result = completed === undefined ? { nodes: updated, unlocked: [] } : unlockReady(updated)
        unlocked = result.unlocked
        this.store.writeRoadmap(project.value.id, { ...roadmap, nodes: result.nodes })
      }
      const created = [...touched.values()].filter(update => update.created === true)
      this.store.appendEvents(project.value.id, [
        { at, type: 'attempt.assessed', id: quiz.id, bookId: quiz.scope.bookId, ratio },
        ...(created.length === 0 ? [] : [{
          at,
          type: 'cards.recorded' as const,
          source: 'quiz' as const,
          title: created.map(update => update.term).join('、').slice(0, 300),
          ids: created.map(update => update.id),
          bookId: quiz.scope.bookId,
          count: created.length,
        }]),
        ...(completed === undefined ? [] : [{ at, type: 'node.completed' as const, id: completed, title: titleOf(roadmap?.nodes ?? [], completed), bookId: quiz.scope.bookId, ratio }]),
        ...unlocked.map(nodeId => ({ at, type: 'node.unlocked' as const, id: nodeId, title: titleOf(roadmap?.nodes ?? [], nodeId), bookId: quiz.scope.bookId })),
      ])
      return {
        ok: true as const,
        attempt,
        cardUpdates: [...touched.values()],
        unlocked,
        ...(completed === undefined ? {} : { completed }),
        passRatio,
      }
    })
  }

  /** The card a missed, card-less question leaves behind. */
  private missedCardFor(
    question: LibraryQuizQuestion,
    verdict: LibraryVerdict,
    quiz: LibraryQuiz,
    bookId: string | undefined,
    template: LibraryTemplate,
    at: string,
  ): LibraryCard {
    const term = verdict.missedCard?.term.trim() || question.prompt.trim().slice(0, 80)
    const gloss = verdict.missedCard?.gloss.trim() || question.answer.trim()
    return {
      id: mintLibraryId('c'),
      kind: template === 'language' && verdict.missedCard !== undefined && !/\s/.test(term) ? 'word' : 'concept',
      term,
      aliases: [],
      gloss,
      contexts: question.evidence.quote === undefined ? [] : [{ sentence: question.evidence.quote, ...(bookId === undefined ? {} : { bookId }), ...(question.evidence.pageId === undefined ? {} : { pageId: question.evidence.pageId }) }],
      ...(bookId === undefined ? {} : { bookId }),
      sources: [{ type: 'quiz', ref: quiz.id, note: verdict.criterion.slice(0, 120), weakened: true, at }],
      weakness: 1,
      mastery: { box: 0, dueAt: leitnerDueAt(0, new Date(at)), streak: 0 },
      status: 'active',
      createdAt: at,
      updatedAt: at,
    }
  }

  /* ------------------------------------------------------------- bindings */

  /** The project / book a session works on, when it is bound. */
  getBinding(sessionId: string): LibraryBinding | undefined {
    return this.store.readBindings().get(sessionId)
  }

  /** Bind a session (null unbinds). The project and book must exist. */
  async setBinding(sessionId: string, binding: LibraryBinding | null): Promise<LibraryOutcome<{ binding: LibraryBinding | null }>> {
    if (sessionId === '') return refuse('invalid', 'no session to bind')
    if (binding !== null) {
      const project = this.readProjectOrRefusal(binding.projectId)
      if ('error' in project) return project
      if (binding.bookId !== undefined && this.store.readBook(binding.projectId, binding.bookId) === undefined) {
        return refuse('not-found', `no book ${JSON.stringify(binding.bookId)} in project ${JSON.stringify(project.value.name)}`)
      }
    }
    try {
      await this.store.withBindingsLock(() => {
        const bindings = new Map(this.store.readBindings())
        if (binding === null) bindings.delete(sessionId)
        else bindings.set(sessionId, { projectId: binding.projectId, ...(binding.bookId === undefined ? {} : { bookId: binding.bookId }) })
        this.store.writeBindings(bindings)
      })
      if (binding !== null) this.changed(binding.projectId)
      return { ok: true, binding }
    } catch (error) {
      return storeRefusal(error)
    }
  }

  /**
   * The bound session's working set, read synchronously (the per-turn prompt
   * context renders inside a synchronous callback): the project, the book,
   * its current node and draft flag, and the weakest live cards there.
   */
  bindingSummary(sessionId: string, cardLimit: number = 12): {
    binding?: LibraryBinding
    project?: LibraryProject
    book?: LibraryBook
    progress?: LibraryBookProgress
    weakCards: LibraryCard[]
  } {
    const binding = this.getBinding(sessionId)
    if (binding === undefined) return { weakCards: [] }
    let project: LibraryProject | undefined
    try {
      project = this.store.readProject(binding.projectId)
    } catch {
      project = undefined
    }
    if (project === undefined) return { binding, weakCards: [] }
    const book = binding.bookId === undefined ? undefined : this.store.readBook(project.id, binding.bookId)
    const weakCards = this.store.readCards(project.id)
      .filter(card => card.status === 'active' && card.weakness > 0 && (book === undefined || card.bookId === book.id))
      .sort((a, b) => b.weakness - a.weakness || b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, cardLimit)
    return {
      binding,
      project,
      ...(book === undefined ? {} : { book, progress: this.bookProgress(project.id, book) }),
      weakCards,
    }
  }

  /* --------------------------------------------------------------- events */

  /** One project's audit trail, newest first, optionally some types only. */
  async listEvents(request: { projectId: string; limit?: number; types?: readonly LibraryEventType[] }): Promise<{ events: LibraryEvent[] }> {
    const types = request.types === undefined ? undefined : new Set(request.types)
    const events = this.store.readEvents(request.projectId).filter(event => types === undefined || types.has(event.type))
    return { events: events.reverse().slice(0, request.limit ?? 20) }
  }

  /** 「教练最近记下」: card recordings from chats and quizzes, across projects, newest first. */
  async recentRecords(request: { limit?: number }): Promise<{ records: (LibraryEvent & { projectId: string; projectName: string })[] }> {
    const records: (LibraryEvent & { projectId: string; projectName: string })[] = []
    for (const project of this.store.readIndex().projects) {
      for (const event of this.store.readEvents(project.id)) {
        if (event.type === 'cards.recorded' && (event.source === 'chat' || event.source === 'quiz')) {
          records.push({ ...event, projectId: project.id, projectName: project.name })
        }
      }
    }
    records.sort((a, b) => b.at.localeCompare(a.at))
    return { records: records.slice(0, request.limit ?? 10) }
  }

  /* --------------------------------------------------------------- stats */

  /** The whole-library tally. */
  async stats(): Promise<{ projects: number; books: number; cards: number; due: number; quizzes: number; attempts: number }> {
    const now = new Date().toISOString()
    let books = 0
    let cards = 0
    let due = 0
    let quizzes = 0
    let attempts = 0
    const index = this.store.readIndex()
    for (const project of index.projects) {
      books += this.store.listBooks(project.id).length
      quizzes += this.store.listQuizzes(project.id).length
      attempts += this.store.readAttempts(project.id).length
      for (const card of this.store.readCards(project.id)) {
        if (card.status !== 'active') continue
        cards += 1
        if (card.mastery.dueAt <= now) due += 1
      }
    }
    return { projects: index.projects.length, books, cards, due, quizzes, attempts }
  }

  /* -------------------------------------------------------------- helpers */

  /** The project, or a not-found refusal that teaches where the list lives. */
  private readProjectOrRefusal(projectId: string): { value: LibraryProject } | (LibraryRefusal & { error: LibraryErrorCode }) {
    let project: LibraryProject | undefined
    try {
      project = this.store.readProject(projectId)
    } catch (error) {
      return storeRefusal(error)
    }
    if (project === undefined) {
      return refuse('not-found', `no project ${JSON.stringify(projectId)} — library_read · projects lists every project; create one with library_write · project`)
    }
    return { value: project }
  }
}

/** A node's title, for event rows. */
function titleOf(nodes: readonly RoadmapNode[], nodeId: string): string {
  return nodes.find(node => node.id === nodeId)?.title ?? ''
}

/** Move every locked node whose deps are all done to current. */
export function unlockReady(nodes: readonly RoadmapNode[]): { nodes: RoadmapNode[]; unlocked: string[] } {
  const doneIds = new Set(nodes.filter(node => node.state === 'done').map(node => node.id))
  const unlocked: string[] = []
  const next = nodes.map(node => {
    if (node.state === 'locked' && node.dependsOn.every(dep => doneIds.has(dep))) {
      unlocked.push(node.id)
      return { ...node, state: 'current' as const }
    }
    return node
  })
  return { nodes: next, unlocked }
}

/** Structural validation of a roadmap's nodes; returns the teaching error or undefined. */
export function validateRoadmapShape(nodes: readonly RoadmapNode[], book: LibraryBook): string | undefined {
  const seen = new Set<string>()
  for (const [index, node] of nodes.entries()) {
    if (typeof node.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(node.id) || seen.has(node.id)) {
      return `nodes[${index}] needs a unique id made of letters, digits, '.', '_', '-' (n1, n2, … is plenty)`
    }
    seen.add(node.id)
    if (typeof node.title !== 'string' || node.title.trim() === '') return `nodes[${index}] (${node.id}) needs a title — what the learner masters here`
    if (node.kind !== 'quiz' && node.kind !== 'read') {
      return `nodes[${index}] (${node.id}) needs kind: "quiz" | "read" — quiz nodes gate on a chapter quiz; read nodes (how to use the book, front matter, appendices) complete by 读完`
    }
    for (const range of node.chapterRanges) {
      if (!Number.isInteger(range.from) || !Number.isInteger(range.to) || range.from < 1 || range.to < range.from) {
        return `nodes[${index}] (${node.id}) has a bad chapterRange [${String(range.from)}, ${String(range.to)}] — ranges count table-of-contents rows, 1-based and inclusive: { from: 3, to: 5 }`
      }
      if (range.to > book.toc.length) {
        return `nodes[${index}] (${node.id}) covers up to row ${range.to}, but 《${book.title}》's contents has ${book.toc.length} rows — library_read · toc lists them`
      }
    }
    for (const dep of node.dependsOn) {
      const depIndex = nodes.findIndex(candidate => candidate.id === dep)
      if (depIndex === -1) return `nodes[${index}] (${node.id}) depends on ${JSON.stringify(dep)}, which the roadmap does not declare`
      if (depIndex >= index) return `nodes[${index}] (${node.id}) depends on ${JSON.stringify(dep)}, which comes AFTER it — list a node after everything it depends on`
    }
  }
  return undefined
}
