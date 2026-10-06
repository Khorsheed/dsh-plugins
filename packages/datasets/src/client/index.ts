/**
 * Datasets plugin, browser half: the deployment's dataset registry and browser
 * as the 'datasets' entry in the conversation's `conversation.view` tab ring
 * (beside chat and trajectory). The datasets Remote is mounted here through
 * the official `ctx.remote.$mount` channel, so the plugin distributes as an
 * independent package with no edits to core packages; content previews are
 * delegated to the official reader primitives (MarkdownText / CodeBlock), the
 * tab only navigates the tree and hands the selected file's content over. The
 * tab self-hides (M3'④) unless the current session's preset composition names
 * the `@khorsheed/dsh-datasets/tool` row — the tools it exercises are granted
 * there, and a viewer over a toolset the session never got is an empty shell.
 * Composing this plugin out of cordis.yml removes the tab.
 * @module @khorsheed/dsh-datasets/client
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
// Type-only: pulls the ctx.locale service merge.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the ctx.sessions service merge (ISessions).
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
// Type-only: pulls the ctx.slots service merge.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the generated Remote API and ctx.remote merge.
import type {} from '@khorsheed/dsh-datasets/remote'
// Type-only: pulls ui-conversation's SlotMap merge ('conversation.view').
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import datasetsRemote from '@khorsheed/dsh-datasets/remote'
import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ReadPassthroughRequest, ReadQuery, RegisterInput, UpdateInput } from '../types.ts'
import { DatasetsView } from './DatasetsView.tsx'
import { en, NS, zh } from './locales.ts'
import { draftWithRetries, type OrganizeOutcome } from './organize.ts'
import { DatasetsPresetVisibility, RegistrationToggle } from './preset-visibility.ts'
import { createDatasetsViewStore } from './store.ts'
import { ReviewTurnTail, type ReviewCardFace } from './ReviewCard.tsx'
import { proposedTurnDefinition } from './review-turn.ts'
import { createReviewFocus } from './review-card.ts'
import { DatasetsPanel, DatasetsPanelIcon, PANEL_ID, PANEL_SESSION } from './global-panel.tsx'
import type {
  DatasetExperimentRow, DatasetsRemote, DatasetsViewInjected, HostDescriptionSource, HostFacts, ItemRunsView,
} from './contract.ts'

export { DatasetsView }

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

/** Required services: the slot registry, the remote channel, the copy, the
 * workspace/connection facts the view reads, and the session list (the
 * preset-composition criterion reads the current session).
 * `remote.datasets` is deliberately NOT an inject: this plugin both mounts the
 * namespace (through `$mount` below) and consumes it, and the Cordis property
 * proxy only resolves services declared in `inject` or provided by an ancestor
 * fiber — declaring it would deadlock the loader. The mount is awaited and the
 * namespace is then read back from the global store with `ctx.get` (the
 * file-preview precedent). */
export const inject = ['slots', 'remote', 'locale', 'workspaces', 'connection', 'sessions']

/** Static absence: no host-facts source on an unrecognized line (never reached on rc or 0.1.2). */
const ABSENT_HOST_DESCRIPTION: HostDescriptionSource = {
  getSnapshot: () => undefined,
  subscribe: () => () => {},
}

/**
 * Host-facts source for the view's hook, probed per host line: rc hosts
 * expose `Connection.hostDescription` directly; 0.1.2 folded the facts into
 * the connection generation's opening frame (upstream e14d354e83), so the
 * source is derived from `connection.generation` there. The derived snapshot
 * carries `home` but no `canOpenPath` — that capability became the
 * `session.canOpenWorkspacePath` RPC probe (the official open-in-app control
 * reads the same verb). The probe runs once on the first subscription and is
 * folded into the snapshot; while it is unanswered, or when it fails or the
 * verb is absent, `canOpenPath` stays missing and the native-picker buttons
 * stay hidden (the degrade). A failed probe is retried on the next generation
 * change (a reconnect). Before T95 the probe was never asked, so every
 * 「选择…」 button was hidden on 0.1.2 and later hosts.
 * @param connection - the connection service handle.
 * @param probeCanOpenPath - the RPC probe; resolves undefined when unavailable.
 * @returns an observable HostDescription source on either host line.
 */
function hostDescriptionSourceOf(
  connection: ConnectionHandle,
  probeCanOpenPath: () => Promise<boolean | undefined> = async () => undefined,
): HostDescriptionSource {
  const probe = connection as unknown as {
    hostDescription?: HostDescriptionSource
    generation?: {
      getSnapshot(): { readonly host: unknown } | undefined
      subscribe(listener: () => void): () => void
    }
  }
  if (probe.hostDescription !== undefined) return probe.hostDescription
  const generation = probe.generation
  if (generation === undefined) return ABSENT_HOST_DESCRIPTION
  const listeners = new Set<() => void>()
  let probed: boolean | undefined
  let asking = false
  // Stable merged snapshot per (host, probed) pair: the hook's external-store
  // read compares snapshots by identity.
  let merged: { host: unknown; probed: boolean; value: HostFacts } | undefined
  const ask = () => {
    if (asking || probed !== undefined) return
    asking = true
    void probeCanOpenPath().catch(() => undefined).then((answer) => {
      asking = false
      if (answer === undefined) return
      probed = answer
      for (const listener of listeners) listener()
    })
  }
  return {
    getSnapshot: () => {
      const host = generation.getSnapshot()?.host as HostFacts | undefined
      if (probed === undefined || host === undefined || host.canOpenPath !== undefined) return host
      if (merged?.host !== host || merged.probed !== probed) {
        merged = { host, probed, value: { ...host, canOpenPath: probed } }
      }
      return merged.value
    },
    subscribe: (listener) => {
      listeners.add(listener)
      ask()
      const stop = generation.subscribe(() => {
        ask()
        listener()
      })
      return () => {
        listeners.delete(listener)
        stop()
      }
    },
  }
}

/**
 * The two eval verbs the 题集 tab reads, structurally — never imported.
 * A plugin may not import a sibling package (the independence check), and the
 * tab must work on an instance that carries no orchestrator at all, so the
 * namespace is duck-typed and probed at CALL time. Both are session-less
 * since T97 (eval's own global panel needs them without a session too): the
 * call carries the request alone, and the gateway checks that arity.
 */
interface EvalProjectionRemote {
  runsForItem?: (request: { datasetId: string; itemId: string }) => Promise<
    { ok: true; value: { runs: ItemRunsView['runs']; notes: string[] } } | { ok: false }
  >
  runs?: (request: { session?: string }) => Promise<
    {
      ok: true
      value: {
        rows: Array<{
          id: string
          name: string
          status: string
          experimentId?: string | null
          snapshot: { datasetId: string | null; registry?: string | null; commit?: string | null }
        }>
      }
    }
    | { ok: false }
  >
}

/**
 * The eval Remote namespace, or undefined when this instance has none.
 *
 * Read through `ctx.get` on EVERY call rather than once at apply: datasets and
 * eval each mount their own Remote through `$mount`, in whatever order the
 * loader composes them, so a one-shot probe at mount would answer «no
 * orchestrator» purely because eval had not settled yet — and the 作答记录
 * area would stay hidden for the life of the page.
 * @param ctx - client root context.
 * @returns the namespace, or undefined.
 */
function evalRemoteOf(ctx: Context): EvalProjectionRemote | undefined {
  return ctx.get('remote.dshEval') as EvalProjectionRemote | undefined
}

/**
 * The workspace a session-less 「新会话」 lands in — ui-workspace's own
 * `recentWorkspace` rule mirrored (it is not exported): the workspace whose
 * newest session moved last, an empty one by its creation time, ties by the
 * host's order.
 * @param items - the workspace list's rows.
 * @param byId - the session list's rows.
 * @returns the workspace id, or undefined when there is none.
 */
export function recentWorkspaceOf(
  items: ReadonlyArray<{ workspaceId: string; sessionIds: readonly string[]; createdAt?: string }>,
  byId: Readonly<Record<string, { updatedAt?: number } | undefined>>,
): string | undefined {
  let selected: string | undefined
  let selectedTime = Number.NEGATIVE_INFINITY
  for (const item of items) {
    let latest = Number.NEGATIVE_INFINITY
    for (const sessionId of item.sessionIds) {
      const updated = byId[sessionId]?.updatedAt
      if (typeof updated === 'number') latest = Math.max(latest, updated)
    }
    if (latest === Number.NEGATIVE_INFINITY) latest = item.createdAt === undefined ? Number.NEGATIVE_INFINITY : Date.parse(item.createdAt)
    if (selected === undefined || latest > selectedTime) {
      selected = item.workspaceId
      selectedTime = latest
    }
  }
  return selected
}

/** The host doors the 「题集整理」 hand-off walks through, each probed (0.2.0 shapes; an absence degrades). */
interface SessionsDoors {
  create?: (options: { workspaceId?: string }) => Promise<SessionId>
  using?: (
    sessionId: SessionId,
    options: { source: string },
    body: (ref: { binding: { session: { rename(title: string): Promise<unknown> } } }) => Promise<unknown>,
  ) => Promise<unknown>
  open?: (sessionId: SessionId) => void
}

/**
 * The 「让 Agent 整理」 doors: open a new organizing session or an existing
 * one, and write a request into its chat box — never send it. Every host door
 * is probed; what is missing degrades to the clipboard, then to showing the
 * text (the outcome says which, and the tab shows the matching notice).
 * @param ctx - client root context.
 * @returns the two doors.
 */
function organizingDoors(ctx: Context): {
  start: (current: SessionId, title: string, text: string, preset: string) => Promise<OrganizeOutcome>
  draftIn: (target: SessionId, text: string) => Promise<OrganizeOutcome>
} {
  const getService = ctx.get.bind(ctx) as (name: string) => unknown
  const sessions = ctx.sessions as unknown as SessionsDoors
  const insert = (sid: SessionId, text: string): boolean => {
    const scope = ctx.sessions.scope(sid)
    if (scope === undefined) return false
    const input = scope.get('conversation')?.input.for(scope)
    if (input === undefined) return false
    const current = input.state.getSnapshot().draft
    input.setDraft(current.trim() === '' ? text : `${current}\n\n${text}`)
    const probe = input as unknown as {
      focus?: () => void
      editor?: { focus?: () => void; getRootElement?: () => HTMLElement | null }
    }
    try {
      if (typeof probe.focus === 'function') probe.focus()
      else probe.editor?.getRootElement?.()?.focus({ preventScroll: true })
    } catch { /* the text is in place; focus is a courtesy */ }
    return true
  }
  const open = (sid: SessionId): boolean => {
    const nav = getService('uiWorkspace') as { openSession?: (target: SessionId) => void } | undefined
    try {
      if (nav?.openSession !== undefined) nav.openSession(sid)
      else if (sessions.open !== undefined) sessions.open(sid)
      else return false
      return true
    } catch {
      return false
    }
  }
  const fallback = async (text: string, sessionId?: SessionId): Promise<OrganizeOutcome> => {
    const at = sessionId === undefined || sessionId === '' ? {} : { sessionId }
    return (await writeClipboard(text)) ? { kind: 'copied', ...at } : { kind: 'manual', text, ...at }
  }
  const draftIn = async (target: SessionId, text: string): Promise<OrganizeOutcome> => {
    if (target !== '' && open(target) && await draftWithRetries(() => insert(target, text))) return { kind: 'drafted', sessionId: target }
    return await fallback(text, target)
  }
  const workspaceOf = (sid: SessionId): string | undefined => {
    try {
      const list = (ctx.workspaces as unknown as {
        list?: { getSnapshot(): { items: Array<{ workspaceId: string; sessionIds: readonly string[]; createdAt?: string }> } }
      }).list
      const items = list?.getSnapshot().items ?? []
      const own = sid === '' ? undefined : items.find(item => item.sessionIds.includes(sid))?.workspaceId
      // The global panel has no session (T97): the new session lands where the
      // host's own 「新会话」 would put it — the most recently active workspace.
      return own ?? recentWorkspaceOf(items, ctx.sessions.list.getSnapshot().byId as Record<string, { updatedAt?: number }>)
    } catch {
      return undefined
    }
  }
  const selectPreset = async (sid: SessionId, preset: string): Promise<void> => {
    if (preset === '') return
    const presets = getService('remote.agentPresets') as {
      list?: () => Promise<{ ok: boolean; value?: { presets: Array<{ id: string; broken?: unknown }> } }>
      select?: (sessionId: SessionId, presetId: string) => Promise<unknown>
    } | undefined
    if (presets?.list === undefined || presets.select === undefined) return
    try {
      const listed = await presets.list()
      const row = listed.ok ? listed.value?.presets.find(entry => entry.id === preset) : undefined
      // A preset this host does not list (or lists as broken) is not offered:
      // the session keeps the default preset and the request names the skill.
      if (row === undefined || (row.broken !== undefined && row.broken !== false)) return
      await presets.select(sid, preset)
    } catch { /* the default preset still works; the request names the skill */ }
  }
  const start = async (current: SessionId, title: string, text: string, preset: string): Promise<OrganizeOutcome> => {
    if (sessions.create === undefined) return await fallback(text)
    let created: SessionId
    try {
      const workspaceId = workspaceOf(current)
      created = await sessions.create(workspaceId === undefined ? {} : { workspaceId })
    } catch (error) {
      return { kind: 'failed', message: error instanceof Error ? error.message : String(error) }
    }
    await selectPreset(created, preset)
    try {
      await sessions.using?.(created, { source: 'workspaceOperation' }, ref => ref.binding.session.rename(title))
    } catch { /* an untitled session still works */ }
    return await draftIn(created, text)
  }
  return { start, draftIn }
}

/**
 * Client plugin body: mount the Remote, register the dictionaries, and inject
 * the datasets view tab (registered exactly while the current session's preset
 * composition grants the dataset tool row).
 * @param ctx - client root context.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const disposers: Array<() => Promise<void>> = []
  try {
    disposers.push(await ctx.remote.$mount(datasetsRemote))
  } catch (error) {
    // A Remote already mounted by another composition fails loud at boot; the
    // rest of the plugin still registers (the view surfaces the typed RPC
    // error an unmounted namespace answers).
    /* v8 ignore next -- double-mount is a composition error, not a runtime path */
    ctx.logger.error(error)
  }
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'datasets: dictionaries')
  const t = ctx.locale.bind(NS)
  // The namespace is registered by $mount above; read it back from the global
  // store once the mount has settled (a lazy `ctx.remote.datasets` read would
  // trip the property proxy — the namespace lives in the sibling fiber $mount
  // spawned).
  const remote = ctx.get('remote.datasets') as DatasetsRemote
  const connection = ctx.get('connection') as ConnectionHandle
  // One host-facts source per mount (the probe's answer is shared by every
  // session's view). `remote.session` is read at call time, never injected.
  const hostDescription = hostDescriptionSourceOf(connection, async () => {
    const session = (ctx.get.bind(ctx) as (name: string) => unknown)('remote.session') as {
      canOpenWorkspacePath?: () => Promise<{ ok: boolean; value?: unknown }>
    } | undefined
    if (session?.canOpenWorkspacePath === undefined) return undefined
    const result = await session.canOpenWorkspacePath()
    return result.ok ? result.value === true : undefined
  })

  const organizing = organizingDoors(ctx)
  // T96 · the 「核对并登记」 card's requests, carried to each session's 题集 tab.
  const reviewFocus = createReviewFocus()

  // One face for the session tab and the global panel (T97): the datasets
  // Remote takes no session, so every read and write is the same call from
  // either; the session id the view passes along only reaches the doors that
  // open or draft into a session.
  const face: DatasetsViewInjected = {
    fetchRegistry: (_sid: SessionId) => remote.registry(),
    previewRepo: (_sid: SessionId, path: string, trackedRef?: string) =>
      remote.previewRepo(trackedRef === undefined ? { path } : { path, trackedRef }),
    register: (_sid: SessionId, input: RegisterInput) => remote.register(input),
    updateRegistration: (_sid: SessionId, input: UpdateInput) => remote.updateRegistration(input),
    unregister: (_sid: SessionId, id: string) => remote.unregister({ id }),
    deletePlan: (_sid: SessionId, id: string) => remote.deletePlan({ id }),
    deleteRegistration: (_sid: SessionId, id: string) => remote.deleteRegistration({ id }),
    importBindings: (_sid: SessionId) => remote.importBindings(),
    listDatasets: (_sid: SessionId, repo: string, dataset?: string) =>
      remote.list(dataset === undefined ? { repo } : { repo, dataset }),
    readFile: (_sid: SessionId, repo: string, query: ReadQuery) => remote.read({ ...query, repo }),
    readPassthroughFile: (_sid: SessionId, repo: string, query: ReadPassthroughRequest) =>
      remote.readPassthrough({ ...query, repo }),
    overview: (_sid: SessionId, repo: string) => remote.overview({ repo }),
    itemBrief: (_sid: SessionId, repo: string, dataset: string, item: string) =>
      remote.itemBrief({ repo, dataset, item }),
    validateDataset: (_sid: SessionId, repo: string, dataset: string) => remote.validate({ repo, dataset }),
    organizingSetup: (_sid: SessionId) => remote.organizingSetup(),
    proposals: (_sid: SessionId) => remote.proposals(),
    proposalReview: (_sid: SessionId, id: string) => remote.proposalReview({ id }),
    proposalHead: (_sid: SessionId, id: string) => remote.proposalHead({ id }),
    reviewFocus: { take: reviewFocus.take, subscribe: reviewFocus.subscribe },
    reviewItem: (_sid: SessionId, id: string, set: string, item: string) => remote.reviewItem({ id, set, item }),
    reviewFiles: (_sid: SessionId, id: string) => remote.reviewFiles({ id }),
    confirmProposal: (_sid: SessionId, id: string, registryId: string, sets: Record<string, { layers: string[] }>) =>
      remote.confirmProposal({ id, registryId, sets }),
    returnProposal: (_sid: SessionId, id: string, note: string) => remote.returnProposal({ id, note }),
    discardPlan: (_sid: SessionId, id: string) => remote.discardPlan({ id }),
    discardProposal: (_sid: SessionId, id: string) => remote.discardProposal({ id }),
    pendingReview: (_sid: SessionId, repo: string) => remote.pendingReview({ repo }),
    confirmPending: (_sid: SessionId, repo: string, commit: string, sets: Record<string, { layers: string[] }>) =>
      remote.confirmPending({ repo, commit, sets }),
    startOrganizing: (sid: SessionId, title: string, text: string, preset: string) =>
      organizing.start(sid, title, text, preset),
    draftInSession: (target: string, text: string) => organizing.draftIn(target as SessionId, text),
    itemRuns: async (_sid: SessionId, dataset: string, item: string): Promise<ItemRunsView | null> => {
      const projection = evalRemoteOf(ctx)
      if (projection?.runsForItem === undefined) return null
      const answer = await projection.runsForItem({ datasetId: dataset, itemId: item })
      // An eval that is present but cannot answer is NOT the same as an
      // absent one: the area stays, carrying eval's own reason.
      return answer.ok ? { runs: answer.value.runs, notes: answer.value.notes } : { runs: [], notes: [] }
    },
    datasetExperiments: async (_sid: SessionId): Promise<DatasetExperimentRow[] | null> => {
      const projection = evalRemoteOf(ctx)
      if (projection?.runs === undefined) return null
      const answer = await projection.runs({})
      if (!answer.ok) return null
      return answer.value.rows.map(row => ({
        id: row.id,
        name: row.name,
        status: row.status,
        datasetId: row.snapshot.datasetId,
        // Optional on the mirror: an older eval that lacks them degrades to
        // «match by set, count unpinned» rather than to a crash.
        experimentId: row.experimentId ?? null,
        registry: row.snapshot.registry ?? null,
        commit: row.snapshot.commit ?? null,
      }))
    },
    isLoopback: connection.isLoopback,
    hooks: { hostDescription },
    // rc hosts hang the native picker on the workspaces service; 0.1.2
    // moved it to uiWorkspace (ui-workspace) — probe both, resolve null
    // (the picker-cancel value) when neither exists.
    pickDirectory: () => {
      const legacy = (ctx.workspaces as unknown as { pickDirectory?: () => Promise<string | null> }).pickDirectory
      if (legacy !== undefined) return legacy.call(ctx.workspaces)
      const getService = ctx.get.bind(ctx) as (name: string) => unknown
      const uiWorkspace = getService('uiWorkspace') as { pickDirectory(): Promise<string | null> } | undefined
      return uiWorkspace?.pickDirectory() ?? Promise.resolve(null)
    },
  }

  // The M3'④ self-hide criterion for the 题集 tab: the official preset
  // composition data, fail-open on every unreadable path. Hidden means NO
  // registration (the tab strip's buttons enumerate registrations), so the
  // strip never carries an empty-body button.
  const chrome = new DatasetsPresetVisibility(ctx)
  const datasetsToggle = new RegistrationToggle(
    () => ctx.slots.register({
      name: 'conversation.view',
      id: 'datasets',
      order: 30,
      locale: NS,
      label: () => t('open'),
      store: createDatasetsViewStore,
      inject: (_sessionId: SessionId): DatasetsViewInjected => face,
    }, DatasetsView),
    () => chrome.show(mainSessionId(ctx.sessions.list.getSnapshot())),
  )
  ctx.slots.inject('conversation.view', () => {
    datasetsToggle.setReady(true)
    return () => { datasetsToggle.setReady(false) }
  })

  ctx.effect(() => chrome.subscribe(() => {
    datasetsToggle.sync()
  }), 'datasets: datasets tab visibility')

  // T97 · the global 「题集」 panel: a left-sidebar entry and the central panel
  // it selects, the host 0.2.0 global-panel pair. Both slots are declared by
  // packages this one does not depend on (ui-layout's `main`, ui-sidebar's
  // `sidebar.panellist`), so the two registrations go through the structural
  // registry view below; a host without them never fires either inject — no
  // entry, no error. NOT gated on a session's preset (docs/plugin-visibility.md):
  // the registry is the deployment's, not a session's, so the install layer
  // decides whether a profile shows it.
  const slots = ctx.slots as unknown as {
    inject: (key: string, callback: () => () => void) => () => void
    register: (options: Record<string, unknown>, component: unknown) => () => void
  }
  slots.inject('main', () => slots.register({
    name: 'main',
    key: PANEL_ID,
    locale: NS,
    store: createDatasetsViewStore,
    inject: (): DatasetsViewInjected => face,
  }, DatasetsPanel))
  slots.inject('sidebar.panellist', () => slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 30,
    locale: NS,
    label: () => t('panel'),
  }, DatasetsPanelIcon))

  // The card's one action (T96, rerouted by T97): select the global 「题集」
  // panel and leave the request there, so the review opens with no tab strip
  // in the way. `ctx.layout` is probed per click (ui-layout is an optional
  // peer) and `selectPanel` throws on a key nobody registered; either way the
  // request falls back to this session's 题集 tab, and the card says to open it.
  const openReviewFrom = (sessionId: SessionId, proposalId: string): boolean => {
    const layout = (ctx.get.bind(ctx) as (name: string) => unknown)('layout') as {
      selectPanel?: (panelId: string | null) => void
    } | undefined
    if (layout?.selectPanel !== undefined) {
      reviewFocus.request(PANEL_SESSION, proposalId)
      try {
        layout.selectPanel(PANEL_ID)
        return true
      } catch {
        reviewFocus.take(PANEL_SESSION)
      }
    }
    reviewFocus.request(sessionId, proposalId)
    return false
  }

  // T96 · the 「核对并登记」 entry, in the organizing Turn's tail. A finished
  // Turn folds its tool calls into one collapsed group, so a card on the
  // propose call's own row is hidden exactly when the summary points at it;
  // the host's turn-level artifacts (ui-schedule's created-task card) take
  // the same route: a Conversation Definition publishes the Turn's filed
  // proposals as Turn data and a `conversation.chat.turnTail` entry renders
  // them. Both live inside the inject on that slot: ui-chat declares it and
  // composes ui-conversation, so `uiConversation` is read only once it can
  // exist — this package keeps both as optional peers and never imports them
  // at runtime. Without them nothing registers and the proposal still waits
  // behind the tab's banner. Not gated on the preset: a Turn that filed a
  // proposal was granted the tool.
  slots.inject('conversation.chat.turnTail', () => {
    const conversation = (ctx.get.bind(ctx) as (name: string) => unknown)('uiConversation') as {
      events?: { register?: (definition: unknown) => () => void }
    } | undefined
    const register = conversation?.events?.register
    if (register === undefined) return () => undefined
    const disposeDefinition = register.call(conversation?.events, proposedTurnDefinition)
    const disposeEntry = slots.register({
      name: 'conversation.chat.turnTail',
      id: '@khorsheed/dsh-datasets/review',
      order: 30,
      locale: NS,
      inject: (sessionId: SessionId): ReviewCardFace => ({
        loadPending: async (proposalId: string) => {
          const result = await remote.proposals()
          return result.ok ? result.value.some(proposal => proposal.id === proposalId) : null
        },
        openReview: (proposalId: string) => openReviewFrom(sessionId, proposalId),
      }),
    }, ReviewTurnTail)
    return () => {
      disposeEntry()
      disposeDefinition()
    }
  })

  return async () => {
    await Promise.all(disposers.map(dispose => dispose()))
  }
}
