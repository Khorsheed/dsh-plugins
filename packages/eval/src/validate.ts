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
import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { statSync } from 'node:fs'
import { checkAgainstEffective, type EffectiveSnapshot } from './effective.ts'
import { hashConditionDocument } from './hash.ts'
import { llmDraftCriteria, pickRubricPath, probePaths } from './judge.ts'
import { conditionUnitDiagnostics, planUnitOf } from './unit.ts'
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

/**
 * What `conditions provision` recorded about the scope it provisioned — the
 * lock's `provisioned` block, read back. Absent on any lock written before
 * provision existed (the field is additive in `dataseek.condition-lock/1`).
 */
export interface LockProvisionRecord {
  /** Epoch ms the provision ran. */
  at: number
  /** The harness CLI's own version at provision time; null when it could not be asked. */
  cliVersion: string | null
  /** The four condition fields as that scope answered them; null means "no such knob". */
  effective: { model: string | null; reasoningEffort: string | null; permissions: string | null; endpoint: string | null }
}

/** One plan-referenced condition, resolved as far as the dataset repo allows. */
export interface ConditionResolution {
  id: string
  /** sha256 of the condition document; null when it could not be read or validated. */
  sha: string | null
  /** The parsed lock record; null when absent or unreadable. */
  lock: { sha: string; homeSha?: string; provisioned?: LockProvisionRecord } | null
  /** ready: lock matches the fresh hash, home is verified, and provision agrees. missing: no usable declaration. */
  status: 'ready' | 'unready' | 'missing'
}

export interface PlanValidation {
  planPath: string
  schema: string
  ok: boolean
  errors: EvalDiagnostic[]
  warnings: EvalDiagnostic[]
  conditions: ConditionResolution[]
  /**
   * The plan's JUDGE conditions, resolved the same way — kept OFF
   * {@link PlanValidation.conditions} on purpose: that list is the players,
   * and the run loop expands its matrix from it. A judge is a condition, not
   * a contestant's cell.
   */
  judges: ConditionResolution[]
  /** The dataset-set directory the plan's contract files resolved against; null when unresolved. */
  datasetRoot: string | null
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Expand a leading `~` against the current user's home directory. */
export function expandHome(path: string): string {
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

/**
 * The shape of a condition's `scope`: the same `[a-z0-9-]` name the family's
 * own scoped-home resolution accepts. Duplicated here rather than imported —
 * eval imports nothing from sibling @khorsheed packages — and pinned against
 * the family's rule by the eval condition tests.
 */
const CONDITION_SCOPE_RE = /^[a-z0-9-]+$/

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

  // The scoped-home selector is a NAME, not a path: the family resolves it to
  // a sibling directory under its own homes root, and a path here would be
  // both meaningless and an escape attempt. The schema subset has no
  // `pattern`, so the shape is checked here.
  const scope = condition['scope']
  if (typeof scope === 'string' && !CONDITION_SCOPE_RE.test(scope)) {
    errors.push({
      code: 'SCOPE_NAME',
      message: `scope ${JSON.stringify(scope)} must be a name matching [a-z0-9-] (it selects <harness>@<scope> under the instance's homes root — a scope is a name, never a path)`,
    })
  }

  const home = isPlainObject(condition['home']) ? condition['home'] : undefined
  const homeSha = home?.['sha']
  if (typeof homeSha === 'string' && !SHA256_HEX_RE.test(homeSha)) {
    errors.push({ code: 'SHA_FORMAT', message: 'home.sha must be a 64-hex sha256 (or null while unresolved)' })
  }

  for (const path of unresolvedFields(condition)) {
    warnings.push({
      code: 'UNRESOLVED_FIELD',
      message: `${path} is null — unresolved; the pre-run readiness gate refuses this condition`,
    })
  }
  return { errors, warnings }
}

/**
 * The nullable contract fields this condition leaves unresolved, as dotted
 * paths (`model.declared`, `home.sha`, …). The same list `conditionDiagnostics`
 * turns into UNRESOLVED_FIELD warnings, exposed on its own so the
 * `eval_conditions` read tool can print it per condition.
 * @param condition - a condition document (a non-object yields an empty list).
 */
export function unresolvedFields(condition: unknown): string[] {
  if (!isPlainObject(condition)) return []
  const paths: string[] = []
  for (const [obj, field] of CONDITION_NULLABLE_PATHS) {
    const section = isPlainObject(condition[obj]) ? condition[obj] : undefined
    if (section?.[field] === null) paths.push(`${obj}.${field}`)
  }
  return paths
}

interface PlanSemantics {
  conditionIds: string[]
  judgeIds: string[]
  stages: string[]
  items: string[]
  expectedNs: string[] | null
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
  // retry / exports (protocol §6.4): the schema subset carries no `minimum`
  // and no path shape, so the floor and the emptiness live here.
  const retry = isPlainObject(plan['retry']) ? plan['retry'] : undefined
  const infrastructure = retry?.['infrastructure']
  if (typeof infrastructure === 'number' && (!Number.isInteger(infrastructure) || infrastructure < 0)) {
    diagnostics.push({ code: 'RETRY_INVALID', message: 'retry.infrastructure must be an integer >= 0 (0 disables retrying)' })
  }
  if (typeof plan['exports'] === 'string' && plan['exports'].trim() === '') {
    diagnostics.push({ code: 'EXPORTS_INVALID', message: 'exports must be a non-empty directory path' })
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
    const judgeSeen = new Set<string>()
    for (const id of judgeIds) {
      if (!CONDITION_ID_RE.test(id)) diagnostics.push({ code: 'CONDITION_ID_INVALID', message: `judge condition id ${JSON.stringify(id)} is not a usable file name` })
      // Decision 9 relaxed (2026-09-10): a judge MAY be a player. What is
      // still refused is the same id on both lists, which is not a panel but
      // a bookkeeping mistake — it would make one condition its own cell's
      // judge and double every count keyed by condition id. Two DIFFERENT ids
      // that happen to name the same model are a self-judged cell, marked in
      // the report rather than refused.
      if (seen.has(id)) {
        diagnostics.push({
          code: 'JUDGE_IS_SAME_CONDITION',
          message: `condition ${JSON.stringify(id)} appears in both conditions and judge.conditions`
            + ' — a judge may share a model with a player (self-judged cells are marked in the report), but it must be its own condition id',
        })
      }
      if (judgeSeen.has(id)) {
        diagnostics.push({ code: 'JUDGE_DUPLICATED', message: `judge condition ${JSON.stringify(id)} appears more than once — a panel of one judge listed twice is not two opinions` })
      }
      judgeSeen.add(id)
    }
  }
  return {
    diagnostics,
    semantics: {
      conditionIds,
      judgeIds,
      stages,
      items: items.filter((item): item is string => typeof item === 'string'),
      expectedNs: expectedNs === undefined ? null : expectedNs.filter((ns): ns is string => typeof ns === 'string'),
      commit: dataset?.['commit'],
    },
  }
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

/** One condition's readiness, with the diagnostics resolving it produced. */
export interface ConditionReadiness {
  entry: ConditionResolution
  /** The parsed declaration; null when it is absent, malformed, or contract-violating. */
  document: Record<string, unknown> | null
  errors: EvalDiagnostic[]
  warnings: EvalDiagnostic[]
}

/**
 * Resolve one condition (declaration + lock) against a dataset root: hash the
 * declaration, read the lock, and decide ready / unready / missing. Shared by
 * {@link validatePlan}, which folds the diagnostics into the plan report, and
 * by the `eval_conditions` read tool, which lists them per condition — what
 * "ready" means is decided in exactly one place.
 * @param id - condition id (the file stem under `conditions/`).
 * @param root - the dataset-set directory holding `conditions/`.
 */
export async function resolveConditionReadiness(id: string, root: string): Promise<ConditionReadiness> {
  const errors: EvalDiagnostic[] = []
  const warnings: EvalDiagnostic[] = []
  const entry: ConditionResolution = { id, sha: null, lock: null, status: 'missing' }
  const readiness: ConditionReadiness = { entry, document: null, errors, warnings }
  const loaded = await readJson(join(root, 'conditions', `${id}.json`))
  if (!loaded.ok) {
    if (loaded.reason === 'missing') {
      warnings.push({ code: 'CONDITION_FILE_MISSING', message: `conditions/${id}.json does not exist in the dataset root` })
    } else {
      errors.push({ code: 'CONDITION_MALFORMED', message: `conditions/${id}.json is not valid JSON` })
    }
    return readiness
  }
  const { errors: condErrors, warnings: condWarnings } = conditionDiagnostics(loaded.value)
  for (const diagnostic of condErrors) errors.push({ ...diagnostic, message: `condition ${id}: ${diagnostic.message}` })
  for (const diagnostic of condWarnings) warnings.push({ ...diagnostic, message: `condition ${id}: ${diagnostic.message}` })
  if (condErrors.length > 0 || !isPlainObject(loaded.value)) return readiness

  // The declaration is usable from here on: at worst the condition is
  // unready, never missing.
  readiness.document = loaded.value
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
    return readiness
  }
  if (!isPlainObject(lock.value)) {
    warnings.push({ code: 'LOCK_MALFORMED', message: `conditions/${id}.lock.json is not an object` })
    return readiness
  }
  const lockViolations = validateJson(LOCK_SCHEMA, lock.value)
  if (lockViolations.length > 0) {
    warnings.push({ code: 'LOCK_MALFORMED', message: `conditions/${id}.lock.json violates dataseek.condition-lock/1: ${lockViolations[0] ?? 'unknown'}` })
    return readiness
  }
  const lockSha = lock.value['sha']
  if (typeof lockSha !== 'string') {
    warnings.push({ code: 'LOCK_MALFORMED', message: `conditions/${id}.lock.json sha is not a string` })
    return readiness
  }
  const lockHome = isPlainObject(lock.value['home']) ? lock.value['home'] : undefined
  const lockHomeSha = typeof lockHome?.['sha'] === 'string' ? lockHome['sha'] : undefined
  entry.lock = { sha: lockSha, ...(lockHomeSha !== undefined ? { homeSha: lockHomeSha } : {}) }
  if (lock.value['condition'] !== id) {
    warnings.push({ code: 'LOCK_MALFORMED', message: `conditions/${id}.lock.json records condition ${JSON.stringify(lock.value['condition'])}, not ${JSON.stringify(id)}` })
    return readiness
  }
  if (!SHA256_HEX_RE.test(lockSha)) {
    warnings.push({ code: 'LOCK_MALFORMED', message: `conditions/${id}.lock.json sha is not a 64-hex sha256` })
    return readiness
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

  // What provision RECORDED about the scope, re-checked against the
  // declaration as it stands now. A lock whose sha still matches cannot have
  // drifted by an honest edit — the condition hash would have moved — so a
  // disagreement here means the lock was written by something other than
  // provision. That is precisely the forgery T31 exists to make visible: the
  // two error-grade fields (permissions, model.endpoint) are the approval
  // boundary and the upstream route, and a run on a lock that lies about
  // either is not the experiment the condition describes.
  const provisioned = provisionRecordOf(lock.value['provisioned'])
  let provisionVerified = true
  if (provisioned === null) {
    warnings.push({
      code: 'PROVISION_RECORD_MISSING',
      message: `conditions/${id}.lock.json has no provisioned record — it predates \`dsh-eval conditions provision\`, so nothing ever checked the declaration against a real scoped home`,
    })
  } else {
    entry.lock.provisioned = provisioned
    const snapshot: EffectiveSnapshot = { cliVersion: provisioned.cliVersion, ...provisioned.effective, available: true }
    for (const row of checkAgainstEffective(loaded.value, snapshot)) {
      if (row.status !== 'mismatch' || row.severity !== 'error') continue
      provisionVerified = false
      warnings.push({
        code: 'PROVISION_MISMATCH',
        message: `condition ${id}: ${row.field} disagrees with the scope the lock was provisioned against — ${row.detail}; re-run \`dsh-eval conditions provision\``,
      })
    }
  }

  entry.status = entry.lock.sha === entry.sha && homeVerified && provisionVerified ? 'ready' : 'unready'
  return readiness
}

/**
 * Read a lock's `provisioned` block. Every field must be there and be the
 * right shape: a half-written record is read as ABSENT rather than as a
 * partial truth, because the whole point of the block is that something
 * checked the scope.
 * @param value - the lock's `provisioned` property.
 * @returns the record, or null when there is none to trust.
 */
function provisionRecordOf(value: unknown): LockProvisionRecord | null {
  if (!isPlainObject(value) || typeof value['at'] !== 'number') return null
  const effective = value['effective']
  if (!isPlainObject(effective)) return null
  const field = (key: string): string | null | undefined => {
    const raw = effective[key]
    if (raw === null || typeof raw === 'string') return raw
    return undefined
  }
  const model = field('model')
  const reasoningEffort = field('reasoningEffort')
  const permissions = field('permissions')
  const endpoint = field('endpoint')
  if (model === undefined || reasoningEffort === undefined || permissions === undefined || endpoint === undefined) return null
  const cliVersion = value['cliVersion']
  return {
    at: value['at'],
    cliVersion: typeof cliVersion === 'string' ? cliVersion : null,
    effective: { model, reasoningEffort, permissions, endpoint },
  }
}

/** Display paths under one of an item's layer directories; empty when absent. */
async function layerPaths(itemRoot: string, layer: string): Promise<string[] | null> {
  try {
    const entries = await readdir(join(itemRoot, layer), { recursive: true, withFileTypes: true })
    return entries
      .filter(entry => entry.isFile())
      .map(entry => join(entry.parentPath, entry.name).slice(join(itemRoot, layer).length + 1))
  } catch {
    return null
  }
}

/**
 * Cross-check what the plan EXPECTS to be judged by against what each item
 * can actually produce (pilot A · G6, the plan half).
 *
 * `expectedNs` is a claim about verdict sources, and a source with nothing to
 * run on an item is silently empty: F3 declared `script` while shipping no
 * executable probe, and every F3 cell's `verdicts/` came back short — which
 * only became visible when the archive gate refused them. Both checks are
 * WARNINGS: whether an empty source is acceptable is the reviewer's call
 * (a plan may name a source that a later item will supply), and refusing the
 * plan would make the drafting loop unusable.
 *
 * Only the CONVENTIONAL item layout is inspected (`items/<id>/verify`,
 * `items/<id>/grading`). A dataset that re-homes its layers is the dataset
 * validator's business (T26); here an item whose directory is not there is
 * left alone rather than reported on a guess.
 */
async function checkExpectedNsSources(
  expectedNs: readonly string[] | null,
  items: readonly string[],
  root: string,
  warnings: EvalDiagnostic[],
): Promise<void> {
  if (expectedNs === null) return
  const wantsScript = expectedNs.includes('script')
  const wantsLlmDraft = expectedNs.includes('llm-draft')
  if (!wantsScript && !wantsLlmDraft) return
  for (const item of items) {
    const itemRoot = join(root, 'items', item)
    if (!isDirectory(itemRoot)) continue
    if (wantsScript) {
      const verify = await layerPaths(itemRoot, 'verify')
      const probes = verify === null ? [] : probePaths(verify)
      if (probes.length === 0) {
        warnings.push({
          code: 'EXPECTED_NS_NO_PROBE',
          message: `expectedNs declares "script" but item ${item} ships no executable probe (.mjs / .sh under a probes/ segment) in its verify layer`
            + ' — that source can produce no verdict for this item',
        })
      }
    }
    if (wantsLlmDraft) {
      const grading = await layerPaths(itemRoot, 'grading')
      const rubricPath = grading === null ? null : pickRubricPath(grading)
      if (rubricPath === null) {
        warnings.push({
          code: 'EXPECTED_NS_NO_RUBRIC',
          message: `expectedNs declares "llm-draft" but item ${item} ships no rubric.yml in its grading layer — the judge has nothing to answer`,
        })
        continue
      }
      let criteria: number
      try {
        criteria = llmDraftCriteria(await readFile(join(itemRoot, 'grading', rubricPath), 'utf8')).length
      } catch (error) {
        warnings.push({
          code: 'EXPECTED_NS_RUBRIC_UNPARSEABLE',
          message: `item ${item}: grading/${rubricPath} could not be parsed as YAML (${error instanceof Error ? error.message : String(error)})`,
        })
        continue
      }
      if (criteria === 0) {
        warnings.push({
          code: 'EXPECTED_NS_NO_LLM_DRAFT_CRITERIA',
          message: `expectedNs declares "llm-draft" but item ${item}'s grading/${rubricPath} has no kind: llm-draft leaf`
            + ' — the judge would be handed an empty rubric and the cell would archive with no llm-draft verdict',
        })
      }
    }
  }
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
  const judges: ConditionResolution[] = []
  const report: PlanValidation = {
    planPath: planAbs,
    schema: 'dataseek.plan/1',
    ok: false,
    errors,
    warnings,
    conditions,
    judges,
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
    judges.push(...semantics.judgeIds.map(id => ({ id, sha: null, lock: null, status: 'unready' as const })))
    return report
  }

  await checkStageSchemas(semantics.stages, root, errors, warnings)
  await checkExpectedNsSources(semantics.expectedNs, semantics.items, root, warnings)
  // A plan that declares a unit puts every condition inside a container, and
  // a condition that never said where its scoped home is mounted cannot run
  // there. Checked HERE, offline, because the alternative is discovering it
  // at the first acquire — with the run created and the ledger already open.
  const planUnit = planUnitOf(plan)
  for (const id of semantics.conditionIds) {
    const readiness = await resolveConditionReadiness(id, root)
    errors.push(...readiness.errors)
    warnings.push(...readiness.warnings)
    conditions.push(readiness.entry)
    if (planUnit !== null && readiness.document !== null) {
      errors.push(...conditionUnitDiagnostics(id, readiness.document))
    }
  }
  // The judge conditions are resolved too — they were not before, so a judge
  // whose declaration violated the contract was only ever caught by the run
  // loop, with the plan already approved. A judge does NOT need a unit: it
  // delegates from the orchestrator, not from a cell, and runs on the host
  // even in a container run.
  for (const id of semantics.judgeIds) {
    const readiness = await resolveConditionReadiness(id, root)
    errors.push(...readiness.errors.map(diagnostic => ({ ...diagnostic, message: `judge ${diagnostic.message}` })))
    warnings.push(...readiness.warnings.map(diagnostic => ({ ...diagnostic, message: `judge ${diagnostic.message}` })))
    judges.push(readiness.entry)
    errors.push(...judgeModelDiagnostics(id, readiness.document))
  }
  report.ok = errors.length === 0
  return report
}

/**
 * A judge condition must PIN its model (decision 9, as relaxed 2026-09-10).
 *
 * The relaxation lets a judge share a model with a player and marks the cells
 * that judged themselves. That marking is only possible if every judge's model
 * is knowable BEFORE the run: a judge declaring `model.declared: null` runs
 * whatever its harness happens to be configured for, so no cell could be
 * called self-judged or not, and the report would be quietly wrong instead of
 * loudly incomplete. So the null the player conditions may still carry as
 * "unresolved" is an ERROR here.
 * @param id - the judge condition id.
 * @param document - its declaration, or null when it could not be resolved.
 */
function judgeModelDiagnostics(id: string, document: Record<string, unknown> | null): EvalDiagnostic[] {
  if (document === null) return []
  const model = isPlainObject(document['model']) ? document['model'] : undefined
  if (model?.['declared'] !== null) return []
  return [{
    code: 'JUDGE_MODEL_UNDECLARED',
    message: `judge condition ${id} declares model.declared: null — a judge must pin its model`
      + ' (decision 9 allows a judge to share a model with a player and marks those cells self-judged, which is undecidable when the judge runs whatever its harness defaults to)',
  }]
}
