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
  LIBRARY_COLORS,
  LIBRARY_ICONS,
  LIBRARY_RESOURCE_KINDS,
  TEMPLATE_LOOK,
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
  type LibraryColor,
  type LibraryProjectPatch,
  type LibraryIcon,
  type LibraryCapabilities,
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
  type LibraryQuizFocus,
  type LibraryQuizQuestion,
  type LibraryRefusal,
  type LibraryResource,
  type LibraryResourceKind,
  type LibraryNodeCover,
  type LibraryNodeNotes,
  type LibraryReviewRating,
  type LibraryRoadmap,
  type LibraryTemplate,
  type LibraryTocSource,
  type LibraryVerdict,
  type RoadmapNode,
} from './types.ts'
import { cardKey, cardKeys, cardMatchesQuery, exactMatch, nearMatches } from './cards.ts'
import { PACKAGE_NAME } from './invariant.ts'
import { LibraryStore, LibraryStoreError, mintLibraryId } from './store.ts'

/** The attachment store's faces, mirrored structurally (probed, never injected). */
interface AttachmentsSlice {
  readImage(ref: LibraryAttachmentRef): Promise<{ data: Uint8Array; ref: { mediaType: string } }>
  saveImage?(input: { data: Uint8Array; mediaType: string }): Promise<LibraryAttachmentRef>
}

/**
 * Thrown by every public verb after {@link LibraryService.dispose} ran (an
 * explicit teardown, or the borrowed Context's own disposal): a coded,
 * package-named refusal, never a silent operation on a dead Context. The
 * disposed instance stays dead — a rebuild over the same state root is a NEW
 * service instance's business (the canvas-novel/sidechat precedent).
 */
export class LibraryDisposedError extends Error {
  constructor(message: string, readonly code: 'disposed') {
    super(message)
    this.name = 'LibraryDisposedError'
  }
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
 * boots and answers `storage-unavailable` on writes. Disposal follows the
 * borrowed Context: an instance mounted dynamically (per state root, say)
 * dies with its mounting Context, and a dead instance refuses every verb
 * coded, reads included.
 */
export class LibraryService {
  /** The store; public for the package's own tests and diagnostics. */
  readonly store: LibraryStore
  /** Listeners told after every project mutation (the tab's live refresh, the context cache). */
  private readonly listeners = new Set<(projectId: string) => void>()
  /** Set by {@link dispose} (explicit, or the borrowed Context's teardown); every public verb refuses afterwards. */
  private disposed = false

  constructor(
    private readonly ctx: Context,
    config: { stateRoot?: string } = {},
  ) {
    this.store = new LibraryStore(config)
    // The borrowed Context's disposal IS this instance's disposal: an
    // instance mounted per state root dies with its mounting Context instead
    // of answering verbs off a dead scope.
    ctx.effect(() => () => { this.dispose() }, 'library: dispose on context teardown')
  }

  /**
   * Refuse one public verb after disposal: the instance is dead and nothing
   * it could still answer is meant to be consumed — reads included, so a
   * mounting side never keeps consuming a stale instance indefinitely.
   */
  private assertAlive(verb: string): void {
    if (this.disposed) throw new LibraryDisposedError(`${PACKAGE_NAME}: ${verb} after dispose`, 'disposed')
  }

  /**
   * Tear the instance down (also wired to the borrowed Context's disposal at
   * construction). Idempotent and TERMINAL: the listener set is dropped and
   * afterwards every public verb refuses with {@link LibraryDisposedError};
   * a write that already passed the write boundary may complete (the store's
   * lock/temp-write/atomic-rename keeps the disk side safe), one reaching it
   * after disposal refuses before lock acquisition. A rebuild over the same
   * state root is a NEW instance's business.
   */
  dispose(): void {
    this.disposed = true
    this.listeners.clear()
  }

  /**
   * What a client may rely on in this composition: storage availability with
   * its reason, and the attachment probe's verdict at call time. A read-only
   * display contract — enforcement stays at the write gates, unchanged.
   */
  async capabilities(): Promise<LibraryCapabilities> {
    this.assertAlive('capabilities')
    return {
      protocolVersion: 1,
      hasStorage: this.store.available,
      ...(this.store.unavailableReason === undefined ? {} : { storageUnavailableReason: this.store.unavailableReason }),
      hasAttachments: (this.ctx.get('attachments') as AttachmentsSlice | undefined) !== undefined,
    }
  }

  /** Subscribe to project mutations; returns the unsubscribe. */
  onChange(listener: (projectId: string) => void): () => void {
    this.assertAlive('onChange')
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
    // The write boundary: a disposal that landed since the entry guard dies
    // here, BEFORE the lock is taken — never queuing onto a lock a rebuilt
    // instance on the same root now owns (kept outside the try, so the coded
    // refusal propagates as itself rather than folding into a store refusal).
    this.assertAlive('mutate')
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
      lastActiveAt: this.store.readEvents(project.id).at(-1)?.at ?? project.createdAt,
    }
  }

  /** Every project with its books' progress and card tallies. */
  async listProjects(): Promise<{ projects: LibraryProjectSummary[] }> {
    this.assertAlive('listProjects')
    // Most recently used first: the list is where the learner picks up again.
    const projects = this.store.readIndex().projects.map(project => this.summarize(project))
    projects.sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt))
    return { projects }
  }

  /** One project's summary plus its books' metadata. */
  async getProject(request: { id: string }): Promise<LibraryOutcome<{ project: LibraryProjectSummary; books: LibraryBook[] }>> {
    this.assertAlive('getProject')
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
    color?: LibraryColor
    icon?: LibraryIcon
  }): Promise<LibraryOutcome<{ project: LibraryProject }>> {
    this.assertAlive('createProject')
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
        const template = request.template ?? 'subject'
        const project: LibraryProject = {
          id: mintLibraryId('p'),
          name,
          template,
          color: request.color !== undefined && (LIBRARY_COLORS as readonly string[]).includes(request.color) ? request.color : TEMPLATE_LOOK[template].color,
          icon: request.icon !== undefined && (LIBRARY_ICONS as readonly string[]).includes(request.icon) ? request.icon : TEMPLATE_LOOK[template].icon,
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

  /** Change a project's look or goal (the sidebar's 「样式」). */
  async updateProject(request: { id: string; patch: LibraryProjectPatch }): Promise<LibraryOutcome<{ project: LibraryProject }>> {
    this.assertAlive('updateProject')
    const patch = request.patch
    if (patch.color !== undefined && !(LIBRARY_COLORS as readonly string[]).includes(patch.color)) return refuse('invalid', `color is one of ${LIBRARY_COLORS.join(' | ')}`)
    if (patch.icon !== undefined && !(LIBRARY_ICONS as readonly string[]).includes(patch.icon)) return refuse('invalid', `icon is one of ${LIBRARY_ICONS.join(' | ')}`)
    if (patch.name !== undefined && patch.name.trim() === '') return refuse('invalid', 'a project keeps a name')
    if (patch.template !== undefined && !['language', 'subject', 'custom'].includes(patch.template)) {
      return refuse('invalid', 'template is language | subject | custom — language: marks are words; subject: marks are concepts')
    }
    try {
      const outcome = await this.store.withIndexLock(async () => {
        const index = this.store.readIndex()
        const project = index.projects.find(candidate => candidate.id === request.id)
        if (project === undefined) return refuse('not-found', `no project ${JSON.stringify(request.id)}`)
        const { goal: _goal, ...rest } = project
        const goal = patch.goal === undefined ? project.goal : patch.goal.trim()
        const next: LibraryProject = {
          ...rest,
          ...(goal === undefined || goal === '' ? {} : { goal }),
          ...(patch.color === undefined ? {} : { color: patch.color }),
          ...(patch.icon === undefined ? {} : { icon: patch.icon }),
          ...(patch.template === undefined ? {} : { template: patch.template }),
          ...(patch.name === undefined ? {} : { name: patch.name.trim() }),
        }
        this.store.writeProject(next)
        this.store.writeIndex({ ...index, projects: index.projects.map(candidate => candidate.id === next.id ? next : candidate) })
        return { ok: true as const, project: next }
      })
      if (outcome.ok) this.changed(request.id)
      return outcome
    } catch (error) {
      return storeRefusal(error)
    }
  }

  /** Delete a project and everything it holds. */
  async deleteProject(request: { id: string }): Promise<LibraryOutcome<{ id: string }>> {
    this.assertAlive('deleteProject')
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
    short?: string
    extras?: readonly { title: string; note?: string; where?: string; when?: 'before' | 'reference' }[]
  }): Promise<LibraryOutcome<{ book: LibraryBook }>> {
    this.assertAlive('putBook')
    const title = request.title.trim()
    if (title === '') return refuse('invalid', 'a book needs its title — and the edition, when the book has several')
    if (request.bookKind !== 'knowledge' && request.bookKind !== 'material') {
      return refuse('invalid', 'bookKind is knowledge | material — knowledge: a textbook or popular science (its content is domain knowledge); material: exam papers, novels, anthologies (specific text you cannot recall)')
    }
    // One row per chapter: a row that only repeats its part's heading is the
    // part, not a chapter (a live run stored nine of them among 64 chapters).
    const toc = request.toc.filter(entry => entry.title.trim() !== '' && entry.title.trim() !== entry.part?.trim())
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
        ...(request.short === undefined || request.short.trim() === '' ? (existing?.short === undefined ? {} : { short: existing.short }) : { short: request.short.trim().slice(0, 8) }),
        ...(request.extras === undefined
          ? (existing?.extras === undefined ? {} : { extras: existing.extras })
          : {
            extras: request.extras.filter(extra => typeof extra.title === 'string' && extra.title.trim() !== '').map(extra => ({
              title: extra.title.trim(),
              ...(extra.note === undefined || extra.note.trim() === '' ? {} : { note: extra.note.trim() }),
              ...(extra.where === undefined || extra.where.trim() === '' ? {} : { where: extra.where.trim() }),
              when: extra.when === 'reference' ? 'reference' as const : 'before' as const,
            })),
          }),
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
    this.assertAlive('deleteBook')
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
    this.assertAlive('getBook')
    const book = this.store.readBook(request.projectId, request.bookId)
    if (book === undefined) return refuse('not-found', `no book ${JSON.stringify(request.bookId)} — library_read · books lists the project's`)
    return { ok: true, book }
  }

  /* ------------------------------------------------------------ resources */

  /**
   * Put a link on the project's shelf. A resource is a light entry — no
   * contents, no roadmap, never quizzed — one per url; what the coach
   * references BY CHAPTER is registered as a book instead.
   */
  async addResource(request: {
    projectId: string
    resource: { title: string; url: string; kind: LibraryResourceKind; note?: string; addedBy: 'coach' | 'learner' }
  }): Promise<LibraryOutcome<{ resource: LibraryResource }>> {
    this.assertAlive('addResource')
    const project = this.readProjectOrRefusal(request.projectId)
    if ('error' in project) return project
    const title = request.resource.title.trim()
    if (title === '') return refuse('invalid', 'a resource needs its title — open the link (web) and name it what its own page calls it')
    const url = request.resource.url.trim()
    if (!/^https?:\/\//.test(url)) {
      return refuse('invalid', 'a resource\'s url starts with http:// or https:// — the learner opens it straight off the shelf')
    }
    if (!(LIBRARY_RESOURCE_KINDS as readonly string[]).includes(request.resource.kind)) {
      return refuse('invalid', `kind is ${LIBRARY_RESOURCE_KINDS.join(' | ')} — what the link IS: an article to read, a video to watch, a repo or tool to build with, a course to follow, hardware to get`)
    }
    if (request.resource.addedBy !== 'coach' && request.resource.addedBy !== 'learner') {
      return refuse('invalid', 'addedBy is coach | learner — who put the link on the shelf')
    }
    return await this.mutate(project.value.id, () => {
      if (this.store.readResources(project.value.id).some(resource => resource.url === url)) {
        return refuse('exists', `${url} is already on this project's shelf — library_read · resources lists them; to change its note, remove it (library_write · resource, op remove) and add it again`)
      }
      const resource: LibraryResource = {
        id: mintLibraryId('res'),
        title,
        url,
        kind: request.resource.kind,
        ...(request.resource.note === undefined || request.resource.note.trim() === '' ? {} : { note: request.resource.note.trim() }),
        addedBy: request.resource.addedBy,
        createdAt: new Date().toISOString(),
      }
      this.store.appendResource(project.value.id, resource)
      this.event(project.value.id, 'resource.added', { id: resource.id })
      return { ok: true as const, resource }
    })
  }

  /** Take a link off the project's shelf (the line is physically dropped). */
  async removeResource(request: { projectId: string; resourceId: string }): Promise<LibraryOutcome<{ id: string }>> {
    this.assertAlive('removeResource')
    const project = this.readProjectOrRefusal(request.projectId)
    if ('error' in project) return project
    return await this.mutate(project.value.id, () => {
      if (!this.store.readResources(project.value.id).some(resource => resource.id === request.resourceId)) {
        return refuse('not-found', `no resource ${JSON.stringify(request.resourceId)} on this project's shelf — library_read · resources lists them`)
      }
      this.store.removeResource(project.value.id, request.resourceId)
      return { ok: true as const, id: request.resourceId }
    })
  }

  /** A project's shelf links, oldest first. */
  async listResources(request: { projectId: string }): Promise<{ resources: LibraryResource[] }> {
    this.assertAlive('listResources')
    return { resources: this.store.readResources(request.projectId) }
  }

  /* ------------------------------------------------------------- roadmap */

  /** One scope's adopted roadmap and its pending draft; no bookId = the project's own path. */
  async getRoadmap(request: { projectId: string; bookId?: string }): Promise<{ roadmap?: LibraryRoadmap; draft?: LibraryRoadmap }> {
    this.assertAlive('getRoadmap')
    const roadmap = this.store.readRoadmap(request.projectId, request.bookId)
    const draft = this.store.readRoadmap(request.projectId, request.bookId, 'draft')
    return { ...(roadmap === undefined ? {} : { roadmap }), ...(draft === undefined ? {} : { draft }) }
  }

  /**
   * Write the coach's draft — a book's path (bookId) or the project's own
   * (no bookId: the general case, mixing covers freely). Shape rules: unique
   * ids, a kind, at least one cover per node, references that exist, ranges
   * inside the book's contents, dependencies pointing backwards. States are
   * not the coach's to set — adoption initializes them.
   */
  async draftRoadmap(request: {
    projectId: string
    bookId?: string
    nodes: readonly {
      id: string
      title: string
      kind: RoadmapNode['kind']
      goals?: readonly string[] | string
      covers?: readonly LibraryNodeCover[]
      dependsOn?: readonly string[]
      acceptance?: readonly string[]
    }[]
    passRatio?: number
    note?: string
  }): Promise<LibraryOutcome<{ draft: LibraryRoadmap }>> {
    this.assertAlive('draftRoadmap')
    const project = this.readProjectOrRefusal(request.projectId)
    if ('error' in project) return project
    const book = request.bookId === undefined ? undefined : this.store.readBook(project.value.id, request.bookId)
    if (request.bookId !== undefined && book === undefined) {
      return refuse('not-found', `no book ${JSON.stringify(request.bookId)} in project ${JSON.stringify(project.value.name)} — a book's roadmap rides the book; library_read · books lists them (omit bookId for the project's own path)`)
    }
    if (request.nodes.length === 0) {
      return refuse('invalid', 'a roadmap needs at least one node — split the material into learning stations; each: { id, title, kind: "quiz"|"read"|"practice", goals, covers: [{ kind: "book"|"resource"|"url"|"topic", ... }], dependsOn }; a practice station also needs acceptance: [...]')
    }
    if (request.passRatio !== undefined && !(request.passRatio > 0 && request.passRatio <= 1)) {
      return refuse('invalid', 'passRatio is a fraction in (0, 1] — 0.8 means 8 of 10 right')
    }
    const nodes: RoadmapNode[] = request.nodes.map(node => ({
      id: node.id,
      title: node.title,
      kind: node.kind,
      // A model writes one goal as a bare string as often as a list.
      goals: typeof node.goals === 'string' ? [node.goals] : (node.goals ?? []).filter(goal => typeof goal === 'string'),
      covers: node.covers ?? [],
      dependsOn: node.dependsOn ?? [],
      state: 'locked',
      ...(Array.isArray(node.acceptance) ? { acceptance: node.acceptance.filter(line => typeof line === 'string') } : {}),
    }))
    const resourceIds = new Set(this.store.readResources(project.value.id).map(resource => resource.id))
    const shapeError = validateRoadmapShape(nodes, {
      ...(book === undefined ? {} : { bookId: book.id }),
      book: candidate => this.store.readBook(project.value.id, candidate),
      hasResource: candidate => resourceIds.has(candidate),
    })
    if (shapeError !== undefined) return refuse('invalid', shapeError)
    return await this.mutate(project.value.id, () => {
      const draft: LibraryRoadmap = {
        ...(book === undefined ? {} : { bookId: book.id }),
        status: 'draft',
        nodes,
        ...(request.passRatio === undefined ? {} : { passRatio: request.passRatio }),
        ...(request.note === undefined || request.note.trim() === '' ? {} : { note: request.note.trim() }),
        generatedAt: new Date().toISOString(),
      }
      this.store.writeRoadmap(project.value.id, draft)
      this.event(project.value.id, 'roadmap.drafted', book === undefined
        ? { id: project.value.id, title: project.value.name, count: nodes.length }
        : { id: book.id, title: book.title, bookId: book.id, count: nodes.length })
      return { ok: true as const, draft }
    })
  }

  /**
   * The learner's 采用: the draft becomes the path. Nodes whose deps are
   * all done start `current`; a node that survives a re-split (same id) keeps
   * its state and quiz stats, so re-planning never erases progress.
   */
  async adoptRoadmap(request: { projectId: string; bookId?: string }): Promise<LibraryOutcome<{ roadmap: LibraryRoadmap }>> {
    this.assertAlive('adoptRoadmap')
    const project = this.readProjectOrRefusal(request.projectId)
    if ('error' in project) return project
    return await this.mutate(project.value.id, () => {
      const draft = this.store.readRoadmap(project.value.id, request.bookId, 'draft')
      if (draft === undefined) return refuse('not-found', 'no draft to adopt here — ask the coach to draft a roadmap first')
      const prior = new Map((this.store.readRoadmap(project.value.id, request.bookId)?.nodes ?? []).map(node => [node.id, node]))
      const nodes: RoadmapNode[] = []
      for (const node of draft.nodes) {
        const kept = prior.get(node.id)
        const doneIds = new Set(nodes.filter(candidate => candidate.state === 'done').map(candidate => candidate.id))
        const ready = node.kind === 'read' || node.dependsOn.every(dep => doneIds.has(dep))
        const state: RoadmapNode['state'] = kept?.state === 'done' && ready ? 'done' : ready ? 'current' : 'locked'
        nodes.push({
          ...node,
          state,
          ...(node.kind === 'quiz' ? { quizStats: kept?.quizStats ?? { attempts: 0 } } : {}),
          // A re-plan that keeps the station's id also keeps its 讲义.
          ...(kept?.notes !== undefined ? { notes: kept.notes } : {}),
        })
      }
      const now = new Date().toISOString()
      const roadmap: LibraryRoadmap = { ...draft, status: 'adopted', nodes, adoptedAt: now }
      this.store.writeRoadmap(project.value.id, roadmap)
      this.store.removeDraft(project.value.id, request.bookId)
      const book = request.bookId === undefined ? undefined : this.store.readBook(project.value.id, request.bookId)
      this.event(project.value.id, 'roadmap.adopted', {
        at: now,
        id: request.bookId ?? project.value.id,
        title: book?.title ?? project.value.name,
        ...(request.bookId === undefined ? {} : { bookId: request.bookId }),
        count: nodes.length,
      })
      return { ok: true as const, roadmap }
    })
  }

  /** Drop a scope's draft without adopting it. */
  async discardDraft(request: { projectId: string; bookId?: string }): Promise<LibraryOutcome<{ bookId?: string }>> {
    this.assertAlive('discardDraft')
    const project = this.readProjectOrRefusal(request.projectId)
    if ('error' in project) return project
    return await this.mutate(project.value.id, () => {
      this.store.removeDraft(project.value.id, request.bookId)
      return { ok: true as const, ...(request.bookId === undefined ? {} : { bookId: request.bookId }) }
    })
  }

  /**
   * Write (or rewrite) a station's 讲义 — the coach's distilled teaching,
   * persisted on the adopted path's node. Replanning keeps it when the
   * station's id survives; every write bumps `revisions`.
   */
  async putNotes(request: { projectId: string; bookId?: string; nodeId: string; text: string }): Promise<LibraryOutcome<{ notes: LibraryNodeNotes }>> {
    this.assertAlive('putNotes')
    const project = this.readProjectOrRefusal(request.projectId)
    if ('error' in project) return project
    const text = request.text.trim()
    if (text === '') return refuse('invalid', 'notes need text — the distilled teaching for this station (markdown): the explanation, the points the learner got stuck on, the pitfalls')
    return await this.mutate(project.value.id, () => {
      const roadmap = this.store.readRoadmap(project.value.id, request.bookId)
      const node = roadmap?.nodes.find(candidate => candidate.id === request.nodeId)
      if (roadmap === undefined || node === undefined) {
        return refuse('not-found', `no node ${JSON.stringify(request.nodeId)} on the adopted path — read the roadmap for its stations (notes ride the adopted path; the learner adopts a draft first)`)
      }
      const notes: LibraryNodeNotes = { text, updatedAt: new Date().toISOString(), revisions: (node.notes?.revisions ?? 0) + 1 }
      const next: LibraryRoadmap = { ...roadmap, nodes: roadmap.nodes.map(candidate => candidate.id === node.id ? { ...candidate, notes } : candidate) }
      this.store.writeRoadmap(project.value.id, next)
      this.event(project.value.id, 'node.noted', { id: node.id, title: node.title, ...(request.bookId === undefined ? {} : { bookId: request.bookId }), count: notes.revisions })
      return { ok: true as const, notes }
    })
  }

  /** 「读完」: a current read node completes and unlocks what it gates. */
  async markNodeRead(request: { projectId: string; bookId?: string; nodeId: string }): Promise<LibraryOutcome<{ roadmap: LibraryRoadmap; unlocked: string[] }>> {
    this.assertAlive('markNodeRead')
    const project = this.readProjectOrRefusal(request.projectId)
    if ('error' in project) return project
    return await this.mutate(project.value.id, () => {
      const roadmap = this.store.readRoadmap(project.value.id, request.bookId)
      const node = roadmap?.nodes.find(candidate => candidate.id === request.nodeId)
      if (roadmap === undefined || node === undefined) return refuse('not-found', `no node ${JSON.stringify(request.nodeId)} on the adopted path`)
      if (node.kind !== 'read') return refuse('state-machine', `${node.title} is a ${node.kind} node — only a read node completes by 读完 (a quiz node by passing its quiz, a practice station by acceptance)`)
      if (node.state !== 'current') return refuse('state-machine', `${node.title} is ${node.state} — only a current node can be marked read`)
      const now = new Date().toISOString()
      const completed = roadmap.nodes.map(candidate => candidate.id === node.id ? { ...candidate, state: 'done' as const } : candidate)
      const { nodes, unlocked } = unlockReady(completed)
      const next: LibraryRoadmap = { ...roadmap, nodes }
      this.store.writeRoadmap(project.value.id, next)
      this.store.appendEvents(project.value.id, [
        { at: now, type: 'node.completed', id: node.id, title: node.title, ...(request.bookId === undefined ? {} : { bookId: request.bookId }) },
        ...unlocked.map(nodeId => ({ at: now, type: 'node.unlocked' as const, id: nodeId, title: titleOf(nodes, nodeId), ...(request.bookId === undefined ? {} : { bookId: request.bookId }) })),
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
    this.assertAlive('recordPage')
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
    this.assertAlive('listPages')
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
    this.assertAlive('readPagePhoto')
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
    this.assertAlive('savePhoto')
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
        ...(sourceType === 'chat' && inputs[0]?.source.ref !== undefined ? { session: inputs[0].source.ref } : {}),
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
    this.assertAlive('writeCards')
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
    this.assertAlive('listCards')
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
    this.assertAlive('dueCards')
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
    this.assertAlive('editCard')
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
    this.assertAlive('undoCards')
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
    this.assertAlive('reviewCard')
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
    this.assertAlive('listQuizzes')
    return {
      quizzes: this.store.listQuizzes(request.projectId).filter(quiz =>
        (request.bookId === undefined || quiz.scope.bookId === request.bookId)
        && (request.nodeId === undefined || quiz.scope.nodeId === request.nodeId)),
    }
  }

  /** One quiz, whole. */
  async getQuiz(request: { projectId: string; quizId: string }): Promise<LibraryOutcome<{ quiz: LibraryQuiz }>> {
    this.assertAlive('getQuiz')
    const quiz = this.store.readQuiz(request.projectId, request.quizId)
    if (quiz === undefined) return refuse('not-found', `no quiz ${JSON.stringify(request.quizId)} — library_read · quiz without an id lists the project's`)
    return { ok: true, quiz }
  }

  /**
   * Store a quiz behind the two-axis checks. Target: a marked / asked / missed
   * question names the live cards it probes. Evidence: a photo quote names a
   * recorded page (a quote the page text lacks comes back as a warning); a web
   * quote carries its url; whether domain knowledge may back a CONTENT question
   * is judged on the gated node's covers (a material book, a shelf resource or
   * a url among them demands a verbatim quote) — a book-scoped quiz without a
   * node keeps the book-level rule, and a scopeless free quiz allows knowledge.
   */
  async putQuiz(request: {
    projectId: string
    quiz: { scope: { bookId?: string; nodeId?: string }; focus?: LibraryQuizFocus; questions: readonly LibraryQuizQuestion[] }
  }): Promise<LibraryOutcome<{ quiz: LibraryQuiz; warnings: string[] }>> {
    this.assertAlive('putQuiz')
    const project = this.readProjectOrRefusal(request.projectId)
    if ('error' in project) return project
    const scope = request.quiz.scope
    const book = scope.bookId === undefined ? undefined : this.store.readBook(project.value.id, scope.bookId)
    if (scope.bookId !== undefined && book === undefined) {
      return refuse('not-found', `quiz scope names book ${JSON.stringify(scope.bookId)}, which project ${JSON.stringify(project.value.name)} does not hold — library_read · books lists them`)
    }
    if (request.quiz.focus !== undefined && !['mine', 'book', 'mixed'].includes(request.quiz.focus)) {
      return refuse('invalid', 'quiz.focus is mine | book | mixed — mine: only the learner\'s own cards; book: only the chapter\'s content')
    }
    if (request.quiz.questions.length === 0) {
      return refuse('invalid', 'a quiz needs at least one question — each: { id, kind, prompt, options?, answer, explanation?, target: { kind, cardIds? }, evidence: { kind, pageId?, url?, quote? } }')
    }
    const nodeId = scope.nodeId
    let lockedNote: string | undefined
    let gatedNode: RoadmapNode | undefined
    if (nodeId !== undefined) {
      const roadmap = this.store.readRoadmap(project.value.id, scope.bookId)
      const node = roadmap?.nodes.find(candidate => candidate.id === nodeId)
      if (node === undefined) return refuse('not-found', `quiz scope names node ${JSON.stringify(nodeId)}, which the adopted path does not hold — library_read · roadmap lists the nodes`)
      if (node.kind === 'read') return refuse('invalid', `${node.title} is a read node — it has no quiz gate; quiz a quiz-kind node, or leave scope.node off for a free practice quiz`)
      if (node.kind === 'practice') return refuse('invalid', `${node.title} is a practice station — it completes by acceptance (library_assess with node), not by a quiz`)
      if (node.state === 'locked') lockedNote = `${node.title} is still locked — the learner can take this quiz, but passing it completes the node only once the nodes before it are done`
      gatedNode = node
    }
    const liveCards = new Set(this.store.readCards(project.value.id).filter(live).map(card => card.id))
    // Photo evidence names a page; the pool is the scoped book's pages, the
    // gated node's covered books' pages, or (a free quiz) the whole project's.
    const pageBookIds = book !== undefined
      ? [book.id]
      : gatedNode !== undefined
        ? [...new Set(gatedNode.covers.flatMap(cover => cover.kind === 'book' ? [cover.bookId] : []))]
        : this.store.listBooks(project.value.id).map(candidate => candidate.id)
    const pages = new Map(pageBookIds.flatMap(candidate => this.store.readPages(project.value.id, candidate).map(page => [page.id, page] as const)))
    const seenIds = new Set<string>()
    const warnings: string[] = lockedNote === undefined ? [] : [lockedNote]
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
      if (question.kind === 'choice' && question.options !== undefined && choiceOptionIndex(question.options, question.answer) < 0) {
        return refuse('evidence-gate', `${label}.answer matches no option — a choice question's answer IS one of its options, copied verbatim (or its letter); write the correct option first, then the distractors around it`)
      }
      const target = question.target
      if (target === undefined || !['marked', 'asked', 'missed', 'topic'].includes(target.kind)) {
        return refuse('evidence-gate', `${label} needs target: { kind: marked|asked|missed|topic, cardIds? } — what the question aims at: the learner's marked cards, the points they asked about, the ones they missed before, or the chapter's topic`)
      }
      const focus = request.quiz.focus
      if (focus === 'mine' && target.kind === 'topic') {
        return refuse('evidence-gate', `${label} tests the chapter's topic, but the learner asked for their OWN points only (focus: mine) — every question must target their cards (marked / asked / missed, with cardIds from library_read · cards). If this node has too few cards, write fewer questions and tell the learner; never pad with book content`)
      }
      if (focus === 'book' && target.kind !== 'topic') {
        return refuse('evidence-gate', `${label} targets the learner's cards, but they asked for the book's content only (focus: book) — target: { kind: "topic" } for every question`)
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
      if (evidence.kind === 'knowledge' && target.kind === 'topic') {
        // The gate sits on the node's covers now: a station drawing only on
        // knowledge books / plain teaching may be content-quizzed from memory;
        // a material book, a resource or a url among the covers demands a
        // verbatim quote. No node in scope = the book-level rule, unchanged.
        if (gatedNode === undefined) {
          if (book?.bookKind === 'material') {
            return refuse('evidence-gate', `${label} asks about 《${book.title}》's content from memory — it is a material book (specific text you cannot recall reliably). Quote a photographed page (evidence.kind photo) or a web copy (web, with url), or drill the learner's cards instead`)
          }
        } else {
          const blocker = coversVerbatimBlocker(gatedNode.covers, candidate => this.store.readBook(project.value.id, candidate))
          if (blocker !== undefined) {
            return refuse('evidence-gate', `${label} asks the station's content from memory, but ${blocker}. Quote a photographed page (evidence.kind photo) or the page on the web (web, with url), or drill the learner's cards instead`)
          }
        }
      }
    }
    return await this.mutate(project.value.id, () => {
      const quiz: LibraryQuiz = {
        id: mintLibraryId('q'),
        scope: { ...(book === undefined ? {} : { bookId: book.id }), ...(nodeId === undefined ? {} : { nodeId }) },
        ...(request.quiz.focus === undefined ? {} : { focus: request.quiz.focus }),
        questions: request.quiz.questions,
        createdAt: new Date().toISOString(),
      }
      this.store.writeQuiz(project.value.id, quiz)
      this.event(project.value.id, 'quiz.created', { at: quiz.createdAt, id: quiz.id, ...(book === undefined ? {} : { bookId: book.id }), count: quiz.questions.length })
      return { ok: true as const, quiz, warnings }
    })
  }

  /* ------------------------------------------------------------- attempts */

  /**
   * Grade a sitting — the only cascading write. Two shapes, exactly one key:
   * `quizId` judges a stored quiz; `nodeId` (+ `bookId` when the station sits
   * on a book's path) accepts a PRACTICE station — each verdict's criterion is
   * one of the node's acceptance lines, verbatim, and no quiz entity exists.
   *
   * Void verdicts count for nothing. Every probed card moves: a pass climbs a
   * Leitner box and eases weakness by one; a fail resets to box 0 (due
   * tomorrow) and adds weakness. A failed line with no card gets one
   * (`missedCard`). The gated node's stats update (quiz nodes); at or above
   * the pass ratio it completes and unlocks its dependents.
   */
  async putAttempt(request: {
    projectId: string
    quizId?: string
    nodeId?: string
    /** The book whose path the practice station sits on (omit for the project's own path). */
    bookId?: string
    verdicts: readonly LibraryVerdict[]
  }): Promise<LibraryOutcome<LibraryAssessResult>> {
    this.assertAlive('putAttempt')
    const project = this.readProjectOrRefusal(request.projectId)
    if ('error' in project) return project
    const quizId = request.quizId
    const nodeId = request.nodeId
    if ((quizId === undefined) === (nodeId === undefined)) {
      return refuse('invalid', 'assess takes exactly one of quizId / nodeId — quizId: a graded sitting on a stored quiz; nodeId: acceptance of a practice station')
    }
    if (request.verdicts.length === 0) {
      return refuse('invalid', 'library_assess needs the verdicts — one per question: { task: <question id>, criterion, pass, ratio?, evidence, by, void?, missedCard? }')
    }
    if (quizId !== undefined) return await this.putQuizAttempt(project.value, quizId, request.verdicts)
    return await this.putPracticeAttempt(project.value, nodeId ?? '', request.bookId, request.verdicts)
  }

  /** The quiz path of putAttempt: verdicts judged against a stored quiz's questions. */
  private async putQuizAttempt(project: LibraryProject, quizId: string, verdicts: readonly LibraryVerdict[]): Promise<LibraryOutcome<LibraryAssessResult>> {
    const quiz = this.store.readQuiz(project.id, quizId)
    if (quiz === undefined) return refuse('not-found', `no quiz ${JSON.stringify(quizId)} — store the quiz first (library_write · quiz), then assess it`)
    const questionById = new Map(quiz.questions.map(question => [question.id, question]))
    for (const [index, verdict] of verdicts.entries()) {
      if (!questionById.has(verdict.task)) {
        return refuse('invalid', `verdicts[${index}] judges task ${JSON.stringify(verdict.task)}, which quiz ${quiz.id} does not ask — its questions are: ${quiz.questions.map(question => question.id).join(', ')}`)
      }
      if (verdict.criterion.trim() === '' || verdict.evidence.trim() === '') {
        return refuse('invalid', `verdicts[${index}] (${verdict.task}) needs criterion and evidence — WHAT was judged and WHERE the answer is grounded`)
      }
      if (verdict.by !== 'llm' && verdict.by !== 'self' && verdict.by !== 'user') return refuse('invalid', `verdicts[${index}].by must be llm | self | user`)
      if (verdict.ratio !== undefined && !(verdict.ratio >= 0 && verdict.ratio <= 1)) return refuse('invalid', `verdicts[${index}].ratio is partial credit in [0, 1]`)
    }
    const counted = verdicts.filter(verdict => verdict.void !== true)
    const ratio = counted.length === 0 ? 0 : counted.reduce((sum, verdict) => sum + (verdict.ratio ?? (verdict.pass ? 1 : 0)), 0) / counted.length
    return await this.mutate(project.id, () => {
      const now = new Date()
      const at = now.toISOString()
      const attempt: LibraryAttempt = { id: mintLibraryId('a'), quizId: quiz.id, verdicts, ratio, at }
      this.store.appendAttempt(project.id, attempt)

      // Cards: every counted verdict moves the cards its question probed.
      const cards = this.store.readCards(project.id)
      const byId = new Map(cards.map(card => [card.id, card]))
      const order = cards.map(card => card.id)
      const touched = new Map<string, LibraryCardUpdate>()
      const book = quiz.scope.bookId === undefined ? undefined : this.store.readBook(project.id, quiz.scope.bookId)
      for (const verdict of counted) {
        const question = questionById.get(verdict.task)!
        const credit = verdict.ratio ?? (verdict.pass ? 1 : 0)
        const passed = verdict.pass && credit >= 0.5
        const cardIds = [...(question.target.cardIds ?? [])]
        if (cardIds.length === 0 && !passed) {
          const created = this.missedCardFor(question, verdict, quiz, book?.id, project.template, at)
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
      if (touched.size > 0) this.store.writeCards(project.id, order.map(cardId => byId.get(cardId)!))

      // The gated node's stats, its completion, and what that unlocks.
      let unlocked: string[] = []
      let completed: string | undefined
      const roadmap = quiz.scope.nodeId === undefined ? undefined : this.store.readRoadmap(project.id, quiz.scope.bookId)
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
        this.store.writeRoadmap(project.id, { ...roadmap, nodes: result.nodes })
      }
      const created = [...touched.values()].filter(update => update.created === true)
      const onBook = quiz.scope.bookId === undefined ? {} : { bookId: quiz.scope.bookId }
      this.store.appendEvents(project.id, [
        { at, type: 'attempt.assessed', id: quiz.id, ...onBook, ratio },
        ...(created.length === 0 ? [] : [{
          at,
          type: 'cards.recorded' as const,
          source: 'quiz' as const,
          title: created.map(update => update.term).join('、').slice(0, 300),
          ids: created.map(update => update.id),
          ...onBook,
          count: created.length,
        }]),
        ...(completed === undefined ? [] : [{ at, type: 'node.completed' as const, id: completed, title: titleOf(roadmap?.nodes ?? [], completed), ...onBook, ratio }]),
        ...unlocked.map(nodeId => ({ at, type: 'node.unlocked' as const, id: nodeId, title: titleOf(roadmap?.nodes ?? [], nodeId), ...onBook })),
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

  /**
   * The practice path of putAttempt: acceptance of a hands-on station. No quiz
   * entity, no probed cards — a failed acceptance line with a `missedCard`
   * leaves (or re-weakens) a card; at the pass ratio the station completes.
   */
  private async putPracticeAttempt(project: LibraryProject, nodeId: string, bookId: string | undefined, verdicts: readonly LibraryVerdict[]): Promise<LibraryOutcome<LibraryAssessResult>> {
    const roadmap = this.store.readRoadmap(project.id, bookId)
    const node = roadmap?.nodes.find(candidate => candidate.id === nodeId)
    if (roadmap === undefined || node === undefined) {
      return refuse('not-found', `no station ${JSON.stringify(nodeId)} on the adopted path — library_read · roadmap lists the nodes`)
    }
    if (node.kind !== 'practice') {
      return refuse('state-machine', `${node.title} is a ${node.kind} node — a quiz node completes by passing its quiz (assess with quizId), a read node by 读完; only a practice station takes acceptance verdicts`)
    }
    const acceptance = node.acceptance ?? []
    for (const [index, verdict] of verdicts.entries()) {
      if (!acceptance.includes(verdict.criterion)) {
        return refuse('invalid', `verdicts[${index}].criterion must be one of the station's acceptance lines, verbatim — they are: ${acceptance.map(line => JSON.stringify(line)).join(', ')}`)
      }
      if (verdict.evidence.trim() === '') {
        return refuse('invalid', `verdicts[${index}] needs evidence — what the learner showed (terminal output, a screenshot, a repo link)`)
      }
      if (verdict.by !== 'llm' && verdict.by !== 'self' && verdict.by !== 'user') return refuse('invalid', `verdicts[${index}].by must be llm | self | user`)
      if (verdict.ratio !== undefined && !(verdict.ratio >= 0 && verdict.ratio <= 1)) return refuse('invalid', `verdicts[${index}].ratio is partial credit in [0, 1]`)
    }
    const counted = verdicts.filter(verdict => verdict.void !== true)
    const ratio = counted.length === 0 ? 0 : counted.reduce((sum, verdict) => sum + (verdict.ratio ?? (verdict.pass ? 1 : 0)), 0) / counted.length
    return await this.mutate(project.id, () => {
      const now = new Date()
      const at = now.toISOString()
      const attempt: LibraryAttempt = { id: mintLibraryId('a'), nodeId: node.id, verdicts, ratio, at }
      this.store.appendAttempt(project.id, attempt)

      // Cards: a failed acceptance line may leave a card (missedCard); a
      // re-miss of a known card weakens it, exactly like a quiz miss.
      const cards = this.store.readCards(project.id)
      const byId = new Map(cards.map(card => [card.id, card]))
      const order = cards.map(card => card.id)
      const touched = new Map<string, LibraryCardUpdate>()
      for (const verdict of counted) {
        const passed = verdict.pass && (verdict.ratio ?? 1) >= 0.5
        if (passed || verdict.missedCard === undefined) continue
        const term = verdict.missedCard.term.trim() || verdict.criterion.slice(0, 80)
        const gloss = verdict.missedCard.gloss.trim() || verdict.criterion
        const existing = exactMatch([...byId.values()], [cardKey(term)])
        if (existing !== undefined) {
          if (!live(existing)) continue
          const next: LibraryCard = {
            ...existing,
            mastery: { box: 0, dueAt: leitnerDueAt(0, now), streak: 0 },
            weakness: clampWeakness(existing.weakness + 1),
            sources: [...existing.sources, { type: 'quiz', note: verdict.criterion.slice(0, 120), weakened: true, at }],
            updatedAt: at,
          }
          byId.set(next.id, next)
          touched.set(next.id, { id: next.id, term: next.term, weakness: next.weakness, mastery: next.mastery })
          continue
        }
        const card: LibraryCard = {
          id: mintLibraryId('c'),
          kind: project.template === 'language' && !/\s/.test(term) ? 'word' : 'concept',
          term,
          aliases: [],
          gloss,
          contexts: [],
          sources: [{ type: 'quiz', note: verdict.criterion.slice(0, 120), weakened: true, at }],
          weakness: 1,
          mastery: { box: 0, dueAt: leitnerDueAt(0, now), streak: 0 },
          status: 'active',
          createdAt: at,
          updatedAt: at,
        }
        byId.set(card.id, card)
        order.push(card.id)
        touched.set(card.id, { id: card.id, term: card.term, weakness: card.weakness, mastery: card.mastery, created: true })
      }
      if (touched.size > 0) this.store.writeCards(project.id, order.map(cardId => byId.get(cardId)!))

      // The station's completion and what it unlocks (practice carries no quizStats).
      const passRatio = roadmap.passRatio ?? DEFAULT_PASS_RATIO
      let unlocked: string[] = []
      let completed: string | undefined
      if (ratio >= passRatio && node.state === 'current') {
        completed = node.id
        const marked = roadmap.nodes.map(candidate => candidate.id === node.id ? { ...candidate, state: 'done' as const } : candidate)
        const result = unlockReady(marked)
        unlocked = result.unlocked
        this.store.writeRoadmap(project.id, { ...roadmap, nodes: result.nodes })
      }
      const created = [...touched.values()].filter(update => update.created === true)
      const onBook = bookId === undefined ? {} : { bookId }
      this.store.appendEvents(project.id, [
        { at, type: 'attempt.assessed', id: node.id, ...onBook, ratio },
        ...(created.length === 0 ? [] : [{
          at,
          type: 'cards.recorded' as const,
          source: 'quiz' as const,
          title: created.map(update => update.term).join('、').slice(0, 300),
          ids: created.map(update => update.id),
          ...onBook,
          count: created.length,
        }]),
        ...(completed === undefined ? [] : [{ at, type: 'node.completed' as const, id: completed, title: titleOf(roadmap.nodes, completed), ...onBook, ratio }]),
        ...unlocked.map(unlockedId => ({ at, type: 'node.unlocked' as const, id: unlockedId, title: titleOf(roadmap.nodes, unlockedId), ...onBook })),
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

  /** A project's graded sittings, newest first; `nodeId` narrows to one practice station's acceptance history. */
  async listAttempts(request: { projectId: string; nodeId?: string }): Promise<{ attempts: LibraryAttempt[] }> {
    this.assertAlive('listAttempts')
    const attempts = this.store.readAttempts(request.projectId)
    return { attempts: (request.nodeId === undefined ? attempts : attempts.filter(attempt => attempt.nodeId === request.nodeId)).reverse() }
  }

  /* ------------------------------------------------------------- bindings */

  /** The project / book a session works on, when it is bound. */
  getBinding(sessionId: string): LibraryBinding | undefined {
    this.assertAlive('getBinding')
    return this.store.readBindings().get(sessionId)
  }

  /** Bind a session (null unbinds). The project and book must exist. */
  async setBinding(sessionId: string, binding: LibraryBinding | null): Promise<LibraryOutcome<{ binding: LibraryBinding | null }>> {
    this.assertAlive('setBinding')
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
   * its current node and draft flag, and the weakest live cards there. A
   * project-only binding reports the PROJECT path's current station in
   * `progress` (the book's when bound to a book).
   */
  bindingSummary(sessionId: string, cardLimit: number = 12): {
    binding?: LibraryBinding
    project?: LibraryProject
    book?: LibraryBook
    progress?: LibraryBookProgress
    weakCards: LibraryCard[]
  } {
    this.assertAlive('bindingSummary')
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
    // No bound book: the progress is the project's own path (current station,
    // a waiting draft) so the coach sees it every turn.
    const pathProgress = (): LibraryBookProgress | undefined => {
      if (book !== undefined) return this.bookProgress(project.id, book)
      const roadmap = this.store.readRoadmap(project.id)
      const draft = this.store.readRoadmap(project.id, undefined, 'draft')
      if (roadmap === undefined && draft === undefined) return undefined
      const current = roadmap?.nodes.find(node => node.state === 'current')
      return {
        id: project.id,
        title: project.name,
        ...(roadmap === undefined ? {} : {
          roadmap: { done: roadmap.nodes.filter(node => node.state === 'done').length, total: roadmap.nodes.length },
        }),
        ...(current === undefined ? {} : { current: { id: current.id, title: current.title } }),
        hasDraft: draft !== undefined,
      }
    }
    const weakCards = this.store.readCards(project.id)
      .filter(card => card.status === 'active' && card.weakness > 0 && (book === undefined || card.bookId === book.id))
      .sort((a, b) => b.weakness - a.weakness || b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, cardLimit)
    const progress = pathProgress()
    return {
      binding,
      project,
      ...(book === undefined ? {} : { book }),
      ...(progress === undefined ? {} : { progress }),
      weakCards,
    }
  }

  /* --------------------------------------------------------------- events */

  /** One project's audit trail, newest first, optionally some types only. */
  async listEvents(request: { projectId: string; limit?: number; types?: readonly LibraryEventType[] }): Promise<{ events: LibraryEvent[] }> {
    this.assertAlive('listEvents')
    const types = request.types === undefined ? undefined : new Set(request.types)
    const events = this.store.readEvents(request.projectId).filter(event => types === undefined || types.has(event.type))
    return { events: events.reverse().slice(0, request.limit ?? 20) }
  }

  /** 「教练最近记下」: card recordings from chats and quizzes, across projects, newest first. */
  async recentRecords(request: { limit?: number }): Promise<{ records: (LibraryEvent & { projectId: string; projectName: string })[] }> {
    this.assertAlive('recentRecords')
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

  /**
   * The newest event's timestamp across the library — the pane's change poll.
   * The Remote face is request/response (no push), so the sidebar learns
   * host-side writes (a landed quiz, a recorded page) by polling this and
   * re-reading when it moves.
   */
  async latestActivity(): Promise<{ at?: string }> {
    this.assertAlive('latestActivity')
    let latest: string | undefined
    for (const project of this.store.readIndex().projects) {
      const at = this.store.readEvents(project.id).at(-1)?.at
      if (at !== undefined && (latest === undefined || at > latest)) latest = at
    }
    return latest === undefined ? {} : { at: latest }
  }

  /* --------------------------------------------------------------- stats */

  /** The whole-library tally. */
  async stats(): Promise<{ projects: number; books: number; cards: number; due: number; quizzes: number; attempts: number }> {
    this.assertAlive('stats')
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

/**
 * The option an answer key names — a letter in range, a lettered option, the
 * option text, else a one-way containment — or -1. The sidebar's judge
 * (`client/judge.ts`'s choiceIndex) resolves the same spellings; a question
 * this resolves to -1 is judged wrong no matter what the learner picks, so
 * the write gate refuses it.
 */
function choiceOptionIndex(options: readonly string[], answer: string): number {
  const key = normalizeFragment(answer)
  if (/^[a-z]$/.test(key)) {
    const at = key.charCodeAt(0) - 97
    return at < options.length ? at : -1
  }
  const lettered = /^([a-z])[.、)）:：]\s*/.exec(key)
  if (lettered !== null) {
    const at = lettered[1]!.charCodeAt(0) - 97
    return at < options.length ? at : -1
  }
  const exact = options.findIndex(option => normalizeFragment(option) === key)
  if (exact >= 0) return exact
  return options.findIndex(option => normalizeFragment(option).includes(key) || key.includes(normalizeFragment(option)))
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

/**
 * Structural validation of a roadmap's nodes; returns the teaching error or
 * undefined. `scope.bookId` marks a book-level draft: the special case whose
 * every node covers that one book only.
 */
export function validateRoadmapShape(
  nodes: readonly RoadmapNode[],
  scope: {
    /** A book-level draft: the one book every node's covers must name. */
    bookId?: string
    /** Resolve a book cover (existence + contents length). */
    book: (bookId: string) => LibraryBook | undefined
    /** Whether a shelf resource exists. */
    hasResource: (resourceId: string) => boolean
  },
): string | undefined {
  const seen = new Set<string>()
  for (const [index, node] of nodes.entries()) {
    if (typeof node.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(node.id) || seen.has(node.id)) {
      return `nodes[${index}] needs a unique id made of letters, digits, '.', '_', '-' (n1, n2, … is plenty)`
    }
    seen.add(node.id)
    if (typeof node.title !== 'string' || node.title.trim() === '') return `nodes[${index}] (${node.id}) needs a title — what the learner masters here`
    if (node.kind !== 'quiz' && node.kind !== 'read' && node.kind !== 'practice') {
      return `nodes[${index}] (${node.id}) needs kind: "quiz" | "read" | "practice" — quiz nodes gate on a quiz; practice nodes gate on acceptance (a hands-on deliverable); read nodes are optional side stops (读完 completes them, they never gate)`
    }
    if (node.kind === 'practice' && (node.acceptance === undefined || node.acceptance.length === 0)) {
      return `nodes[${index}] (${node.id}) is a practice station — it needs acceptance: ["...", ...], the lines the coach judges one verdict each at assess time`
    }
    if (node.kind !== 'practice' && node.acceptance !== undefined && node.acceptance.length > 0) {
      return `nodes[${index}] (${node.id}) carries acceptance but is not a practice station — acceptance belongs to kind: "practice" only`
    }
    if (!Array.isArray(node.covers) || node.covers.length === 0) {
      return `nodes[${index}] (${node.id}) needs at least one cover — what the station draws on: { kind: "book", bookId, ranges: [{ from, to }] } | { kind: "resource", resourceId } | { kind: "url", url, title? } | { kind: "topic", text }`
    }
    if (scope.bookId !== undefined && (node.covers.length !== 1 || node.covers[0]?.kind !== 'book' || node.covers[0].bookId !== scope.bookId)) {
      return `nodes[${index}] (${node.id}) draws on more than this one book — a book's own path covers that book only; for a path mixing books / links / teaching, draft the PROJECT's path (omit book)`
    }
    for (const cover of node.covers) {
      if (cover.kind === 'book') {
        if (typeof cover.bookId !== 'string' || cover.bookId === '') {
          return `nodes[${index}] (${node.id}) has a book cover with no bookId — { kind: "book", bookId, ranges: [{ from, to }] }; library_read · books lists the ids`
        }
        const covered = scope.book(cover.bookId)
        if (covered === undefined) return `nodes[${index}] (${node.id}) covers book ${JSON.stringify(cover.bookId)}, which the project does not hold — library_read · books lists them; register it first (library_write · book)`
        for (const range of cover.ranges) {
          if (!Number.isInteger(range.from) || !Number.isInteger(range.to) || range.from < 1 || range.to < range.from) {
            return `nodes[${index}] (${node.id}) has a bad range [${String(range.from)}, ${String(range.to)}] on 《${covered.title}》 — ranges count table-of-contents rows, 1-based and inclusive: { from: 3, to: 5 }`
          }
          if (range.to > covered.toc.length) {
            return `nodes[${index}] (${node.id}) covers up to row ${range.to}, but 《${covered.title}》's contents has ${covered.toc.length} rows — library_read · toc lists them`
          }
        }
      } else if (cover.kind === 'resource') {
        if (typeof cover.resourceId !== 'string' || cover.resourceId === '') {
          return `nodes[${index}] (${node.id}) has a resource cover with no resourceId — { kind: "resource", resourceId }; library_read · resources lists the shelf`
        }
        if (!scope.hasResource(cover.resourceId)) {
          return `nodes[${index}] (${node.id}) covers resource ${JSON.stringify(cover.resourceId)}, which is not on the project's shelf — library_read · resources lists them; add it first (library_write · resource, op add)`
        }
      } else if (cover.kind === 'url') {
        if (!/^https?:\/\//.test(cover.url)) return `nodes[${index}] (${node.id}) covers a url that does not start with http:// or https://`
      } else if (cover.kind === 'topic') {
        if (typeof cover.text !== 'string' || cover.text.trim() === '') return `nodes[${index}] (${node.id}) covers a topic with no text — what the coach teaches here`
      } else {
        return `nodes[${index}] (${node.id}) has a cover of an unknown kind — book | resource | url | topic`
      }
    }
    for (const dep of node.dependsOn) {
      const depIndex = nodes.findIndex(candidate => candidate.id === dep)
      if (depIndex === -1) return `nodes[${index}] (${node.id}) depends on ${JSON.stringify(dep)}, which the roadmap does not declare`
      if (node.kind !== 'read' && nodes[depIndex]?.kind === 'read') {
        return `nodes[${index}] (${node.id}) depends on read node ${JSON.stringify(dep)} — a read node is a side stop and never gates a level; depend on the previous quiz or practice node instead. How-to-use pages, answer keys, transcripts and appendices are not nodes at all: put them in the book's extras`
      }
      if (depIndex >= index) return `nodes[${index}] (${node.id}) depends on ${JSON.stringify(dep)}, which comes AFTER it — list a node after everything it depends on`
    }
  }
  // The mirror of the per-node rule above: a PROJECT path whose stations all
  // draw on the same single book is that book's own path written to the wrong
  // scope — the two journeys stay distinct.
  if (scope.bookId === undefined && nodes.length > 0) {
    const bookIds = new Set<string>()
    let onlyBookCovers = true
    for (const node of nodes) {
      for (const cover of node.covers) {
        if (cover.kind !== 'book') { onlyBookCovers = false; break }
        bookIds.add(cover.bookId)
      }
      if (!onlyBookCovers) break
    }
    if (onlyBookCovers && bookIds.size === 1) {
      const onlyId = [...bookIds][0] ?? ''
      const title = scope.book(onlyId)?.title ?? onlyId
      return `every station draws only on 《${title}》 — that is the book's OWN path: resend with book: ${JSON.stringify(onlyId)} (its nodes then cover that book only). The project's own path is for a journey spanning several books / shelf links / coached teaching`
    }
  }
  return undefined
}

/**
 * Why a node's covers forbid a memory-backed content question, or undefined
 * when they allow one: only knowledge books and plain coached teaching (topic)
 * may be quizzed from domain knowledge; a material book, a shelf resource or
 * a bare url among the covers demands a verbatim quote. The evidence-gate's
 * node-level half (a book-scoped quiz without a node keeps the book rule).
 */
export function coversVerbatimBlocker(covers: readonly LibraryNodeCover[], book: (bookId: string) => LibraryBook | undefined): string | undefined {
  for (const cover of covers) {
    if (cover.kind === 'book') {
      const covered = book(cover.bookId)
      if (covered?.bookKind === 'material') return `《${covered.title}》 is a material book (specific text you cannot recall reliably)`
    } else if (cover.kind === 'resource') {
      return 'the station draws on a shelf resource (a linked text you cannot recall reliably)'
    } else if (cover.kind === 'url') {
      return `the station covers ${cover.url} (a web text you cannot recall reliably)`
    }
  }
  return undefined
}
