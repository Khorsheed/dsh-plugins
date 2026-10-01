/**
 * The mission Remote service: the web session tab's data face. A thin
 * adapter over the same `ctx.mission` service core the tools, the CLI, and
 * the slash command use — no logic is copied here. Every method takes the
 * calling `agent` as its first parameter; the queue defaults to runs whose
 * `originSession` is the caller's session (the tab's 本会话/全部 toggle
 * widens with `all`). The cordis service key is `missionRemote` (`mission`
 * is the core service); the WIRE namespace is `mission`, so the browser
 * calls `remote.mission.*`.
 *
 * Every optional selector rides in a request object — the gateway's client
 * proxy enforces exact positional arity, so optional fields belong inside an
 * object, never in the positional tail.
 *
 * The export pair splits the leak gate the way the core intends: `exportPlan`
 * computes the trigger list (guarded layers resolved through the datasets
 * probe when mounted, else the caller's declarations), `exportRun` re-checks
 * the caller's `confirmed` list against a FRESH plan — a dialog-stale
 * confirmation never authorizes a changed layer set. Both delegate to the
 * service's gated verbs (`exportPlanGated` / `exportRunGated`, the gate itself
 * in `gate.ts`), so an in-host plugin gets the same gate through `ctx.mission`
 * without an agent.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { MissionService } from './service.ts'
import type {
  MissionAttemptDataDirRequest, MissionDetail, MissionExportPlanRequest, MissionExportPlanView, MissionExportRequest,
  MissionExportResultView, MissionGetRequest, MissionQueueRequest, MissionQueueResult, MissionQueueRun,
  MissionRefRequest, MissionRetryRequest, MissionRunAnnotationsRequest, MissionRunAnnotationWire, MissionView,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    missionRemote: MissionRemoteService
  }
}

/** The mission tab's Remote service (wire namespace `mission`). */
export class MissionRemoteService extends TypertRemoteService<never> {
  static inject = ['mission']

  constructor(ctx: Context) {
    super(ctx, 'missionRemote', { namespace: 'mission' })
  }

  private get mission(): MissionService {
    return this.ctx.mission
  }

  /**
   * The tab's queue: runs (default: originated by the caller's session) with
   * their projected rows, bucket-filtered.
   * @param agent - owning live agent; its session scopes the default filter.
   * @param request - bucket chips, run selector, all-runs toggle.
   * @returns run sections in run order.
   */
  @Remote('queue')
  queue(agent: Agent, request: MissionQueueRequest): MissionQueueResult {
    const sessionId = String(agent.session.id)
    const now = Date.now()
    let runs = this.mission.runList()
    if (request.runId !== undefined) {
      runs = runs.filter(r => r.id === request.runId)
    } else if (request.all !== true) {
      runs = runs.filter(r => r.originSession === sessionId)
    }
    const sections: MissionQueueRun[] = []
    for (const run of runs) {
      const rows = this.mission.list({ runId: run.id }, { now })
        .filter(row => request.buckets === undefined || request.buckets.includes(row.bucket))
      sections.push({ run, rows })
    }
    return { sessionId, runs: sections }
  }

  /**
   * One mission's detail (view row + attempts + annotations).
   * @param agent - owning live agent.
   * @param request - the mission (and run, when the id is ambiguous).
   * @returns the detail payload.
   */
  @Remote('get')
  get(agent: Agent, request: MissionGetRequest): MissionDetail {
    void agent
    const { run, mission } = this.mission.get(request.missionId, request.runId)
    const view = this.mission.list({ runId: run.id }).find(v => v.id === mission.id)
    const detail: MissionDetail = {
      runId: run.id,
      view: view as MissionView,
      attempts: mission.attempts as MissionDetail['attempts'],
      annotations: mission.annotations as MissionDetail['annotations'],
    }
    if (mission.title !== undefined) detail.title = mission.title
    return detail
  }

  /**
   * Re-run: open a new attempt (a human gesture from the tab).
   * @param agent - owning live agent; recorded as `tab:<sessionId>`.
   * @param request - the mission.
   * @returns the new attempt number.
   */
  @Remote('retry')
  async retry(agent: Agent, request: MissionRetryRequest): Promise<{ attempt: number }> {
    return await this.mission.retry(request.missionId, {
      reason: request.reason,
      category: request.category,
      ...(request.runId !== undefined ? { runId: request.runId } : {}),
      by: `tab:${String(agent.session.id)}`,
    })
  }

  /**
   * The release check: may this mission's resources be destroyed?
   * @param agent - owning live agent.
   * @param request - the mission.
   * @returns the releasable result.
   */
  @Remote('isReleasable')
  isReleasable(agent: Agent, request: MissionRefRequest): { releasable: boolean } {
    void agent
    return { releasable: this.mission.isReleasable(request.missionId, request.runId) }
  }

  /**
   * Plan an export for the dialog: the guarded layers (datasets-probed when
   * mounted) the human must confirm, the expected namespaces, the target path.
   * @param agent - owning live agent.
   * @param request - run, output directory, layers, snapshot reference.
   * @returns the plan view.
   */
  @Remote('exportPlan')
  async exportPlan(agent: Agent, request: MissionExportPlanRequest): Promise<MissionExportPlanView> {
    void agent
    return await this.mission.exportPlanGated(request)
  }

  /**
   * Export the run bundle. THE GATE: the caller's `confirmed` list is checked
   * against a FRESH plan — every guarded layer must be confirmed, or the
   * export refuses (fail-closed). The tab's dialog lists the guarded layers
   * and sends the checked ones.
   * @param agent - owning live agent.
   * @param request - the export plus the confirmed guarded layers.
   * @returns the bundle location and file count.
   */
  @Remote('exportRun')
  async exportRun(agent: Agent, request: MissionExportRequest): Promise<MissionExportResultView> {
    void agent
    return await this.mission.exportRunGated(request)
  }

  /**
   * One attempt's run-data directory — the layout stays mission's.
   * @param agent - owning live agent.
   * @param request - run, mission, attempt.
   * @returns the absolute directory (may not exist yet).
   */
  @Remote('attemptDataDir')
  attemptDataDir(agent: Agent, request: MissionAttemptDataDirRequest): { dir: string } {
    void agent
    return { dir: this.mission.attemptDataDir(request.runId, request.missionId, request.attempt) }
  }

  /**
   * A run's own (run-level) annotations, optionally one namespace.
   * @param agent - owning live agent.
   * @param request - the run and an optional namespace.
   * @returns the records in write order.
   */
  @Remote('runAnnotations')
  runAnnotations(agent: Agent, request: MissionRunAnnotationsRequest): { annotations: MissionRunAnnotationWire[] } {
    void agent
    return { annotations: this.mission.runAnnotations(request.runId, request.ns) as MissionRunAnnotationWire[] }
  }
}
