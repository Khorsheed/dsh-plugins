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
  EvalCellDetail, EvalCellReleaseResult, EvalCellRequest, EvalCellRetryRequest, EvalCellRetryResult,
  EvalCellsRequest, EvalCellsResult, EvalExperimentDetail, EvalExperimentRequest, EvalExperimentsRequest,
  EvalExperimentsResult, EvalExportPlanRequest, EvalExportPlanView, EvalExportResultView,
  EvalExportRunRequest, EvalMatrixRequest, EvalMatrixView,
} from '../types.ts'
import type { createLabViewStore } from './store.ts'

/** The eval Remote namespace, mounted by this plugin. */
export type EvalRemote = TypertRemoteNamespaceMap['dshEval']

/**
 * Business face injected into the conversation.view lab entry.
 *
 * Five reads and three writes. The writes are the drawer's human gestures and
 * nothing more: re-open an attempt with a reason, ask the release gate, and
 * walk the two-step bundle export. Starting a run and approving a plan are
 * elsewhere by design; the remaining sub-pages (report, judging desk) arrive
 * with T38 and T37.
 */
export interface LabViewInjected {
  /** Every experiment: the runs eval started, plus the unstarted plans (one RPC). */
  fetchExperiments: (sessionId: SessionId, request: EvalExperimentsRequest) => Promise<RemoteResult<EvalExperimentsResult>>
  /** One started experiment's overview payload. */
  fetchExperiment: (sessionId: SessionId, request: EvalExperimentRequest) => Promise<RemoteResult<EvalExperimentDetail>>
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
