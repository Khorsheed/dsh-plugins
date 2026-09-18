/**
 * Eval plugin, browser half: the experiment list and detail as the 'lab'
 * entry in the conversation's `conversation.view` tab ring (beside chat and
 * trajectory). The eval Remote is mounted here through the official
 * `ctx.remote.$mount` channel, so the plugin distributes as an independent
 * package with no edits to core packages.
 *
 * The tab is labelled 实验室 / Experiments while the plugin id stays `eval`
 * (ui-spec R5 — `lab` in this repository is the container-unit plugin, and
 * the two must not be confused). It self-hides unless the current session's
 * preset composition names the `@khorsheed/dsh-eval-tool` row — the tools it
 * views are granted there, and a viewer over a toolset the session never got
 * is an empty shell. Composing this plugin out of cordis.yml removes the tab.
 *
 * The browser half imports NOTHING from mission or datasets (ui-spec R2 and
 * §八): both projections are computed host-side behind eval's own Remote, so
 * the tab reads one face and the client bundle stays free of sibling packages.
 * That holds for the WRITES too (I5·T35b): re-running a cell, asking the
 * release gate and exporting a bundle are forwarded through eval's Remote to
 * mission's service and its own export gate — the tab never names mission,
 * and it cannot relax a gate it does not implement.
 * @module @khorsheed/dsh-eval/client
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: pulls the ctx.locale service merge.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the ctx.sessions service merge (ISessions).
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
// Type-only: pulls the ctx.slots service merge.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the generated Remote API and ctx.remote merge.
import type {} from '@khorsheed/dsh-eval/remote'
// Type-only: pulls ui-conversation's SlotMap merge ('conversation.view').
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import evalRemote from '@khorsheed/dsh-eval/remote'
import type {
  EvalApproveRequest, EvalCellRequest, EvalCellRetryRequest, EvalCellsRequest, EvalConditionDiffRequest,
  EvalConditionEndpointRequest, EvalConditionProvisionRequest,
  EvalConditionsRequest, EvalDraftOptionsRequest, EvalDraftRequest,
  EvalExperimentRequest, EvalExperimentsRequest, EvalExportPlanRequest,
  EvalExportRunRequest, EvalFinalizeRequest, EvalHumanFinalRequest, EvalJudgeQueueRequest,
  EvalMatrixRequest, EvalPlanRequest, EvalReexportRequest, EvalReportRequest, EvalRunUnitsRequest,
} from '../types.ts'
import type { EvalRemote, LabViewInjected } from './contract.ts'
import { LabView } from './LabView.tsx'
import { en, NS, zh } from './locales.ts'
import { EvalPresetVisibility, RegistrationToggle } from './preset-visibility.ts'
import { createLabViewStore } from './store.ts'

export { LabView }

/**
 * The on-screen session across host lines: 0.1.6-alpha.2 dropped
 * `SessionListState.current` for per-row `retainedBy.mainView` counts (the
 * `mainView` reference source is declared by ui-session, outside this
 * package's type program — hence the duck shape), while 0.1.5 publishes only
 * `current`. One build reads both.
 * @param list - sessions list snapshot.
 * @returns the main-view session id, or undefined when nothing is on screen.
 */
type SessionListCurrent = SessionListState & {
  current?: SessionId
  byId: Record<SessionId, { id: SessionId; retainedBy?: Readonly<Record<string, number>> }>
}
function mainSessionId(list: SessionListState): SessionId | undefined {
  const view = list as SessionListCurrent
  return Object.values(view.byId).find(s => (s.retainedBy?.mainView ?? 0) > 0)?.id ?? view.current
}

/**
 * Minimal navigation face of ui-workspace's `ctx.uiWorkspace`, probed per
 * call rather than injected: 0.1.6-alpha.2 deleted `ISessions.open`, and
 * `uiWorkspace.openSession` is the session-navigation entry on both host
 * lines. A composition without ui-workspace degrades the verb to a no-op.
 */
interface UiWorkspaceNav {
  openSession(id: SessionId): void
}

/** Required services: the slot registry, the remote channel, the copy, and the
 * session list (the preset-composition criterion reads the current session).
 * `remote.dshEval` is deliberately NOT an inject: this plugin both mounts the
 * namespace (through `$mount` below) and consumes it, and the Cordis property
 * proxy only resolves services declared in `inject` or provided by an ancestor
 * fiber — declaring it would deadlock the loader. The mount is awaited and the
 * namespace is then read back from the global store with `ctx.get` (the
 * ui-file-preview precedent, which mission and datasets both follow). */
export const inject = ['slots', 'remote', 'locale', 'sessions']

/**
 * Client plugin body: mount the Remote, register the dictionaries, and
 * inject the lab view tab (registered exactly while the current session's
 * preset composition grants the eval tool row).
 * @param ctx - client root context.
 * @returns the teardown that disposes the Remote mount.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const disposers: Array<() => Promise<void>> = []
  try {
    disposers.push(await ctx.remote.$mount(evalRemote))
  } catch (error) {
    // A Remote already mounted by another composition fails loud at boot; the
    // rest of the plugin still registers (the view surfaces the typed RPC
    // error an unmounted namespace answers).
    /* v8 ignore next -- double-mount is a composition error, not a runtime path */
    ctx.logger.error(error)
  }
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'eval: dictionaries')
  const t = ctx.locale.bind(NS)
  // The namespace is registered by $mount above; read it back from the global
  // store once the mount has settled (a lazy `ctx.remote.dshEval` read would
  // trip the property proxy — the namespace lives in the sibling fiber $mount
  // spawned).
  const remote = ctx.get('remote.dshEval') as EvalRemote

  // The self-hide criterion for the 实验室 tab: the official preset
  // composition data, fail-open on every unreadable path. Hidden means NO
  // registration (the tab strip's buttons enumerate registrations), so the
  // strip never carries an empty-body button.
  const chrome = new EvalPresetVisibility(ctx)
  const labToggle = new RegistrationToggle(
    () => ctx.slots.register({
      name: 'conversation.view',
      id: 'lab',
      order: 40,
      locale: NS,
      label: () => t('open'),
      store: createLabViewStore,
      inject: (_sessionId: SessionId): LabViewInjected => ({
        fetchExperiments: (sid: SessionId, request: EvalExperimentsRequest) => remote.runs(sid, request),
        fetchExperiment: (sid: SessionId, request: EvalExperimentRequest) => remote.run(sid, request),
        fetchPlanReview: (sid: SessionId, request: EvalPlanRequest) => remote.plan(sid, request),
        fetchConditions: (sid: SessionId, request: EvalConditionsRequest) => remote.conditions(sid, request),
        fetchConditionDiff: (sid: SessionId, request: EvalConditionDiffRequest) => remote.conditionDiff(sid, request),
        provisionCondition: (sid: SessionId, request: EvalConditionProvisionRequest) => remote.provisionCondition(sid, request),
        setConditionEndpoint: (sid: SessionId, request: EvalConditionEndpointRequest) => remote.setConditionEndpoint(sid, request),
        // ui-spec step 2. The same service verb `eval_plan_draft` reaches —
        // a draft a person fills in and a draft an agent makes in one
        // sentence are the same file in the same list.
        fetchDraftOptions: (sid: SessionId, request: EvalDraftOptionsRequest) => remote.draftOptions(sid, request),
        draftExperiment: (sid: SessionId, request: EvalDraftRequest) => remote.newExperiment(sid, request),
        approvePlan: (sid: SessionId, request: EvalApproveRequest) => remote.approve(sid, request),
        // The cursor is passed EXPLICITLY even though the verb defaults it:
        // the gateway's client proxy enforces exact positional arity, so a
        // call that leaves an optional parameter off throws
        // "expected 2 argument(s), got 1" before it reaches the wire.
        fetchRunOutput: (jobId: string) => remote.runOutput(jobId, 0),
        fetchMatrix: (sid: SessionId, request: EvalMatrixRequest) => remote.matrix(sid, request),
        fetchCells: (sid: SessionId, request: EvalCellsRequest) => remote.cells(sid, request),
        fetchCell: (sid: SessionId, request: EvalCellRequest) => remote.cell(sid, request),
        retryCell: (sid: SessionId, request: EvalCellRetryRequest) => remote.retry(sid, request),
        releaseCheck: (sid: SessionId, request: EvalCellRequest) => remote.releaseCheck(sid, request),
        planExport: (sid: SessionId, request: EvalExportPlanRequest) => remote.exportPlan(sid, request),
        exportRun: (sid: SessionId, request: EvalExportRunRequest) => remote.exportRun(sid, request),
        // The repeat of a recorded export — the answer to "the final verdicts
        // are not in the bundle" being a command line nobody mentioned.
        reexportRun: (sid: SessionId, request: EvalReexportRequest) => remote.reexport(sid, request),
        fetchReport: (sid: SessionId, request: EvalReportRequest) => remote.report(sid, request),
        finalizeRun: (sid: SessionId, request: EvalFinalizeRequest) => remote.finalize(sid, request),
        fetchRunUnits: (sid: SessionId, request: EvalRunUnitsRequest) => remote.runUnits(sid, request),
        fetchJudgeQueue: (sid: SessionId, request: EvalJudgeQueueRequest) => remote.judgeQueue(sid, request),
        // The one write with no model-facing twin anywhere in this family
        // (ui-spec R1): the final verdict is a person's, and the toolset has
        // no path to the verb on the other side of this line.
        submitHumanFinal: (sid: SessionId, request: EvalHumanFinalRequest) => remote.humanFinal(sid, request),
        // The host's own session controller: the drawer OPENS the player's
        // child session so a person can read the transcript; the member
        // composer and dock there are local-agent's, not this tab's.
        openSession: (childSessionId: SessionId) => {
          try {
            (ctx.get('uiWorkspace') as UiWorkspaceNav | undefined)?.openSession(childSessionId)
          } catch {
            // alpha.2 throws synchronously on an unknown target; the drawer
            // stays put and the entry can be retried.
          }
        },
      }),
    }, LabView),
    () => chrome.show(mainSessionId(ctx.sessions.list.getSnapshot())),
  )
  ctx.slots.inject('conversation.view', () => {
    labToggle.setReady(true)
    return () => { labToggle.setReady(false) }
  })
  ctx.effect(() => chrome.subscribe(() => { labToggle.sync() }), 'eval: lab tab visibility')

  return async () => {
    await Promise.all(disposers.map(dispose => dispose()))
  }
}
