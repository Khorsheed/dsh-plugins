/**
 * Assessments and attempts: quizzes (the two-axis checks), the assess cascade, acceptance sittings.
 *
 * One layer of the library service (see `service/core.ts` for the layering):
 * the methods are the service's own, moved here verbatim by domain.
 *
 * @module @khorsheed/dsh-library/service/assess
 */
import {
  DEFAULT_PASS_RATIO,
  isLibraryId,
  acceptanceLines,
  coverKind,
  isThickResource,
  MAX_BOX,
  type LibraryAcceptanceLine,
  type LibraryAssessResult,
  type LibraryPointChange,
  type LibraryAssessment,
  type LibraryAttempt,
  type LibraryCard,
  type LibraryCardUpdate,
  type LibraryOutcome,
  type LibraryProject,
  type LibraryQuizFocus,
  type LibraryQuizQuestion,
  type LibraryPoint,
  type LibraryRoadmap,
  type LibraryTemplate,
  type LibraryVerdict,
  type RoadmapNode,
} from '../types.ts'
import { cardKey, exactMatch } from '../cards.ts'
import { mintLibraryId } from '../store.ts'
import {
  refuse,
  leitnerDueAt,
  normalizeFragment,
  clampWeakness,
  live,
} from './core.ts'
import { titleOf, choiceOptionIndex, unlockReady, coversVerbatimBlocker } from './rules.ts'
import { masteryChanges, stationMastery, type LibraryOpenMiss, type LibraryPointMastery, type LibraryStationMastery } from '../mastery.ts'
import { LibraryServicePages } from './pages.ts'

export class LibraryServiceAssess extends LibraryServicePages {
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
              errors.push(`${label} asks about 《${resource.title}》's content from memory — it is a material book (its exact text is what is tested). Ask the learner to photograph the page and quote it (evidence.kind photo); a web quote only from the SAME edition's text, verbatim — never your own words as a quote. If the book is really a textbook of domain knowledge, it is mis-typed: the learner switches it to 知识型 on the textbook page`)
            }
          } else {
            const blocker = coversVerbatimBlocker(gatedNode.covers, candidate => this.store.readResource(project.value.id, candidate), gatedRoadmap?.primaryResourceId)
            if (blocker !== undefined) {
              errors.push(`${label} asks the station's content from memory, but ${blocker}. Ask the learner to photograph the page and quote it (evidence.kind photo); a web quote only from the same text, verbatim — never your own words as a quote, never material from another project`)
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
  protected async putQuizAttempt(project: LibraryProject, assessmentId: string, verdicts: readonly LibraryVerdict[]): Promise<LibraryOutcome<LibraryAssessResult>> {
    const assessment = this.store.readAssessment(project.id, assessmentId)
    if (assessment === undefined || (assessment.type !== 'quiz' && assessment.type !== 'retake') || assessment.questions === undefined) return refuse('not-found', `no quiz ${JSON.stringify(assessmentId)} — store the quiz first (library_quiz), then assess it`)
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
      // The stations this sitting can move: its own, or — a project-wide retake — every station its questions came from.
      const stationIds = assessment.scope.nodeId !== undefined
        ? [assessment.scope.nodeId]
        : [...new Set((assessment.questions ?? []).flatMap(question => {
          const origin = question.origin === undefined ? undefined : this.store.readAssessment(project.id, question.origin.assessmentId)
          return origin?.scope.nodeId === undefined ? [] : [origin.scope.nodeId]
        }))]
      const befores = stationIds.map(stationId => [stationId, this.stationMasteryOf(project.id, stationId, stationId === assessment.scope.nodeId ? assessment.scope.resourceId : undefined)] as const)
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
        // A card-less miss leaves a card only when the coach named what was
        // missed (missedCard) — never the question's own text: a subject's
        // misses wait in 待订正 on their point instead.
        if (cardIds.length === 0 && !passed && (verdict.missedCard?.term.trim() ?? '') !== '') {
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
      // A retake (订正) never counts toward passing: no stats, no completion.
      if (roadmap !== undefined && gated !== undefined && gated.gate === 'quiz' && assessment.type === 'quiz') {
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
      const pointChanges = befores.flatMap(([stationId, before]) => this.pointChangesSince(project.id, stationId, stationId === assessment.scope.nodeId ? assessment.scope.resourceId : undefined, before, at))
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
        ...(pointChanges.length === 0 ? {} : { pointChanges }),
      }
    })
  }

  /**
   * The practice path of putAttempt: acceptance of a hands-on station, judged
   * against the node's current practice assessment (materialized at adoption).
   * No probed cards — a failed acceptance line with a `missedCard` leaves (or
   * re-weakens) a card; at the pass ratio the station completes.
   */
  protected async putPracticeAttempt(project: LibraryProject, nodeId: string, resourceId: string | undefined, verdicts: readonly LibraryVerdict[]): Promise<LibraryOutcome<LibraryAssessResult>> {
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

  /** Every open miss across the project's adopted quiz stations, newest first. */
  protected projectOpenMisses(projectId: string): LibraryOpenMiss[] {
    const assessments = this.store.listAssessments(projectId)
    const attempts = this.store.readAttempts(projectId)
    const open: LibraryOpenMiss[] = []
    for (const resource of this.store.listResources(projectId)) {
      for (const node of this.store.readRoadmap(projectId, resource.id)?.nodes ?? []) {
        if (node.gate === 'quiz') open.push(...stationMastery(node, assessments, attempts).open)
      }
    }
    return open.sort((a, b) => b.at.localeCompare(a.at))
  }

  /** A station's mastery as the ledger stands (undefined off a station, or for a node no adopted path holds). */
  protected stationMasteryOf(projectId: string, nodeId: string | undefined, resourceId?: string): LibraryStationMastery | undefined {
    if (nodeId === undefined) return undefined
    const node = this.findNodeRoadmap(projectId, nodeId, resourceId)?.nodes.find(candidate => candidate.id === nodeId)
    if (node === undefined) return undefined
    return stationMastery(node, this.store.listAssessments(projectId), this.store.readAttempts(projectId))
  }

  /**
   * The points a write moved, read against `before`; each change is ledgered
   * as a `point.changed` event (今日 「最近的变化」). Call inside the lock,
   * after the write.
   */
  protected pointChangesSince(projectId: string, nodeId: string | undefined, resourceId: string | undefined, before: LibraryStationMastery | undefined, at: string): LibraryPointChange[] {
    if (nodeId === undefined || before === undefined) return []
    const after = this.stationMasteryOf(projectId, nodeId, resourceId)
    if (after === undefined) return []
    const changes = masteryChanges(nodeId, before, after)
    const roadmap = this.findNodeRoadmap(projectId, nodeId, resourceId)
    const onResource = roadmap?.primaryResourceId === undefined ? {} : { resourceId: roadmap.primaryResourceId }
    if (changes.length > 0) {
      this.store.appendEvents(projectId, changes.map(change => {
        const point = after.points.find(candidate => candidate.id === change.pointId)
        const note = point?.notes.at(-1)
        return {
          at,
          type: 'point.changed' as const,
          id: change.pointId,
          nodeId,
          title: change.title,
          ...onResource,
          from: change.from,
          to: change.to,
          count: point?.open.length ?? 0,
          ...(change.to === 'weak' && note !== undefined && (point?.open.length ?? 0) === 0 ? { detail: (note.term ?? note.text).slice(0, 300) } : {}),
        }
      }))
    }
    return changes
  }

  /**
   * 订正: a retake paper re-asking a station's open misses (all, or the keys
   * named — `${assessmentId}:${questionId}`). Its verdicts move the points,
   * never the station's pass record. No coach needed: the questions exist.
   */
  async createRetake(request: { projectId: string; resourceId?: string; nodeId?: string; keys?: readonly string[] }): Promise<LibraryOutcome<{ assessment: LibraryAssessment }>> {
    this.assertAlive('createRetake')
    const project = this.readProjectOrRefusal(request.projectId)
    if ('error' in project) return project
    return await this.mutate(project.value.id, () => {
      // No station named: every station's open misses (今日复习 / the project's 错题).
      let open: LibraryOpenMiss[]
      if (request.nodeId === undefined) {
        open = this.projectOpenMisses(project.value.id)
      } else {
        const mastery = this.stationMasteryOf(project.value.id, request.nodeId, request.resourceId)
        if (mastery === undefined) return refuse('not-found', `no adopted station ${JSON.stringify(request.nodeId)}`)
        open = [...mastery.open]
      }
      const wanted = request.keys === undefined || request.keys.length === 0 ? undefined : new Set(request.keys)
      const misses = open.filter(miss => wanted === undefined || wanted.has(miss.key))
      if (misses.length === 0) return refuse('invalid', `nothing to retake here — ${request.nodeId === undefined ? 'the project' : 'this station'} has no open misses`)
      const roadmap = request.nodeId === undefined ? undefined : this.findNodeRoadmap(project.value.id, request.nodeId, request.resourceId)
      const assessment: LibraryAssessment = {
        id: mintLibraryId('q'),
        type: 'retake',
        scope: request.nodeId === undefined ? {} : { nodeId: request.nodeId, ...(roadmap?.primaryResourceId === undefined ? {} : { resourceId: roadmap.primaryResourceId }) },
        questions: misses.map((miss, index) => ({ ...miss.question, id: `r${index + 1}`, origin: { assessmentId: miss.assessmentId, questionId: miss.questionId } })),
        createdAt: new Date().toISOString(),
      }
      this.store.writeAssessment(project.value.id, assessment)
      return { ok: true as const, assessment }
    })
  }

  /**
   * A coach note on a knowledge point: the learner stuck on it here. The
   * point turns weak until a newer probe passes (subject projects — a weak
   * point lands on its point, not on a card).
   */
  async notePoint(request: { projectId: string; resourceId?: string; nodeId: string; pointId: string; text: string; term?: string; session?: string }): Promise<LibraryOutcome<{ point: LibraryPointMastery; changes: LibraryPointChange[] }>> {
    this.assertAlive('notePoint')
    const project = this.readProjectOrRefusal(request.projectId)
    if ('error' in project) return project
    const text = request.text.trim()
    if (text === '') return refuse('invalid', 'a point note needs its text — what the learner stuck on, in one line')
    return await this.mutate(project.value.id, () => {
      const roadmap = this.findNodeRoadmap(project.value.id, request.nodeId, request.resourceId)
      const node = roadmap?.nodes.find(candidate => candidate.id === request.nodeId)
      if (roadmap === undefined || node === undefined) return refuse('not-found', `no adopted station ${JSON.stringify(request.nodeId)} — library_read · roadmap lists them`)
      const point = node.points?.find(candidate => candidate.id === request.pointId)
      if (point === undefined) {
        return refuse('not-found', `station ${node.title} has no point ${JSON.stringify(request.pointId)} — its points: ${(node.points ?? []).map(candidate => `${candidate.id} (${candidate.title})`).join(', ') || 'none'}`)
      }
      const before = this.stationMasteryOf(project.value.id, request.nodeId, request.resourceId)
      const at = new Date().toISOString()
      const note = { text: text.slice(0, 1000), ...(request.term === undefined || request.term.trim() === '' ? {} : { term: request.term.trim().slice(0, 100) }), at, ...(request.session === undefined ? {} : { session: request.session }) }
      this.store.writeRoadmap(project.value.id, {
        ...roadmap,
        nodes: roadmap.nodes.map(candidate => candidate.id !== node.id ? candidate : {
          ...candidate,
          points: (candidate.points ?? []).map(entry => entry.id !== point.id ? entry : { ...entry, notes: [...(entry.notes ?? []), note] }),
        }),
      })
      const changes = this.pointChangesSince(project.value.id, request.nodeId, request.resourceId, before, at)
      const after = this.stationMasteryOf(project.value.id, request.nodeId, request.resourceId)!.points.find(candidate => candidate.id === point.id)!
      return { ok: true as const, point: after, changes }
    })
  }

  /** The roadmap holding one node: the hinted textbook's first, then every adopted path of the project. */
  protected findNodeRoadmap(projectId: string, nodeId: string, resourceId?: string): LibraryRoadmap | undefined {
    const hinted = this.store.readRoadmap(projectId, resourceId)
    if (hinted?.nodes.some(node => node.id === nodeId)) return hinted
    for (const resource of this.store.listResources(projectId)) {
      const roadmap = this.store.readRoadmap(projectId, resource.id)
      if (roadmap?.nodes.some(node => node.id === nodeId)) return roadmap
    }
    return undefined
  }

  /** The card a missed, card-less question leaves behind. */
  protected missedCardFor(
    question: LibraryQuizQuestion,
    verdict: LibraryVerdict,
    quiz: LibraryAssessment,
    resourceId: string | undefined,
    template: LibraryTemplate,
    at: string,
  ): LibraryCard {
    const term = verdict.missedCard?.term.trim() ?? ''
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

}
