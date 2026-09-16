/**
 * Inspiration canvas, browser half: the v2 canvas space (主题画布空间) and
 * its card-detail reader.
 *
 * It mounts the canvas Remote through the official `ctx.remote.$mount`
 * channel and surfaces twice: as a root-level space — the keyed `main` panel
 * 'canvas' plus its `sidebar.panellist` rail row, so the left rail switches
 * the whole main area to the canvas space — and as the page-type
 * `sidebar.right.pane.tab` entry, which since M1.5 is the CARD-DETAIL
 * READER: it follows the board's selection through the shared store and
 * renders the one open card in full. (The v1 pad editor retired from this
 * seat; the pad's files stay on disk and the space's one-shot import carries
 * them into canvases.)
 *
 * Every seat is probed, never assumed: the registrations ride
 * `ctx.slots.inject`, so a host that declares neither `main` nor
 * `sidebar.panellist` simply never mounts the space; with no `remote.canvas`
 * mounted, the views still register and report the missing half instead of
 * throwing through boot. The detail tab's activation rides the official
 * `ctx.sidebarRight.openTab` inside a try/catch — a composition without a
 * mounted session (or the right Sidebar at all) still gets the shared-store
 * selection, just no forced tab switch.
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
// Type-only: pulls the ctx.sidebarRight/ctx.sidebarRightTabs service merges
// and the right-Sidebar SlotMap seat ('sidebar.right.pane.tab').
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
// Type-only: pulls ui-layout's SlotMap merge (the root 'main' seat).
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls ui-sidebar's SlotMap merge ('sidebar.panellist').
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { fileAddressFor } from '@deepseek-ai/dsh-util-workspace-path'
import canvasRemote from '@khorsheed/dsh-canvas/remote'
import { CanvasDetailView } from './detail/CanvasDetailView.tsx'
import type { CanvasDetailInjected, CanvasRemote, CanvasSpaceInjected } from './contract.ts'
import { CANVAS_KIND, CANVAS_TAB_ID, canvasDefinition } from './definition.ts'
import { en, NS, zh } from './locales.ts'
import { CanvasSpacePage } from './space/CanvasSpacePage.tsx'
import { CANVAS_PANEL_ID, CanvasNavIcon } from './space/definition.tsx'
import { CanvasSelectionStore } from './space/selection.ts'

export { CanvasDetailView } from './detail/CanvasDetailView.tsx'
export { CANVAS_KIND, CANVAS_TAB_ID } from './definition.ts'
export { CanvasSpacePage } from './space/CanvasSpacePage.tsx'
export { BoardView } from './space/BoardView.tsx'
export { CardTextarea } from './space/CardTextarea.tsx'
export { CANVAS_PANEL_ID, CanvasNavIcon } from './space/definition.tsx'
export { CanvasSelectionStore } from './space/selection.ts'
export type {
  CanvasDetailInjected, CanvasDetailProps, CanvasRemote, CanvasSpaceInjected, CanvasSpacePageProps,
} from './contract.ts'
export * from './paste-table.ts'

/**
 * Required services: slots, the remote channel, the locale, the right-Sidebar
 * faces (the tab-type registry and the navigation service the detail tab's
 * activation and attachment previews go through).
 * `remote.canvas` is deliberately NOT an inject: this plugin both mounts the
 * namespace (through `$mount` below) and consumes it, and the Cordis
 * property proxy only resolves services declared in `inject` or provided by
 * an ancestor fiber — declaring it would deadlock the loader. The mount is
 * awaited and the namespace is then read back from the global store with
 * `ctx.get` (the ui-file-preview precedent).
 */
export const inject = ['slots', 'remote', 'locale', 'sidebarRight', 'sidebarRightTabs']

/**
 * Client plugin body: mount the Remote, register the dictionaries, then the
 * detail tab type and its reader body, then the canvas space (main panel +
 * rail row).
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

  // The board↔detail selection: one store, published into both inject faces.
  const selection = new CanvasSelectionStore()

  // Read lazily and through `ctx.get`: a composition without the host half
  // yields undefined, and the view reports that instead of the plugin
  // pending forever on an inject it cannot satisfy.
  const requireRemote = (): CanvasRemote => {
    const mounted = ctx.get('remote.canvas') as CanvasRemote | undefined
    if (mounted === undefined) throw new Error('canvas: the host half is not installed')
    return mounted
  }

  /**
   * Every mutating wrapper in both faces lands here: a landed board mutation
   * touches the shared store, so the OTHER seat re-reads. (The mutating seat
   * already has the fresh board from the response; its own rev-triggered
   * re-read is the one idempotent extra fetch this consistency costs.)
   */
  const touchOnSuccess = <T extends { ok: boolean }>(result: T): T => {
    if (result.ok) selection.touch()
    return result
  }

  /**
   * Activate the detail tab through the official navigation face. `openTab`
   * requires a mounted session; a composition without one (or without the
   * right Sidebar) degrades to the store write alone — the tab renders the
   * detail whenever it is open by any other means.
   */
  const activateDetailTab = (): void => {
    try {
      ctx.sidebarRight.openTab(CANVAS_KIND)
    } catch (error) {
      ctx.logger.warn('canvas: openTab failed (no mounted session?)', error)
    }
  }

  const spaceFace = (): CanvasSpaceInjected => ({
    listCanvases: () => requireRemote().listCanvases(),
    readBoard: request => requireRemote().readBoard(request),
    probeV1Pad: request => requireRemote().list(request),
    // The mutating calls hand the CURRENT session to the host: the board is
    // deployment-level state, and the host re-roots that session's fence mode
    // at the canvas state dir.
    createCanvas: async (sessionId, request) => touchOnSuccess(await requireRemote().createCanvas(sessionId, request)),
    putCard: async (sessionId, request) => touchOnSuccess(await requireRemote().putCard(sessionId, request)),
    patchCard: async (sessionId, request) => touchOnSuccess(await requireRemote().patchCard(sessionId, request)),
    addComment: async (sessionId, request) => touchOnSuccess(await requireRemote().addComment(sessionId, request)),
    archiveCanvas: async (sessionId, request) => touchOnSuccess(await requireRemote().archiveCanvas(sessionId, request)),
    importV1: async (sessionId, request) => touchOnSuccess(await requireRemote().importV1(sessionId, request)),
    selectCard: (canvasId, cardId) => {
      selection.select(canvasId, cardId)
      activateDetailTab()
    },
    hooks: { selection: selection.source },
  })
  const detailFace = (): CanvasDetailInjected => ({
    readBoard: request => requireRemote().readBoard(request),
    patchCard: async (sessionId, request) => touchOnSuccess(await requireRemote().patchCard(sessionId, request)),
    addComment: async (sessionId, request) => touchOnSuccess(await requireRemote().addComment(sessionId, request)),
    openFile: (sessionId, cwd, path) => {
      try {
        ctx.sidebarRight.openResource(fileAddressFor(sessionId, cwd, path))
      } catch (error) {
        ctx.logger.warn('canvas: openResource failed (no mounted session?)', error)
      }
    },
    hooks: { selection: selection.source },
  })

  // Stage one of the right-Sidebar registration: the page type itself (guide
  // entry, no address claims). The default band is 'extension', correct for a
  // type shipped from outside the product.
  ctx.effect(() => ctx.sidebarRightTabs.register(canvasDefinition(t)), 'canvas: tab type')

  // Stage two: the detail reader's body under the type's id in the keyed pane seat.
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: CANVAS_TAB_ID,
    locale: NS,
    inject: detailFace,
  }, CanvasDetailView)), 'canvas: detail reader body')

  // The v2 canvas space: one id for the main panel key and the rail row (the
  // shell matches them). Both ride slots.inject, so a host without either
  // seat degrades silently.
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
