/**
 * Worktrees plugin, browser half: a per-session branch/worktree capsule in
 * the session header (`conversation.session.header.utilities`, repo sessions
 * only), a right-Sidebar page tab (`sidebar.right.pane.tab`, registered
 * through the official two-stage path: the `worktrees` type into
 * `ctx.sidebarRightTabs`, the body into the keyed seat under the type's id)
 * with the worktree-pending / repository-commits / repository-files views
 * behind the badge's branch capsule, and a frame-wide local-files browser
 * (`shell.overlay`). The worktree-pending view lists the currently selected
 * worktree's full uncommitted set (the switcher repoints the session's
 * active worktree and refreshes, so the list follows it). The worktrees
 * Remote is mounted here through the official
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
 * The badge used to carry a second folder capsule opening a local-files
 * browser from the header; 2026-09-10 the workspace capsule left the header.
 * That browser surface is gone entirely as of 2026-09-23 — it had no opener
 * left, and file browsing is @khorsheed/dsh-local-files' job (proposal
 * preview-kernel).
 *
 * The external-open gestures (show in folder) ride the official open-in-app
 * host routes (0.1.5): a once-per-page probe of GET /open-in-app/apps decides
 * visibility, and the gesture POSTs /open-in-app/open with a directory path.
 * @module @khorsheed/dsh-worktrees/client
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
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
  FileDiffRequest, PluginInventorySnapshot,
  ReadFileAtCommitRequest, ReadFileRequest,
  ReadRepoImageRequest,
} from '../types.ts'
import { WorktreesBadge } from './Badge.tsx'
import { WorktreesTab } from './WorktreesTab.tsx'
import type {
  WorktreesBadgeInjected, WorktreesTabInjected, WorktreesRemote,
} from './contract.ts'
import { WORKTREES_KIND, WORKTREES_TAB_ID, worktreesDefinition } from './definition.tsx'
import { en, NS, zh } from './locales.ts'
import { OpenInAppProbe } from '@khorsheed/dsh-client-ui-content-preview/src/client/index.ts'
import { WorktreesController } from './panel-service.ts'
import { RegistrationToggle, WorktreesTabVisibility } from './preset-visibility.ts'
import { createWorktreesStore, type DrawerMode } from './store.ts'

export { WorktreesBadge, WorktreesTab, WorktreesController }
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
export const inject = ['slots', 'remote', 'locale', 'sessions', 'sidebarRight', 'sidebarRightTabs']

/**
 * Client plugin body: mount the Remote, register the dictionaries, the tab
 * type and its body, plus the session-header badge.
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
  // The OFFICIAL pluginInventory namespace, probed the taskpilot way: through
  // ctx.get, not the ctx.remote proxy — declaring 'remote.pluginInventory' in
  // inject would pend the whole client on a host without it, and the badge's
  // composition criterion must degrade to fail-open there instead. Undefined
  // on such hosts (and on every pre-0.1.5 line); the badge skips the fetch
  // and keeps its visiblePresets/fail-open semantics.
  const pluginInventory = ctx.get('remote.pluginInventory') as {
    list: () => Promise<RemoteResult<PluginInventorySnapshot>>
  } | undefined
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


  // Stage one of the right-Sidebar registration: the page type itself (guide
  // entry, no address claims). The default band is 'extension', correct for a
  // type shipped from outside the product. The type registers exactly while
  // the current session's preset composition grants the companion tool row —
  // the registration-level sibling of the badge's gate (the guide enumerates
  // registrations, so hidden means NOT registered; an opened tab is stored
  // per session and a kind with no registrant renders the host's designed
  // tab.unavailable fallback).
  const tabVisibility = new WorktreesTabVisibility(ctx, pluginInventory, () => remote.badgeConfig())
  ctx.effect(() => {
    const toggle = new RegistrationToggle(
      () => ctx.sidebarRightTabs.register(worktreesDefinition(t)),
      () => tabVisibility.show(ctx.sessions.list.getSnapshot().current),
    )
    toggle.setReady(true)
    const unsubscribe = tabVisibility.subscribe(() => { toggle.sync() })
    return () => { unsubscribe(); toggle.setReady(false) }
  }, 'worktrees: tab type visibility')

  // Stage two: the body under the type's id in the keyed pane seat.
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: WORKTREES_TAB_ID,
    locale: NS,
    store: createWorktreesStore,
    inject: (): WorktreesTabInjected => ({
      fetchSummary: (sid: SessionId) => remote.summary(sid),
      fetchChanges: (sid: SessionId) => remote.changes(sid),
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
      copyText: (text: string) => writeClipboard(text),
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
      ...(pluginInventory === undefined ? {} : { fetchComposition: () => pluginInventory.list() }),
      open: (mode) => { controller.open(mode) },
      subscribeVersion: (listener) => controller.subscribeVersion(listener),
      getVersion: () => controller.getVersion(),
    }),
  }, WorktreesBadge))

  return async () => {
    await Promise.all(disposers.map(dispose => dispose()))
  }
}
