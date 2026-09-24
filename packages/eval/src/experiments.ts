/**
 * The LAB tab's projection: one row per experiment, and one run's overview.
 *
 * An experiment is a directory under the deployment's state root
 * (`experiments/<id>/`, experiment-store.ts) and, once a human has started
 * it, the mission run(s) its plan expanded into. The list shows both in one table (ui-spec §五): a draft that
 * nobody has approved sits beside a run that finished last week, because to
 * the person planning the next comparison they are the same kind of thing.
 *
 * Everything here is a PROJECTION of data other packages own — mission's run
 * ledger, the deployment's experiment directories, this service's own job
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
import { readFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { readRunMarks } from './closure.ts'
import { conditionLibraryDir, type ExperimentRecord, listExperimentRecords } from './experiment-store.ts'
import type { EvalRunStatus } from './job.ts'
import type { MissionRunListFace } from './faces.ts'
import { canonicalJson } from './hash.ts'
import { planQuestionOf } from './plan-question.ts'
import { conditionFactors } from './read.ts'
import { expandHome, type PlanValidation } from './validate.ts'
import type {
  EvalExperimentDetail, EvalExperimentJob, EvalExperimentMeta, EvalExperimentRow, EvalExperimentsResult,
  EvalExperimentSnapshot, EvalExperimentStatus, EvalExperimentUnit, EvalItemRunRow, EvalItemRunsResult,
  EvalClosure, EvalReadinessLine,
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

/**
 * Whether a cell's template state is `judged` or past it — the orchestrator
 * has nothing left to do with it. The matrix page's rep dot and the status
 * rule read the SAME predicate, so a cell can never be a solid dot in one
 * view and "still running" in the other.
 * @param state - the template state, as the ledger holds it.
 * @returns true when nothing further is the orchestrator's to do.
 */
export function isJudgedOrBeyond(state: string): boolean {
  return JUDGED_OR_BEYOND.has(state)
}

/** The template state a cell rests in once finalize released it. */
export function isReleased(state: string): boolean {
  return state === RELEASED_STATE
}

/**
 * How long a non-terminal run may sit with no live job and no ledger movement
 * before the list calls it 停滞 (T72). Ten minutes: longer than any gap
 * between two state entries of a healthy cell that the pilots recorded, short
 * enough that a run whose process died is noticed the same sitting.
 */
export const STALL_THRESHOLD_MS = 10 * 60_000

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
  /** The closure in force (T72); absent or null while nobody took an exit. */
  closure?: { exit: EvalClosure['exit'] } | null
  /** Epoch ms of the newest ledger movement; absent or null disables the stall rule. */
  lastProgressAt?: number | null
  /** The clock the stall rule compares against; absent disables it. */
  now?: number
}

/**
 * Decide one experiment's status. Pure — the same inputs always give the same
 * word.
 *
 * Precedence, and why:
 * 1. A CLOSURE is a human's explicit last word on the run, so it wins over
 *    everything: exit ④ is `void`, exits ①②③ are `done`. Nothing else makes
 *    a run `done` — a released run that nobody closed is still `judging`
 *    (T72: an experiment never becomes 已完成 on its own).
 * 2. A killed or failed JOB is the loudest remaining fact (the human pulled
 *    the lever, or the run never got off the ground).
 * 3. A live job is `running`.
 * 4. A run whose every cell reached `judged` or beyond is `judging` — what is
 *    left is the judge's and the human's, and waiting on a human is not
 *    stalling, so this state is never `stalled`.
 * 5. Otherwise the run has unfinished cells and nothing of THIS instance is
 *    driving them. When the ledger has not moved for longer than
 *    {@link STALL_THRESHOLD_MS} it is `stalled`; before that it is `running`
 *    (a CLI run in another process looks exactly like this while healthy).
 *
 * Known coarse edges, deliberately NOT smoothed over:
 * - The job layer records a readiness refusal and a mid-run throw the same
 *   way (`failed`, plus a `run … refused:` line), so `refused` here means
 *   "the job settled as failed", not specifically the readiness gate — the
 *   status detail carries which.
 * - A run with no cells at all reads as `running` (or `stalled` once old):
 *   an empty ledger is not evidence of completion.
 * - Without a job record (any instance restart) `cancelled` and `refused` are
 *   unreachable, and such a run reads by its cells and its clock alone.
 * - A healthy CLI run whose one cell spends more than the threshold inside a
 *   single stage reads `stalled` until the cell moves: the ledger records
 *   state entries, not heartbeats, and the rule does not guess.
 * @param input - the ledgers' say, plus the clock.
 * @returns the status word.
 */
export function deriveExperimentStatus(input: ExperimentStatusInput): EvalExperimentStatus {
  const { job, run, validation } = input
  const closure = input.closure ?? null
  if (run !== null && closure !== null) return closure.exit === 'void' ? 'void' : 'done'
  if (job !== null && job.status === 'killed') return 'cancelled'
  if (job !== null && job.status === 'failed') return 'refused'
  const jobLive = job !== null && !SETTLED_JOB.has(job.status)
  if (run === null) {
    if (jobLive) return 'running'
    return validation !== null && validation.ok ? 'pending-approval' : 'draft'
  }
  if (jobLive) return 'running'
  const cells = run.cellStates
  if (cells.length > 0 && cells.every(state => JUDGED_OR_BEYOND.has(state))) return 'judging'
  if (isStale(input.lastProgressAt, input.now)) return 'stalled'
  return 'running'
}

/** Whether the ledger has been still for longer than {@link STALL_THRESHOLD_MS}. */
function isStale(lastProgressAt: number | null | undefined, now: number | undefined): boolean {
  if (lastProgressAt === null || lastProgressAt === undefined || now === undefined) return false
  return now - lastProgressAt > STALL_THRESHOLD_MS
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

/** One experiment of the deployment, with its plan read. */
export interface PlanFile {
  record: ExperimentRecord
  /** The plan document; empty when plan.json is unreadable (validate then says why). */
  document: Record<string, unknown>
  /** planSha of the document as it reads now; null when unreadable. */
  sha: string | null
}

/**
 * Every experiment under the state root, plan read. An unreadable plan still
 * yields a row — it is the experiment's own problem to show, not a reason to
 * drop it from the list.
 */
export async function readPlans(stateRoot: string, notes: string[] = []): Promise<PlanFile[]> {
  const { records, problems } = await listExperimentRecords(stateRoot)
  notes.push(...problems)
  const plans: PlanFile[] = []
  for (const record of records) {
    let document: unknown
    try {
      document = JSON.parse(await readFile(record.planPath, 'utf8')) as unknown
    } catch (error) {
      notes.push(`experiment ${record.id}: plan.json is unreadable (${error instanceof Error ? error.message : String(error)})`)
      plans.push({ record, document: {}, sha: null })
      continue
    }
    plans.push({ record, document: isPlainObject(document) ? document : {}, sha: planSha(document) })
  }
  return plans
}

/** The condition documents a plan names, read from the deployment's condition library. */
async function planConditionDocuments(stateRoot: string, ids: readonly string[]): Promise<unknown[]> {
  const documents: unknown[] = []
  for (const id of ids) {
    try {
      documents.push(JSON.parse(await readFile(join(conditionLibraryDir(stateRoot), `${id}.json`), 'utf8')) as unknown)
    } catch {
      // A condition the plan names but the library does not hold: validate
      // reports it as an error; the factor column simply has less to compare.
    }
  }
  return documents
}

/** The experiment's pin as the list shows it. */
function snapshotOf(record: ExperimentRecord): EvalExperimentSnapshot {
  return { registry: record.meta.dataset.registry, datasetId: record.meta.dataset.set, commit: record.meta.dataset.commit }
}

/** The container segment of a plan document or of run.meta, structurally. */
function unitOf(value: unknown): EvalExperimentUnit | null {
  if (!isPlainObject(value)) return null
  const image = stringOrNull(value['image'])
  if (image === null) return null
  return { image, network: stringOrNull(value['network']), user: stringOrNull(value['user']) }
}

/** The row of one experiment nobody has started (no run, so everything comes from the plan). */
async function draftRow(
  plan: PlanFile,
  stateRoot: string,
  job: EvalRunStatus | undefined,
  validate: ExperimentsInput['validate'],
): Promise<EvalExperimentRow> {
  const dataset = isPlainObject(plan.document['dataset']) ? plan.document['dataset'] : undefined
  const conditions = stringArray(plan.document['conditions'])
  const judgeSegment = isPlainObject(plan.document['judge']) ? plan.document['judge'] : undefined
  const validation = validate === undefined ? null : await validate(plan.record)
  const documents = await planConditionDocuments(stateRoot, conditions)
  return {
    id: `experiment:${plan.record.id}`,
    experimentId: plan.record.id,
    legacy: false,
    name: plan.record.meta.name,
    question: planQuestionOf(plan.document)?.question ?? null,
    planPath: plan.record.planPath,
    runId: null,
    status: deriveExperimentStatus({
      validation: validation === null ? null : { ok: validation.ok },
      run: null,
      job: job === undefined ? null : { status: job.status },
    }),
    statusDetail: job?.detail ?? null,
    snapshot: snapshotOf(plan.record),
    conditions,
    judges: stringArray(judgeSegment?.['conditions']),
    items: stringArray(dataset?.['items']).length,
    reps: numberOrNull(plan.document['reps']) ?? 0,
    factors: conditionFactors(documents),
    progress: null,
    startedAt: null,
    validation: validation === null
      ? null
      : { ok: validation.ok, errors: validation.errors.length, warnings: validation.warnings.length },
    unit: unitOf(plan.document['unit']),
    originSession: plan.record.meta.originSession,
    archived: false,
    closure: null,
    lastProgressAt: null,
    stalledMinutes: null,
  }
}

/** One run of the mission ledger, as this projection reads it. */
interface RunProjection {
  runId: string
  meta: Record<string, unknown>
  createdAt: number
  originSession: string | null
  rows: ReadonlyArray<{ labels: Record<string, string>; state: string; bucket: string; id: string; enteredCurrentAt?: number }>
  buckets: Record<string, string[]>
  unreleased: string[]
  /** The run-level marks (closure, archive) and the newest annotation, one ledger pass. */
  marks: ReturnType<typeof readRunMarks>
}

/**
 * The newest ledger movement of a run: a cell entering its current state, any
 * annotation, the run's own start. The floor is the run's creation, so a run
 * whose cells never moved still has an age.
 */
function lastProgressOf(run: RunProjection): number {
  let latest = Math.max(run.createdAt, numberOrNull(run.meta['startedAt']) ?? 0)
  for (const row of run.rows) {
    if (typeof row.enteredCurrentAt === 'number' && row.enteredCurrentAt > latest) latest = row.enteredCurrentAt
  }
  if (run.marks.lastAnnotationAt !== null && run.marks.lastAnnotationAt > latest) latest = run.marks.lastAnnotationAt
  return latest
}

/** Build a run's projection from one `runStatus` answer. */
function projectRun(mission: MissionRunListFace, status: ReturnType<MissionRunListFace['runStatus']>): RunProjection {
  return {
    runId: status.run.id,
    meta: status.run.meta,
    createdAt: status.run.createdAt,
    originSession: typeof status.run.originSession === 'string' && status.run.originSession !== ''
      ? status.run.originSession
      : null,
    rows: status.rows,
    buckets: status.buckets,
    unreleased: status.unreleased,
    marks: readRunMarks(mission, status.run.id, status.rows),
  }
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
function runRow(
  run: RunProjection,
  job: EvalRunStatus | undefined,
  now: number,
  experiment: ExperimentRecord | null = null,
  planDocument: unknown = null,
): EvalExperimentRow {
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
  const lastProgressAt = lastProgressOf(run)
  const status = deriveExperimentStatus({
    validation: null,
    run: { cellStates, buckets },
    job: job === undefined ? null : { status: job.status },
    closure: run.marks.closure,
    lastProgressAt,
    now,
  })
  return {
    id: run.runId,
    experimentId: experiment?.id ?? null,
    legacy: experiment === null,
    name: experiment?.meta.name ?? (planPath === null ? run.runId : basename(planPath).replace(/\.json$/, '')),
    question: planQuestionOf(planDocument)?.question ?? null,
    planPath,
    runId: run.runId,
    status,
    statusDetail: job?.detail ?? null,
    snapshot: {
      registry: experiment?.meta.dataset.registry ?? stringOrNull(meta['registry']),
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
    originSession: run.originSession,
    archived: run.marks.archive?.archived === true,
    closure: run.marks.closure,
    lastProgressAt,
    stalledMinutes: status === 'stalled' ? Math.floor((now - lastProgressAt) / 60_000) : null,
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
    runs.push(projectRun(mission, status))
  }
  return runs
}

/**
 * The runs of the ledger that belong to one experiment, by the same pairing
 * the list uses — the question "has this experiment started" asked of the
 * ledger, which is where a start is recorded (the plan is not written by it).
 * @param mission - the mission ledger.
 * @param plans - the deployment's experiments, for the plan-hash and path fallbacks.
 * @param experimentId - the experiment.
 * @returns the paired run ids; empty for an experiment nobody started.
 */
export function experimentRunIds(mission: MissionRunListFace, plans: readonly PlanFile[], experimentId: string): string[] {
  return evalRuns(mission, []).filter(run => pairRun(run.meta, plans)?.id === experimentId).map(run => run.runId)
}

/** What {@link listExperiments} needs; each source optional and degrading to a note. */
export interface ExperimentsInput {
  /** The mission ledger; absent lists experiments without their runs. */
  mission?: MissionRunListFace
  /** The eval state root holding `experiments/`; absent lists runs only. */
  stateRoot?: string
  /** Validate one unstarted experiment's plan; absent leaves drafts unvalidated. */
  validate?: (record: ExperimentRecord) => Promise<PlanValidation>
  /** Background run jobs this instance still holds (newest wins per run / per plan). */
  jobs?: readonly EvalRunStatus[]
  /** The calling session, echoed back so the browser can filter by `originSession`. */
  session?: string
  /** The clock the stall rule reads; defaults to `Date.now()`. */
  now?: number
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
 * Which experiment a run belongs to, or null for a run no experiment claims.
 *
 * Three keys, strongest first:
 * 1. `meta.experimentId` — every run started since T73 records it.
 * 2. `meta.planSha` — an older run whose plan was later imported verbatim
 *    hashes the same, which is exactly why import keeps the bytes.
 * 3. `meta.planPath` ending in an imported experiment's `source.path` — the
 *    last resort for a run whose plan was edited after it ran.
 * @param meta - the run's meta.
 * @param plans - the deployment's experiments.
 */
export function pairRun(meta: Record<string, unknown>, plans: readonly PlanFile[]): ExperimentRecord | null {
  const id = stringOrNull(meta['experimentId'])
  if (id !== null) {
    const hit = plans.find(plan => plan.record.id === id)
    if (hit !== undefined) return hit.record
  }
  const sha = stringOrNull(meta['planSha'])
  if (sha !== null) {
    const hit = plans.find(plan => plan.sha === sha)
    if (hit !== undefined) return hit.record
  }
  const planPath = stringOrNull(meta['planPath'])
  if (planPath !== null) {
    const normalized = planPath.split('\\').join('/')
    const hit = plans.find(plan => {
      const source = plan.record.meta.source?.path
      return source !== undefined && (normalized === source || normalized.endsWith(`/${source}`))
    })
    if (hit !== undefined) return hit.record
  }
  return null
}

/**
 * The lab list: one row per experiment nobody has started, one row per run.
 *
 * Each run is paired with its experiment by {@link pairRun}. A run no
 * experiment claims is still listed — it happened, and its report still opens
 * from its own run.meta — flagged `legacy` so the page can say 旧运行（未关联实验）.
 * @param input - the ledger, the state root, and this instance's jobs.
 * @returns rows newest-run-first, then unstarted experiments newest first.
 */
export async function listExperiments(input: ExperimentsInput): Promise<EvalExperimentsResult> {
  const notes: string[] = []
  const jobs = indexJobs(input.jobs ?? [])
  const runs = input.mission === undefined ? [] : evalRuns(input.mission, notes)
  if (input.mission === undefined) {
    notes.push('no mission service: run records live in the mission ledger, so only unstarted experiments are listed — mount the dsh-mission plugin')
  }
  const plans = input.stateRoot === undefined ? [] : await readPlans(input.stateRoot, notes)
  if (input.stateRoot === undefined) notes.push('no eval state root (DSH_HOME is unset): experiments are not listed, runs are')

  const now = input.now ?? Date.now()
  const started = new Set<string>()
  const runRows = runs.map((run) => {
    const experiment = pairRun(run.meta, plans)
    if (experiment !== null) started.add(experiment.id)
    const document = experiment === null ? null : plans.find(plan => plan.record.id === experiment.id)?.document ?? null
    return runRow(run, jobs.byRun.get(run.runId), now, experiment, document)
  })
  const draftRows: EvalExperimentRow[] = []
  for (const plan of plans) {
    if (started.has(plan.record.id)) continue
    draftRows.push(await draftRow(plan, input.stateRoot as string, jobs.byPlan.get(resolve(plan.record.planPath)), input.validate))
  }

  runRows.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))
  return { rows: [...runRows, ...draftRows], notes, session: input.session ?? null }
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
  now: number = Date.now(),
): EvalExperimentDetail {
  const status = mission.runStatus(runId)
  const job = indexJobs(jobs).byRun.get(runId)
  const projection = projectRun(mission, status)
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
    row: runRow(projection, job, now),
    meta: metaDigest(status.run.meta),
    readiness,
    buckets,
    states,
    unreleased: status.unreleased,
    job: jobView(job),
  }
}

/**
 * Every evaluation run that answered ONE dataset item — the 作答记录 the
 * item page shows (ui-spec §四: "作答记录不进题库；每次作答的产物在实验的格子里，
 * 题目详情按题目投影一份只读的作答记录").
 *
 * The projection is by LABEL: a cell belongs to an item when its `task` label
 * is that item's id and its run's `meta.datasetId` is that dataset. Both are
 * the orchestrator's own coordinates, so this cannot drift from the matrix.
 *
 * Read-only and degrading: no mission service lists nothing and says so. The
 * consumer (the 题集 tab, T47) hides the section when the answer is empty,
 * which is why an empty list still carries its reason.
 * @param mission - the mission ledger face.
 * @param datasetId - the dataset set the item belongs to.
 * @param itemId - the item (the `task` label).
 * @returns one row per run, newest first.
 */
export function runsForItem(
  mission: MissionRunListFace | undefined,
  datasetId: string,
  itemId: string,
): EvalItemRunsResult {
  const notes: string[] = []
  if (mission === undefined) {
    notes.push('no mission service: run records live in the mission ledger, so no answer record can be shown — mount the dsh-mission plugin')
    return { datasetId, itemId, runs: [], notes }
  }
  const runs: EvalItemRunRow[] = []
  for (const projection of evalRuns(mission, notes)) {
    if (stringOrNull(projection.meta['datasetId']) !== datasetId) continue
    const rows = projection.rows.filter(row => row.labels['task'] === itemId)
    if (rows.length === 0) continue
    const planPath = stringOrNull(projection.meta['planPath'])
    runs.push({
      runId: projection.runId,
      name: planPath === null ? projection.runId : basename(planPath).replace(/\.json$/, ''),
      startedAt: numberOrNull(projection.meta['startedAt']) ?? projection.createdAt,
      commit: stringOrNull(projection.meta['commit']),
      cells: rows.map((row) => {
        // ns → how many verdicts that namespace carries. A cell the ledger
        // cannot resolve reports none rather than failing the listing.
        const verdicts: Record<string, number> = {}
        try {
          for (const annotation of mission.get(row.id, projection.runId).mission.annotations) {
            if (annotation.ns === 'orchestrator') continue
            const payload = annotation.payload
            verdicts[annotation.ns] = (verdicts[annotation.ns] ?? 0) + (Array.isArray(payload) ? payload.length : 1)
          }
        } catch {
          /* an unreadable cell contributes no verdict counts */
        }
        const rep = Number(row.labels['rep'])
        return {
          missionId: row.id,
          condition: row.labels['condition'] ?? null,
          rep: Number.isFinite(rep) ? rep : null,
          state: row.state,
          bucket: row.bucket,
          verdicts,
        }
      }),
    })
  }
  runs.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))
  return { datasetId, itemId, runs, notes }
}
