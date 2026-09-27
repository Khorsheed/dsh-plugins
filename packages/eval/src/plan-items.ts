/**
 * The design page's 用哪些题 table and 规模与花费 estimate (T83 · phase 4).
 *
 * Two reads the plan review could not make on its own, both over data other
 * modules own:
 *
 * - {@link planItemFacts} — per item, what it tests (item.json's title), how
 *   it is judged (the rubric's leaves by kind, and the check scripts that
 *   would run), its full score (Σ positive weights, the same weights the
 *   report's weighted score multiplies) and the player's task text. All of it
 *   through the structural {@link DatasetsFace}, the way the run loop reads
 *   the pinned dataset — never by importing the datasets package.
 * - {@link planEstimate} — what one rep of the plan costs, from the SAME
 *   groups' past answers to the SAME items: the delegations' active time and
 *   output tokens, the two numbers the report's efficiency table sums.
 *
 * Both degrade rather than throw: a missing face, an unreadable rubric or a
 * ledger that cannot list runs blanks a cell and says why, and «无估算» is an
 * answer, never a zero.
 * @module @khorsheed/dsh-eval
 */
import { collectProbes, pickRubricPath, registerEntriesOf } from './judge.ts'
import type { DatasetsFace, MissionRunListFace } from './faces.ts'
import { rubricWeightRows } from './weights.ts'
import type { EvalPlanEstimate, EvalPlanEstimateSample, EvalPlanItemFacts, EvalPlanItemsView } from './types.ts'

/** The task text crosses the wire whole up to this many characters. */
export const TASK_TEXT_CAP = 64 * 1024

/** A finished cell's states — the report's COMPLETED_STATES (halted is not finished). */
const COMPLETED = new Set(['judged', 'archived', 'releasable', 'released'])

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The item's task file among its visible paths: `task.md` first, else the shortest `.md`. */
export function pickTaskPath(visiblePaths: readonly string[]): string | null {
  const byLength = (a: string, b: string): number => a.length - b.length || (a < b ? -1 : 1)
  const task = visiblePaths.filter(path => /(?:^|\/)task\.md$/i.test(path)).sort(byLength)
  if (task[0] !== undefined) return task[0]
  return visiblePaths.filter(path => /\.md$/i.test(path)).sort(byLength)[0] ?? null
}

/** Rubric leaves by kind, and Σ positive weights. */
export function rubricFacts(rubricText: string, task: string): {
  criteria: NonNullable<EvalPlanItemFacts['criteria']>
  fullScore: number | null
} {
  const rows = rubricWeightRows(rubricText, task)
  const weighted = rows.filter(row => row.weight !== null && !row.negative)
  return {
    criteria: {
      total: rows.length,
      objective: rows.filter(row => row.kind === 'objective').length,
      judge: rows.filter(row => row.kind === 'llm-draft').length,
      human: rows.filter(row => row.kind === 'human').length,
    },
    fullScore: weighted.length === 0 ? null : weighted.reduce((sum, row) => sum + (row.weight ?? 0), 0),
  }
}

/**
 * Per-item facts for the plan's items, read from the pinned dataset.
 * @param input.datasets - the datasets face, or undefined (a composition without one).
 * @param input.repo - the registration's repository (the run loop's `env.repo`).
 * @param input.datasetId - the set the experiment pins.
 * @param input.commit - the pinned commit.
 * @param input.items - the plan's item ids, in plan order.
 * @returns one row per item (blank cells where a read failed) plus why.
 */
export async function planItemFacts(input: {
  datasets: DatasetsFace | undefined
  repo: string
  datasetId: string
  commit: string
  items: readonly string[]
}): Promise<EvalPlanItemsView> {
  const { datasets, repo, datasetId, commit, items } = input
  const notes = new Set<string>()
  const blank = (id: string): EvalPlanItemFacts => ({
    id, title: null, level: null, stages: 0, container: false, criteria: null, probes: 0, fullScore: null, task: null, taskPath: null,
  })
  if (datasets === undefined) {
    return { items: items.map(blank), notes: ['no datasets service is mounted, so the items cannot be read'] }
  }
  // The three layers the page speaks about, named EXPLICITLY — the bare scope
  // is the modelFacing floor, and the rubric and the probes are not on it.
  const scope = { repo, layers: ['visible', 'verify', 'grading'] as const }
  let shown: Awaited<ReturnType<DatasetsFace['show']>>
  try {
    shown = await datasets.show(scope, datasetId, undefined, commit)
  } catch (error) {
    return { items: items.map(blank), notes: [`the dataset could not be read: ${message(error)}`] }
  }
  const register = registerEntriesOf(shown.descriptor)
  const rows = await Promise.all(items.map(async (id): Promise<EvalPlanItemFacts> => {
    const item = shown.items.find(candidate => candidate.id === id)
    if (item === undefined) {
      notes.add(`item ${id} is not in the dataset at ${commit.slice(0, 7)}`)
      return blank(id)
    }
    const meta = isPlainObject(item.metadata) ? item.metadata : {}
    const taxonomy = isPlainObject(meta['taxonomy']) ? meta['taxonomy'] : {}
    const row: EvalPlanItemFacts = {
      ...blank(id),
      title: str(meta['title']),
      level: str(taxonomy['level']),
      stages: Array.isArray(meta['phasesUsed']) ? meta['phasesUsed'].length : 0,
      container: Array.isArray(meta['runIn']) && meta['runIn'].length > 0,
      probes: collectProbes({
        taskId: id,
        itemVerifyPaths: item.layers['verify'] ?? [],
        ...(shown.datasetLayers === undefined ? {} : { datasetVerifyPaths: shown.datasetLayers['verify'] ?? [] }),
        register,
      }).length,
    }
    const rubricPath = pickRubricPath(item.layers['grading'] ?? [])
    if (rubricPath === null) notes.add(`item ${id} ships no rubric in its grading layer`)
    else {
      try {
        const rubric = await datasets.read(scope, { dataset: datasetId, item: id, layer: 'grading', path: rubricPath, commit })
        const facts = rubricFacts(rubric.content, id)
        row.criteria = facts.criteria
        row.fullScore = facts.fullScore
      } catch (error) {
        notes.add(`the rubric of ${id} could not be read: ${message(error)}`)
      }
    }
    const taskPath = pickTaskPath(item.layers['visible'] ?? [])
    if (taskPath !== null) {
      try {
        const task = await datasets.read(scope, { dataset: datasetId, item: id, layer: 'visible', path: taskPath, commit })
        row.task = task.content.length > TASK_TEXT_CAP ? `${task.content.slice(0, TASK_TEXT_CAP)}\n\n…` : task.content
        row.taskPath = taskPath
      } catch (error) {
        notes.add(`the task text of ${id} could not be read: ${message(error)}`)
      }
    }
    return row
  }))
  return { items: rows, notes: [...notes] }
}

/** One cell's delegation totals over its current attempt, or null when it recorded none. */
function cellSpend(
  annotations: ReadonlyArray<{ ns: string; attempt: number; payload: unknown }>,
  attempt: number,
): { activeMs: number | null; outputTokens: number | null } | null {
  let delegations = 0
  let activeMs: number | null = null
  let outputTokens: number | null = null
  for (const annotation of annotations) {
    if (annotation.ns !== 'orchestrator' || annotation.attempt !== attempt) continue
    const entries = Array.isArray(annotation.payload) ? annotation.payload : [annotation.payload]
    for (const entry of entries) {
      if (!isPlainObject(entry) || entry['kind'] !== 'delegation') continue
      delegations += 1
      const duration = num(entry['durationMs'])
      if (duration !== null) activeMs = (activeMs ?? 0) + duration
      const usage = isPlainObject(entry['usage']) ? entry['usage'] : undefined
      const tokens = num(usage?.['outputTokens'])
      if (tokens !== null) outputTokens = (outputTokens ?? 0) + tokens
    }
  }
  return delegations === 0 ? null : { activeMs, outputTokens }
}

function mean(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length
}

/**
 * What one rep of the plan costs, from past answers of the same groups to the
 * same items. Every eval run in the ledger is a source; a cell counts once it
 * finished its stages, on its current attempt — the report's efficiency rule.
 * @param input.mission - the mission read face (listing runs is optional on it).
 * @param input.conditions - the plan's player groups.
 * @param input.items - the plan's items.
 * @returns the estimate, or null when some group has no past answer to any
 *   of the items (a partial sum would read as the whole cost).
 */
export function planEstimate(input: {
  mission: MissionRunListFace | undefined
  conditions: readonly string[]
  items: readonly string[]
}): EvalPlanEstimate | null {
  const { mission, conditions, items } = input
  if (mission === undefined || typeof mission.runList !== 'function' || conditions.length === 0 || items.length === 0) return null
  let ids: ReadonlyArray<{ id: string }>
  try {
    ids = mission.runList()
  } catch {
    return null
  }
  const samples: EvalPlanEstimateSample[] = []
  for (const { id: runId } of ids) {
    let status: ReturnType<MissionRunListFace['runStatus']>
    try {
      status = mission.runStatus(runId)
    } catch {
      continue
    }
    if (status.run.meta['evalVersion'] === undefined) continue
    for (const row of status.rows) {
      const condition = row.labels['condition']
      const task = row.labels['task']
      if (condition === undefined || task === undefined) continue
      if (!conditions.includes(condition) || !items.includes(task) || !COMPLETED.has(row.state)) continue
      let spend: ReturnType<typeof cellSpend> = null
      try {
        const record = mission.get(row.id, runId).mission
        spend = cellSpend(record.annotations, record.currentAttempt ?? row.currentAttempt)
      } catch {
        continue
      }
      if (spend !== null) samples.push({ runId, condition, task, ...spend })
    }
  }
  // Per field, so a ledger that timed the rounds but never counted tokens
  // still estimates the time.
  const perRepOf = (field: 'activeMs' | 'outputTokens'): number | null => {
    let total = 0
    for (const condition of conditions) {
      const own = samples.filter(sample => sample.condition === condition && sample[field] !== null)
      const fallback = mean(own.map(sample => sample[field] as number))
      if (fallback === null) return null
      for (const item of items) {
        total += mean(own.filter(sample => sample.task === item).map(sample => sample[field] as number)) ?? fallback
      }
    }
    return total
  }
  const perRep = { activeMs: perRepOf('activeMs'), outputTokens: perRepOf('outputTokens') }
  if (perRep.activeMs === null && perRep.outputTokens === null) return null
  return { perRep, samples }
}
