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
// Type-only: pulls the ctx.slots service merge.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the ctx.locale service merge.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the generated Remote API and ctx.remote merge.
import type {} from '@khorsheed/dsh-file-preview/remote'
// Type-only: pulls ui-chat's SlotMap merge ('conversation.chat.turnTail').
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
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
import { en, NS, zh } from './locales.ts'
import { createTurnFilesLoader } from './turn-files-cache.ts'
import { selectTurnFiles } from './turn-files.ts'
import type { FilePreviewRemote, FilePreviewTabInjected, FilePreviewTurnRowInjected } from './contract.ts'

export { DiffHistory } from './DiffHistory.tsx'
export { FilePreviewTab, FileHistoryBody, TurnFileRow }
export { FILE_PREVIEW_ID, FILE_PREVIEW_KIND, FILE_HISTORY_ID }

/** Required services: slots, the remote channel, the locale, and the
 * right-Sidebar faces (tab-type registry + the navigation service the turn
 * card's outside-workspace gesture opens pages through). The
 * `remote.filePreview` namespace is deliberately NOT an inject: this plugin
 * both mounts the namespace (through `$mount` below) and consumes it, and the
 * Cordis property proxy only resolves services declared in `inject` or
 * provided by an ancestor fiber. Declaring it would deadlock the loader (the
 * fiber waits for the service, which only this apply's `$mount` can provide);
 * the property proxy cannot see the sibling namespace fiber `$mount` spawns.
 * The mount is awaited and the namespace is then read back from the global
 * store with `ctx.get`, which resolves any active provider in the same
 * isolation scope. */
export const inject = ['slots', 'remote', 'locale', 'sidebarRight', 'sidebarRightTabs']

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
    // A Remote already mounted by another composition fails loud at boot; the
    // rest of the plugin still registers (the tab would answer an unmounted
    // namespace with a typed RPC error, which the surfaces render).
    /* v8 ignore next -- double-mount is a composition error, not a runtime path */
    ctx.logger.error(error)
  }
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-file-preview: dictionaries')
  const t = ctx.locale.bind(NS)
  // The namespace is registered by $mount above; `ctx.remote.filePreview`
  // cannot see it (the property proxy walks the fiber chain, and the namespace
  // lives in the sibling fiber $mount spawned), so read it from the global
  // store once the mount has settled and hand the concrete handle to the
  // inject closures, so a lazy `ctx.remote.filePreview` read at call time
  // never trips the property proxy.
  const remote = ctx.get('remote.filePreview') as FilePreviewRemote
  // The turn card's host-fed loader: one RPC warms every turn rendered so far
  // (the host returns the whole per-turn map, cached by the log watermark).
  const turnFilesLoader = createTurnFilesLoader(remote)

  // Stage one of the right-Sidebar registration: the page type itself (guide
  // entry, no address claims). The default band is 'extension', which outranks
  // every builtin viewer — correct here because the type claims nothing.
  ctx.effect(() => ctx.sidebarRightTabs.register(filePreviewDefinition(t)), 'ui-file-preview: tab type')

  // Stage two: the body under the type's id in the keyed pane seat.
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: FILE_PREVIEW_ID,
    locale: NS,
    store: createFilePreviewStore,
    inject: (): FilePreviewTabInjected => ({
      listFiles: (sid: SessionId) => remote.list(sid),
    }),
  }, FilePreviewTab)), 'ui-file-preview: tab body')

  ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
    name: 'conversation.chat.turnTail',
    // No priority: the chain elects the first non-null select in ascending
    // priority order, and the official deliverables entry (also default)
    // registered first at host boot. This card's unconditional claim is
    // consulted only for turns the official row declines.
    select: selectTurnFiles,
    locale: NS,
    inject: (): FilePreviewTurnRowInjected => ({
      turnFiles: (sessionId: SessionId, turn: number) => turnFilesLoader(sessionId, turn),
      // Outside-workspace paths have no `dsh-resource://file/...` address; open
      // this plugin's page with the path selected. The page service acts on the
      // mounted session's surface — a throw (no surface mounted) degrades to
      // nothing rather than breaking the chat view.
      openOutsideWorkspace: (_sessionId: SessionId, path: string) => {
        try {
          ctx.sidebarRight.openTab(FILE_PREVIEW_KIND, { params: { path } })
        } catch (error) {
          ctx.logger.warn('ui-file-preview: openTab failed', error)
        }
      },
    }),
  }, TurnFileRow))

  // The change-history document renderer: metadata into the registry, the
  // body into the keyed document seat. `priority: 'builtin'` keeps the
  // official renderer the default (an extension band would take it over);
  // the toolbar dropdown lists every match regardless. Degrade silently on a
  // composition without the document-preview package (its seat is absent
  // there anyway).
  const previews = ctx.get('documentPreviews')
  if (previews !== undefined) {
    ctx.effect(() => previews.register({
      id: FILE_HISTORY_ID,
      extensions: HISTORY_EXTENSIONS,
      priority: 'builtin',
      title: () => t('history.title'),
      // The body never touches the owner's prepared content — the diffs come
      // from the filePreview fold — so the cheapest delivery mode applies.
      loading: 'text-pages',
    }), 'ui-file-preview: history renderer metadata')
    ctx.effect(() => ctx.slots.inject('sidebar.right.tab.document', () => ctx.slots.register(
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
  }

  return async () => {
    await Promise.all(disposers.map(dispose => dispose()))
  }
}
