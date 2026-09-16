/**
 * Inspiration canvas, browser half: the pad's list and writing surface, plus
 * the v2 canvas space (主题画布空间).
 *
 * It mounts the canvas Remote through the official `ctx.remote.$mount`
 * channel and surfaces twice: as a page-type `sidebar.right.pane.tab` entry
 * (the v1 pad, reachable from the shipped guide's capsule), and — v2 — as a
 * root-level space: the keyed `main` panel 'canvas' plus its `sidebar.panellist`
 * rail row, so the left rail switches the whole main area to the canvas space.
 *
 * Every seat is probed, never assumed: the space registrations ride
 * `ctx.slots.inject`, so a host that declares neither `main` nor
 * `sidebar.panellist` simply never mounts the space (the v1 tab keeps
 * working); with no `remote.canvas` mounted, the views still register and
 * report the missing half instead of throwing through boot.
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
// Type-only: pulls ui-layout's SlotMap merge (the root 'main' seat).
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls ui-sidebar's SlotMap merge ('sidebar.panellist').
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import canvasRemote from '@khorsheed/dsh-canvas/remote'
import { CanvasView } from './CanvasView.tsx'
import type { CanvasRemote, CanvasSpaceInjected, CanvasViewInjected } from './contract.ts'
import { CANVAS_TAB_ID, canvasDefinition } from './definition.ts'
import { en, NS, zh } from './locales.ts'
import { CanvasSpacePage } from './space/CanvasSpacePage.tsx'
import { CANVAS_PANEL_ID, CanvasNavIcon } from './space/definition.tsx'

export { CanvasView } from './CanvasView.tsx'
export { CANVAS_KIND, CANVAS_TAB_ID } from './definition.ts'
export { CanvasSpacePage } from './space/CanvasSpacePage.tsx'
export { BoardView } from './space/BoardView.tsx'
export { CANVAS_PANEL_ID, CanvasNavIcon } from './space/definition.tsx'
export type { CanvasRemote, CanvasSpaceInjected, CanvasViewInjected, CanvasViewProps, CanvasSpacePageProps } from './contract.ts'
export * from './paste-table.ts'

/** Required services: slots, the remote channel, the locale, and the tab-type registry. */
export const inject = ['slots', 'remote', 'locale', 'sidebarRightTabs']

/**
 * Client plugin body: mount the Remote, register the dictionaries, then the
 * tab type and its body, then the canvas space (main panel + rail row).
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
  const spaceFace = (): CanvasSpaceInjected => ({
    listCanvases: () => requireRemote().listCanvases(),
    readBoard: request => requireRemote().readBoard(request),
    probeV1Pad: request => requireRemote().list(request),
    // The mutating calls hand the CURRENT session to the host: the board is
    // deployment-level state, and the host re-roots that session's fence mode
    // at the canvas state dir.
    createCanvas: (sessionId, request) => requireRemote().createCanvas(sessionId, request),
    putCard: (sessionId, request) => requireRemote().putCard(sessionId, request),
    patchCard: (sessionId, request) => requireRemote().patchCard(sessionId, request),
    addComment: (sessionId, request) => requireRemote().addComment(sessionId, request),
    archiveCanvas: (sessionId, request) => requireRemote().archiveCanvas(sessionId, request),
    importV1: (sessionId, request) => requireRemote().importV1(sessionId, request),
  })

  ctx.effect(() => ctx.sidebarRightTabs.register(canvasDefinition(t)), 'canvas: tab type')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: CANVAS_TAB_ID,
    locale: NS,
    inject: browserFace,
  }, CanvasView)), 'canvas: sidebar tab body')

  // The v2 canvas space: one id for the main panel key and the rail row (the
  // shell matches them). Both ride slots.inject, so a host without either
  // seat degrades to the v1 tab alone.
  ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: CANVAS_PANEL_ID,
    locale: NS,
    inject: spaceFace,
  }, CanvasSpacePage)), 'canvas: space main panel')
  ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: CANVAS_PANEL_ID,
    order: 100,
    label: () => t('space.nav'),
    locale: NS,
  }, CanvasNavIcon)), 'canvas: space rail row')

  return async () => {
    await Promise.all(disposers.map(dispose => dispose()))
  }
}
