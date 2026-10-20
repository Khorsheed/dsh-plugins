/**
 * Knowledge-point mastery — the one rule set the service, the per-turn coach
 * context and the sidebar all read (proposal 2026-10-19-library-point-mastery).
 * Pure: no store, no context; give it a station's node, the project's
 * assessments and attempts.
 *
 * - A question is OPEN (待订正) when its newest non-void verdict — on its own
 *   paper, a re-sitting of that paper, or a retake re-asking it — failed.
 * - A point is WEAK when a question is open, or a coach note is newer than
 *   its newest pass; UNTESTED with neither probes nor notes. Otherwise (none
 *   open, newest probe passed) it is MASTERED once enough evidence stands —
 *   at least MASTERY_MIN_RIGHT distinct questions right now, across at least
 *   MASTERY_MIN_SITTINGS sittings with a right answer — and PRACTICING (巩固中)
 *   until then: one lucky paper never masters a point.
 * - Retakes (type "retake") re-ask open questions — one station's, or a
 *   whole project's (今日复习); each question resolves through its `origin`,
 *   so a cross-station retake credits every station it touched. Their
 *   verdicts move the points but never a station's pass record.
 *
 * @module @khorsheed/dsh-library/mastery
 */
import type {
  LibraryAssessment,
  LibraryAttempt,
  LibraryPointChange,
  LibraryPointNote,
  LibraryPointState,
  LibraryQuizQuestion,
  RoadmapNode,
} from './types.ts'

/** Distinct questions that must stand right before a point counts as mastered. */
export const MASTERY_MIN_RIGHT = 3
/** Separate sittings (papers or retakes) that must each have answered the point right. */
export const MASTERY_MIN_SITTINGS = 2

/** One open question: where it came from, the question, when it was missed. */
export interface LibraryOpenMiss {
  /** `${assessmentId}:${questionId}` of the ORIGINAL question (retakes resolve to it). */
  readonly key: string
  readonly assessmentId: string
  readonly questionId: string
  readonly question: LibraryQuizQuestion
  /** When the newest (failing) verdict landed. */
  readonly at: string
}

/** One point's mastery, with what decided it. */
export interface LibraryPointMastery {
  readonly id: string
  readonly title: string
  readonly state: LibraryPointState
  readonly open: readonly LibraryOpenMiss[]
  readonly notes: readonly LibraryPointNote[]
  /** The newest verdict on any question probing the point. */
  readonly lastProbe?: { readonly at: string; readonly pass: boolean }
  /** Distinct questions ever asked on the point, and how many of them stand right now (newest verdict passed). */
  readonly asked: number
  readonly right: number
  /** Sittings in which at least one question on the point was answered right. */
  readonly rightSittings: number
  /** Every sitting that touched the point, newest first: how many of its questions, how many right. */
  readonly history: readonly LibraryPointSitting[]
}

/** One sitting's share of a point. */
export interface LibraryPointSitting {
  readonly at: string
  /** A retake (订正) rather than a paper. */
  readonly retake: boolean
  readonly total: number
  readonly right: number
}

/** A station's mastery: every point, and every open question (pointless ones too). */
export interface LibraryStationMastery {
  readonly points: readonly LibraryPointMastery[]
  readonly open: readonly LibraryOpenMiss[]
}

interface Probe {
  readonly attemptId: string
  readonly retake: boolean
  readonly key: string
  readonly assessmentId: string
  readonly question: LibraryQuizQuestion
  readonly pass: boolean
  readonly at: string
}

/** Whether a verdict passes (partial credit counts at half or more). */
function passes(verdict: { readonly pass: boolean; readonly ratio?: number }): boolean {
  return verdict.pass && (verdict.ratio ?? 1) >= 0.5
}

/**
 * The station's mastery from the ledger.
 * @param node - the station (its points and their notes).
 * @param assessments - the project's assessments (others are ignored).
 * @param attempts - the project's attempts, any order.
 */
export function stationMastery(node: RoadmapNode, assessments: readonly LibraryAssessment[], attempts: readonly LibraryAttempt[]): LibraryStationMastery {
  // The station's papers, plus every retake (a retake counts here only through questions whose origin is one of them).
  const papers = new Map(assessments
    .filter(assessment => assessment.scope.nodeId === node.id && assessment.type === 'quiz' && assessment.questions !== undefined)
    .map(assessment => [assessment.id, assessment]))
  const own = new Map([...papers, ...assessments
    .filter(assessment => assessment.type === 'retake' && assessment.questions !== undefined)
    .map(assessment => [assessment.id, assessment] as const)])
  const probes: Probe[] = []
  for (const attempt of attempts) {
    const assessment = attempt.assessmentId === undefined ? undefined : own.get(attempt.assessmentId)
    if (assessment === undefined) continue
    for (const verdict of attempt.verdicts) {
      if (verdict.void === true) continue
      const question = assessment.questions!.find(candidate => candidate.id === verdict.task)
      if (question === undefined) continue
      if (assessment.type === 'retake' && (question.origin === undefined || !papers.has(question.origin.assessmentId))) continue
      const originId = question.origin?.assessmentId ?? assessment.id
      const originQuestion = question.origin === undefined
        ? question
        : own.get(question.origin.assessmentId)?.questions?.find(candidate => candidate.id === question.origin!.questionId) ?? question
      probes.push({ attemptId: attempt.id, retake: assessment.type === 'retake', key: `${originId}:${question.origin?.questionId ?? question.id}`, assessmentId: originId, question: originQuestion, pass: passes(verdict), at: attempt.at })
    }
  }
  probes.sort((a, b) => a.at.localeCompare(b.at))
  const newestByKey = new Map<string, Probe>()
  for (const probe of probes) newestByKey.set(probe.key, probe)
  const open: LibraryOpenMiss[] = [...newestByKey.values()]
    .filter(probe => !probe.pass)
    .map(probe => ({ key: probe.key, assessmentId: probe.assessmentId, questionId: probe.question.id, question: probe.question, at: probe.at }))
    .sort((a, b) => b.at.localeCompare(a.at))
  const points = (node.points ?? []).map((point): LibraryPointMastery => {
    const mine = probes.filter(probe => probe.question.point === point.id)
    const last = mine.at(-1)
    const lastPass = [...mine].reverse().find(probe => probe.pass)
    const pointOpen = open.filter(miss => miss.question.point === point.id)
    const notes = point.notes ?? []
    const newestNote = notes.reduce<string | undefined>((latest, note) => latest === undefined || note.at > latest ? note.at : latest, undefined)
    const noteUnanswered = newestNote !== undefined && (lastPass === undefined || newestNote > lastPass.at)
    const newest = new Map<string, Probe>()
    for (const probe of mine) newest.set(probe.key, probe)
    const right = [...newest.values()].filter(probe => probe.pass).length
    const rightSittings = new Set(mine.filter(probe => probe.pass).map(probe => probe.attemptId)).size
    const state: LibraryPointState = last === undefined && notes.length === 0
      ? 'untested'
      : pointOpen.length > 0 || last?.pass !== true || noteUnanswered
        ? 'weak'
        : right >= MASTERY_MIN_RIGHT && rightSittings >= MASTERY_MIN_SITTINGS ? 'mastered' : 'practicing'
    const sittings = new Map<string, { at: string; retake: boolean; total: number; right: number }>()
    for (const probe of mine) {
      const sitting = sittings.get(probe.attemptId) ?? { at: probe.at, retake: probe.retake, total: 0, right: 0 }
      sittings.set(probe.attemptId, { ...sitting, total: sitting.total + 1, right: sitting.right + (probe.pass ? 1 : 0) })
    }
    return {
      id: point.id,
      title: point.title,
      state,
      open: pointOpen,
      notes,
      ...(last === undefined ? {} : { lastProbe: { at: last.at, pass: last.pass } }),
      asked: newest.size,
      right,
      rightSittings,
      history: [...sittings.values()].sort((a, b) => b.at.localeCompare(a.at)),
    }
  })
  return { points, open }
}

/** The points whose state differs between two readings of the same station. */
export function masteryChanges(nodeId: string, before: LibraryStationMastery, after: LibraryStationMastery): LibraryPointChange[] {
  const previous = new Map(before.points.map(point => [point.id, point.state]))
  return after.points.flatMap(point => {
    const from = previous.get(point.id) ?? 'untested'
    return from === point.state ? [] : [{ nodeId, pointId: point.id, title: point.title, from, to: point.state }]
  })
}

/** One line on why a point is where it is (event detail, context line). */
export function masteryReason(point: LibraryPointMastery): string {
  const parts: string[] = []
  if (point.open.length > 0) parts.push(`${point.open.length} open miss${point.open.length === 1 ? '' : 'es'}`)
  const note = point.notes.at(-1)
  if (note !== undefined) parts.push(`note "${note.term ?? note.text}"`)
  if (point.state === 'mastered' && point.lastProbe !== undefined) parts.push(`${point.right} right across ${point.rightSittings} sittings`)
  if (point.state === 'practicing') parts.push(`${point.right} right across ${point.rightSittings} sitting${point.rightSittings === 1 ? '' : 's'}; mastered at ${MASTERY_MIN_RIGHT} across ${MASTERY_MIN_SITTINGS}`)
  return parts.join('; ')
}
