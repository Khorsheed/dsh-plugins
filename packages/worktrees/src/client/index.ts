/**
 * Worktrees plugin, browser half: a per-session branch/worktree capsule in
 * the session header (`conversation.session.header.utilities`, repo sessions
 * only), a right-Sidebar page tab (`sidebar.right.pane.tab`, registered
 * through the official two-stage path: the `worktrees` type into
 * `ctx.sidebarRightTabs`, the body into the keyed seat under the type's id)
 * with the session-changes / repository-commits / repository-files views
 * behind the badge's branch capsule, and a frame-wide local-files browser
 * (`shell.overlay`). The session-changes view lists the git uncommitted files
 * this session touched, filtered through the sibling file-preview fold's
 * `list` when that plugin is present (probed via `ctx.get`, never a
 * dependency; absent → every uncommitted file shows, the pre-filter
 * behavior). The worktrees Remote is mounted here through the official
 * `ctx.remote.$mount` channel, so the plugin distributes as an independent
 * package with no edits to core packages. Composing this plugin out of cordis.yml removes every
 * surface it adds.
 *
 * The badge deliberately stays in the utilities list slot: the 0.1.5 header
 * corner (`conversation.session.header.corner`) is a single slot the shipped
 * web composition already occupies with ui-sidebar-right's ExpandButton, and
 * single-slot semantics are shadowing (a different priority replaces the
 * occupant; the same priority throws at registration) — there is no
 * coexistence, so evicting the official way back into a collapsed sidebar
 * would be the only way in.
 *
 * The badge used to carry a second folder capsule opening the local-files
 * browser from the header; 2026-09-10 the workspace capsule left the header
 * (file browsing converged on the sidebar / conversation-tab entries). The
 * browser surface itself stays mounted — it keeps the workspace switcher and
 * the native directory picker (`pickWorkspace`), so no capability is lost.
 *
 * The external-open gestures (show in folder) ride the official open-in-app
 * host routes (0.1.5): a once-per-page probe of GET /open-in-app/apps decides
 * visibility, and the gesture POSTs /open-in-app/open with a directory path.
 * @module @khorsheed/dsh-worktrees/client
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the ctx.workspaces service merge.
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
// Type-only: pulls the ctx.slots service merge.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the ctx.locale service merge.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the generated Remote API and ctx.remote merge.
import type {} from '@khorsheed/dsh-worktrees/remote'
// Type-only: pulls ui-conversation's SlotMap merge
// ('conversation.session.header.utilities').
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the ui-layout frame's SlotMap merge ('shell.overlay').
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls the ctx.sidebarRight/ctx.sidebarRightTabs service merges
// and the right-Sidebar SlotMap seats ('sidebar.right.pane.tab').
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import worktreesRemote from '@khorsheed/dsh-worktrees/remote'
import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  FileDiffRequest, ListLocalDirectoryRequest, ReadFileAtCommitRequest, ReadFileRequest,
  ReadLocalFileRequest, ReadLocalImageRequest, ReadRepoImageRequest,
} from '../types.ts'
import { WorktreesBadge } from './Badge.tsx'
import { WorktreesTab } from './WorktreesTab.tsx'
import { LocalFilesDrawer } from './LocalFilesDrawer.tsx'
import type {
  FilePreviewListProbe,
  LocalFilesDrawerInjected, WorktreesBadgeInjected, WorktreesTabInjected, WorktreesRemote,
} from './contract.ts'
import { WORKTREES_KIND, WORKTREES_TAB_ID, worktreesDefinition } from './definition.tsx'
import { en, NS, zh } from './locales.ts'
import { OpenInAppProbe } from './open-in-app.ts'
import { WorktreesController } from './panel-service.ts'
import { createLocalFilesStore } from './store-local.ts'
import { createWorktreesStore, type DrawerMode } from './store.ts'

export { WorktreesBadge, WorktreesTab, LocalFilesDrawer, WorktreesController }
export { WORKTREES_KIND, WORKTREES_TAB_ID }

/** Required services: slots, sessions, the remote channel, the locale, and
 * the right-Sidebar faces (tab-type registry + the navigation service the
 * badge opens pages through).
 * `remote.worktrees` is deliberately NOT an inject: this plugin both mounts
 * the namespace (through `$mount` below) and consumes it, and the Cordis
 * property proxy only resolves services declared in `inject` or provided by
 * an ancestor fiber — declaring it would deadlock the loader. The mount is
 * awaited and the namespace is then read back from the global store with
 * `ctx.get` (the ui-file-preview precedent). */
export const inject = ['slots', 'remote', 'locale', 'sessions', 'workspaces', 'sidebarRight', 'sidebarRightTabs']

/**
 * Open the host's native directory picker (0.1.5: the ui-workspace face).
 * Absence resolves null — the picker-cancel value.
 * @param ctx - client root context.
 * @returns the chosen path, or null on cancel/unavailable.
 */
function pickHostDirectory(ctx: Context): Promise<string | null> {
  const uiWorkspace = ctx.get('uiWorkspace') as { pickDirectory(): Promise<string | null> } | undefined
  return uiWorkspace?.pickDirectory() ?? Promise.resolve(null)
}

/**
 * Client plugin body: mount the Remote, register the dictionaries, the tab
 * type and its body, the session-header badge, and the local-files browser.
 * @param ctx - client root context.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const disposers: Array<() => Promise<void>> = []
  try {
    disposers.push(await ctx.remote.$mount(worktreesRemote))
  } catch (error) {
    // A Remote already mounted by another composition fails loud at boot; the
    // rest of the plugin still registers (the badge renders an unmounted
    // namespace's typed RPC error, and the tab surfaces it).
    /* v8 ignore next -- double-mount is a composition error, not a runtime path */
    ctx.logger.error(error)
  }
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'worktrees: dictionaries')
  const t = ctx.locale.bind(NS)
  const remote = ctx.get('remote.worktrees') as WorktreesRemote
  // Optional sibling face: the file-preview fold's session-touched list feeds
  // the session-changes filter. A peer community package, probed through the
  // global store — absent (not installed) the probe is undefined and the tab
  // shows every uncommitted file (the pre-filter behavior).
  const filePreview = ctx.get('remote.filePreview') as FilePreviewListProbe | undefined
  // The once-per-page open-in-app probe; kicks off at apply and publishes
  // through a snapshot store the surfaces bind as a hook.
  const openInApp = new OpenInAppProbe()
  void openInApp.load()
  // The badge's branch capsule opens the page through the official navigation
  // face; a throw (no mounted session surface) degrades to nothing rather
  // than breaking the header.
  const controller = new WorktreesController((mode: DrawerMode) => {
    try {
      ctx.sidebarRight.openTab(WORKTREES_KIND, { params: { mode } })
    } catch (error) {
      ctx.logger.warn('worktrees: openTab failed', error)
    }
  })

  const openOnHost = (appId: string, path: string): void => {
    void openInApp.open(appId, path).catch(() => {
      // Host/OS open failures stay silent in the surface; the native app
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
  const pickWorkspace = (): Promise<string | null> => pickHostDirectory(ctx)

  // Stage one of the right-Sidebar registration: the page type itself (guide
  // entry, no address claims). The default band is 'extension', correct for a
  // type shipped from outside the product.
  ctx.effect(() => ctx.sidebarRightTabs.register(worktreesDefinition(t)), 'worktrees: tab type')

  // Stage two: the body under the type's id in the keyed pane seat.
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: WORKTREES_TAB_ID,
    locale: NS,
    store: createWorktreesStore,
    inject: (): WorktreesTabInjected => ({
      fetchSummary: (sid: SessionId) => remote.summary(sid),
      fetchChanges: (sid: SessionId) => remote.changes(sid),
      // Fail-open on every absence: no sibling, or a failed read, both read
      // as "no filter" — the session-changes tab then lists every
      // uncommitted file, exactly the pre-filter behavior.
      fetchSessionTouched: async (sid: SessionId) => {
        if (filePreview === undefined) return null
        const result = await filePreview.list(sid).catch(() => null)
        if (result === null || !result.ok) return null
        return result.value.entries.filter(entry => entry.op !== 'read').map(entry => entry.path)
      },
      fetchRepoFiles: (sid: SessionId) => remote.repoFiles(sid),
      fetchCommitLog: (sid: SessionId) => remote.commitLog(sid),
      fetchCommitFiles: (sid: SessionId, sha: string) => remote.commitFiles(sid, { sha }),
      fetchWorktrees: (sid: SessionId) => remote.listWorktrees(sid),
      switchWorktree: (sid: SessionId, path: string) => remote.switchWorktree(sid, { path }),
      bumpVersion: () => { controller.bumpVersion() },
      directAgent: (sid: SessionId, path: string, branch: string | null) => remote.directAgent(sid, { path, branch }),
      fetchFileDiff: (sid: SessionId, request: FileDiffRequest) => remote.fileDiff(sid, request),
      fetchReadFile: (sid: SessionId, request: ReadFileRequest) => remote.readFile(sid, request),
      fetchReadFileAtCommit: (sid: SessionId, request: ReadFileAtCommitRequest) => remote.readFileAtCommit(sid, request),
      fetchReadRepoImage: (sid: SessionId, request: ReadRepoImageRequest) => remote.readRepoImage(sid, request),
      hooks: { openInApp: openInApp.apps },
      openExternal: openOnHost,
      copyBranch: (branch: string) => writeClipboard(branch),
    }),
  }, WorktreesTab)), 'worktrees: tab body')

  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'worktrees-badge',
    // Leftmost utility: list slots sort by priority asc, then order asc, then
    // registration sequence (ui-slots src/index.ts). Neighbors: the official
    // open-in-app split button at order -10, the official session-log-export
    // "…" menu at order 0 (its registration is upstream and NOT movable from
    // here), message-timeline at 100.
    order: -20,
    locale: NS,
    inject: (): WorktreesBadgeInjected => ({
      summary: (sid: SessionId) => remote.summary(sid),
      fetchBadgeConfig: () => remote.badgeConfig(),
      open: (mode) => { controller.open(mode) },
      subscribeVersion: (listener) => controller.subscribeVersion(listener),
      getVersion: () => controller.getVersion(),
    }),
  }, WorktreesBadge))

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
        readLocalImage: (request: ReadLocalImageRequest) => remote.readLocalImage(request),
        listWorkspaces,
        pickWorkspace,
        hooks: { openInApp: openInApp.apps },
        openExternal: openOnHost,
      }
    },
  }, LocalFilesDrawer))

  return async () => {
    await Promise.all(disposers.map(dispose => dispose()))
  }
}
