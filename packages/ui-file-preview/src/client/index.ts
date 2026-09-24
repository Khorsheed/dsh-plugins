/**
 * File-preview plugin, browser half: a pure additive surface over official
 * extension points only. Two content faces, one per host line:
 *
 * - 0.1.7-rc.1 (the official `documentPreviews` pane exists): the content
 *   preview registers INTO the official document tab as its default renderer
 *   (the shared content pane in headless mode — the frame owns the chrome —
 *   extension band, FileContentBody), alongside the change-history renderer
 *   (builtin band, one dropdown away). File clicks (file tree, wrapped
 *   mentions, the turn card, the artifacts shell) route to the official
 *   document tab through its fallback-band claim; the self-drawn
 *   `file-preview` content tab type is NOT registered — the session-products
 *   entry it carried returns as the `file-artifacts` LIST SHELL (rows open
 *   through the official resource route; the shell draws no content itself).
 * - 0.1.5 (no such pane): the self-drawn page-type right-Sidebar tab (the
 *   session's touched files as one full-height list, entered from the guide
 *   page) claims `dsh-resource://file/**` addresses the preview stack renders
 *   and hosts the same content pane in its detail view.
 *
 * The switch is a capability probe, never a version read: a point-in-time
 * `ctx.get('documentPreviews')` skips the legacy registration when the pane
 * already provides the service, and a nested plugin pended on
 * `inject: ['documentPreviews']` registers the rc.1 renderers and retires the
 * legacy tab when the pane arrives later (cordis 4.0.4's service-access guard
 * forbids an undeclared `ctx.documentPreviews` property read, and a static
 * inject would pend the whole plugin on 0.1.5 — the deferred-inject pattern of
 * local-agent's settings-scope). Both lines keep: the per-turn mutation card
 * in the `conversation.chat.turnTail` slot (the bash captures the host half
 * collects, S2) and the change-history dimension — the official
 * workspace-changes is memory-resident, git-only, and loses everything on a
 * host restart, so TurnFileRow/FileHistoryBody stay ours (tracked upstream).
 * The filePreview Remote is mounted here through the official
 * `ctx.remote.$mount` channel, so the plugin distributes as an independent
 * package with no edits to core packages. Composing this plugin out of
 * cordis.yml removes every surface it adds.
 *
 * turnTail re-kinded at 0.1.6-alpha.2 (chain election → list rendering):
 * the card registers a plain entry under the package id and self-hides on
 * turns without files. The list arm ALSO shadows the official deliverables
 * entry (user decision 2026-09-24: only this plugin's turn row survives —
 * the official present card duplicates it with a model-curated subset and
 * the official changes card is memory-resident, lost on a host restart): a
 * second entry under the official card's cell id at a lower priority, whose
 * empty body wins the cell (list shadowing is the slot system's first-class
 * mechanism — same cell id, distinct priority, lowest renders). The official
 * registration stays on the ledger, so the `deliverables.file.actions` child
 * slot it declares never collapses and the mention-open wrap keeps working;
 * only its card body stops rendering. On a 0.1.5 host the slot is still the
 * election chain; the registration probes the declaration kind and keeps the
 * old preemptive shape (select + priority -1) there.
 *
 * Retired at the 0.1.5-rc.1 move (seam registry S1): the conversation.view
 * tab, the shell.overlay drawer, and the mention capture-phase DOM
 * interception — the right-Sidebar resource routing (openResource + the
 * tab-type registry) covers all three openings.
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
import { FileContentBody } from './FileContentBody.tsx'
import { FileHistoryBody } from './FileHistoryBody.tsx'
import { FileArtifactsTab } from './FileArtifactsTab.tsx'
import { TurnFileRow } from './TurnFileRow.tsx'
import { createFilePreviewStore } from './file-preview-store.ts'
import { FILE_PREVIEW_ID, FILE_PREVIEW_KIND, filePreviewDefinition } from './definition.tsx'
import { FILE_ARTIFACTS_ID, FILE_ARTIFACTS_KIND, fileArtifactsDefinition } from './artifacts-definition.ts'
import { FILE_CONTENT_ID, CONTENT_BINARY_EXTENSIONS, CONTENT_EXTENSIONS } from './content-definition.ts'
import { FILE_HISTORY_ID, HISTORY_EXTENSIONS } from './history-definition.ts'
import { basename } from './path-utils.ts'
import { en, NS, zh } from './locales.ts'
import { wrapChatFileMentions } from './mentions-wrap.ts'
import { OpenInAppProbe, pickFileManager, pickIde } from './open-in-app.ts'
import { parentPath } from './path-utils.ts'
import { createTurnFilesLoader } from './turn-files-cache.ts'
import { selectTurnFiles } from './turn-files.ts'
import type { FileArtifactsInjected, FileContentBodyInjected, FilePreviewRemote, FilePreviewTabInjected, FilePreviewTurnRowInjected } from './contract.ts'

export { DiffHistory } from './DiffHistory.tsx'
export { FilePreviewTab, FileContentBody, FileHistoryBody, FileArtifactsTab, TurnFileRow }
export { FILE_PREVIEW_ID, FILE_PREVIEW_KIND, FILE_CONTENT_ID, FILE_HISTORY_ID, FILE_ARTIFACTS_ID, FILE_ARTIFACTS_KIND }

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
 * Client plugin body: mount the Remote, register the dictionaries, then the
 * surfaces of the host line actually serving (see the module header).
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
 * dictionaries, the line's content faces (legacy tab or document renderers),
 * the turn row, and the mention wrapper.
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
        // the same file). On rc.1 the official document tab claims them all
        // (our content renderer is its default body); on 0.1.5 our tab type
        // claims the renderable ones and the rest fall through. A throw (no
        // mounted sidebar surface) falls back to the owner's openFile inside
        // the wrap.
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

  // ── 0.1.5 line: the self-drawn tab type + body. Registered only while the
  // official document-preview pane is absent: the point-in-time `ctx.get`
  // probe below skips them when the pane already provides `documentPreviews`,
  // and the rc.1 arm further down retires them when the pane arrives after us
  // (a one-shot get races the documentpreview fiber's provide, and cordis
  // re-wakes only fibers that declare the service in `inject`). An rc.1
  // composition with documentpreview mounted out degrades to exactly these
  // surfaces, which is the 0.1.5 behavior by construction.
  const legacyDisposers: Array<() => void | Promise<void>> = []
  const retireLegacySurfaces = (): void => {
    for (const dispose of legacyDisposers.splice(0).reverse()) void dispose()
  }
  if (ctx.get('documentPreviews') === undefined) {
    // Stage one of the right-Sidebar registration: the tab type (guide entry
    // PLUS address claims — `dsh-resource://file/**` for every session-scoped
    // path the preview stack renders; see definition.tsx). The default band is
    // 'extension', outranking the official document tab's 'fallback'.
    legacyDisposers.push(ctx.effect(() => ctx.sidebarRightTabs.register(filePreviewDefinition(t)), 'ui-file-preview: tab type'))

    // Stage two: the body under the type's id in the keyed pane seat.
    legacyDisposers.push(ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
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
  }
  disposers.push(async () => { retireLegacySurfaces() })

  // The turn card. Probe the declared slot kind inside inject (the callback
  // only runs once the slot exists): a 0.1.6-alpha.2+ host declares a LIST —
  // register a plain entry under the package id, plus the deliverables shadow
  // (the list arm's convergence, user decision 2026-09-24: the official
  // present card duplicates this row with a model-curated subset and the
  // official changes card is memory-resident, so only this row survives). The
  // shadow is the slot system's first-class mechanism, not a DOM hack: one
  // cell (the official entry's id), two entries at distinct priorities, the
  // lowest renders (ui-slots SlotCore.register pins the rule — a same-id
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

  // ── rc.1 line: the official document tab's renderer pair. The CONTENT
  // renderer (the shared content pane, headless — the frame owns the chrome)
  // registers at the default `extension` band — an external implementation
  // outranks the official renderers, so a file click lands in the official
  // document tab with our body as the default view; `loading: 'renderer'`
  // keeps the read on our own Remote so outside-workspace products keep
  // rendering (the owner's workspace-scoped paged read cannot serve them).
  // The HISTORY renderer keeps the `builtin` band — never the default, always
  // in the toolbar dropdown. The ARTIFACTS shell restores the session-products
  // entry the 0.1.5 page carried: a thin list whose rows open through the
  // official resource route (it draws no content itself). A one-shot
  // `ctx.get` here races the documentpreview fiber's provide — cordis only
  // re-wakes fibers that declare a service in `inject` — so the registrations
  // live in a nested plugin pended on the service; on the 0.1.5 line (or a
  // composition without document previews) it simply never activates and the
  // legacy tab above stays. Its activation retires the legacy tab: the two
  // content faces never coexist.
  const documentPaneFiber = ctx.plugin({
    name: '@khorsheed/dsh-client-ui-file-preview/document-pane',
    inject: ['documentPreviews'],
    apply: (sub: Context) => {
      retireLegacySurfaces()
      const previews = sub.documentPreviews
      sub.effect(() => previews.register({
        id: FILE_CONTENT_ID,
        extensions: CONTENT_EXTENSIONS,
        binaryExtensions: CONTENT_BINARY_EXTENSIONS,
        priority: 'extension',
        title: () => t('content.title'),
        // Renderer-owned loading: the body reads through the filePreview
        // Remote (outside-workspace capable) and settles each revision itself.
        loading: 'renderer',
      }), 'ui-file-preview: content renderer metadata')
      sub.effect(() => sub.slots.inject('sidebar.right.tab.document', () => sub.slots.register(
        {
          name: 'sidebar.right.tab.document',
          key: FILE_CONTENT_ID,
          locale: NS,
          inject: (): FileContentBodyInjected => ({
            readFile: (sid: SessionId, path: string) => remote.read(sid, path),
            copyPath: (absolutePath: string) => writeClipboard(absolutePath),
          }),
        },
        FileContentBody,
      )), 'ui-file-preview: content renderer body')
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
      // The session-products list shell: the page type (guide entry 「会话产物」)
      // plus its body under the same id. Rows route through the official
      // resource address — the shell owns no content view.
      sub.effect(() => sub.sidebarRightTabs.register(fileArtifactsDefinition(t)), 'ui-file-preview: artifacts tab type')
      sub.effect(() => sub.slots.inject('sidebar.right.pane.tab', () => sub.slots.register(
        {
          name: 'sidebar.right.pane.tab',
          key: FILE_ARTIFACTS_ID,
          locale: NS,
          store: createFilePreviewStore,
          inject: (sessionId: SessionId): FileArtifactsInjected => ({
            listFiles: (sid: SessionId) => remote.list(sid),
            openArtifact: (path: string) => {
              ctx.sidebarRight.openResource(fileAddressFor(sessionId, sessionCwd(sessionId), path))
            },
          }),
        },
        FileArtifactsTab,
      )), 'ui-file-preview: artifacts body')
    },
  })
  disposers.push(() => documentPaneFiber.dispose())

  return async () => {
    for (const dispose of disposers.reverse()) await dispose()
  }
}
