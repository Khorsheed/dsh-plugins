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
  EvalApproveRequest, EvalApproveResult, EvalArchiveRunRequest, EvalArchiveWrite, EvalCellArtifactRequest, EvalCellArtifactView, EvalExperimentArtifactRequest, EvalExperimentArtifactView,
  EvalItemMaterialsRequest, EvalItemMaterialsView, EvalDatasetFileRequest, EvalDatasetFileView,
  EvalJudgePromptPreviewRequest, EvalJudgePromptPreviewView, EvalJudgePromptRequest, EvalJudgePromptView,
  EvalCellDetail, EvalCellReleaseResult, EvalCellRequest,
  EvalCellRetryRequest, EvalCellRetryResult, EvalCellsRequest, EvalCloseRunRequest, EvalClosureWrite, EvalCellsResult, EvalConditionDiffRequest,
  EvalConditionDiffView, EvalConditionEndpointRequest, EvalConditionEndpointView,
  EvalConditionProvisionRequest, EvalConditionProvisionView, EvalConditionsRequest, EvalConditionsView,
  EvalDraftOptionsRequest, EvalDraftOptionsView, EvalDraftRequest, EvalDraftResult, EvalExperimentDetail,
  EvalExperimentRequest, EvalExperimentsRequest, EvalExperimentsResult, EvalExportPlanRequest,
  EvalExportPlanView, EvalExportResultView, EvalExportRunRequest, EvalMatrixRequest, EvalMatrixView,
  EvalFinalizeRequest, EvalFinalizeView, EvalHumanFinalRequest, EvalHumanFinalResult,
  EvalJudgeQueueRequest, EvalJudgeQueueView, EvalAnswerSheet, EvalCellAnswersRequest, EvalPlanNumbersRequest, EvalPlanNumbersResult, EvalPlanRequest, EvalPlanReview, EvalReexportRequest,
  EvalReportRequest, EvalRunOutputView, EvalRunReportView, EvalRunUnitsRequest, EvalRunUnitsView,
} from '../types.ts'
import type { LabFocus } from './draft-card.ts'
import type { createLabViewStore } from './store.ts'

/** The eval Remote namespace, mounted by this plugin. */
import type { InspectTarget } from './inspect-target.ts'

export type EvalRemote = TypertRemoteNamespaceMap['dshEval']

/**
 * Business face injected into the conversation.view lab entry: the list, one
 * experiment's overview, the plan review, the condition registry and its diff,
 * the matrix, the cell list and one cell in full.
 *
 * Eight of them WRITE, and every one is a human's click. `setPlanNumbers`
 * is the design page's in-place numbers (T74) — an unstarted plan's reps,
 * budget and judge samples, nothing structural. `draftExperiment` is
 * ui-spec step 2 — the 新建实验 form, and the ONE write this face shares with a
 * model tool (`eval_plan_draft` reaches the same service verb), because
 * drafting starts nothing. `approvePlan` is ui-spec step 5. The drawer's three are `retryCell`, `releaseCheck` and the
 * two-step bundle export. `finalizeRun` is the report page's — the same
 * release gate, walked over every archived cell of the run, and the same call
 * behind its 回收 action. `submitHumanFinal`
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
  /**
   * PROVISION one condition: resolve its scoped home, check the declaration
   * against it, correct `home.sha` in the declaration and write the lock. One
   * action — the condition is ready afterwards, or the answer says why not.
   */
  provisionCondition: (sessionId: SessionId, request: EvalConditionProvisionRequest) => Promise<RemoteResult<EvalConditionProvisionView>>
  /**
   * SET one condition's declared `model.endpoint` — the only field of an
   * existing declaration any face may change, and a factor edit: the condition
   * re-hashes and any lock beside it goes stale.
   */
  setConditionEndpoint: (sessionId: SessionId, request: EvalConditionEndpointRequest) => Promise<RemoteResult<EvalConditionEndpointView>>
  /**
   * SET an unstarted plan's numbers in place (T74): reps, the per-cell budget
   * and the judge's sample count — only those bytes change, and the file is
   * read back before the answer. A started experiment is refused.
   */
  setPlanNumbers: (sessionId: SessionId, request: EvalPlanNumbersRequest) => Promise<RemoteResult<EvalPlanNumbersResult>>
  /**
   * What the 新建实验 form's pickers may offer: the dataset sets this session
   * can draft into, with the items and stage schemas each one holds.
   */
  fetchDraftOptions: (sessionId: SessionId, request: EvalDraftOptionsRequest) => Promise<RemoteResult<EvalDraftOptionsView>>
  /**
   * DRAFT an experiment: write the plan and any new condition into the bound
   * repository's working copy and validate them. A write, not a start — the
   * result carries the plan-review page's own payload, and the button that
   * starts anything is on that page.
   */
  draftExperiment: (sessionId: SessionId, request: EvalDraftRequest) => Promise<RemoteResult<EvalDraftResult>>
  /** Approve a plan and start it (the one write that reaches `runStart`). */
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
  /**
   * ONE of that cell's artifacts, read in place. A read with no download and
   * no write: text comes back capped and says when it was cut, a directory
   * comes back as its entries, and anything else is refused by name.
   */
  fetchCellArtifact: (sessionId: SessionId, request: EvalCellArtifactRequest) => Promise<RemoteResult<EvalCellArtifactView>>
  /**
   * ONE file of ONE experiment (T73), read in place — the report page's
   * 分析初稿 block. The same rules as a cell artifact: inside the experiment
   * directory or nowhere, text only, cut above 256 KB and said so.
   */
  fetchExperimentArtifact: (sessionId: SessionId, request: EvalExperimentArtifactRequest) => Promise<RemoteResult<EvalExperimentArtifactView>>
  /** 题目抽屉 (T84): an item's materials at the pinned commit. Optional — without it 查看 opens the task text alone. */
  fetchItemMaterials?: (sessionId: SessionId, request: EvalItemMaterialsRequest) => Promise<RemoteResult<EvalItemMaterialsView>>
  /** One file of the pinned dataset (T84). */
  fetchDatasetFile?: (sessionId: SessionId, request: EvalDatasetFileRequest) => Promise<RemoteResult<EvalDatasetFileView>>
  /** The judge's prompt before the run (T84). */
  fetchJudgePromptPreview?: (sessionId: SessionId, request: EvalJudgePromptPreviewRequest) => Promise<RemoteResult<EvalJudgePromptPreviewView>>
  /** The prompt.md a cell's judging wrote (T84). */
  fetchJudgePrompt?: (sessionId: SessionId, request: EvalJudgePromptRequest) => Promise<RemoteResult<EvalJudgePromptView>>
  /** Re-run one cell: a fresh attempt against an auditable reason. */
  retryCell: (sessionId: SessionId, request: EvalCellRetryRequest) => Promise<RemoteResult<EvalCellRetryResult>>
  /** The release check: may this cell's resources be destroyed? */
  releaseCheck: (sessionId: SessionId, request: EvalCellRequest) => Promise<RemoteResult<EvalCellReleaseResult>>
  /** The export dialog's plan step: which layers are guarded. */
  planExport: (sessionId: SessionId, request: EvalExportPlanRequest) => Promise<RemoteResult<EvalExportPlanView>>
  /**
   * The export dialog's confirm step; mission re-checks against a fresh plan.
   * ONE action since I5·T60: the bundle AND the report inside it, plus the
   * run-level note that records where the bundle went.
   */
  exportRun: (sessionId: SessionId, request: EvalExportRunRequest) => Promise<RemoteResult<EvalExportResultView>>
  /**
   * EXPORT AGAIN after a final verdict — the report page's and the judge
   * bench's one-click repeat of the export this run already recorded, into a
   * fresh directory beside it. It repeats and never widens: the layers are the
   * recorded ones, nothing guarded is re-confirmed, and mission re-checks that
   * against a fresh plan (I5·T39 · G17).
   */
  reexportRun: (sessionId: SessionId, request: EvalReexportRequest) => Promise<RemoteResult<EvalExportResultView>>
  /**
   * The report page: the four invariants, the paired differences, the
   * efficiency table and the judge numbers, read from the run's exported
   * bundle. A run nobody exported answers with `bundleDir: null` rather than
   * an error — "not exported yet" is a state with a button.
   */
  fetchReport: (sessionId: SessionId, request: EvalReportRequest) => Promise<RemoteResult<EvalRunReportView>>
  /**
   * Walk every archived cell of the run through the release gate, destroying
   * each passing cell's container on the way (a human's click). The report
   * page's finalize button AND its 回收 action are this one call: reclaiming a
   * container IS the cell passing its gate.
   */
  finalizeRun: (sessionId: SessionId, request: EvalFinalizeRequest) => Promise<RemoteResult<EvalFinalizeView>>
  /**
   * The containers lab still holds for this run — lab's own list, not the
   * ledger's belief about which cells hold a resource. A read; it is what the
   * report page's 未回收 count is drawn from.
   */
  fetchRunUnits: (sessionId: SessionId, request: EvalRunUnitsRequest) => Promise<RemoteResult<EvalRunUnitsView>>
  /**
   * The judge bench's BLIND queue: the run's cells as ordinal + ticket, their
   * de-identified material, the rubric's human criteria, and every verdict
   * already on record. No condition, harness or model is in this payload —
   * blindness is a property of what crosses the wire, not of what the page
   * chooses to render.
   */
  fetchJudgeQueue: (sessionId: SessionId, request: EvalJudgeQueueRequest) => Promise<RemoteResult<EvalJudgeQueueView>>
  /**
   * One 题's answers, every group and rep (I5·T75): the stage files by name,
   * every verdict layer, the script output. NOT blind — the scoring page
   * keeps reading {@link fetchJudgeQueue}.
   */
  fetchCellAnswers: (sessionId: SessionId, request: EvalCellAnswersRequest) => Promise<RemoteResult<EvalAnswerSheet>>
  /** Record one cell's human-final verdicts — append-only, tagged by session. */
  submitHumanFinal: (sessionId: SessionId, request: EvalHumanFinalRequest) => Promise<RemoteResult<EvalHumanFinalResult>>
  /**
   * Open one of the run's child sessions — the player's round, or a judge's —
   * in the host's own session controller. READ the transcript; the member
   * composer and dock are local-agent's, and continuing the conversation
   * there is a human's call, never an intervention in the run.
   *
   * The PARENT is not optional decoration. Every session this page offers is
   * a subagent of the run's originSession, and the host refuses a subagent
   * session addressed on its own — «subagent Sessions require their durable
   * parent address» — so handing over the child id alone navigates to a page
   * whose history fails to load (I5·T69, seen on pilot D before this
   * parameter existed). Null falls back to selecting by id, which is all a
   * run recorded without an originSession allows.
   */
  openSession: (sessionId: SessionId, parentSessionId: SessionId | null) => void
  /**
   * 查看 in the host's right sidebar (T86). True when the sidebar took the
   * target; false (or absent — a composition without ui-sidebar-right, a
   * session whose preset hides the lab, a host that threw) and the tab opens
   * the same pane in its own Sheet.
   */
  openInspect?: (sessionId: SessionId, target: InspectTarget) => boolean
  /**
   * CLOSE human review by one of the four exits (T72): 提交终评, 带标记提交,
   * 不做终评直接收尾, 放弃终评. A human's click and nothing else's — the
   * closure is what moves an experiment out of 评估中, and no model-facing
   * tool reaches the verb.
   */
  closeRun: (sessionId: SessionId, request: EvalCloseRunRequest) => Promise<RemoteResult<EvalClosureWrite>>
  /** Archive or restore a run. Grouping only; the status never reads it. */
  archiveRun: (sessionId: SessionId, request: EvalArchiveRunRequest) => Promise<RemoteResult<EvalArchiveWrite>>
  /**
   * PRE-FILL the session's composer with a sentence for the agent — never
   * send it. The host's conversation input is the door (the quote plugin's
   * precedent); false means no composer was reachable, and the caller falls
   * back to the clipboard.
   */
  insertDraft: (sessionId: SessionId, text: string) => boolean
  /**
   * The 打开实验 requests from the eval_plan_draft tool-row card (T76). The
   * view takes its session's pending request on mount and on every new one:
   * back to the list, 全部 when the row is outside this session's scope, and
   * the row marked. Optional so a view mounted without it simply never marks.
   */
  focus?: LabFocus
}

/** Full props of the lab view entry (runtime + store + injected + locale shares). */
export type LabViewProps =
  & PropsRuntime<'conversation.view'>
  & PropsStore<ReturnType<typeof createLabViewStore>>
  & InjectFace<LabViewInjected>
  & PropsLocale<'dshEval'>
