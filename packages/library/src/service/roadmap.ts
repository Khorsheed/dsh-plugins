/**
 * Paths: drafts, adoption (with practice rubrics materialized), discard, station notes, 读完.
 *
 * One layer of the library service (see `service/core.ts` for the layering):
 * the methods are the service's own, moved here verbatim by domain.
 *
 * @module @khorsheed/dsh-library/service/roadmap
 */
import {
  isLibraryId,
  acceptanceLines,
  isThickResource,
  type LibraryAcceptanceInput,
  type LibraryAssessment,
  type LibraryOutcome,
  type LibraryNodeCover,
  type LibraryNodeNotes,
  type LibraryPoint,
  type LibraryRoadmap,
  type RoadmapNode,
} from '../types.ts'
import { mintLibraryId } from '../store.ts'
import { refuse } from './core.ts'
import { lessonProblems, titleOf, unlockReady, validateRoadmapShape } from './rules.ts'
import { LibraryServiceCards } from './cards.ts'

export class LibraryServiceRoadmap extends LibraryServiceCards {
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
      ? 'this project has no textbook yet — register one first (library_textbook with a contents: the learner\'s book, one you pick, or one you author)'
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
        // No station is locked (user decision 10-26, D6): the path is a recommended
        // order; any station can be studied and quizzed, and passing records it.
        const state: RoadmapNode['state'] = kept?.state === 'done' ? 'done' : 'current'
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
  protected materializePracticeAssessments(projectId: string, nodes: readonly RoadmapNode[], at: string): void {
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
  /** Why a 讲义 has nowhere to land, naming the fix: the path is only a draft, the station sits on another textbook, or here are this path's stations. */
  private notesMiss(projectId: string, resourceId: string | undefined, nodeId: string): LibraryOutcome<never> {
    const book = resourceId === undefined ? undefined : this.store.readResource(projectId, resourceId)
    const named = book === undefined ? 'this textbook' : `《${book.title}》 (${book.id})`
    const roadmap = this.store.readRoadmap(projectId, resourceId)
    if (roadmap === undefined) {
      const draft = this.store.readRoadmap(projectId, resourceId, 'draft')
      return refuse('not-found', draft === undefined
        ? `${named} has no path yet — draft one (library_roadmap); 讲义 land on an adopted path's stations`
        : `${named}'s path is still a draft — the learner adopts it in the sidebar (路线 → 采用) before 讲义 can land; teach in the conversation meanwhile, then write the 讲义`)
    }
    const elsewhere = this.store.listResources(projectId)
      .filter(resource => resource.id !== roadmap.primaryResourceId)
      .find(resource => this.store.readRoadmap(projectId, resource.id)?.nodes.some(candidate => candidate.id === nodeId) === true)
    if (elsewhere !== undefined) return refuse('not-found', `station ${JSON.stringify(nodeId)} is on 《${elsewhere.title}》's path — pass resource ${elsewhere.id}`)
    return refuse('not-found', `no station ${JSON.stringify(nodeId)} on ${named}'s path — its stations: ${roadmap.nodes.map(candidate => candidate.id).join(', ')}`)
  }

  async putNotes(request: { projectId: string; resourceId?: string; nodeId: string; text: string }): Promise<LibraryOutcome<{ notes: LibraryNodeNotes }>> {
    this.assertAlive('putNotes')
    const project = this.readProjectOrRefusal(request.projectId)
    if ('error' in project) return project
    const text = request.text.trim()
    if (text === '') return refuse('invalid', 'notes need text — the distilled teaching for this station (markdown): the explanation, the points the learner got stuck on, the pitfalls')
    return await this.mutate(project.value.id, () => {
      const roadmap = this.store.readRoadmap(project.value.id, request.resourceId)
      const node = roadmap?.nodes.find(candidate => candidate.id === request.nodeId)
      if (roadmap === undefined || node === undefined) return this.notesMiss(project.value.id, request.resourceId, request.nodeId)
      const book = roadmap.primaryResourceId === undefined ? undefined : this.store.readResource(project.value.id, roadmap.primaryResourceId)
      // Every textbook's 讲义 are the lesson itself (10-26): the per-point check applies to all.
      const lesson = lessonProblems(text, node, book !== undefined)
      if (lesson !== undefined) return refuse('invalid', lesson)
      // A rewrite keeps the version it replaces (notes/<resource>/<node>.<n>.md).
      if (node.notes !== undefined && node.notes.text !== '' && roadmap.primaryResourceId !== undefined) {
        this.store.archiveNotes(project.value.id, roadmap.primaryResourceId, node.id, node.notes.revisions, node.notes.text)
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

}
