/**
 * Session bindings, the per-turn binding summary, events, activity and stats — the top layer, exported as LibraryService.
 *
 * One layer of the library service (see `service/core.ts` for the layering):
 * the methods are the service's own, moved here verbatim by domain.
 *
 * @module @khorsheed/dsh-library/service/bindings
 */
import {
  isThickResource,
  type LibraryBinding,
  type LibraryCard,
  type LibraryEvent,
  type LibraryEventType,
  type LibraryOutcome,
  type LibraryProject,
  type LibraryResource,
  type LibraryResourceProgress,
} from '../types.ts'
import { refuse, storeRefusal } from './core.ts'
import type { LibraryStationMastery } from '../mastery.ts'
import { LibraryServiceAssess } from './assess.ts'

export class LibraryService extends LibraryServiceAssess {
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
    /** The bound textbook's current station and its points' mastery (where the coach is teaching now). */
    station?: { id: string; title: string; mastery: LibraryStationMastery }
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
    const current = resource === undefined ? undefined : this.store.readRoadmap(project.id, resource.id)?.nodes.find(node => node.state === 'current' && node.gate === 'quiz')
    const mastery = current === undefined ? undefined : this.stationMasteryOf(project.id, current.id, resource?.id)
    return {
      binding,
      project,
      ...(resource === undefined ? {} : { resource }),
      textbooks,
      ...(current === undefined || mastery === undefined ? {} : { station: { id: current.id, title: current.title, mastery } }),
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
  /** The newest knowledge-point state changes across projects (今日 「最近的变化」). */
  async recentChanges(request: { limit?: number }): Promise<{ changes: (LibraryEvent & { projectId: string; projectName: string })[] }> {
    this.assertAlive('recentChanges')
    const changes: (LibraryEvent & { projectId: string; projectName: string })[] = []
    for (const project of this.store.readIndex().projects) {
      for (const event of this.store.readEvents(project.id)) {
        if (event.type !== 'point.changed' || event.nodeId === undefined || event.resourceId === undefined || event.id === undefined) continue
        // A change about a textbook, station or point that is gone (removed, re-planned away) is not shown.
        const node = this.store.readRoadmap(project.id, event.resourceId)?.nodes.find(candidate => candidate.id === event.nodeId)
        if (node?.points?.some(point => point.id === event.id) !== true) continue
        changes.push({ ...event, projectId: project.id, projectName: project.name })
      }
    }
    changes.sort((a, b) => b.at.localeCompare(a.at))
    return { changes: changes.slice(0, request.limit ?? 10) }
  }

  async recentRecords(request: { limit?: number }): Promise<{ records: (LibraryEvent & { projectId: string; projectName: string })[] }> {
    this.assertAlive('recentRecords')
    const records: (LibraryEvent & { projectId: string; projectName: string })[] = []
    for (const project of this.store.readIndex().projects) {
      // A recording whose cards were all deleted since is not shown; one with
      // some left names only the live ones.
      const liveTerms = new Map(this.store.readCards(project.id).filter(card => card.status !== 'deleted').map(card => [card.id, card.term]))
      for (const event of this.store.readEvents(project.id)) {
        if (event.type !== 'cards.recorded' || (event.source !== 'chat' && event.source !== 'quiz')) continue
        const ids = (event.ids ?? []).filter(cardId => liveTerms.has(cardId))
        if (event.ids !== undefined && ids.length === 0) continue
        records.push({
          ...event,
          ...(event.ids === undefined ? {} : { ids, title: ids.map(cardId => liveTerms.get(cardId)!).join('、').slice(0, 300) }),
          projectId: project.id,
          projectName: project.name,
        })
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

}
