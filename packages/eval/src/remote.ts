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
 * The LAB TAB's verbs (`runs`, `run` — I5·T35a; `plan`, `conditions`,
 * `conditionDiff`, `approve` — I5·T36) are the other half of this face and DO
 * take one, for the opposite reason: which experiments and conditions a
 * browser may see follows the calling session's dataset binding, and a
 * session-less read would either see everything or nothing.
 *
 * `approve` is the one WRITE among them, and it is a human's click reaching
 * the same `runStart` the slash command reaches — with the approving session
 * as the run's parent, exactly as `/eval run` resolves it. There is no
 * approve-class MODEL tool and there will not be one (ui-spec R1): the
 * starting verb belongs to the interface, never to the toolset.
 * @module @khorsheed/dsh-eval/remote
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { EvalService } from './service.ts'
import type {
  EvalApproveRequest,
  EvalApproveResult,
  EvalConditionDiffRequest,
  EvalConditionDiffView,
  EvalConditionsRequest,
  EvalConditionsView,
  EvalExperimentDetail,
  EvalExperimentRequest,
  EvalExperimentsRequest,
  EvalExperimentsResult,
  EvalPlanRequest,
  EvalPlanReview,
  EvalRunJobView,
  EvalRunOutputView,
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
}
