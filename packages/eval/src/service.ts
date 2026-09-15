/**
 * The eval service face: the offline verbs the CLI shares (contract checking,
 * deterministic hashing, the bundle report) plus — since I2 — the two
 * orchestration verbs: `generateTemplate` (manifest → run template) and
 * `run` (the stage-one/two run loop). The offline surface is read-only over
 * its inputs; the run verb resolves the datasets / mission / localAgent
 * services through the host at call time and refuses loudly naming whatever
 * is missing.
 * @module @khorsheed/dsh-eval
 */
import { hashConditionDocument, hashHome, type HomeHash } from './hash.ts'
import { writeEvalReport, type ReportWrite } from './report.ts'
import { CONDITION_SCHEMA_ID } from './schema.ts'
import { conditionDiagnostics, expandHome, validatePlan, type EvalDiagnostic, type PlanValidation } from './validate.ts'
import { generateTemplate, type GeneratedTemplate, type GenerateTemplateOptions } from './template.ts'
import { runPlan, EvalRunRefused, type RunDeps, type RunOptions, type RunReport } from './run.ts'
import { finalizeRun, EvalFinalizeRefused, type FinalizeOptions, type FinalizeReport } from './finalize.ts'
import {
  EvalRunJobs,
  type EvalRunHandle,
  type EvalRunOutput,
  type EvalRunStatus,
} from './job.ts'
import {
  EvalReadRefused,
  diffConditions,
  listConditions,
  runCells,
  runStatus,
  type ConditionDiff,
  type ConditionsReport,
  type RunCellsQuery,
  type RunCellsReport,
  type RunStatusReport,
} from './read.ts'
import { EvalProvisionRefused, provisionCondition, type ProvisionReport } from './provision.ts'
import { experimentDetail, listExperiments, runsForItem } from './experiments.ts'
import { materializationShaOf, runCellDetail } from './cell-detail.ts'
import { judgeQueueView, writeHumanFinal } from './judge-bench.ts'
import { pivotMatrix, type MatrixInputCell } from './matrix-view.ts'
import { conditionDiffView, conditionsView, reviewPlan } from './review.ts'
import { projectFinalize, runReportView } from './report-view.ts'
import { instanceCapabilityProbe } from './capability-probe.ts'
import type {
  CapabilityCatalogFace, DatasetsBindingFace, DatasetsFace, LabFace, LocalAgentFace, MissionActionFace,
  MissionAnnotateFace, MissionExportRemoteFace,
  MissionFace, MissionFinalizeFace, MissionReadFace, MissionRunListFace,
} from './faces.ts'
import type {
  EvalApproveResult, EvalCellDetail, EvalCellsResult, EvalConditionDiffView, EvalConditionsView,
  EvalExperimentDetail, EvalExperimentsResult, EvalExportPlanRequest, EvalExportPlanView, EvalExportResultView,
  EvalExportRunRequest, EvalFinalizeView, EvalHumanFinalResult, EvalItemRunsResult, EvalJudgeQueueView,
  EvalJudgeVerdictInput, EvalMatrixView, EvalPlanReview, EvalRunReportView,
} from './types.ts'

/** Thrown when a verb is handed a document that violates its contract. */
export class EvalContractError extends Error {}

/**
 * The export verbs' refusal. mission's Remote is where the leak gate lives, so
 * a composition without it gets no export at all — not an export with the gate
 * re-implemented on this side.
 */
const MISSION_EXPORT_ABSENT = new EvalReadRefused(
  'no mission Remote face: the bundle export and its guarded-layer gate live there, so this composition cannot export '
  + '— mount the dsh-mission plugin on a host with the Typert gateway, or export with the dsh-mission CLI',
)

/**
 * The run's PLAYER condition declarations, as `run.meta.conditions` carries
 * them since T8b. The matrix's factor set is derived from these and from
 * nothing else — the judge is a condition but not a contestant, so its
 * declaration never widens the factor set.
 */
function metaConditionDocuments(meta: Record<string, unknown>): Array<{ id: string; document: unknown }> {
  const entries = meta['conditions']
  if (!Array.isArray(entries)) return []
  return entries.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return []
    const record = entry as Record<string, unknown>
    return typeof record['id'] === 'string' ? [{ id: record['id'], document: record['condition'] }] : []
  })
}

/** Result of hashing one condition document. */
export interface ConditionHash {
  /** sha256 hex of the canonical condition JSON (notes excluded). */
  sha: string
  /** Unresolved fields and the like — not failures, listed for the caller. */
  warnings: EvalDiagnostic[]
}

/**
 * The eval service. The offline kernel holds no state; the run verb carries
 * an optional host accessor so the in-host plugin can probe its upstream
 * services (the CLI builds the same kernel without a host — run stays
 * dry-run-only there).
 */
export class EvalService {
  /**
   * The run-as-job layer: `/eval run` registers the run here and returns, so
   * a run outlives the turn that started it. One instance per service, so a
   * finished run's output stays readable for as long as the service lives.
   */
  private readonly jobs: EvalRunJobs

  constructor(private readonly hosts?: { get(name: string): unknown }) {
    this.jobs = new EvalRunJobs(hosts)
  }

  /** Whether a run can be started as a background job in this composition. */
  runJobsAvailable(): boolean {
    return this.jobs.available()
  }

  /**
   * Validate a plan document against `dataseek.plan/1` and resolve what it
   * references (condition declarations, locks, stage schemas). Data problems
   * come back as diagnostics, never as throws.
   */
  validatePlan(planPath: string): Promise<PlanValidation> {
    return validatePlan(expandHome(planPath))
  }

  /**
   * Hash a condition document (canonical JSON, `notes` excluded).
   * @throws {@link EvalContractError} when the document violates
   * `dataseek.condition/1` — a hash of an invalid document means nothing.
   */
  hashCondition(condition: unknown): ConditionHash {
    const { errors, warnings } = conditionDiagnostics(condition)
    if (errors.length > 0) {
      throw new EvalContractError(
        `condition violates ${CONDITION_SCHEMA_ID}:\n${errors.map(e => `  - [${e.code}] ${e.message}`).join('\n')}`,
      )
    }
    return { sha: hashConditionDocument(condition), warnings }
  }

  /**
   * Hash a scoped home's config content (deny-listed files excluded, content
   * never leaves the digest).
   * @throws Error when the directory does not exist.
   */
  hashHome(homeDir: string): Promise<HomeHash> {
    return hashHome(homeDir)
  }

  /**
   * Build the paired report for a mission export bundle: `results.jsonl`
   * (one verdict per line) and `summary.md` (the four invariants first;
   * comparison and ranking only when all four are established). Writes into
   * `<bundleDir>/report/` unless `out` names another directory.
   * @throws Error when the directory is not a bundle (no readable run.json).
   */
  report(bundleDir: string, options: { out?: string } = {}): Promise<ReportWrite> {
    return writeEvalReport(expandHome(bundleDir), options.out === undefined ? options : { out: expandHome(options.out) })
  }

  /**
   * List the conditions a dataset repository declares, with their hashes and
   * readiness (lock present and matching, scoped home verified, unresolved
   * fields). Read-only: minting a condition is a file the agent drafts, and
   * turning one into a real scoped home is `conditions provision` (I4).
   * @param options - `repo` wins; otherwise the calling session's datasets
   *   binding decides, and its dataset whitelist is honoured — which datasets
   *   an agent may see is the human's decision, not the agent's.
   * @throws {@link EvalReadRefused} when no repository can be resolved, when
   *   the path is not a dataset repository, or when `dataset` is outside the
   *   session binding's whitelist.
   */
  conditions(options: { repo?: string; dataset?: string; session?: { id: string } } = {}): Promise<ConditionsReport> {
    const scope = this.resolveRepoScope(options)
    if (scope instanceof EvalReadRefused) return Promise.reject(scope)
    return listConditions(scope.repo, scope.datasets)
  }

  /**
   * Diff two condition declarations field by field — SHOWS, never chooses.
   * Two conditions that differ in exactly one field are a single-factor pair,
   * which is worth seeing; whether the pair is worth running depends on things
   * no file knows, so the verb stops at the facts and makes no
   * recommendation.
   * @param options - the two references (a condition id, or a path), plus the
   *   same repo / dataset / session resolution {@link EvalService.conditions}
   *   uses.
   * @throws {@link EvalReadRefused} when a repository or a side cannot be resolved.
   */
  conditionDiff(options: { a: string; b: string; repo?: string; dataset?: string; session?: { id: string } }): Promise<ConditionDiff> {
    const scope = this.resolveRepoScope(options)
    if (scope instanceof EvalReadRefused) return Promise.reject(scope)
    return diffConditions(scope.repo, options.a, options.b, scope.datasets)
  }

  /**
   * Provision one condition: resolve its `(harness, scope)` to a real scoped
   * home, refuse unless that scope holds a credential, check the declaration
   * against the scope's effective settings field by field, hash the home, and
   * write `conditions/<id>.lock.json` beside the declaration.
   *
   * The ONE writer of a condition lock. Writes go only into the working copy
   * `repo` names — nothing is committed, and the shared checkout stays
   * untouched.
   * @param conditionPath - path to the declaration (`~` expanded).
   * @param options - the working copy to write into.
   * @throws {@link EvalProvisionRefused} when the path, the declaration, or
   *   the local-agent facade makes provisioning impossible; a condition that
   *   simply is not ready comes back as a report with `written: false`.
   */
  provision(conditionPath: string, options: { repo: string; log?: (message: string) => void }): Promise<ProvisionReport> {
    const localAgent = this.hosts?.get('localAgent') as LocalAgentFace | undefined
    if (localAgent === undefined) {
      return Promise.reject(new EvalProvisionRefused(
        'no localAgent service: provision reads the scoped home, its credential grade and its effective settings from the harness family'
        + ' — run it from a live session (/eval conditions provision <condition.json> --repo <working copy>), or mount the dsh-local-agent plugin',
      ))
    }
    // The capability probe is the one part of provision that needs a LIVE
    // instance rather than a facade: the hash is what the instance's own
    // catalog reads for that preset. Absent catalog, absent measurement —
    // provision then warns CAPABILITIES_UNMEASURED and the readiness gate
    // refuses the condition, which is the honest degrade.
    const catalog = this.hosts?.get('capabilityCatalog') as CapabilityCatalogFace | undefined
    return provisionCondition(conditionPath, {
      repo: options.repo,
      localAgent,
      ...(options.log === undefined ? {} : { log: options.log }),
      ...(catalog === undefined
        ? {}
        : { capabilities: instanceCapabilityProbe({ catalog, ...(options.log === undefined ? {} : { log: options.log }) }) }),
    })
  }

  /**
   * Resolve which repository and which dataset sets a read verb may see:
   * `repo` wins; otherwise the calling session's datasets binding decides, and
   * its whitelist is honoured — which datasets an agent may see is the human's
   * decision, not the agent's.
   */
  private resolveRepoScope(
    options: { repo?: string; dataset?: string; session?: { id: string } },
  ): { repo: string; datasets: string[] | undefined } | EvalReadRefused {
    const binding = options.session === undefined
      ? undefined
      : (this.hosts?.get('datasets') as DatasetsBindingFace | undefined)?.binding(options.session)
    const repo = options.repo !== undefined && options.repo !== ''
      ? expandHome(options.repo)
      : binding?.repoPath
    if (repo === undefined || repo === '') {
      return new EvalReadRefused(
        'no dataset repository: pass repo, or ask the human to bind one for this session (/datasets bind <repoPath>)',
      )
    }
    const allowed = binding?.datasets
    if (options.dataset !== undefined && options.dataset !== '') {
      if (allowed !== undefined && !allowed.includes(options.dataset)) {
        return new EvalReadRefused(
          `dataset ${JSON.stringify(options.dataset)} is outside this session's binding (${allowed.join(', ')})`,
        )
      }
      return { repo, datasets: [options.dataset] }
    }
    return { repo, datasets: allowed === undefined ? undefined : [...allowed] }
  }

  /**
   * Project one run: the evaluation-relevant slice of `run.meta` plus a row
   * per cell (state, bucket, what the orchestrator last did, how often a
   * submission was rejected). Reads mission's ledger; writes nothing.
   * @param runId - the run to project.
   * @throws {@link EvalReadRefused} when the composition mounts no mission
   *   service — the run ledger lives there, so there is nothing to read.
   */
  runStatus(runId: string): RunStatusReport {
    const mission = this.hosts?.get('mission') as MissionReadFace | undefined
    if (mission === undefined) {
      // Named without its scope on purpose: a scoped `@khorsheed/…` string in
      // shipped code reads as a family edge to pack-dist, and this is a
      // sentence for a human, not a dependency.
      throw new EvalReadRefused(
        'no mission service: run records live in the mission ledger, so this composition cannot answer run '
        + 'status — mount the dsh-mission plugin',
      )
    }
    return runStatus(mission, runId)
  }

  /**
   * Project one run CELL BY CELL: the matrix coordinates, the bucket and
   * stage each cell sits in and for how long, the unit its attempt holds,
   * the checkpoints it reached, how many annotations each namespace carries,
   * and the delegation's child session when it has one.
   *
   * The companion of {@link EvalService.runStatus}, not a replacement: that
   * one answers about the RUN (the run.meta digest, the buckets, the leak
   * warning), this one about its cells. Both read mission's ledger through
   * the structural face, so the callers — the `eval_cells` tool and the lab
   * tab's Remote — never touch mission themselves.
   * @param runId - the run to project.
   * @param query - exact-match `bucket` / `task` / `condition` filters, and
   *   the clock the durations are taken against.
   * @throws {@link EvalReadRefused} when the composition mounts no mission
   *   service — the run ledger lives there, so there is nothing to read.
   */
  cells(runId: string, query: RunCellsQuery = {}): RunCellsReport {
    const mission = this.hosts?.get('mission') as MissionReadFace | undefined
    if (mission === undefined) {
      // Named without its scope for the same reason as in `runStatus`: this
      // is a sentence for a human, not a dependency edge.
      throw new EvalReadRefused(
        'no mission service: run records live in the mission ledger, so this composition cannot list a run\'s '
        + 'cells — mount the dsh-mission plugin',
      )
    }
    return runCells(mission, runId, query)
  }

  /**
   * The LAB LIST: one row per experiment — every run this ledger holds that
   * eval started, plus every plan in the session's dataset repository that
   * nobody has started yet. Drafts and runs share one table because to the
   * person planning the next comparison they are the same kind of thing
   * (ui-spec §五).
   *
   * Read-only, and degrading rather than refusing: a composition without
   * mission lists drafts only, a session without a datasets binding lists runs
   * only, and each gap comes back as a sentence in `notes`. That is deliberate
   * — an empty list with no explanation is the one answer a planning view must
   * never give.
   * @param options - `repo` wins; otherwise the calling session's datasets
   *   binding decides, and its dataset whitelist is honoured — exactly the
   *   resolution {@link EvalService.conditions} uses.
   * @returns the rows, newest run first, then the drafts by name.
   */
  experiments(options: { repo?: string; dataset?: string; session?: { id: string } } = {}): Promise<EvalExperimentsResult> {
    const mission = this.hosts?.get('mission') as MissionRunListFace | undefined
    const scope = this.resolveRepoScope(options)
    const resolved = scope instanceof EvalReadRefused ? undefined : scope
    return listExperiments({
      ...(mission === undefined ? {} : { mission }),
      ...(resolved === undefined ? {} : { repo: resolved.repo }),
      ...(resolved?.datasets === undefined ? {} : { datasets: resolved.datasets }),
      jobs: this.jobs.list(),
    })
  }

  /**
   * One started experiment's OVERVIEW: the list row, the run.meta digest, the
   * readiness records verbatim, the bucket and stage histograms, the leak
   * warning, and this instance's job record for the run.
   *
   * A DRAFT has no run and therefore no detail here — its overview is the list
   * row, which already carries the plan digest. The plan-review page (T36) is
   * where a draft gets a page of its own.
   * @param runId - the run to project.
   * @throws {@link EvalReadRefused} when the composition mounts no mission
   *   service — the run ledger lives there, so there is nothing to read.
   */
  experiment(runId: string): EvalExperimentDetail {
    const mission = this.hosts?.get('mission') as MissionRunListFace | undefined
    if (mission === undefined) {
      // Named without its scope like the two read verbs above: a sentence for
      // a human, not a dependency edge.
      throw new EvalReadRefused(
        'no mission service: run records live in the mission ledger, so this composition cannot open an experiment '
        + '— mount the dsh-mission plugin',
      )
    }
    return experimentDetail(mission, runId, this.jobs.list())
  }

  /**
   * The PLAN-REVIEW page (ui-spec §五, step 3): the plan's own fields, and
   * `validatePlan`'s verdict as a flat `ok / warn / error` list. The same
   * function `dsh-eval validate` runs, rearranged for reading — the page and
   * the CLI cannot disagree about whether a plan is approvable.
   * @param planPath - path to a `dataseek.plan/1` document (`~` expanded).
   */
  planReview(planPath: string): Promise<EvalPlanReview> {
    return reviewPlan(planPath)
  }

  /**
   * The CONDITIONS page (ui-spec §五, step 4): {@link EvalService.conditions}
   * projected onto the table the page draws — harness, declared model, scope,
   * preset, the lock and the readiness word.
   * @param options - the same repo / dataset / session resolution the listing uses.
   */
  async conditionsPage(options: { repo?: string; dataset?: string; session?: { id: string } } = {}): Promise<EvalConditionsView> {
    return conditionsView(await this.conditions(options))
  }

  /**
   * The CONDITIONS page's diff: {@link EvalService.conditionDiff} with each
   * side's value as canonical JSON text, and ONLY the fields that differ.
   * @param options - the two references, plus the usual repo / dataset / session resolution.
   */
  async conditionDiffPage(options: { a: string; b: string; repo?: string; dataset?: string; session?: { id: string } }): Promise<EvalConditionDiffView> {
    return conditionDiffView(await this.conditionDiff(options))
  }

  /**
   * APPROVE a plan and start it — the human act of ui-spec step 5, and the one
   * verb in this package that a human's click reaches and a model's tool call
   * never does (R1).
   *
   * Validate runs FIRST and an error refuses the whole thing: a run started
   * over a plan whose conditions do not resolve burns real delegations to
   * discover what an offline check already knew. Warnings do not refuse —
   * `dataset.commit: null` is the normal shape of a plan whose snapshot pins
   * at run start.
   *
   * The refusal is a RESULT, not a throw: the caller renders the same check
   * list either way, and the reason belongs beside the list that explains it.
   * Wiring failures (no job registry, no live parent agent) are caught here
   * for the same reason and arrive verbatim in `refusal`.
   * @param planPath - path to a `dataseek.plan/1` document (`~` expanded).
   * @param options - the approving session (the run's parent) and its workspace.
   * @returns what validate said, and — when it started — the job and run ids.
   */
  async approve(planPath: string, options: { parentSessionId: string; cwd?: string }): Promise<EvalApproveResult> {
    const review = await this.planReview(planPath)
    const refused = (refusal: string): EvalApproveResult => ({
      started: false,
      checks: review.checks,
      refusal,
      jobId: null,
      runId: null,
      parentSessionId: null,
    })
    if (!review.ok) {
      const errors = review.checks.filter(check => check.severity === 'error')
      return refused(
        `validate refuses this plan (${errors.length} error(s)) — nothing was started:\n`
        + errors.map(check => `  [${check.code}] ${check.message}`).join('\n'),
      )
    }
    try {
      const handle = await this.runStart(planPath, {
        parentSessionId: options.parentSessionId,
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        label: `eval run ${planPath} (approved)`,
      })
      return {
        started: true,
        checks: review.checks,
        refusal: null,
        jobId: handle.jobId,
        runId: handle.runId,
        parentSessionId: handle.parentSessionId,
      }
    } catch (error) {
      return refused(`the run could not start: ${error instanceof Error ? error.message : String(error)}`)
    }
  }


  /**
   * The MATRIX page: this run's cells arranged rows-are-tasks, one factor on
   * the columns, the rest banded or pinned (ui-spec §五). The arrangement rule
   * is the pure {@link pivotMatrix}; this verb only feeds it — the ledger's
   * cells, the run's condition documents, and the per-attempt materialization
   * digest read from the run-data tree.
   *
   * The digest read is why this verb is async: the hash the「题面一致」
   * invariant compares lives in `materialization.json` beside each attempt,
   * not in the ledger. A composition whose mission face reports no `dataDir`
   * simply gets `unverifiable` — the matrix never invents a hash.
   * @param runId - the run to arrange.
   * @param options - which factor is the column, what is banded, what is pinned.
   * @throws {@link EvalReadRefused} when the composition mounts no mission service.
   */
  async matrix(runId: string, options: {
    column?: string
    groupBy?: readonly string[]
    filter?: Readonly<Record<string, string>>
    stuckMs?: number
    now?: number
  } = {}): Promise<EvalMatrixView> {
    const mission = this.requireMissionRead('arrange a run\'s matrix')
    const report = runCells(mission, runId, options.now === undefined ? {} : { now: options.now })
    const status = mission.runStatus(runId)
    const conditions = metaConditionDocuments(status.run.meta)
    const cells: MatrixInputCell[] = await Promise.all(report.cells.map(async cell => ({
      missionId: cell.missionId,
      task: cell.task,
      condition: cell.condition,
      rep: cell.rep,
      state: cell.state,
      bucket: cell.bucket,
      inStateMs: cell.inStateMs,
      materializationSha: await materializationShaOf(mission.dataDir, runId, cell.missionId, cell.attempt),
      fingerprint: cell.refs.fingerprint,
    })))
    return pivotMatrix({
      runId: status.run.id,
      conditions,
      cells,
      unreleased: status.unreleased,
      ...(options.column === undefined ? {} : { column: options.column }),
      ...(options.groupBy === undefined ? {} : { groupBy: options.groupBy }),
      ...(options.filter === undefined ? {} : { filter: options.filter }),
      ...(options.stuckMs === undefined ? {} : { stuckMs: options.stuckMs }),
    })
  }

  /**
   * The CELLS page's table: the same {@link EvalService.cells} projection,
   * narrowed to the columns the table shows. One implementation, two shapes —
   * the model reads the whole `cells` answer, the tab reads this.
   * @param runId - the run.
   * @param query - the same exact-match filters `cells` takes.
   * @throws {@link EvalReadRefused} when the composition mounts no mission service.
   */
  cellRows(runId: string, query: RunCellsQuery = {}): EvalCellsResult {
    const report = this.cells(runId, query)
    return {
      runId: report.runId,
      state: report.state,
      filter: report.filter,
      total: report.total,
      matched: report.matched,
      buckets: report.buckets,
      rows: report.cells.map(cell => ({
        missionId: cell.missionId,
        task: cell.task,
        condition: cell.condition,
        rep: cell.rep,
        state: cell.state,
        bucket: cell.bucket,
        attempt: cell.attempt,
        inStateMs: cell.inStateMs,
        refs: { resource: cell.refs.resource, fingerprint: cell.refs.fingerprint },
        checkpoints: [...cell.checkpoints],
        annotations: { ...cell.annotations },
        childSessionId: cell.childSessionId,
      })),
    }
  }

  /**
   * ONE cell in full — the drawer's payload (attempts, checkpoints, artifacts,
   * annotation namespaces, the verify output verbatim, the child session, and
   * the release answer).
   * @param runId - the run.
   * @param missionId - the cell.
   * @param options - the clock the duration is taken against.
   * @throws {@link EvalReadRefused} when mission is absent, or the cell is not in the run.
   */
  // `async` so the refusal is a REJECTION: the signature promises a promise,
  // and a caller that only attached `.catch` would otherwise be hit by a
  // synchronous throw.
  async cell(runId: string, missionId: string, options: { now?: number } = {}): Promise<EvalCellDetail> {
    const mission = this.requireMissionRead('open a cell')
    return await runCellDetail(mission, this.missionActions(), runId, missionId, options)
  }

  /**
   * Re-run one cell: open a fresh attempt. A HUMAN gesture from the drawer,
   * forwarded to mission unchanged — including its demand for an auditable
   * reason, which this verb re-states rather than relaxes.
   * @param runId - the run.
   * @param missionId - the cell.
   * @param options - the reason (required, non-empty), mission's retry
   *   category, and the caller tag recorded on the attempt.
   * @returns the new attempt number.
   * @throws {@link EvalReadRefused} when no mission service is mounted, or the
   *   reason is blank — an attempt nobody can account for is worse than none.
   */
  retryCell(runId: string, missionId: string, options: { reason: string; category: string; by?: string }): Promise<{ attempt: number }> {
    const actions = this.missionActions()
    if (actions === undefined) {
      return Promise.reject(new EvalReadRefused(
        'no mission service: attempts live in the mission ledger, so this composition cannot re-run a cell '
        + '— mount the dsh-mission plugin',
      ))
    }
    const reason = options.reason.trim()
    if (reason === '') {
      return Promise.reject(new EvalReadRefused('retry needs a reason: every fresh attempt is recorded with why it was opened'))
    }
    return actions.retry(missionId, {
      runId,
      reason,
      category: options.category,
      ...(options.by === undefined ? {} : { by: options.by }),
    })
  }

  /**
   * The release check: may this cell's resources be destroyed? Asked BEFORE
   * anything is destroyed, and answered by the state machine's own
   * `releasableStates` — eval adds no opinion.
   * @param runId - the run.
   * @param missionId - the cell.
   * @throws {@link EvalReadRefused} when no mission service is mounted.
   */
  releaseCheck(runId: string, missionId: string): { missionId: string; releasable: boolean } {
    const actions = this.missionActions()
    if (actions === undefined) {
      throw new EvalReadRefused(
        'no mission service: the release gate lives in the mission ledger, so this composition cannot answer '
        + '— mount the dsh-mission plugin',
      )
    }
    return { missionId, releasable: actions.isReleasable(missionId, runId) }
  }

  /**
   * The export dialog's first step, forwarded to mission's own Remote:
   * which layers would be written and which of them are GUARDED
   * (`modelFacing: false`, resolved through the datasets probe).
   *
   * Forwarded rather than re-derived on purpose. The guarded set and the
   * fail-closed gate are mission's, and a second implementation of a leak gate
   * is a second place for it to be wrong — eval relays the caller's
   * confirmations and can neither narrow nor widen them.
   * @param agent - the calling agent, passed through unchanged.
   * @param request - run, output directory, layers, snapshot reference.
   * @throws {@link EvalReadRefused} when mission's Remote is not mounted.
   */
  exportPlan(agent: unknown, request: EvalExportPlanRequest): Promise<EvalExportPlanView> {
    const remote = this.missionExport()
    if (remote === undefined) return Promise.reject(MISSION_EXPORT_ABSENT)
    return remote.exportPlan(agent, request)
  }

  /**
   * The export dialog's confirm step, forwarded the same way. mission
   * re-checks the `confirmed` list against a FRESH plan and refuses when a
   * guarded layer is unconfirmed — a dialog-stale confirmation never
   * authorizes a changed layer set, and that check stays on mission's side.
   * @param agent - the calling agent, passed through unchanged.
   * @param request - the export plus the confirmed guarded layers.
   * @throws {@link EvalReadRefused} when mission's Remote is not mounted.
   */
  exportRun(agent: unknown, request: EvalExportRunRequest): Promise<EvalExportResultView> {
    const remote = this.missionExport()
    if (remote === undefined) return Promise.reject(MISSION_EXPORT_ABSENT)
    return remote.exportRun(agent, request)
  }

  /**
   * The JUDGE BENCH's queue (ui-spec step 8): every cell of the run as a
   * BLIND entry — an ordinal and an opaque ticket, its de-identified
   * material, the rubric's `human` criteria, every llm-draft sample already
   * recorded and whatever human-final it carries — plus the run's live
   * consistency numbers.
   *
   * Blind is a property of the PAYLOAD, not of the page: nothing naming a
   * condition, a harness or a model crosses this seam, so no amount of
   * client-side carelessness can unblind a grader. The report page is where
   * the same run is read with its labels on.
   * @param runId - the run whose cells are being graded.
   * @throws {@link EvalReadRefused} when no mission service is mounted.
   */
  // `async` so the refusal is a REJECTION, like `cell`: the signature promises
  // a promise, and a caller that only attached `.catch` would otherwise be hit
  // by a synchronous throw.
  async judgeQueue(runId: string): Promise<EvalJudgeQueueView> {
    const mission = this.requireMissionRead('open the judging queue')
    const datasets = this.hosts?.get('datasets') as DatasetsFace | undefined
    return await judgeQueueView({
      mission,
      runId,
      ...(datasets === undefined ? {} : { datasets }),
    })
  }

  /**
   * Write one cell's human-final verdicts — ui-spec step 8, and the ONLY door
   * `human-final` has in this family. A human's click, tagged by session, and
   * append-only: mission's `annotate` pushes and never rewrites.
   *
   * There is deliberately no model-facing twin of this verb, and adding one
   * would break R1 rather than extend it: 终评是人的 holds here because the
   * toolset has no path to this code, not because a check turns a model away.
   * @param runId - the run.
   * @param ticket - the blind handle the queue issued for the cell.
   * @param verdicts - one entry per criterion being answered.
   * @param sessionId - the calling session; recorded as `tab:<sessionId>`.
   * @throws {@link EvalReadRefused} when mission is absent, the ticket names
   *   no cell, or a verdict fails `dataseek.verdict/1`.
   */
  // `async` for the same reason as `judgeQueue`: every refusal on this verb
  // reaches the browser as a rejected RPC, never as a throw mid-call.
  async humanFinal(
    runId: string,
    ticket: string,
    verdicts: readonly EvalJudgeVerdictInput[],
    sessionId: string,
  ): Promise<EvalHumanFinalResult> {
    const mission = this.requireMissionRead('write a human-final verdict')
    const annotate = this.missionAnnotate()
    if (annotate === undefined) {
      throw new EvalReadRefused(
        'no mission annotate face: human-final verdicts live in the mission ledger, so this composition cannot record one '
        + '— mount the dsh-mission plugin',
      )
    }
    return await writeHumanFinal({ mission, annotate, runId, ticket, verdicts, sessionId })
  }

  /**
   * The 作答记录 of one dataset item: every evaluation run that answered it,
   * with its cells and their verdict counts. Consumed by the 题集 tab (T47);
   * degrades to an empty list plus a sentence when no ledger is mounted.
   * @param datasetId - the dataset set.
   * @param itemId - the item id (the cells' `task` label).
   */
  itemRuns(datasetId: string, itemId: string): EvalItemRunsResult {
    return runsForItem(this.hosts?.get('mission') as MissionRunListFace | undefined, datasetId, itemId)
  }

  /** The mission READ face, or a refusal naming what is missing. */
  private requireMissionRead(what: string): MissionReadFace {
    const mission = this.hosts?.get('mission') as MissionReadFace | undefined
    if (mission === undefined) {
      // Named without its scope like the other read verbs: a sentence for a
      // human, not a dependency edge.
      throw new EvalReadRefused(
        `no mission service: run records live in the mission ledger, so this composition cannot ${what} `
        + '— mount the dsh-mission plugin',
      )
    }
    return mission
  }

  /** The two mission writes the drawer forwards; undefined when mission is absent. */
  private missionActions(): MissionActionFace | undefined {
    const mission = this.hosts?.get('mission') as Partial<MissionActionFace> | undefined
    return typeof mission?.retry === 'function' && typeof mission.isReleasable === 'function'
      ? (mission as MissionActionFace)
      : undefined
  }

  /** The ONE mission write the judge bench makes; undefined when mission is absent. */
  private missionAnnotate(): MissionAnnotateFace | undefined {
    const mission = this.hosts?.get('mission') as Partial<MissionAnnotateFace> | undefined
    return typeof mission?.annotate === 'function' ? (mission as MissionAnnotateFace) : undefined
  }

  /** mission's own Remote service — the leak gate's one home. */
  private missionExport(): MissionExportRemoteFace | undefined {
    const remote = this.hosts?.get('missionRemote') as Partial<MissionExportRemoteFace> | undefined
    return typeof remote?.exportPlan === 'function' && typeof remote.exportRun === 'function'
      ? (remote as MissionExportRemoteFace)
      : undefined
  }

  /**
   * Generate a run template from a dataset-suite manifest (deterministic —
   * the same function `dsh-eval template` prints and the run loop writes
   * beside the plan).
   */
  generateTemplate(manifestPath: string, options?: GenerateTemplateOptions): Promise<GeneratedTemplate> {
    return generateTemplate(manifestPath, options)
  }

  /**
   * Run a plan: validate, snapshot, generate + write the template, expand
   * and order the matrix, then drive every cell to `archived` (or beyond
   * with `finalize`) and export the bundle. This is the body; `/eval run`
   * is its thin wrapper (decision 12).
   * @param planPath - path to a `dataseek.plan/1` document.
   * @param options - concurrency, dry-run, finalize, retry, export knobs.
   * @throws {@link EvalRunRefused} when the run is refused before executing.
   */
  run(planPath: string, options: RunOptions = {}): Promise<RunReport> {
    // Paths cross this seam from three faces — the slash command, the CLI,
    // and the Remote — and every one of them can carry a shell-unexpanded
    // `~`: a slash argument never saw a shell, and a CLI argument quoted to
    // survive one did not either. Expanding HERE means one rule for all
    // three instead of three call sites that must each remember.
    const plan = expandHome(planPath)
    const resolved: RunOptions = options.exportsDir === undefined
      ? options
      : { ...options, exportsDir: expandHome(options.exportsDir) }
    if (resolved.dryRun === true) {
      return runPlan(plan, resolved)
    }
    if (this.hosts === undefined) {
      return Promise.reject(new EvalRunRefused(
        'no host context: the run verb needs the datasets, mission, and localAgent services (the CLI supports --dry-run only)',
      ))
    }
    const datasets = this.hosts.get('datasets') as DatasetsFace | undefined
    const mission = this.hosts.get('mission') as MissionFace | undefined
    const localAgent = this.hosts.get('localAgent') as LocalAgentFace | undefined
    // Probed like the other three and just as optional: only a plan with a
    // `unit` segment needs it, and its absence is then a refusal that names
    // it — never a boot failure, never a silent fallback to the host path.
    const lab = this.hosts.get('lab') as LabFace | undefined
    // Provenance only: the orchestrating instance's own capability face goes
    // into run.meta and is never compared. Absent catalog, absent line.
    const capabilityCatalog = this.hosts.get('capabilityCatalog') as CapabilityCatalogFace | undefined
    const deps: Partial<RunDeps> & { stateRoot?: string } = {}
    if (datasets !== undefined) deps.datasets = datasets
    if (mission !== undefined) deps.mission = mission
    if (localAgent !== undefined) deps.localAgent = localAgent
    if (lab !== undefined) deps.lab = lab
    if (capabilityCatalog !== undefined) deps.capabilityCatalog = capabilityCatalog
    return runPlan(plan, resolved, deps)
  }

  /**
   * START a run in the background and answer immediately with its ids — the
   * default path of `/eval run` and the only path a CI runner has.
   *
   * The run is registered as an unowned `eval-run` job, so it outlives the
   * turn (and the session) that started it; its log lines are readable
   * through {@link runOutput} while it runs, and `job_kill` — through
   * {@link runCancel} — is its one cancellation entry.
   * @param planPath - path to a `dataseek.plan/1` document (`~` expanded).
   * @param options - the same run options `run` takes, minus the ones this
   *   owns (`runId`, `signal`).
   * @returns the job id, the minted run id, and the resolved parent session.
   * @throws {@link EvalJobsUnavailable} when the composition mounts no job
   *   registry (the caller then decides: `/eval run` waits synchronously and
   *   says so).
   */
  runStart(planPath: string, options: RunOptions & { cwd?: string; label?: string } = {}): Promise<EvalRunHandle> {
    const plan = expandHome(planPath)
    return this.jobs.start(
      runOptions => this.run(plan, runOptions),
      { ...options, plan, label: options.label ?? `eval run ${plan}` },
    )
  }

  /**
   * One background run's JOB status — lifecycle, not ledger. The run's CELLS
   * are `runStatus(runId)`, which reads mission; this one answers "is the job
   * still going, and what did it end as".
   * @param jobId - the id {@link runStart} returned.
   * @returns the status, or undefined when this service never started it.
   */
  runJobStatus(jobId: string): EvalRunStatus | undefined {
    return this.jobs.status(jobId)
  }

  /**
   * Read a background run's log from a cursor (non-consuming — the
   * model-facing `job_output` tool has its own cursor).
   * @param jobId - the id {@link runStart} returned.
   * @param cursor - the cursor from the previous read; absent reads from the top.
   * @returns the lines after the cursor, or undefined for an unknown job.
   */
  runJobOutput(jobId: string, cursor?: number): EvalRunOutput | undefined {
    return this.jobs.output(jobId, cursor)
  }

  /**
   * Cancel a background run. The same lever `job_kill` pulls, and the only
   * one: every in-flight delegation is cancelled and the cells the cancel
   * caught stay mid-stage, which is what makes `finalize` call them
   * `interrupted`.
   * @param jobId - the id {@link runStart} returned.
   * @returns what the registry did, or `unknown-job`.
   */
  runJobCancel(jobId: string): 'requested' | 'already-finished' | 'unknown-job' {
    return this.jobs.cancel(jobId)
  }

  /** Every background run this service started, in start order. */
  runJobList(): EvalRunStatus[] {
    return this.jobs.list()
  }

  /**
   * Finalize a run that already stopped at `archived`: walk every archived
   * cell through `archived → releasable → released` (the same gate
   * `/eval run --finalize` takes) and report every cell that was not
   * archived with its state. A gate refusal is recorded against that cell,
   * never forced — the re-entry point pilot A had to improvise with
   * per-cell `dsh-mission transition` calls (G13).
   * @param runId - the run to finalize.
   * @param options - caller tag and progress sink.
   * @throws {@link EvalFinalizeRefused} when the composition mounts no
   *   mission service, or the run cannot be projected.
   */
  finalize(runId: string, options: FinalizeOptions = {}): Promise<FinalizeReport> {
    const mission = this.hosts?.get('mission') as MissionFinalizeFace | undefined
    if (mission === undefined) {
      return Promise.reject(new EvalFinalizeRefused(
        'no mission service: the release gate lives in the mission ledger, so this composition cannot finalize a run '
        + '— mount the dsh-mission plugin, or use the dsh-eval CLI (it drives the dsh-mission CLI in a child process)',
      ))
    }
    return finalizeRun(mission, runId, options)
  }

  /**
   * The REPORT page's payload (ui-spec §五): the four invariants, the paired
   * differences, the efficiency table and the judge numbers, read from the
   * run's exported bundle.
   *
   * A projection of an EXPORT, never of the ledger. The report's honesty rules
   * are `analyzeBundle`'s and stay there; this verb finds the bundle, hands it
   * over, and reshapes the answer. A run nobody has exported yet comes back
   * with `bundleDir: null` and the directories that were looked in — "not
   * exported" and "no report" are different facts, and only the first one has
   * a button.
   *
   * Writes NOTHING. `dsh-eval report --out` is still the way a report lands on
   * disk: where the archived artifact of a run goes is a human's decision, and
   * a page render must not make it.
   * @param runId - the run the page is open on.
   * @param options - the export directory to try first (the dialog's).
   * @throws {@link EvalReadRefused} when mission is absent, or the run is unknown.
   */
  runReport(runId: string, options: { outDir?: string } = {}): Promise<EvalRunReportView> {
    const mission = this.requireMissionRead('read a run\'s report')
    return runReportView(mission, runId, options)
  }

  /**
   * {@link EvalService.finalize} for the report page's button: the same walk,
   * with its progress lines captured so the page can show what the gate said
   * cell by cell rather than only how many moved.
   * @param runId - the run to finalize.
   * @param by - caller tag recorded against the mission writes.
   * @throws {@link EvalFinalizeRefused} when mission is absent or the run cannot be projected.
   */
  async finalizeView(runId: string, by?: string): Promise<EvalFinalizeView> {
    const log: string[] = []
    const report = await this.finalize(runId, {
      log: (message) => { log.push(message) },
      ...(by === undefined ? {} : { by }),
    })
    return projectFinalize(report, log)
  }
}

export { EvalRunRefused } from './run.ts'
export type { RunOptions, RunReport, RunCellReport, RunSubset } from './run.ts'
export { EvalFinalizeRefused } from './finalize.ts'
export type { FinalizeOptions, FinalizeReport, FinalizeCellOutcome, FinalizeSkipCategory } from './finalize.ts'
export { EvalReadRefused } from './read.ts'
export type { ConditionDiff, ConditionFieldDiff, ConditionsReport, ConditionSummary, RunCellStatus, RunStatusReport } from './read.ts'
export { deriveExperimentStatus, experimentDetail, isJudgedOrBeyond, isReleased, listExperiments, runsForItem } from './experiments.ts'
export { conditionDiffView, conditionsView, reviewPlan } from './review.ts'
export { materializationShaOf, probeRunsOf, runCellDetail, summarizeAnnotations } from './cell-detail.ts'
export { DEFAULT_STUCK_MS, pivotMatrix, repDot } from './matrix-view.ts'
export { bundleDirOf, exportDirCandidates, projectFinalize, projectReport, runReportView } from './report-view.ts'
export type { MatrixInput, MatrixInputCell } from './matrix-view.ts'
export type { ExperimentsInput, ExperimentStatusInput } from './experiments.ts'
export { EvalProvisionRefused } from './provision.ts'
export type { ProvisionReport } from './provision.ts'
export type { ProvisionCheck } from './effective.ts'
