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

/* ─────────────────── the plan-review and conditions pages ─────────────────── */

/**
 * One line of the plan review's validate list (ui-spec §五: `ok / warn / error`
 * 逐条). The three severities are the reviewer's whole decision procedure: an
 * `error` blocks approval, a `warn` is something to have read before approving,
 * and an `ok` line is a condition that resolved — the list must say what passed
 * as well as what did not, or a clean plan renders as an empty page.
 */
export interface EvalPlanCheck {
  severity: 'ok' | 'warn' | 'error'
  /** validate's own diagnostic code, or `CONDITION_READY` for a resolved condition. */
  code: string
  message: string
}

/** One condition a plan names, as the review page reports it. */
export interface EvalPlanCondition {
  id: string
  role: 'player' | 'judge'
  /** sha256 of the declaration; null when it is unreadable or contract-violating. */
  sha: string | null
  /** `ready` / `unready` / `missing`, from the resolver validate itself uses. */
  status: string
  /** The lock beside the declaration: present, still matching, home hashed. */
  lock: { present: boolean; matches: boolean; homeSha: string | null }
}

/** The plan document's own digest — the review page's kv block. */
export interface EvalPlanDigest {
  /** What the plan pins: repository, dataset set, commit (null = pinned at run start). */
  dataset: { repo: string | null; id: string | null; commit: string | null }
  /** The item ids the matrix runs over, in plan order. */
  items: string[]
  /** Player condition ids, in plan order. */
  conditions: string[]
  /** The judge conditions and the sampling count; samples null when no judge is declared. */
  judge: { conditions: string[]; samples: number | null }
  reps: number | null
  stages: string[]
  /** The shuffle seed, and whether same-condition cells are deliberately spread apart. */
  order: { seed: number | null; interleave: boolean | null }
  budget: { activeMinutes: number | null; turns: number | null } | null
  expectedNs: string[]
  /** Per-cell infrastructure-retry budget; null when the plan leaves the default. */
  retryInfrastructure: number | null
  /** Bundle export directory the plan names; null for the default. */
  exports: string | null
  unit: EvalExperimentUnit | null
  /** The plan's own review commentary, verbatim; null when it carries none. */
  notes: string | null
}

/** The plan-review page's answer: what the plan says, and what validate makes of it. */
export interface EvalPlanReview {
  /** The plan document (absolute). */
  planPath: string
  schema: string
  /** True when validate found no ERROR. Warnings never block approval. */
  ok: boolean
  errors: number
  warnings: number
  /** The plan's own fields; null when the document could not be read at all. */
  digest: EvalPlanDigest | null
  /** validate, line by line — errors first, then warnings, then the resolved conditions. */
  checks: EvalPlanCheck[]
  /** Every condition the plan names, players first, then judges. */
  conditions: EvalPlanCondition[]
}

/** Which plan the review verb answers about. */
export interface EvalPlanRequest {
  /** Path to a `dataseek.plan/1` document ON THE INSTANCE (`~` expanded there). */
  planPath: string
}

/** One row of the conditions page's table. */
export interface EvalConditionRow {
  id: string
  /** The dataset set whose `conditions/` directory declares it. */
  dataset: string
  harness: string | null
  /** `exec` — the only drive a condition may declare (frozen decision 2). */
  drive: string | null
  /** The DECLARED model; what a run observed lives in that run's annotations. */
  model: string | null
  /** The named scoped home, or null for the harness's default one. */
  scope: string | null
  /** The agent-preset roster the condition runs under, or null for none. */
  preset: string | null
  sha: string | null
  lock: {
    present: boolean
    matches: boolean
    homeSha: string | null
    /** Epoch ms `conditions provision` wrote the lock; null on a lock written before it existed. */
    provisionedAt: number | null
    cliVersion: string | null
  }
  /** `ready` / `unready` / `missing` — the same word the CLI listing prints. */
  status: string
  /** Nullable contract fields still unresolved, as dotted paths. */
  unresolved: string[]
  /** Contract violations, one message each (these make the condition unusable). */
  errors: string[]
  /** Readiness notes, one message each. */
  warnings: string[]
}

/** The conditions page's answer. */
export interface EvalConditionsView {
  /** The dataset repository the listing resolved against. */
  repo: string
  /** The dataset sets scanned, in order. */
  datasets: string[]
  rows: EvalConditionRow[]
}

/** What narrows the conditions listing; the session's binding decides by default. */
export interface EvalConditionsRequest {
  repo?: string
  dataset?: string
}

/**
 * One field two conditions disagree on. Values travel as CANONICAL JSON TEXT,
 * not as raw JSON: the wire schema would otherwise have to say `unknown` for a
 * field whose type is whatever the declaration holds, and the page renders the
 * two sides as text either way. `null` means the field is ABSENT on that side,
 * which is a difference like any other (`scope` absent versus `scope: "eval-b"`
 * is exactly the two-subjects case the field exists for).
 */
export interface EvalConditionFieldDiff {
  /** Dotted path, e.g. `model.declared`, `unit.scopedHome.container`. */
  path: string
  a: string | null
  b: string | null
}

/** One side of a condition diff. */
export interface EvalConditionDiffSide {
  id: string
  /** The declaration that was read (absolute). */
  path: string
  sha: string | null
}

/** The conditions page's diff: what differs, and nothing else. */
export interface EvalConditionDiffView {
  a: EvalConditionDiffSide
  b: EvalConditionDiffSide
  /** True when the two hash alike (`notes` excluded, as everywhere). */
  identical: boolean
  /** True when `notes` differs and nothing else does — a comment edit is not a factor. */
  notesOnly: boolean
  /** ONLY the differing paths, sorted. A field both sides agree on never appears. */
  differences: EvalConditionFieldDiff[]
}

/** Which two conditions to diff (a condition id, or a path). */
export interface EvalConditionDiffRequest {
  a: string
  b: string
  repo?: string
  dataset?: string
}

/** Which plan a human is approving. */
export interface EvalApproveRequest {
  /** Path to a `dataseek.plan/1` document ON THE INSTANCE (`~` expanded there). */
  planPath: string
}

/**
 * What approving answers with. A refusal is DATA, not a thrown error: the page
 * shows the same validate list either way, and the reason a plan was not
 * started belongs beside the list that explains it.
 */
export interface EvalApproveResult {
  /** True when the run was started; false when it was refused. */
  started: boolean
  /** The validate list, exactly as the review page renders it — refusal included. */
  checks: EvalPlanCheck[]
  /** Why the approval was refused, verbatim; null when it started. */
  refusal: string | null
  jobId: string | null
  runId: string | null
  /** The session every delegation parents to — the approving session itself. */
  parentSessionId: string | null
}
