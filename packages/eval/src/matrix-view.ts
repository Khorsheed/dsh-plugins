/**
 * The MATRIX page's pivot: a run's cells arranged the way a person compares
 * them (ui-spec §五) — rows are always the task, the column is the ONE factor
 * the reader picked, and every other factor is either a grouping band or a
 * pinned filter.
 *
 * Rows are the task and never anything else on purpose. A comparison is "the
 * same question, asked of different subjects"; letting the reader put tasks on
 * the columns would let them line up two different questions and read the
 * difference as a result. The factor set is not invented here either — it is
 * exactly the union of the paths the run's own condition documents disagree
 * on, computed by the same leaf comparison `conditions diff` uses.
 *
 * Everything in this module is PURE: cells in, view model out. The ledger read
 * that produces the cells lives in `read.ts`, the file read that produces the
 * materialization hashes lives in the service, and the rendering lives in the
 * browser half — so the arrangement rule is unit-testable on its own, which is
 * the only way "why is this cell red" ever gets a straight answer.
 * @module @khorsheed/dsh-eval
 */
import { canonicalJson } from './hash.ts'
import { conditionFactors, conditionLeaves } from './read.ts'
import { isJudgedOrBeyond } from './experiments.ts'
import type {
  EvalMatrixCell, EvalMatrixColumn, EvalMatrixFactorValues, EvalMatrixGroup, EvalMatrixRep,
  EvalMatrixRow, EvalMatrixSummary, EvalMatrixView, EvalRepDot,
} from './types.ts'

/**
 * How long a cell may sit in one state before the matrix flags it. Thirty
 * minutes is the default because it is longer than any healthy stage round
 * this line has recorded and shorter than a human's patience; the caller can
 * set another.
 */
export const DEFAULT_STUCK_MS = 30 * 60 * 1000

/** The key a condition with no value at all for a factor gets (absent is not null). */
const ABSENT = '\u0000absent'

/** The separator between two grouping factors in a band label. */
const GROUP_SEPARATOR = ' · '

/** One cell as the pivot reads it — the ledger projection plus the two hashes. */
export interface MatrixInputCell {
  missionId: string
  task: string | null
  condition: string | null
  rep: number | null
  state: string
  bucket: string
  /** How long the cell has been in its current state; null when the ledger does not say. */
  inStateMs: number | null
  /** The `materialization.json` digest of the current attempt; null when unread. */
  materializationSha: string | null
  /** The current attempt's `refs.fingerprint` (the environment CLASS). */
  fingerprint: string | null
}

/** What {@link pivotMatrix} needs. */
export interface MatrixInput {
  runId: string
  /** The run's player conditions, with their declarations (from run.meta). */
  conditions: ReadonlyArray<{ id: string; document: unknown }>
  cells: readonly MatrixInputCell[]
  /** Cells holding a resource they have not released — mission's leak warning. */
  unreleased?: readonly string[]
  /** The factor to put on the columns; absent takes the first factor. */
  column?: string
  /** Remaining factors pinned to one canonical value each — the filter. */
  filter?: Readonly<Record<string, string>>
  /** Remaining factors to band the rows by; absent groups by none. */
  groupBy?: readonly string[]
  /** The stuck threshold; default {@link DEFAULT_STUCK_MS}. */
  stuckMs?: number
  /**
   * The judge-consistency line, when a report has already been produced.
   * Absent prints 「待报告」rather than a number: consistency is the report's
   * computation, and a matrix that guessed at it would be believed.
   */
  judgeConsistency?: string
}

/** A condition's value for one factor path, canonical so it keys a map. */
function valueKey(leaves: Map<string, unknown>, path: string): string {
  return leaves.has(path) ? canonicalJson(leaves.get(path)) : ABSENT
}

/** The human label of a canonical factor value. */
function valueLabel(key: string): string {
  if (key === ABSENT) return '—'
  try {
    const parsed: unknown = JSON.parse(key)
    return typeof parsed === 'string' ? parsed : key
  } catch {
    /* v8 ignore next -- canonicalJson always emits parseable JSON */
    return key
  }
}

/** The dot one rep gets: solid past judged, hollow before anything started, half otherwise. */
export function repDot(state: string): EvalRepDot {
  if (isJudgedOrBeyond(state)) return 'filled'
  if (state === 'pending') return 'empty'
  return 'half'
}

/**
 * The task's reference materialization hash: the most frequent one, ties
 * broken by sort order so the same ledger always paints the same cell red.
 */
function referenceSha(shas: readonly string[]): string | null {
  const counts = new Map<string, number>()
  for (const sha of shas) counts.set(sha, (counts.get(sha) ?? 0) + 1)
  let best: string | null = null
  let bestCount = 0
  for (const sha of [...counts.keys()].sort()) {
    const count = counts.get(sha) as number
    if (count > bestCount) {
      best = sha
      bestCount = count
    }
  }
  return best
}

/** The stage line of a group of reps: the state they agree on, else `mixed`. */
function stageOf(reps: readonly EvalMatrixRep[]): string {
  const states = [...new Set(reps.map(rep => rep.state))]
  if (states.length === 0) return '—'
  return states.length === 1 ? (states[0] as string) : `mixed (${states.sort().join(' / ')})`
}

/**
 * Arrange one run's cells into the matrix view ui-spec §五 fixes.
 *
 * The factor set is the union of the paths the conditions disagree on. One
 * factor means one column and no choice to make; several mean the caller picks
 * which is the column, and the rest are pinned (`filter`) or banded
 * (`groupBy`) — a factor that is neither simply rides along inside the cell,
 * whose condition list then names more than one id, and that is visible rather
 * than hidden.
 * @param input - the conditions, the cells, and the reader's arrangement.
 * @returns the rows, columns, groups and the run-level footer.
 */
export function pivotMatrix(input: MatrixInput): EvalMatrixView {
  const stuckMs = input.stuckMs ?? DEFAULT_STUCK_MS
  const factors = conditionFactors(input.conditions.map(entry => entry.document))
  const leavesById = new Map<string, Map<string, unknown>>()
  for (const entry of input.conditions) leavesById.set(entry.id, conditionLeaves(entry.document))

  const column = input.column !== undefined && factors.includes(input.column)
    ? input.column
    : factors[0] ?? null
  const groupBy = (input.groupBy ?? []).filter(path => factors.includes(path) && path !== column)
  const filter = input.filter ?? {}

  // A condition survives the filter when every pinned factor matches it. A
  // condition run.meta does not carry (a ledger gap) is never filtered out on
  // a value it cannot have — it rides along instead.
  const keep = (conditionId: string): boolean => {
    const leaves = leavesById.get(conditionId)
    if (leaves === undefined) return true
    return Object.entries(filter).every(([path, want]) => path === column || valueKey(leaves, path) === want)
  }

  const kept = input.cells.filter(cell => cell.condition === null || keep(cell.condition))

  // Columns: the distinct values of the column factor over the conditions the
  // filter kept. No factor at all means one nameless column — a single-
  // condition run still has a matrix, it just has nothing to compare.
  const columnKeys: string[] = []
  const columnConditions = new Map<string, string[]>()
  for (const entry of input.conditions) {
    if (!keep(entry.id)) continue
    const key = column === null ? '' : valueKey(leavesById.get(entry.id) as Map<string, unknown>, column)
    if (!columnConditions.has(key)) {
      columnConditions.set(key, [])
      columnKeys.push(key)
    }
    columnConditions.get(key)?.push(entry.id)
  }
  columnKeys.sort()
  const columns: EvalMatrixColumn[] = columnKeys.map(key => ({
    key,
    label: column === null ? '全部' : valueLabel(key),
    conditions: (columnConditions.get(key) ?? []).slice().sort(),
  }))

  // The per-task reference hash, over the cells the filter kept.
  const shasByTask = new Map<string, string[]>()
  for (const cell of kept) {
    if (cell.materializationSha === null) continue
    const task = cell.task ?? `mission:${cell.missionId}`
    if (!shasByTask.has(task)) shasByTask.set(task, [])
    shasByTask.get(task)?.push(cell.materializationSha)
  }
  const referenceByTask = new Map<string, string | null>()
  for (const [task, shas] of shasByTask) referenceByTask.set(task, referenceSha(shas))

  const columnOf = (conditionId: string | null): string => {
    if (column === null || conditionId === null) return columnKeys[0] ?? ''
    const leaves = leavesById.get(conditionId)
    return leaves === undefined ? (columnKeys[0] ?? '') : valueKey(leaves, column)
  }
  const groupKeyOf = (conditionId: string | null): string => {
    if (groupBy.length === 0 || conditionId === null) return ''
    const leaves = leavesById.get(conditionId)
    if (leaves === undefined) return ''
    return groupBy.map(path => `${path}=${valueKey(leaves, path)}`).join(GROUP_SEPARATOR)
  }
  const groupLabelOf = (conditionId: string | null): string => {
    if (groupBy.length === 0 || conditionId === null) return ''
    const leaves = leavesById.get(conditionId)
    if (leaves === undefined) return ''
    return groupBy.map(path => `${path} ${valueLabel(valueKey(leaves, path))}`).join(GROUP_SEPARATOR)
  }

  // group key -> task -> column key -> the reps that landed there.
  const buckets = new Map<string, Map<string, Map<string, EvalMatrixRep[]>>>()
  const groupLabels = new Map<string, string>()
  const groupOrder: string[] = []
  const taskOrder: string[] = []
  let stuckTotal = 0
  for (const cell of kept) {
    const task = cell.task ?? `mission:${cell.missionId}`
    const groupKey = groupKeyOf(cell.condition)
    const columnKey = columnOf(cell.condition)
    if (!buckets.has(groupKey)) {
      buckets.set(groupKey, new Map())
      groupLabels.set(groupKey, groupLabelOf(cell.condition))
      groupOrder.push(groupKey)
    }
    const byTask = buckets.get(groupKey) as Map<string, Map<string, EvalMatrixRep[]>>
    if (!byTask.has(task)) byTask.set(task, new Map())
    if (!taskOrder.includes(task)) taskOrder.push(task)
    const byColumn = byTask.get(task) as Map<string, EvalMatrixRep[]>
    if (!byColumn.has(columnKey)) byColumn.set(columnKey, [])
    // A settled cell is never stuck: the counter keeps running on it (that is
    // mission's own duration column), but "nothing has happened here for a
    // while" stops being a problem once nothing further is due.
    const stuck = cell.inStateMs !== null && cell.inStateMs > stuckMs && !isJudgedOrBeyond(cell.state)
    if (stuck) stuckTotal += 1
    byColumn.get(columnKey)?.push({
      rep: cell.rep,
      missionId: cell.missionId,
      condition: cell.condition,
      dot: repDot(cell.state),
      state: cell.state,
      bucket: cell.bucket,
      stuck,
      inStateMs: cell.inStateMs,
    })
  }

  const shaByMission = new Map(kept.map(cell => [cell.missionId, cell.materializationSha] as const))
  const groups: EvalMatrixGroup[] = groupOrder.sort().map((groupKey) => {
    const byTask = buckets.get(groupKey) as Map<string, Map<string, EvalMatrixRep[]>>
    const rows: EvalMatrixRow[] = taskOrder.slice().sort().flatMap((task) => {
      const byColumn = byTask.get(task)
      if (byColumn === undefined) return []
      const reference = referenceByTask.get(task) ?? null
      const cells: Array<EvalMatrixCell | null> = columns.map((columnHeader) => {
        const reps = byColumn.get(columnHeader.key)
        if (reps === undefined || reps.length === 0) return null
        reps.sort((a, b) => (a.rep ?? 0) - (b.rep ?? 0))
        const known = reps
          .map(rep => shaByMission.get(rep.missionId) ?? null)
          .filter((sha): sha is string => sha !== null)
        return {
          task,
          column: columnHeader.key,
          conditions: [...new Set(reps.map(rep => rep.condition).filter((id): id is string => id !== null))].sort(),
          reps,
          stage: stageOf(reps),
          stuck: reps.some(rep => rep.stuck),
          // The red edge: this cell's material differs from the rest of its
          // ROW. Unknown is not a mismatch — it is reported as unknown.
          hashMismatch: reference !== null && known.length > 0 && known.some(sha => sha !== reference),
          hashUnknown: known.length === 0,
        }
      })
      return [{ task, cells }]
    })
    return { key: groupKey, label: groupLabels.get(groupKey) ?? '', rows }
  })

  // Every factor's value set, so the filter can offer what it may pin without
  // the browser half having to re-derive it from the condition documents (it
  // does not have them — ui-spec R2 keeps the projection on this side).
  const factorValues: EvalMatrixFactorValues[] = factors.map((factor) => {
    const byValue = new Map<string, string[]>()
    for (const entry of input.conditions) {
      const key = valueKey(leavesById.get(entry.id) as Map<string, unknown>, factor)
      if (!byValue.has(key)) byValue.set(key, [])
      byValue.get(key)?.push(entry.id)
    }
    return {
      factor,
      values: [...byValue.keys()].sort().map(key => ({
        key,
        label: valueLabel(key),
        conditions: (byValue.get(key) ?? []).slice().sort(),
      })),
    }
  })

  return {
    runId: input.runId,
    factors,
    factorValues,
    column,
    groupBy,
    filter: { ...filter },
    columns,
    groups,
    summary: summarize(kept, referenceByTask, input.unreleased ?? [], stuckTotal, input.judgeConsistency ?? null),
    stuckMs,
  }
}

/** The run-level footer ui-spec §五 asks for, in the report's own vocabulary. */
function summarize(
  cells: readonly MatrixInputCell[],
  referenceByTask: ReadonlyMap<string, string | null>,
  unreleased: readonly string[],
  stuck: number,
  judgeConsistency: string | null,
): EvalMatrixSummary {
  const withSha = cells.filter(cell => cell.materializationSha !== null)
  let materialization: EvalMatrixSummary['materialization']
  if (withSha.length === 0) {
    materialization = { status: 'unverifiable', detail: '没有可读的物化哈希——无法核验' }
  } else {
    const bad = [...referenceByTask.entries()].filter(([task, reference]) => (
      reference !== null
      && withSha.some(cell => (cell.task ?? `mission:${cell.missionId}`) === task && cell.materializationSha !== reference)
    ))
    materialization = bad.length === 0
      ? { status: 'ok', detail: `${referenceByTask.size} 道题各自一致` }
      : { status: 'violated', detail: `${bad.length} 道题出现不同物化哈希：${bad.map(([task]) => task).join(', ')}` }
  }

  const fingerprints = [...new Set(cells.map(cell => cell.fingerprint).filter((fp): fp is string => fp !== null))]
  const missing = cells.filter(cell => cell.fingerprint === null).length
  let fingerprint: EvalMatrixSummary['fingerprint']
  if (fingerprints.length === 0) {
    fingerprint = { status: 'unverifiable', detail: '本 run 无环境指纹（宿主路径的 run 不记）' }
  } else if (missing > 0) {
    fingerprint = { status: 'violated', detail: `${missing}/${cells.length} 格未记录指纹，其余已记录——记录不一致` }
  } else if (fingerprints.length > 1) {
    fingerprint = {
      status: 'violated',
      detail: `出现 ${fingerprints.length} 个不同指纹：${fingerprints.map(fp => `${fp.slice(0, 12)}…`).join(' / ')}`,
    }
  } else {
    fingerprint = { status: 'ok', detail: `${(fingerprints[0] as string).slice(0, 16)}… × ${cells.length} 格` }
  }

  return {
    materialization,
    fingerprint,
    unreleased: unreleased.length,
    judgeConsistency,
    stuck,
    cells: cells.length,
  }
}
