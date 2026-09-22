/**
 * The lab tab's transient store: the experiment list, which row is open, which
 * of the detail's FOUR STAGES is showing, each stage's own payload, and — for
 * the grid — how the reader arranged it. Module level exports the factory
 * only: a module-level handle would pin the store's identity in the module
 * cache (a de-facto singleton surviving plugin reloads).
 */
import { defineStore } from '@deepseek-ai/dsh-client-store'
import type { EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type {
  EvalCellArtifactView, EvalCellDetail, EvalCellsResult, EvalConditionDiffView, EvalConditionProvisionView, EvalConditionRow,
  EvalConditionsView, EvalExperimentDetail,
  EvalExperimentsResult, EvalFinalizeView, EvalJudgeQueueView, EvalMatrixView, EvalPlanReview,
  EvalRunOutputView, EvalRunReportView, EvalRunUnitsView,
} from '../types.ts'

/**
 * What an approval started, kept for the rest of the visit. The mission ledger
 * does not hold the run until the orchestrator calls `runCreate`, which is
 * seconds away and may never happen at all (the readiness gate refuses before
 * it), so the ids the approve answered with are the ONLY handle on the run for
 * that window — and the job's log is the only place its refusal is written.
 */
export interface LabStartedRun {
  /** The plan that was approved (absolute), which is what re-finds its row. */
  planPath: string
  jobId: string
  runId: string
  parentSessionId: string
}

/**
 * The detail's four STAGES, in the order ui-spec §五 v2 fixes them — the shape
 * of the work rather than the shape of the data.
 *
 * v1 had seven sub-pages and each one was a correct label over a pile of
 * fields: the overview and the plan review were very nearly the same
 * definition list, and neither had an action. The four here are the four
 * things a person actually does, in the order they do them, and each one
 * carries ONE primary action (see {@link LabViewState.page} and the stage bar).
 *
 * The merge: 实验设计 absorbs the old overview + plan review + conditions;
 * 运行记录 absorbs the matrix (now the grid at its top) + cells; 结果对比 is
 * the report; 人工评估 is the judge bench.
 */
export const LAB_PAGES = ['design', 'runs', 'compare', 'review'] as const

/**
 * How long the view waits for an approved run to reach the ledger before it
 * stops re-reading: {@link START_FOLLOWUP_LIMIT} re-reads, one every
 * {@link START_FOLLOWUP_MS}, so about a minute.
 *
 * A bound and not a poll. `runCreate` lands seconds after the approval
 * answers, so the wait normally ends on the first or second tick; what it must
 * not do is run forever on a run the readiness gate REFUSED, which never
 * reaches the ledger at all and whose refusal is in the job log the overview
 * already shows.
 */
export const START_FOLLOWUP_MS = 4000
/** @see START_FOLLOWUP_MS */
export const START_FOLLOWUP_LIMIT = 15

/** One stage of an experiment's detail. */
export type LabPage = typeof LAB_PAGES[number]

/**
 * The run-record list's five filters (ui-spec §五 v2). 「失败」 is a ledger
 * STATE (`halted`) and the other three are mission buckets; the list applies
 * all five the same way so the counts beside them count one population.
 */
export const RUN_FILTERS = ['all', 'active', 'done', 'failed', 'blocked'] as const

/** @see RUN_FILTERS */
export type RunFilter = typeof RUN_FILTERS[number]

/**
 * What the condition page's action seat is currently saying: a receipt the
 * person just earned, or a failure.
 *
 * Two shapes rather than one pre-joined sentence, because a failure has to
 * reach the page as {what failed, raw message} for the error seat to fold the
 * raw half away (ui-spec §九) — joining them here would put the host's English
 * exception back on the page, which is what I5·T62 is removing.
 */
export type ConditionActionNote =
  | { kind: 'receipt'; text: string }
  | { kind: 'failure'; what: string; message: string }

/** The view's state; fetched results are whole values, null until loaded. */
export interface LabViewState {
  /** The list payload, or null before the first load. */
  list: EvalExperimentsResult | null
  /** Whether a list fetch is in flight. */
  loading: boolean
  /** Human-readable list-fetch failure, or null when idle. */
  error: string | null
  /** Bumped by the refresh action to re-trigger every fetch. */
  refreshRev: number
  /** The open experiment's row id, or null while the list is showing. */
  selection: string | null
  /** Which sub-page of the detail is showing. */
  page: LabPage
  /** The open experiment's detail, or null for a draft / before one completes. */
  detail: EvalExperimentDetail | null
  /** Whether a detail fetch is in flight. */
  detailLoading: boolean
  /** Human-readable detail-fetch failure, or null. */
  detailError: string | null
  /** The plan-review payload for the open experiment, or null before it loads. */
  review: EvalPlanReview | null
  /** Whether a review fetch is in flight. */
  reviewLoading: boolean
  /** Human-readable review-fetch failure, or null. */
  reviewError: string | null
  /**
   * Whether the reviewer pressed 退回修改. Page-local by design: sending a plan
   * back is a note to the humans looking at this tab, not an edit — the plan
   * file is the agent's or the author's to change, and a button that rewrote
   * it would make the reviewer the author.
   */
  sentBack: boolean
  /** Whether an approval is in flight (the button is disabled meanwhile). */
  approving: boolean
  /** The refusal an approval answered with, verbatim; null when none. */
  approveRefusal: string | null
  /**
   * The approval call's own FAILURE, as opposed to the gate's refusal above.
   * A refusal is the mechanism working and is quoted verbatim (it is the only
   * place a readiness verdict is written); a failure is an exception, and the
   * page renders it through the three-part error seat (ui-spec §九).
   */
  approveError: string | null
  /** What the approval started; null until one succeeds in this visit. */
  started: LabStartedRun | null
  /**
   * How many times this visit has re-read the list WAITING for the started
   * run to appear in the ledger (I5·T39 · G11).
   *
   * `runCreate` happens seconds after the approval answers, so the refresh the
   * approval fires lands before the run exists and every run-scoped sub-page
   * is left saying 未开始 until a person presses Refresh. The follow-up
   * re-reads until the row carries a run id — and stops at
   * {@link START_FOLLOWUP_LIMIT}, because a run the readiness gate REFUSED
   * never appears at all and a wait with no end is a poll nobody asked for.
   */
  startFollowUps: number
  /** The started job's log, verbatim — where the readiness refusal is written. */
  output: EvalRunOutputView | null
  /** Human-readable job-log failure, or null. */
  outputError: string | null
  /** The conditions page's table, or null before it loads. */
  conditions: EvalConditionsView | null
  /** Whether a conditions fetch is in flight. */
  conditionsLoading: boolean
  /** Human-readable conditions-fetch failure, or null. */
  conditionsError: string | null
  /**
   * The condition a provision or an endpoint write is in flight for, or null.
   * One at a time on purpose: both write the same declaration, and two
   * overlapping writes would race over one file.
   */
  conditionBusy: string | null
  /** What the last provision on this page answered, or null. */
  provision: EvalConditionProvisionView | null
  /** What the last provision or endpoint write had to say, or null. */
  conditionAction: ConditionActionNote | null
  /** The condition whose endpoint field is open for editing, or null. */
  endpointEditing: string | null
  /** The one or two conditions picked for the diff, in pick order. */
  diffPair: string[]
  /** The diff of the picked pair, or null until both are picked. */
  diff: EvalConditionDiffView | null
  /** Human-readable diff failure, or null. */
  diffError: string | null

  /** The factor the matrix puts on its columns; null takes the first one. */
  matrixColumn: string | null
  /** Remaining factors banding the matrix rows. */
  matrixGroupBy: string[]
  /** Remaining factors pinned to one canonical value each. */
  matrixFilter: Record<string, string>
  /** The matrix payload, or null before the first load. */
  matrix: EvalMatrixView | null
  matrixLoading: boolean
  matrixError: string | null

  /**
   * The run-record list's filter — ui-spec §五 v2's five: 全部 / 运行中 / 完成 /
   * 失败 / 阻塞.
   *
   * Applied in the BROWSER over the whole run's rows rather than by re-asking
   * the host per bucket. Two of the five are not buckets at all (「失败」 is the
   * `halted` ledger state, which mission projects into `done`), so a
   * server-side bucket filter could answer three of them and would have to
   * fetch everything for the other two anyway — and the counts beside the
   * chips would then be counting different populations.
   */
  runFilter: RunFilter
  /** The cell list, or null before the first load. */
  cells: EvalCellsResult | null
  cellsLoading: boolean
  cellsError: string | null

  /** The cell whose drawer is open, or null. */
  cellSelection: string | null
  /** The open cell's detail, or null before it completes. */
  cell: EvalCellDetail | null
  cellLoading: boolean
  cellError: string | null

  /**
   * The attachment the open record has expanded, and what came back.
   *
   * The PATH is the selection and the payload is a cache of one read: a
   * reader opens `stage1.md`, then `stage2.md`, and the second read replaces
   * the first rather than accumulating a pane per file. Null path means
   * nothing is expanded, which is the state every fresh drawer starts in —
   * the detail should read as a record, not as a file browser.
   */
  artifactPath: string | null
  artifact: EvalCellArtifactView | null
  artifactLoading: boolean
  artifactError: string | null

  /**
   * The (题目 × 对比组) the record list is narrowed to, set by a click on the
   * 结果对比 page's tables and cleared by the chip it puts on screen.
   *
   * A report cell names a task and a comparison group, and that names as many
   * RECORDS as the run has reps — so «跳到那条记录» can only mean one record
   * when there is one, and must mean «those records» when there are more.
   * Carrying the pair rather than resolving it to a mission id at click time
   * is what lets the page say which it is: one match opens its detail, several
   * leave the list standing with the chip above it.
   */
  recordFocus: { task: string; condition: string } | null

  /**
   * The report page's payload, or null before it loads. A run with no bundle
   * is NOT null: it is a payload whose `bundleDir` is null and which carries
   * the directories that were looked in, so the page shows a state with a
   * button instead of a spinner that never ends.
   */
  report: EvalRunReportView | null
  reportLoading: boolean
  reportError: string | null
  /** Whether a finalize walk is in flight (the button is disabled meanwhile). */
  finalizing: boolean
  /** The last finalize walk's outcome, verbatim; null until one runs. */
  finalizeResult: EvalFinalizeView | null
  /**
   * The containers lab still holds for this run — lab's own list, re-read
   * after every finalize walk. Null before it loads, and a payload whose
   * `available` is false when this composition has no lab: the page must be
   * able to say 未知 where it would otherwise print a confident 0.
   */
  runUnits: EvalRunUnitsView | null
  runUnitsError: string | null
  /**
   * The export directory the report page looks in FIRST, set two ways: an
   * export made in this visit (the dialog takes a free-text path), or a
   * directory the reader typed on the report page itself.
   *
   * Both exist for the same reason. A run started with `--out <dir>` records
   * nothing about where its bundle went — `run.meta` names the plan and the
   * repository, and neither is where the bundle is — so without a way to say
   * "look over there", the page would report 未导出 about a bundle that is on
   * disk and exported.
   */
  lookIn: string | null

  /**
   * The judge bench's queue, or null before it loads. Every cell in it is
   * BLIND — an ordinal and a ticket, no condition, harness or model — so
   * nothing this store holds can unblind a grader.
   */
  judge: EvalJudgeQueueView | null
  judgeLoading: boolean
  judgeError: string | null
  /**
   * The ITEM being graded, or null while the queue is showing.
   *
   * An item and not a cell since I5·T67: ui-spec §五 v2 puts the answers to
   * one item side by side, because a grader reading four answers to the same
   * question applies one standard to all four, and reading them one page at a
   * time is how a standard drifts between the first and the last.
   */
  judgeTask: string | null
  /**
   * The grader's in-progress answers: ticket → criterion id → the verdict
   * being composed.
   *
   * Keyed by TICKET because several answers are on screen at once and each is
   * graded on its own (the verdict contract is unchanged: one score per
   * cell, never a choice between cells). Cleared when the item changes or a
   * submission lands, so a half-written answer never follows a grader to the
   * next question.
   */
  judgeDraft: Record<string, Record<string, { pass: boolean; evidence: string }>>
  /** Whether a human-final submission is in flight (the button is disabled meanwhile). */
  judgeSubmitting: boolean

  /** Whether the export dialog is open. */
  exportOpen: boolean
  /** Whether a one-click re-export is in flight (both buttons are disabled meanwhile). */
  reexporting: boolean
  /** One-shot notice line (retry / release check / export outcomes), or null. */
  notice: string | null
  /**
   * The same one-shot seat when the gesture FAILED: the raw failure message,
   * which the page renders through the three-part error seat rather than
   * printing (ui-spec §九). Kept apart from `notice` because that field holds
   * sentences this tab wrote for a human, and this one holds a sentence the
   * host wrote for whoever debugs it — the two cannot share a renderer.
   */
  noticeError: string | null
}

/** Annotation twin of the actions literal below (drift fails assignability at defineStore). */
export type LabViewActions = {
  setList: (draft: LabViewState, list: EvalExperimentsResult) => void
  setLoading: (draft: LabViewState, loading: boolean) => void
  setError: (draft: LabViewState, error: string | null) => void
  refresh: (draft: LabViewState) => void
  open: (draft: LabViewState, id: string | null) => void
  setPage: (draft: LabViewState, page: LabPage) => void
  setDetail: (draft: LabViewState, detail: EvalExperimentDetail) => void
  setDetailLoading: (draft: LabViewState, loading: boolean) => void
  setDetailError: (draft: LabViewState, error: string | null) => void
  setReview: (draft: LabViewState, review: EvalPlanReview) => void
  setReviewLoading: (draft: LabViewState, loading: boolean) => void
  setReviewError: (draft: LabViewState, error: string | null) => void
  sendBack: (draft: LabViewState) => void
  setApproving: (draft: LabViewState, approving: boolean) => void
  setApproveRefusal: (draft: LabViewState, refusal: string | null) => void
  setApproveError: (draft: LabViewState, message: string | null) => void
  setStarted: (draft: LabViewState, started: LabStartedRun) => void
  countStartFollowUp: (draft: LabViewState) => void
  setOutput: (draft: LabViewState, output: EvalRunOutputView) => void
  setOutputError: (draft: LabViewState, error: string | null) => void
  setConditions: (draft: LabViewState, conditions: EvalConditionsView) => void
  setConditionsLoading: (draft: LabViewState, loading: boolean) => void
  setConditionsError: (draft: LabViewState, error: string | null) => void
  setConditionBusy: (draft: LabViewState, id: string | null) => void
  setProvision: (draft: LabViewState, provision: EvalConditionProvisionView | null) => void
  setConditionAction: (draft: LabViewState, note: ConditionActionNote | null) => void
  editEndpoint: (draft: LabViewState, id: string | null) => void
  applyConditionRow: (draft: LabViewState, row: EvalConditionRow) => void
  pickCondition: (draft: LabViewState, id: string) => void
  setDiff: (draft: LabViewState, diff: EvalConditionDiffView) => void
  setDiffError: (draft: LabViewState, error: string | null) => void
  setMatrixColumn: (draft: LabViewState, column: string | null) => void
  toggleMatrixGroup: (draft: LabViewState, factor: string) => void
  setMatrixFilter: (draft: LabViewState, factor: string, value: string | null) => void
  setMatrix: (draft: LabViewState, matrix: EvalMatrixView) => void
  setMatrixLoading: (draft: LabViewState, loading: boolean) => void
  setMatrixError: (draft: LabViewState, error: string | null) => void
  setRunFilter: (draft: LabViewState, filter: RunFilter) => void
  setCells: (draft: LabViewState, cells: EvalCellsResult) => void
  setCellsLoading: (draft: LabViewState, loading: boolean) => void
  setCellsError: (draft: LabViewState, error: string | null) => void
  openCell: (draft: LabViewState, missionId: string | null) => void
  setCell: (draft: LabViewState, cell: EvalCellDetail) => void
  setCellLoading: (draft: LabViewState, loading: boolean) => void
  setCellError: (draft: LabViewState, error: string | null) => void
  openArtifact: (draft: LabViewState, path: string | null) => void
  setArtifact: (draft: LabViewState, artifact: EvalCellArtifactView) => void
  setArtifactLoading: (draft: LabViewState, loading: boolean) => void
  setArtifactError: (draft: LabViewState, error: string | null) => void
  focusRecords: (draft: LabViewState, focus: { task: string; condition: string } | null) => void
  setReport: (draft: LabViewState, report: EvalRunReportView) => void
  setReportLoading: (draft: LabViewState, loading: boolean) => void
  setReportError: (draft: LabViewState, error: string | null) => void
  setFinalizing: (draft: LabViewState, finalizing: boolean) => void
  setFinalizeResult: (draft: LabViewState, result: EvalFinalizeView | null) => void
  setRunUnits: (draft: LabViewState, units: EvalRunUnitsView) => void
  setRunUnitsError: (draft: LabViewState, error: string | null) => void
  setLookIn: (draft: LabViewState, dir: string) => void
  setJudge: (draft: LabViewState, view: EvalJudgeQueueView) => void
  setJudgeLoading: (draft: LabViewState, loading: boolean) => void
  setJudgeError: (draft: LabViewState, error: string | null) => void
  openJudgeTask: (draft: LabViewState, task: string | null) => void
  setJudgeDraft: (draft: LabViewState, ticket: string, criterion: string, value: { pass: boolean; evidence: string }) => void
  clearJudgeDraft: (draft: LabViewState, ticket: string) => void
  setJudgeSubmitting: (draft: LabViewState, submitting: boolean) => void
  setExportOpen: (draft: LabViewState, open: boolean) => void
  setReexporting: (draft: LabViewState, reexporting: boolean) => void
  setNotice: (draft: LabViewState, notice: string | null) => void
  setNoticeError: (draft: LabViewState, message: string | null) => void
}

const INITIAL: LabViewState = {
  list: null,
  loading: false,
  error: null,
  refreshRev: 0,
  selection: null,
  page: 'design',
  detail: null,
  detailLoading: false,
  detailError: null,
  review: null,
  reviewLoading: false,
  reviewError: null,
  sentBack: false,
  approving: false,
  approveRefusal: null,
  approveError: null,
  started: null,
  startFollowUps: 0,
  output: null,
  outputError: null,
  conditions: null,
  conditionsLoading: false,
  conditionsError: null,
  conditionBusy: null,
  provision: null,
  conditionAction: null,
  endpointEditing: null,
  diffPair: [],
  diff: null,
  diffError: null,
  matrixColumn: null,
  matrixGroupBy: [],
  matrixFilter: {},
  matrix: null,
  matrixLoading: false,
  matrixError: null,
  runFilter: 'all',
  cells: null,
  cellsLoading: false,
  cellsError: null,
  cellSelection: null,
  cell: null,
  cellLoading: false,
  cellError: null,
  artifactPath: null,
  artifact: null,
  artifactLoading: false,
  artifactError: null,
  recordFocus: null,
  report: null,
  reportLoading: false,
  reportError: null,
  finalizing: false,
  finalizeResult: null,
  runUnits: null,
  runUnitsError: null,
  lookIn: null,
  judge: null,
  judgeLoading: false,
  judgeError: null,
  judgeTask: null,
  judgeDraft: {},
  judgeSubmitting: false,
  exportOpen: false,
  reexporting: false,
  notice: null,
  noticeError: null,
}

/**
 * What `open` clears: everything that belongs to the experiment being left.
 * The two collection-valued matrix fields are NOT here — `Object.assign`
 * would alias one array and one object across every experiment — so `open`
 * sets those itself, the way it already does for the diff pair.
 */
const PER_EXPERIMENT: Pick<
  LabViewState,
  'detail' | 'detailError' | 'review' | 'reviewError' | 'sentBack' | 'approving' | 'approveRefusal' | 'approveError'
  | 'started' | 'startFollowUps' | 'output' | 'outputError' | 'matrixColumn' | 'matrix' | 'matrixError'
  | 'runFilter' | 'cells' | 'cellsError' | 'cellSelection' | 'cell' | 'cellError'
  | 'artifactPath' | 'artifact' | 'artifactError' | 'recordFocus'
  | 'report' | 'reportError' | 'finalizing' | 'finalizeResult' | 'runUnits' | 'runUnitsError' | 'lookIn'
  | 'judge' | 'judgeError' | 'judgeTask' | 'judgeSubmitting'
  | 'exportOpen' | 'reexporting' | 'notice' | 'noticeError'
> = {
  detail: null,
  detailError: null,
  review: null,
  reviewError: null,
  sentBack: false,
  approving: false,
  approveRefusal: null,
  approveError: null,
  started: null,
  startFollowUps: 0,
  output: null,
  outputError: null,
  matrixColumn: null,
  matrix: null,
  matrixError: null,
  runFilter: 'all',
  cells: null,
  cellsError: null,
  cellSelection: null,
  cell: null,
  cellError: null,
  artifactPath: null,
  artifact: null,
  artifactError: null,
  recordFocus: null,
  report: null,
  reportError: null,
  finalizing: false,
  finalizeResult: null,
  runUnits: null,
  runUnitsError: null,
  lookIn: null,
  judge: null,
  judgeError: null,
  judgeTask: null,
  judgeSubmitting: false,
  exportOpen: false,
  reexporting: false,
  notice: null,
  noticeError: null,
}

/**
 * Create the lab view store handle.
 * @returns the store handle (spec + type + identity + factory in one).
 */
export function createLabViewStore(): EngineStoreHandle<LabViewState, LabViewActions> {
  return defineStore({
    init: (): LabViewState => ({ ...INITIAL, matrixGroupBy: [], matrixFilter: {}, diffPair: [], judgeDraft: {} }),
    actions: {
      setList: (d, list: EvalExperimentsResult) => {
        d.list = list
        d.error = null
      },
      setLoading: (d, loading: boolean) => { d.loading = loading },
      setError: (d, error: string | null) => { d.error = error },
      refresh: (d) => { d.refreshRev += 1 },
      open: (d, id: string | null) => {
        d.selection = id
        // Opening an experiment always lands on 实验设计: the stage is a
        // property of the visit, not of the experiment, and the design stage
        // is the one that reads as an answer to «what is this run».
        d.page = 'design'
        Object.assign(d, PER_EXPERIMENT)
        // Fresh instances, never the constant's: assigning them would alias
        // one array and one object across every experiment the visit opens.
        d.matrixGroupBy = []
        d.matrixFilter = {}
        d.judgeDraft = {}
        // The condition registry is the REPOSITORY's, not the experiment's, so
        // the listing survives; the picked pair does not, because a diff read
        // beside one experiment means nothing beside the next.
        d.diffPair = []
        d.diff = null
        d.diffError = null
      },
      setPage: (d, page: LabPage) => { d.page = page },
      setDetail: (d, detail: EvalExperimentDetail) => {
        d.detail = detail
        d.detailError = null
      },
      setDetailLoading: (d, loading: boolean) => { d.detailLoading = loading },
      setDetailError: (d, error: string | null) => { d.detailError = error },
      setReview: (d, review: EvalPlanReview) => {
        d.review = review
        d.reviewError = null
      },
      setReviewLoading: (d, loading: boolean) => { d.reviewLoading = loading },
      setReviewError: (d, error: string | null) => { d.reviewError = error },
      sendBack: (d) => { d.sentBack = true },
      setApproving: (d, approving: boolean) => { d.approving = approving },
      // One seat, two renderers (see the two fields' docs).
      setApproveRefusal: (d, refusal: string | null) => { d.approveRefusal = refusal; d.approveError = null },
      setApproveError: (d, message: string | null) => { d.approveError = message; d.approveRefusal = null },
      setStarted: (d, started: LabStartedRun) => {
        d.started = started
        d.startFollowUps = 0
        d.approveRefusal = null
        d.approveError = null
        // An approved plan is no longer sent back, whatever the reviewer
        // pressed earlier in this visit.
        d.sentBack = false
      },
      // One tick of the wait for the started run to reach the ledger. Counted
      // rather than timed: the page only needs to know when to give up.
      countStartFollowUp: (d) => { d.startFollowUps += 1 },
      setOutput: (d, output: EvalRunOutputView) => {
        d.output = output
        d.outputError = null
      },
      setOutputError: (d, error: string | null) => { d.outputError = error },
      setConditions: (d, conditions: EvalConditionsView) => {
        d.conditions = conditions
        d.conditionsError = null
      },
      setConditionsLoading: (d, loading: boolean) => { d.conditionsLoading = loading },
      setConditionsError: (d, error: string | null) => { d.conditionsError = error },
      setConditionBusy: (d, id: string | null) => { d.conditionBusy = id },
      setProvision: (d, provision: EvalConditionProvisionView | null) => {
        d.provision = provision
        d.conditionAction = null
      },
      setConditionAction: (d, note: ConditionActionNote | null) => { d.conditionAction = note },
      editEndpoint: (d, id: string | null) => {
        d.endpointEditing = id
        d.conditionAction = null
      },
      /**
       * Replace one row in place with what the write answered. A refetch would
       * also work and would cost a walk of the whole `conditions/` directory
       * to learn what the call that just returned already said — and it would
       * drop the picked diff pair's rendering for a frame.
       */
      applyConditionRow: (d, row: EvalConditionRow) => {
        if (d.conditions === null) return
        d.conditions.rows = d.conditions.rows.map(entry => (entry.id === row.id && entry.dataset === row.dataset ? row : entry))
        // The pair's diff was computed against the pre-write declarations.
        if (d.diffPair.includes(row.id)) {
          d.diff = null
          d.diffError = null
        }
      },
      pickCondition: (d, id: string) => {
        // Two slots, filled in click order: picking a third drops the older of
        // the two, so comparing a chain of conditions never needs a clear step.
        if (d.diffPair.includes(id)) d.diffPair = d.diffPair.filter(entry => entry !== id)
        else if (d.diffPair.length < 2) d.diffPair = [...d.diffPair, id]
        else d.diffPair = [d.diffPair[1] as string, id]
        d.diff = null
        d.diffError = null
      },
      setDiff: (d, diff: EvalConditionDiffView) => {
        d.diff = diff
        d.diffError = null
      },
      setDiffError: (d, error: string | null) => { d.diffError = error },

      setMatrixColumn: (d, column: string | null) => {
        d.matrixColumn = column
        // A factor cannot be the column and a band at once, and pinning the
        // column's own factor would collapse the comparison to one column.
        d.matrixGroupBy = d.matrixGroupBy.filter(factor => factor !== column)
        if (column !== null && column in d.matrixFilter) {
          const next = { ...d.matrixFilter }
          delete next[column]
          d.matrixFilter = next
        }
        d.matrix = null
      },
      toggleMatrixGroup: (d, factor: string) => {
        d.matrixGroupBy = d.matrixGroupBy.includes(factor)
          ? d.matrixGroupBy.filter(entry => entry !== factor)
          : [...d.matrixGroupBy, factor]
        d.matrix = null
      },
      setMatrixFilter: (d, factor: string, value: string | null) => {
        const next = { ...d.matrixFilter }
        if (value === null) delete next[factor]
        else next[factor] = value
        d.matrixFilter = next
        d.matrix = null
      },
      setMatrix: (d, matrix: EvalMatrixView) => {
        d.matrix = matrix
        d.matrixError = null
      },
      setMatrixLoading: (d, loading: boolean) => { d.matrixLoading = loading },
      setMatrixError: (d, error: string | null) => { d.matrixError = error },

      // The filter narrows rows already in hand, so it does NOT drop the
      // payload: blanking the list to re-read the same cells is a spinner
      // where a person expected a subset.
      setRunFilter: (d, filter: RunFilter) => { d.runFilter = filter },
      setCells: (d, cells: EvalCellsResult) => {
        d.cells = cells
        d.cellsError = null
      },
      setCellsLoading: (d, loading: boolean) => { d.cellsLoading = loading },
      setCellsError: (d, error: string | null) => { d.cellsError = error },

      openCell: (d, missionId: string | null) => {
        d.cellSelection = missionId
        d.cell = null
        d.cellError = null
        d.exportOpen = false
        // A new record is a new set of attachments: an expanded file from the
        // record just closed must not stay on screen under another record's
        // header, where it would read as that record's output.
        d.artifactPath = null
        d.artifact = null
        d.artifactError = null
      },
      openArtifact: (d, path: string | null) => {
        d.artifactPath = path
        d.artifact = null
        d.artifactError = null
      },
      setArtifact: (d, artifact: EvalCellArtifactView) => {
        d.artifact = artifact
        d.artifactError = null
      },
      setArtifactLoading: (d, loading: boolean) => { d.artifactLoading = loading },
      setArtifactError: (d, error: string | null) => { d.artifactError = error },
      /**
       * Land on 运行记录 narrowed to one (题目 × 对比组) — the 结果对比 page's
       * click. The detail is NOT opened here: which record it is depends on
       * how many reps the run holds, and the list is the only place that
       * knows. See {@link LabViewState.recordFocus}.
       */
      focusRecords: (d, focus: { task: string; condition: string } | null) => {
        d.recordFocus = focus
        if (focus === null) return
        d.page = 'runs'
        d.cellSelection = null
        d.cell = null
        d.cellError = null
        d.artifactPath = null
        d.artifact = null
        d.artifactError = null
      },
      setCell: (d, cell: EvalCellDetail) => {
        d.cell = cell
        d.cellError = null
      },
      setCellLoading: (d, loading: boolean) => { d.cellLoading = loading },
      setCellError: (d, error: string | null) => { d.cellError = error },
      setReport: (d, report: EvalRunReportView) => {
        d.report = report
        d.reportError = null
      },
      setReportLoading: (d, loading: boolean) => { d.reportLoading = loading },
      setReportError: (d, error: string | null) => { d.reportError = error },
      setFinalizing: (d, finalizing: boolean) => { d.finalizing = finalizing },
      setFinalizeResult: (d, result: EvalFinalizeView | null) => { d.finalizeResult = result },
      setRunUnits: (d, units: EvalRunUnitsView) => {
        d.runUnits = units
        d.runUnitsError = null
      },
      setRunUnitsError: (d, error: string | null) => { d.runUnitsError = error },
      setLookIn: (d, dir: string) => {
        d.lookIn = dir
        // Whatever is on screen was read from somewhere else: a fresh export,
        // or another directory entirely, is exactly when the report must be
        // re-read rather than kept.
        d.report = null
      },
      setJudge: (d, view: EvalJudgeQueueView) => {
        d.judge = view
        d.judgeError = null
      },
      setJudgeLoading: (d, loading: boolean) => { d.judgeLoading = loading },
      setJudgeError: (d, error: string | null) => { d.judgeError = error },
      openJudgeTask: (d, task: string | null) => {
        d.judgeTask = task
        // A half-written answer belongs to the question it was written
        // against: carrying it to the next item would let a grader submit
        // evidence about work they are no longer looking at.
        d.judgeDraft = {}
        d.judgeSubmitting = false
      },
      setJudgeDraft: (d, ticket: string, criterion: string, value: { pass: boolean; evidence: string }) => {
        d.judgeDraft = { ...d.judgeDraft, [ticket]: { ...(d.judgeDraft[ticket] ?? {}), [criterion]: value } }
      },
      // One answer's verdicts landed; the others on screen are still being
      // written and must survive it.
      clearJudgeDraft: (d, ticket: string) => {
        const next = { ...d.judgeDraft }
        delete next[ticket]
        d.judgeDraft = next
      },
      setJudgeSubmitting: (d, submitting: boolean) => { d.judgeSubmitting = submitting },
      setExportOpen: (d, open: boolean) => { d.exportOpen = open },
      setReexporting: (d, reexporting: boolean) => { d.reexporting = reexporting },
      // One seat, two renderers: whichever kind of news arrives clears the other.
      setNotice: (d, notice: string | null) => { d.notice = notice; d.noticeError = null },
      setNoticeError: (d, message: string | null) => { d.noticeError = message; d.notice = null },
    },
  })
}
