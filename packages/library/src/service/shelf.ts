/**
 * Projects and the shelf: create / edit / delete projects, register, place (seq), move and remove resources.
 *
 * One layer of the library service (see `service/core.ts` for the layering):
 * the methods are the service's own, moved here verbatim by domain.
 *
 * @module @khorsheed/dsh-library/service/shelf
 */
import {
  LIBRARY_COLORS,
  LIBRARY_ICONS,
  LIBRARY_RESOURCE_KINDS,
  LIBRARY_RESOURCE_ORIGINS,
  TEMPLATE_LOOK,
  isThickResource,
  type LibraryBookKind,
  type LibraryColor,
  type LibraryProjectPatch,
  type LibraryIcon,
  type LibraryOutcome,
  type LibraryProject,
  type LibraryProjectSummary,
  type LibraryResource,
  type LibraryResourceKind,
  type LibraryResourceOrigin,
  type LibraryResourceProgress,
  type LibraryTemplate,
  type LibraryTocSource,
} from '../types.ts'
import { mintLibraryId } from '../store.ts'
import { refuse, storeRefusal, live } from './core.ts'
import { stationMastery } from '../mastery.ts'
import { LibraryServiceCore } from './core.ts'

export class LibraryServiceShelf extends LibraryServiceCore {
  /* ------------------------------------------------------------ projects */

  /** One resource's progress row (a thick resource's roadmap; a thin link's bare row). */
  protected resourceProgress(projectId: string, resource: LibraryResource): LibraryResourceProgress {
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

  protected summarize(project: LibraryProject): LibraryProjectSummary {
    const now = new Date().toISOString()
    const cards = this.store.readCards(project.id).filter(live)
    return {
      ...project,
      resources: this.store.listResources(project.id).map(resource => this.resourceProgress(project.id, resource)),
      cardCount: cards.length,
      dueCount: cards.filter(card => card.status === 'active' && card.mastery.dueAt <= now).length,
      lastActiveAt: this.store.readEvents(project.id).at(-1)?.at ?? project.createdAt,
      openMisses: (() => {
        const assessments = this.store.listAssessments(project.id)
        const attempts = this.store.readAttempts(project.id)
        let count = 0
        for (const resource of this.store.listResources(project.id)) {
          for (const node of this.store.readRoadmap(project.id, resource.id)?.nodes ?? []) {
            if (node.gate === 'quiz') count += stationMastery(node, assessments, attempts).open.length
          }
        }
        return count
      })(),
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
          // A textbook is knowledge unless said otherwise — material is the rare case whose exact text is tested.
          ...(() => {
            const bookKind = request.bookKind ?? existing?.meta?.bookKind ?? (toc.length > 0 ? 'knowledge' as const : undefined)
            return bookKind === undefined ? {} : { bookKind }
          })(),
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
  protected placeTextbook(projectId: string, resourceId: string, seq: number | undefined): LibraryResource {
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

  /** Switch a textbook between 知识型 (knowledge) and 材料型 (material) — the learner's call on the textbook page. */
  async setBookKind(request: { projectId: string; resourceId: string; bookKind: LibraryBookKind }): Promise<LibraryOutcome<{ resource: LibraryResource }>> {
    this.assertAlive('setBookKind')
    const project = this.readProjectOrRefusal(request.projectId)
    if ('error' in project) return project
    if (request.bookKind !== 'knowledge' && request.bookKind !== 'material') return refuse('invalid', 'bookKind is knowledge | material')
    return await this.mutate(project.value.id, () => {
      const resource = this.store.readResource(project.value.id, request.resourceId)
      if (resource === undefined || !isThickResource(resource)) return refuse('not-found', `no textbook ${JSON.stringify(request.resourceId)} in this project`)
      const next: LibraryResource = { ...resource, meta: { ...resource.meta, bookKind: request.bookKind } }
      this.store.writeResource(project.value.id, next)
      return { ok: true as const, resource: next }
    })
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

}
