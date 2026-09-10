/**
 * Local-files plugin, browser half: a git-agnostic file browser over any
 * local directory, defaulting to the session's workspace. It mounts the
 * localFiles Remote through the official `ctx.remote.$mount` channel and
 * surfaces the browser once: on hosts with the right Sidebar (0.1.5+), as a
 * page-type `sidebar.right.pane.tab` entry that takes over the official files
 * kind (the registry's extension-over-builtin shadowing, so the guide shows
 * one files card: ours). The registration lives in a nested plugin pended on
 * `sidebarRightTabs`, so a composition without the right Sidebar simply never
 * activates it and the plugin contributes no browser surface there. (The
 * `conversation.view` tab entry was retired 2026-09-10 — the sidebar tab is
 * the single surface.)
 *
 * @module @khorsheed/dsh-local-files/client
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the ctx.slots service merge.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the ctx.locale service merge.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the generated Remote API and ctx.remote merge.
import type {} from '@khorsheed/dsh-local-files/remote'
// Type-only: pulls the ctx.sidebarRightTabs service merge and the
// right-Sidebar SlotMap seat ('sidebar.right.pane.tab').
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import localFilesRemote from '@khorsheed/dsh-local-files/remote'
import type {
  ListLocalDirectoryRequest, ReadLocalFileRequest,
} from '../types.ts'
import { WorkspaceView } from './WorkspaceView.tsx'
import type {
  LocalFilesRemote, WorkspaceViewInjected,
} from './contract.ts'
import { LOCAL_FILES_TAB_ID, localFilesDefinition } from './definition.tsx'
import { en, NS, zh } from './locales.ts'
import { OpenInAppProbe, pickFileManager, pickIde } from './open-in-app.ts'
import { createLocalFilesStore } from './store-local.ts'

export { WorkspaceView }
export { LOCAL_FILES_KIND, LOCAL_FILES_TAB_ID } from './definition.tsx'

/** Required services: the remote channel and the locale (the sidebar seat is reached through the nested plugin below). */
export const inject = ['remote', 'locale']

/**
 * Client plugin body: mount the Remote, register the dictionaries, and the
 * sidebar files tab.
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

  // The external-open gestures ride the official open-in-app routes (host
  // 0.1.5): one apps probe decides their visibility — a host without the
  // routes publishes an empty list and the gestures stay hidden.
  const openInApp = new OpenInAppProbe()
  void openInApp.load()
  const openWith = (pick: (apps: readonly string[]) => string | undefined) => (path: string): void => {
    const app = pick(openInApp.apps.getSnapshot() ?? [])
    if (app === undefined) return
    void openInApp.open(app, path)
  }

  /** Open the host's native directory picker (resolves the chosen path). */
  const pickWorkspace = async (): Promise<string | null> => {
    // 0.1.2 moved the native directory picker to the directoryPicker Remote
    // namespace. Property access (`ctx.remote.directoryPicker`) goes through
    // the context proxy's inject guard and throws "without inject" for a
    // plugin that does not declare the namespace — declaring it would instead
    // pend the whole plugin on hosts whose composition has no directory
    // picker. `ctx.get` reads the root store without the inject requirement
    // and yields undefined there, so the gesture degrades to null
    // (cancelled-shaped) instead of either failure mode.
    const picker = ctx.get('remote.directoryPicker') as {
      pick(): Promise<{ ok: boolean; value?: string | null; error?: { message: string } }>
    } | undefined
    if (picker === undefined) return null
    const result = await picker.pick()
    if (!result.ok) throw new Error(result.error?.message ?? 'directory picker failed')
    return result.value ?? null
  }

  /** The injected business face — identical for every surface the browser mounts on. */
  const browserFace = (): WorkspaceViewInjected => ({
    listDirectory: (request: ListLocalDirectoryRequest) => remote.listDirectory(request),
    readFile: (request: ReadLocalFileRequest) => remote.readFile(request),
    pickWorkspace,
    hooks: { openInApps: openInApp.apps },
    openFolder: openWith(pickFileManager),
    openIDE: openWith(pickIde),
  })

  // The right-Sidebar entry (0.1.5+). A nested plugin pended on
  // `sidebarRightTabs` — cordis only re-wakes fibers that declare a service
  // in `inject`, and a composition without the right Sidebar (hosts before
  // 0.1.5) never provides it, so the registration simply never activates
  // there instead of pending the whole plugin. The kind is the official
  // files type's own: the registry admits one extension per builtin kind and
  // puts the extension in force — the guide lists only in-force types, so
  // the official 工作区文件 card is shadowed (never doubled) and resumes if
  // this plugin unregisters.
  ctx.plugin({
    name: '@khorsheed/dsh-local-files/sidebar-tab',
    inject: ['sidebarRightTabs'],
    apply: (sub: Context) => {
      sub.effect(() => sub.sidebarRightTabs.register(localFilesDefinition(t)), 'local-files: tab type')
      sub.effect(() => sub.slots.inject('sidebar.right.pane.tab', () => sub.slots.register({
        name: 'sidebar.right.pane.tab',
        key: LOCAL_FILES_TAB_ID,
        locale: NS,
        store: createLocalFilesStore,
        inject: browserFace,
      }, WorkspaceView)), 'local-files: sidebar tab body')
    },
  })

  return async () => {
    await Promise.all(disposers.map(dispose => dispose()))
  }
}
