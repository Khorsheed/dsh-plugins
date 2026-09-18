/**
 * Datasets plugin, browser half: the session's dataset binding and browser as
 * the 'datasets' entry in the conversation's `conversation.view` tab ring
 * (beside chat and trajectory). The datasets Remote is mounted here through
 * the official `ctx.remote.$mount` channel, so the plugin distributes as an
 * independent package with no edits to core packages; content previews are
 * delegated to the official reader primitives (MarkdownText / CodeBlock), the
 * tab only navigates the tree and hands the selected file's content over. The
 * tab self-hides (M3'④) unless the current session's preset composition names
 * the `@khorsheed/dsh-datasets-tool` row — the tools it exercises are granted
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
import type {
  DatasetBinding, ImportItemInput, ReadPassthroughRequest, ReadQuery,
  ScaffoldDatasetInput, ScaffoldItemInput,
} from '../types.ts'
import { BindingChip, type BindingChipInjected } from './BindingChip.tsx'
import { DatasetsView } from './DatasetsView.tsx'
import { en, NS, zh } from './locales.ts'
import { DatasetsPresetVisibility, RegistrationToggle } from './preset-visibility.ts'
import { createDatasetsViewStore } from './store.ts'
import type {
  DatasetExperimentRow, DatasetsRemote, DatasetsViewInjected, HostDescriptionSource, ItemRunsView,
} from './contract.ts'

export { BindingChip, DatasetsView }

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
 * ui-file-preview precedent). */
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
 * carries `home` but no `canOpenPath` (that capability became an RPC probe),
 * which reads as unavailable and hides the external-open affordances — the
 * intended degrade on 0.1.2.
 * @param connection - the connection service handle.
 * @returns an observable HostDescription source on either host line.
 */
function hostDescriptionSourceOf(connection: ConnectionHandle): HostDescriptionSource {
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
  return {
    getSnapshot: () => generation.getSnapshot()?.host,
    subscribe: listener => generation.subscribe(listener),
  } as HostDescriptionSource
}

/**
 * The two eval verbs the 题集 tab reads, structurally — never imported.
 * A plugin may not import a sibling package (the independence check), and the
 * tab must work on an instance that carries no orchestrator at all, so the
 * namespace is duck-typed and probed at CALL time.
 */
interface EvalProjectionRemote {
  runsForItem?: (sessionId: SessionId, request: { datasetId: string; itemId: string }) => Promise<
    { ok: true; value: { runs: ItemRunsView['runs']; notes: string[] } } | { ok: false }
  >
  runs?: (sessionId: SessionId, request: Record<string, never>) => Promise<
    { ok: true; value: { rows: Array<{ id: string; name: string; status: string; snapshot: { datasetId: string | null } }> } }
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
 * Subscribe to ONE session's own activity — the signal the binding chip
 * re-reads on.
 *
 * The session object's snapshot moves when a slash command starts and again
 * when it settles, which is precisely when a `/datasets bind` receipt has to
 * appear. A host that hands out no per-session handle degrades to the session
 * LIST, which also moves on a session's own activity, just more coarsely; a
 * host with neither degrades to no refresh at all rather than to a poll.
 * @param ctx - client root context.
 * @param sessionId - the session to watch.
 * @param listener - called on every change.
 * @returns the unsubscribe function.
 */
function watchSession(ctx: Context, sessionId: SessionId, listener: () => void): () => void {
  const sessions = ctx.sessions as unknown as {
    binding?: (id: SessionId) => { session?: { subscribe?: (fn: () => void) => () => void } } | undefined
    list?: { subscribe?: (fn: () => void) => () => void }
  }
  const own = sessions.binding?.(sessionId)?.session?.subscribe
  if (own !== undefined) return own.call(sessions.binding?.(sessionId)?.session, listener)
  const list = sessions.list?.subscribe
  return list === undefined ? () => {} : list.call(sessions.list, listener)
}

/**
 * Client plugin body: mount the Remote, register the dictionaries, and inject
 * the datasets view tab and the composer's binding chip (both registered
 * exactly while the current session's preset composition grants the dataset
 * tool row).
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
      inject: (_sessionId: SessionId): DatasetsViewInjected => ({
        fetchBinding: (sid: SessionId) => remote.binding(sid),
        bindSession: (sid: SessionId, binding: DatasetBinding) => remote.bind(sid, binding),
        unbindSession: (sid: SessionId) => remote.unbind(sid),
        previewRepo: (sid: SessionId, path: string) => remote.previewRepo(sid, { path }),
        listDatasets: (sid: SessionId, dataset?: string) => remote.list(sid, dataset === undefined ? {} : { dataset }),
        readFile: (sid: SessionId, query: ReadQuery) => remote.read(sid, query),
        readPassthroughFile: (sid: SessionId, query: ReadPassthroughRequest) => remote.readPassthrough(sid, query),
        overview: (sid: SessionId) => remote.overview(sid),
        itemBrief: (sid: SessionId, dataset: string, item: string) => remote.itemBrief(sid, { dataset, item }),
        validateDataset: (sid: SessionId, dataset: string) => remote.validate(sid, { dataset }),
        scaffoldDataset: (sid: SessionId, input: ScaffoldDatasetInput) => remote.scaffoldDataset(sid, input),
        scaffoldItem: (sid: SessionId, input: ScaffoldItemInput) => remote.scaffoldItem(sid, input),
        importItem: (sid: SessionId, input: ImportItemInput) => remote.importItem(sid, input),
        itemRuns: async (sid: SessionId, dataset: string, item: string): Promise<ItemRunsView | null> => {
          const face = evalRemoteOf(ctx)?.runsForItem
          if (face === undefined) return null
          const answer = await face(sid, { datasetId: dataset, itemId: item })
          // An eval that is present but cannot answer is NOT the same as an
          // absent one: the area stays, carrying eval's own reason.
          return answer.ok ? { runs: answer.value.runs, notes: answer.value.notes } : { runs: [], notes: [] }
        },
        datasetExperiments: async (sid: SessionId): Promise<DatasetExperimentRow[] | null> => {
          const face = evalRemoteOf(ctx)?.runs
          if (face === undefined) return null
          const answer = await face(sid, {})
          if (!answer.ok) return null
          return answer.value.rows.map(row => ({
            id: row.id, name: row.name, status: row.status, datasetId: row.snapshot.datasetId,
          }))
        },
        isLoopback: connection.isLoopback,
        hooks: { hostDescription: hostDescriptionSourceOf(connection) },
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
      }),
    }, DatasetsView),
    () => chrome.show(mainSessionId(ctx.sessions.list.getSnapshot())),
  )
  ctx.slots.inject('conversation.view', () => {
    datasetsToggle.setReady(true)
    return () => { datasetsToggle.setReady(false) }
  })

  // The BINDING CHIP, on the composer tool row: the one line that says which
  // repository this session is bound to, visible from a session's first frame
  // rather than from its first message. It rides the same composition
  // criterion as the tab (a session whose preset grants no dataset tools has
  // no binding to speak of), through the same toggle, so the two can never
  // disagree about whether this session is a datasets session.
  const chipToggle = new RegistrationToggle(
    () => ctx.slots.register({
      name: 'conversation.input.left',
      id: 'datasets-binding',
      // After the host's own compact controls: this is a standing fact, not an
      // action, and the actions come first.
      order: 40,
      locale: NS,
      inject: (_sessionId: SessionId): BindingChipInjected => ({
        fetchBinding: (sid: SessionId) => remote.binding(sid),
        watchSession: (sid: SessionId, listener: () => void) => watchSession(ctx, sid, listener),
      }),
    }, BindingChip),
    () => chrome.show(mainSessionId(ctx.sessions.list.getSnapshot())),
  )
  ctx.slots.inject('conversation.input.left', () => {
    chipToggle.setReady(true)
    return () => { chipToggle.setReady(false) }
  })

  ctx.effect(() => chrome.subscribe(() => {
    datasetsToggle.sync()
    chipToggle.sync()
  }), 'datasets: datasets tab visibility')

  return async () => {
    await Promise.all(disposers.map(dispose => dispose()))
  }
}
