/**
 * Inspiration canvas, browser half: the pad's list and writing surface.
 *
 * It mounts the canvas Remote through the official `ctx.remote.$mount`
 * channel and surfaces once — as a page-type `sidebar.right.pane.tab` entry,
 * reachable from the shipped guide's capsule (and entered directly when this
 * is a pane's only registered type; both behaviours belong to the official
 * registry).
 *
 * The host half is probed, never assumed: with no `remote.canvas` mounted, the
 * view still registers and reports the missing half instead of throwing
 * through boot.
 *
 * @module @khorsheed/dsh-canvas/client
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the ctx.slots service merge.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the ctx.locale service merge.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the generated Remote API and ctx.remote merge.
import type {} from '@khorsheed/dsh-canvas/remote'
// Type-only: pulls the ctx.sidebarRightTabs service merge and the
// right-Sidebar SlotMap seat ('sidebar.right.pane.tab').
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import canvasRemote from '@khorsheed/dsh-canvas/remote'
import { CanvasView } from './CanvasView.tsx'
import type { CanvasRemote, CanvasViewInjected } from './contract.ts'
import { CANVAS_TAB_ID, canvasDefinition } from './definition.ts'
import { en, NS, zh } from './locales.ts'

export { CanvasView } from './CanvasView.tsx'
export { CANVAS_KIND, CANVAS_TAB_ID } from './definition.ts'
export type { CanvasRemote, CanvasViewInjected, CanvasViewProps } from './contract.ts'
export * from './paste-table.ts'

/** Required services: slots, the remote channel, the locale, and the tab-type registry. */
export const inject = ['slots', 'remote', 'locale', 'sidebarRightTabs']

/**
 * Client plugin body: mount the Remote, register the dictionaries, then the
 * tab type and its body.
 * @param ctx - client root context.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const disposers: Array<() => Promise<void>> = []
  try {
    disposers.push(await ctx.remote.$mount(canvasRemote))
  } catch (error) {
    // A Remote already mounted by another composition fails loud at boot; the
    // rest of the plugin still registers.
    /* v8 ignore next -- double-mount is a composition error, not a runtime path */
    ctx.logger.error(error)
  }
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'canvas: dictionaries')
  const t = ctx.locale.bind(NS)

  // Read lazily and through `ctx.get`: a composition without the host half
  // yields undefined, and the view reports that instead of the plugin
  // pending forever on an inject it cannot satisfy.
  const requireRemote = (): CanvasRemote => {
    const mounted = ctx.get('remote.canvas') as CanvasRemote | undefined
    if (mounted === undefined) throw new Error('canvas: the host half is not installed')
    return mounted
  }
  const browserFace = (): CanvasViewInjected => ({
    list: request => requireRemote().list(request),
    read: request => requireRemote().read(request),
    // The mutating calls hand the session to the host: it resolves that
    // session's file policy and workspace onto the write.
    create: (sessionId, request) => requireRemote().create(sessionId, request),
    write: (sessionId, request) => requireRemote().write(sessionId, request),
    setArchived: (sessionId, request) => requireRemote().setArchived(sessionId, request),
  })

  ctx.effect(() => ctx.sidebarRightTabs.register(canvasDefinition(t)), 'canvas: tab type')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: CANVAS_TAB_ID,
    locale: NS,
    inject: browserFace,
  }, CanvasView)), 'canvas: sidebar tab body')

  return async () => {
    await Promise.all(disposers.map(dispose => dispose()))
  }
}
