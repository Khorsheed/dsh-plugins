/**
 * The journey rules of T72, kept out of the pages so the specs can pin them
 * without rendering anything: which group a list row sits in, which rows the
 * session filter shows, what the readiness checklist blocks on and which
 * button each of its lines offers, and which sentence the conclusion card
 * puts under its source.
 *
 * The STATUS itself is not decided here. It arrives on the row, derived by the
 * server (`deriveExperimentStatus`), and this module only arranges rows by it:
 * a status the browser invented would be a second opinion the eval tool's
 * `eval_run_status` never shares.
 */

import type {
  EvalClosure, EvalExperimentRow, EvalExperimentStatus, EvalPlanCheck, EvalPlanCondition,
} from '../types.ts'
import { en, type EvalKey } from './locales.ts'

// ── the list ────────────────────────────────────────────────────────────

/** The list's four groups, in the order they are shown. */
export type ListGroup = 'attention' | 'running' | 'finished' | 'archived'

export const LIST_GROUPS: readonly ListGroup[] = ['attention', 'running', 'finished', 'archived']

/**
 * 需要你处理 is every status whose next step is a person's: approving,
 * re-running a stalled run, human review, re-checking a refusal, and a draft
 * someone has to validate. 已完成 holds the three terminal words — done, void
 * (评估不成立) and cancelled — because none of them asks anything more.
 */
const GROUP_OF: Readonly<Record<EvalExperimentStatus, ListGroup>> = {
  'draft': 'attention',
  'pending-approval': 'attention',
  'stalled': 'attention',
  'judging': 'attention',
  'refused': 'attention',
  'running': 'running',
  'done': 'finished',
  'void': 'finished',
  'cancelled': 'finished',
}

/**
 * The group one row sits in. Archiving outranks the status — it is the one
 * thing archiving does (T72 §8); the status on the row is untouched.
 * @param row - the list row.
 * @returns its group.
 */
export function listGroupOf(row: Pick<EvalExperimentRow, 'status' | 'archived'>): ListGroup {
  if (row.archived) return 'archived'
  return GROUP_OF[row.status] ?? 'attention'
}

/**
 * Split rows into the four groups, each in the order it arrived.
 * @param rows - the rows to arrange.
 * @returns one list per group (empty groups included).
 */
export function groupRows<T extends Pick<EvalExperimentRow, 'status' | 'archived'>>(
  rows: readonly T[],
): Record<ListGroup, T[]> {
  const out: Record<ListGroup, T[]> = { attention: [], running: [], finished: [], archived: [] }
  for (const row of rows) out[listGroupOf(row)].push(row)
  return out
}

/** Which rows the list shows: this session's, or all of them. */
export type ListScope = 'session' | 'all'

/** The localStorage key the scope toggle is remembered under. */
export const LIST_SCOPE_KEY = 'dsh-eval.listScope'

/**
 * Apply the session filter.
 *
 * A DRAFT belongs to every session — it has no run, so it has no origin, and
 * hiding the plan someone just wrote because it has no session would be the
 * wrong way round. A run belongs to this session when its `originSession` is
 * this session. Everything else — other sessions' runs and a CLI run with no
 * origin at all — is counted, not dropped: the header says «另有 n 个».
 * @param rows - every row.
 * @param session - this session's id (null when the server knew none).
 * @param scope - the toggle.
 * @returns the rows to show, and how many were left out.
 */
export function scopeRows<T extends Pick<EvalExperimentRow, 'runId' | 'originSession'>>(
  rows: readonly T[],
  session: string | null,
  scope: ListScope,
): { shown: T[]; others: number } {
  const mine: T[] = []
  let others = 0
  for (const row of rows) {
    if (row.runId === null || (session !== null && row.originSession === session)) mine.push(row)
    else others += 1
  }
  if (scope === 'all') return { shown: [...rows], others }
  return { shown: mine, others }
}

/**
 * Read the remembered scope. Storage can be absent or throw (a private window,
 * blocked site data), and the default is the session's own rows.
 * @param storage - where to read from; the window's localStorage by default.
 * @returns the remembered scope, or 'session'.
 */
export function readListScope(storage?: Pick<Storage, 'getItem'> | null): ListScope {
  try {
    const store = storage === undefined ? globalThis.localStorage : storage
    return store?.getItem(LIST_SCOPE_KEY) === 'all' ? 'all' : 'session'
  } catch {
    return 'session'
  }
}

/**
 * Remember the scope; a storage that refuses is not an error.
 * @param scope - the new scope.
 * @param storage - where to write; the window's localStorage by default.
 */
export function writeListScope(scope: ListScope, storage?: Pick<Storage, 'setItem'> | null): void {
  try {
    const store = storage === undefined ? globalThis.localStorage : storage
    store?.setItem(LIST_SCOPE_KEY, scope)
  } catch {
    // a per-viewer convenience; nothing to report
  }
}

// ── the readiness checklist ───────────────────────────────────────────────

/** What a checklist line's button does. */
export type ReadinessFix =
  | { kind: 'provision'; condition: string }
  | { kind: 'endpoint'; condition: string }
  | { kind: 'bind' }
  | { kind: 'agent' }

/** Codes a provision of the named condition resolves. */
const PROVISION_PREFIXES = ['HOME_', 'LOCK_', 'PROVISION_', 'CAPABILITIES_'] as const
const PROVISION_CODES: ReadonlySet<string> = new Set(['SCOPE_NOT_PROVISIONED', 'EFFECTIVE_MISMATCH'])
/** Codes that mean the dataset repository is not bound (or not where it was). */
const BIND_CODES: ReadonlySet<string> = new Set(['DATASET_ROOT_UNRESOLVABLE', 'COMMIT_UNRESOLVED'])

/**
 * The button one checklist line offers (T72 §4).
 *
 * A provision or an endpoint edit needs a condition to act on; a line of that
 * family validate could not attribute to one falls to the agent, which can
 * read the message and decide. Everything not in a named family — plan shape,
 * judge wiring, stage schemas, empty items — is the agent's too: those are
 * edits to the plan file, which is the agent's to write.
 * @param check - the line.
 * @returns the fix.
 */
export function readinessFix(check: Pick<EvalPlanCheck, 'code' | 'message' | 'condition'>): ReadinessFix {
  const { code, message, condition } = check
  if (PROVISION_CODES.has(code) || PROVISION_PREFIXES.some(prefix => code.startsWith(prefix))) {
    return condition === null ? { kind: 'agent' } : { kind: 'provision', condition }
  }
  if (code === 'UNRESOLVED_FIELD' && /endpoint/i.test(message)) {
    return condition === null ? { kind: 'agent' } : { kind: 'endpoint', condition }
  }
  if (BIND_CODES.has(code)) return { kind: 'bind' }
  return { kind: 'agent' }
}

/**
 * Split validate's lines into 阻塞项 and 提醒.
 *
 * An error blocks. A WARNING blocks too when it is about a condition the
 * review does not call ready: the readiness gate at start refuses exactly
 * those, so calling it a reminder would promise a start the gate will refuse.
 * The rest of the warnings are reminders.
 * @param checks - validate's lines (ok lines are ignored).
 * @param conditions - the review's condition verdicts.
 * @returns the two groups, each in validate's order.
 */
export function splitReadiness<T extends Pick<EvalPlanCheck, 'severity' | 'code' | 'condition'>>(
  checks: readonly T[],
  conditions: ReadonlyArray<Pick<EvalPlanCondition, 'id' | 'status'>>,
): { blockers: T[]; reminders: T[] } {
  const unready = new Set(conditions.filter(entry => entry.status !== 'ready').map(entry => entry.id))
  const blockers: T[] = []
  const reminders: T[] = []
  for (const check of checks) {
    if (check.severity === 'ok' || check.code === 'PLAN_UNREADABLE') continue
    if (check.severity === 'error' || (check.condition !== null && unready.has(check.condition))) blockers.push(check)
    else reminders.push(check)
  }
  return { blockers, reminders }
}

/** Every validate code with a human sentence in the dictionary. */
export const READINESS_CODES: readonly string[] = [
  'CAPABILITIES_NOT_PROVISIONED', 'CAPABILITIES_PRESET_MISMATCH', 'CAPABILITIES_SNAPSHOT_STALE', 'CAPABILITIES_UNMEASURED',
  'CLAUDE_CONTAINER_SCOPE_MISSING', 'CLAUDE_CONTAINER_SCOPE_SHARED',
  'COMMIT_UNRESOLVED', 'CONDITION_FILE_MISSING', 'CONDITION_ID_INVALID', 'CONDITION_MALFORMED', 'CONDITION_SCHEMA',
  'CONDITIONS_DUPLICATED', 'CONDITIONS_EMPTY', 'CREDENTIALS_UNUSABLE', 'DATASET_ROOT_UNRESOLVABLE',
  'EFFECTIVE_MISMATCH', 'EGRESS_CHECK_MALFORMED',
  'EXPECTED_NS_EMPTY', 'EXPECTED_NS_NO_LLM_DRAFT_CRITERIA', 'EXPECTED_NS_NO_PROBE', 'EXPECTED_NS_NO_RUBRIC', 'EXPECTED_NS_RUBRIC_UNPARSEABLE',
  'EXPORTS_INVALID', 'HOME_MISMATCH', 'HOME_NOT_PROVISIONED', 'HOME_SHA_DECLARED_STALE', 'HOME_SHA_UNDECLARED', 'HOME_SHA_WRITTEN',
  'ITEMS_EMPTY', 'JUDGE_DUPLICATED', 'JUDGE_INCOMPLETE', 'JUDGE_IS_SAME_CONDITION', 'JUDGE_MISSING', 'JUDGE_MODEL_UNDECLARED',
  'JUDGE_REQUIRED_FOR_LLM_DRAFT', 'LOCK_MALFORMED', 'LOCK_MISSING', 'LOCK_STALE', 'ONLY_UNKNOWN_CELL',
  'PERMISSION_NOT_FOR_HARNESS', 'PLAN_MALFORMED', 'PLAN_SCHEMA', 'PLAN_UNREADABLE', 'PRESET_NOT_FOR_HARNESS',
  'PROVISION_MISMATCH', 'PROVISION_RECORD_MISSING', 'REPS_INVALID', 'RETRY_INVALID', 'SCOPE_NAME', 'SCOPE_NOT_PROVISIONED',
  'SHA_FORMAT', 'STAGE_SCHEMA_MALFORMED', 'STAGE_SCHEMA_MISSING', 'STAGE_SCHEMA_UNSUPPORTED', 'STAGES_EMPTY',
  'UNIT_SCOPED_HOME_MISSING', 'UNIT_SCOPED_HOME_RELATIVE', 'UNIT_SCOPED_HOME_VAR_UNDECLARED', 'UNRESOLVED_FIELD', 'BUDGET_INVALID',
]

const KNOWN_CODES: ReadonlySet<string> = new Set(READINESS_CODES)

/**
 * The dictionary key of one code's human sentence, or null for a code this
 * table does not know — the page then shows validate's own message, because a
 * blank line is worse than an English one.
 * @param code - validate's code.
 * @param condition - the condition the line is about, when validate named one.
 * @returns the key, or null.
 */
export function readinessKey(code: string, condition: string | null = null, field: string | null = null): EvalKey | null {
  if (!KNOWN_CODES.has(code)) return null
  const key = `readiness.${code}` as EvalKey
  // A sentence that names the condition is no sentence without one: validate
  // raised the code at plan level this time, and its own message says more.
  if (condition === null && en[key].includes('{condition}')) return null
  // Same for the field: two 「还有字段没填」 lines on one condition read as a
  // duplicate unless each says which field.
  if (field === null && en[key].includes('{field}')) return null
  return key
}

/**
 * The field a line is about, read off the head of validate's message —
 * `endpoint.baseUrl is null — …` (validate) or `model: …` (review). Only the
 * lines whose sentence names a field need it.
 * @param message - validate's own message.
 * @returns the dotted field path, or null when the message does not open with one.
 */
export function readinessField(message: string): string | null {
  // the plan check prefixes the condition (`condition a: `, `judge condition j: `); the field comes after it
  const match = /^(?:(?:judge )?condition \S+: )?([A-Za-z_][\w.[\]-]*)(?: is null|:)/.exec(message)
  return match?.[1] ?? null
}

/**
 * One check's sentence: its key and the params that key takes.
 * @param check - one checklist line.
 * @returns the key and params, or null to show validate's own message.
 */
export function readinessSentence(
  check: Pick<EvalPlanCheck, 'code' | 'condition' | 'message'>,
): { key: EvalKey; params: { condition: string; field?: string } } | null {
  const field = readinessField(check.message)
  const key = readinessKey(check.code, check.condition ?? null, field)
  if (key === null) return null
  const condition = check.condition ?? ''
  return { key, params: en[key].includes('{field}') && field !== null ? { condition, field } : { condition } }
}

// ── the conclusion card ──────────────────────────────────────────────────

/**
 * The card's source line, by closure exit (T72 §6). `void` has no line: the
 * whole page is replaced by 「评估不成立」.
 * @param closure - the closure in force.
 * @returns the key of the source sentence, or null for a voided run.
 */
export function conclusionSourceKey(closure: Pick<EvalClosure, 'exit'> | null | undefined): EvalKey | null {
  // undefined: a server older than the closure field. Same as nobody closed.
  if (closure === null || closure === undefined) return 'report.sourceDraft'
  switch (closure.exit) {
    case 'final':
    case 'flagged':
      return 'report.sourceFinal'
    case 'unreviewed':
      return 'report.sourceDraft'
    case 'void':
      return null
  }
}

/**
 * The card's validity line: how many of the checks passed, and whether that
 * is all of them.
 * @param invariants - the report's checks.
 * @returns passed and total.
 */
export function validityCount(invariants: ReadonlyArray<{ status: string }>): { passed: number; total: number } {
  return { passed: invariants.filter(entry => entry.status === 'ok').length, total: invariants.length }
}

/**
 * A fix button's label.
 * @param fix - the fix.
 * @returns the dictionary key and its parameters.
 */
export function fixLabel(fix: ReadinessFix): { key: EvalKey; params?: Record<string, string> } {
  switch (fix.kind) {
    case 'provision': return { key: 'fix.provision', params: { condition: fix.condition } }
    case 'endpoint': return { key: 'fix.endpoint', params: { condition: fix.condition } }
    case 'bind': return { key: 'fix.bind' }
    case 'agent': return { key: 'fix.agent' }
  }
}
