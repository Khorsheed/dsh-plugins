/**
 * The offline validator: checks a plan against `dataseek.plan/1`, resolves
 * the conditions it references (declaration + lock + stage schemas), and
 * reports. Never throws for data problems — every problem comes back as a
 * diagnostic, split by severity:
 *
 * - **errors** are contract violations; a plan with errors cannot run.
 * - **warnings** are "not resolved yet" states the I1 field decisions made
 *   explicit (null fields, missing locks, unpinned commits). validate lists
 *   them; the pre-run readiness gate (I2) is what refuses to start on them.
 */
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { statSync } from 'node:fs'
import { hashConditionDocument } from './hash.ts'
import {
  CONDITION_ID_RE,
  CONDITION_SCHEMA,
  LOCK_SCHEMA,
  PERMISSIONS_BY_HARNESS,
  PLAN_SCHEMA,
  SHA256_HEX_RE,
  schemaSubsetProblems,
  validateJson,
} from './schema.ts'

export interface EvalDiagnostic {
  /** Stable machine-readable code (LOCK_MISSING, UNRESOLVED_FIELD, …). */
  code: string
  message: string
}

/** One plan-referenced condition, resolved as far as the dataset repo allows. */
export interface ConditionResolution {
  id: string
  /** sha256 of the condition document; null when it could not be read or validated. */
  sha: string | null
  /** The parsed lock record; null when absent or unreadable. */
  lock: { sha: string; homeSha?: string } | null
  /** ready: lock matches the fresh hash and home is verified. missing: no usable declaration. */
  status: 'ready' | 'unready' | 'missing'
}

export interface PlanValidation {
  planPath: string
  schema: string
  ok: boolean
  errors: EvalDiagnostic[]
  warnings: EvalDiagnostic[]
  conditions: ConditionResolution[]
  /** The dataset-set directory the plan's contract files resolved against; null when unresolved. */
  datasetRoot: string | null
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function expandHome(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/')) return join(homedir(), path.slice(2))
  return path
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/**
 * Where the plan's contract files live: the plan's `dataset.repo` +
 * `dataset.id` when that directory exists, else the `plans/` sibling of the
 * plan file (a plan inside the dataset tree validates even before its repo
 * path is reachable — the I1-walk shape).
 */
function resolveDatasetRoot(dataset: unknown, planAbs: string): string | null {
  if (isPlainObject(dataset)) {
    const repo = dataset['repo']
    const id = dataset['id']
    if (typeof repo === 'string' && repo.length > 0 && typeof id === 'string' && id.length > 0) {
      const root = join(expandHome(repo), 'datasets', id)
      if (isDirectory(root)) return root
    }
  }
  const planDir = dirname(planAbs)
  if (basename(planDir) === 'plans') {
    const root = dirname(planDir)
    if (isDirectory(join(root, 'conditions')) || isDirectory(join(root, 'schemas'))) return root
  }
  return null
}

export interface ConditionDiagnostics {
  errors: EvalDiagnostic[]
  warnings: EvalDiagnostic[]
}

const CONDITION_NULLABLE_PATHS: ReadonlyArray<readonly [obj: string, field: string]> = [
  ['harness', 'version'],
  ['model', 'declared'],
  ['model', 'endpoint'],
  ['home', 'sha'],
]

/**
 * Contract-check one condition document: schema violations, permission
 * vocabulary, sha format (errors); unresolved null fields (warnings).
 */
export function conditionDiagnostics(condition: unknown): ConditionDiagnostics {
  const errors: EvalDiagnostic[] = validateJson(CONDITION_SCHEMA, condition)
    .map((message) => ({ code: 'CONDITION_SCHEMA', message }))
  const warnings: EvalDiagnostic[] = []
  if (!isPlainObject(condition) || errors.length > 0) return { errors, warnings }

  const permissions = condition['permissions']
  if (typeof permissions === 'string') {
    const harness = isPlainObject(condition['harness']) ? condition['harness'] : undefined
    const harnessName = typeof harness?.['name'] === 'string' ? harness['name'] : undefined
    const allowedByHarness: readonly string[] | undefined =
      typeof harnessName === 'string' ? PERMISSIONS_BY_HARNESS[harnessName] : undefined
    // The schema enum already enforces the protocol-wide union; a known
    // harness narrows it further. An unknown harness degrades to the union
    // check (the enum) alone.
    if (allowedByHarness !== undefined && !allowedByHarness.includes(permissions)) {
      errors.push({
        code: 'PERMISSION_NOT_FOR_HARNESS',
        message: `permissions ${JSON.stringify(permissions)} is not in the ${harnessName} vocabulary (${allowedByHarness.join(', ')})`,
      })
    }
  }

  const home = isPlainObject(condition['home']) ? condition['home'] : undefined
  const homeSha = home?.['sha']
  if (typeof homeSha === 'string' && !SHA256_HEX_RE.test(homeSha)) {
    errors.push({ code: 'SHA_FORMAT', message: 'home.sha must be a 64-hex sha256 (or null while unresolved)' })
  }

  for (const [obj, field] of CONDITION_NULLABLE_PATHS) {
    const section = isPlainObject(condition[obj]) ? condition[obj] : undefined
    if (section?.[field] === null) {
      warnings.push({
        code: 'UNRESOLVED_FIELD',
        message: `${obj}.${field} is null — unresolved; the pre-run readiness gate refuses this condition`,
      })
    }
  }
  return { errors, warnings }
}

interface PlanSemantics {
  conditionIds: string[]
  judgeIds: string[]
  stages: string[]
  commit: unknown
}

/**
 * Cross-field checks the JSON Schema subset cannot express (bounds,
 * judge/expectedNs consistency, judge ≠ players). Returns diagnostics and the
 * lists worth resolving further.
 */
function planSemantics(plan: unknown): { diagnostics: EvalDiagnostic[]; semantics: PlanSemantics | null } {
  const diagnostics: EvalDiagnostic[] = []
  if (!isPlainObject(plan)) return { diagnostics, semantics: null }
  const dataset = isPlainObject(plan['dataset']) ? plan['dataset'] : undefined
  const conditions = plan['conditions']
  const judge = isPlainObject(plan['judge']) ? plan['judge'] : undefined
  const budget = isPlainObject(plan['budget']) ? plan['budget'] : undefined
  const expectedNs = Array.isArray(plan['expectedNs']) ? plan['expectedNs'] : undefined

  const conditionIds = Array.isArray(conditions) ? conditions.filter((c): c is string => typeof c === 'string') : []
  if (conditionIds.length === 0) diagnostics.push({ code: 'CONDITIONS_EMPTY', message: 'conditions must list at least one condition id' })
  const seen = new Set<string>()
  for (const id of conditionIds) {
    if (!CONDITION_ID_RE.test(id)) diagnostics.push({ code: 'CONDITION_ID_INVALID', message: `condition id ${JSON.stringify(id)} is not a usable file name` })
    if (seen.has(id)) diagnostics.push({ code: 'CONDITIONS_DUPLICATED', message: `condition ${JSON.stringify(id)} appears more than once` })
    seen.add(id)
  }
  const items = dataset !== undefined && Array.isArray(dataset['items']) ? dataset['items'] : []
  if (items.length === 0) diagnostics.push({ code: 'ITEMS_EMPTY', message: 'dataset.items must list at least one item' })
  const stages = Array.isArray(plan['stages']) ? plan['stages'].filter((s): s is string => typeof s === 'string') : []
  if (stages.length === 0) diagnostics.push({ code: 'STAGES_EMPTY', message: 'stages must list at least one stage' })
  if (typeof plan['reps'] === 'number' && (!Number.isInteger(plan['reps']) || plan['reps'] < 1)) {
    diagnostics.push({ code: 'REPS_INVALID', message: 'reps must be a positive integer' })
  }
  const activeMinutes = budget?.['activeMinutes']
  if (typeof activeMinutes === 'number' && !(activeMinutes > 0)) {
    diagnostics.push({ code: 'BUDGET_INVALID', message: 'budget.activeMinutes must be positive' })
  }
  const turns = budget?.['turns']
  if (typeof turns === 'number' && (!Number.isInteger(turns) || turns < 1)) {
    diagnostics.push({ code: 'BUDGET_INVALID', message: 'budget.turns must be a positive integer' })
  }
  if (expectedNs !== undefined && expectedNs.length === 0) {
    diagnostics.push({ code: 'EXPECTED_NS_EMPTY', message: 'expectedNs must name at least one verdict source' })
  }

  const judgeIds = judge !== undefined && Array.isArray(judge['conditions'])
    ? judge['conditions'].filter((c): c is string => typeof c === 'string')
    : []
  if (judge === undefined) {
    if (expectedNs !== undefined && expectedNs.includes('llm-draft')) {
      diagnostics.push({
        code: 'JUDGE_REQUIRED_FOR_LLM_DRAFT',
        message: 'expectedNs includes llm-draft but the plan has no judge — add a judge or drop llm-draft',
      })
    }
  } else {
    const samples = judge['samples']
    if (typeof samples === 'number' && samples >= 1 && judgeIds.length === 0) {
      diagnostics.push({ code: 'JUDGE_INCOMPLETE', message: 'judge.samples >= 1 but judge.conditions is empty' })
    }
    for (const id of judgeIds) {
      if (!CONDITION_ID_RE.test(id)) diagnostics.push({ code: 'CONDITION_ID_INVALID', message: `judge condition id ${JSON.stringify(id)} is not a usable file name` })
      if (seen.has(id)) diagnostics.push({ code: 'JUDGE_IS_PLAYER', message: `judge condition ${JSON.stringify(id)} is also a player condition — the judge must not be a contestant` })
    }
  }
  return { diagnostics, semantics: { conditionIds, judgeIds, stages, commit: dataset?.['commit'] } }
}

async function readJson(path: string): Promise<{ ok: true; value: unknown } | { ok: false; reason: 'missing' | 'malformed' }> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch {
    return { ok: false, reason: 'missing' }
  }
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch {
    return { ok: false, reason: 'malformed' }
  }
}

/** Validate one referenced condition (declaration + lock) against a dataset root. */
async function resolveCondition(id: string, root: string, errors: EvalDiagnostic[], warnings: EvalDiagnostic[]): Promise<ConditionResolution> {
  const entry: ConditionResolution = { id, sha: null, lock: null, status: 'missing' }
  const loaded = await readJson(join(root, 'conditions', `${id}.json`))
  if (!loaded.ok) {
    if (loaded.reason === 'missing') {
      warnings.push({ code: 'CONDITION_FILE_MISSING', message: `conditions/${id}.json does not exist in the dataset root` })
    } else {
      errors.push({ code: 'CONDITION_MALFORMED', message: `conditions/${id}.json is not valid JSON` })
    }
    return entry
  }
  const { errors: condErrors, warnings: condWarnings } = conditionDiagnostics(loaded.value)
  for (const diagnostic of condErrors) errors.push({ ...diagnostic, message: `condition ${id}: ${diagnostic.message}` })
  for (const diagnostic of condWarnings) warnings.push({ ...diagnostic, message: `condition ${id}: ${diagnostic.message}` })
  if (condErrors.length > 0 || !isPlainObject(loaded.value)) return entry

  // The declaration is usable from here on: at worst the condition is
  // unready, never missing.
  entry.status = 'unready'
  entry.sha = hashConditionDocument(loaded.value)
  const home = isPlainObject(loaded.value['home']) ? loaded.value['home'] : undefined
  const declaredSha = typeof home?.['sha'] === 'string' ? home['sha'] : undefined

  const lock = await readJson(join(root, 'conditions', `${id}.lock.json`))
  if (!lock.ok) {
    if (lock.reason === 'missing') {
      warnings.push({ code: 'LOCK_MISSING', message: `conditions/${id}.lock.json does not exist — the condition is not locked (hash it and record the sha)` })
    } else {
      warnings.push({ code: 'LOCK_MALFORMED', message: `conditions/${id}.lock.json is not valid JSON` })
    }
    return entry
  }
  if (!isPlainObject(lock.value)) {
    warnings.push({ code: 'LOCK_MALFORMED', message: `conditions/${id}.lock.json is not an object` })
    return entry
  }
  const lockViolations = validateJson(LOCK_SCHEMA, lock.value)
  if (lockViolations.length > 0) {
    warnings.push({ code: 'LOCK_MALFORMED', message: `conditions/${id}.lock.json violates dataseek.condition-lock/1: ${lockViolations[0] ?? 'unknown'}` })
    return entry
  }
  const lockSha = lock.value['sha']
  if (typeof lockSha !== 'string') {
    warnings.push({ code: 'LOCK_MALFORMED', message: `conditions/${id}.lock.json sha is not a string` })
    return entry
  }
  const lockHome = isPlainObject(lock.value['home']) ? lock.value['home'] : undefined
  const lockHomeSha = typeof lockHome?.['sha'] === 'string' ? lockHome['sha'] : undefined
  entry.lock = { sha: lockSha, ...(lockHomeSha !== undefined ? { homeSha: lockHomeSha } : {}) }
  if (lock.value['condition'] !== id) {
    warnings.push({ code: 'LOCK_MALFORMED', message: `conditions/${id}.lock.json records condition ${JSON.stringify(lock.value['condition'])}, not ${JSON.stringify(id)}` })
    return entry
  }
  if (!SHA256_HEX_RE.test(lockSha)) {
    warnings.push({ code: 'LOCK_MALFORMED', message: `conditions/${id}.lock.json sha is not a 64-hex sha256` })
    return entry
  }
  if (entry.sha !== null && lockSha !== entry.sha) {
    warnings.push({ code: 'LOCK_STALE', message: `conditions/${id}.lock.json sha ${lockSha.slice(0, 12)}… does not match the current condition hash ${entry.sha.slice(0, 12)}… — the declaration changed after locking` })
  }
  if (declaredSha !== undefined && lockHomeSha === undefined) {
    warnings.push({ code: 'HOME_NOT_PROVISIONED', message: `condition ${id} declares home.sha but the lock has no home record — provision has not run` })
  } else if (declaredSha !== undefined && lockHomeSha !== undefined && declaredSha !== lockHomeSha) {
    warnings.push({ code: 'HOME_MISMATCH', message: `condition ${id} home.sha does not match the locked home — the scoped home changed after provision` })
  }
  const homeVerified = declaredSha !== undefined && declaredSha === lockHomeSha
  entry.status = entry.lock.sha === entry.sha && homeVerified ? 'ready' : 'unready'
  return entry
}

/** Lint the stage schemas a plan names (they gate mission transitions at run time). */
async function checkStageSchemas(stages: readonly string[], root: string, errors: EvalDiagnostic[], warnings: EvalDiagnostic[]): Promise<void> {
  for (const stage of stages) {
    const loaded = await readJson(join(root, 'schemas', `${stage}.json`))
    if (!loaded.ok) {
      if (loaded.reason === 'missing') {
        warnings.push({ code: 'STAGE_SCHEMA_MISSING', message: `schemas/${stage}.json does not exist — the stage cannot gate submissions` })
      } else {
        errors.push({ code: 'STAGE_SCHEMA_MALFORMED', message: `schemas/${stage}.json is not valid JSON` })
      }
      continue
    }
    const problems = schemaSubsetProblems(loaded.value)
    if (problems.length > 0) {
      errors.push({
        code: 'STAGE_SCHEMA_UNSUPPORTED',
        message: `schemas/${stage}.json leaves the supported JSON Schema subset (mission's schema-check would refuse it):\n${problems.map(p => `  - ${p}`).join('\n')}`,
      })
    }
  }
}

/**
 * Validate a plan document and everything it references. Data problems come
 * back as diagnostics, never as throws.
 * @param planPath - path to a `dataseek.plan/1` document (plans/<plan>.json).
 */
export async function validatePlan(planPath: string): Promise<PlanValidation> {
  const planAbs = resolve(planPath)
  const errors: EvalDiagnostic[] = []
  const warnings: EvalDiagnostic[] = []
  const conditions: ConditionResolution[] = []
  const report: PlanValidation = {
    planPath: planAbs,
    schema: 'dataseek.plan/1',
    ok: false,
    errors,
    warnings,
    conditions,
    datasetRoot: null,
  }

  const loaded = await readJson(planAbs)
  if (!loaded.ok) {
    if (loaded.reason === 'missing') {
      errors.push({ code: 'PLAN_UNREADABLE', message: `cannot read plan file: ${planAbs}` })
    } else {
      errors.push({ code: 'PLAN_MALFORMED', message: `plan file is not valid JSON: ${planAbs}` })
    }
    return report
  }
  const plan = loaded.value

  for (const message of validateJson(PLAN_SCHEMA, plan)) {
    errors.push({ code: 'PLAN_SCHEMA', message })
  }
  const { diagnostics: semantic, semantics } = planSemantics(plan)
  errors.push(...semantic)
  if (semantics === null) return report
  report.ok = errors.length === 0

  const dataset = isPlainObject(plan) && isPlainObject((plan as Record<string, unknown>)['dataset'])
    ? (plan as Record<string, unknown>)['dataset']
    : undefined
  if (semantics.commit === null) {
    warnings.push({ code: 'COMMIT_UNRESOLVED', message: 'dataset.commit is null — the snapshot pins it at run start; run.meta records the actual commit' })
  }

  const root = resolveDatasetRoot(dataset, planAbs)
  report.datasetRoot = root
  if (root === null) {
    warnings.push({
      code: 'DATASET_ROOT_UNRESOLVABLE',
      message: 'cannot locate the dataset root (dataset.repo/datasets/<id> does not exist and the plan is not inside a plans/ tree) — conditions and stage schemas go unchecked',
    })
    conditions.push(...semantics.conditionIds.map(id => ({ id, sha: null, lock: null, status: 'unready' as const })))
    return report
  }

  await checkStageSchemas(semantics.stages, root, errors, warnings)
  for (const id of semantics.conditionIds) {
    conditions.push(await resolveCondition(id, root, errors, warnings))
  }
  report.ok = errors.length === 0
  return report
}
