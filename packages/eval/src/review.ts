/**
 * The lab tab's PLAN-REVIEW and CONDITIONS projections — step 3 and step 4 of
 * the eight-step flow (ui-spec §七).
 *
 * Both are pure functions over data other modules own: `validatePlan`'s
 * diagnostics and the plan document for the review, `listConditions` /
 * `diffConditions` for the registry. Nothing here validates anything itself —
 * that is the whole point. The review page and `dsh-eval validate` must never
 * be able to disagree about whether a plan is approvable, so the page shows
 * the SAME function's output, rearranged for reading rather than re-derived.
 *
 * The rearrangement is the one thing this module decides: a flat list of
 * `ok / warn / error` lines, errors first. A reviewer's question is "may I
 * approve this, and what am I approving" — errors answer the first, and the
 * `ok` lines answer the second, because a review page that only renders
 * problems shows a clean plan as an empty page.
 * @module @khorsheed/dsh-eval
 */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { canonicalJson } from './hash.ts'
import type { ConditionDiff, ConditionsReport } from './read.ts'
import type { ProvisionReport } from './provision.ts'
import { expandHome, validatePlan, type ConditionResolution, type EvalDiagnostic } from './validate.ts'
import type {
  EvalConditionDiffView, EvalConditionRow, EvalConditionsView, EvalExperimentUnit,
  EvalPlanCheck, EvalPlanCondition, EvalPlanDigest, EvalPlanReview,
} from './types.ts'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' ? value : null
}

function boolOrNull(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

/** The container segment of a plan document, structurally. */
function unitOf(value: unknown): EvalExperimentUnit | null {
  if (!isPlainObject(value)) return null
  const image = stringOrNull(value['image'])
  if (image === null) return null
  return { image, network: stringOrNull(value['network']), user: stringOrNull(value['user']) }
}

/** The plan's own fields, read structurally — an invalid plan still shows what it says. */
function digestOf(plan: Record<string, unknown>): EvalPlanDigest {
  const dataset = isPlainObject(plan['dataset']) ? plan['dataset'] : undefined
  const judge = isPlainObject(plan['judge']) ? plan['judge'] : undefined
  const order = isPlainObject(plan['order']) ? plan['order'] : undefined
  const budget = isPlainObject(plan['budget']) ? plan['budget'] : undefined
  const retry = isPlainObject(plan['retry']) ? plan['retry'] : undefined
  return {
    dataset: {
      repo: stringOrNull(dataset?.['repo']),
      id: stringOrNull(dataset?.['id']),
      commit: stringOrNull(dataset?.['commit']),
    },
    items: stringArray(dataset?.['items']),
    conditions: stringArray(plan['conditions']),
    judge: {
      conditions: stringArray(judge?.['conditions']),
      samples: numberOrNull(judge?.['samples']),
    },
    reps: numberOrNull(plan['reps']),
    stages: stringArray(plan['stages']),
    order: { seed: numberOrNull(order?.['seed']), interleave: boolOrNull(order?.['interleave']) },
    budget: budget === undefined
      ? null
      : { activeMinutes: numberOrNull(budget['activeMinutes']), turns: numberOrNull(budget['turns']) },
    expectedNs: stringArray(plan['expectedNs']),
    retryInfrastructure: numberOrNull(retry?.['infrastructure']),
    exports: stringOrNull(plan['exports']),
    unit: unitOf(plan['unit']),
    notes: stringOrNull(plan['notes']),
  }
}

/** One resolved condition, as a review row. */
function conditionRow(entry: ConditionResolution, role: 'player' | 'judge'): EvalPlanCondition {
  return {
    id: entry.id,
    role,
    sha: entry.sha,
    status: entry.status,
    lock: {
      present: entry.lock !== null,
      matches: entry.lock !== null && entry.sha !== null && entry.lock.sha === entry.sha,
      homeSha: entry.lock?.homeSha ?? null,
    },
  }
}

/** The `ok` line one resolved condition earns; unready ones already have a diagnostic. */
function readyCheck(entry: ConditionResolution, role: 'player' | 'judge'): EvalPlanCheck[] {
  if (entry.status !== 'ready') return []
  const prefix = role === 'judge' ? 'judge condition' : 'condition'
  return [{
    severity: 'ok',
    code: 'CONDITION_READY',
    message: `${prefix} ${entry.id} is ready — the lock matches its declaration${entry.lock?.homeSha === undefined ? '' : ' and its scoped home is hashed'}`,
  }]
}

function checkOf(severity: 'warn' | 'error') {
  return (diagnostic: EvalDiagnostic): EvalPlanCheck => ({ severity, code: diagnostic.code, message: diagnostic.message })
}

/**
 * The plan-review page's payload: what the plan says, and what validate makes
 * of it, line by line.
 *
 * The `ok` lines are the resolved conditions rather than a single synthetic
 * "no problems found": a reviewer approving a comparison is deciding about
 * SUBJECTS, and "cond-a is ready, cond-b is ready" is the fact worth reading.
 * @param planPath - path to a `dataseek.plan/1` document (`~` expanded).
 * @returns the digest, the flat check list, and every condition the plan names.
 */
export async function reviewPlan(planPath: string): Promise<EvalPlanReview> {
  const planAbs = resolve(expandHome(planPath))
  const validation = await validatePlan(planAbs)
  let document: unknown
  try {
    document = JSON.parse(await readFile(planAbs, 'utf8')) as unknown
  } catch {
    // validate already reported PLAN_UNREADABLE / PLAN_MALFORMED as an error;
    // a second sentence about the same file would only add noise.
    document = undefined
  }
  const checks: EvalPlanCheck[] = [
    ...validation.errors.map(checkOf('error')),
    ...validation.warnings.map(checkOf('warn')),
    ...validation.conditions.flatMap(entry => readyCheck(entry, 'player')),
    ...validation.judges.flatMap(entry => readyCheck(entry, 'judge')),
  ]
  return {
    planPath: validation.planPath,
    schema: validation.schema,
    ok: validation.ok,
    errors: validation.errors.length,
    warnings: validation.warnings.length,
    digest: isPlainObject(document) ? digestOf(document) : null,
    checks,
    conditions: [
      ...validation.conditions.map(entry => conditionRow(entry, 'player')),
      ...validation.judges.map(entry => conditionRow(entry, 'judge')),
    ],
  }
}

/**
 * One provision's report as the SAME flat `ok / warn / error` list the
 * plan-review page draws — the field-by-field verdicts first, then the
 * diagnostics provision raised.
 *
 * The shared shape is the point: a person reading «why is this condition not
 * ready» on the conditions page and on the plan-review page is asking one
 * question, and two renderings of one answer drift.
 * @param report - what `conditions provision` produced.
 * @returns the lines, most decisive first.
 */
export function provisionChecks(report: ProvisionReport): EvalPlanCheck[] {
  return [
    ...report.errors.map(checkOf('error')),
    ...report.checks.map((row): EvalPlanCheck => ({
      // `severity: null` is a field that AGREES; it earns an ok line because a
      // page that only renders problems shows a clean provision as an empty one.
      severity: row.severity === 'error' ? 'error' : row.severity === 'warning' ? 'warn' : 'ok',
      code: row.status === 'match' ? 'EFFECTIVE_MATCH' : row.status === 'unknown' ? 'EFFECTIVE_UNCOMPARABLE' : 'EFFECTIVE_MISMATCH',
      message: `${row.field}: ${row.detail}`,
    })),
    ...report.warnings.map(checkOf('warn')),
  ]
}

/** The conditions page's table, projected from the registry listing. */
export function conditionsView(report: ConditionsReport): EvalConditionsView {
  const rows: EvalConditionRow[] = report.conditions.map(condition => ({
    id: condition.id,
    dataset: condition.dataset,
    harness: condition.harness.name,
    drive: condition.harness.drive,
    model: condition.model.declared,
    endpoint: condition.model.endpoint,
    scope: condition.scope,
    preset: condition.preset,
    sha: condition.sha,
    lock: {
      present: condition.lock.present,
      matches: condition.lock.matches,
      homeSha: condition.lock.homeSha,
      provisionedAt: condition.lock.provisioned?.at ?? null,
      cliVersion: condition.lock.provisioned?.cliVersion ?? null,
    },
    status: condition.status,
    unresolved: condition.unresolved,
    errors: condition.errors.map(diagnostic => diagnostic.message),
    warnings: condition.warnings.map(diagnostic => diagnostic.message),
  }))
  return { repo: report.repo, datasets: report.datasets, rows }
}

/** Canonical JSON text of one side of a field diff; null means the field is absent there. */
function sideText(has: boolean, value: unknown): string | null {
  return has ? canonicalJson(value) : null
}

/**
 * The conditions page's diff. Carries ONLY the differing fields — the page
 * highlights differences, and a table that also listed the agreements would
 * bury the one thing it exists to show.
 * @param diff - what `conditions diff` computed.
 */
export function conditionDiffView(diff: ConditionDiff): EvalConditionDiffView {
  return {
    a: { id: diff.a.id, path: diff.a.path, sha: diff.a.sha },
    b: { id: diff.b.id, path: diff.b.path, sha: diff.b.sha },
    identical: diff.identical,
    notesOnly: diff.notesOnly,
    differences: diff.differences.map(difference => ({
      path: difference.path,
      a: sideText('a' in difference, difference.a),
      b: sideText('b' in difference, difference.b),
    })),
  }
}
