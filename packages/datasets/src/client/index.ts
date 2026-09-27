/**
 * Datasets plugin, browser half: the deployment's dataset registry and browser
 * as the 'datasets' entry in the conversation's `conversation.view` tab ring
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
  ImportItemInput, ReadPassthroughRequest, ReadQuery, RegisterInput,
  ScaffoldDatasetInput, ScaffoldItemInput, UpdateInput,
} from '../types.ts'
import { DatasetsView } from './DatasetsView.tsx'
import { en, NS, zh } from './locales.ts'
import { DatasetsPresetVisibility, RegistrationToggle } from './preset-visibility.ts'
import { createDatasetsViewStore } from './store.ts'
import type {
  DatasetExperimentRow, DatasetsRemote, DatasetsViewInjected, HostDescriptionSource, ItemRunsView,
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
        fetchRegistry: (sid: SessionId) => remote.registry(sid),
        previewRepo: (sid: SessionId, path: string, trackedRef?: string) =>
          remote.previewRepo(sid, trackedRef === undefined ? { path } : { path, trackedRef }),
        register: (sid: SessionId, input: RegisterInput) => remote.register(sid, input),
        updateRegistration: (sid: SessionId, input: UpdateInput) => remote.updateRegistration(sid, input),
        unregister: (sid: SessionId, id: string) => remote.unregister(sid, { id }),
        importBindings: (sid: SessionId) => remote.importBindings(sid),
        listDatasets: (sid: SessionId, repo: string, dataset?: string) =>
          remote.list(sid, dataset === undefined ? { repo } : { repo, dataset }),
        readFile: (sid: SessionId, repo: string, query: ReadQuery) => remote.read(sid, { ...query, repo }),
        readPassthroughFile: (sid: SessionId, repo: string, query: ReadPassthroughRequest) =>
          remote.readPassthrough(sid, { ...query, repo }),
        overview: (sid: SessionId, repo: string) => remote.overview(sid, { repo }),
        itemBrief: (sid: SessionId, repo: string, dataset: string, item: string) =>
          remote.itemBrief(sid, { repo, dataset, item }),
        validateDataset: (sid: SessionId, repo: string, dataset: string) => remote.validate(sid, { repo, dataset }),
        scaffoldDataset: (sid: SessionId, repo: string, input: ScaffoldDatasetInput) =>
          remote.scaffoldDataset(sid, { ...input, repo }),
        scaffoldItem: (sid: SessionId, repo: string, input: ScaffoldItemInput) =>
          remote.scaffoldItem(sid, { ...input, repo }),
        importItem: (sid: SessionId, repo: string, input: ImportItemInput) =>
          remote.importItem(sid, { ...input, repo }),
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

  ctx.effect(() => chrome.subscribe(() => {
    datasetsToggle.sync()
  }), 'datasets: datasets tab visibility')

  return async () => {
    await Promise.all(disposers.map(dispose => dispose()))
  }
}
