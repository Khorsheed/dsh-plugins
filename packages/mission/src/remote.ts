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
 * confirmation never authorizes a changed layer set.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { ExportLayer, ExportPlan, ExportResult, SnapshotRef } from './export.ts'
import type { MissionService } from './service.ts'
import type {
  MissionDetail, MissionExportPlanRequest, MissionExportPlanView, MissionExportRequest,
  MissionExportResultView, MissionGetRequest, MissionQueueRequest, MissionQueueResult, MissionQueueRun,
  MissionRefRequest, MissionView,
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
  async retry(agent: Agent, request: MissionRefRequest): Promise<{ attempt: number }> {
    return await this.mission.retry(request.missionId, {
      ...(request.runId !== undefined ? { runId: request.runId } : {}),
      by: `tab:${String(agent.session.id)}`,
    })
  }

  /**
   * The release check: may this mission's resources be destroyed?
   * @param agent - owning live agent.
   * @param request - the mission.
   * @returns the releasable verdict.
   */
  @Remote('isReleasable')
  isReleasable(agent: Agent, request: MissionRefRequest): { releasable: boolean } {
    void agent
    return { releasable: this.mission.isReleasable(request.missionId, request.runId) }
  }

  /** Layer visibility through the datasets plugin when mounted (duck-typed; null = unavailable). */
  private async probeNonModelFacing(snapshot: SnapshotRef): Promise<string[] | null> {
    if (snapshot.dataset === undefined) return null
    const datasets = this.ctx.get('datasets') as {
      list?: (scope: { repo: string }, dataset?: string, commit?: string) => Promise<unknown>
    } | undefined
    if (typeof datasets?.list !== 'function') return null
    try {
      const result = await datasets.list(
        { repo: snapshot.repo },
        snapshot.dataset,
        ...(snapshot.commit !== undefined ? [snapshot.commit] : []),
      )
      if (typeof result !== 'object' || result === null) return null
      const layers = (result as { dataset?: { nonModelFacingLayers?: unknown } }).dataset?.nonModelFacingLayers
      if (!Array.isArray(layers)) return null
      return layers.filter((layer): layer is string => typeof layer === 'string')
    } catch {
      return null
    }
  }

  private async resolveLayers(request: MissionExportPlanRequest): Promise<ExportLayer[]> {
    const declared = new Set(request.guarded ?? [])
    const probed = request.snapshot !== undefined ? await this.probeNonModelFacing(request.snapshot) : null
    return (request.layers ?? []).map(name => ({
      name,
      guarded: declared.has(name) || (probed !== null && probed.includes(name)),
    }))
  }

  private toRequest(request: MissionExportPlanRequest, layers: ExportLayer[]) {
    return {
      runId: request.runId,
      outDir: request.outDir,
      layers,
      ...(request.snapshotDir !== undefined ? { snapshotDir: request.snapshotDir } : {}),
      ...(request.snapshot !== undefined ? { snapshot: request.snapshot } : {}),
    }
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
    const layers = await this.resolveLayers(request)
    const plan: ExportPlan = this.mission.planExport(this.toRequest(request, layers))
    return {
      bundleDir: plan.bundleDir,
      guardedLayers: plan.guardedLayers,
      expectedNs: plan.expectedNs,
      missions: plan.missions,
      attempts: plan.attempts,
    }
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
    const layers = await this.resolveLayers(request)
    const plan = this.mission.planExport(this.toRequest(request, layers))
    const unconfirmed = plan.guardedLayers.filter(layer => !request.confirmed.includes(layer))
    if (unconfirmed.length > 0) {
      throw new Error(`mission: export refused — guarded (modelFacing: false) layer(s) not confirmed: ${unconfirmed.join(', ')}`)
    }
    const result: ExportResult = this.mission.exportRun(this.toRequest(request, layers))
    return { bundleDir: result.bundleDir, files: result.files }
  }
}
