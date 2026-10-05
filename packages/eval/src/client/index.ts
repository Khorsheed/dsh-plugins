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
 * preset composition names the `@khorsheed/dsh-eval/tool` row — the tools it
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
import type { RemoteFailure } from '@deepseek-ai/dsh-typert-protocol'
import type {
  EvalApproveRequest, EvalArchiveRunRequest, EvalCellArtifactRequest, EvalCloseRunRequest, EvalCellRequest, EvalCellRetryRequest, EvalCellsRequest, EvalConditionDiffRequest,
  EvalConditionEndpointRequest, EvalConditionProvisionRequest,
  EvalConditionsRequest, EvalDraftOptionsRequest,
  EvalExperimentArtifactRequest, EvalItemMaterialsRequest, EvalDatasetFileRequest, EvalJudgePromptPreviewRequest, EvalJudgePromptRequest,
  EvalExperimentRequest, EvalExperimentsRequest, EvalExportPlanRequest,
  EvalExportRunRequest, EvalFinalizeRequest, EvalHumanFinalRequest, EvalJudgeQueueRequest, EvalCellAnswersRequest,
  EvalMatrixRequest, EvalPlanNumbersRequest, EvalPlanRequest, EvalReexportRequest, EvalReportRequest, EvalRunUnitsRequest,
} from '../types.ts'
import type { EvalRemote, LabViewInjected } from './contract.ts'
import { DraftCard, type DraftCardFace } from './DraftCard.tsx'
import { createLabFocus } from './draft-card.ts'
import { inspectReadsOf } from './InspectPane.tsx'
import { INSPECT_KIND, INSPECT_TAB_ID, type InspectTarget } from './inspect-target.ts'
import { LabView } from './LabView.tsx'
import { LabPanel, LabPanelIcon, PANEL_ID, PANEL_SESSION } from './global-panel.tsx'
import { createEvalSessionDoors } from './new-session.ts'
import { en, NS, zh } from './locales.ts'
import { EvalPresetVisibility, RegistrationToggle } from './preset-visibility.ts'
import { createLabViewStore } from './store.ts'
import { createInspectTitles, SidebarInspect, SidebarInspectTitle } from './SidebarInspect.tsx'

export { LabView }

/**
 * A failure answered in the browser, shaped like the Remote's own error
 * branch. The client bundle may not import typert's `RemoteError` class (the
 * bundle-purity gate), and the error is discriminated by `code`, never by
 * instanceof — so the structural copy is the same value to every reader.
 * @param message - what the view shows.
 * @returns the failure.
 */
function localFailure(message: string): RemoteFailure {
  return Object.assign(new Error(message), { code: 'gateway/internal', details: {}, isDSHRemoteError: true }) as unknown as RemoteFailure
}

/**
 * A tag-writing request with the clicking tab's session attached; the global
 * panel attaches none, and the service records `panel:lab` (T97).
 * @param sid - the view's session, or the panel's empty sentinel.
 * @param request - the verb's request.
 * @returns the request, tagged.
 */
function withCaller<R extends object>(sid: SessionId, request: R): R & { session?: string } {
  return sid === PANEL_SESSION ? request : { ...request, session: sid }
}

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
 * file-preview precedent, which mission and datasets both follow). */
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
  // The 打开实验 channel between the tool-row card and the lab tab (T76): the
  // host offers no tab switch, so the card asks and the lab view takes.
  const focus = createLabFocus()
  const chrome = new EvalPresetVisibility(ctx)

  // 查看 (T86): opened in the host's right sidebar while this package's tab
  // type is registered there, otherwise answered false so the lab draws its
  // own Sheet. Filled in by the deferred sidebar inject below.
  const inspectHost: { open: ((target: InspectTarget) => boolean) | null } = { open: null }

  // One face for the lab tab and the sidebar pane: the same reads, the same
  // opener. The object is built once; the slot hands the same one to every session.
  const injected: LabViewInjected = {
    fetchExperiments: (sid: SessionId, request: EvalExperimentsRequest) => remote.runs(sid === PANEL_SESSION ? request : { ...request, session: sid }),
    fetchExperiment: (_sid: SessionId, request: EvalExperimentRequest) => remote.run(request),
    fetchPlanReview: (_sid: SessionId, request: EvalPlanRequest) => remote.plan(request),
    fetchConditions: (_sid: SessionId, request: EvalConditionsRequest) => remote.conditions(request),
    fetchConditionDiff: (_sid: SessionId, request: EvalConditionDiffRequest) => remote.conditionDiff(request),
    provisionCondition: (_sid: SessionId, request: EvalConditionProvisionRequest) => remote.provisionCondition(request),
    setConditionEndpoint: (_sid: SessionId, request: EvalConditionEndpointRequest) => remote.setConditionEndpoint(request),
    setPlanNumbers: (_sid: SessionId, request: EvalPlanNumbersRequest) => remote.setPlanNumbers(request),
    // ui-spec step 2. The same service verb `eval_plan_draft` reaches —
    // a draft a person fills in and a draft an agent makes in one
    // sentence are the same file in the same list.
    fetchDraftOptions: (_sid: SessionId, request: EvalDraftOptionsRequest) => remote.draftOptions(request),
    // The one verb that still takes a session: the approving session is the
    // run's parent and its workspace the run's cwd. The global panel has
    // none, so it opens a new evaluation-mode session (without leaving the
    // panel) and approves under that (T97).
    approvePlan: async (sid: SessionId, request: EvalApproveRequest) => {
      if (sid !== PANEL_SESSION) return remote.approve(sid, request)
      const made = await doors.create(t('panel.runSessionTitle', { name: request.experimentId }))
      if (!made.ok) return { ok: false as const, error: localFailure(t('panel.noSession', { message: made.message })) }
      return remote.approve(made.sessionId, request)
    },
    // The cursor is passed EXPLICITLY even though the verb defaults it:
    // the gateway's client proxy enforces exact positional arity, so a
    // call that leaves an optional parameter off throws
    // "expected 2 argument(s), got 1" before it reaches the wire.
    fetchRunOutput: (jobId: string) => remote.runOutput(jobId, 0),
    fetchMatrix: (_sid: SessionId, request: EvalMatrixRequest) => remote.matrix(request),
    fetchCells: (_sid: SessionId, request: EvalCellsRequest) => remote.cells(request),
    fetchCell: (_sid: SessionId, request: EvalCellRequest) => remote.cell(request),
    // The attachment a reader clicks: the bytes were always reachable
    // (the judge bench reads the same directory), only the door was missing.
    fetchCellArtifact: (_sid: SessionId, request: EvalCellArtifactRequest) => remote.cellArtifact(request),
    // The analysis drafts an agent wrote into the experiment (T73).
    fetchExperimentArtifact: (_sid: SessionId, request: EvalExperimentArtifactRequest) => remote.experimentArtifact(request),
    // T84: the design page's item drawer and the judge's prompt.
    fetchItemMaterials: (_sid: SessionId, request: EvalItemMaterialsRequest) => remote.itemMaterials(request),
    fetchDatasetFile: (_sid: SessionId, request: EvalDatasetFileRequest) => remote.datasetFile(request),
    fetchJudgePromptPreview: (_sid: SessionId, request: EvalJudgePromptPreviewRequest) => remote.judgePromptPreview(request),
    fetchJudgePrompt: (_sid: SessionId, request: EvalJudgePromptRequest) => remote.judgePrompt(request),
    retryCell: (sid: SessionId, request: EvalCellRetryRequest) => remote.retry(withCaller(sid, request)),
    releaseCheck: (_sid: SessionId, request: EvalCellRequest) => remote.releaseCheck(request),
    planExport: (_sid: SessionId, request: EvalExportPlanRequest) => remote.exportPlan(request),
    exportRun: (sid: SessionId, request: EvalExportRunRequest) => remote.exportRun(withCaller(sid, request)),
    // The repeat of a recorded export — the answer to "the final verdicts
    // are not in the bundle" being a command line nobody mentioned.
    reexportRun: (sid: SessionId, request: EvalReexportRequest) => remote.reexport(withCaller(sid, request)),
    fetchReport: (_sid: SessionId, request: EvalReportRequest) => remote.report(request),
    finalizeRun: (sid: SessionId, request: EvalFinalizeRequest) => remote.finalize(withCaller(sid, request)),
    fetchRunUnits: (_sid: SessionId, request: EvalRunUnitsRequest) => remote.runUnits(request),
    fetchJudgeQueue: (_sid: SessionId, request: EvalJudgeQueueRequest) => remote.judgeQueue(request),
    fetchCellAnswers: (_sid: SessionId, request: EvalCellAnswersRequest) => remote.cellAnswers(request),
    // The one write with no model-facing twin anywhere in this family
    // (ui-spec R1): the final verdict is a person's, and the toolset has
    // no path to the verb on the other side of this line.
    submitHumanFinal: (sid: SessionId, request: EvalHumanFinalRequest) => remote.humanFinal(withCaller(sid, request)),
    // The host's own session controller: the drawer OPENS the player's (or
    // a judge's) child session so a person can read the transcript; the
    // member composer and dock there are local-agent's, not this tab's.
    //
    // Through the SUBAGENT address, because that is the only address the
    // host will read one at. `openSession(childId)` selects the row and
    // then fails to load its history — «subagent Sessions require their
    // durable parent address (session/agent-busy)» — which is what pilot D
    // did on every one of these buttons until this call learned the
    // parent. The parent's catalog is refreshed first (a run finished days
    // ago is not in any catalog this browser has loaded), and every way
    // that can fail — no parent recorded, a refresh that throws, a child
    // the catalog does not call healthy — falls back to selecting by id,
    // which is strictly what this code did before.
    //
    // One call, two host lines: 0.1.5 reads the address through
    // `ISessions.openSubagent`; 0.1.6-alpha.2 removed that method and
    // widened `uiWorkspace.openSession`'s target to take the address
    // (0.1.7-rc.1 renames the catalog refresh `refreshProjections`).
    // Every opener is wrapped: alpha.2 throws synchronously on an unknown
    // target, and the drawer stays put so the entry can be retried.
    openSession: (childSessionId: SessionId, parentSessionId: SessionId | null) => {
      const sessions = ctx.sessions as unknown as {
        subagentAddress?(id: SessionId): unknown
        openSubagent?(target: unknown): void
        refreshSubagents?(id: SessionId): Promise<void>
        refreshProjections?(id: SessionId): Promise<void>
        open?(id: SessionId): void
      }
      const nav = ctx.get('uiWorkspace') as UiWorkspaceNav | undefined
      const openTarget = (target: unknown): void => {
        try {
          if (sessions.openSubagent !== undefined) sessions.openSubagent(target)
          else nav?.openSession(target as SessionId)
        } catch { /* unknown target: the drawer stays put, the entry can be retried */ }
      }
      const byId = (): void => {
        try {
          if (nav !== undefined) nav.openSession(childSessionId)
          else sessions.open?.(childSessionId)
        } catch { /* same degrade */ }
      }
      const retained = sessions.subagentAddress?.(childSessionId)
      if (retained !== undefined) {
        openTarget(retained)
        return
      }
      if (parentSessionId === null) {
        byId()
        return
      }
      const refresh = sessions.refreshSubagents?.bind(sessions) ?? sessions.refreshProjections?.bind(sessions)
      if (refresh === undefined) {
        // One-shot: an evaluation delegation is `{ mode: 'one-shot' }` on
        // its own descriptor, which is the mode the catalog entry has to
        // match for the host to accept the address.
        openTarget({ parentSessionId, childSessionId, mode: 'one-shot' })
        return
      }
      void refresh(parentSessionId).then(() => {
        openTarget({ parentSessionId, childSessionId, mode: 'one-shot' })
      }).catch(byId)
    },
    // T72's four exits and the archive flag: run-level annotations a
    // person writes, through eval's own verbs.
    closeRun: (sid: SessionId, request: EvalCloseRunRequest) => remote.closeRun(withCaller(sid, request)),
    archiveRun: (sid: SessionId, request: EvalArchiveRunRequest) => remote.archiveRun(withCaller(sid, request)),
    // 「让 agent 处理」: the quote plugin's backfill path — the session's
    // conversation input, draft merged, NEVER sent. Every absence answers
    // false so the button can fall back to the clipboard.
    focus,
    insertDraft: (sid: SessionId, text: string): boolean => {
      const scope = ctx.sessions.scope(sid)
      if (scope === undefined) return false
      const input = scope.get('conversation')?.input.for(scope)
      if (input === undefined) return false
      const current = input.state.getSnapshot().draft
      input.setDraft(current.trim() === '' ? text : `${current}\n\n${text}`)
      return true
    },
    // Best effort, structurally: 0.1.7's input shell has `focus()` (the caret
    // it last held); 0.1.5's exposes only its Lexical `editor`. Neither is on
    // the frozen SessionInput face, so each is probed and an absence is quiet.
    focusComposer: (sid: SessionId): void => {
      const scope = ctx.sessions.scope(sid)
      if (scope === undefined) return
      const input = scope.get('conversation')?.input.for(scope) as unknown as {
        focus?: () => void
        editor?: { focus?: () => void; getRootElement?: () => HTMLElement | null }
      } | undefined
      try {
        if (typeof input?.focus === 'function') {
          input.focus()
          return
        }
        input?.editor?.getRootElement?.()?.focus({ preventScroll: true })
        input?.editor?.focus?.()
      } catch {
        // A composer that cannot take focus leaves the text in place; the
        // notice already says where it went.
      }
    },
    openInspect: (_sid: SessionId, target: InspectTarget) => inspectHost.open?.(target) ?? false,
    // The global panel's two hand-offs (T97): a new evaluation-mode session
    // with the text in its chat box, never sent.
    startSession: (title: string, text: string) => doors.startWith(title, text),
  }
  const doors = createEvalSessionDoors(ctx, {
    grants: presetId => chrome.grants(presetId),
    insertDraft: (sid, text) => injected.insertDraft(sid, text),
    focusComposer: sid => { injected.focusComposer?.(sid) },
  })

  const labToggle = new RegistrationToggle(
    () => ctx.slots.register({
      name: 'conversation.view',
      id: 'lab',
      order: 40,
      locale: NS,
      label: () => t('open'),
      store: createLabViewStore,
      inject: (_sessionId: SessionId): LabViewInjected => injected,
    }, LabView),
    () => chrome.show(mainSessionId(ctx.sessions.list.getSnapshot())),
  )
  ctx.slots.inject('conversation.view', () => {
    labToggle.setReady(true)
    return () => { labToggle.setReady(false) }
  })
  ctx.effect(() => chrome.subscribe(() => { labToggle.sync() }), 'eval: lab tab visibility')

  // The experiment card on the eval_plan_draft tool row (T76 · D3). The slot
  // is declared by @deepseek-ai/dsh-client-ui-tool, which this package does
  // not depend on — its SlotMap entry is not in this type graph, so the one
  // registration goes through a structural view of the registry. Without that
  // package the slot is never declared, the inject never fires, and the call
  // keeps the host's generic row. Not gated on the preset: a session that has
  // this call in its transcript was granted the tool that made it.
  const slots = ctx.slots as unknown as {
    inject: (key: string, callback: () => () => void) => () => void
    register: (options: Record<string, unknown>, component: unknown) => () => void
  }
  // The global 「实验室」 panel (T97): a left-sidebar entry and the central
  // panel it selects, the host 0.2.0 global-panel pair. Both slots are
  // declared by packages this one does not depend on (ui-layout's `main`,
  // ui-sidebar's `sidebar.panellist`); a host without them never fires either
  // inject — no entry, no error. NOT gated on a session's preset
  // (docs/plugin-visibility.md): the experiments are the deployment's, so the
  // install layer decides whether a profile shows the entry.
  slots.inject('main', () => slots.register({
    name: 'main',
    key: PANEL_ID,
    locale: NS,
    store: createLabViewStore,
    inject: (): LabViewInjected => injected,
  }, LabPanel))
  slots.inject('sidebar.panellist', () => slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 40,
    locale: NS,
    label: () => t('open'),
  }, LabPanelIcon))

  slots.inject('tool.call.toolview', () => slots.register({
    name: 'tool.call.toolview',
    key: 'eval_plan_draft',
    locale: NS,
    inject: (sessionId: SessionId): DraftCardFace => ({
      loadStatus: async (experimentId: string) => {
        const result = await remote.runs({ session: sessionId })
        if (!result.ok) return null
        return result.value.rows.find(row => row.experimentId === experimentId)?.status ?? null
      },
      openExperiment: (experimentId: string) => { focus.request(sessionId, experimentId) },
    }),
  }, DraftCard))

  // 查看 in the host's right sidebar (T85 §三, T86 step 2). The two services are
  // a DEFERRED inject, never the inject list: a profile without the right
  // sidebar must still load the lab (the pane then opens in the page's own
  // Sheet), and a one-shot `ctx.get` at apply would misread a sidebar that
  // mounts after this plugin as absent. The tab type follows the lab tab's own
  // preset criterion, so a session that hides the lab has no 查看 either.
  ctx.inject(['sidebarRight', 'sidebarRightTabs'], (sub: Context) => {
    const host = sub as unknown as {
      sidebarRight: { openTab: (kind: string, options: { params: { target: InspectTarget } }) => void }
      sidebarRightTabs: { register: (definition: { id: string; kind: string; title: () => string }) => () => void }
    }
    const tabType = new RegistrationToggle(
      () => host.sidebarRightTabs.register({ id: INSPECT_TAB_ID, kind: INSPECT_KIND, title: () => t('inspect.paneTitle') }),
      () => chrome.show(mainSessionId(ctx.sessions.list.getSnapshot())),
    )
    tabType.setReady(true)
    const unsubscribe = chrome.subscribe(() => { tabType.sync() })
    // Answered true only when the host took the open: an unregistered kind or
    // a session without a sidebar seat throws, and the lab falls back.
    inspectHost.open = (target) => {
      if (!tabType.registered) return false
      try {
        host.sidebarRight.openTab(INSPECT_KIND, { params: { target } })
        return true
      } catch {
        return false
      }
    }
    sub.effect(() => () => {
      inspectHost.open = null
      unsubscribe()
      tabType.setReady(false)
    }, 'eval: inspect tab type')
  })
  // The body and the chip title. Keyed under the type's id; without the
  // sidebar package neither slot is declared and neither inject fires.
  const titles = createInspectTitles()
  const reads = inspectReadsOf(injected)
  slots.inject('sidebar.right.pane.tab', () => slots.register({
    name: 'sidebar.right.pane.tab',
    key: INSPECT_TAB_ID,
    locale: NS,
    inject: () => ({ reads, titles }),
  }, SidebarInspect))
  slots.inject('sidebar.right.pane.tab.title', () => slots.register({
    name: 'sidebar.right.pane.tab.title',
    key: INSPECT_TAB_ID,
    inject: () => ({ titles }),
  }, SidebarInspectTitle))

  return async () => {
    await Promise.all(disposers.map(dispose => dispose()))
  }
}
