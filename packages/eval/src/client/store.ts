/**
 * The lab tab's transient store: the experiment list, which row is open, which
 * of the detail's seven sub-pages is showing, and each built sub-page's own
 * payload. Module level exports the factory only — a module-level handle would
 * pin the store's identity in the module cache (a de-facto singleton surviving
 * plugin reloads).
 */
import { defineStore } from '@deepseek-ai/dsh-client-store'
import type { EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type {
  EvalConditionDiffView, EvalConditionsView, EvalExperimentDetail, EvalExperimentsResult,
  EvalPlanReview, EvalRunOutputView,
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
 * The detail's sub-pages, in the tab order ui-spec §五 fixes. Only `overview`
 * has a body in this slice; the rest carry the placeholder naming their task.
 */
export const LAB_PAGES = ['overview', 'plan', 'conditions', 'matrix', 'cells', 'report', 'judging'] as const

/** One sub-page of an experiment's detail. */
export type LabPage = typeof LAB_PAGES[number]

/** The view's state; fetched results are whole values, null until loaded. */
export interface LabViewState {
  /** The list payload, or null before the first load. */
  list: EvalExperimentsResult | null
  /** Whether a list fetch is in flight. */
  loading: boolean
  /** Human-readable list-fetch failure, or null when idle. */
  error: string | null
  /** Bumped by the refresh action to re-trigger the list fetch. */
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
  /** What the approval started; null until one succeeds in this visit. */
  started: LabStartedRun | null
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
  /** The one or two conditions picked for the diff, in pick order. */
  diffPair: string[]
  /** The diff of the picked pair, or null until both are picked. */
  diff: EvalConditionDiffView | null
  /** Human-readable diff failure, or null. */
  diffError: string | null
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
  setStarted: (draft: LabViewState, started: LabStartedRun) => void
  setOutput: (draft: LabViewState, output: EvalRunOutputView) => void
  setOutputError: (draft: LabViewState, error: string | null) => void
  setConditions: (draft: LabViewState, conditions: EvalConditionsView) => void
  setConditionsLoading: (draft: LabViewState, loading: boolean) => void
  setConditionsError: (draft: LabViewState, error: string | null) => void
  pickCondition: (draft: LabViewState, id: string) => void
  setDiff: (draft: LabViewState, diff: EvalConditionDiffView) => void
  setDiffError: (draft: LabViewState, error: string | null) => void
}

const INITIAL: LabViewState = {
  list: null,
  loading: false,
  error: null,
  refreshRev: 0,
  selection: null,
  page: 'overview',
  detail: null,
  detailLoading: false,
  detailError: null,
  review: null,
  reviewLoading: false,
  reviewError: null,
  sentBack: false,
  approving: false,
  approveRefusal: null,
  started: null,
  output: null,
  outputError: null,
  conditions: null,
  conditionsLoading: false,
  conditionsError: null,
  diffPair: [],
  diff: null,
  diffError: null,
}

/** What `open` clears: everything that belongs to the experiment being left. */
const PER_EXPERIMENT: Pick<
  LabViewState,
  'detail' | 'detailError' | 'review' | 'reviewError' | 'sentBack' | 'approving' | 'approveRefusal' | 'started' | 'output' | 'outputError'
> = {
  detail: null,
  detailError: null,
  review: null,
  reviewError: null,
  sentBack: false,
  approving: false,
  approveRefusal: null,
  started: null,
  output: null,
  outputError: null,
}

/**
 * Create the lab view store handle.
 * @returns the store handle (spec + type + identity + factory in one).
 */
export function createLabViewStore(): EngineStoreHandle<LabViewState, LabViewActions> {
  return defineStore({
    init: (): LabViewState => ({ ...INITIAL }),
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
        // Opening an experiment always lands on the overview: the sub-page is
        // a property of the visit, not of the experiment.
        d.page = 'overview'
        Object.assign(d, PER_EXPERIMENT)
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
      setApproveRefusal: (d, refusal: string | null) => { d.approveRefusal = refusal },
      setStarted: (d, started: LabStartedRun) => {
        d.started = started
        d.approveRefusal = null
        // An approved plan is no longer sent back, whatever the reviewer
        // pressed earlier in this visit.
        d.sentBack = false
      },
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
    },
  })
}
