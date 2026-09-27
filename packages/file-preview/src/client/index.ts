/**
 * File-preview plugin, browser half: a pure additive surface over official
 * extension points only. It registers a page-type right-Sidebar tab (the
 * session's touched files as one full-height list, entered from the guide
 * page), claiming `dsh-resource://file/**` addresses the preview stack renders
 * at the extension band — which outranks the official document tab's fallback
 * band on BOTH host lines (the rc.1 tab registry kept the band mechanism), so
 * file clicks (the file tree, wrapped mentions, the turn card, the
 * deliverables row) land in this package's own page with its full chrome;
 * suffixes the stack declines (pdf, archives, binaries) fall through to the
 * official document tab. A per-turn mutation card sits in the
 * `conversation.chat.turnTail` slot (the bash captures the host half
 * collects, S2). The filePreview Remote is mounted here through the official
 * `ctx.remote.$mount` channel, so the plugin distributes as an independent
 * package with no edits to core packages. Composing this plugin out of
 * cordis.yml removes every surface it adds.
 *
 * Plan B — registering the content pane INTO the official document tab as its
 * default renderer (rc.1's `documentPreviews` registry) plus the headless
 * embedding of phase two — landed and was VETOED by the repo owner the same
 * day (2026-09-24): the seam cost (the renderer loading protocol, the
 * extension-band takeover semantics, the headless layout coupling) and the UX
 * compromises (change history demoted to the renderer dropdown, the copy
 * button floating over the search row) lost to the self-drawn page, which the
 * address claim restores wholesale. The turn-tail convergence survives the
 * veto and stays: on list-kind hosts (0.1.6-alpha.2+) the arm also shadows
 * the official deliverables entry (a second registration under its cell id at
 * `priority: -1` whose empty body wins the cell — the slot system's
 * first-class shadowing; the official entry stays on the ledger so its
 * declared `deliverables.file.actions` child slot never collapses), because
 * the official present card duplicates our durable row with a model-curated
 * subset and the official changes card is memory-resident. On a 0.1.5 host
 * the slot is still the election chain; the registration probes the
 * declaration kind and keeps the old preemptive shape (select + priority -1)
 * there.
 *
 * Retired at the 0.1.5-rc.1 move (seam registry S1): the conversation.view
 * tab, the shell.overlay drawer, and the mention capture-phase DOM
 * interception — the right-Sidebar resource routing (openResource + the
 * tab-type registry) covers all three openings. Retired with the plan-B
 * revert (2026-09-24): the change-history renderer in the official document
 * tab's dropdown (FileHistoryBody) — the change history lives only in this
 * page's detail view again (the Content / 改动记录 toggle).
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
import filePreviewRemote from '@khorsheed/dsh-file-preview/remote'
import { FilePreviewTab } from './FilePreviewTab.tsx'
import { TurnFileRow } from './TurnFileRow.tsx'
import { createFilePreviewStore } from './file-preview-store.ts'
import { FILE_PREVIEW_ID, FILE_PREVIEW_KIND, filePreviewDefinition } from './definition.tsx'
import { basename } from './path-utils.ts'
import { en, NS, zh } from './locales.ts'
import { wrapChatFileMentions } from './mentions-wrap.ts'
import { OpenInAppProbe, pickFileManager, pickIde } from './open-in-app.ts'
import { parentPath } from './path-utils.ts'
import { createTurnFilesLoader } from './turn-files-cache.ts'
import { selectTurnFiles } from './turn-files.ts'
import type { FilePreviewRemote, FilePreviewTabInjected, FilePreviewTurnRowInjected } from './contract.ts'

export { DiffHistory } from './DiffHistory.tsx'
export { FilePreviewTab, TurnFileRow }
export { FILE_PREVIEW_ID, FILE_PREVIEW_KIND }

/** The official deliverables card's turnTail cell id — the shadow target. */
const DELIVERABLES_TURN_ENTRY = '@deepseek-ai/dsh-client-ui-deliverables'

/**
 * The deliverables shadow: the empty body that wins the official card's list
 * cell at a lower priority, so the present/changes cards stop rendering while
 * the official registration (and the child slot it declares) stays live.
 */
function DeliverablesShadow(): null {
  return null
}

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
  // lives in the sibling fiber $mount spawned), so read it back from the global
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
 * dictionaries, the tab type/body, the turn row and its deliverables shadow,
 * and the mention wrapper.
 */
export function installFilePreviewSurfaces(
  ctx: Context,
  remote: FilePreviewRemote,
): () => Promise<void> {
  const disposers: Array<() => void | Promise<void>> = []
  disposers.push(ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'file-preview: dictionaries'))
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
    name: '@khorsheed/dsh-file-preview/mentions-wrap',
    inject: ['chatFileMentions'],
    apply: (sub: Context) => {
      wrapChatFileMentions((sub as unknown as { chatFileMentions: ChatFileMentions }).chatFileMentions, {
        // Mentions open at the canonical file address — the same
        // `dsh-resource://file/session/<id>/<path>` content id the
        // deliverables card's open resolves to, so one file is one tab (the
        // page address `sidebar://file-preview` would mint a second tab for
        // the same file). Our type claims the renderable ones on both host
        // lines; the rest fall through to the official document tab. A throw
        // (no mounted sidebar surface) falls back to the owner's openFile
        // inside the wrap.
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
  // path the preview stack renders; see definition.tsx). Unconditional on
  // both host lines: the default 'extension' band outranks the official
  // document tab's 'fallback'.
  disposers.push(ctx.effect(() => ctx.sidebarRightTabs.register(filePreviewDefinition(t)), 'file-preview: tab type'))

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
  }, FilePreviewTab)), 'file-preview: tab body'))

  // The turn card. Probe the declared slot kind inside inject (the callback
  // only runs once the slot exists): a 0.1.6-alpha.2+ host declares a LIST —
  // register a plain entry under the package id, plus the deliverables shadow
  // (the convergence, user decision 2026-09-24: the official present card
  // duplicates this row with a model-curated subset and the official changes
  // card is memory-resident, so only this row renders). The shadow is the
  // slot system's first-class mechanism, not a DOM hack: one cell (the
  // official entry's id), two entries at distinct priorities, the lowest
  // renders (ui-slots SlotCore.register pins the rule — a same-id
  // same-priority registration throws with "register at a different priority
  // to shadow it", and entriesOfSlot projects each cell to its lowest live
  // entry). The official entry stays registered — its declared
  // `deliverables.file.actions` child slot survives for ui-open-in-app's
  // contributions — it just never renders. The row itself returns null until
  // its fetch settles. A 0.1.5 host declares the election CHAIN — keep the
  // old preemptive shape (select claims every turn; priority -1 elects
  // ascending, ahead of the official entry's default 0). The alpha.2
  // KindOptions for this key carry no chain fields, so the chain-branch call
  // is duck-typed through `never` (the escape the spec bench already uses);
  // the list branch stays fully typed and is what checks TurnFileRow's props
  // contract.
  disposers.push(ctx.slots.inject('conversation.chat.turnTail', () => {
    const injectRow = (): FilePreviewTurnRowInjected => ({
      turnFiles: (sessionId: SessionId, turn: number) => turnFilesLoader(sessionId, turn),
    })
    const spec = ctx.slots.spec('conversation.chat.turnTail') as { kind?: string } | undefined
    if (spec?.kind === 'chain') {
      return ctx.slots.register({
        name: 'conversation.chat.turnTail',
        priority: -1,
        select: selectTurnFiles,
        locale: NS,
        inject: injectRow,
      } as never, TurnFileRow as never)
    }
    const row = ctx.slots.register({
      name: 'conversation.chat.turnTail',
      id: FILE_PREVIEW_ID,
      locale: NS,
      inject: injectRow,
    }, TurnFileRow)
    // Lower than the official entry's default 0, so the empty body wins the
    // cell; a same-priority second registration would throw instead.
    const shadow = ctx.slots.register({
      name: 'conversation.chat.turnTail',
      id: DELIVERABLES_TURN_ENTRY,
      priority: -1,
    }, DeliverablesShadow)
    return () => {
      row()
      shadow()
    }
  }))

  return async () => {
    for (const dispose of disposers.reverse()) await dispose()
  }
}
