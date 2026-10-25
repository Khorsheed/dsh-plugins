/**
 * The library's pure rules: roadmap shape validation, the unlock pass, the
 * covers' evidence gate, and two small helpers. No store, no context — the
 * service layers and the tools call them.
 *
 * @module @khorsheed/dsh-library/service/rules
 */
import {
  isLibraryId,
  coverKind,
  coverTopic,
  isThickResource,
  parseLocator,
  type LibraryAcceptanceInput,
  type LibraryResource,
  type LibraryNodeCover,
  type RoadmapNode,
} from '../types.ts'
import { normalizeFragment } from './core.ts'


/** A node's title, for event rows. */
export function titleOf(nodes: readonly RoadmapNode[], nodeId: string): string {
  return nodes.find(node => node.id === nodeId)?.title ?? ''
}

/**
 * The option an answer key names — a letter in range, a lettered option, the
 * option text, else a one-way containment — or -1. The sidebar's judge
 * (`client/judge.ts`'s choiceIndex) resolves the same spellings; a question
 * this resolves to -1 is judged wrong no matter what the learner picks, so
 * the write gate refuses it.
 */
export function choiceOptionIndex(options: readonly string[], answer: string): number {
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

/** A lesson's size in knowledge points (a quiz station's points). */
export const STATION_MIN_POINTS = 3
export const STATION_MAX_POINTS = 5

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
    // One station is one lesson: 3–5 knowledge points, never a chapter's whole glossary.
    const pointCount = Array.isArray(node.points) ? node.points.length : 0
    if (node.gate === 'quiz' && pointCount > STATION_MAX_POINTS) {
      errors.push(`nodes[${index}] (${node.id}) has ${pointCount} points — one station is one lesson of ${STATION_MIN_POINTS}–${STATION_MAX_POINTS} points: split it into consecutive stations, simple before hard`)
    } else if (node.gate === 'quiz' && pointCount > 0 && pointCount < STATION_MIN_POINTS) {
      errors.push(`nodes[${index}] (${node.id}) has ${pointCount} point${pointCount === 1 ? '' : 's'} — a lesson carries ${STATION_MIN_POINTS}–${STATION_MAX_POINTS}: merge it with a neighbour or name what else it teaches`)
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
            // An authored textbook's chapters are lessons you wrote: one station teaches one.
            if (covered.id === scope.resourceId && covered.origin === 'authored' && ranges.reduce((rows, range) => rows + range.to - range.from + 1, 0) > 1) {
              errors.push(`nodes[${index}] (${node.id}) spans ${cover.locator} of 《${covered.title}》, a textbook you authored — each of its chapters is one lesson and one station: one row per station (too much for one lesson → split the chapter in the contents first)`)
            }
            for (const range of ranges) {
              if (range.to > (covered.toc?.length ?? 0)) {
                const rows = covered.toc?.length ?? 0
                errors.push(`nodes[${index}] (${node.id}) covers up to row ${range.to}, but 《${covered.title}》's contents has ${rows} rows — library_read · toc lists them${rows < 3 ? `; a book with ${rows} row(s) was registered with its chapters joined — fix the contents first (library_resource op create, resourceId ${covered.id}, toc one chapter per line), never drop the chapters` : ''}`)
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
        if (covered.meta?.bookKind === 'material') return `《${covered.title}》 is a material book (its exact text is what is tested)`
      } else {
        return `the station draws on 《${covered.title}》, a thin link (a linked text you cannot recall reliably)`
      }
    } else if (kind === 'url') {
      return `the station covers ${cover.ref} (a web text you cannot recall reliably)`
    }
  }
  return undefined
}


/** The least a point's 讲义 section says (characters, markup and blanks aside). */
export const LESSON_SECTION_MIN = 120

/**
 * What keeps a 讲义 from reading as a lesson, or undefined: change logs and
 * internal words never reach the learner; on a textbook you authored (the 讲义
 * ARE its text) every knowledge point gets its own section — a heading naming
 * the point, then enough to learn it from.
 */
export function lessonProblems(text: string, node: RoadmapNode, authored: boolean): string | undefined {
  const problems: string[] = []
  if (/第\s*\d+\s*次更新|修正说明|更新说明|\bacceptance\b/i.test(text)) {
    problems.push('the 讲义 are for the learner — drop change logs (第 N 次更新, 修正说明; the sidebar already counts revisions) and internal words (acceptance)')
  }
  const points = node.points ?? []
  if (authored && points.length > 0) {
    const squash = (value: string): string => value.replace(/[\s*_`]/g, '').toLowerCase()
    const headings = [...text.matchAll(/^#{1,4}\s+(.+)$/gm)].map(match => ({ title: squash(match[1] ?? ''), at: match.index ?? 0, end: (match.index ?? 0) + match[0].length }))
    const pointHeadings = points.map(point => headings.find(heading => heading.title.includes(squash(point.title))))
    const starts = pointHeadings.flatMap(heading => heading === undefined ? [] : [heading.at]).sort((a, b) => a - b)
    const missing: string[] = []
    const thin: string[] = []
    for (const [index, point] of points.entries()) {
      const heading = pointHeadings[index]
      if (heading === undefined) { missing.push(point.title); continue }
      const next = starts.find(start => start > heading.at) ?? text.length
      const body = text.slice(heading.end, next).replace(/[\s#>*_`|-]/g, '')
      if (body.length < LESSON_SECTION_MIN) thin.push(point.title)
    }
    if (missing.length > 0) problems.push(`this textbook is yours, so its 讲义 are the lesson itself: give each knowledge point its own section headed by its title (## ${points[0]!.title}) — missing: ${missing.join('、')}`)
    if (thin.length > 0) problems.push(`too thin to learn from (each point: what it is → why it matters → an example or the steps → a common mistake → one self-check question): ${thin.join('、')}`)
  }
  return problems.length === 0 ? undefined : problems.join('; ')
}
