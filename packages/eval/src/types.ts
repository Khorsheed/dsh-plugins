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
  /**
   * After archiving, attempt archived → releasable → released and destroy the
   * cell's unit. The DEFAULT since T57: send `false` (or `keepUnits`) to stop
   * at `archived` instead.
   */
  finalize?: boolean
  /**
   * Keep every cell's container: stop at `archived` and release nothing. The
   * same axis as `finalize: false`, named the way an operator asks for it, and
   * it wins when both are sent.
   */
  keepUnits?: boolean
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
  /**
   * The DECLARED endpoint (`"default"` = the harness's own, no base URL in
   * force); null while unresolved, which the pre-run readiness gate refuses.
   * A column rather than a detail because it is the field a condition most
   * often stalls on, and the page is where it gets corrected.
   */
  endpoint: string | null
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

/**
 * Which condition the conditions page is provisioning. Named by set and id
 * rather than by path: the page resolves against the session's binding like
 * every other verb on it, and a browser that could name a PATH to write a lock
 * into would be choosing the working copy — which is the human's binding
 * decision, not the page's.
 */
export interface EvalConditionProvisionRequest {
  /** The dataset set whose `conditions/` directory declares it. */
  dataset: string
  /** The condition id (its file stem). */
  condition: string
  /**
   * Leave the declaration's `home.sha` alone instead of correcting it from
   * what was measured. Absent = correct it, which is what makes «provision»
   * one action rather than two (I5·T39 · G7).
   */
  keepDeclaration?: boolean
}

/** What one provision from the conditions page did. */
export interface EvalConditionProvisionView {
  condition: string
  dataset: string
  /** The declaration it ran against (absolute). */
  conditionPath: string
  /** The scoped home the condition resolved to; reading it materializes it. */
  homeDir: string
  /** The credential grade at provision time — `absent` prints the login command below. */
  credentialState: string
  /** Whether the lock was written; true means the condition is now ready. */
  written: boolean
  /** Whether this call corrected the declaration's `home.sha` and re-hashed it. */
  homeShaWritten: boolean
  /** The condition hash as the declaration now reads. */
  sha: string
  /** The scoped home's hash; null when the run stopped before hashing it. */
  homeSha: string | null
  /** Field verdicts and diagnostics, flattened for the page in contract order. */
  checks: EvalPlanCheck[]
  /** The registry row as it now reads; null when the listing could not be retaken. */
  row: EvalConditionRow | null
}

/** Which condition's `model.endpoint` a human is setting, and to what. */
export interface EvalConditionEndpointRequest {
  dataset: string
  condition: string
  /**
   * The upstream route. `"default"` is the harness's own endpoint with no base
   * URL in force; empty or null declares "not resolved yet", which the
   * readiness gate refuses.
   */
  endpoint: string | null
}

/** What one endpoint edit changed. */
export interface EvalConditionEndpointView {
  condition: string
  dataset: string
  /** The declaration that was written (absolute). */
  conditionPath: string
  before: string | null
  after: string | null
  /** The condition hash as the declaration now reads. */
  sha: string
  /** Whether anything was written — false when the value was already this. */
  written: boolean
  /**
   * Whether a lock sits beside the declaration that this edit just made stale.
   * `model.endpoint` is hash input, so the subject changed identity and the
   * lock now anchors a document that no longer exists: provision again.
   */
  lockStale: boolean
  /** The registry row as it now reads; null when the listing could not be retaken. */
  row: EvalConditionRow | null
}

/** Which plan a human is approving, and on what terms. */
export interface EvalApproveRequest {
  /** Path to a `dataseek.plan/1` document ON THE INSTANCE (`~` expanded there). */
  planPath: string
  /**
   * The dialog's 保留单元 box: stop every cell at `archived` and keep its
   * container for someone to open. Absent or false is the default — the run
   * walks the release gate cell by cell and holds one unit at a time.
   */
  keepUnits?: boolean
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

/* ──────────────── the 新建实验 form (ui-spec §五, step 2) ──────────────── */

/**
 * One condition the draft MINTS: a copy of a declaration that already exists,
 * with some of the six fields ui-spec §五 lists changed. There is deliberately
 * no shape here for a condition written from scratch — an experiment is worth
 * running when its conditions differ in one field, and a declaration nobody
 * copied differs in however many its author forgot to think about.
 *
 * Every field except `id` and `from` is optional, and an edit that changes
 * NOTHING is refused: that would be the same subject under a second name, and
 * it would double every count keyed by condition id.
 */
export interface EvalDraftConditionRequest {
  /** The new condition's id; it doubles as the file name. */
  id: string
  /** The condition to copy, by id, in the same dataset set. */
  from: string
  /** `harness.name`. Changing it nulls `harness.version` — that version was another CLI's. */
  harness?: string
  /** `model.declared`; null is the legal "not resolved yet" declaration. */
  model?: string | null
  /**
   * `model.endpoint` — the upstream route. `"default"` is the harness's own
   * endpoint with no base URL in force; null is the "not resolved yet"
   * declaration the readiness gate refuses, which is why the field is here at
   * all (I5·T39 · G6).
   */
  endpoint?: string | null
  /** The named scoped home, or null for the harness's default one. */
  scope?: string | null
  /** The agent-preset roster, or null for none. */
  preset?: string | null
  /** The harness's permission word. */
  permissions?: string
  /** `reasoning.effort`. */
  reasoning?: string
}

/** The container segment a drafted plan may declare. */
export interface EvalDraftUnitRequest {
  /** Image tag or digest of the dataset suite's env/ layer. */
  image: string
  /** The docker network the units join; undeclared is the default bridge, which HAS egress. */
  network?: string
  /** In-container user (uid[:gid]). */
  user?: string
  /** argv of the per-unit egress probe; empty declares none. */
  egressCommand?: string[]
  /** Budget for that probe, in ms. */
  egressTimeoutMs?: number
}

/**
 * What the 新建实验 form (and `eval_plan_draft`) sends. The fields are ui-spec
 * §五's list, flattened: the form's own shape and the tool's arguments are the
 * same request because they reach the same service verb.
 */
export interface EvalDraftRequest {
  /** The experiment name — the plan's file stem (`plans/<name>.json`). */
  name: string
  /** The dataset set to draft into. */
  dataset: string
  /** Dataset repository override; omit to use the calling session's binding. */
  repo?: string
  /** The commit to pin, or omit to let the run's snapshot pin it. */
  commit?: string | null
  /** The dataset items the matrix runs over. */
  items: string[]
  /** Player condition ids; a minted condition not named here is appended. */
  conditions: string[]
  /** Conditions to mint, each a copy of an existing declaration. */
  newConditions?: EvalDraftConditionRequest[]
  /** Judge condition ids; empty writes no judge block at all. */
  judgeConditions?: string[]
  /** Judge samples per cell; ignored without judge conditions. */
  judgeSamples?: number
  /** Independent samples per cell. */
  reps: number
  /** Stage names, each backed by `schemas/<stage>.json`. */
  stages: string[]
  /** The order seed, recorded with the run (frozen decision 11). */
  seed: number
  /** Whether same-condition cells are deliberately spread apart; default true. */
  interleave?: boolean
  /** Per-cell budget in ACTIVE minutes (not wall clock). */
  activeMinutes: number
  /** Per-cell delegation turns. */
  turns: number
  /** Verdict sources the run expects; omit for script + llm-draft + human-final. */
  expectedNs?: string[]
  /** Per-cell infrastructure-retry budget; omit to leave the default. */
  retryInfrastructure?: number
  /** The container segment; omit for the host path. */
  unit?: EvalDraftUnitRequest
  /** Bundle export directory; omit for the repository's own `exports/`. */
  exports?: string
  /** Review commentary, written into the plan verbatim. */
  notes?: string
}

/**
 * What drafting answers with: where the files landed, and what validate makes
 * of them.
 *
 * `review` is the plan-review page's own payload, not a summary of it — the
 * same projection of the same `validatePlan`, so the sentence an agent reports
 * to a person and the list that person then reads on the page cannot disagree.
 * A draft with errors is still a draft: it is on disk, the lab list shows it
 * as 草稿, and `review.ok` is false. Drafting refuses only when there would be
 * no draft to look at.
 */
export interface EvalDraftResult {
  /** The dataset repository written into (absolute). */
  repo: string
  dataset: string
  /** The plan document (absolute). */
  planPath: string
  /** The condition declarations minted, in mint order (absolute); empty when none were. */
  conditionPaths: string[]
  /** The plan's player condition ids as written, minted ones included. */
  conditions: string[]
  /** The plan's judge condition ids as written; empty when it declares no judge. */
  judges: string[]
  /** validate's verdict on what was just written, as the review page renders it. */
  review: EvalPlanReview
}

/** What the 新建实验 form's pickers are filled from. */
export interface EvalDraftOptionsRequest {
  /** Dataset repository override; omit to use the calling session's binding. */
  repo?: string
}

/** One dataset set the form may draft into. */
export interface EvalDraftDatasetOption {
  id: string
  /** Item ids the set declares, sorted — the 题目多选 list. */
  items: string[]
  /** Stage names it ships a schema for, sorted. */
  stages: string[]
}

/** The form's vocabulary: which sets exist, and what each holds. */
export interface EvalDraftOptionsView {
  /** The dataset repository the options were read from (absolute); null when none resolved. */
  repo: string | null
  datasets: EvalDraftDatasetOption[]
  /** Honest degrades, one sentence each — the list still answers. */
  notes: string[]
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
  /**
   * The run's originSession — the PARENT of every delegation it made
   * (decision 1), and the address without which no child session on this
   * page can be opened at all: the host refuses a subagent session addressed
   * on its own («subagent Sessions require their durable parent address»).
   * Null on a run the ledger recorded without one, which makes the buttons
   * fall back to selecting by id.
   */
  parentSessionId: string | null
  /**
   * The JUDGE's rounds on this cell, each with its own child session. A judge
   * is a delegation like any other and its transcript is a host session the
   * same way the player's is — it simply never had a door on this page, so
   * «为什么判成这样» could only be answered from the verdict's `evidence`.
   * One entry per recorded judge round, oldest first; a round that failed
   * before it started carries a null session and its error.
   */
  judgeSessions: EvalCellJudgeSession[]
  attempts: EvalCellAttempt[]
  annotations: EvalCellAnnotationNs[]
  /** The verify runs, verbatim. */
  probes: EvalCellProbeRun[]
  /** Whether this cell's resources may be destroyed right now. */
  releasable: boolean
}

/** One judge round on a cell, as the drawer offers it. */
export interface EvalCellJudgeSession {
  /** The judge condition id. Un-blinded: this page names the player too. */
  judgeCondition: string | null
  judgeModel: string | null
  /** Which sample of that judge this round was; null when the round recorded none. */
  sample: number | null
  /** The attempt this round judged. */
  attempt: number | null
  /** The round's child session — null when the delegation never started one. */
  childSessionId: string | null
  at: number
  /** Whether the judge judged its own condition's work. */
  selfJudged: boolean
  /** The round's recorded failure, verbatim; null when it settled. */
  error: string | null
}

/** Which artifact of which cell `cellArtifact` is asked for. */
export interface EvalCellArtifactRequest {
  runId: string
  missionId: string
  /** The attempt whose run-data directory the path is resolved against. */
  attempt: number
  /** The artifact path exactly as the ledger recorded it. */
  path: string
}

/**
 * One artifact, read in place. `kind` says which of the three answers this
 * is: the text, a directory's entries, or the refusal to inline bytes nobody
 * can read as text.
 */
export interface EvalCellArtifactView {
  runId: string
  missionId: string
  attempt: number
  path: string
  kind: 'text' | 'directory' | 'binary'
  /** A directory's entry names, sorted; empty for the other two kinds. */
  entries: string[]
  /** Whether the text was cut at the byte cap, or the listing at the entry cap. */
  truncated: boolean
  /** The file's size on disk; null for a directory. */
  bytes: number | null
  /** The text, up to the byte cap; null for a directory or a refused binary. */
  text: string | null
  /** Why it was cut, listed or refused — shown beside the content, never instead of it. */
  note: string | null
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

/**
 * The export outcome — the bundle AND the report written into it.
 *
 * One action writes both since I5·T60. Before it, the page's 导出 wrote the
 * bundle and the report page then printed a command line for the reader to go
 * and run (`dsh-eval report <bundle>`), which is how a walkthrough that had
 * everything on screen still ended at a terminal (I5·T39 · G15). The CLI verb
 * stays — it is how a bundle from anywhere gets a report — but the page no
 * longer needs it.
 */
export interface EvalExportResultView {
  bundleDir: string
  files: number
  /** Epoch ms of the export; the field the staleness sentence compares. */
  exportedAt: number
  /** `report/summary.md` inside the bundle; null when the report could not be written. */
  summaryPath: string | null
  /** Verdict rows the written report carries. */
  reportRows: number
  /** Why no report was written beside the bundle; null when one was. */
  reportError: string | null
  /** Whether the run-level export note reached the ledger (the page's way back here). */
  noteRecorded: boolean
}

/** Which run to export again, after the final verdicts (I5·T39 · G17). */
export interface EvalReexportRequest {
  runId: string
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

// --- the report page (I5·T38) ------------------------------------------------

/** Which run's report is wanted, and where to look for its bundle. */
export interface EvalReportRequest {
  runId: string
  /**
   * The export directory to look in FIRST — the one a human just typed into
   * the export dialog. Absent falls back to the plan's own `exports` and then
   * to `<dataset repo>/exports` (decision 11), which is where a run the
   * orchestrator exported for itself put its bundle.
   */
  outDir?: string
}

/** One of the four architecture-§5 invariants, as the report page shows it. */
export interface EvalReportInvariant {
  id: string
  title: string
  status: 'ok' | 'violated' | 'unverifiable'
  /** The facts behind the verdict, verbatim — never summarized into the word. */
  details: string[]
}

/**
 * One judge that judged a cell behind a paired row. `selfJudged` is the whole
 * reason this rides the comparison table at all: decision 9 (relaxed
 * 2026-09-10) lets a judge be a player and DISCLOSES it per cell instead of
 * excluding it, so a reader weighing a delta sees whose opinion it is.
 */
export interface EvalReportJudgeTag {
  condition: string
  model: string | null
  selfJudged: boolean
}

/** One task's row of a pair's difference table (rep-matched, current attempts). */
export interface EvalReportPairRow {
  task: string
  /** Mean scored-criterion count per side; a negative criterion scores when it does NOT hold. */
  aMean: number
  bMean: number
  delta: number
  /** Weighted score per side, and its difference; null when the rubric declares no weights. */
  aWeighted: number | null
  bWeighted: number | null
  weightedDelta: number | null
  /** Per-rep deltas — the resampling unit, shown so the spread is visible. */
  deltas: number[]
  /** Rep pairs available for this task. */
  n: number
  /** Who judged this task's cells on either side; empty when the bundle recorded no identity. */
  judges: EvalReportJudgeTag[]
}

/** One condition pair's comparison block. */
export interface EvalReportPair {
  a: string
  b: string
  /** The derived factor: one differing field, several (多因子), or unknown. */
  factor: { factor: string | null; multi: string[] | null; known: boolean; detail: string }
  rows: EvalReportPairRow[]
  /** Smallest per-task rep-pair count — the rank gate (n < 3 refuses to rank). */
  n: number
  ci: { mean: number; lo: number; hi: number; samples: number; seed: number } | null
  rank: 'a' | 'b' | null
  /** Why it ranked, or why it would not — verbatim from the report. */
  rankReason: string
}

/** One verdict behind a criteria-table cell, as the report page shows it. */
export interface EvalReportCriterionSample {
  missionId: string
  rep: number | null
  /** `human-final` / `llm-draft` / `script` — the layer this sample was written in. */
  ns: string
  /** The criterion HOLDS; on a negative criterion that is the defect. */
  pass: boolean
  ratio: { passed: number; total: number } | null
  /** The verdict's own checkable fact, verbatim — folded to one line on screen. */
  evidence: string
  by: string
  /** The judge, un-blinded (the report page is where the blind comes off). */
  judge: { condition: string; model: string | null; selfJudged: boolean; sample: number | null } | null
}

/** One (criterion × comparison group) cell of a task's criteria table. */
export interface EvalReportCriterionCell {
  condition: string
  /** Reps of this group that judged the criterion; 0 renders as a dash, not a ✗. */
  reps: number
  heldReps: number
  /** Mean credit over those reps, polarity NOT applied. */
  credit: number | null
  holds: boolean | null
  /** True when a sample declared a `ratio` — the cell prints a proportion, not a tick. */
  proportional: boolean
  /** Layer → reps that scored from it; more than one key is a mixed cell. */
  sources: Record<string, number>
  samples: EvalReportCriterionSample[]
  /** Judge drafts a human-final replaced — kept beside the new verdict. */
  superseded: EvalReportCriterionSample[]
}

/** One rubric row of the criteria table. */
export interface EvalReportCriterionRow {
  id: string
  /** The rubric's sub-axis — the DIMENSION, and the closest thing to a title a bundle carries. */
  axis: string | null
  kind: string | null
  weight: number | null
  negative: boolean
  /** True when only the verdicts name this criterion, not the rubric. */
  undeclared: boolean
  cells: EvalReportCriterionCell[]
}

/**
 * One task's 判据 × 对比组 table: rows are criteria, columns are comparison
 * groups, and the bottom row is the task's own score — the SAME number the
 * pair table prints, from the same computation.
 */
export interface EvalReportTaskCriteria {
  task: string
  conditions: string[]
  rows: EvalReportCriterionRow[]
  totals: Array<{ condition: string; scored: number | null; weighted: number | null; reps: number }>
}

/** One condition's efficiency row. Parallel columns, never summed into a score. */
export interface EvalReportEfficiencyRow {
  condition: string
  model: string | null
  /** Delegation time over COMPLETED cells only — active time, not wall clock. */
  activeMs: number | null
  rounds: number | null
  outputTokens: number | null
  inputTokens: number | null
  cacheReadTokens: number | null
  /** Null when no round reported an accounting — a dash, never a zero nobody observed. */
  toolCalls: number | null
  price: number | null
}

/** Cells one condition's efficiency row deliberately left out, by state. */
export interface EvalReportExcluded {
  condition: string
  state: string
  count: number
}

/** Judge consistency for the whole run — one judge sampled twice, and the panel. */
export interface EvalReportJudgeConsistency {
  /** Criteria (per cell) with ≥2 llm-draft samples. */
  multiSampled: number
  llmAgreement: { agreed: number; total: number } | null
  /** Cohen κ over ONE judge's repeated samples; null when no criterion had two. */
  llmKappa: number | null
  humanAgreement: { agreed: number; total: number } | null
  /** Criteria judged by two or more DIFFERENT judge conditions — the panel's number. */
  crossJudged: number
  crossAgreement: { agreed: number; total: number } | null
  crossKappa: number | null
  /** Criteria whose llm-draft verdicts include at least one self-judged sample. */
  selfJudgedCriteria: number
  /** The report's own sentences, verbatim. */
  details: string[]
}

/**
 * The report page's payload: the four invariants, the comparison (only when
 * all four are established), the efficiency table and the judge numbers.
 *
 * Every number here is {@link EvalReport}'s — this is a PROJECTION, not a
 * second analysis. The page cannot open a comparison the bundle's invariants
 * closed, because `comparisonAllowed` and `pairs` are decided before the wire.
 */
export interface EvalRunReportView {
  runId: string
  /** The bundle the numbers came from; null when nothing has been exported yet. */
  bundleDir: string | null
  /** The directories that were looked in, in order — the honest "export first" answer. */
  searched: string[]
  /** Why there is no report; null when there is one. */
  refusal: string | null
  /** The `dsh-eval report` command that writes results.jsonl / summary.md to disk. */
  cliHint: string | null
  /**
   * When the bundle on screen was written (`manifest.json`'s own `exportedAt`),
   * or null when the bundle carries no readable manifest.
   */
  exportedAt: number | null
  /** The newest `human-final` verdict of the run, or null when none exists. */
  lastHumanFinalAt: number | null
  /**
   * True when the bundle was exported BEFORE the last final verdict — the
   * numbers on screen were computed without it, and a re-export is the fix
   * (I5·T39 · G17).
   */
  staleAfterFinal: boolean
  /** Whether `report/summary.md` is in the bundle (every export since T60 writes it). */
  summaryWritten: boolean
  /** Whether a recorded export can be repeated in one click (a note exists). */
  reexportable: boolean
  invariants: EvalReportInvariant[]
  /** True only when all four invariants are established. */
  comparisonAllowed: boolean
  /** A single-condition run: nothing to pair, which is not a failure. */
  singleCondition: boolean
  /** Empty when comparison is not allowed — the page never renders a closed section. */
  pairs: EvalReportPair[]
  /**
   * Per task, every criterion's conclusion in every comparison group, with
   * the evidence and the judge behind it. Behind the SAME gate as `pairs` —
   * a closed comparison stays closed one criterion at a time — but present
   * for a single-group run, where 判官依据 still answers a question.
   */
  criteria: EvalReportTaskCriteria[]
  efficiency: EvalReportEfficiencyRow[]
  efficiencyExcluded: EvalReportExcluded[]
  judge: EvalReportJudgeConsistency
  /** expectedNs namespaces whose verdicts are ALL `tool:`-written — the top red flag. */
  toolOnlyNs: string[]
  /** Verdict rows, missions and attempts the bundle carries. */
  counts: { rows: number; missions: number; attempts: number; retries: number }
  /** The report's own reservations, verbatim. */
  notes: string[]
}

/** Which run to walk through the release gate. */
export interface EvalFinalizeRequest {
  runId: string
}

/** What finalize did to one cell. */
export interface EvalFinalizeCell {
  missionId: string
  /** The state the cell was in when finalize looked at it. */
  state: string
  action: 'released' | 'refused' | 'skipped'
  /** Where it ended up — unchanged for a skip, the last state a refused gate allowed. */
  finalState: string
  /** The gate's refusal, or why the cell was skipped. */
  reason: string | null
  /** The unit this cell held and what became of it; null when it held none. */
  unit: EvalFinalizeCellUnit | null
}

/** What the walk did with one cell's container. */
export interface EvalFinalizeCellUnit {
  id: string
  resource: string
  /** True when the destroy went through; false when it was tried and failed. */
  released: boolean
  /** lab's verbatim refusal, when the destroy failed. */
  reason: string | null
}

/** A unit of this run still up when the walk ended, with the reason. */
export interface EvalFinalizeHeldUnit {
  id: string
  resource: string
  missionId: string | null
  /** The cell's state when the walk ended; null when the run owns no such cell. */
  missionState: string | null
  /** Why no gate could authorize its destroy, in terms the reader can act on. */
  reason: string
}

/** The finalize answer: what moved, what the gate refused, and what was left alone. */
export interface EvalFinalizeView {
  runId: string
  released: number
  refused: number
  skipped: number
  /** Skipped cells per raw state — the operator's one-line summary. */
  skippedByState: Record<string, number>
  cells: EvalFinalizeCell[]
  /** Containers the walk destroyed, one per released cell that held one. */
  unitsReleased: number
  /** Containers of this run still up afterwards, each with the reason. */
  unitsHeld: EvalFinalizeHeldUnit[]
  /**
   * Whether the unit list is knowable at all. False on a composition with no
   * lab: an empty `unitsHeld` then means "not asked", not "none left".
   */
  unitsKnown: boolean
  /** The walk's own log lines, verbatim. */
  log: string[]
}

/** Which run's held units to list. */
export interface EvalRunUnitsRequest {
  runId: string
}

/** One unit lab is holding for a run right now. */
export interface EvalRunUnit {
  id: string
  /** The container name — what `docker ps` shows. */
  resource: string
  running: boolean
  /** The cell it was acquired for; null for a unit bound to none. */
  missionId: string | null
  /**
   * That cell's state in the ledger. It is what separates a container the
   * 回收 walk can still take (`archived`) from one that only `--force` can
   * (`released`) — the distinction the report page's action depends on.
   */
  missionState: string | null
}

/**
 * The report page's 未回收单元 answer: lab's own list, not the ledger's belief.
 * `available: false` means the count is UNKNOWN — no lab in this composition,
 * or lab could not be asked — which the page must not render as zero.
 */
export interface EvalRunUnitsView {
  runId: string
  available: boolean
  units: EvalRunUnit[]
  /** Why the list is unknown; null when it was read. */
  refusal: string | null
}

/* ───────────────── the judge bench (ui-spec §五, step 8) ──────────────── */

/** Which run's judging queue to open. */
export interface EvalJudgeQueueRequest {
  runId: string
}

/**
 * One de-identified material file, as the bench shows it. `text` is the
 * SCRUBBED bytes — the original never leaves the host — and `replacements`
 * says how many fingerprints the run's table removed from this file, which is
 * the one number that tells a grader the scrubber actually ran.
 */
export interface EvalJudgeMaterial {
  path: string
  text: string
  replacements: number
}

/** One `kind: human` rubric row — what the bench asks a person to answer. */
export interface EvalJudgeCriterionRow {
  id: string
  criterion: string
  /** What the author said counts as evidence; null when the rubric omits it. */
  evidence: string | null
  weight: number | null
  /** The criterion states a DEFECT: holding it means points off. */
  negative: boolean
  /** Failing it sinks the cell regardless of the rest. */
  veto: boolean
  note: string | null
}

/**
 * One llm-draft value already on record for a criterion. `judge` is the BLIND
 * panel label (判官 A / 判官 B), never the judge condition id — that id names
 * a harness as often as not, and the bench is blind.
 */
export interface EvalJudgeDraftSample {
  judge: string
  sample: number | null
  criterion: string
  pass: boolean
  evidence: string | null
  /** The judge's model is the model this cell ran (decision 9, disclosed per cell). */
  selfJudged: boolean
}

/** One human-final verdict already on record for a criterion. */
export interface EvalJudgeHumanVerdict {
  criterion: string
  pass: boolean
  evidence: string | null
  at: number
  /** The annotation's writer — a session tag for a bench write. */
  by: string | null
}

/**
 * One queue entry: a cell, blinded. There is no condition id, no harness and
 * no model anywhere in this shape, and no mission id either — the
 * orchestrator's `<task>-<conditionId>-rep<N>` naming would put the harness
 * in the page's DOM. The cell travels as an ordinal plus an opaque ticket,
 * and the ticket is what the write verb takes back.
 */
export interface EvalJudgeQueueCell {
  /** The opaque handle `humanFinal` resolves back to a mission id. */
  ticket: string
  /** The cell's blind name: its position in the run's own (seeded) order. */
  cellNo: number
  /** The dataset item — the question being graded, not a subject fingerprint. */
  task: string | null
  rep: number | null
  state: string
  bucket: string
  attempt: number
  materials: EvalJudgeMaterial[]
  criteria: EvalJudgeCriterionRow[]
  /** Why the criteria list is empty, when it is; null when it has rows. */
  criteriaNote: string | null
  drafts: EvalJudgeDraftSample[]
  humanFinal: EvalJudgeHumanVerdict[]
  /** Whether this cell already carries a human-final verdict — the queue's split. */
  graded: boolean
  /**
   * Criteria this cell has an `llm-draft` value for and NO human-final.
   *
   * It is here because of how the report merges verdict layers: EACH
   * criterion independently takes the most authoritative layer that judged it
   * (`human-final` > `llm-draft` > `script`). So a human verdict settles the
   * criteria it answers, and every criterion in this list goes on counting —
   * on the judge's word — leaving the record's score with two authors at
   * once. The page says that beside the button, because a grader who thinks
   * they are scoring the whole record is scoring part of it.
   *
   * Until I5·T54 the rule was per CELL and this list was a COST: the first
   * human verdict dropped every criterion in it from the score. The field
   * survived the change because the sentence it feeds is still owed; only
   * what the sentence says changed.
   */
  draftOnlyCriteria: string[]
}

/**
 * The judge bench's payload: the blind queue and the run's live consistency
 * numbers (computed off the LEDGER, so a verdict written here moves them
 * without waiting for a re-export).
 */
export interface EvalJudgeQueueView {
  runId: string
  cells: EvalJudgeQueueCell[]
  consistency: EvalReportJudgeConsistency
  /** How many judge conditions the run declared — the panel's size. */
  judgeCount: number
  /**
   * True when the run's newest recorded export predates its newest
   * `human-final` — the verdicts written on THIS page are not in the bundle,
   * and the numbers anyone reads out of it were computed without them
   * (I5·T39 · G17). False when nothing was ever exported: a run with no bundle
   * has no stale bundle, and the report page is where "export it" is said.
   */
  bundleStale: boolean
  /** When the run's newest recorded export was made; null when none was. */
  lastExportAt: number | null
  /** Degradations, each as a sentence: no data root, no conditions in meta, … */
  notes: string[]
}

/** One verdict a person is submitting from the bench. */
export interface EvalJudgeVerdictInput {
  criterion: string
  pass: boolean
  /** A checkable fact; the bench refuses a blank one. */
  evidence: string
  /** Partial credit for a proportional criterion (protocol §6.8). */
  ratio?: { passed: number; total: number } | null
}

/** Submit one cell's human-final verdicts. */
export interface EvalHumanFinalRequest {
  runId: string
  /** The blind handle the queue issued; never a mission id. */
  ticket: string
  verdicts: EvalJudgeVerdictInput[]
}

/** What the human-final write did. */
export interface EvalHumanFinalResult {
  runId: string
  ticket: string
  /** The cell the ticket resolved to — host-side truth, echoed for the ledger's sake. */
  missionId: string
  written: number
  added: boolean
  /** The annotation's `by`: `tab:<sessionId>`, never a `tool:` origin. */
  by: string
  /** mission's annotate is a no-op on an identical repeat; this says it was one. */
  duplicate: boolean
}
