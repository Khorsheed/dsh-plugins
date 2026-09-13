/**
 * The LAB tab's projection: one row per experiment, and one run's overview.
 *
 * An experiment is a plan — `plans/<name>.json` in the bound dataset
 * repository — and, once a human has started it, the mission run that plan
 * expanded into. The list shows both in one table (ui-spec §五): a draft that
 * nobody has approved sits beside a run that finished last week, because to
 * the person planning the next comparison they are the same kind of thing.
 *
 * Everything here is a PROJECTION of data other packages own — mission's run
 * ledger, the dataset repository's `plans/` directory, this service's own job
 * registry — assembled behind eval's face so the browser half never names
 * mission or datasets (ui-spec R2). Nothing here writes anything.
 *
 * The status rule lives in exactly one place, {@link deriveExperimentStatus},
 * and it is pure: three inputs (the plan's validate outcome, the ledger's
 * cells, the background job) decide one of the seven words the spec fixed.
 * Its edge cases are documented on the function rather than smoothed over —
 * a status that guesses is worse than one that is legibly coarse.
 * @module @khorsheed/dsh-eval
 */
import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import type { EvalRunStatus } from './job.ts'
import type { MissionRunListFace } from './faces.ts'
import { canonicalJson } from './hash.ts'
import { conditionFactors } from './read.ts'
import { PLAN_SCHEMA_ID } from './schema.ts'
import { expandHome, validatePlan } from './validate.ts'
import type {
  EvalExperimentDetail, EvalExperimentJob, EvalExperimentMeta, EvalExperimentRow, EvalExperimentsResult,
  EvalExperimentSnapshot, EvalExperimentStatus, EvalExperimentUnit, EvalReadinessLine,
} from './types.ts'

/** The template state a finalized cell rests in (the generated template's last one). */
const RELEASED_STATE = 'released'

/**
 * `judged` and everything after it in the generated template's state order
 * (`… → judged | halted → archived → releasable → released`). A cell in one
 * of these has nothing left for the ORCHESTRATOR to do; what remains is the
 * judge's and the human's, which is what `judging` means.
 */
const JUDGED_OR_BEYOND: ReadonlySet<string> = new Set(['judged', 'halted', 'archived', 'releasable', RELEASED_STATE])

/** Job statuses that mean the job stopped; anything else is still live. */
const SETTLED_JOB: ReadonlySet<string> = new Set(['completed', 'killed', 'failed'])

/** What {@link deriveExperimentStatus} reads. Every field is nullable: a projection of three ledgers that may each be silent. */
export interface ExperimentStatusInput {
  /**
   * The plan's validate outcome, or null when validate was not run — which is
   * the case for every STARTED experiment (a run's plan is not re-validated;
   * the run itself is the fact).
   */
  validation: { ok: boolean } | null
  /** The run in the mission ledger, when the experiment has been started. */
  run: {
    /** Every cell's template state, as the ledger holds it. */
    cellStates: readonly string[]
    /** bucket → how many cells of the run sit in it. */
    buckets: Readonly<Record<string, number>>
  } | null
  /**
   * The background job, when THIS instance still holds one. A job registry is
   * in-memory: a run started before the last restart, or by the CLI, has none,
   * and the status then rests on the ledger alone.
   */
  job: { status: string } | null
}

/**
 * Decide one experiment's status. Pure — the same three inputs always give
 * the same word.
 *
 * Precedence, and why: a killed or failed JOB is the loudest fact there is
 * (the human pulled the lever, or the run never got off the ground), so those
 * two come first; a fully released run is `done` next, because finalize is
 * the definition; a live job or a moving cell is `running`; a run whose every
 * cell reached `judged` with nothing live is `judging`.
 *
 * Known coarse edges, deliberately NOT smoothed over:
 * - The job layer records a readiness refusal and a mid-run throw the same
 *   way (`failed`, plus a `run … refused:` line), so `refused` here means
 *   "the job settled as failed", not specifically the readiness gate — the
 *   status detail carries which.
 * - A settled job that left cells mid-stage (an interrupt, a skipped
 *   condition) reads as `running`, because the ledger genuinely still has
 *   unfinished cells and no eighth word exists for "stopped unfinished".
 * - A run with no cells at all reads as `running` for the same reason: an
 *   empty ledger is not evidence of completion.
 * - Without a job record (any instance restart) `cancelled` and `refused` are
 *   unreachable, and such a run reads by its cells alone.
 * @param input - the three ledgers' say.
 * @returns the status word ui-spec §五 fixed.
 */
export function deriveExperimentStatus(input: ExperimentStatusInput): EvalExperimentStatus {
  const { job, run, validation } = input
  if (job !== null && job.status === 'killed') return 'cancelled'
  if (job !== null && job.status === 'failed') return 'refused'
  const jobLive = job !== null && !SETTLED_JOB.has(job.status)
  if (run === null) {
    if (jobLive) return 'running'
    return validation !== null && validation.ok ? 'pending-approval' : 'draft'
  }
  const cells = run.cellStates
  if (cells.length > 0 && cells.every(state => state === RELEASED_STATE)) return 'done'
  if (jobLive) return 'running'
  if ((run.buckets['active'] ?? 0) > 0) return 'running'
  if (cells.length > 0 && cells.every(state => JUDGED_OR_BEYOND.has(state))) return 'judging'
  return 'running'
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' ? value : null
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

/** The plan sha the run loop records: sha256 of the document's canonical JSON. */
function planSha(document: unknown): string {
  return createHash('sha256').update(canonicalJson(document)).digest('hex')
}

/** One plan file found in the repository's `plans/` trees. */
interface PlanFile {
  /** Absolute path. */
  path: string
  /** The file stem — the experiment's name. */
  name: string
  /** The dataset set whose `plans/` directory holds it. */
  dataset: string
  document: Record<string, unknown>
  sha: string
}

/**
 * Every `dataseek.plan/1` document under `<repo>/datasets/<set>/plans/`.
 * Generated templates (`<plan>.template.json`) are not plans and are skipped;
 * so is any file that does not declare the plan schema — the passthrough zone
 * holds whatever the authors put there, and a listing that tried to interpret
 * all of it would report noise as experiments.
 */
async function readPlans(repo: string, datasets: readonly string[], notes: string[]): Promise<PlanFile[]> {
  const plans: PlanFile[] = []
  for (const dataset of datasets) {
    const dir = join(repo, 'datasets', dataset, 'plans')
    let entries: string[]
    try {
      entries = await readdir(dir)
    } catch {
      continue
    }
    for (const entry of entries.sort()) {
      if (!entry.endsWith('.json') || entry.endsWith('.template.json')) continue
      const path = join(dir, entry)
      let document: unknown
      try {
        document = JSON.parse(await readFile(path, 'utf8')) as unknown
      } catch (error) {
        notes.push(`plan ${path} is unreadable (${error instanceof Error ? error.message : String(error)})`)
        continue
      }
      if (!isPlainObject(document) || document['schema'] !== PLAN_SCHEMA_ID) continue
      plans.push({
        path,
        name: entry.slice(0, -'.json'.length),
        dataset,
        document,
        sha: planSha(document),
      })
    }
  }
  return plans
}

/** Dataset sets under `<repo>/datasets/` that declare a `plans/` directory. */
async function datasetsWithPlans(repo: string): Promise<string[]> {
  let entries: Array<{ name: string; isDirectory(): boolean }>
  try {
    entries = await readdir(join(repo, 'datasets'), { withFileTypes: true })
  } catch {
    return []
  }
  const found: string[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    try {
      await readdir(join(repo, 'datasets', entry.name, 'plans'))
      found.push(entry.name)
    } catch {
      // A dataset set without a plans/ directory declares no experiments.
    }
  }
  return found.sort()
}

/** The condition ids and documents a plan names, read from its dataset set. */
async function planConditionDocuments(plan: PlanFile, repo: string, ids: readonly string[]): Promise<unknown[]> {
  const documents: unknown[] = []
  for (const id of ids) {
    try {
      documents.push(JSON.parse(await readFile(join(repo, 'datasets', plan.dataset, 'conditions', `${id}.json`), 'utf8')) as unknown)
    } catch {
      // A condition the plan names but the repository does not hold: validate
      // reports it as an error; the factor column simply has less to compare.
    }
  }
  return documents
}

/** The container segment of a plan document or of run.meta, structurally. */
function unitOf(value: unknown): EvalExperimentUnit | null {
  if (!isPlainObject(value)) return null
  const image = stringOrNull(value['image'])
  if (image === null) return null
  return { image, network: stringOrNull(value['network']), user: stringOrNull(value['user']) }
}

/** The row of one draft plan (no run, so everything comes from the document). */
async function draftRow(
  plan: PlanFile,
  repo: string,
  job: EvalRunStatus | undefined,
): Promise<EvalExperimentRow> {
  const dataset = isPlainObject(plan.document['dataset']) ? plan.document['dataset'] : undefined
  const conditions = stringArray(plan.document['conditions'])
  const judgeSegment = isPlainObject(plan.document['judge']) ? plan.document['judge'] : undefined
  const validation = await validatePlan(plan.path)
  const documents = await planConditionDocuments(plan, repo, conditions)
  const snapshot: EvalExperimentSnapshot = {
    repo: stringOrNull(dataset?.['repo']) ?? repo,
    datasetId: stringOrNull(dataset?.['id']),
    commit: stringOrNull(dataset?.['commit']),
  }
  return {
    id: `plan:${plan.path}`,
    name: plan.name,
    planPath: plan.path,
    runId: null,
    status: deriveExperimentStatus({
      validation: { ok: validation.ok },
      run: null,
      job: job === undefined ? null : { status: job.status },
    }),
    statusDetail: job?.detail ?? null,
    snapshot,
    conditions,
    judges: stringArray(judgeSegment?.['conditions']),
    items: stringArray(dataset?.['items']).length,
    reps: numberOrNull(plan.document['reps']) ?? 0,
    factors: conditionFactors(documents),
    progress: null,
    startedAt: null,
    validation: { ok: validation.ok, errors: validation.errors.length, warnings: validation.warnings.length },
    unit: unitOf(plan.document['unit']),
  }
}

/** One run of the mission ledger, as this projection reads it. */
interface RunProjection {
  runId: string
  meta: Record<string, unknown>
  createdAt: number
  rows: ReadonlyArray<{ labels: Record<string, string>; state: string; bucket: string; id: string }>
  buckets: Record<string, string[]>
  unreleased: string[]
}

/** The run.meta condition entries, each carrying the full declaration since T8b. */
function metaConditionEntries(value: unknown): Array<{ id: string; sha: string | null; document: unknown }> {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!isPlainObject(entry) || typeof entry['id'] !== 'string') return []
    return [{ id: entry['id'], sha: stringOrNull(entry['sha']), document: entry['condition'] }]
  })
}

/** The row of one started experiment: the run's own meta and cells decide every column. */
function runRow(run: RunProjection, job: EvalRunStatus | undefined): EvalExperimentRow {
  const meta = run.meta
  const snapshotMeta = isPlainObject(meta['snapshot']) ? meta['snapshot'] : undefined
  const judgeMeta = isPlainObject(meta['judge']) ? meta['judge'] : undefined
  const conditions = metaConditionEntries(meta['conditions'])
  const planPath = stringOrNull(meta['planPath'])
  const tasks = new Set<string>()
  const reps = new Set<string>()
  for (const row of run.rows) {
    const task = row.labels['task']
    if (task !== undefined) tasks.add(task)
    const rep = row.labels['rep']
    if (rep !== undefined) reps.add(rep)
  }
  const cellStates = run.rows.map(row => row.state)
  const buckets: Record<string, number> = {}
  for (const [bucket, ids] of Object.entries(run.buckets)) buckets[bucket] = ids.length
  return {
    id: run.runId,
    name: planPath === null ? run.runId : basename(planPath).replace(/\.json$/, ''),
    planPath,
    runId: run.runId,
    status: deriveExperimentStatus({
      validation: null,
      run: { cellStates, buckets },
      job: job === undefined ? null : { status: job.status },
    }),
    statusDetail: job?.detail ?? null,
    snapshot: {
      repo: stringOrNull(snapshotMeta?.['repo']),
      datasetId: stringOrNull(meta['datasetId']) ?? stringOrNull(snapshotMeta?.['datasetId']),
      commit: stringOrNull(meta['commit']) ?? stringOrNull(snapshotMeta?.['commit']),
    },
    conditions: conditions.map(entry => entry.id),
    judges: metaConditionEntries(judgeMeta?.['conditions']).map(entry => entry.id),
    items: tasks.size,
    reps: reps.size,
    factors: conditionFactors(conditions.map(entry => entry.document)),
    progress: { done: buckets['done'] ?? 0, total: run.rows.length },
    startedAt: numberOrNull(meta['startedAt']) ?? run.createdAt,
    validation: null,
    unit: unitOf(meta['unit']),
  }
}

/** Every eval run the mission ledger holds: the ones whose meta carries `evalVersion`. */
function evalRuns(mission: MissionRunListFace, notes: string[]): RunProjection[] {
  const list = mission.runList
  if (typeof list !== 'function') {
    notes.push('the mounted mission service cannot list runs, so only drafts are listed — upgrade dsh-mission')
    return []
  }
  let ids: ReadonlyArray<{ id: string }>
  try {
    ids = list.call(mission)
  } catch (error) {
    notes.push(`the mission ledger could not be listed (${error instanceof Error ? error.message : String(error)})`)
    return []
  }
  const runs: RunProjection[] = []
  for (const entry of ids) {
    let status: ReturnType<MissionRunListFace['runStatus']>
    try {
      status = mission.runStatus(entry.id)
    } catch {
      // A run the ledger cannot project is not an eval run as far as this
      // listing is concerned; the run's own tab would say more.
      continue
    }
    // The criterion: eval wrote this run's meta. Every other run in the
    // ledger belongs to somebody else and has no business in this list.
    if (typeof status.run.meta['evalVersion'] !== 'string') continue
    runs.push({
      runId: status.run.id,
      meta: status.run.meta,
      createdAt: status.run.createdAt,
      rows: status.rows,
      buckets: status.buckets,
      unreleased: status.unreleased,
    })
  }
  return runs
}

/** What {@link listExperiments} needs; each source optional and degrading to a note. */
export interface ExperimentsInput {
  /** The mission ledger; absent lists drafts only. */
  mission?: MissionRunListFace
  /** The dataset repository holding the plans; absent lists runs only. */
  repo?: string
  /** The dataset sets to scan; absent scans every set of the repository that has plans. */
  datasets?: readonly string[]
  /** Background run jobs this instance still holds (newest wins per run / per plan). */
  jobs?: readonly EvalRunStatus[]
}

/** Index the job records by run id and by the plan they were started from. */
function indexJobs(jobs: readonly EvalRunStatus[]): { byRun: Map<string, EvalRunStatus>; byPlan: Map<string, EvalRunStatus> } {
  const byRun = new Map<string, EvalRunStatus>()
  const byPlan = new Map<string, EvalRunStatus>()
  // In start order, so a re-run's job replaces the earlier one for that plan.
  for (const job of jobs) {
    byRun.set(job.runId, job)
    if (job.plan !== undefined) byPlan.set(resolve(expandHome(job.plan)), job)
  }
  return { byRun, byPlan }
}

/**
 * The lab list: one row per experiment, drafts and runs in one table.
 *
 * A plan is matched to its run by the run's `meta.planPath` (resolved) OR by
 * `meta.planSha` — the second catches a run started from another checkout of
 * the same file, and the first catches a plan edited since (an edited plan is
 * a new draft, which is the honest reading: its sha no longer describes what
 * ran).
 * @param input - the ledger, the repository, and this instance's jobs.
 * @returns rows newest-run-first, then drafts by name.
 */
export async function listExperiments(input: ExperimentsInput): Promise<EvalExperimentsResult> {
  const notes: string[] = []
  const jobs = indexJobs(input.jobs ?? [])
  const runs = input.mission === undefined ? [] : evalRuns(input.mission, notes)
  if (input.mission === undefined) {
    notes.push('no mission service: run records live in the mission ledger, so only drafts are listed — mount the dsh-mission plugin')
  }
  const repo = input.repo === undefined || input.repo === '' ? null : expandHome(input.repo)
  let datasets: string[] = []
  let plans: PlanFile[] = []
  if (repo === null) {
    notes.push('no dataset repository for this session: drafts are not listed — ask the human to bind one (/datasets bind <repoPath>)')
  } else {
    datasets = input.datasets !== undefined && input.datasets.length > 0 ? [...input.datasets] : await datasetsWithPlans(repo)
    plans = await readPlans(repo, datasets, notes)
  }

  const runRows = runs.map(run => runRow(run, jobs.byRun.get(run.runId)))
  // A plan is "started" when some run points back at it, by path or by sha.
  const startedPaths = new Set<string>()
  const startedShas = new Set<string>()
  for (const run of runs) {
    const planPath = stringOrNull(run.meta['planPath'])
    if (planPath !== null) startedPaths.add(resolve(planPath))
    const sha = stringOrNull(run.meta['planSha'])
    if (sha !== null) startedShas.add(sha)
  }
  const draftRows: EvalExperimentRow[] = []
  for (const plan of plans) {
    if (startedPaths.has(resolve(plan.path)) || startedShas.has(plan.sha)) continue
    draftRows.push(await draftRow(plan, repo as string, jobs.byPlan.get(resolve(plan.path))))
  }

  runRows.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))
  draftRows.sort((a, b) => a.name.localeCompare(b.name))
  return { repo, datasets, rows: [...runRows, ...draftRows], notes }
}

/** Project one readiness record structurally — the run wrote it, this only reads. */
function readinessLine(value: unknown): EvalReadinessLine | null {
  if (!isPlainObject(value)) return null
  const condition = stringOrNull(value['condition'])
  if (condition === null) return null
  const unit = isPlainObject(value['unit']) ? value['unit'] : undefined
  const resource = stringOrNull(unit?.['resource'])
  const fingerprint = stringOrNull(unit?.['fingerprint'])
  return {
    condition,
    role: stringOrNull(value['role']) ?? 'player',
    harness: stringOrNull(value['harness']) ?? '',
    provider: stringOrNull(value['provider']) ?? '',
    ok: value['ok'] === true,
    startedAt: numberOrNull(value['startedAt']) ?? 0,
    durationMs: numberOrNull(value['durationMs']) ?? 0,
    childSessionId: stringOrNull(value['childSessionId']),
    declaredModel: stringOrNull(value['declaredModel']),
    requestedModel: stringOrNull(value['requestedModel']),
    observedModel: stringOrNull(value['observedModel']),
    scope: stringOrNull(value['scope']),
    reason: stringOrNull(value['reason']),
    infrastructure: stringOrNull(value['infrastructure']),
    unit: resource === null || fingerprint === null ? null : { resource, fingerprint },
  }
}

/** The run.meta digest the overview shows; null when the run carries no eval meta. */
function metaDigest(meta: Record<string, unknown>): EvalExperimentMeta | null {
  if (typeof meta['evalVersion'] !== 'string') return null
  const order = isPlainObject(meta['order']) ? meta['order'] : undefined
  const judge = isPlainObject(meta['judge']) ? meta['judge'] : undefined
  const budget = isPlainObject(meta['budget']) ? meta['budget'] : undefined
  const conditions = metaConditionEntries(meta['conditions']).map((entry) => {
    const document = isPlainObject(entry.document) ? entry.document : undefined
    const harness = isPlainObject(document?.['harness']) ? document['harness'] : undefined
    const model = isPlainObject(document?.['model']) ? document['model'] : undefined
    return {
      id: entry.id,
      sha: entry.sha,
      harness: stringOrNull(harness?.['name']),
      model: stringOrNull(model?.['declared']),
    }
  })
  return {
    planSha: stringOrNull(meta['planSha']),
    planPath: stringOrNull(meta['planPath']),
    evalVersion: meta['evalVersion'],
    datasetId: stringOrNull(meta['datasetId']),
    commit: stringOrNull(meta['commit']),
    conditions,
    judge: {
      conditions: metaConditionEntries(judge?.['conditions']).map(entry => ({ id: entry.id, sha: entry.sha })),
      samples: numberOrNull(judge?.['samples']),
    },
    order: { seed: numberOrNull(order?.['seed']), sequence: stringArray(order?.['sequence']) },
    concurrency: numberOrNull(meta['concurrency']),
    budget: budget === undefined
      ? null
      : { activeMinutes: numberOrNull(budget['activeMinutes']), turns: numberOrNull(budget['turns']) },
    expectedNs: Array.isArray(meta['expectedNs']) ? stringArray(meta['expectedNs']) : null,
    startedAt: numberOrNull(meta['startedAt']),
    warnings: Array.isArray(meta['warnings'])
      ? meta['warnings'].flatMap(warning => (
        isPlainObject(warning) && typeof warning['message'] === 'string'
          ? [{ code: stringOrNull(warning['code']) ?? 'WARNING', message: warning['message'] }]
          : []
      ))
      : [],
  }
}

/** Project one job record onto the wire shape. */
function jobView(job: EvalRunStatus | undefined): EvalExperimentJob | null {
  if (job === undefined) return null
  return {
    jobId: job.jobId,
    status: job.status,
    detail: job.detail ?? null,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt ?? null,
    lines: job.lines,
  }
}

/**
 * One started experiment's overview: the row the list shows, plus everything
 * only a run has — the run.meta digest, the readiness records verbatim, the
 * bucket and stage histograms, the leak warning, and the background job.
 * @param mission - the mission read face (`ctx.mission`).
 * @param runId - the run to project.
 * @param jobs - this instance's job records, so the job's own lifecycle shows.
 * @returns the detail payload.
 */
export function experimentDetail(
  mission: MissionRunListFace,
  runId: string,
  jobs: readonly EvalRunStatus[] = [],
): EvalExperimentDetail {
  const status = mission.runStatus(runId)
  const job = indexJobs(jobs).byRun.get(runId)
  const projection: RunProjection = {
    runId: status.run.id,
    meta: status.run.meta,
    createdAt: status.run.createdAt,
    rows: status.rows,
    buckets: status.buckets,
    unreleased: status.unreleased,
  }
  const buckets: Record<string, number> = {}
  for (const [bucket, ids] of Object.entries(status.buckets)) buckets[bucket] = ids.length
  const states: Record<string, number> = {}
  for (const row of status.rows) states[row.state] = (states[row.state] ?? 0) + 1
  const readiness = Array.isArray(status.run.meta['readiness'])
    ? status.run.meta['readiness'].flatMap((record) => {
      const line = readinessLine(record)
      return line === null ? [] : [line]
    })
    : []
  return {
    row: runRow(projection, job),
    meta: metaDigest(status.run.meta),
    readiness,
    buckets,
    states,
    unreleased: status.unreleased,
    job: jobView(job),
  }
}
