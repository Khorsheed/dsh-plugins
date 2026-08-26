/**
 * Worktrees plugin, browser half: a per-session repo/worktree badge in the
 * session header (`conversation.session.header.utilities`) and a frame-wide
 * changes drawer (`shell.overlay`) behind it. The worktrees Remote is
 * mounted here through the official `ctx.remote.$mount` channel, so the
 * plugin distributes as an independent package with no edits to core
 * packages. Composing this plugin out of cordis.yml removes every surface it
 * adds.
 * @module @khorsheed/dsh-worktrees/client
 */
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
// Type-only: pulls the ctx.locale service merge.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the generated Remote API and ctx.remote merge.
import type {} from '@khorsheed/dsh-worktrees/remote'
// Type-only: pulls ui-conversation's SlotMap merge
// ('conversation.session.header.utilities').
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the ui-layout frame's SlotMap merge ('shell.overlay').
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import worktreesRemote from '@khorsheed/dsh-worktrees/remote'
import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  FileDiffRequest, ListLocalDirectoryRequest, ReadFileAtCommitRequest, ReadFileRequest, ReadLocalFileRequest,
} from '../types.ts'
import { WorktreesBadge } from './Badge.tsx'
import { WorktreesDrawer } from './Drawer.tsx'
import { LocalFilesDrawer } from './LocalFilesDrawer.tsx'
import type {
  LocalFilesDrawerInjected, WorktreesBadgeInjected, WorktreesDrawerInjected, WorktreesRemote,
} from './contract.ts'
import { en, NS, zh } from './locales.ts'
import { WorktreesController } from './panel-service.ts'
import { createLocalFilesStore } from './store-local.ts'
import { createWorktreesStore } from './store.ts'

export { WorktreesBadge, WorktreesDrawer, LocalFilesDrawer, WorktreesController }

/** Required services: slots, sessions, the remote channel, and the locale.
 * `remote.worktrees` is deliberately NOT an inject: this plugin both mounts
 * the namespace (through `$mount` below) and consumes it, and the Cordis
 * property proxy only resolves services declared in `inject` or provided by
 * an ancestor fiber — declaring it would deadlock the loader. The mount is
 * awaited and the namespace is then read back from the global store with
 * `ctx.get` (the ui-file-preview precedent). */
export const inject = ['slots', 'remote', 'locale', 'sessions', 'workspaces', 'connection']

/**
 * Client plugin body: mount the Remote, register the dictionaries, the
 * session-header badge, and the frame drawer.
 * @param ctx - client root context.
 */
export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  const disposers: Array<() => Promise<void>> = []
  try {
    disposers.push(await ctx.remote.$mount(worktreesRemote))
  } catch (error) {
    // A Remote already mounted by another composition fails loud at boot; the
    // rest of the plugin still registers (the badge renders an unmounted
    // namespace's typed RPC error, and the drawer surfaces it).
    /* v8 ignore next -- double-mount is a composition error, not a runtime path */
    ctx.logger.error(error)
  }
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'worktrees: dictionaries')
  const remote = ctx.get('remote.worktrees') as WorktreesRemote
  const connection = ctx.get('connection') as ConnectionHandle
  const controller = new WorktreesController()

  const openOnHost = (path: string): void => {
    void ctx.workspaces.openPath(path).catch(() => {
      // Host/OS open failures stay silent in the drawer; the native app
      // surfaces its own error dialog when the path is unusable.
    })
  }

  /** The registered workspaces, projected for the browser's switcher. */
  const listWorkspaces = (): { id: string; title: string; path: string }[] => {
    const snapshot = ctx.workspaces.list.getSnapshot()
    return snapshot.items.map(workspace => ({
      id: workspace.workspaceId,
      title: workspace.title,
      path: workspace.path,
    }))
  }

  /** Open the host's native directory picker (resolves the chosen path). */
  const pickWorkspace = (): Promise<string | null> => ctx.workspaces.pickDirectory()

  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'worktrees-badge',
    order: 10,
    locale: NS,
    inject: (): WorktreesBadgeInjected => ({
      summary: (sid: SessionId) => remote.summary(sid),
      open: (mode) => { controller.open(mode) },
      openLocalFiles: (start: string) => { controller.openLocalFiles(start) },
    }),
  }, WorktreesBadge))

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'worktrees-drawer',
    order: 130,
    locale: NS,
    store: createWorktreesStore,
    inject: (actions): WorktreesDrawerInjected => {
      controller.attachDrawer(actions)
      return {
        fetchSummary: (sid: SessionId) => remote.summary(sid),
        fetchChanges: (sid: SessionId) => remote.changes(sid),
        fetchRepoFiles: (sid: SessionId) => remote.repoFiles(sid),
        fetchCommitLog: (sid: SessionId) => remote.commitLog(sid),
        fetchCommitFiles: (sid: SessionId, sha: string) => remote.commitFiles(sid, { sha }),
        fetchWorktrees: (sid: SessionId) => remote.listWorktrees(sid),
        switchWorktree: (sid: SessionId, path: string) => remote.switchWorktree(sid, { path }),
        directAgent: (sid: SessionId, path: string, branch: string | null) => remote.directAgent(sid, { path, branch }),
        fetchFileDiff: (sid: SessionId, request: FileDiffRequest) => remote.fileDiff(sid, request),
        fetchReadFile: (sid: SessionId, request: ReadFileRequest) => remote.readFile(sid, request),
        fetchReadFileAtCommit: (sid: SessionId, request: ReadFileAtCommitRequest) => remote.readFileAtCommit(sid, request),
        isLoopback: connection.isLoopback,
        hooks: { hostDescription: connection.hostDescription },
        openExternal: (path) => { openOnHost(path) },
        copyBranch: (branch: string) => writeClipboard(branch),
      }
    },
  }, WorktreesDrawer))

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'worktrees-local-files',
    order: 140,
    locale: NS,
    store: createLocalFilesStore,
    inject: (actions): LocalFilesDrawerInjected => {
      controller.attachLocalFiles(actions)
      return {
        listLocalDirectory: (request: ListLocalDirectoryRequest) => remote.listLocalDirectory(request),
        readLocalFile: (request: ReadLocalFileRequest) => remote.readLocalFile(request),
        listWorkspaces,
        pickWorkspace,
        isLoopback: connection.isLoopback,
        hooks: { hostDescription: connection.hostDescription },
        openExternal: (path) => { openOnHost(path) },
      }
    },
  }, LocalFilesDrawer))

  return async () => {
    await Promise.all(disposers.map(dispose => dispose()))
  }
}
