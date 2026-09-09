/**
 * Local-files plugin, browser half: a workspace view tab beside chat and
 * 产物 — a git-agnostic file browser over the session's workspace. It mounts
 * the localFiles Remote through the official `ctx.remote.$mount` channel and
 * registers a `conversation.view` entry so the browser surfaces as its own tab.
 *
 * @module @khorsheed/dsh-local-files/client
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { HostDescriptionSource } from './host-description.ts'
// Type-only: pulls the Controller service merge (ctx.sessions).
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
// Type-only: pulls the ctx.slots service merge.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the ctx.locale service merge.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the generated Remote API and ctx.remote merge.
import type {} from '@khorsheed/dsh-local-files/remote'
// Type-only: pulls ui-conversation's SlotMap merge ('conversation.view').
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import localFilesRemote from '@khorsheed/dsh-local-files/remote'
import type {
  ListLocalDirectoryRequest, ReadLocalFileRequest,
} from '../types.ts'
import { WorkspaceView } from './WorkspaceView.tsx'
import type {
  LocalFilesRemote, WorkspaceViewInjected,
} from './contract.ts'
import { en, NS, zh } from './locales.ts'
import { createLocalFilesStore } from './store-local.ts'

export { WorkspaceView }

/** Required services: slots, sessions, the remote channel, and the locale. */
export const inject = ['slots', 'sessions', 'remote', 'locale', 'connection']

/**
 * Host-facts source for the view's hooks: 0.1.2 folded the facts into the
 * connection generation's opening frame. The derived snapshot carries `home`
 * but no `canOpenPath` (that capability became an RPC probe), which reads as
 * unavailable and hides the external-open buttons — the intended degrade.
 * @param connection - the connection service handle.
 * @returns an observable Host-description source.
 */
function hostDescriptionSourceOf(connection: ConnectionHandle): HostDescriptionSource {
  return {
    getSnapshot: () => connection.generation.getSnapshot()?.host,
    subscribe: listener => connection.generation.subscribe(listener),
  }
}

/**
 * Client plugin body: mount the Remote, register the dictionaries, and the
 * workspace view tab.
 * @param ctx - client root context.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const disposers: Array<() => Promise<void>> = []
  try {
    disposers.push(await ctx.remote.$mount(localFilesRemote))
  } catch (error) {
    // A Remote already mounted by another composition fails loud at boot; the
    // rest of the plugin still registers.
    /* v8 ignore next -- double-mount is a composition error, not a runtime path */
    ctx.logger.error(error)
  }
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'local-files: dictionaries')
  const t = ctx.locale.bind(NS)
  const remote = ctx.get('remote.localFiles') as LocalFilesRemote
  const connection = ctx.get('connection') as ConnectionHandle
  const sessions: ISessions = ctx.sessions

  const openOnHost = (path: string): void => {
    // 0.1.2 moved path opens to the session Remote namespace
    // (remote.session.openWorkspacePath); absent there the gesture degrades
    // to a no-op.
    const opened = (ctx.remote as unknown as {
      session?: { openWorkspacePath(request: { path: string }): Promise<unknown> }
    }).session?.openWorkspacePath({ path })
    void Promise.resolve(opened ?? false).catch(() => {
      // Host/OS open failures stay silent; the native app surfaces its own error.
    })
  }

  /** Open the host's native directory picker (resolves the chosen path). */
  const pickWorkspace = async (): Promise<string | null> => {
    // 0.1.2 moved the native directory picker to the directoryPicker Remote
    // namespace; absent there the gesture resolves null (cancelled-shaped).
    const picker = (ctx.remote as unknown as {
      directoryPicker?: { pick(): Promise<{ ok: boolean; value?: string | null; error?: { message: string } }> }
    }).directoryPicker
    if (picker === undefined) return null
    const result = await picker.pick()
    if (!result.ok) throw new Error(result.error?.message ?? 'directory picker failed')
    return result.value ?? null
  }

  /** The session's workspace cwd (its creation `cwd`), or undefined when unknown. */
  const sessionCwd = (sessionId: SessionId): string | undefined => {
    const snapshot = sessions.list.getSnapshot()
    return snapshot.byId[sessionId]?.cwd
  }

  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'local-files',
    order: 25,
    locale: NS,
    label: () => t('tab.label'),
    store: createLocalFilesStore,
    inject: (_sessionId, _actions): WorkspaceViewInjected => ({
      listDirectory: (request: ListLocalDirectoryRequest) => remote.listDirectory(request),
      readFile: (request: ReadLocalFileRequest) => remote.readFile(request),
      pickWorkspace,
      sessionCwd,
      isLoopback: connection.isLoopback,
      hooks: { hostDescription: hostDescriptionSourceOf(connection) },
      openExternal: (path) => { openOnHost(path) },
    }),
  }, WorkspaceView))

  return async () => {
    await Promise.all(disposers.map(dispose => dispose()))
  }
}
