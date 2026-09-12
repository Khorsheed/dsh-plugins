/**
 * File-preview plugin, browser half: a pure additive surface over official
 * extension points only. It registers a page-type right-Sidebar tab (the
 * session's touched files as one full-height list, entered from the guide
 * page; in-workspace file clicks hand content preview to the official
 * document tab through the tab's `actions.openResource`), a switchable
 * change-history renderer in that document tab (the toolbar dropdown's
 * 「改动记录」 entry — the per-write diff stepping the official renderers
 * have no counterpart for), and a per-turn mutation card in the
 * `conversation.chat.turnTail` chain at default priority — the official
 * deliverables row elects first, so the card renders exactly the turns
 * official data misses (the bash captures the host half collects, S2). The
 * filePreview Remote is mounted here through the official `ctx.remote.$mount`
 * channel, so the plugin distributes as an independent package with no edits
 * to core packages. Composing this plugin out of cordis.yml removes every
 * surface it adds.
 *
 * Retired at the 0.1.5-rc.1 move (seam registry S1): the conversation.view
 * tab, the shell.overlay drawer, the mention capture-phase DOM interception,
 * and the turnTail `priority: -1` preemption — the right-Sidebar resource
 * routing (openResource + the tab-type registry) covers all three openings.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import { fileAddressFor, resolveWorkspacePath } from '@deepseek-ai/dsh-util-workspace-path'
import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
// Type-only: pulls the ctx.slots service merge.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the ctx.locale service merge.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the generated Remote API and ctx.remote merge.
import type {} from '@khorsheed/dsh-file-preview/remote'
// Type-only: pulls ui-chat's SlotMap merge ('conversation.chat.turnTail').
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ChatFileMentions } from '@deepseek-ai/dsh-client-ui-chat/client'
// Type-only: pulls the ctx.sidebarRight/ctx.sidebarRightTabs service merges.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
// Type-only: pulls the ctx.documentPreviews merge, the 'sidebar.right.tab.document'
// SlotMap seat, and DocumentPreviewProps.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/client'
import filePreviewRemote from '@khorsheed/dsh-file-preview/remote'
import { FilePreviewTab } from './FilePreviewTab.tsx'
import { FileHistoryBody } from './FileHistoryBody.tsx'
import { TurnFileRow } from './TurnFileRow.tsx'
import { createFilePreviewStore } from './file-preview-store.ts'
import { FILE_PREVIEW_ID, FILE_PREVIEW_KIND, filePreviewDefinition } from './definition.tsx'
import { FILE_HISTORY_ID, HISTORY_EXTENSIONS } from './history-definition.ts'
import { basename } from './path-utils.ts'
import { en, NS, zh } from './locales.ts'
import { wrapChatFileMentions } from './mentions-wrap.ts'
import { OpenInAppProbe, pickFileManager, pickIde } from './open-in-app.ts'
import { parentPath } from './path-utils.ts'
import { createTurnFilesLoader } from './turn-files-cache.ts'
import { selectTurnFiles } from './turn-files.ts'
import type { FilePreviewRemote, FilePreviewTabInjected, FilePreviewTurnRowInjected } from './contract.ts'

export { DiffHistory } from './DiffHistory.tsx'
export { FilePreviewTab, FileHistoryBody, TurnFileRow }
export { FILE_PREVIEW_ID, FILE_PREVIEW_KIND, FILE_HISTORY_ID }

/** Required services: slots, sessions (cwd for the row gestures), the remote
 * channel, the locale, and the right-Sidebar faces (tab-type registry + the
 * navigation service the turn card's outside-workspace gesture opens pages
 * through). The
 * `remote.filePreview` namespace is deliberately NOT an inject: this plugin
 * both mounts the namespace (through `$mount` below) and consumes it, and the
 * Cordis property proxy only resolves services declared in `inject` or
 * provided by an ancestor fiber. Declaring it would deadlock the loader (the
 * fiber waits for the service, which only this apply's `$mount` can provide);
 * the property proxy cannot see the sibling namespace fiber `$mount` spawns.
 * The mount is awaited and the namespace is then read back from the global
 * store with `ctx.get`, which resolves any active provider in the same
 * isolation scope. */
export const inject = ['slots', 'sessions', 'remote', 'locale', 'sidebarRight', 'sidebarRightTabs']

/**
 * Client plugin body: mount the Remote, register the dictionaries, the tab
 * type, its body, and the per-turn file row.
 * @param ctx - client root context.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const disposers: Array<() => Promise<void>> = []
  try {
    disposers.push(await ctx.remote.$mount(filePreviewRemote))
  } catch (error) {
    // A duplicate descriptor is a composition error. The capability probe
    // below still decides whether any visible surface may exist.
    /* v8 ignore next -- double-mount is a composition error, not a runtime path */
    ctx.logger.error(error)
  }
  // The namespace is registered by $mount above; `ctx.remote.filePreview`
  // cannot see it (the property proxy walks the fiber chain, and the namespace
  // lives in the sibling fiber $mount spawned), so read it from the global
  // store once the mount has settled and hand the concrete handle to the
  // inject closures, so a lazy `ctx.remote.filePreview` read at call time
  // never trips the property proxy.
  const remote = ctx.get('remote.filePreview') as FilePreviewRemote | undefined
  if (remote === undefined) {
    return async () => { await Promise.all(disposers.map(dispose => dispose())) }
  }
  try {
    const capabilities = await remote.capabilities()
    if (!capabilities.ok || capabilities.value.protocolVersion !== 1) {
      return async () => { await Promise.all(disposers.map(dispose => dispose())) }
    }
  } catch {
    return async () => { await Promise.all(disposers.map(dispose => dispose())) }
  }
  const uninstall = installFilePreviewSurfaces(ctx, remote)
  return async () => {
    await uninstall()
    await Promise.all(disposers.map(dispose => dispose()))
  }
}

/**
 * Install every visible file-preview client surface after a successful host
 * handshake. Tests can drive this boundary directly; disposal removes the
 * dictionaries, tab type/body, turn row, mention wrapper, and history face.
 */
export function installFilePreviewSurfaces(
  ctx: Context,
  remote: FilePreviewRemote,
): () => Promise<void> {
  const disposers: Array<() => void | Promise<void>> = []
  disposers.push(ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-file-preview: dictionaries'))
  const t = ctx.locale.bind(NS)
  // The turn card's host-fed loader: one RPC warms every turn rendered so far
  // (the host returns the whole per-turn map, cached by the log watermark).
  const turnFilesLoader = createTurnFilesLoader(remote)

  // S1 tail: route prose-mention opens into the sidebar too. The wrap is
  // in-place on ui-deliverables' provided object (see mentions-wrap.ts for
  // why not provide/set). Ordering cannot ride the package edge alone — cordis
  // only re-wakes fibers that DECLARE the service in `inject`
  // (vendor/cordis reflect.ts notify), so a one-shot `ctx.get` here races the
  // deliverables fiber's provide. A nested plugin whose inject names
  // 'chatFileMentions' stays pending until the service appears (and re-runs on
  // HMR re-provide, re-wrapping); in compositions without ui-deliverables it
  // simply never activates, without blocking this plugin.
  const mentionsFiber = ctx.plugin({
    name: '@khorsheed/dsh-client-ui-file-preview/mentions-wrap',
    inject: ['chatFileMentions'],
    apply: (sub: Context) => {
      wrapChatFileMentions((sub as unknown as { chatFileMentions: ChatFileMentions }).chatFileMentions, {
        // Mentions open at the canonical file address — the same
        // `dsh-resource://file/session/<id>/<path>` content id the
        // deliverables card's open resolves to, so one file is one tab (the
        // page address `sidebar://file-preview` would mint a second tab for
        // the same file). Our type claims the renderable ones; the rest fall
        // through to the official document tab. A throw (no mounted sidebar
        // surface) falls back to the owner's openFile inside the wrap.
        open: (sessionId, path) => {
          ctx.sidebarRight.openResource(fileAddressFor(sessionId, sessionCwd(sessionId as SessionId), path))
        },
        label: (path) => t('mention.open', { name: basename(path) }),
      })
    },
  })
  disposers.push(() => mentionsFiber.dispose())

  // Row gestures: copy always works (clipboard needs no host capability);
  // folder/IDE gestures key off the once-per-page open-in-app probe — a host
  // without the route (or a failed probe) reads as "no apps" and the buttons
  // stay hidden. Folder open keeps the old drawer's semantics: reveal the
  // file selected in the host file manager (host Remote), falling back to the
  // official open route on the parent folder. IDE open is file-exact, which
  // the official route refuses (directories only) — it rides the host half's
  // `openExternal` instead.
  const sessions: ISessions = ctx.sessions
  const openInApps = new OpenInAppProbe()
  const sessionCwd = (sessionId: SessionId): string | undefined =>
    sessions.list.getSnapshot().byId[sessionId]?.cwd
  const revealFolder = (sessionId: SessionId, path: string): void => {
    const resolved = resolveWorkspacePath(sessionCwd(sessionId), path)
    const fallback = (): void => {
      const fileManager = pickFileManager(openInApps.apps.getSnapshot() ?? [])
      if (fileManager !== undefined) void openInApps.open(fileManager, parentPath(resolved) || '.')
    }
    void remote.reveal(sessionId, path).then((result) => {
      if (result.ok && result.value.revealed) return
      fallback()
    }).catch(fallback)
  }
  const openInIde = (sessionId: SessionId, path: string, app?: string): void => {
    const ide = app ?? pickIde(openInApps.apps.getSnapshot() ?? [])
    if (ide === undefined) return
    void remote.openExternal(sessionId, path, ide).catch(() => {
      // A launch failure stays silent in the row; the native app surfaces its
      // own error dialog when the path is unusable.
    })
  }

  // Stage one of the right-Sidebar registration: the tab type (guide entry
  // PLUS address claims — `dsh-resource://file/**` for every session-scoped
  // path the preview stack renders; see definition.tsx). The default band is
  // 'extension', outranking the official document tab's 'fallback'.
  disposers.push(ctx.effect(() => ctx.sidebarRightTabs.register(filePreviewDefinition(t)), 'ui-file-preview: tab type'))

  // Stage two: the body under the type's id in the keyed pane seat.
  disposers.push(ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: FILE_PREVIEW_ID,
    locale: NS,
    store: createFilePreviewStore,
    inject: (sessionId: SessionId): FilePreviewTabInjected => ({
      listFiles: (sid: SessionId) => remote.list(sid),
      readFile: (sid: SessionId, path: string) => remote.read(sid, path),
      copyPath: (path: string) => writeClipboard(resolveWorkspacePath(sessionCwd(sessionId), path)),
      revealFolder: (path: string) => { revealFolder(sessionId, path) },
      openInIde: (path: string, app?: string) => { openInIde(sessionId, path, app) },
      loadOpenInApps: () => { void openInApps.load() },
      hooks: { openInApps: openInApps.apps },
    }),
  }, FilePreviewTab)), 'ui-file-preview: tab body'))

  disposers.push(ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
    name: 'conversation.chat.turnTail',
    // Priority -1: the chain elects the first non-null select in ASCENDING
    // priority order (ui-slots ChainSelect contract), and the official
    // deliverables entry carries the default 0 — so this card claims every
    // turn and the official row never mounts while this plugin is composed.
    // Deliberate product decision (2026-09-11): the turn's compact product
    // table REPLACES the official deliverables row (its presented card never
    // collapses and its spacing reads wrong); the S1-era preemption returns
    // in table form.
    priority: -1,
    select: selectTurnFiles,
    locale: NS,
    inject: (): FilePreviewTurnRowInjected => ({
      turnFiles: (sessionId: SessionId, turn: number) => turnFilesLoader(sessionId, turn),
    }),
  }, TurnFileRow)))

  // The change-history document renderer: metadata into the registry, the
  // body into the keyed document seat. `priority: 'builtin'` keeps the
  // official renderer the default (an extension band would take it over);
  // the toolbar dropdown lists every match regardless.
  // A one-shot `ctx.get` here races the documentpreview fiber's provide —
  // cordis only re-wakes fibers that declare a service in `inject` — so the
  // registrations live in a nested plugin pended on the service; in a
  // composition without document previews it simply never activates.
  const historyFiber = ctx.plugin({
    name: '@khorsheed/dsh-client-ui-file-preview/history-renderer',
    inject: ['documentPreviews'],
    apply: (sub: Context) => {
      const previews = sub.documentPreviews
      sub.effect(() => previews.register({
        id: FILE_HISTORY_ID,
        extensions: HISTORY_EXTENSIONS,
        priority: 'builtin',
        title: () => t('history.title'),
        // The body never touches the owner's prepared content — the diffs come
        // from the filePreview fold — so the cheapest delivery mode applies.
        loading: 'text-pages',
      }), 'ui-file-preview: history renderer metadata')
      sub.effect(() => sub.slots.inject('sidebar.right.tab.document', () => sub.slots.register(
        {
          name: 'sidebar.right.tab.document',
          key: FILE_HISTORY_ID,
          locale: NS,
          inject: (): Pick<FilePreviewTabInjected, 'listFiles'> => ({
            listFiles: (sid: SessionId) => remote.list(sid),
          }),
        },
        FileHistoryBody,
      )), 'ui-file-preview: history renderer body')
    },
  })
  disposers.push(() => historyFiber.dispose())

  return async () => {
    for (const dispose of disposers.reverse()) await dispose()
  }
}
