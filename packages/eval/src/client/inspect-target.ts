/**
 * 查看 (T85 §二 / T86): what the lab's inspect pane can show, as one typed
 * target, and the back stack the pane keeps over those targets.
 *
 * The same target opens in the host's right sidebar (default) and in the
 * page's own Sheet (fallback): the lab tab never knows which container drew
 * it. Every target carries the ids its page reads by, so a target is enough
 * to redraw the page after a reload (0.1.7 keeps the tab, not its params).
 */

/** The right-sidebar tab kind this package owns. */
export const INSPECT_KIND = 'eval-inspect'

/** The type's identity in the tab system, and the key its body registers under. */
export const INSPECT_TAB_ID = '@khorsheed/dsh-eval:inspect'

/** How deep the back stack goes before its bottom falls off. */
export const INSPECT_STACK_CAP = 20

/** How many recently seen targets the stack's floor remembers. */
export const INSPECT_RECENT_CAP = 8

/** The five tabs of an item's materials. */
export type InspectItemTab = 'task' | 'stages' | 'rubric' | 'probes' | 'reference'

/** Which report block the pane shows in full. */
export type InspectReportPart = 'audit' | 'export'

/** One thing the pane can show. */
export type InspectTarget =
  /** An item's materials at the commit the experiment pins (T84 §三). */
  | { page: 'item'; experimentId: string; item: string; tab?: InspectItemTab }
  /** The pre-run judge prompt preview, with its item / judge pickers (T84 §四). */
  | { page: 'judge-prompt'; experimentId: string; items: string[]; judges: string[]; item?: string; judge?: string | null }
  /** The prompt.md one cell's judge actually received. */
  | { page: 'judge-prompt-actual'; runId: string; missionId: string; attempt: number; label: string }
  /** plan.json, verbatim. */
  | { page: 'plan-file'; experimentId: string }
  /** One run record's receipts: parameters, attachments, judge rounds, attempts, probes. */
  | { page: 'record'; runId: string; missionId: string; label: string }
  /** One attachment of a record. */
  | { page: 'artifact'; runId: string; missionId: string; attempt: number; path: string }
  /** One analysis draft of an experiment (T73). */
  | { page: 'analysis'; experimentId: string; path: string; name: string }
  /** A report block in full: the validity audit, or where the bundle came from. */
  | { page: 'report-part'; runId: string; part: InspectReportPart; outDir?: string }
  /** One file of an answer column that the answer view folds (T84 §一). */
  | { page: 'answer-file'; runId: string; column: string; name: string; text: string; replacements: number | null }

/** The pane's pages, as a list, for the validator. */
const PAGES = ['item', 'judge-prompt', 'judge-prompt-actual', 'plan-file', 'record', 'artifact', 'analysis', 'report-part', 'answer-file'] as const

const isString = (value: unknown): value is string => typeof value === 'string' && value !== ''
const isStrings = (value: unknown): value is string[] => Array.isArray(value) && value.every(each => typeof each === 'string')

/**
 * Whether an unknown value is a target this build can draw. The host carries
 * params without looking at them, and a layout restored from an older build
 * (or another package's params under a clashing kind) must fall to the
 * pane's empty state, never into a page that reads a missing id.
 * @param value - what arrived as `navigation.params.target`, or from storage.
 */
export function isInspectTarget(value: unknown): value is InspectTarget {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  if (!(PAGES as readonly unknown[]).includes(v.page)) return false
  switch (v.page) {
    case 'item':
      return isString(v.experimentId) && isString(v.item)
        && (v.tab === undefined || ['task', 'stages', 'rubric', 'probes', 'reference'].includes(v.tab as string))
    case 'judge-prompt':
      return isString(v.experimentId) && isStrings(v.items) && isStrings(v.judges)
    case 'judge-prompt-actual':
      return isString(v.runId) && isString(v.missionId) && typeof v.attempt === 'number' && typeof v.label === 'string'
    case 'plan-file':
      return isString(v.experimentId)
    case 'record':
      return isString(v.runId) && isString(v.missionId) && typeof v.label === 'string'
    case 'artifact':
      return isString(v.runId) && isString(v.missionId) && typeof v.attempt === 'number' && isString(v.path)
    case 'analysis':
      return isString(v.experimentId) && isString(v.path) && typeof v.name === 'string'
    case 'report-part':
      return isString(v.runId) && (v.part === 'audit' || v.part === 'export') && (v.outDir === undefined || typeof v.outDir === 'string')
    case 'answer-file':
      return isString(v.runId) && typeof v.column === 'string' && isString(v.name) && typeof v.text === 'string'
    /* v8 ignore next 2 -- PAGES above already rejected every other page */
    default:
      return false
  }
}

/**
 * Whether two targets name the same page of the same object — the stack
 * collapses a repeat open of what is already on top. A different item tab or
 * a different picker choice is the same page (the pane's own state moves).
 * @param a - one target.
 * @param b - the other.
 */
export function sameTarget(a: InspectTarget, b: InspectTarget): boolean {
  return targetKey(a) === targetKey(b)
}

/**
 * A target's identity: its page and the object it shows, without the pane's
 * own movable choices (an item tab, the preview's pickers).
 * @param target - the target.
 */
export function targetKey(target: InspectTarget): string {
  switch (target.page) {
    case 'item': return `item:${target.experimentId}:${target.item}`
    case 'judge-prompt': return `judge-prompt:${target.experimentId}`
    case 'judge-prompt-actual': return `judge-prompt-actual:${target.runId}:${target.missionId}:${String(target.attempt)}`
    case 'plan-file': return `plan-file:${target.experimentId}`
    case 'record': return `record:${target.runId}:${target.missionId}`
    case 'artifact': return `artifact:${target.runId}:${target.missionId}:${String(target.attempt)}:${target.path}`
    case 'analysis': return `analysis:${target.experimentId}:${target.path}`
    case 'report-part': return `report-part:${target.runId}:${target.part}`
    case 'answer-file': return `answer-file:${target.runId}:${target.column}:${target.name}`
  }
}

/**
 * The stack after one more open: pushed on top, a repeat of the top replaces
 * it (so a new tab or picker choice lands), the bottom falls off past the cap.
 * @param stack - the stack as it is.
 * @param target - what was opened.
 */
export function pushTarget(stack: readonly InspectTarget[], target: InspectTarget): InspectTarget[] {
  const top = stack.at(-1)
  const next = top !== undefined && sameTarget(top, target) ? [...stack.slice(0, -1), target] : [...stack, target]
  return next.slice(-INSPECT_STACK_CAP)
}

/**
 * The recent list after one more target was seen: newest first, deduplicated.
 * @param recent - the list as it is.
 * @param target - what was just shown.
 */
export function rememberTarget(recent: readonly InspectTarget[], target: InspectTarget): InspectTarget[] {
  return [target, ...recent.filter(each => !sameTarget(each, target))].slice(0, INSPECT_RECENT_CAP)
}

/** What the pane keeps per session, so a 0.1.7 reload (params gone) can redraw. */
export interface InspectMemory {
  /** The host tab the stack belongs to. */
  tabId: string
  /** The navigation revision the stack last applied. */
  revision: number
  /** The key of the target that revision carried (a reload restarts revisions, so the number alone can repeat). */
  applied: string | null
  stack: InspectTarget[]
  recent: InspectTarget[]
}

/** The storage key of one session's pane memory. */
export const inspectMemoryKey = (sessionId: string): string => `dsh-eval.inspect.${sessionId}`

/**
 * Read one session's memory. Every failure (no storage, a private window, a
 * shape from another build) answers null: this is a convenience of this
 * browser, never state the pane depends on.
 * @param sessionId - the session the sidebar belongs to.
 */
export function readInspectMemory(sessionId: string): InspectMemory | null {
  try {
    const raw = globalThis.localStorage?.getItem(inspectMemoryKey(sessionId))
    if (raw === null || raw === undefined) return null
    const value = JSON.parse(raw) as Partial<InspectMemory>
    if (typeof value.tabId !== 'string' || typeof value.revision !== 'number') return null
    const stack = Array.isArray(value.stack) ? value.stack.filter(isInspectTarget) : []
    const recent = Array.isArray(value.recent) ? value.recent.filter(isInspectTarget) : []
    const applied = typeof value.applied === 'string' ? value.applied : null
    return { tabId: value.tabId, revision: value.revision, applied, stack, recent }
  } catch {
    return null
  }
}

/**
 * Write one session's memory; a failure is silent (see {@link readInspectMemory}).
 * @param sessionId - the session the sidebar belongs to.
 * @param memory - the stack as the pane now holds it.
 */
export function writeInspectMemory(sessionId: string, memory: InspectMemory): void {
  try {
    globalThis.localStorage?.setItem(inspectMemoryKey(sessionId), JSON.stringify(memory))
  } catch { /* storage refused: the pane still works, a reload just starts empty */ }
}

/**
 * The stack a host navigation leaves the pane with (T85 §3.3).
 *
 * - No target in the params (0.1.7 after a reload, or a tab restored by
 *   undo): the remembered stack of this very tab, or nothing.
 * - The revision (and target) this memory already applied: the remembered
 *   stack (a remount must not push the same open twice).
 * - A new revision of the same tab: pushed onto the remembered stack.
 * - Another tab: a fresh stack of one.
 * @param memory - what this session remembers, or null.
 * @param tabId - the host tab being drawn.
 * @param revision - its navigation revision.
 * @param target - the target its params carry, or null.
 */
export function stackForNavigation(
  memory: InspectMemory | null,
  tabId: string,
  revision: number,
  target: InspectTarget | null,
): InspectTarget[] {
  const mine = memory !== null && memory.tabId === tabId ? memory : null
  if (target === null) return mine?.stack ?? []
  if (mine === null) return [target]
  if (mine.revision === revision && mine.applied === targetKey(target)) return mine.stack.length > 0 ? mine.stack : [target]
  return pushTarget(mine.stack, target)
}
