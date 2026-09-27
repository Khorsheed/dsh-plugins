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
 * The LAB TAB's verbs all take one: they are the browser's, reached through a
 * session. Since T73 no verb reads a per-session binding any more —
 * experiments and the condition library belong to the deployment, datasets
 * are pinned registrations — so the agent is only the caller's identity.
 * `runs` / `run` (I5·T35a) read the list and one experiment's overview;
 * `plan` / `conditions` / `conditionDiff` (I5·T36) read the plan review and
 * the condition registry; `matrix` / `cells` / `cell` (I5·T35b) read the
 * matrix, the cell list and one cell in full; `cellArtifact` (I5·T69) reads
 * ONE of that cell's artifacts in place, so the record detail's attachment
 * list is something a person can open rather than a list of paths;
 * `experimentArtifact` (T73) does the same for one experiment's files (the
 * report's 分析初稿 block), and `importExperiments` brings old plans over.
 *
 * `newExperiment` / `draftOptions` (I5·T34) are the 新建实验 form's: one read
 * to fill its pickers, one write that drafts the plan and its new conditions
 * and validates them. That write is the ONE this face shares with a model
 * tool — `eval_plan_draft` reaches the same service verb — and it is shared
 * precisely because drafting is not starting: a draft is a file and a 草稿 row,
 * and every door to `runStart` stays on the human side of R1.
 *
 * Eight of them WRITE, and every one is a human's click. `setPlanNumbers`
 * (T74) is the design page's: 每组次数, the per-cell budget and the judge's
 * sample count, changed in place in the experiment's plan.json before it
 * starts — those four numbers and no other byte, refused once a run exists. `provisionCondition`
 * and `setConditionEndpoint` (I5·T58) are the conditions page's two: the first
 * turns a declaration into a real scoped home and locks it, the second fills
 * in the one contract field the readiness gate refuses a condition for leaving
 * null. Both were a terminal and a text editor before, which is why step 4 of
 * the walkthrough cost six human actions where it should cost two. `approve` is a click
 * reaching the same `runStart` the slash command reaches — with the approving
 * session as the run's parent, exactly as `/eval run` resolves it. The
 * drawer's three are `retry` (a fresh attempt against an auditable reason),
 * `releaseCheck` (the gate, asked before anything is destroyed) and
 * `exportPlan` / `exportRun` (mission's bundle export, forwarded together
 * with its fail-closed guarded-layer gate). There is no approve-class or
 * run-class MODEL tool and there will not be one (ui-spec R1): the starting
 * verb belongs to the interface, never to the toolset — and nothing here can
 * relax a leak gate it does not implement.
 *
 * `humanFinal` (I5·T37) is the sharpest case of that rule. R1 says 终评是人的,
 * and it holds because the only code path that writes the `human-final`
 * namespace is this verb, reached from the judge bench, tagged with the
 * clicking session. `@khorsheed/dsh-eval-tool` registers no twin of it, and
 * the reason it never will is structural rather than editorial: a model with
 * a door to the final verdict would make every run's conclusion its own.
 * @module @khorsheed/dsh-eval/remote
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { EvalService } from './service.ts'
import type {
  EvalAnswerSheet,
  EvalApproveRequest,
  EvalApproveResult,
  EvalArchiveRunRequest,
  EvalArchiveWrite,
  EvalCellAnswersRequest,
  EvalCellArtifactRequest,
  EvalCellArtifactView,
  EvalCellDetail,
  EvalCellReleaseResult,
  EvalCellRequest,
  EvalCellRetryRequest,
  EvalCellRetryResult,
  EvalCellsRequest,
  EvalCellsResult,
  EvalCloseRunRequest,
  EvalClosureWrite,
  EvalConditionDiffRequest,
  EvalConditionDiffView,
  EvalConditionEndpointRequest,
  EvalPlanNumbersRequest,
  EvalPlanNumbersResult,
  EvalConditionEndpointView,
  EvalConditionProvisionRequest,
  EvalConditionProvisionView,
  EvalConditionsRequest,
  EvalConditionsView,
  EvalDraftOptionsRequest,
  EvalDraftOptionsView,
  EvalDraftRequest,
  EvalDraftResult,
  EvalExperimentDetail,
  EvalExperimentRequest,
  EvalExperimentArtifactRequest,
  EvalExperimentArtifactView,
  EvalItemMaterialsRequest,
  EvalItemMaterialsView,
  EvalDatasetFileRequest,
  EvalDatasetFileView,
  EvalJudgePromptPreviewRequest,
  EvalJudgePromptPreviewView,
  EvalJudgePromptRequest,
  EvalJudgePromptView,
  EvalExperimentsRequest,
  EvalImportRequest,
  EvalImportResult,
  EvalExperimentsResult,
  EvalExportPlanRequest,
  EvalExportPlanView,
  EvalExportResultView,
  EvalExportRunRequest,
  EvalFinalizeRequest,
  EvalFinalizeView,
  EvalRunUnitsRequest,
  EvalRunUnitsView,
  EvalHumanFinalRequest,
  EvalHumanFinalResult,
  EvalItemRunsRequest,
  EvalItemRunsResult,
  EvalJudgeQueueRequest,
  EvalJudgeQueueView,
  EvalMatrixRequest,
  EvalMatrixView,
  EvalPlanRequest,
  EvalPlanReview,
  EvalReexportRequest,
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
   * @param request - the experiment (or, legacy, a plan path on the instance) and the run's knobs.
   * @returns the job id, the run id, and the parent session that was resolved.
   */
  @Remote('runStart')
  async runStart(request: EvalRunRequest): Promise<EvalRunStarted> {
    const target = request.experimentId ?? request.plan
    if (target === undefined || target === '') throw new Error('runStart needs experimentId (or, for an old plan, plan)')
    const options = {
      ...(request.dryRun === true ? { dryRun: true } : {}),
      ...(request.concurrency === undefined ? {} : { concurrency: request.concurrency }),
      ...(request.finalize === false ? { finalize: false } : {}),
      ...(request.keepUnits === true ? { keepUnits: true } : {}),
      ...(request.out === undefined ? {} : { exportsDir: request.out }),
      ...(request.retries === undefined ? {} : { retryInfrastructure: request.retries }),
      ...(request.only === undefined ? {} : { only: request.only }),
      ...(request.maxCells === undefined ? {} : { maxCells: request.maxCells }),
      ...(request.ignoreReadiness === true ? { ignoreReadiness: true } : {}),
      label: `eval run ${target} (remote)`,
    }
    const handle = request.experimentId !== undefined
      ? await this.service.runExperimentStart(request.experimentId, options)
      : await this.service.runStart(target, options)
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
   * The lab tab's LIST: every experiment this deployment holds and every run
   * eval started, paired. The request object is kept (empty) because the
   * gateway's client proxy enforces exact positional arity.
   * @param agent - owning live agent; its session is echoed back.
   * @param request - no selectors since T73.
   * @returns the rows, plus a sentence per degraded source.
   */
  @Remote('runs')
  runs(agent: Agent, request: EvalExperimentsRequest): Promise<EvalExperimentsResult> {
    void request
    return this.service.experiments({ session: { id: String(agent.session.id) } })
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
   * @param request - the experiment (or, legacy, a plan path) to review.
   * @returns the digest, the check list, and every condition the plan names.
   */
  @Remote('plan')
  plan(agent: Agent, request: EvalPlanRequest): Promise<EvalPlanReview> {
    void agent
    return this.service.planReview(request)
  }

  /**
   * The CONDITIONS page: every condition in the deployment's library, with
   * its lock and its readiness (ui-spec §五, step 4).
   * @param agent - owning live agent.
   * @param request - no selectors since T73 (kept for positional arity).
   * @returns the table rows.
   */
  @Remote('conditions')
  conditions(agent: Agent, request: EvalConditionsRequest): Promise<EvalConditionsView> {
    void agent
    void request
    return this.service.conditionsPage()
  }

  /**
   * Two conditions, field by field — ONLY what differs.
   * @param agent - owning live agent.
   * @param request - the two references (a condition id, or a path).
   * @returns the differing paths and each side's value as canonical JSON text.
   */
  @Remote('conditionDiff')
  conditionDiff(agent: Agent, request: EvalConditionDiffRequest): Promise<EvalConditionDiffView> {
    void agent
    return this.service.conditionDiffPage({ a: request.a, b: request.b })
  }

  /**
   * PROVISION one condition — ui-spec step 4's action, on the conditions page.
   *
   * A human's click, and never a model tool: provisioning materializes a
   * scoped home and anchors what a subject IS, so it sits on the human side of
   * R1 with 批准并启动 and 终评. It is also ONE click: the same call corrects
   * the declaration's `home.sha` from what it measured and writes the lock
   * against the corrected document, which is what the person used to do by
   * copying a digest between a terminal and an editor (I5·T39 · G7).
   * @param agent - the clicking session.
   * @param request - the condition, and whether to keep the declaration.
   * @returns what provision did, and the row as it now reads.
   */
  @Remote('provisionCondition')
  provisionCondition(agent: Agent, request: EvalConditionProvisionRequest): Promise<EvalConditionProvisionView> {
    void agent
    return this.service.provisionCondition(request)
  }

  /**
   * SET one condition's `model.endpoint` — the only field of an existing
   * declaration any face may change, and the conditions page is where.
   *
   * The readiness gate refuses a null endpoint, and until this verb the only
   * way to fill it in was a text editor (I5·T39 · G6). It is a factor edit:
   * the condition re-hashes, any lock beside it goes stale, and the answer
   * says so rather than re-provisioning on the person's behalf.
   * @param agent - the clicking session.
   * @param request - the condition and the value.
   * @returns what changed, and the row as it now reads.
   */
  @Remote('setConditionEndpoint')
  setConditionEndpoint(agent: Agent, request: EvalConditionEndpointRequest): Promise<EvalConditionEndpointView> {
    void agent
    return this.service.setConditionEndpoint(request)
  }

  /**
   * Change an unstarted experiment's numbers in place (T74). No model tool
   * reaches this: structural edits are the agent's, through a new draft, and
   * the numbers are a person's, on the design page.
   * @param agent - the clicking session.
   * @param request - the experiment and the values to set.
   * @returns what changed, and the plan review re-read from disk.
   */
  @Remote('setPlanNumbers')
  setPlanNumbers(agent: Agent, request: EvalPlanNumbersRequest): Promise<EvalPlanNumbersResult> {
    void agent
    return this.service.setPlanNumbers(request)
  }

  /**
   * DRAFT an experiment — ui-spec step 2, the 新建实验 form's one write.
   *
   * The same service verb `eval_plan_draft` reaches, which is the point of the
   * task that added both: a draft a person fills in on a form and a draft an
   * agent makes in one sentence are the same file written by the same code,
   * and the lab list cannot tell them apart.
   *
   * A write, but NOT a start. It creates the experiment directory and
   * validates what it wrote; a plan validate rejects still lands, as a 草稿.
   * The starting verb is `approve`, one page further on, and this one has no
   * path to it.
   * @param agent - the drafting session, recorded as the experiment's origin.
   * @param request - ui-spec §五's form fields, flat.
   * @returns where the files landed, and validate's verdict on them.
   */
  @Remote('newExperiment')
  newExperiment(agent: Agent, request: EvalDraftRequest): Promise<EvalDraftResult> {
    return this.service.draftExperiment(request, { session: { id: String(agent.session.id) } })
  }

  /**
   * The 新建实验 form's pickers: every registered dataset set, and the items
   * and stage schemas each one holds at its latest commit.
   * @param agent - owning live agent.
   * @param request - no selectors since T73 (kept for positional arity).
   */
  @Remote('draftOptions')
  draftOptions(agent: Agent, request: EvalDraftOptionsRequest): Promise<EvalDraftOptionsView> {
    void agent
    void request
    return this.service.draftOptions()
  }

  /**
   * IMPORT plans from `<registration id>@<ref>` as experiments — the same
   * verb as `dsh-eval import --from`. `git show` only, bytes verbatim; a
   * same-id condition conflict refuses and writes nothing.
   * @param agent - owning live agent.
   * @param request - the source, and optionally the one plan.
   */
  @Remote('importExperiments')
  importExperiments(request: EvalImportRequest): Promise<EvalImportResult> {
    return this.service.importExperiments(request)
  }

  /**
   * Read one file of one experiment in place — the report page's 分析初稿
   * block. The same rules as `cellArtifact`: that experiment's directory only,
   * text only, cut past the size limit and said so.
   * @param agent - owning live agent.
   * @param request - the experiment and the experiment-relative path.
   */
  @Remote('experimentArtifact')
  experimentArtifact(agent: Agent, request: EvalExperimentArtifactRequest): Promise<EvalExperimentArtifactView> {
    void agent
    return this.service.experimentArtifact(request)
  }

  /**
   * 题目抽屉 (T84): one item's files in five tabs and its rubric rows, at the
   * commit the experiment pins.
   * @param agent - owning live agent.
   * @param request - the experiment and the item.
   */
  @Remote('itemMaterials')
  itemMaterials(agent: Agent, request: EvalItemMaterialsRequest): Promise<EvalItemMaterialsView> {
    void agent
    return this.service.itemMaterials(request)
  }

  /**
   * One file of the pinned dataset, text only and capped (T84).
   * @param agent - owning live agent.
   * @param request - the experiment, the item (null: set level), the layer and the path.
   */
  @Remote('datasetFile')
  datasetFile(agent: Agent, request: EvalDatasetFileRequest): Promise<EvalDatasetFileView> {
    void agent
    return this.service.datasetFile(request)
  }

  /**
   * The judge's prompt for one item before the run, material as placeholders (T84).
   * @param agent - owning live agent.
   * @param request - the experiment, the item and optionally the judge condition.
   */
  @Remote('judgePromptPreview')
  judgePromptPreview(agent: Agent, request: EvalJudgePromptPreviewRequest): Promise<EvalJudgePromptPreviewView> {
    void agent
    return this.service.judgePromptPreview(request)
  }

  /**
   * The prompt.md one cell's judging actually wrote (T84), confined to the
   * run's judge directory.
   * @param agent - owning live agent.
   * @param request - the run, the cell, the attempt and optionally the judge/sample.
   */
  @Remote('judgePrompt')
  judgePrompt(agent: Agent, request: EvalJudgePromptRequest): Promise<EvalJudgePromptView> {
    void agent
    return this.service.judgePrompt(request)
  }

  /**
   * APPROVE a plan and start it — ui-spec step 5, the button on the
   * plan-review page and nothing else. Validate runs first and an error
   * refuses without starting anything; the approving session becomes the run's
   * parent and its workspace the run's cwd, exactly as `/eval run` resolves
   * them.
   * @param agent - the approving session's live agent (the run's parent).
   * @param request - the experiment to approve.
   * @returns the check list, and — when it started — the job and run ids.
   */
  @Remote('approve')
  approve(agent: Agent, request: EvalApproveRequest): Promise<EvalApproveResult> {
    const cwd = agent.session.header?.cwd
    return this.service.approve(request.experimentId, {
      parentSessionId: String(agent.session.id),
      ...(cwd === undefined ? {} : { cwd }),
      ...(request.keepUnits === true ? { keepUnits: true } : {}),
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
   * ONE artifact of one attempt, read in place — what makes the record
   * detail's attachment list something a person can OPEN.
   *
   * The drawer listed paths and said a file service was missing. That was
   * true of a download and false of the read: the judge bench already reads
   * the same attempt directory to build its material, so the bytes were
   * reachable all along and only the door was absent.
   *
   * READ-ONLY, and narrow by construction. The path is resolved against that
   * attempt's run-data directory and both sides are `realpath`-checked, so
   * neither a `../` nor a symlink laid inside the archive can point it out of
   * the cell. Text extensions only, capped; a binary is refused by name and
   * says so, and a directory answers with its entries.
   *
   * This page is NOT blind and must not pretend to be: the record detail
   * already names the condition in its header, so the material crosses
   * un-de-identified. The blind read is `judgeQueue`'s, over the same files,
   * through the run's own scrub table.
   * @param agent - owning live agent.
   * @param request - the run, the cell, the attempt and the path.
   */
  @Remote('cellArtifact')
  cellArtifact(agent: Agent, request: EvalCellArtifactRequest): Promise<EvalCellArtifactView> {
    void agent
    return this.service.cellArtifact(request)
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
    return this.service.exportRun(agent, request, `tab:${String(agent.session.id)}`)
  }

  /**
   * EXPORT AGAIN — the report page's and the judge bench's one-click repeat
   * after a final verdict (I5·T39 · G17).
   *
   * The bundle is written when the run ends; `human-final` is written
   * afterwards and never travels back into it. This repeats the export the
   * run's own note recorded — same layers, same snapshot reference — into a
   * fresh directory beside the first, writes the report into it, and records
   * a new note. Nothing guarded is re-confirmed here: a repeat may only carry
   * what a person already confirmed once, and mission re-checks that against a
   * FRESH plan, so a layer that became guarded meanwhile refuses the call and
   * sends the reader to the dialog.
   * @param agent - owning live agent; recorded as `tab:<sessionId>` on the note.
   * @param request - the run to export again.
   * @returns the new bundle, its report, and the timestamps.
   */
  @Remote('reexport')
  reexport(agent: Agent, request: EvalReexportRequest): Promise<EvalExportResultView> {
    return this.service.reexportRun(agent, request, `tab:${String(agent.session.id)}`)
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
   *
   * It is also the page's 回收 action. The two are one verb on purpose: what
   * reclaiming a container IS, is the cell passing its gate, so a second verb
   * that skipped the ledger would be the force this whole seam refuses.
   * @param agent - owning live agent; recorded as `tab:<sessionId>`.
   * @param request - the run to finalize.
   * @returns the counts, every cell's outcome, what became of the containers,
   *   and the walk's log verbatim.
   */
  @Remote('finalize')
  finalize(agent: Agent, request: EvalFinalizeRequest): Promise<EvalFinalizeView> {
    return this.service.finalizeView(request.runId, `tab:${String(agent.session.id)}`)
  }

  /**
   * The units lab is holding for this run RIGHT NOW — the report page's 未回收
   * count. A read: it lists containers, it never touches one.
   * @param agent - owning live agent (the tab's session).
   * @param request - the run to ask about.
   * @returns the held units with their cells' states, or why the list is unknown.
   */
  @Remote('runUnits')
  runUnits(agent: Agent, request: EvalRunUnitsRequest): Promise<EvalRunUnitsView> {
    void agent
    return this.service.runUnits(request.runId)
  }

  /**
   * One 题's answers, every group and rep — the answer view's named read
   * (I5·T75). Names the groups, like the record detail it opens from; the
   * blind read stays {@link judgeQueue}'s.
   * @param agent - owning live agent (the tab's session).
   * @param request - the run and the 题.
   */
  @Remote('cellAnswers')
  cellAnswers(agent: Agent, request: EvalCellAnswersRequest): Promise<EvalAnswerSheet> {
    void agent
    return this.service.cellAnswers(request)
  }

  /**
   * The JUDGE BENCH's queue (ui-spec step 8): the run's cells as BLIND
   * entries — an ordinal and an opaque ticket each — with their
   * de-identified material, the rubric's `human` criteria, the llm-draft
   * samples already recorded and whatever human-final they carry.
   *
   * Nothing naming a condition, a harness or a model crosses this seam. That
   * is what makes the review blind, and it is enforced by what the payload
   * CONTAINS rather than by what the page chooses to render.
   * @param agent - owning live agent (the tab's session).
   * @param request - the run whose cells are being graded.
   */
  @Remote('judgeQueue')
  judgeQueue(agent: Agent, request: EvalJudgeQueueRequest): Promise<EvalJudgeQueueView> {
    void agent
    return this.service.judgeQueue(request.runId)
  }

  /**
   * Record one cell's human-final verdicts — the bench's one write, and the
   * ONLY door the `human-final` namespace has.
   *
   * Append-only (mission's `annotate` never rewrites) and attributed to the
   * clicking session, so the report's `tool:`-written red flag can never fire
   * on a verdict that came from here.
   * @param agent - the grading session; recorded as `tab:<sessionId>`.
   * @param request - the run, the cell's ticket, and the verdicts.
   */
  @Remote('humanFinal')
  humanFinal(agent: Agent, request: EvalHumanFinalRequest): Promise<EvalHumanFinalResult> {
    return this.service.humanFinal(request.runId, request.ticket, request.verdicts, String(agent.session.id))
  }

  /**
   * Take one of the four closure exits at the bottom of the judge bench
   * (T72). A HUMAN gesture from the tab — the eval tools have no path here.
   * @param agent - the closing session; recorded as `tab:<sessionId>`.
   * @param request - the run, the exit, and its reason.
   */
  @Remote('closeRun')
  closeRun(agent: Agent, request: EvalCloseRunRequest): Promise<EvalClosureWrite> {
    return this.service.closeRun(request.runId, { exit: request.exit, reason: request.reason ?? null }, `tab:${String(agent.session.id)}`)
  }

  /**
   * Archive or un-archive an experiment. Changes the list's grouping only.
   * @param agent - the session; recorded as `tab:<sessionId>`.
   * @param request - the run and the flag.
   */
  @Remote('archiveRun')
  archiveRun(agent: Agent, request: EvalArchiveRunRequest): Promise<EvalArchiveWrite> {
    return this.service.archiveRun(request.runId, request.archived, `tab:${String(agent.session.id)}`)
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
