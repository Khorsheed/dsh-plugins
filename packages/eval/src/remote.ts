/**
 * The orchestrator's Remote face: start a run, watch it, stop it — from
 * outside the browser.
 *
 * `/eval run` is a human act taken inside a session, and that stays true. But
 * "inside a session" was also the only door: a CI runner has no browser, so
 * before this face there was no way to start a real run from a pipeline at
 * all (the CLI is dry-run-only by design — outside an instance there is no
 * live parent agent to delegate through). This face is that door, and it is
 * deliberately the same four verbs the slash command uses, over the same job
 * layer: start, status, output, cancel. No second run implementation, and no
 * verb here that the human path does not also have.
 *
 * None of those four takes an agent parameter: a CI caller has no agent, and
 * requiring one would put the door back where it was.
 *
 * The LAB TAB's verbs all take one, for the opposite reason: which experiments
 * and conditions a browser may see follows the calling session's dataset
 * binding, and a session-less read would either see everything or nothing.
 * `runs` / `run` (I5·T35a) read the list and one experiment's overview;
 * `plan` / `conditions` / `conditionDiff` (I5·T36) read the plan review and
 * the condition registry; `matrix` / `cells` / `cell` (I5·T35b) read the
 * matrix, the cell list and one cell in full.
 *
 * Four of them WRITE, and every one is a human's click. `approve` is a click
 * reaching the same `runStart` the slash command reaches — with the approving
 * session as the run's parent, exactly as `/eval run` resolves it. The
 * drawer's three are `retry` (a fresh attempt against an auditable reason),
 * `releaseCheck` (the gate, asked before anything is destroyed) and
 * `exportPlan` / `exportRun` (mission's bundle export, forwarded together
 * with its fail-closed guarded-layer gate). There is no approve-class or
 * run-class MODEL tool and there will not be one (ui-spec R1): the starting
 * verb belongs to the interface, never to the toolset — and nothing here can
 * relax a leak gate it does not implement.
 * @module @khorsheed/dsh-eval/remote
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { EvalService } from './service.ts'
import type {
  EvalApproveRequest,
  EvalApproveResult,
  EvalCellDetail,
  EvalCellReleaseResult,
  EvalCellRequest,
  EvalCellRetryRequest,
  EvalCellRetryResult,
  EvalCellsRequest,
  EvalCellsResult,
  EvalConditionDiffRequest,
  EvalConditionDiffView,
  EvalConditionsRequest,
  EvalConditionsView,
  EvalExperimentDetail,
  EvalExperimentRequest,
  EvalExperimentsRequest,
  EvalExperimentsResult,
  EvalExportPlanRequest,
  EvalExportPlanView,
  EvalExportResultView,
  EvalExportRunRequest,
  EvalFinalizeRequest,
  EvalFinalizeView,
  EvalItemRunsRequest,
  EvalItemRunsResult,
  EvalMatrixRequest,
  EvalMatrixView,
  EvalPlanRequest,
  EvalPlanReview,
  EvalReportRequest,
  EvalRunJobView,
  EvalRunOutputView,
  EvalRunReportView,
  EvalRunRequest,
  EvalRunStarted,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    dshEvalRemote: EvalRemoteService
  }
}

/** Thrown across the wire when a job id names no run this instance started. */
const UNKNOWN_JOB = (jobId: string): Error =>
  new Error(`eval: no run job ${JSON.stringify(jobId)} on this instance`)

/** The orchestrator's Remote service (wire namespace `dshEval`). */
export class EvalRemoteService extends TypertRemoteService<never> {
  static inject = ['dshEval']

  constructor(ctx: Context) {
    super(ctx, 'dshEvalRemote', { namespace: 'dshEval' })
  }

  private get service(): EvalService {
    return this.ctx.dshEval
  }

  /**
   * Start a run in the background and answer with its ids.
   * @param request - the plan path (on the instance) and the run's knobs.
   * @returns the job id, the run id, and the parent session that was resolved.
   */
  @Remote('runStart')
  async runStart(request: EvalRunRequest): Promise<EvalRunStarted> {
    const handle = await this.service.runStart(request.plan, {
      ...(request.dryRun === true ? { dryRun: true } : {}),
      ...(request.concurrency === undefined ? {} : { concurrency: request.concurrency }),
      ...(request.finalize === true ? { finalize: true } : {}),
      ...(request.out === undefined ? {} : { exportsDir: request.out }),
      ...(request.retries === undefined ? {} : { retryInfrastructure: request.retries }),
      ...(request.only === undefined ? {} : { only: request.only }),
      ...(request.maxCells === undefined ? {} : { maxCells: request.maxCells }),
      ...(request.ignoreReadiness === true ? { ignoreReadiness: true } : {}),
      label: `eval run ${request.plan} (remote)`,
    })
    return {
      jobId: handle.jobId,
      runId: handle.runId,
      parentSessionId: handle.parentSessionId,
      ...(handle.ownParentSession === true ? { ownParentSession: true } : {}),
    }
  }

  /**
   * One background run's job status.
   * @param jobId - the id `runStart` returned.
   * @returns the lifecycle view.
   * @throws when this instance never started that job.
   */
  @Remote('runStatus')
  runStatus(jobId: string): EvalRunJobView {
    const status = this.service.runJobStatus(jobId)
    if (status === undefined) throw UNKNOWN_JOB(jobId)
    return status
  }

  /**
   * Read a background run's log from a cursor. Non-consuming: a CI poller and
   * the model-facing `job_output` tool never take lines from each other.
   * @param jobId - the id `runStart` returned.
   * @param cursor - the cursor from the previous read; absent reads from the top.
   * @returns the lines after the cursor and the job's state.
   * @throws when this instance never started that job.
   */
  @Remote('runOutput')
  runOutput(jobId: string, cursor?: number): EvalRunOutputView {
    const output = this.service.runJobOutput(jobId, cursor)
    if (output === undefined) throw UNKNOWN_JOB(jobId)
    return output
  }

  /**
   * Cancel a background run — the same lever `job_kill` pulls, and the only
   * one there is.
   * @param jobId - the id `runStart` returned.
   * @returns `requested` for a live run, `already-finished` otherwise.
   * @throws when this instance never started that job.
   */
  @Remote('runCancel')
  runCancel(jobId: string): 'requested' | 'already-finished' {
    const outcome = this.service.runJobCancel(jobId)
    if (outcome === 'unknown-job') throw UNKNOWN_JOB(jobId)
    return outcome
  }

  /**
   * The lab tab's LIST: every experiment this instance can see — the runs eval
   * started, and the plans in the calling session's dataset repository nobody
   * has started yet.
   *
   * The agent is here for its session: the dataset binding is a human's
   * decision about what this session may see, and honouring it is the whole
   * reason a browser read is not the CI read. Every optional selector rides in
   * the request object — the gateway's client proxy enforces exact positional
   * arity.
   * @param agent - owning live agent; its session resolves the dataset binding.
   * @param request - repository / dataset overrides.
   * @returns the rows, plus a sentence per degraded source.
   */
  @Remote('runs')
  runs(agent: Agent, request: EvalExperimentsRequest): Promise<EvalExperimentsResult> {
    return this.service.experiments({
      session: { id: String(agent.session.id) },
      ...(request.repo === undefined ? {} : { repo: request.repo }),
      ...(request.dataset === undefined ? {} : { dataset: request.dataset }),
    })
  }

  /**
   * One started experiment's overview: the row, the run.meta digest, the
   * readiness records verbatim, the histograms, and the job.
   * @param agent - owning live agent.
   * @param request - the run to open.
   * @returns the detail payload.
   * @throws when the composition mounts no mission service.
   */
  @Remote('run')
  run(agent: Agent, request: EvalExperimentRequest): EvalExperimentDetail {
    void agent
    return this.service.experiment(request.runId)
  }

  /**
   * The PLAN-REVIEW page: the plan's own fields plus `validatePlan`'s verdict
   * as a flat `ok / warn / error` list (ui-spec §五, step 3).
   * @param agent - owning live agent.
   * @param request - the plan document to review.
   * @returns the digest, the check list, and every condition the plan names.
   */
  @Remote('plan')
  plan(agent: Agent, request: EvalPlanRequest): Promise<EvalPlanReview> {
    void agent
    return this.service.planReview(request.planPath)
  }

  /**
   * The CONDITIONS page: every condition the session's repository declares,
   * with its lock and its readiness (ui-spec §五, step 4).
   * @param agent - owning live agent; its session resolves the dataset binding.
   * @param request - repository / dataset overrides.
   * @returns the table rows.
   */
  @Remote('conditions')
  conditions(agent: Agent, request: EvalConditionsRequest): Promise<EvalConditionsView> {
    return this.service.conditionsPage({
      session: { id: String(agent.session.id) },
      ...(request.repo === undefined ? {} : { repo: request.repo }),
      ...(request.dataset === undefined ? {} : { dataset: request.dataset }),
    })
  }

  /**
   * Two conditions, field by field — ONLY what differs.
   * @param agent - owning live agent; its session resolves the dataset binding.
   * @param request - the two references (a condition id, or a path).
   * @returns the differing paths and each side's value as canonical JSON text.
   */
  @Remote('conditionDiff')
  conditionDiff(agent: Agent, request: EvalConditionDiffRequest): Promise<EvalConditionDiffView> {
    return this.service.conditionDiffPage({
      a: request.a,
      b: request.b,
      session: { id: String(agent.session.id) },
      ...(request.repo === undefined ? {} : { repo: request.repo }),
      ...(request.dataset === undefined ? {} : { dataset: request.dataset }),
    })
  }

  /**
   * APPROVE a plan and start it — ui-spec step 5, the button on the
   * plan-review page and nothing else. Validate runs first and an error
   * refuses without starting anything; the approving session becomes the run's
   * parent and its workspace the run's cwd, exactly as `/eval run` resolves
   * them.
   * @param agent - the approving session's live agent (the run's parent).
   * @param request - the plan document to approve.
   * @returns the check list, and — when it started — the job and run ids.
   */
  @Remote('approve')
  approve(agent: Agent, request: EvalApproveRequest): Promise<EvalApproveResult> {
    const cwd = agent.session.header?.cwd
    return this.service.approve(request.planPath, {
      parentSessionId: String(agent.session.id),
      ...(cwd === undefined ? {} : { cwd }),
    })
  }

  /**
   * The MATRIX page: rows are tasks, one factor on the columns, the rest
   * banded or pinned.
   * @param agent - owning live agent (the tab's session).
   * @param request - the run and the reader's arrangement.
   * @returns the rows, columns, groups and the run-level footer.
   */
  @Remote('matrix')
  matrix(agent: Agent, request: EvalMatrixRequest): Promise<EvalMatrixView> {
    void agent
    return this.service.matrix(request.runId, {
      ...(request.column === undefined ? {} : { column: request.column }),
      ...(request.groupBy === undefined ? {} : { groupBy: request.groupBy }),
      ...(request.filter === undefined ? {} : { filter: request.filter }),
      ...(request.stuckMs === undefined ? {} : { stuckMs: request.stuckMs }),
    })
  }

  /**
   * The CELLS page: one run's cells with the same exact-match filters the
   * `eval_cells` tool takes, so the tab and the model read one projection.
   * @param agent - owning live agent.
   * @param request - the run and the filters.
   * @returns the cell rows plus the run's shape.
   */
  @Remote('cells')
  cells(agent: Agent, request: EvalCellsRequest): EvalCellsResult {
    void agent
    return this.service.cellRows(request.runId, {
      ...(request.bucket === undefined ? {} : { bucket: request.bucket }),
      ...(request.task === undefined ? {} : { task: request.task }),
      ...(request.condition === undefined ? {} : { condition: request.condition }),
    })
  }

  /**
   * ONE cell in full — the drawer: attempts, checkpoints, artifacts, the
   * annotation namespaces, the verify output verbatim, the delegation's child
   * session, and whether its resources may be destroyed.
   * @param agent - owning live agent.
   * @param request - the run and the cell.
   */
  @Remote('cell')
  cell(agent: Agent, request: EvalCellRequest): Promise<EvalCellDetail> {
    void agent
    return this.service.cell(request.runId, request.missionId)
  }

  /**
   * Re-run one cell (a human gesture from the drawer). The reason is required
   * and recorded against the fresh attempt; the caller is tagged by session,
   * so the ledger says which tab asked.
   * @param agent - owning live agent; recorded as `tab:<sessionId>`.
   * @param request - the cell, the reason, and mission's retry category.
   * @returns the new attempt number.
   */
  @Remote('retry')
  retry(agent: Agent, request: EvalCellRetryRequest): Promise<EvalCellRetryResult> {
    return this.service.retryCell(request.runId, request.missionId, {
      reason: request.reason,
      category: request.category,
      by: `tab:${String(agent.session.id)}`,
    })
  }

  /**
   * The release check: may this cell's resources be destroyed?
   * @param agent - owning live agent.
   * @param request - the cell.
   */
  @Remote('releaseCheck')
  releaseCheck(agent: Agent, request: EvalCellRequest): EvalCellReleaseResult {
    void agent
    return this.service.releaseCheck(request.runId, request.missionId)
  }

  /**
   * The export dialog's first step: which layers would be written, and which
   * of them are guarded. Forwarded to mission's own Remote — the guarded set
   * and the gate are its, and eval relays without widening.
   * @param agent - owning live agent, passed through unchanged.
   * @param request - run, output directory, layers, snapshot reference.
   */
  @Remote('exportPlan')
  exportPlan(agent: Agent, request: EvalExportPlanRequest): Promise<EvalExportPlanView> {
    return this.service.exportPlan(agent, request)
  }

  /**
   * The export dialog's confirm step. mission re-checks the confirmations
   * against a FRESH plan and refuses on any unconfirmed guarded layer.
   * @param agent - owning live agent, passed through unchanged.
   * @param request - the export plus the confirmed guarded layers.
   */
  @Remote('exportRun')
  exportRun(agent: Agent, request: EvalExportRunRequest): Promise<EvalExportResultView> {
    return this.service.exportRun(agent, request)
  }

  /**
   * The REPORT page (ui-spec step 7): the four invariants, the paired
   * differences, the efficiency table and the judge numbers, read from the
   * run's exported bundle.
   *
   * A READ, and one that writes nothing. The numbers are `analyzeBundle`'s and
   * arrive already gated — a bundle whose invariants did not all hold sends no
   * comparison at all, so the page cannot render one. A run nobody has
   * exported answers with `bundleDir: null` and the directories that were
   * looked in, which is what lets the page offer the export button instead of
   * a blank section.
   * @param agent - owning live agent (the tab's session).
   * @param request - the run, and the export directory to try first.
   * @returns the page payload.
   */
  @Remote('report')
  report(agent: Agent, request: EvalReportRequest): Promise<EvalRunReportView> {
    void agent
    return this.service.runReport(request.runId, request.outDir === undefined ? {} : { outDir: request.outDir })
  }

  /**
   * FINALIZE the run — the report page's button, and a human's click like the
   * drawer's three. Every `archived` cell walks `archived → releasable →
   * released` through the SAME release gate, and a refusal is recorded against
   * that cell rather than forced: the gate is why the archive means anything,
   * and a button that could bypass it would make the bundle worthless.
   * @param agent - owning live agent; recorded as `tab:<sessionId>`.
   * @param request - the run to finalize.
   * @returns the counts, every cell's outcome, and the walk's log verbatim.
   */
  @Remote('finalize')
  finalize(agent: Agent, request: EvalFinalizeRequest): Promise<EvalFinalizeView> {
    return this.service.finalizeView(request.runId, `tab:${String(agent.session.id)}`)
  }

  /**
   * Every evaluation run that answered one dataset item — the 作答记录 the
   * item page shows (T47 consumes it; an empty answer carries its reason so
   * that page can hide the section honestly).
   * @param agent - owning live agent.
   * @param request - the dataset set and the item.
   */
  @Remote('runsForItem')
  runsForItem(agent: Agent, request: EvalItemRunsRequest): EvalItemRunsResult {
    void agent
    return this.service.itemRuns(request.datasetId, request.itemId)
  }
}
