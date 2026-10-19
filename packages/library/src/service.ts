/**
 * The library service core: owns the store and every rule the data answers
 * to. The Remote face next door is a thin adapter with no logic of its own;
 * the model tools (`tool-definition.ts`) translate these same outcomes into
 * thrown, teaching errors.
 *
 * The rules that live here and nowhere else (v5 — the six-layer model):
 *
 * - **Resources are registered, never uploaded**: a thick one (toc present —
 *   a TEXTBOOK: a book, a course with episodes, a coach-authored outline)
 *   carries title, kind, contents and their source, sits in the project's
 *   study order (`seq`, gapless from 1), and can be routed, covered by
 *   chapter, quizzed and photographed; a thin one is a shelf link a station
 *   cites.
 * - **Roadmaps are drafted by the coach and adopted by the learner**, one
 *   path per textbook (the project carries none — proposal
 *   2026-10-19-library-book-paths). A draft is free to change and a new one
 *   replaces the old; adoption initializes the
 *   state machine (roots `current`, the rest `locked`), keeps the progress
 *   of nodes that survive a re-split, and materializes every acceptance
 *   station's rubric as its practice assessment. The adopted path only moves
 *   forward: `locked → current → done`, by an assessed quiz (quiz gates),
 *   acceptance (acceptance gates) or 「读完」 (read gates).
 * - **Cards dedupe on the write path** (`cards.ts`): an exact key merges,
 *   a near match is held back with candidates for the coach to decide.
 * - **Quiz questions carry two axes** — target (marked / asked / missed /
 *   topic) and evidence (photo / web / knowledge) — and a station's covers
 *   decide whether memory may back a CONTENT question (a material book, a
 *   thin link or a bare url among them demands a verbatim quote).
 * - **The assess cascade** is the only cascading write: verdicts land in the
 *   ledger keyed by ASSESSMENT, then move the probed cards (mastery and
 *   weakness), then the gated node's stats; a node at or above its pass
 *   ratio completes and unlocks.
 * - **Photo provenance is a reference, never a copy**, and reading the bytes
 *   back is whitelisted to pages the project recorded.
 *
 * @module @khorsheed/dsh-library/service
 */
import type { Context } from '@deepseek-ai/cordis'
import {
  DEFAULT_PASS_RATIO,
  isLibraryId,
  LIBRARY_COLORS,
  LIBRARY_ICONS,
  LIBRARY_RESOURCE_KINDS,
  LIBRARY_RESOURCE_ORIGINS,
  TEMPLATE_LOOK,
  LEITNER_INTERVAL_DAYS,
  acceptanceLines,
  coverKind,
  coverTopic,
  isThickResource,
  libraryErrorMessage,
  parseLocator,
  MAX_BOX,
  MAX_WEAKNESS,
  type LibraryAcceptanceInput,
  type LibraryAcceptanceLine,
  type LibraryAssessResult,
  type LibraryAssessment,
  type LibraryAttachmentRef,
  type LibraryAttempt,
  type LibraryBinding,
  type LibraryBookKind,
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
  type LibraryQuizFocus,
  type LibraryQuizQuestion,
  type LibraryRefusal,
  type LibraryResource,
  type LibraryResourceKind,
  type LibraryResourceOrigin,
  type LibraryResourceProgress,
  type LibraryNodeCover,
  type LibraryNodeNotes,
  type LibraryPoint,
  type LibraryReviewRating,
  type LibraryRoadmap,
  type LibraryTemplate,
  type LibraryTocSource,
  type LibraryVerdict,
  type RoadmapNode,
} from './types.ts'
import { cardKey, cardKeys, cardMatchesQuery, exactMatch, nearMatches } from './cards.ts'
import { LibraryStore, LibraryStoreError, mintLibraryId } from './store.ts'

const PACKAGE_NAME = '@khorsheed/dsh-library'

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

  /** One resource's progress row (a thick resource's roadmap; a thin link's bare row). */
  private resourceProgress(projectId: string, resource: LibraryResource): LibraryResourceProgress {
    const roadmap = isThickResource(resource) ? this.store.readRoadmap(projectId, resource.id) : undefined
    const current = roadmap?.nodes.find(node => node.state === 'current')
    const draft = isThickResource(resource) ? this.store.readRoadmap(projectId, resource.id, 'draft') : undefined
    return {
      id: resource.id,
      title: resource.title,
      kind: resource.kind,
      ...(resource.seq === undefined ? {} : { seq: resource.seq }),
      ...(resource.origin === undefined ? {} : { origin: resource.origin }),
      ...(roadmap === undefined ? {} : {
        roadmap: { done: roadmap.nodes.filter(node => node.state === 'done').length, total: roadmap.nodes.length },
      }),
      ...(current === undefined ? {} : { current: { id: current.id, title: current.title } }),
      hasDraft: draft !== undefined,
      ...(draft === undefined ? {} : { draftTotal: draft.nodes.length }),
    }
  }

  private summarize(project: LibraryProject): LibraryProjectSummary {
    const now = new Date().toISOString()
    const cards = this.store.readCards(project.id).filter(live)
    return {
      ...project,
      resources: this.store.listResources(project.id).map(resource => this.resourceProgress(project.id, resource)),
      cardCount: cards.length,
      dueCount: cards.filter(card => card.status === 'active' && card.mastery.dueAt <= now).length,
      lastActiveAt: this.store.readEvents(project.id).at(-1)?.at ?? project.createdAt,
    }
  }

  /** Every project with its resources' progress and card tallies. */
  async listProjects(): Promise<{ projects: LibraryProjectSummary[] }> {
    this.assertAlive('listProjects')
    // Most recently used first: the list is where the learner picks up again.
    const projects = this.store.readIndex().projects.map(project => this.summarize(project))
    projects.sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt))
    return { projects }
  }

  /** One project's summary plus its resources' full records. */
  async getProject(request: { id: string }): Promise<LibraryOutcome<{ project: LibraryProjectSummary; resources: LibraryResource[] }>> {
    this.assertAlive('getProject')
    const project = this.readProjectOrRefusal(request.id)
    if ('error' in project) return project
    return { ok: true, project: this.summarize(project.value), resources: this.store.listResources(project.value.id) }
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
        if (project === undefined) return refuse('not-found', `no project ${JSON.stringify(request.id)} — ids are minted (p_…); library_read · projects lists the ones that exist, and omitting projectId creates a new project`)
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

  /* ------------------------------------------------------------ resources */

  /**
   * Put one entry on the project's shelf — the v5 unified write. A THICK
   * entry (kind "book", or any kind carrying `toc`) registers its contents:
   * the coach's table of contents, verified on the web whenever it can be,
   * and cover locators count its rows. A THIN link is title + url + the
   * coach's one-line why. Pass `resourceId` to correct an existing entry.
   */
  async putResource(request: {
    projectId: string
    resourceId?: string
    title: string
    kind: LibraryResourceKind
    url?: string
    note?: string
    origin?: LibraryResourceOrigin
    /** A textbook's place in the study order: inserts there (the rest shift down); omitted, a new textbook queues last. */
    seq?: number
    toc?: readonly { title: string; part?: string }[]
    tocSource?: LibraryTocSource
    bookKind?: LibraryBookKind
    short?: string
    extras?: readonly { title: string; note?: string; where?: string; when?: 'before' | 'reference' }[]
    author?: string
    edition?: string
    isbn?: string
    /** Register a clone of another project's resource (its toc and verification come along). */
    from?: { projectId: string; resourceId: string }
  }): Promise<LibraryOutcome<{ resource: LibraryResource }>> {
    this.assertAlive('putResource')
    const project = this.readProjectOrRefusal(request.projectId)
    if ('error' in project) return project
    // The clone path: copy the source's record under a new id (or over an
    // existing entry when resourceId names it).
    if (request.from !== undefined) {
      const source = this.store.readResource(request.from.projectId, request.from.resourceId)
      if (source === undefined) {
        return refuse('not-found', `no resource ${JSON.stringify(request.from.resourceId)} in project ${JSON.stringify(request.from.projectId)} — the clone source must exist; library_read · resources there lists them`)
      }
      return await this.mutate(project.value.id, () => {
        const existing = request.resourceId === undefined ? undefined : this.store.readResource(project.value.id, request.resourceId)
        if (request.resourceId !== undefined && existing === undefined) {
          return refuse('not-found', `no resource ${JSON.stringify(request.resourceId)} in this project — omit resourceId to clone a fresh one`)
        }
        const now = new Date().toISOString()
        const { seq: _sourceSeq, ...copied } = source
        const resource: LibraryResource = {
          ...copied,
          id: existing?.id ?? mintLibraryId('r'),
          ...(existing?.seq === undefined ? {} : { seq: existing.seq }),
          createdAt: existing?.createdAt ?? now,
        }
        this.store.writeResource(project.value.id, resource)
        if (isThickResource(resource)) this.placeTextbook(project.value.id, resource.id, existing?.seq ?? request.seq)
        if (existing === undefined) this.event(project.value.id, 'resource.added', { id: resource.id, title: resource.title, resourceId: resource.id, ...(resource.toc === undefined ? {} : { count: resource.toc.length }) })
        return { ok: true as const, resource }
      })
    }
    const title = request.title?.trim() ?? ''
    if (title === '') return refuse('invalid', 'a resource needs its title — what its own page / cover calls it')
    if (request.origin !== undefined && !(LIBRARY_RESOURCE_ORIGINS as readonly string[]).includes(request.origin)) {
      return refuse('invalid', 'origin is learner | picked | authored — learner: the learner\'s own; picked: an existing book / course / link you chose; authored: a textbook you wrote yourself (your contents, your 讲义 are its text)')
    }
    if (request.seq !== undefined && !(Number.isInteger(request.seq) && request.seq > 0)) {
      return refuse('invalid', 'seq is the textbook\'s place in the study order — a whole number from 1')
    }
    if (!(LIBRARY_RESOURCE_KINDS as readonly string[]).includes(request.kind)) {
      return refuse('invalid', `kind is ${LIBRARY_RESOURCE_KINDS.join(' | ')} — book: a book (contents required); course: a lecture series with episodes (contents required); article | video | repo | tool | hardware: a thin link (url required)`)
    }
    const wantsToc = request.toc !== undefined
    // One row per chapter: a row that only repeats its part's heading is the
    // part, not a chapter (a live run stored nine of them among 64 chapters).
    const toc = (request.toc ?? []).filter(entry => entry.title.trim() !== '' && entry.title.trim() !== entry.part?.trim())
    if (request.kind === 'book' || wantsToc) {
      if (toc.length === 0) {
        return refuse('invalid', 'a thick resource (a book, a course with episodes) needs its table of contents — search the web for the contents (publisher page, library catalog), or ask the learner to photograph the contents page; each row: { title, part? }')
      }
      if (request.tocSource === undefined || !['web', 'model', 'photo'].includes(request.tocSource.by)) {
        return refuse('invalid', 'tocSource.by is web | model | photo — say where the contents came from; web needs the url')
      }
      if (request.tocSource.by === 'web' && (request.tocSource.url === undefined || !/^https?:\/\//.test(request.tocSource.url))) {
        return refuse('invalid', 'a web-sourced table of contents carries the url it came from (tocSource.url) — the learner checks it on the draft card')
      }
      if (request.bookKind !== undefined && request.bookKind !== 'knowledge' && request.bookKind !== 'material') {
        return refuse('invalid', 'bookKind is knowledge | material — knowledge: the content is domain knowledge (a textbook, popular science; the coach may quiz from what it knows); material: specific text the model cannot recall (exam papers, novels; quizzing needs a photo or a web quote)')
      }
    } else {
      const url = request.url?.trim() ?? ''
      if (!/^https?:\/\//.test(url)) {
        return refuse('invalid', 'a thin link\'s url starts with http:// or https:// — the learner opens it straight off the shelf')
      }
    }
    return await this.mutate(project.value.id, () => {
      const existing = request.resourceId === undefined ? undefined : this.store.readResource(project.value.id, request.resourceId)
      if (request.resourceId !== undefined && existing === undefined) {
        return refuse('not-found', `no resource ${JSON.stringify(request.resourceId)} in this project — omit resourceId to add a new one; library_read · resources lists the existing ids`)
      }
      if (existing === undefined && toc.length > 0 && this.store.listResources(project.value.id).some(resource => resource.title === title && resource.meta?.edition === request.edition?.trim() && isThickResource(resource))) {
        return refuse('exists', `《${title}》 is already on this project's shelf — pass its resourceId to correct it`)
      }
      if (existing === undefined && toc.length === 0 && request.url !== undefined && this.store.listResources(project.value.id).some(resource => resource.url === request.url?.trim())) {
        return refuse('exists', `${request.url.trim()} is already on this project's shelf — pass its resourceId to correct it`)
      }
      const now = new Date().toISOString()
      const meta = (() => {
        const merged = {
          ...(request.bookKind === undefined ? (existing?.meta?.bookKind === undefined ? {} : { bookKind: existing.meta.bookKind }) : { bookKind: request.bookKind }),
          ...(request.short === undefined || request.short.trim() === ''
            ? (existing?.meta?.short === undefined ? {} : { short: existing.meta.short })
            : { short: request.short.trim().slice(0, 8) }),
          ...(request.extras === undefined
            ? (existing?.meta?.extras === undefined ? {} : { extras: existing.meta.extras })
            : {
              extras: request.extras.filter(extra => typeof extra.title === 'string' && extra.title.trim() !== '').map(extra => ({
                title: extra.title.trim(),
                ...(extra.note === undefined || extra.note.trim() === '' ? {} : { note: extra.note.trim() }),
                ...(extra.where === undefined || extra.where.trim() === '' ? {} : { where: extra.where.trim() }),
                when: extra.when === 'reference' ? 'reference' as const : 'before' as const,
              })),
            }),
          ...(request.author === undefined || request.author.trim() === '' ? (existing?.meta?.author === undefined ? {} : { author: existing.meta.author }) : { author: request.author.trim() }),
          ...(request.edition === undefined || request.edition.trim() === '' ? (existing?.meta?.edition === undefined ? {} : { edition: existing.meta.edition }) : { edition: request.edition.trim() }),
          ...(request.isbn === undefined || request.isbn.trim() === '' ? (existing?.meta?.isbn === undefined ? {} : { isbn: existing.meta.isbn }) : { isbn: request.isbn.trim() }),
        }
        return Object.keys(merged).length === 0 ? undefined : merged
      })()
      const resource: LibraryResource = {
        id: existing?.id ?? mintLibraryId('r'),
        title,
        kind: request.kind,
        ...(request.url === undefined || request.url.trim() === '' ? (existing?.url === undefined ? {} : { url: existing.url }) : { url: request.url.trim() }),
        ...(request.note === undefined || request.note.trim() === '' ? (existing?.note === undefined ? {} : { note: existing.note }) : { note: request.note.trim() }),
        origin: request.origin ?? existing?.origin ?? 'picked',
        ...(existing?.seq === undefined || toc.length === 0 ? {} : { seq: existing.seq }),
        ...(toc.length === 0 ? {} : {
          toc: toc.map((entry, index) => ({
            n: index + 1,
            title: entry.title.trim(),
            ...(entry.part === undefined || entry.part.trim() === '' ? {} : { part: entry.part.trim() }),
          })),
        }),
        ...(request.tocSource === undefined ? (existing?.tocSource === undefined ? {} : { tocSource: existing.tocSource }) : { tocSource: { ...request.tocSource, verifiedAt: request.tocSource.verifiedAt ?? now } }),
        ...(meta === undefined ? {} : { meta }),
        createdAt: existing?.createdAt ?? now,
      }
      this.store.writeResource(project.value.id, resource)
      const placed = isThickResource(resource) ? this.placeTextbook(project.value.id, resource.id, request.seq ?? existing?.seq) : resource
      if (existing === undefined) this.event(project.value.id, 'resource.added', { id: resource.id, title: resource.title, resourceId: resource.id, ...(resource.toc === undefined ? {} : { count: resource.toc.length }) })
      return { ok: true as const, resource: placed }
    })
  }

  /**
   * Renumber a project's textbooks gapless from 1 with `resourceId` at
   * `seq` (clamped; omitted = keep its place, or last when it has none).
   * Call inside the project lock. Returns the placed resource as stored.
   */
  private placeTextbook(projectId: string, resourceId: string, seq: number | undefined): LibraryResource {
    const textbooks = this.store.listResources(projectId).filter(isThickResource)
    const moving = textbooks.find(candidate => candidate.id === resourceId)
    const others = textbooks.filter(candidate => candidate.id !== resourceId)
    if (moving !== undefined) {
      const at = seq === undefined
        ? (moving.seq === undefined ? others.length : Math.min(others.filter(other => (other.seq ?? Infinity) < moving.seq!).length, others.length))
        : Math.min(Math.max(seq - 1, 0), others.length)
      others.splice(at, 0, moving)
    }
    let placed: LibraryResource | undefined
    for (const [index, textbook] of others.entries()) {
      const next = textbook.seq === index + 1 ? textbook : { ...textbook, seq: index + 1 }
      if (next !== textbook) this.store.writeResource(projectId, next)
      if (next.id === resourceId) placed = next
    }
    return placed ?? this.store.readResource(projectId, resourceId)!
  }

  /** Move a textbook to another place in the study order (the rest shift). */
  async moveResource(request: { projectId: string; resourceId: string; seq: number }): Promise<LibraryOutcome<{ resources: LibraryResource[] }>> {
    this.assertAlive('moveResource')
    const project = this.readProjectOrRefusal(request.projectId)
    if ('error' in project) return project
    if (!(Number.isInteger(request.seq) && request.seq > 0)) return refuse('invalid', 'seq is a place in the study order — a whole number from 1')
    return await this.mutate(project.value.id, () => {
      const resource = this.store.readResource(project.value.id, request.resourceId)
      if (resource === undefined) return refuse('not-found', `no resource ${JSON.stringify(request.resourceId)} in this project — library_read · resources lists them`)
      if (!isThickResource(resource)) return refuse('invalid', `《${resource.title}》 is a link without contents — only textbooks have a place in the study order`)
      this.placeTextbook(project.value.id, resource.id, request.seq)
      return { ok: true as const, resources: this.store.listResources(project.value.id) }
    })
  }

  /** Remove a shelf entry: its record, roadmaps and pages (cards stay, unhung); the textbooks behind it move up. */
  async removeResource(request: { projectId: string; resourceId: string }): Promise<LibraryOutcome<{ id: string }>> {
    this.assertAlive('removeResource')
    const project = this.readProjectOrRefusal(request.projectId)
    if ('error' in project) return project
    return await this.mutate(project.value.id, () => {
      if (this.store.readResource(project.value.id, request.resourceId) === undefined) {
        return refuse('not-found', `no resource ${JSON.stringify(request.resourceId)} in this project`)
      }
      this.store.removeResource(project.value.id, request.resourceId)
      this.placeTextbook(project.value.id, request.resourceId, undefined)
      const cards = this.store.readCards(project.value.id)
      if (cards.some(card => card.resourceId === request.resourceId)) {
        this.store.writeCards(project.value.id, cards.map(card => {
          if (card.resourceId !== request.resourceId) return card
          const { resourceId: _dropped, ...rest } = card
          return rest
        }))
      }
      return { ok: true as const, id: request.resourceId }
    })
  }

  /** One shelf entry, whole. */
  async getResource(request: { projectId: string; resourceId: string }): Promise<LibraryOutcome<{ resource: LibraryResource }>> {
    this.assertAlive('getResource')
    const resource = this.store.readResource(request.projectId, request.resourceId)
    if (resource === undefined) return refuse('not-found', `no resource ${JSON.stringify(request.resourceId)} — library_read · resources lists the project's`)
    return { ok: true, resource }
  }

  /** A project's shelf: textbooks in study order, then links oldest first. */
  async listResources(request: { projectId: string }): Promise<{ resources: LibraryResource[] }> {
    this.assertAlive('listResources')
    return { resources: this.store.listResources(request.projectId) }
  }

  /** The project holding a resource, when an id is all the caller has (the tools' project fallback). */
  findResourceOwner(resourceId: string): string | undefined {
    this.assertAlive('findResourceOwner')
    for (const project of this.store.readIndex().projects) {
      if (this.store.readResource(project.id, resourceId) !== undefined) return project.id
    }
    return undefined
  }

  /* ------------------------------------------------------------- roadmap */

  /** One textbook's adopted roadmap and its pending draft. */
  async getRoadmap(request: { projectId: string; resourceId: string }): Promise<{ roadmap?: LibraryRoadmap; draft?: LibraryRoadmap }> {
    this.assertAlive('getRoadmap')
    const roadmap = this.store.readRoadmap(request.projectId, request.resourceId)
    const draft = this.store.readRoadmap(request.projectId, request.resourceId, 'draft')
    return { ...(roadmap === undefined ? {} : { roadmap }), ...(draft === undefined ? {} : { draft }) }
  }

  /**
   * Write the coach's draft of one textbook's path; it replaces the
   * textbook's previous draft. Shape rules: unique ids, a gate, at least one
   * cover per node, references that exist, locators inside the resource's
   * contents, dependencies pointing backwards. States are not the coach's to
   * set — adoption initializes them.
   */
  async draftRoadmap(request: {
    projectId: string
    resourceId: string
    nodes: readonly {
      id: string
      title: string
      gate: RoadmapNode['gate']
      goals?: readonly string[] | string
      covers?: readonly LibraryNodeCover[]
      dependsOn?: readonly string[]
      acceptance?: readonly LibraryAcceptanceInput[]
      /** Quiz-gated stations only: the knowledge points this station tests (3-6) — stable slug ids, reviewed on the draft card. */
      points?: readonly LibraryPoint[]
    }[]
    passRatio?: number
    note?: string
  }): Promise<LibraryOutcome<{ draft: LibraryRoadmap }>> {
    this.assertAlive('draftRoadmap')
    const project = this.readProjectOrRefusal(request.projectId)
    if ('error' in project) return project
    const textbooks = this.store.listResources(project.value.id).filter(isThickResource)
    const shelf = textbooks.length === 0
      ? 'this project has no textbook yet — register one first (library_resource with a contents: the learner\'s book, one you pick, or one you author)'
      : `this project's textbooks: ${textbooks.map(textbook => `${textbook.seq ?? '-'}. ${textbook.id} 《${textbook.title}》`).join('; ')}`
    if (typeof request.resourceId !== 'string' || request.resourceId.trim() === '') {
      return refuse('invalid', `a path belongs to one textbook — pass resource; ${shelf}`)
    }
    const primary = isLibraryId(request.resourceId) ? this.store.readResource(project.value.id, request.resourceId) : undefined
    if (primary === undefined) {
      return refuse('not-found', `no resource ${JSON.stringify(request.resourceId)} in project ${JSON.stringify(project.value.name)} — ${shelf}`)
    }
    if (!isThickResource(primary)) {
      return refuse('invalid', `《${primary.title}》 is a link without contents — it never carries a path; cite it inside a station of a textbook's path (also: ["${primary.id}"]). ${shelf}`)
    }
    if (request.nodes.length === 0) {
      return refuse('invalid', 'a roadmap needs at least one node — split the material into learning stations; each: { id, title, gate: "quiz"|"acceptance"|"read", goals, covers: ["r_…#1-5" | "https://…" | "topic: …"], dependsOn }; an acceptance station also needs acceptance: [...]')
    }
    if (request.passRatio !== undefined && !(request.passRatio > 0 && request.passRatio <= 1)) {
      return refuse('invalid', 'passRatio is a fraction in (0, 1] — 0.8 means 8 of 10 right')
    }
    for (const node of request.nodes) {
      if (node.points === undefined || node.points.length === 0) continue
      if (node.gate !== 'quiz') return refuse('invalid', `${node.title} is a ${node.gate} node — points (考点) belong to quiz-gated stations only`)
      const seen = new Set<string>()
      for (const point of node.points) {
        if (!isLibraryId(point.id)) return refuse('invalid', `point id ${JSON.stringify(point.id)} on ${node.title} is not a safe slug (letters, digits, . _ -) — it is the mastery key, stable across quizzes`)
        if (typeof point.title !== 'string' || point.title.trim() === '') return refuse('invalid', `point ${point.id} on ${node.title} needs a title — the point as the learner reads it (「极限的定义」)`)
        if (seen.has(point.id)) return refuse('invalid', `duplicate point id ${point.id} on ${node.title} — reference the existing one`)
        seen.add(point.id)
      }
    }
    const nodes: RoadmapNode[] = request.nodes.map(node => ({
      id: node.id,
      title: node.title,
      gate: node.gate,
      // A model writes one goal as a bare string as often as a list.
      goals: typeof node.goals === 'string' ? [node.goals] : (node.goals ?? []).filter(goal => typeof goal === 'string'),
      covers: node.covers ?? [],
      dependsOn: node.dependsOn ?? [],
      state: 'locked',
      ...(node.points === undefined || node.points.length === 0 ? {} : { points: node.points.map(point => ({ id: point.id, title: point.title.trim() })) }),
      ...(Array.isArray(node.acceptance) ? {
        acceptance: node.acceptance.flatMap((entry): LibraryAcceptanceInput[] => {
          if (typeof entry === 'string') return entry.trim() === '' ? [] : [entry]
          if (typeof entry?.line !== 'string' || entry.line.trim() === '') return []
          return [{ line: entry.line.trim(), ...(typeof entry.ref === 'string' && entry.ref.trim() !== '' ? { ref: entry.ref.trim() } : {}) }]
        }),
      } : {}),
    }))
    const shapeError = validateRoadmapShape(nodes, {
      resourceId: primary.id,
      resource: candidate => this.store.readResource(project.value.id, candidate),
      hasAssessment: candidate => this.store.readAssessment(project.value.id, candidate) !== undefined,
    })
    if (shapeError !== undefined) return refuse('invalid', shapeError)
    return await this.mutate(project.value.id, () => {
      const draft = {
        primaryResourceId: primary.id,
        status: 'draft' as const,
        nodes,
        ...(request.passRatio === undefined ? {} : { passRatio: request.passRatio }),
        ...(request.note === undefined || request.note.trim() === '' ? {} : { note: request.note.trim() }),
        generatedAt: new Date().toISOString(),
      }
      this.store.writeRoadmap(project.value.id, draft)
      this.event(project.value.id, 'roadmap.drafted', { id: primary.id, title: primary.title, resourceId: primary.id, count: nodes.length })
      return { ok: true as const, draft: draft as LibraryRoadmap }
    })
  }

  /**
   * The learner's 采用: the draft becomes the path. Nodes whose deps are
   * all done start `current`; a node that survives a re-split (same id) keeps
   * its state, its quiz stats and its 讲义, so re-planning never erases
   * progress. Every acceptance station's rubric materializes as its practice
   * assessment (unchanged lines reuse the live one — its history stays put;
   * changed lines supersede it).
   */
  async adoptRoadmap(request: { projectId: string; resourceId: string }): Promise<LibraryOutcome<{ roadmap: LibraryRoadmap }>> {
    this.assertAlive('adoptRoadmap')
    const project = this.readProjectOrRefusal(request.projectId)
    if ('error' in project) return project
    return await this.mutate(project.value.id, () => {
      const draft = this.store.readRoadmap(project.value.id, request.resourceId, 'draft')
      if (draft === undefined) return refuse('not-found', 'no draft to adopt here — ask the coach to draft a roadmap first')
      const prior = new Map((this.store.readRoadmap(project.value.id, request.resourceId)?.nodes ?? []).map(node => [node.id, node]))
      const nodes: RoadmapNode[] = []
      for (const node of draft.nodes) {
        const kept = prior.get(node.id)
        const doneIds = new Set(nodes.filter(candidate => candidate.state === 'done').map(candidate => candidate.id))
        const ready = node.gate === 'read' || node.dependsOn.every(dep => doneIds.has(dep))
        const state: RoadmapNode['state'] = kept?.state === 'done' && ready ? 'done' : ready ? 'current' : 'locked'
        nodes.push({
          ...node,
          state,
          ...(node.gate === 'quiz' ? { quizStats: kept?.quizStats ?? { attempts: 0 } } : {}),
          // A re-plan that keeps the station's id also keeps its 讲义.
          ...(kept?.notes !== undefined ? { notes: kept.notes } : {}),
        })
      }
      const now = new Date().toISOString()
      const roadmap = { ...draft, primaryResourceId: request.resourceId, status: 'adopted' as const, nodes, adoptedAt: now }
      this.store.writeRoadmap(project.value.id, roadmap)
      this.store.removeDraft(project.value.id, request.resourceId)
      // Materialize each acceptance station's rubric as its practice assessment.
      this.materializePracticeAssessments(project.value.id, nodes, now)
      const primary = this.store.readResource(project.value.id, request.resourceId)
      this.event(project.value.id, 'roadmap.adopted', {
        at: now,
        id: request.resourceId,
        title: primary?.title ?? request.resourceId,
        resourceId: request.resourceId,
        count: nodes.length,
      })
      return { ok: true as const, roadmap }
    })
  }

  /**
   * Give every acceptance node a practice assessment keyed to it: an
   * unchanged rubric reuses the node's live assessment (its attempts stay
   * attached); a changed rubric supersedes it (the old snapshot keeps the old
   * history). Call inside the project lock.
   */
  private materializePracticeAssessments(projectId: string, nodes: readonly RoadmapNode[], at: string): void {
    const assessments = this.store.listAssessments(projectId)
    for (const node of nodes) {
      if (node.gate !== 'acceptance') continue
      const rubric = acceptanceLines(node)
      if (rubric.length === 0) continue
      const liveAssessment = assessments.find(assessment =>
        assessment.type === 'practice' && assessment.scope.nodeId === node.id && assessment.supersededBy === undefined)
      const sameRubric = liveAssessment !== undefined
        && (liveAssessment.rubric ?? []).length === rubric.length
        && rubric.every((line, index) => liveAssessment.rubric?.[index]?.line === line.line && liveAssessment.rubric?.[index]?.ref === line.ref)
      if (sameRubric) continue
      const assessment: LibraryAssessment = {
        id: mintLibraryId('q'),
        type: 'practice',
        scope: { nodeId: node.id },
        rubric,
        createdAt: at,
      }
      this.store.writeAssessment(projectId, assessment)
      if (liveAssessment !== undefined) {
        this.store.writeAssessment(projectId, { ...liveAssessment, supersededBy: assessment.id })
      }
    }
  }

  /** Drop a textbook's draft without adopting it. */
  async discardDraft(request: { projectId: string; resourceId: string }): Promise<LibraryOutcome<{ resourceId: string }>> {
    this.assertAlive('discardDraft')
    const project = this.readProjectOrRefusal(request.projectId)
    if ('error' in project) return project
    return await this.mutate(project.value.id, () => {
      this.store.removeDraft(project.value.id, request.resourceId)
      return { ok: true as const, resourceId: request.resourceId }
    })
  }

  /**
   * Write (or rewrite) a station's 讲义 — the coach's distilled teaching,
   * persisted on the adopted path's node. Replanning keeps it when the
   * station's id survives; every write bumps `revisions`.
   */
  async putNotes(request: { projectId: string; resourceId?: string; nodeId: string; text: string }): Promise<LibraryOutcome<{ notes: LibraryNodeNotes }>> {
    this.assertAlive('putNotes')
    const project = this.readProjectOrRefusal(request.projectId)
    if ('error' in project) return project
    const text = request.text.trim()
    if (text === '') return refuse('invalid', 'notes need text — the distilled teaching for this station (markdown): the explanation, the points the learner got stuck on, the pitfalls')
    return await this.mutate(project.value.id, () => {
      const roadmap = this.store.readRoadmap(project.value.id, request.resourceId)
      const node = roadmap?.nodes.find(candidate => candidate.id === request.nodeId)
      if (roadmap === undefined || node === undefined) {
        return refuse('not-found', `no node ${JSON.stringify(request.nodeId)} on the adopted path — read the roadmap for its stations (notes ride the adopted path; the learner adopts a draft first)`)
      }
      const notes: LibraryNodeNotes = { text, updatedAt: new Date().toISOString(), revisions: (node.notes?.revisions ?? 0) + 1 }
      const next: LibraryRoadmap = { ...roadmap, nodes: roadmap.nodes.map(candidate => candidate.id === node.id ? { ...candidate, notes } : candidate) }
      this.store.writeRoadmap(project.value.id, next)
      this.event(project.value.id, 'node.noted', { id: node.id, title: node.title, ...(request.resourceId === undefined ? {} : { resourceId: request.resourceId }), count: notes.revisions })
      return { ok: true as const, notes }
    })
  }

  /** 「读完」: a current read node completes and unlocks what it gates. */
  async markNodeRead(request: { projectId: string; resourceId?: string; nodeId: string }): Promise<LibraryOutcome<{ roadmap: LibraryRoadmap; unlocked: string[] }>> {
    this.assertAlive('markNodeRead')
    const project = this.readProjectOrRefusal(request.projectId)
    if ('error' in project) return project
    return await this.mutate(project.value.id, () => {
      const roadmap = this.store.readRoadmap(project.value.id, request.resourceId)
      const node = roadmap?.nodes.find(candidate => candidate.id === request.nodeId)
      if (roadmap === undefined || node === undefined) return refuse('not-found', `no node ${JSON.stringify(request.nodeId)} on the adopted path`)
      if (node.gate !== 'read') return refuse('state-machine', `${node.title} is a ${node.gate} node — only a read node completes by 读完 (a quiz node by passing its quiz, an acceptance station by acceptance)`)
      if (node.state !== 'current') return refuse('state-machine', `${node.title} is ${node.state} — only a current node can be marked read`)
      const now = new Date().toISOString()
      const completed = roadmap.nodes.map(candidate => candidate.id === node.id ? { ...candidate, state: 'done' as const } : candidate)
      const { nodes, unlocked } = unlockReady(completed)
      const next: LibraryRoadmap = { ...roadmap, nodes }
      this.store.writeRoadmap(project.value.id, next)
      this.store.appendEvents(project.value.id, [
        { at: now, type: 'node.completed', id: node.id, title: node.title, ...(request.resourceId === undefined ? {} : { resourceId: request.resourceId }) },
        ...unlocked.map(nodeId => ({ at: now, type: 'node.unlocked' as const, id: nodeId, title: titleOf(nodes, nodeId), ...(request.resourceId === undefined ? {} : { resourceId: request.resourceId }) })),
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
    resourceId: string
    nodeId?: string
    label?: string
    attachment: LibraryAttachmentRef
    text: string
    marks: readonly LibraryMark[]
  }): Promise<LibraryOutcome<{ page: LibraryPage; cards: LibraryCardWriteResult; uncertain: string[] }>> {
    this.assertAlive('recordPage')
    const project = this.readProjectOrRefusal(request.projectId)
    if ('error' in project) return project
    const resource = this.store.readResource(project.value.id, request.resourceId)
    if (resource === undefined) return refuse('not-found', `no resource ${JSON.stringify(request.resourceId)} in this project — a page belongs to a resource`)
    if (!isThickResource(resource)) return refuse('invalid', `《${resource.title}》 is a thin link — only a thick resource (one with a contents) has pages to photograph`)
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
      const roadmap = this.store.readRoadmap(project.value.id, resource.id)
      if (roadmap !== undefined && !roadmap.nodes.some(node => node.id === nodeId)) {
        return refuse('not-found', `no node ${JSON.stringify(nodeId)} on this resource's path — omit nodeId or read the roadmap`)
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
      resourceId: resource.id,
    }))
    return await this.mutate(project.value.id, () => {
      const cards = this.applyCardInputs(project.value.id, inputs, resource.id, { mergeNear: kind === 'word' })
      const page: LibraryPage = {
        id: pageId,
        resourceId: resource.id,
        ...(nodeId === undefined ? {} : { nodeId }),
        ...(request.label === undefined || request.label.trim() === '' ? {} : { label: request.label.trim() }),
        attachment: { attachmentId: ref.attachmentId, mediaType: ref.mediaType, bytes: ref.bytes, width: ref.width, height: ref.height },
        text: request.text,
        marks,
        cardIds: [...cards.added, ...cards.merged].map(card => card.id),
        at: new Date().toISOString(),
      }
      this.store.appendPage(project.value.id, page)
      this.event(project.value.id, 'page.recorded', { id: page.id, title: page.label ?? resource.title, resourceId: resource.id, count: cards.added.length, count2: cards.merged.length })
      return { ok: true as const, page, cards, uncertain: marks.filter(mark => mark.uncertain === true).map(mark => mark.text) }
    })
  }

  /** One resource's pages, optionally one node's. */
  async listPages(request: { projectId: string; resourceId: string; nodeId?: string }): Promise<{ pages: LibraryPage[] }> {
    this.assertAlive('listPages')
    const pages = this.store.readPages(request.projectId, request.resourceId)
    return { pages: request.nodeId === undefined ? pages : pages.filter(page => page.nodeId === request.nodeId) }
  }

  /** Find one page anywhere in the project. */
  private findPage(projectId: string, pageId: string): LibraryPage | undefined {
    for (const resource of this.store.listResources(projectId)) {
      const page = this.store.readPages(projectId, resource.id).find(candidate => candidate.id === pageId)
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
    defaultResourceId: string | undefined,
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
      const resourceId = input.resourceId ?? defaultResourceId
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
          ...(resourceId === undefined ? {} : { resourceId }),
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
          ...(target.resourceId === undefined && resourceId !== undefined ? { resourceId } : {}),
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
        ...(resourceId === undefined ? {} : { resourceId }),
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
        ...(defaultResourceId === undefined ? {} : { resourceId: defaultResourceId }),
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
    resourceId?: string
    cards: readonly LibraryCardInput[]
  }): Promise<LibraryOutcome<LibraryCardWriteResult>> {
    this.assertAlive('writeCards')
    const project = this.readProjectOrRefusal(request.projectId)
    if ('error' in project) return project
    if (request.cards.length === 0) {
      return refuse('invalid', 'cards needs at least one card — each: { kind: word|concept, term, gloss, context?, source: { type: chat|photo|quiz|manual, note? }, weaken? }')
    }
    // Per-card problems are collected and reported at once: a batch with
    // three bad cards earns one refusal listing all three, not three
    // fail-fast round trips.
    const errors: string[] = []
    for (const [index, input] of request.cards.entries()) {
      if (input.kind !== 'word' && input.kind !== 'concept') errors.push(`cards[${index}].kind is word | concept`)
      if (input.term.trim() === '' || input.gloss.trim() === '') {
        errors.push(`cards[${index}] needs term and gloss — the gloss is the in-context meaning (a word) or a one-line explanation (a concept)`)
      }
      if (!['photo', 'chat', 'quiz', 'manual'].includes(input.source?.type)) {
        errors.push(`cards[${index}].source.type is chat | photo | quiz | manual — chat: the learner asked / got stuck in conversation`)
      }
    }
    const cards = this.store.readCards(project.value.id)
    for (const [index, input] of request.cards.entries()) {
      if (input.mergeInto !== undefined && !cards.some(card => card.id === input.mergeInto && live(card))) {
        errors.push(`cards[${index}].mergeInto names ${JSON.stringify(input.mergeInto)}, which is not a live card — use an id from the pending candidates`)
      }
    }
    if (errors.length === 1) return refuse('invalid', errors[0]!)
    if (errors.length > 1) {
      return refuse('invalid', `${errors.length} problems in cards — fix them all, then resend:\n${errors.map(error => `- ${error}`).join('\n')}`)
    }
    if (request.resourceId !== undefined && this.store.readResource(project.value.id, request.resourceId) === undefined) {
      return refuse('not-found', `no resource ${JSON.stringify(request.resourceId)} in this project — omit resource for a project-level card`)
    }
    return await this.mutate(project.value.id, () => {
      const { at: _at, ...result } = this.applyCardInputs(project.value.id, request.cards, request.resourceId)
      return { ok: true as const, ...result }
    })
  }

  /** Cards, filtered and sorted (the sidebar list, the coach's search). */
  async listCards(request: LibraryCardQuery): Promise<{ cards: LibraryCard[]; total: number }> {
    this.assertAlive('listCards')
    const now = new Date().toISOString()
    let cards = this.store.readCards(request.projectId).filter(live)
    if (request.includeMastered !== true) cards = cards.filter(card => card.status === 'active')
    if (request.resourceId !== undefined) cards = cards.filter(card => card.resourceId === request.resourceId)
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
    patch: { term?: string; gloss?: string; userGloss?: string; aliases?: readonly string[]; status?: LibraryCard['status']; resourceId?: string | null }
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
      const { resourceId: _old, ...rest } = card
      const next: LibraryCard = {
        ...(patch.resourceId === null ? rest : card),
        ...(patch.term === undefined ? {} : { term: patch.term.trim() }),
        ...(patch.gloss === undefined ? {} : { gloss: patch.gloss.trim() }),
        ...(patch.userGloss === undefined ? {} : { userGloss: patch.userGloss.trim() }),
        ...(patch.aliases === undefined ? {} : { aliases: patch.aliases.map(alias => alias.trim()).filter(alias => alias !== '') }),
        ...(patch.status === undefined ? {} : { status: patch.status }),
        ...(typeof patch.resourceId === 'string' ? { resourceId: patch.resourceId } : {}),
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

  /* ---------------------------------------------------------- assessments */

  /** A project's assessments, optionally one resource's / node's / one type's. */
  async listAssessments(request: { projectId: string; resourceId?: string; nodeId?: string; type?: 'quiz' | 'practice' }): Promise<{ assessments: LibraryAssessment[] }> {
    this.assertAlive('listAssessments')
    return {
      assessments: this.store.listAssessments(request.projectId).filter(assessment =>
        (request.resourceId === undefined || assessment.scope.resourceId === request.resourceId)
        && (request.nodeId === undefined || assessment.scope.nodeId === request.nodeId)
        && (request.type === undefined || assessment.type === request.type)),
    }
  }

  /** One assessment, whole. */
  async getAssessment(request: { projectId: string; assessmentId: string }): Promise<LibraryOutcome<{ assessment: LibraryAssessment }>> {
    this.assertAlive('getAssessment')
    const assessment = this.store.readAssessment(request.projectId, request.assessmentId)
    if (assessment === undefined) return refuse('not-found', `no assessment ${JSON.stringify(request.assessmentId)} — library_read · quiz without an id lists the project's`)
    return { ok: true, assessment }
  }

  /**
   * Store a quiz behind the two-axis checks. Target: a marked / asked / missed
   * question names the live cards it probes. Evidence: a photo quote names a
   * recorded page (a quote the page text lacks comes back as a warning); a web
   * quote carries its url; whether domain knowledge may back a CONTENT question
   * is judged on the gated node's covers (a material book, a thin link or a
   * bare url among them demands a verbatim quote) — a resource-scoped quiz
   * without a node keeps the resource-level rule, and a scopeless free quiz
   * allows knowledge. A node-scoped quiz supersedes the station's live one.
   */
  async putQuiz(request: {
    projectId: string
    quiz: {
      scope: { resourceId?: string; nodeId?: string }
      focus?: LibraryQuizFocus
      questions: readonly LibraryQuizQuestion[]
      /** Append knowledge points to the gated station (a genuine gap in the split) — ids must be new; an existing id is referenced, never re-added. */
      addPoints?: readonly LibraryPoint[]
    }
  }): Promise<LibraryOutcome<{ quiz: LibraryAssessment; warnings: string[] }>> {
    this.assertAlive('putQuiz')
    const project = this.readProjectOrRefusal(request.projectId)
    if ('error' in project) return project
    const scope = request.quiz.scope
    const resource = scope.resourceId === undefined ? undefined : this.store.readResource(project.value.id, scope.resourceId)
    if (scope.resourceId !== undefined && resource === undefined) {
      return refuse('not-found', `quiz scope names resource ${JSON.stringify(scope.resourceId)}, which project ${JSON.stringify(project.value.name)} does not hold — library_read · resources lists them`)
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
    let gatedRoadmap: LibraryRoadmap | undefined
    if (nodeId !== undefined) {
      // The node resolves on the scoped textbook's adopted path, or — a
      // scope-less station quiz — on whichever textbook's path holds it.
      const roadmaps = scope.resourceId !== undefined
        ? [this.store.readRoadmap(project.value.id, scope.resourceId)]
        : this.store.listResources(project.value.id).filter(isThickResource).map(candidate => this.store.readRoadmap(project.value.id, candidate.id))
      for (const roadmap of roadmaps) {
        const node = roadmap?.nodes.find(candidate => candidate.id === nodeId)
        if (node !== undefined) { gatedRoadmap = roadmap; gatedNode = node; break }
      }
      if (gatedNode === undefined || gatedRoadmap === undefined) return refuse('not-found', `quiz scope names node ${JSON.stringify(nodeId)}, which no adopted path holds — library_read · roadmap lists the nodes`)
      if (gatedNode.gate === 'read') return refuse('invalid', `${gatedNode.title} is a read node — it has no quiz gate; quiz a quiz-gated node, or leave scope.node off for a free practice quiz`)
      if (gatedNode.gate === 'acceptance') return refuse('invalid', `${gatedNode.title} is an acceptance station — it completes by acceptance (library_assess with node), not by a quiz; to gate it ON a quiz, compose the quiz without a node (resource-level or free), then reference it from the station's acceptance: { line: "…", ref: "<quiz id>" } — the line auto-passes when the quiz passes`)
      if (gatedNode.state === 'locked') lockedNote = `${gatedNode.title} is still locked — the learner can take this quiz, but passing it completes the node only once the nodes before it are done`
    }
    // Points: the gated station's split (drafted with the roadmap, reviewed at
    // adoption), plus any addPoints this quiz establishes. Every question names
    // the point it probes once the station has any; mastery aggregates by id.
    const pointAdds: LibraryPoint[] = []
    if (request.quiz.addPoints !== undefined && request.quiz.addPoints.length > 0) {
      if (gatedNode === undefined) return refuse('invalid', 'addPoints belongs to a station quiz (scope.node) — a resource-level or free quiz has no points to extend')
      const seen = new Set((gatedNode.points ?? []).map(point => point.id))
      for (const point of request.quiz.addPoints) {
        if (!isLibraryId(point.id)) return refuse('invalid', `point id ${JSON.stringify(point.id)} is not a safe slug (letters, digits, . _ -)`)
        if (typeof point.title !== 'string' || point.title.trim() === '') return refuse('invalid', `point ${point.id} needs a title — the point as the learner reads it (「极限的定义」)`)
        if (seen.has(point.id)) return refuse('invalid', `point ${point.id} already exists on ${gatedNode.title} — reference it (point: ${JSON.stringify(point.id)}), never re-add`)
        seen.add(point.id)
        pointAdds.push({ id: point.id, title: point.title.trim() })
      }
    }
    const knownPoints = [...(gatedNode?.points ?? []), ...pointAdds]
    const knownPointIds = new Set(knownPoints.map(point => point.id))
    const liveCards = new Set(this.store.readCards(project.value.id).filter(live).map(card => card.id))
    // Photo evidence names a page; the pool is the scoped resource's pages, the
    // gated node's covered resources' pages, or (a free quiz) the whole project's.
    const pageResourceIds = resource !== undefined
      ? [resource.id]
      : gatedNode !== undefined
        ? [...new Set(gatedNode.covers.flatMap(cover => coverKind(cover) === 'resource' ? [cover.ref] : []))]
        : this.store.listResources(project.value.id).map(candidate => candidate.id)
    const pages = new Map(pageResourceIds.flatMap(candidate => this.store.readPages(project.value.id, candidate).map(page => [page.id, page] as const)))
    const seenIds = new Set<string>()
    const warnings: string[] = lockedNote === undefined ? [] : [lockedNote]
    // Every question's problems are collected and reported at once: a quiz
    // with four bad questions earns ONE refusal listing all four, not four
    // fail-fast round trips (each retry resends the whole questions payload).
    const errors: string[] = []
    for (const [index, question] of request.quiz.questions.entries()) {
      const label = `questions[${index}]${question.id === '' ? '' : ` (${question.id})`}`
      if (question.id === '' || seenIds.has(question.id)) errors.push(`${label} needs a unique id — q1, q2, … is plenty`)
      seenIds.add(question.id)
      if (!['choice', 'fill', 'free'].includes(question.kind)) errors.push(`${label}.kind is choice | fill | free`)
      if (question.prompt.trim() === '' || question.answer.trim() === '') {
        errors.push(`${label} needs both a prompt and an answer — a question without its answer cannot be graded`)
      }
      if (question.kind === 'choice' && (question.options === undefined || question.options.length < 2)) {
        errors.push(`${label} is a choice question with fewer than two options`)
      } else if (question.kind === 'choice' && question.options !== undefined && choiceOptionIndex(question.options, question.answer) < 0) {
        errors.push(`${label}.answer matches no option — a choice question's answer IS one of its options, copied verbatim (or its letter); write the correct option first, then the distractors around it`)
      }
      const target = question.target
      const targetOk = target !== undefined && ['marked', 'asked', 'missed', 'topic'].includes(target.kind)
      if (!targetOk) {
        errors.push(`${label} needs target: { kind: marked|asked|missed|topic, cardIds? } — what the question aims at: the learner's marked cards, the points they asked about, the ones they missed before, or the chapter's topic`)
      } else {
        const focus = request.quiz.focus
        if (focus === 'mine' && target.kind === 'topic') {
          errors.push(`${label} tests the chapter's topic, but the learner asked for their OWN points only (focus: mine) — every question must target their cards (marked / asked / missed, with cardIds from library_read · cards). If this node has too few cards, write fewer questions and tell the learner; never pad with book content`)
        }
        if (focus === 'book' && target.kind !== 'topic') {
          errors.push(`${label} targets the learner's cards, but they asked for the book's content only (focus: book) — target: { kind: "topic" } for every question`)
        }
        if (target.kind !== 'topic') {
          if (target.cardIds === undefined || target.cardIds.length === 0) {
            errors.push(`${label} targets ${target.kind} cards but names none — target.cardIds lists the cards it probes (library_read · cards finds them)`)
          } else {
            const unknown = target.cardIds.filter(cardId => !liveCards.has(cardId))
            if (unknown.length > 0) errors.push(`${label} names cards that do not exist: ${unknown.join(', ')} — use ids from library_read · cards`)
          }
        }
      }
      if (question.point !== undefined) {
        if (gatedNode === undefined) errors.push(`${label} names point ${JSON.stringify(question.point)}, but points belong to a station quiz (scope.node) — a resource-level or free quiz carries none`)
        else if (!knownPointIds.has(question.point)) errors.push(`${label} probes point ${JSON.stringify(question.point)}, which ${gatedNode.title} does not hold — its points are: ${knownPoints.map(point => `${point.id} (${point.title})`).join(', ') || 'none yet'}; reuse one or add it via addPoints`)
      } else if (knownPoints.length > 0) {
        errors.push(`${label} names no point — this station's quizzes tag every question with the point it probes (point: one of ${[...knownPointIds].join(', ')})`)
      }
      const evidence = question.evidence
      if (evidence === undefined || !['photo', 'web', 'knowledge'].includes(evidence.kind)) {        errors.push(`${label} needs evidence: { kind: photo|web|knowledge, … } — what the answer rests on`)
      } else {
        if (evidence.kind === 'photo') {
          const page = evidence.pageId === undefined ? undefined : pages.get(evidence.pageId)
          if (page === undefined) {
            errors.push(`${label} rests on a photo but names no recorded page — evidence.pageId comes from library_read · pages`)
          } else {
            const quote = normalizeFragment(evidence.quote ?? '')
            if (quote.length < 4) errors.push(`${label} rests on a photo — quote the printed passage (evidence.quote) the answer comes from`)
            else if (!normalizeFragment(page.text).includes(quote)) warnings.push(`${label}: its quote is not verbatim in page ${page.label ?? page.id}'s text — stored; re-read the page and fix the quote`)
          }
        }
        if (evidence.kind === 'web') {
          if (evidence.url === undefined || !/^https?:\/\//.test(evidence.url)) errors.push(`${label} rests on the web — evidence.url is the page the quote is from`)
          else if (normalizeFragment(evidence.quote ?? '').length < 8) errors.push(`${label} rests on the web — quote the passage (a sentence or two) so the learner can check it`)
        }
        if (evidence.kind === 'knowledge' && targetOk && target.kind === 'topic') {
          // The gate sits on the node's covers now: a station drawing only on
          // knowledge books / plain teaching may be content-quizzed from memory;
          // a material book, a thin link or a bare url among the covers demands
          // a verbatim quote. No node in scope = the resource-level rule.
          if (gatedNode === undefined) {
            if (resource !== undefined && isThickResource(resource) && resource.meta?.bookKind === 'material') {
              errors.push(`${label} asks about 《${resource.title}》's content from memory — it is a material book (specific text you cannot recall reliably). Quote a photographed page (evidence.kind photo) or a web copy (web, with url), or drill the learner's cards instead`)
            }
          } else {
            const blocker = coversVerbatimBlocker(gatedNode.covers, candidate => this.store.readResource(project.value.id, candidate), gatedRoadmap?.primaryResourceId)
            if (blocker !== undefined) {
              errors.push(`${label} asks the station's content from memory, but ${blocker}. Quote a photographed page (evidence.kind photo) or the page on the web (web, with url), or drill the learner's cards instead`)
            }
          }
        }
      }
      // Math that never typesets: the fields smell like math (unicode symbols,
      // \commands, ^digits) but carry no $…$ at all — warn, never block.
      const text = [question.prompt, question.answer, ...(question.options ?? []), question.explanation ?? ''].join(' ')
      if (!text.includes('$') && /[√∫∑∏∂∞±]|\\[a-zA-Z]{2,}|\^\{|\w\^\d/.test(text)) {
        warnings.push(`${label} reads like math without any $…$ — the sidebar typesets LaTeX only inside $…$ / $$…$$, so this shows as raw text; rewrite the formula parts (e.g. $\\sqrt{x+1}$)`)
      }
    }
    if (errors.length === 1) return refuse('evidence-gate', errors[0]!)
    if (errors.length > 1) {
      return refuse('evidence-gate', `${errors.length} problems in questions — fix them all, then resend:\n${errors.map(error => `- ${error}`).join('\n')}`)
    }
    // A full chapter quiz touches every point; a retake legitimately does not — warn, never block.
    const probed = new Set(request.quiz.questions.map(question => question.point))
    const uncovered = knownPoints.filter(point => !probed.has(point.id))
    if (uncovered.length > 0) warnings.push(`never asks about ${uncovered.map(point => point.title).join(', ')} — fine for a retake; a full chapter quiz touches every point at least once`)
    if (nodeId === undefined) {
      warnings.push(resource === undefined
        ? 'stored as a free quiz (no station, no resource): the learner finds it on the project page (自由测验) and it gates nothing — name node (a quiz-gated station) to gate one'
        : `stored as a resource-level quiz of 《${resource.title}》 (no station): the learner finds it on the resource page (本书测验) — name node (a quiz-gated station) to gate one`)
    }
    return await this.mutate(project.value.id, () => {
      const now = new Date().toISOString()
      const quiz: LibraryAssessment = {
        id: mintLibraryId('q'),
        type: 'quiz',
        scope: { ...(resource === undefined ? {} : { resourceId: resource.id }), ...(nodeId === undefined ? {} : { nodeId }) },
        ...(request.quiz.focus === undefined ? {} : { focus: request.quiz.focus }),
        questions: request.quiz.questions,
        createdAt: now,
      }
      this.store.writeAssessment(project.value.id, quiz)
      // A node's new paper supersedes the station's live one (its sittings
      // stay attached to the old snapshot — history never orphans).
      if (gatedNode !== undefined) {
        for (const assessment of this.store.listAssessments(project.value.id)) {
          if (assessment.type === 'quiz' && assessment.scope.nodeId === gatedNode.id && assessment.supersededBy === undefined) {
            this.store.writeAssessment(project.value.id, { ...assessment, supersededBy: quiz.id })
          }
        }
      }
      // addPoints land on the adopted path's node (the draft is long gone).
      if (pointAdds.length > 0 && gatedNode !== undefined && gatedRoadmap !== undefined) {
        const nodes = gatedRoadmap.nodes.map(node => node.id === gatedNode.id ? { ...node, points: [...(node.points ?? []), ...pointAdds] } : node)
        this.store.writeRoadmap(project.value.id, { ...gatedRoadmap, nodes })
      }
      this.event(project.value.id, 'quiz.created', { at: quiz.createdAt, id: quiz.id, ...(resource === undefined ? {} : { resourceId: resource.id }), count: request.quiz.questions.length, ...(pointAdds.length === 0 ? {} : { count2: pointAdds.length }) })
      return { ok: true as const, quiz, warnings }
    })
  }

  /* ------------------------------------------------------------- attempts */

  /**
   * Grade a sitting — the only cascading write. Two shapes, exactly one key:
   * `assessmentId` (or the legacy alias `quizId`) judges a stored quiz;
   * `nodeId` accepts an ACCEPTANCE station — resolved to the node's current
   * practice assessment, each verdict's task naming one rubric line (its id
   * L1…, or the line verbatim).
   *
   * Void verdicts count for nothing. Every probed card moves: a pass climbs a
   * Leitner box and eases weakness by one; a fail resets to box 0 (due
   * tomorrow) and adds weakness. A failed line with no card gets one
   * (`missedCard`). The gated node's stats update (quiz nodes); at or above
   * the pass ratio it completes and unlocks its dependents.
   */
  async putAttempt(request: {
    projectId: string
    assessmentId?: string
    quizId?: string
    nodeId?: string
    /** The textbook whose path the acceptance station sits on (omitted: the textbook whose path holds the node). */
    resourceId?: string
    verdicts: readonly LibraryVerdict[]
  }): Promise<LibraryOutcome<LibraryAssessResult>> {
    this.assertAlive('putAttempt')
    const project = this.readProjectOrRefusal(request.projectId)
    if ('error' in project) return project
    const assessmentId = request.assessmentId ?? request.quizId
    const nodeId = request.nodeId
    if ((assessmentId === undefined) === (nodeId === undefined)) {
      return refuse('invalid', 'assess takes exactly one of quiz / node — quiz: a graded sitting on a stored quiz; node: acceptance of an acceptance station')
    }
    if (request.verdicts.length === 0) {
      return refuse('invalid', 'library_assess needs the verdicts — one per question: { task: <question id>, criterion, pass, ratio?, evidence, by, void?, missedCard? }')
    }
    if (assessmentId !== undefined) return await this.putQuizAttempt(project.value, assessmentId, request.verdicts)
    return await this.putPracticeAttempt(project.value, nodeId ?? '', request.resourceId, request.verdicts)
  }

  /** The quiz path of putAttempt: verdicts judged against a stored quiz's questions. */
  private async putQuizAttempt(project: LibraryProject, assessmentId: string, verdicts: readonly LibraryVerdict[]): Promise<LibraryOutcome<LibraryAssessResult>> {
    const assessment = this.store.readAssessment(project.id, assessmentId)
    if (assessment === undefined || assessment.type !== 'quiz' || assessment.questions === undefined) return refuse('not-found', `no quiz ${JSON.stringify(assessmentId)} — store the quiz first (library_quiz), then assess it`)
    const questionById = new Map(assessment.questions.map(question => [question.id, question]))
    for (const [index, verdict] of verdicts.entries()) {
      if (!questionById.has(verdict.task)) {
        return refuse('invalid', `verdicts[${index}] judges task ${JSON.stringify(verdict.task)}, which quiz ${assessment.id} does not ask — its questions are: ${assessment.questions.map(question => question.id).join(', ')}`)
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
      const attempt: LibraryAttempt = { id: mintLibraryId('a'), assessmentId: assessment.id, verdicts, ratio, at }
      this.store.appendAttempt(project.id, attempt)

      // Cards: every counted verdict moves the cards its question probed.
      const cards = this.store.readCards(project.id)
      const byId = new Map(cards.map(card => [card.id, card]))
      const order = cards.map(card => card.id)
      const touched = new Map<string, LibraryCardUpdate>()
      const resource = assessment.scope.resourceId === undefined ? undefined : this.store.readResource(project.id, assessment.scope.resourceId)
      for (const verdict of counted) {
        const question = questionById.get(verdict.task)!
        const credit = verdict.ratio ?? (verdict.pass ? 1 : 0)
        const passed = verdict.pass && credit >= 0.5
        const cardIds = [...(question.target.cardIds ?? [])]
        if (cardIds.length === 0 && !passed) {
          const created = this.missedCardFor(question, verdict, assessment, resource?.id, project.template, at)
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
            sources: passed ? card.sources : [...card.sources, { type: 'quiz', ref: assessment.id, note: verdict.criterion.slice(0, 120), weakened: true, at }],
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
      const roadmap = assessment.scope.nodeId === undefined ? undefined : this.findNodeRoadmap(project.id, assessment.scope.nodeId, assessment.scope.resourceId)
      const passRatio = roadmap?.passRatio ?? DEFAULT_PASS_RATIO
      const gated = assessment.scope.nodeId === undefined ? undefined : roadmap?.nodes.find(node => node.id === assessment.scope.nodeId)
      if (roadmap !== undefined && gated !== undefined && gated.gate === 'quiz') {
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
      const onResource = assessment.scope.resourceId === undefined ? {} : { resourceId: assessment.scope.resourceId }
      this.store.appendEvents(project.id, [
        { at, type: 'attempt.assessed', id: assessment.id, ...onResource, ratio },
        ...(created.length === 0 ? [] : [{
          at,
          type: 'cards.recorded' as const,
          source: 'quiz' as const,
          title: created.map(update => update.term).join('、').slice(0, 300),
          ids: created.map(update => update.id),
          ...onResource,
          count: created.length,
        }]),
        ...(completed === undefined ? [] : [{ at, type: 'node.completed' as const, id: completed, title: titleOf(roadmap?.nodes ?? [], completed), ...onResource, ratio }]),
        ...unlocked.map(nodeId => ({ at, type: 'node.unlocked' as const, id: nodeId, title: titleOf(roadmap?.nodes ?? [], nodeId), ...onResource })),
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
   * The practice path of putAttempt: acceptance of a hands-on station, judged
   * against the node's current practice assessment (materialized at adoption).
   * No probed cards — a failed acceptance line with a `missedCard` leaves (or
   * re-weakens) a card; at the pass ratio the station completes.
   */
  private async putPracticeAttempt(project: LibraryProject, nodeId: string, resourceId: string | undefined, verdicts: readonly LibraryVerdict[]): Promise<LibraryOutcome<LibraryAssessResult>> {
    const roadmap = this.findNodeRoadmap(project.id, nodeId, resourceId)
    const node = roadmap?.nodes.find(candidate => candidate.id === nodeId)
    if (roadmap === undefined || node === undefined) {
      return refuse('not-found', `no station ${JSON.stringify(nodeId)} on the adopted path — library_read · roadmap lists the nodes`)
    }
    if (node.gate !== 'acceptance') {
      return refuse('state-machine', `${node.title} is a ${node.gate} node — a quiz node completes by passing its quiz (assess with quiz), a read node by 读完; only an acceptance station takes acceptance verdicts`)
    }
    const assessment = this.store.listAssessments(project.id)
      .find(candidate => candidate.type === 'practice' && candidate.scope.nodeId === node.id && candidate.supersededBy === undefined)
    // The rubric the verdicts judge: the materialized assessment's snapshot,
    // else (an adopted-before-v5 path that never materialized) the node's own
    // acceptance lines.
    const rubric: readonly LibraryAcceptanceLine[] = assessment?.rubric ?? acceptanceLines(node)
    if (rubric.length === 0) return refuse('invalid', `${node.title} carries no acceptance lines — the coach drafts them into the roadmap (library_roadmap)`)
    const passRatio = roadmap.passRatio ?? DEFAULT_PASS_RATIO
    // Machine-checked lines: the referenced assessment's latest sitting does the judging.
    const attempts = this.store.readAttempts(project.id)
    const auto: LibraryVerdict[] = []
    const autoTasks = new Set<string>()
    for (const line of rubric) {
      if (line.ref === undefined) continue
      const referenced = this.store.readAssessment(project.id, line.ref)
      const latest = referenced === undefined ? undefined : attempts.filter(attempt => attempt.assessmentId === referenced.id).at(-1)
      const quizRatio = latest?.ratio ?? 0
      auto.push({
        task: line.id,
        criterion: line.line,
        pass: latest !== undefined && quizRatio >= passRatio,
        ratio: quizRatio,
        evidence: latest === undefined ? `机检：${line.ref} 还没有判分记录` : `机检：${line.ref} 最新一场 ${Math.round(quizRatio * 100)}%（过线 ${Math.round(passRatio * 100)}%）`,
        by: 'auto',
      })
      autoTasks.add(line.id)
    }
    // A coach verdict resolves its line by id (L1, L2, …) or by the line's
    // verbatim text (the legacy form); a ref line is the machine's, never the
    // coach's. Judged verdicts are ledgered with the canonical id + text.
    const judged: LibraryVerdict[] = []
    for (const [index, verdict] of verdicts.entries()) {
      const line = rubric.find(candidate => candidate.id === verdict.task) ?? rubric.find(candidate => candidate.line === verdict.criterion)
      if (line === undefined) {
        return refuse('invalid', `verdicts[${index}] names no rubric line — task is the line id, criterion the line verbatim; the rubric is: ${rubric.map(candidate => `${candidate.id} ${JSON.stringify(candidate.line)}`).join(', ')}`)
      }
      if (autoTasks.has(line.id)) {
        return refuse('invalid', `verdicts[${index}] judges ${line.id}, which assessment ${line.ref} machine-checks — a ref line takes no verdict`)
      }
      if (verdict.evidence.trim() === '') {
        return refuse('invalid', `verdicts[${index}] needs evidence — what the learner showed (terminal output, a screenshot, a repo link)`)
      }
      if (verdict.by !== 'llm' && verdict.by !== 'self' && verdict.by !== 'user') return refuse('invalid', `verdicts[${index}].by must be llm | self | user`)
      if (verdict.ratio !== undefined && !(verdict.ratio >= 0 && verdict.ratio <= 1)) return refuse('invalid', `verdicts[${index}].ratio is partial credit in [0, 1]`)
      judged.push({ ...verdict, task: line.id, criterion: line.line })
    }
    const all = [...judged, ...auto]
    const counted = all.filter(verdict => verdict.void !== true)
    const ratio = counted.length === 0 ? 0 : counted.reduce((sum, verdict) => sum + (verdict.ratio ?? (verdict.pass ? 1 : 0)), 0) / counted.length
    return await this.mutate(project.id, () => {
      const now = new Date()
      const at = now.toISOString()
      // No materialized assessment yet (a pre-v5 adopted path): mint it now,
      // so the attempt keys an assessment like every other sitting.
      let key = assessment
      if (key === undefined) {
        key = { id: mintLibraryId('q'), type: 'practice', scope: { nodeId: node.id }, rubric, createdAt: at }
        this.store.writeAssessment(project.id, key)
      }
      const attempt: LibraryAttempt = { id: mintLibraryId('a'), assessmentId: key.id, verdicts: all, ratio, at }
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

      // The station's completion and what it unlocks (acceptance carries no quizStats).
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
      const onResource = resourceId === undefined ? {} : { resourceId }
      this.store.appendEvents(project.id, [
        { at, type: 'attempt.assessed', id: node.id, ...onResource, ratio },
        ...(created.length === 0 ? [] : [{
          at,
          type: 'cards.recorded' as const,
          source: 'quiz' as const,
          title: created.map(update => update.term).join('、').slice(0, 300),
          ids: created.map(update => update.id),
          ...onResource,
          count: created.length,
        }]),
        ...(completed === undefined ? [] : [{ at, type: 'node.completed' as const, id: completed, title: titleOf(roadmap.nodes, completed), ...onResource, ratio }]),
        ...unlocked.map(unlockedId => ({ at, type: 'node.unlocked' as const, id: unlockedId, title: titleOf(roadmap.nodes, unlockedId), ...onResource })),
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

  /** The roadmap holding one node: the hinted textbook's first, then every adopted path of the project. */
  private findNodeRoadmap(projectId: string, nodeId: string, resourceId?: string): LibraryRoadmap | undefined {
    const hinted = this.store.readRoadmap(projectId, resourceId)
    if (hinted?.nodes.some(node => node.id === nodeId)) return hinted
    for (const resource of this.store.listResources(projectId)) {
      const roadmap = this.store.readRoadmap(projectId, resource.id)
      if (roadmap?.nodes.some(node => node.id === nodeId)) return roadmap
    }
    return undefined
  }

  /** The card a missed, card-less question leaves behind. */
  private missedCardFor(
    question: LibraryQuizQuestion,
    verdict: LibraryVerdict,
    quiz: LibraryAssessment,
    resourceId: string | undefined,
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
      contexts: question.evidence.quote === undefined ? [] : [{ sentence: question.evidence.quote, ...(resourceId === undefined ? {} : { resourceId }), ...(question.evidence.pageId === undefined ? {} : { pageId: question.evidence.pageId }) }],
      ...(resourceId === undefined ? {} : { resourceId }),
      sources: [{ type: 'quiz', ref: quiz.id, note: verdict.criterion.slice(0, 120), weakened: true, at }],
      weakness: 1,
      mastery: { box: 0, dueAt: leitnerDueAt(0, new Date(at)), streak: 0 },
      status: 'active',
      createdAt: at,
      updatedAt: at,
    }
  }

  /**
   * A project's graded sittings, newest first. `nodeId` narrows to one node's
   * history: sittings keyed to an assessment scoped on it, plus legacy v4
   * acceptance sittings that named the node directly. `assessmentId` narrows
   * to one assessment's sittings.
   */
  async listAttempts(request: { projectId: string; nodeId?: string; assessmentId?: string }): Promise<{ attempts: LibraryAttempt[] }> {
    this.assertAlive('listAttempts')
    let attempts = this.store.readAttempts(request.projectId)
    if (request.assessmentId !== undefined) attempts = attempts.filter(attempt => attempt.assessmentId === request.assessmentId)
    if (request.nodeId !== undefined) {
      const nodeAssessmentIds = new Set(
        this.store.listAssessments(request.projectId)
          .filter(assessment => assessment.scope.nodeId === request.nodeId)
          .map(assessment => assessment.id),
      )
      attempts = attempts.filter(attempt =>
        attempt.nodeId === request.nodeId
        || (attempt.assessmentId !== undefined && nodeAssessmentIds.has(attempt.assessmentId)))
    }
    return { attempts: attempts.reverse() }
  }

  /* ------------------------------------------------------------- bindings */

  /** The project / resource a session works on, when it is bound. */
  getBinding(sessionId: string): LibraryBinding | undefined {
    this.assertAlive('getBinding')
    return this.store.readBindings().get(sessionId)
  }

  /** Bind a session (null unbinds). The project and resource must exist. */
  async setBinding(sessionId: string, binding: LibraryBinding | null): Promise<LibraryOutcome<{ binding: LibraryBinding | null }>> {
    this.assertAlive('setBinding')
    if (sessionId === '') return refuse('invalid', 'no session to bind')
    if (binding !== null) {
      const project = this.readProjectOrRefusal(binding.projectId)
      if ('error' in project) return project
      if (binding.resourceId !== undefined && this.store.readResource(binding.projectId, binding.resourceId) === undefined) {
        return refuse('not-found', `no resource ${JSON.stringify(binding.resourceId)} in project ${JSON.stringify(project.value.name)} — resource ids are minted (r_…), never chosen by the caller; library_read · resources lists them. Registering the resource (library_resource) binds this session itself — no separate library_binding call needed`)
      }
    }
    try {
      await this.store.withBindingsLock(() => {
        const bindings = new Map(this.store.readBindings())
        if (binding === null) bindings.delete(sessionId)
        else bindings.set(sessionId, { projectId: binding.projectId, ...(binding.resourceId === undefined ? {} : { resourceId: binding.resourceId }) })
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
   * context renders inside a synchronous callback): the project, the bound
   * resource, every textbook's path state in study order (so the coach reads
   * what the learner adopted, discarded or reordered in the sidebar, every
   * turn), and the weakest live cards.
   */
  bindingSummary(sessionId: string, cardLimit: number = 12): {
    binding?: LibraryBinding
    project?: LibraryProject
    resource?: LibraryResource
    textbooks: LibraryResourceProgress[]
    weakCards: LibraryCard[]
  } {
    this.assertAlive('bindingSummary')
    const binding = this.getBinding(sessionId)
    if (binding === undefined) return { textbooks: [], weakCards: [] }
    let project: LibraryProject | undefined
    try {
      project = this.store.readProject(binding.projectId)
    } catch {
      project = undefined
    }
    if (project === undefined) return { binding, textbooks: [], weakCards: [] }
    const resource = binding.resourceId === undefined ? undefined : this.store.readResource(project.id, binding.resourceId)
    const textbooks = this.store.listResources(project.id).filter(isThickResource).map(textbook => this.resourceProgress(project.id, textbook))
    const weakCards = this.store.readCards(project.id)
      .filter(card => card.status === 'active' && card.weakness > 0 && (resource === undefined || card.resourceId === resource.id))
      .sort((a, b) => b.weakness - a.weakness || b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, cardLimit)
    return {
      binding,
      project,
      ...(resource === undefined ? {} : { resource }),
      textbooks,
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
      books += this.store.listResources(project.id).filter(isThickResource).length
      quizzes += this.store.listAssessments(project.id).filter(assessment => assessment.type === 'quiz').length
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
      return refuse('not-found', `no project ${JSON.stringify(projectId)} — library_read · projects lists every project; create one with library_project`)
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
 * undefined. `scope.resourceId` marks a resource-level draft: the special case
 * whose every node covers that one resource only. Every per-node problem is
 * collected and reported at once — a draft with five mistakes earns ONE
 * refusal listing all five, not five fail-fast round trips (each retry
 * resends the whole nodes payload).
 */
export function validateRoadmapShape(
  nodes: readonly RoadmapNode[],
  scope: {
    /** The textbook whose path this is (a cover of it is the station's main source; others ride along). */
    resourceId: string
    /** Resolve a resource cover (existence + contents length). */
    resource: (resourceId: string) => LibraryResource | undefined
    /** Whether an assessment exists (an acceptance line's ref). */
    hasAssessment: (assessmentId: string) => boolean
  },
): string | undefined {
  const errors: string[] = []
  const seen = new Set<string>()
  for (const [index, node] of nodes.entries()) {
    if (typeof node.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(node.id) || seen.has(node.id)) {
      errors.push(`nodes[${index}] needs a unique id made of letters, digits, '.', '_', '-' (n1, n2, … is plenty)`)
    } else {
      seen.add(node.id)
    }
    if (typeof node.title !== 'string' || node.title.trim() === '') errors.push(`nodes[${index}] (${node.id}) needs a title — what the learner masters here`)
    const gateKnown = node.gate === 'quiz' || node.gate === 'read' || node.gate === 'acceptance'
    if (!gateKnown) {
      errors.push(`nodes[${index}] (${node.id}) needs gate: "quiz" | "acceptance" | "read" — quiz nodes gate on a quiz; acceptance nodes gate on acceptance (a hands-on deliverable); read nodes are optional side stops (读完 completes them, they never gate)`)
    } else {
      if (node.gate === 'acceptance' && (node.acceptance === undefined || node.acceptance.length === 0)) {
        errors.push(`nodes[${index}] (${node.id}) is an acceptance station — it needs acceptance: ["...", ...], the lines the coach judges one verdict each at assess time`)
      }
      if (node.gate !== 'acceptance' && node.acceptance !== undefined && node.acceptance.length > 0) {
        errors.push(`nodes[${index}] (${node.id}) carries acceptance but its gate is "${node.gate}" — if these lines are judged one verdict each at completion, set gate: "acceptance"; if they are descriptive expectations while a quiz gates the station, move them into goals: [...]`)
      }
    }
    for (const [lineIndex, entry] of (Array.isArray(node.acceptance) ? (node.acceptance as readonly (LibraryAcceptanceInput | null)[]) : []).entries()) {
      if (typeof entry === 'string') continue
      if (entry === null || typeof entry !== 'object' || typeof entry.line !== 'string' || entry.line.trim() === '') {
        errors.push(`nodes[${index}] (${node.id}) acceptance line ${lineIndex + 1} needs its line text`)
        continue
      }
      if (entry.ref !== undefined && !scope.hasAssessment(entry.ref)) {
        errors.push(`nodes[${index}] (${node.id}) acceptance line ${lineIndex + 1} refs assessment ${JSON.stringify(entry.ref)}, which does not exist — compose it first (library_quiz), then draft`)
      }
    }
    if (!Array.isArray(node.covers) || node.covers.length === 0) {
      errors.push(`nodes[${index}] (${node.id}) needs at least one cover — what the station draws on: "r_…#1-5" (a shelf resource + contents rows) | "https://…" (a web text) | "topic: …" (plain coached teaching)`)
    } else {
      for (const cover of node.covers as readonly (LibraryNodeCover | null)[]) {
        if (cover === null || typeof cover !== 'object' || typeof cover.ref !== 'string' || cover.ref.trim() === '') {
          errors.push(`nodes[${index}] (${node.id}) has a cover with no ref — "r_…#1-5" | "https://…" | "topic: …"`)
          continue
        }
        const kind = coverKind(cover)
        if (kind === 'resource') {
          // A ref that is no id at all (a scheme-less url, say) must not reach
          // the store's path-segment assert — teach the shape instead.
          if (!isLibraryId(cover.ref)) {
            errors.push(`nodes[${index}] (${node.id}) covers ${JSON.stringify(cover.ref)}, which is neither a shelf resource id (r_…) nor a usable ref — "r_…#1-5" | "https://…" | "topic: …"`)
            continue
          }
          const covered = scope.resource(cover.ref)
          if (covered === undefined) {
            errors.push(`nodes[${index}] (${node.id}) covers resource ${JSON.stringify(cover.ref)}, which is not on the project's shelf — library_read · resources lists them; register it first (library_resource)`)
            continue
          }
          if (cover.locator !== undefined) {
            if (!isThickResource(covered)) {
              errors.push(`nodes[${index}] (${node.id}) puts a locator on 《${covered.title}》, which is a thin link (no contents) — a thin link is covered whole: drop the locator`)
              continue
            }
            const ranges = parseLocator(cover.locator)
            if (ranges.length === 0) {
              errors.push(`nodes[${index}] (${node.id}) has an unreadable locator ${JSON.stringify(cover.locator)} — locators count contents rows, 1-based and inclusive: "1-5,7"`)
              continue
            }
            for (const range of ranges) {
              if (range.to > (covered.toc?.length ?? 0)) {
                errors.push(`nodes[${index}] (${node.id}) covers up to row ${range.to}, but 《${covered.title}》's contents has ${covered.toc?.length ?? 0} rows — library_read · toc lists them`)
              }
            }
          }
        } else if (kind === 'topic') {
          if ((coverTopic(cover) ?? '').trim() === '') errors.push(`nodes[${index}] (${node.id}) covers a topic with no text — what the coach teaches here`)
        }
        // url covers: the ref IS the url; its http(s) form is what coverKind read.
      }
    }
    for (const dep of Array.isArray(node.dependsOn) ? node.dependsOn : []) {
      const depIndex = nodes.findIndex(candidate => candidate.id === dep)
      if (depIndex === -1) {
        errors.push(`nodes[${index}] (${node.id}) depends on ${JSON.stringify(dep)}, which the roadmap does not declare`)
        continue
      }
      if (gateKnown && node.gate !== 'read' && nodes[depIndex]?.gate === 'read') {
        errors.push(`nodes[${index}] (${node.id}) depends on read node ${JSON.stringify(dep)} — a read node is a side stop and never gates a level; depend on the previous quiz or acceptance node instead. How-to-use pages, answer keys, transcripts and appendices are not nodes at all: put them in the resource's extras`)
        continue
      }
      if (depIndex >= index) errors.push(`nodes[${index}] (${node.id}) depends on ${JSON.stringify(dep)}, which comes AFTER it — list a node after everything it depends on`)
    }
  }
  if (errors.length === 0) return undefined
  if (errors.length === 1) return errors[0]
  return `${errors.length} shape errors — fix them all, then resend:\n${errors.map(error => `- ${error}`).join('\n')}`
}

/**
 * Why a node's covers forbid a memory-backed content question, or undefined
 * when they allow one: only knowledge books and plain coached teaching (topic)
 * may be quizzed from domain knowledge; a material book, a thin link or a
 * bare url demands a verbatim quote. When the station covers its own
 * textbook (`primaryId`), that cover alone decides — a side reference (a
 * video, an article) never turns a knowledge chapter into a quote-only one.
 * The evidence-gate's node-level half (a resource-scoped quiz without a node
 * keeps the resource rule).
 */
export function coversVerbatimBlocker(covers: readonly LibraryNodeCover[], resource: (resourceId: string) => LibraryResource | undefined, primaryId?: string): string | undefined {
  const main = primaryId === undefined ? [] : covers.filter(cover => coverKind(cover) === 'resource' && cover.ref === primaryId)
  for (const cover of main.length > 0 ? main : covers) {
    const kind = coverKind(cover)
    if (kind === 'resource') {
      const covered = resource(cover.ref)
      if (covered === undefined) continue
      if (isThickResource(covered)) {
        if (covered.meta?.bookKind === 'material') return `《${covered.title}》 is a material book (specific text you cannot recall reliably)`
      } else {
        return `the station draws on 《${covered.title}》, a thin link (a linked text you cannot recall reliably)`
      }
    } else if (kind === 'url') {
      return `the station covers ${cover.ref} (a web text you cannot recall reliably)`
    }
  }
  return undefined
}
