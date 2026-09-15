/** Composed props contract for the lab session tab. */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  InjectFace, PropsLocale, PropsRuntime, PropsStore,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult, TypertRemoteNamespaceMap } from '@deepseek-ai/dsh-typert-protocol'
// Type-only: pulls the generated Remote API (ctx.remote merge + the dshEval namespace).
import type {} from '@khorsheed/dsh-eval/remote'
// Type-only: pulls ui-conversation's SlotMap merge ('conversation.view').
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  EvalApproveRequest, EvalApproveResult, EvalCellDetail, EvalCellReleaseResult, EvalCellRequest,
  EvalCellRetryRequest, EvalCellRetryResult, EvalCellsRequest, EvalCellsResult, EvalConditionDiffRequest,
  EvalConditionDiffView, EvalConditionsRequest, EvalConditionsView, EvalExperimentDetail,
  EvalExperimentRequest, EvalExperimentsRequest, EvalExperimentsResult, EvalExportPlanRequest,
  EvalExportPlanView, EvalExportResultView, EvalExportRunRequest, EvalMatrixRequest, EvalMatrixView,
  EvalFinalizeRequest, EvalFinalizeView, EvalHumanFinalRequest, EvalHumanFinalResult,
  EvalJudgeQueueRequest, EvalJudgeQueueView, EvalPlanRequest, EvalPlanReview, EvalReportRequest,
  EvalRunOutputView, EvalRunReportView,
} from '../types.ts'
import type { createLabViewStore } from './store.ts'

/** The eval Remote namespace, mounted by this plugin. */
export type EvalRemote = TypertRemoteNamespaceMap['dshEval']

/**
 * Business face injected into the conversation.view lab entry: the list, one
 * experiment's overview, the plan review, the condition registry and its diff,
 * the matrix, the cell list and one cell in full.
 *
 * Six of them WRITE, and every one is a human's click. `approvePlan` is
 * ui-spec step 5. The drawer's three are `retryCell`, `releaseCheck` and the
 * two-step bundle export. `finalizeRun` is the report page's — the same
 * release gate, walked over every archived cell of the run. `submitHumanFinal`
 * is the judge bench's, and the ONLY door the `human-final` namespace has:
 * ui-spec R1 says 终评是人的, and it holds because no model-facing tool in this
 * family reaches the verb behind this field.
 */
export interface LabViewInjected {
  /** Every experiment: the runs eval started, plus the unstarted plans (one RPC). */
  fetchExperiments: (sessionId: SessionId, request: EvalExperimentsRequest) => Promise<RemoteResult<EvalExperimentsResult>>
  /** One started experiment's overview payload. */
  fetchExperiment: (sessionId: SessionId, request: EvalExperimentRequest) => Promise<RemoteResult<EvalExperimentDetail>>
  /** One plan's review payload: its own fields, and validate line by line. */
  fetchPlanReview: (sessionId: SessionId, request: EvalPlanRequest) => Promise<RemoteResult<EvalPlanReview>>
  /** The condition registry of the session's dataset repository. */
  fetchConditions: (sessionId: SessionId, request: EvalConditionsRequest) => Promise<RemoteResult<EvalConditionsView>>
  /** Two conditions, field by field — only what differs. */
  fetchConditionDiff: (sessionId: SessionId, request: EvalConditionDiffRequest) => Promise<RemoteResult<EvalConditionDiffView>>
  /** Approve a plan and start it (the ONE write this face carries). */
  approvePlan: (sessionId: SessionId, request: EvalApproveRequest) => Promise<RemoteResult<EvalApproveResult>>
  /**
   * A started run's job log from the top, verbatim. Session-less on purpose:
   * this is the CI face's own `runOutput`, and a readiness refusal is written
   * there and NOWHERE else — the run never reaches `runCreate`, so the mission
   * ledger holds nothing at all for it.
   */
  fetchRunOutput: (jobId: string) => Promise<RemoteResult<EvalRunOutputView>>
  /** The matrix page: rows are tasks, one factor on the columns. */
  fetchMatrix: (sessionId: SessionId, request: EvalMatrixRequest) => Promise<RemoteResult<EvalMatrixView>>
  /** The cells page: one run's cells, exact-match filtered. */
  fetchCells: (sessionId: SessionId, request: EvalCellsRequest) => Promise<RemoteResult<EvalCellsResult>>
  /** One cell in full — the drawer. */
  fetchCell: (sessionId: SessionId, request: EvalCellRequest) => Promise<RemoteResult<EvalCellDetail>>
  /** Re-run one cell: a fresh attempt against an auditable reason. */
  retryCell: (sessionId: SessionId, request: EvalCellRetryRequest) => Promise<RemoteResult<EvalCellRetryResult>>
  /** The release check: may this cell's resources be destroyed? */
  releaseCheck: (sessionId: SessionId, request: EvalCellRequest) => Promise<RemoteResult<EvalCellReleaseResult>>
  /** The export dialog's plan step: which layers are guarded. */
  planExport: (sessionId: SessionId, request: EvalExportPlanRequest) => Promise<RemoteResult<EvalExportPlanView>>
  /** The export dialog's confirm step; mission re-checks against a fresh plan. */
  exportRun: (sessionId: SessionId, request: EvalExportRunRequest) => Promise<RemoteResult<EvalExportResultView>>
  /**
   * The report page: the four invariants, the paired differences, the
   * efficiency table and the judge numbers, read from the run's exported
   * bundle. A run nobody exported answers with `bundleDir: null` rather than
   * an error — "not exported yet" is a state with a button.
   */
  fetchReport: (sessionId: SessionId, request: EvalReportRequest) => Promise<RemoteResult<EvalRunReportView>>
  /** Walk every archived cell of the run through the release gate (a human's click). */
  finalizeRun: (sessionId: SessionId, request: EvalFinalizeRequest) => Promise<RemoteResult<EvalFinalizeView>>
  /**
   * The judge bench's BLIND queue: the run's cells as ordinal + ticket, their
   * de-identified material, the rubric's human criteria, and every verdict
   * already on record. No condition, harness or model is in this payload —
   * blindness is a property of what crosses the wire, not of what the page
   * chooses to render.
   */
  fetchJudgeQueue: (sessionId: SessionId, request: EvalJudgeQueueRequest) => Promise<RemoteResult<EvalJudgeQueueView>>
  /** Record one cell's human-final verdicts — append-only, tagged by session. */
  submitHumanFinal: (sessionId: SessionId, request: EvalHumanFinalRequest) => Promise<RemoteResult<EvalHumanFinalResult>>
  /**
   * Open the delegation's child session in the host's own session controller.
   * READ the player's transcript — the member composer and dock are
   * local-agent's, and continuing the conversation there is a human's call,
   * never an intervention in the run.
   */
  openSession: (sessionId: SessionId) => void
}

/** Full props of the lab view entry (runtime + store + injected + locale shares). */
export type LabViewProps =
  & PropsRuntime<'conversation.view'>
  & PropsStore<ReturnType<typeof createLabViewStore>>
  & InjectFace<LabViewInjected>
  & PropsLocale<'dshEval'>
