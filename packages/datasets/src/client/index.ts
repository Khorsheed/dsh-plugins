/**
 * Datasets plugin, browser half: the session's dataset binding and browser as
 * the 'datasets' entry in the conversation's `conversation.view` tab ring
 * (beside chat and trajectory). The datasets Remote is mounted here through
 * the official `ctx.remote.$mount` channel, so the plugin distributes as an
 * independent package with no edits to core packages; content previews are
 * delegated to the official reader primitives (MarkdownText / CodeBlock), the
 * tab only navigates the tree and hands the selected file's content over.
 * Composing this plugin out of cordis.yml removes the tab.
 * @module @khorsheed/dsh-datasets/client
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
// Type-only: pulls the ctx.locale service merge.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the ctx.slots service merge.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the generated Remote API and ctx.remote merge.
import type {} from '@khorsheed/dsh-datasets/remote'
// Type-only: pulls ui-conversation's SlotMap merge ('conversation.view').
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import datasetsRemote from '@khorsheed/dsh-datasets/remote'
import type { DatasetBinding, ReadPassthroughRequest, ReadQuery } from '../types.ts'
import { DatasetsView } from './DatasetsView.tsx'
import { en, NS, zh } from './locales.ts'
import { createDatasetsViewStore } from './store.ts'
import type { DatasetsRemote, DatasetsViewInjected, HostDescriptionSource } from './contract.ts'

export { DatasetsView }

/** Required services: the slot registry, the remote channel, and the copy.
 * `remote.datasets` is deliberately NOT an inject: this plugin both mounts the
 * namespace (through `$mount` below) and consumes it, and the Cordis property
 * proxy only resolves services declared in `inject` or provided by an ancestor
 * fiber — declaring it would deadlock the loader. The mount is awaited and the
 * namespace is then read back from the global store with `ctx.get` (the
 * ui-file-preview precedent). */
export const inject = ['slots', 'remote', 'locale', 'workspaces', 'connection']

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
 * Client plugin body: mount the Remote, register the dictionaries and the
 * datasets view tab.
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

  ctx.slots.inject('conversation.view', () => ctx.slots.register({
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
  }, DatasetsView))

  return async () => {
    await Promise.all(disposers.map(dispose => dispose()))
  }
}
