/**
 * The eval orchestrator's WIRE vocabulary — the types its Remote face passes
 * over the boundary, exported through the `./types` subpath so the Typert
 * wire-schema generator resolves them from a public non-root path.
 *
 * Everything here is plain JSON. The run's own report types stay internal:
 * what crosses this boundary is a run's IDENTITY (job id, run id), its
 * lifecycle, and its log lines — the three things a caller outside the
 * instance (a CI runner) needs to start a run, watch it, and stop it.
 * @module @khorsheed/dsh-eval/types
 */

/** What one Remote-started run answers with, before any cell has run. */
export interface EvalRunStarted {
  /** The job registry's id (`eval-run-N`) — the handle for output and kill. */
  jobId: string
  /** The run id every cell, annotation and bundle carries. */
  runId: string
  /** The session every delegation of this run parents to. */
  parentSessionId: string
  /** True when the run opened that session for itself (no calling session had a live agent). */
  ownParentSession?: boolean
}

/** The knobs a Remote caller may set on a run. The mirror of the slash flags. */
export interface EvalRunRequest {
  /** Path to a `dataseek.plan/1` document ON THE INSTANCE (`~` expanded there). */
  plan: string
  /** Validate, generate the template, expand the matrix — execute nothing. */
  dryRun?: boolean
  /** Concurrent cells (host path only; a unit plan is serial). */
  concurrency?: number
  /** After archiving, attempt archived → releasable → released. */
  finalize?: boolean
  /** Bundle export directory, overriding the plan's own. */
  out?: string
  /** Infrastructure-retry budget per cell. */
  retries?: number
  /** Run only these mission ids. */
  only?: string[]
  /** Cap the number of cells. */
  maxCells?: number
  /** Start even when a condition failed the readiness probe (its cells record as skipped). */
  ignoreReadiness?: boolean
}

/** One background run's lifecycle state — the JOB, not the cell ledger. */
export interface EvalRunJobView {
  jobId: string
  runId: string
  /** `running` / `stopping` / `completed` / `killed` / `failed`. */
  status: string
  /** The producer's terminal detail, once it settled. */
  detail?: string
  /** Epoch ms the job was registered. */
  startedAt: number
  /** Epoch ms it settled; absent while live. */
  finishedAt?: number
  /** Log lines emitted so far — a fresh reader's starting cursor. */
  lines: number
}

/** One cursor read of a background run's log. */
export interface EvalRunOutputView {
  runId: string
  /** The lines after the caller's cursor, in emission order. */
  lines: string[]
  /** The cursor to pass on the next read. */
  cursor: number
  /** The job's lifecycle state at read time. */
  status: string
  /** The producer's terminal detail, once it settled. */
  detail?: string
  /** True once the job settled: no further lines will appear. */
  done: boolean
}

/* ───────────────────────── the lab tab's read face ───────────────────────── */

/**
 * Where one experiment stands, in the vocabulary the interface spec fixed
 * (ui-spec §五). Seven values, derived from three independent sources — the
 * plan's validate outcome, the mission ledger's cells, and the background
 * job — by {@link deriveExperimentStatus}, which is the only place the rule
 * lives.
 *
 * - `draft` — a plan file exists and validate has not passed (or never ran).
 * - `pending-approval` — validate passed and nobody has started it.
 * - `running` — the job is live, or cells are still moving.
 * - `judging` — every player cell reached `judged` or beyond, and the run is
 *   not finalized: what is left is the judge's and the human's.
 * - `done` — every player cell is `released`.
 * - `refused` — the job settled as failed (the readiness gate is the usual
 *   reason, and the usual one leaves no run in the ledger at all).
 * - `cancelled` — the job was killed.
 */
export type EvalExperimentStatus =
  | 'draft'
  | 'pending-approval'
  | 'running'
  | 'judging'
  | 'done'
  | 'refused'
  | 'cancelled'

/** The dataset snapshot an experiment is pinned to. */
export interface EvalExperimentSnapshot {
  /** The dataset repository; null when neither the plan nor the run says. */
  repo: string | null
  datasetId: string | null
  /** The pinned commit; null on a draft whose plan leaves it to the run. */
  commit: string | null
}

/** The container segment an experiment declares, when it declares one. */
export interface EvalExperimentUnit {
  image: string
  network: string | null
  user: string | null
}

/** One row of the lab list: a draft plan, or the run of one. */
export interface EvalExperimentRow {
  /** Stable row key: the run id when there is one, else `plan:<absolute path>`. */
  id: string
  /** Display name: the plan file's stem, falling back to the run id. */
  name: string
  /** The plan document (absolute); null when a run's meta does not record one. */
  planPath: string | null
  /** The mission run, when the experiment has been started. */
  runId: string | null
  status: EvalExperimentStatus
  /** The job's terminal detail behind a `refused` / `cancelled` status. */
  statusDetail: string | null
  snapshot: EvalExperimentSnapshot
  /** Player condition ids, in plan order. */
  conditions: string[]
  /** Judge condition ids; empty means no LLM judging this run. */
  judges: string[]
  /** Dataset items (tasks) the matrix runs over. */
  items: number
  /** Independent samples per cell. */
  reps: number
  /**
   * The condition fields the players do NOT agree on, as dotted paths — the
   * factor column. Computed from the condition documents by the same leaf
   * comparison `conditions diff` uses; `notes` never counts as a factor.
   * Empty when the run has one condition, or when no document could be read.
   */
  factors: string[]
  /** Cells settled / cells total; null for a draft (nothing is expanded yet). */
  progress: { done: number; total: number } | null
  /** Epoch ms the run started; null for a draft. */
  startedAt: number | null
  /** The plan's validate outcome; null when it was not run (a started run's plan is not re-validated). */
  validation: { ok: boolean; errors: number; warnings: number } | null
  /** The container segment, when the plan or the run declares one. */
  unit: EvalExperimentUnit | null
}

/** The lab list answer. */
export interface EvalExperimentsResult {
  /** The dataset repository the drafts were scanned in; null when none resolved. */
  repo: string | null
  /** The dataset sets scanned for drafts, in order. */
  datasets: string[]
  rows: EvalExperimentRow[]
  /**
   * Honest degrades, one sentence each: no session binding, an unreadable
   * plan, a mission service that cannot list runs. The list still answers.
   */
  notes: string[]
}

/** What narrows the lab list; every field optional (the session decides by default). */
export interface EvalExperimentsRequest {
  /** Dataset repository override; omit to use the calling session's binding. */
  repo?: string
  /** One dataset set; omit to scan every set of the repository that has plans. */
  dataset?: string
}

/** Which experiment the detail verb answers about. */
export interface EvalExperimentRequest {
  /** The mission run id. A draft has none — its overview is rendered from the row. */
  runId: string
}

/** One readiness probe as the run recorded it — the overview's verbatim block. */
export interface EvalReadinessLine {
  condition: string
  /** `player` or `judge`. */
  role: string
  harness: string
  /** The local-agent delegation provider the condition resolved to. */
  provider: string
  ok: boolean
  startedAt: number
  durationMs: number
  /** The child session the probe ran in; null when the start itself failed. */
  childSessionId: string | null
  declaredModel: string | null
  requestedModel: string | null
  observedModel: string | null
  /** The named scoped home the probe ran against; null for the default one. */
  scope: string | null
  /** Why the condition is not ready; null when it is. */
  reason: string | null
  /** Set when the ENVIRONMENT rather than the subject is broken (the egress check). */
  infrastructure: string | null
  /** The throwaway unit the probe ran in, on the container path. */
  unit: { resource: string; fingerprint: string } | null
}

/** The run.meta digest the overview page shows. */
export interface EvalExperimentMeta {
  planSha: string | null
  planPath: string | null
  evalVersion: string | null
  datasetId: string | null
  commit: string | null
  conditions: Array<{ id: string; sha: string | null; harness: string | null; model: string | null }>
  judge: { conditions: Array<{ id: string; sha: string | null }>; samples: number | null }
  order: { seed: number | null; sequence: string[] }
  concurrency: number | null
  budget: { activeMinutes: number | null; turns: number | null } | null
  expectedNs: string[] | null
  startedAt: number | null
  /** Readiness notes the run recorded at start (a missing lock, an unresolved field). */
  warnings: Array<{ code: string; message: string }>
}

/** The background job's lifecycle, when this instance still holds one for the run. */
export interface EvalExperimentJob {
  jobId: string
  status: string
  detail: string | null
  startedAt: number
  finishedAt: number | null
  lines: number
}

/** The lab detail answer: the row, plus everything only a started run has. */
export interface EvalExperimentDetail {
  row: EvalExperimentRow
  /** The run.meta digest; null when the run carries no eval meta. */
  meta: EvalExperimentMeta | null
  /** The readiness records, verbatim (the overview's 就绪检查原文 block). */
  readiness: EvalReadinessLine[]
  /** bucket → cell count over the whole run. */
  buckets: Record<string, number>
  /** template state → cell count (the matrix's stage histogram). */
  states: Record<string, number>
  /** Cells holding a resource they have not released — mission's leak warning. */
  unreleased: string[]
  job: EvalExperimentJob | null
}

/* ──────────────────── the matrix page and the cell drawer ─────────────────── */

/** One rep's dot in a matrix cell (ui-spec §五: 实心已判 / 半心进行中 / 空心未起). */
export type EvalRepDot = 'filled' | 'half' | 'empty'

/** One rep inside a matrix cell — one mission of the ledger. */
export interface EvalMatrixRep {
  /** The rep number from the cell's labels; null when the ledger does not say. */
  rep: number | null
  missionId: string
  condition: string | null
  dot: EvalRepDot
  /** The template state (`stage-1`, `judged`, `released`, …). */
  state: string
  /** mission's five-bucket projection. */
  bucket: string
  /** Nothing has happened here for longer than the run's threshold. */
  stuck: boolean
  inStateMs: number | null
}

/** One (task × column) cell of the matrix — the reps that landed in it. */
export interface EvalMatrixCell {
  task: string
  /** The column key this cell sits under (the canonical factor value). */
  column: string
  /** The condition ids that produced these reps — more than one when a factor rides along. */
  conditions: string[]
  reps: EvalMatrixRep[]
  /** The state the reps agree on, or `mixed (a / b)`. */
  stage: string
  /** At least one rep is stuck. */
  stuck: boolean
  /** This cell's material differs from the rest of its row — the red edge. */
  hashMismatch: boolean
  /** No materialization hash could be read for any rep here. */
  hashUnknown: boolean
}

/** One matrix row: a task, and one slot per column (null where nothing ran). */
export interface EvalMatrixRow {
  task: string
  cells: Array<EvalMatrixCell | null>
}

/** One factor and every value the run's conditions give it — the filter's menu. */
export interface EvalMatrixFactorValues {
  factor: string
  values: Array<{ key: string; label: string; conditions: string[] }>
}

/** One column header: the factor value, and which conditions carry it. */
export interface EvalMatrixColumn {
  /** Canonical JSON of the factor value; the empty string when there is no factor. */
  key: string
  label: string
  conditions: string[]
}

/** One band of rows — the remaining factors the reader chose to group by. */
export interface EvalMatrixGroup {
  key: string
  /** Empty when nothing is grouped (the single unnamed band). */
  label: string
  rows: EvalMatrixRow[]
}

/** One invariant line of the matrix footer. */
export interface EvalMatrixInvariant {
  status: 'ok' | 'violated' | 'unverifiable'
  detail: string
}

/** The run-level footer under the matrix (ui-spec §五). */
export interface EvalMatrixSummary {
  /** 题面一致: the per-task materialization hash. */
  materialization: EvalMatrixInvariant
  /** 环境一致: the run's `refs.fingerprint`. */
  fingerprint: EvalMatrixInvariant
  /** Cells holding a resource they have not released. */
  unreleased: number
  /** The report's judge-consistency line; null means 待报告. */
  judgeConsistency: string | null
  /** Cells sitting in one state past the threshold. */
  stuck: number
  /** Cells the arrangement kept. */
  cells: number
}

/** The matrix page's whole payload. */
export interface EvalMatrixView {
  runId: string
  /** Every factor the run's conditions disagree on, sorted. */
  factors: string[]
  /** Each factor's distinct values — what the filter may pin, and to what. */
  factorValues: EvalMatrixFactorValues[]
  /** The factor on the columns; null when the conditions agree on everything. */
  column: string | null
  /** The factors banding the rows. */
  groupBy: string[]
  /** The factors pinned to one canonical value. */
  filter: Record<string, string>
  columns: EvalMatrixColumn[]
  groups: EvalMatrixGroup[]
  summary: EvalMatrixSummary
  /** The stuck threshold this view was computed with. */
  stuckMs: number
}

/** What the matrix verb is asked for. */
export interface EvalMatrixRequest {
  runId: string
  /** The factor to put on the columns; omit for the first one. */
  column?: string
  /** Remaining factors to band the rows by. */
  groupBy?: string[]
  /** Remaining factors pinned to one canonical value each. */
  filter?: Record<string, string>
  /** Override the stuck threshold (ms). */
  stuckMs?: number
}

/** What the cell list is asked for — the same filters `eval_cells` takes. */
export interface EvalCellsRequest {
  runId: string
  bucket?: string
  task?: string
  condition?: string
}

/** One annotation namespace, as the drawer summarizes it. */
export interface EvalCellAnnotationNs {
  ns: string
  count: number
  /** Epoch ms of the newest entry. */
  latestAt: number | null
  /** A one-line digest of the newest entry (its `kind`, or its shape). */
  latest: string | null
  /** The writer of the newest entry (`tool:…`, `cli`, the orchestrator tag). */
  by: string | null
}

/**
 * One probe run VERBATIM — the verify output the drawer shows whole.
 *
 * These come from the orchestrator's `kind: 'probes'` annotation, which is
 * what `lab.verify` produced on the container path and what the host executor
 * produced on the host path. There is no `lab` annotation namespace on this
 * line, and inventing one here would have made the drawer claim a source that
 * does not exist.
 */
export interface EvalCellProbeRun {
  /** Epoch ms the annotation was written. */
  at: number
  /** `host` or `unit` — where the probes ran. */
  where: string | null
  /** The whole payload, pretty-printed: nothing summarized away. */
  raw: string
  /** The per-probe lines, for the compact list above the raw block. */
  probes: Array<{
    probe: string | null
    origin: string | null
    exitCode: number | null
    outcome: string | null
    ok: boolean
    verdicts: number | null
    durationMs: number | null
    error: string | null
    reason: string | null
  }>
}

/** One attempt of a cell, as the drawer lists them. */
export interface EvalCellAttempt {
  attempt: number
  state: string | null
  /** Set only on attempts a retry opened. */
  retry: { reason: string | null; category: string | null; at: number | null; by: string | null } | null
  refs: { resource: string | null; fingerprint: string | null; sessions: string[] }
  /** Checkpoint names in the order they were reached, with their times. */
  checkpoints: Array<{ name: string; at: number | null }>
  artifacts: Array<{ path: string; kind: string; addedAt: number | null }>
  /** Applied transitions, oldest first. */
  history: Array<{ from: string; to: string; at: number | null }>
}

/** The cell drawer's payload: everything about ONE cell. */
export interface EvalCellDetail {
  runId: string
  missionId: string
  title: string | null
  task: string | null
  condition: string | null
  rep: number | null
  labels: Record<string, string>
  state: string
  bucket: string
  attempt: number
  enteredCurrentAt: number | null
  inStateMs: number | null
  refs: { resource: string | null; fingerprint: string | null }
  /** The materialization digest of the current attempt; null when unread. */
  materializationSha: string | null
  /**
   * The delegation's child session, when the attempt started one. The drawer's
   * 打开子会话 opens it with the host's own `sessions.open` — reading the
   * player's transcript, never steering it mid-run.
   */
  childSessionId: string | null
  attempts: EvalCellAttempt[]
  annotations: EvalCellAnnotationNs[]
  /** The verify runs, verbatim. */
  probes: EvalCellProbeRun[]
  /** Whether this cell's resources may be destroyed right now. */
  releasable: boolean
}

/** Which cell a per-cell verb is about. */
export interface EvalCellRequest {
  runId: string
  missionId: string
}

/** `retry` — a fresh attempt, and the auditable reason it demands. */
export interface EvalCellRetryRequest extends EvalCellRequest {
  reason: string
  /** mission's own vocabulary: infrastructure / operator / outcome. */
  category: string
}

/** What a retry answers with. */
export interface EvalCellRetryResult {
  attempt: number
}

/** The release check's answer. */
export interface EvalCellReleaseResult {
  missionId: string
  releasable: boolean
}

/** The export dialog's first step — forwarded to mission verbatim. */
export interface EvalExportPlanRequest {
  runId: string
  outDir: string
  layers?: string[]
  snapshotDir?: string
  snapshot?: { repo: string; commit: string; dataset?: string }
  guarded?: string[]
}

/** The export dialog's confirm step. */
export interface EvalExportRunRequest extends EvalExportPlanRequest {
  /** The guarded layers the human ticked — re-checked against a FRESH plan by mission. */
  confirmed: string[]
}

/** The plan view the dialog renders. */
export interface EvalExportPlanView {
  bundleDir: string
  /** Layers the human must confirm one by one before anything is written. */
  guardedLayers: string[]
  expectedNs: string[] | null
  missions: number
  attempts: number
}

/** The export outcome. */
export interface EvalExportResultView {
  bundleDir: string
  files: number
}

/** One run's answer for one dataset item — the 作答记录 of the item page (T47). */
export interface EvalItemRunRow {
  runId: string
  /** The plan's file stem, falling back to the run id. */
  name: string
  startedAt: number | null
  commit: string | null
  /** The cells of THIS item, one per condition × rep. */
  cells: Array<{
    missionId: string
    condition: string | null
    rep: number | null
    state: string
    bucket: string
    /** ns → how many verdicts that namespace carries for this cell. */
    verdicts: Record<string, number>
  }>
}

/** What the item-answers verb is asked for. */
export interface EvalItemRunsRequest {
  datasetId: string
  itemId: string
}

/** The 作答记录 answer: every eval run that ran this item. */
export interface EvalItemRunsResult {
  datasetId: string
  itemId: string
  runs: EvalItemRunRow[]
  /** Honest degrades, one sentence each. */
  notes: string[]
}

/**
 * One row of the CELLS page's table. A restatement of the slice `runCells`
 * projects — not a second projection: the verb feeds this from that one
 * function, so the tab, the `eval_cells` tool and the matrix can never
 * disagree about a cell. It is restated here rather than re-exported because
 * every Remote boundary type must be reachable from this `./types` subpath,
 * and pulling the host-side read module in would drag `node:fs` into the
 * browser half's type program for no gain.
 */
export interface EvalCellRow {
  missionId: string
  task: string | null
  condition: string | null
  rep: number | null
  /** The template state (the stage). */
  state: string
  /** mission's five-bucket projection. */
  bucket: string
  attempt: number
  /** How long the cell has been in its current state; null when the ledger does not say. */
  inStateMs: number | null
  refs: { resource: string | null; fingerprint: string | null }
  /** Checkpoint names of the current attempt. */
  checkpoints: string[]
  /** ns → how many annotations the cell carries, across attempts. */
  annotations: Record<string, number>
  childSessionId: string | null
}

/** The CELLS page's answer: the run's shape, then the rows the filter kept. */
export interface EvalCellsResult {
  runId: string
  /** The RUN's state (`active` / `closed`), not a cell's. */
  state: string
  /** The filter that was applied, echoed. */
  filter: { bucket?: string; task?: string; condition?: string }
  /** Cells in the run, before the filter. */
  total: number
  /** Cells the filter kept. */
  matched: number
  /** bucket → how many cells of the WHOLE run sit in it. */
  buckets: Record<string, number>
  rows: EvalCellRow[]
}
