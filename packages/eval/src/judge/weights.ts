/**
 * Rubric polarity and weights — the derived table a bundle carries.
 *
 * The verdict contract (`dataseek.verdict/1`, protocol §6.5) has exactly one
 * boolean, `pass`, and it always means **the criterion holds**. A NEGATIVE
 * criterion states a defect ("tradeoff 出现 worth-the-cost"), so `pass: true`
 * on it means the defect is present. Polarity is therefore not in the verdict
 * — it is a property of the criterion, and its single source is the rubric
 * leaf: `negative: true` (a negative `weight` is the equivalent statement;
 * `dsh-eval validate` is where a disagreement between the two becomes an
 * error). Probes and judges never invert; the report does the arithmetic.
 *
 * A rubric lives in the `grading` layer, which a run's automatic export
 * deliberately never includes (the leak gate is right). So the export
 * DERIVES this table from the grading layer and writes it into the bundle's
 * `report/` directory: task, criterion id, weight, negative, kind, axis —
 * numbers and identifiers only. The criterion text, its evidence pointer and
 * every note stay behind; nothing here tells a reader what the question is,
 * which is why the derived table does not need the human gate the layer
 * itself does.
 * @module @khorsheed/dsh-eval
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import yaml from 'js-yaml'

/** The derived table's schema id. */
export const RUBRIC_WEIGHTS_SCHEMA = 'dataseek.rubric-weights/1'
/** Bundle-relative path of the derived table. */
export const RUBRIC_WEIGHTS_PATH = 'report/rubric-weights.json'

/**
 * One rubric leaf reduced to what a report needs. Deliberately WITHOUT
 * `criterion` and `evidence`: those are the grading layer's content, and the
 * whole point of the derived table is that it carries none of it.
 */
export interface RubricWeightRow {
  task: string
  /** The rubric leaf id — the same string a verdict's `criterion` carries. */
  id: string
  /** Relative importance; negative for a negative criterion. Null when the leaf declares none. */
  weight: number | null
  /** True when the criterion states a DEFECT: holding it costs points. */
  negative: boolean
  /** `objective` / `llm-draft` / `human`; null when the leaf declares none. */
  kind: string | null
  /** The dimension sub-axis this leaf scores under; null when undeclared. */
  axis: string | null
  /**
   * The stages whose output this leaf judges (see {@link leafStages}); null
   * when the leaf binds to no stage and therefore applies to every run.
   * Absent on tables written before T84 — read as null.
   */
  stages?: string[] | null
}

/** The derived table as written into a bundle. */
export interface RubricWeightTable {
  schema: typeof RUBRIC_WEIGHTS_SCHEMA
  /** Dataset id and commit the rubrics were read at (provenance, not identity). */
  dataset: string | null
  commit: string | null
  /** Tasks whose rubric was read — a task absent here shipped none. */
  tasks: string[]
  criteria: RubricWeightRow[]
  /**
   * The run plan's `stages` when the table was derived — the scope a report
   * scores against. Null/absent (old tables, plans without stages) means
   * every criterion is in scope.
   */
  planStages?: string[] | null
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * The polarity a rubric leaf declares. `negative: true` is the primary
 * statement and a negative weight is the equivalent one; either alone is
 * accepted here so a table derived from a half-annotated rubric is still
 * honest. Making the two agree is `validate`'s job, not this reader's.
 */
function polarityOf(row: Record<string, unknown>, weight: number | null): boolean {
  return row['negative'] === true || (weight !== null && weight < 0)
}

const STAGE_FILE_RE = /\b(stage\d+)\.(?:json|md)\b/g
const VERIFY_FILE_RE = /\bverify\.json\b/

function stringList(value: unknown): string[] | null {
  if (typeof value === 'string' && value !== '') return [value]
  if (!Array.isArray(value)) return null
  const list = value.filter((v): v is string => typeof v === 'string' && v !== '')
  return list.length === 0 ? null : list
}

/**
 * The stages a rubric leaf judges. The rubric protocol has no stage field on
 * leaves, so this is derived, in order:
 *   1. an explicit leaf `stages` (list) or `stage` (string) wins;
 *   2. otherwise the stage artefacts its `evidence` names (`stage1.json`,
 *      `stage2.md`, …);
 *   3. otherwise evidence reading the cell's `verify.json` binds to the
 *      item's `runIn` (the stages that produce the implementation);
 *   4. otherwise null — the leaf binds to no stage (a veto, a repo probe)
 *      and applies to every run.
 * @param leaf - the raw rubric leaf.
 * @param runIn - the item's `runIn` stages, when known.
 * @returns the sorted, de-duplicated stage list, or null.
 */
export function leafStages(leaf: Record<string, unknown>, runIn?: readonly string[] | null): string[] | null {
  const explicit = stringList(leaf['stages']) ?? stringList(leaf['stage'])
  if (explicit !== null) return [...new Set(explicit)].sort()
  const evidence = typeof leaf['evidence'] === 'string' ? leaf['evidence'] : ''
  const named = [...evidence.matchAll(STAGE_FILE_RE)].map(m => m[1] as string)
  if (named.length > 0) return [...new Set(named)].sort()
  if (VERIFY_FILE_RE.test(evidence) && runIn !== undefined && runIn !== null && runIn.length > 0) {
    return [...new Set(runIn)].sort()
  }
  return null
}

/**
 * Whether a leaf is in a run's stage scope: a plan without stages scores
 * everything, a leaf bound to no stage always applies, otherwise every stage
 * the leaf judges must be one this run executes (a leaf that also needs a
 * stage the run skipped has nothing complete to judge).
 * @param stages - the leaf's stages ({@link leafStages}).
 * @param planStages - the plan's `stages`.
 * @returns true when the leaf is scored in this run.
 */
export function inStageScope(stages: readonly string[] | null | undefined, planStages: readonly string[] | null | undefined): boolean {
  if (planStages === null || planStages === undefined || planStages.length === 0) return true
  if (stages === null || stages === undefined || stages.length === 0) return true
  return stages.every(s => planStages.includes(s))
}

/**
 * Reduce one rubric document to its weight/polarity rows.
 *
 * Tolerant by design — a leaf missing `weight`, `kind` or `axis` still
 * produces a row (with nulls), because its POLARITY is the load-bearing fact
 * and a missing weight only blanks the weighted column.
 * @param rubricText - the rubric YAML as read from the grading layer.
 * @param task - the task id to stamp on every row; falls back to the
 *   document's own `task_id` / `task` / `id` when omitted.
 * @param options - `runIn`: the item's implementation stages, used to bind
 *   `verify.json` evidence to a stage (see {@link leafStages}).
 * @returns one row per leaf carrying an id, in document order.
 * @throws Error when the document does not parse as YAML.
 */
export function rubricWeightRows(rubricText: string, task?: string, options?: { runIn?: readonly string[] | null }): RubricWeightRow[] {
  const doc = yaml.load(rubricText)
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) return []
  const record = doc as Record<string, unknown>
  const taskId = task ?? str(record['task_id']) ?? str(record['task']) ?? str(record['id'])
  if (taskId === null) return []
  const items = Array.isArray(record['items']) ? record['items'] : []
  const rows: RubricWeightRow[] = []
  for (const raw of items) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) continue
    const row = raw as Record<string, unknown>
    const id = str(row['id'])
    if (id === null) continue
    const weight = num(row['weight'])
    rows.push({
      task: taskId,
      id,
      weight,
      negative: polarityOf(row, weight),
      kind: str(row['kind']),
      axis: str(row['axis']),
      stages: leafStages(row, options?.runIn),
    })
  }
  return rows
}

/**
 * Assemble the derived table from per-task rubric texts. A task whose rubric
 * yields no rows is reported as absent rather than as empty — «不写空文件、
 * 不写空注解» applies to the table's own task list too.
 * @param input - the rubric text per task, plus the snapshot provenance.
 * @returns the table; `criteria` is empty when no rubric yielded a row.
 */
export function buildRubricWeightTable(input: {
  dataset?: string | null
  commit?: string | null
  rubrics: ReadonlyArray<{ task: string; rubricText: string; runIn?: readonly string[] | null }>
  planStages?: readonly string[] | null
}): RubricWeightTable {
  const criteria: RubricWeightRow[] = []
  const tasks: string[] = []
  for (const entry of input.rubrics) {
    const rows = rubricWeightRows(entry.rubricText, entry.task, { runIn: entry.runIn ?? null })
    if (rows.length === 0) continue
    tasks.push(entry.task)
    criteria.push(...rows)
  }
  return {
    schema: RUBRIC_WEIGHTS_SCHEMA,
    dataset: input.dataset ?? null,
    commit: input.commit ?? null,
    tasks: [...new Set(tasks)].sort(),
    criteria,
    planStages: input.planStages === undefined || input.planStages === null ? null : [...input.planStages],
  }
}

/**
 * Write the derived table into a bundle (`report/rubric-weights.json`).
 * A table with no criteria is NOT written: an empty file would claim the
 * polarity is known and every criterion positive.
 * @param bundleDir - the bundle directory.
 * @param table - the derived table.
 * @returns the file path, or null when nothing was written.
 */
export async function writeRubricWeightTable(bundleDir: string, table: RubricWeightTable): Promise<string | null> {
  if (table.criteria.length === 0) return null
  const path = join(bundleDir, RUBRIC_WEIGHTS_PATH)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(table, null, 2)}\n`, 'utf8')
  return path
}

/**
 * Read a bundle's derived table. Absent, unreadable, or not a
 * `dataseek.rubric-weights/1` document → null, and the report degrades to
 * counts with the polarity declared unknown.
 * @param bundleDir - the bundle directory.
 * @returns the table, or null.
 */
export async function readRubricWeightTable(bundleDir: string): Promise<RubricWeightTable | null> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(join(bundleDir, RUBRIC_WEIGHTS_PATH), 'utf8'))
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  const record = parsed as Record<string, unknown>
  if (record['schema'] !== RUBRIC_WEIGHTS_SCHEMA || !Array.isArray(record['criteria'])) return null
  const criteria: RubricWeightRow[] = []
  for (const raw of record['criteria']) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) continue
    const row = raw as Record<string, unknown>
    const task = str(row['task'])
    const id = str(row['id'])
    if (task === null || id === null) continue
    criteria.push({
      task,
      id,
      weight: num(row['weight']),
      negative: row['negative'] === true,
      kind: str(row['kind']),
      axis: str(row['axis']),
      stages: Array.isArray(row['stages']) ? row['stages'].filter((t): t is string => typeof t === 'string') : null,
    })
  }
  if (criteria.length === 0) return null
  return {
    schema: RUBRIC_WEIGHTS_SCHEMA,
    dataset: str(record['dataset']),
    commit: str(record['commit']),
    tasks: Array.isArray(record['tasks']) ? record['tasks'].filter((t): t is string => typeof t === 'string') : [],
    criteria,
    planStages: Array.isArray(record['planStages']) ? record['planStages'].filter((t): t is string => typeof t === 'string') : null,
  }
}
