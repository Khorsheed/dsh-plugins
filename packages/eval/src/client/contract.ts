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
  EvalApproveRequest, EvalApproveResult, EvalConditionDiffRequest, EvalConditionDiffView,
  EvalConditionsRequest, EvalConditionsView, EvalExperimentDetail, EvalExperimentRequest,
  EvalExperimentsRequest, EvalExperimentsResult, EvalPlanRequest, EvalPlanReview, EvalRunOutputView,
} from '../types.ts'
import type { createLabViewStore } from './store.ts'

/** The eval Remote namespace, mounted by this plugin. */
export type EvalRemote = TypertRemoteNamespaceMap['dshEval']

/**
 * Business face injected into the conversation.view lab entry: the list, one
 * experiment's overview, the plan review, the condition registry and its
 * diff — and exactly ONE write, `approvePlan`, which is the human act of
 * ui-spec step 5. The remaining human actions (retry, release check, export,
 * the final score) arrive with the sub-pages that own them — T35b, T37, T38.
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
}

/** Full props of the lab view entry (runtime + store + injected + locale shares). */
export type LabViewProps =
  & PropsRuntime<'conversation.view'>
  & PropsStore<ReturnType<typeof createLabViewStore>>
  & InjectFace<LabViewInjected>
  & PropsLocale<'dshEval'>
