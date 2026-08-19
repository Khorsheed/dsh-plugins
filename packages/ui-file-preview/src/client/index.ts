/**
 * File-preview plugin, browser half: a pure additive surface over official
 * extension points only. It registers the file browser as the 'file-preview'
 * entry in the conversation's `conversation.view` tab ring (beside chat and
 * trajectory), a content-only link-click drawer in the frame's additive
 * `shell.overlay` slot (with host "show in folder" / "open in IDE" gestures
 * gated by the loopback + canOpenPath capability), and a per-turn mutation
 * card in the `conversation.chat.turnTail` chain — at negative priority with
 * a select unioning the official deliverables vocabulary, so the card claims
 * every file-mutating turn and the official OS-open row never mounts while
 * this plugin is composed. Official prose mentions (no slot or service seam
 * reaches them) are rerouted into the drawer by a capture-phase click
 * interceptor (see mention-intercept.ts). The filePreview Remote is mounted
 * here through the official `ctx.remote.$mount` channel, so the plugin
 * distributes as an independent package with no edits to core packages.
 * Composing this plugin out of cordis.yml removes every surface it adds.
 */
import type { ClientContext, ISessions, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { resolveWorkspacePath } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
// Type-only: pulls the ctx.locale service merge.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the generated Remote API and ctx.remote merge.
import type {} from '@khorsheed/dsh-file-preview/remote'
// Type-only: pulls ui-conversation's SlotMap merges ('conversation.view',
// 'conversation.chat.turnTail').
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the ui-layout frame's SlotMap merge ('shell.overlay').
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import filePreviewRemote from '@khorsheed/dsh-file-preview/remote'
import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import { FilePreviewDrawer } from './FilePreviewDrawer.tsx'
import { FilePreviewView } from './FilePreviewView.tsx'
import { TurnFileRow } from './TurnFileRow.tsx'
import { createFilePreviewStore } from './file-preview-store.ts'
import { interceptMentionClicks } from './mention-intercept.ts'
import { FilePreviewController, type FilePreviewActions } from './panel-service.ts'
import { en, NS, zh } from './locales.ts'
import { parentPath } from './path-utils.ts'
import { createTurnFilesLoader } from './turn-files-cache.ts'
import { selectTurnFiles } from './turn-files.ts'
import type { FilePreviewDrawerInjected, FilePreviewRemote, FilePreviewTurnRowInjected, FilePreviewViewInjected } from './contract.ts'

export { FilePreviewDrawer, FilePreviewView, FilePreviewController }

/** Required services: slots, sessions, the remote channel, and the locale. The
 * `remote.filePreview` namespace is deliberately NOT an inject: this plugin
 * both mounts the namespace (through `$mount` below) and consumes it, and the
 * Cordis property proxy only resolves services declared in `inject` or
 * provided by an ancestor fiber. Declaring it would deadlock the loader (the
 * fiber waits for the service, which only this apply's `$mount` can provide);
 * the property proxy cannot see the sibling namespace fiber `$mount` spawns.
 * The mount is awaited and the namespace is then read back from the global
 * store with `ctx.get`, which resolves any active provider in the same
 * isolation scope. */
export const inject = ['slots', 'sessions', 'workspaces', 'connection', 'remote', 'locale']

/**
 * Client plugin body: mount the Remote, register the dictionaries, the panel
 * controller, the file view tab, the per-turn file row, and the drawer.
 * @param ctx - client root context.
 */
export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  const disposers: Array<() => Promise<void>> = []
  try {
    disposers.push(await ctx.remote.$mount(filePreviewRemote))
  } catch (error) {
    // A Remote already mounted by another composition fails loud at boot; the
    // rest of the plugin still registers (the view would answer an unmounted
    // namespace with a typed RPC error, which the surfaces render).
    /* v8 ignore next -- double-mount is a composition error, not a runtime path */
    ctx.logger.error(error)
  }
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-file-preview: dictionaries')
  const t = ctx.locale.bind(NS)
  const controller = new FilePreviewController()
  const connection = ctx.get('connection') as ConnectionHandle
  const sessions: ISessions = ctx.sessions
  // Path verbs (open / reveal / copy) resolve the recorded display path
  // against a session's cwd at call time — the tool may have recorded it
  // relative to the session cwd. The drawer only ever previews the CURRENT
  // session; the file view knows its own session id and resolves against
  // that one, never the current.
  const sessionCwd = (sessionId: SessionId | undefined): string | undefined => {
    const snapshot = sessions.list.getSnapshot()
    if (sessionId !== undefined) return snapshot.byId[sessionId]?.cwd
    return snapshot.current === undefined ? undefined : snapshot.byId[snapshot.current]?.cwd
  }
  const openOnHost = (sessionId: SessionId | undefined, path: string): void => {
    void ctx.workspaces.openPath(resolveWorkspacePath(sessionCwd(sessionId), path)).catch(() => {
      // Host/OS open failures stay silent in the drawer; the native app
      // surfaces its own error dialog when the path is unusable.
    })
  }
  const copyPathFor = (sessionId: SessionId | undefined, path: string): Promise<boolean> =>
    writeClipboard(resolveWorkspacePath(sessionCwd(sessionId), path))
  // "Show in folder": reveal the file in the host file manager (open its
  // folder and select it — Finder/Explorer/a select-capable file manager).
  // The host resolves the display path against the session cwd and selects
  // when it can; when the file is gone or the platform cannot select, fall
  // back to opening the parent folder (the pre-reveal behavior) so the
  // gesture always lands somewhere visible. The drawer only ever previews
  // the CURRENT session; the file view knows its own session id.
  const revealFolder = (sessionId: SessionId | undefined, path: string): void => {
    const sid = sessionId ?? sessions.list.getSnapshot().current
    if (sid === undefined) return
    void remote.reveal(sid, path).then((result) => {
      if (result.ok && result.value.revealed) return
      openOnHost(sessionId, parentPath(path) || '.')
    }).catch(() => {
      openOnHost(sessionId, parentPath(path) || '.')
    })
  }
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

  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'file-preview',
    order: 20,
    locale: NS,
    label: () => t('open'),
    store: createFilePreviewStore,
    inject: (sessionId: SessionId, actions: FilePreviewActions): FilePreviewViewInjected => {
      controller.attachSession(sessionId, actions)
      return {
        listFiles: (sid: SessionId) => remote.list(sid),
        readFile: (sid: SessionId, path: string) => remote.read(sid, path),
        isLoopback: connection.isLoopback,
        hooks: { hostDescription: connection.hostDescription },
        openExternal: (path) => { openOnHost(sessionId, path) },
        revealFolder: (path) => { revealFolder(sessionId, path) },
        copyPath: (path) => copyPathFor(sessionId, path),
      }
    },
  }, FilePreviewView))

  ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
    name: 'conversation.chat.turnTail',
    // Priority -1: the chain elects the first non-null select in ascending
    // priority order. selectTurnFiles claims EVERY turn unconditionally (the
    // card is an async shell whose visibility its host fetch decides), so the
    // official produced-files entry never mounts. See the
    // TODO(official-opener-seam) note: the row still opens the drawer in place.
    priority: -1,
    select: selectTurnFiles,
    locale: NS,
    inject: (): FilePreviewTurnRowInjected => ({
      openDrawer: (path: string) => { controller.openDrawer(path) },
      turnFiles: (sessionId: SessionId, turn: number) => turnFilesLoader(sessionId, turn),
    }),
  }, TurnFileRow))

  // Official prose mentions have no slot/service seam; reroute their clicks
  // into the drawer at the DOM capture phase (fail-open, own surfaces
  // excluded). See the TODO(official-opener-seam) in mention-intercept.ts.
  ctx.effect(
    () => interceptMentionClicks((path) => { controller.openDrawer(path) }),
    'ui-file-preview: mention click intercept',
  )

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'file-preview-drawer',
    order: 110,
    locale: NS,
    store: createFilePreviewStore,
    inject: (actions: FilePreviewActions): FilePreviewDrawerInjected => {
      controller.attachDrawer(actions)
      return {
        listFiles: (sid: SessionId) => remote.list(sid),
        readFile: (sid: SessionId, path: string) => remote.read(sid, path),
        isLoopback: connection.isLoopback,
        hooks: { hostDescription: connection.hostDescription },
        openExternal: (path) => { openOnHost(undefined, path) },
        revealFolder: (path) => { revealFolder(undefined, path) },
        copyPath: (path) => copyPathFor(undefined, path),
      }
    },
  }, FilePreviewDrawer))

  return async () => {
    await Promise.all(disposers.map(dispose => dispose()))
  }
}
