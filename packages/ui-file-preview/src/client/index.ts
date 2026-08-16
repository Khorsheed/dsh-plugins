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
import { FilePreviewDrawer } from './FilePreviewDrawer.tsx'
import { FilePreviewView } from './FilePreviewView.tsx'
import { TurnFileRow } from './TurnFileRow.tsx'
import { createFilePreviewStore } from './file-preview-store.ts'
import { interceptMentionClicks } from './mention-intercept.ts'
import { FilePreviewController, type FilePreviewActions } from './panel-service.ts'
import { en, NS, zh } from './locales.ts'
import { parentPath } from './path-utils.ts'
import { turnFilesDefinition, selectTurnFiles } from './turn-files.ts'
import type { FilePreviewDrawerInjected, FilePreviewRemote, FilePreviewViewInjected } from './contract.ts'

export { FilePreviewDrawer, FilePreviewView, FilePreviewController }

/** Required services: slots, sessions, the remote channel, conversation node
 * registration, and the copy. `remote.filePreview` is deliberately NOT an
 * inject: this plugin both mounts the namespace (through `$mount` below) and
 * consumes it, and the Cordis property proxy only resolves services declared
 * in `inject` or provided by an ancestor fiber. Declaring it would deadlock
 * the loader (the fiber waits for the service, which only this apply's
 * `$mount` can provide); the property proxy cannot see the sibling namespace
 * fiber `$mount` spawns. The mount is awaited and the namespace is then read
 * back from the global store with `ctx.get`, which resolves any active
 * provider in the same isolation scope. */
export const inject = ['slots', 'sessions', 'workspaces', 'connection', 'remote', 'conversationEvents', 'locale']

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
  ctx.conversationEvents.register(turnFilesDefinition)
  const t = ctx.locale.bind(NS)
  const controller = new FilePreviewController()
  const connection = ctx.get('connection') as ConnectionHandle
  const sessions: ISessions = ctx.sessions
  // Host open gestures resolve the display path against the CURRENT session's
  // cwd at call time (the drawer only ever previews the current session).
  const openOnHost = (path: string): void => {
    const snapshot = sessions.list.getSnapshot()
    const cwd = snapshot.current === undefined ? undefined : snapshot.byId[snapshot.current]?.cwd
    void ctx.workspaces.openPath(resolveWorkspacePath(cwd, path)).catch(() => {
      // Host/OS open failures stay silent in the drawer; the native app
      // surfaces its own error dialog when the path is unusable.
    })
  }
  // The namespace is registered by $mount above; `ctx.remote.filePreview`
  // cannot see it (the property proxy walks the fiber chain, and the namespace
  // lives in the sibling fiber $mount spawned), so read it from the global
  // store once the mount has settled and hand the concrete handle to the
  // inject closures, so a lazy `ctx.remote.filePreview` read at call time
  // never trips the property proxy.
  const remote = ctx.get('remote.filePreview') as FilePreviewRemote

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
      }
    },
  }, FilePreviewView))

  ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
    name: 'conversation.chat.turnTail',
    // Priority -1: the chain elects the first non-null select in ascending
    // priority order, so this entry wins over the official deliverables entry
    // (default priority 0) on every turn their vocabularies overlap — and
    // selectTurnFiles unions that vocabulary in, so the official row never
    // mounts. See the TODO(official-opener-seam) on selectTurnFiles.
    priority: -1,
    select: selectTurnFiles,
    locale: NS,
    inject: () => ({
      openDrawer: (path: string) => { controller.openDrawer(path) },
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
        openExternal: openOnHost,
        revealFolder: (path) => { openOnHost(parentPath(path) || '.') },
      }
    },
  }, FilePreviewDrawer))

  return async () => {
    await Promise.all(disposers.map(dispose => dispose()))
  }
}
