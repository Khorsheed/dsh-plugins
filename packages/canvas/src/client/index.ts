/**
 * Inspiration canvas, browser half: the v2 canvas space (主题画布空间), its
 * card-detail reader, and — M2 — the chat integration through the side-chat
 * seam.
 *
 * It mounts the canvas Remote through the official `ctx.remote.$mount`
 * channel and surfaces twice: as a root-level space (the keyed `main` panel
 * 'canvas' plus its `sidebar.panellist` rail row) and as the page-type
 * `sidebar.right.pane.tab` entry (the card-detail reader). All four
 * registrations ride the preset-visibility toggles (M2's self-hide: hidden
 * when the CURRENT session's preset composition does not name this package's
 * row, fail-OPEN everywhere else — a preset-less profile never loses the
 * space).
 *
 * The chat edge is ONE-WAY and probed: `remote.canvas.askAgent` primes the
 * canvas's side-chat context host-side; the client only activates the
 * side-chat tab through the official `openTab` (params mirrored
 * structurally — the sidechat package is never imported) and watches the
 * turn through a probed `remote.sidechat.getState` so the board re-reads as
 * the agent's tool calls land. Every probe degrades: no side-chat → every
 * chat entry hides and the board keeps working.
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
import type { CanvasChatInjected, CanvasDetailInjected, CanvasRemote, CanvasSpaceInjected } from './contract.ts'
import { CANVAS_KIND, CANVAS_TAB_ID, canvasDefinition } from './definition.ts'
import { en, NS, zh } from './locales.ts'
import { CanvasPresetVisibility, RegistrationToggle } from './preset-visibility.ts'
import { CanvasSpacePage } from './space/CanvasSpacePage.tsx'
import { CANVAS_PANEL_ID, CanvasNavIcon } from './space/definition.tsx'
import { CanvasSelectionStore } from './space/selection.ts'

export { CanvasDetailView } from './detail/CanvasDetailView.tsx'
export { CANVAS_KIND, CANVAS_TAB_ID } from './definition.ts'
export { CanvasPresetVisibility, CANVAS_ROW_MODULE, RegistrationToggle } from './preset-visibility.ts'
export { CanvasSpacePage } from './space/CanvasSpacePage.tsx'
export { BoardView } from './space/BoardView.tsx'
export { CardTextarea } from './space/CardTextarea.tsx'
export { CANVAS_PANEL_ID, CanvasNavIcon } from './space/definition.tsx'
export { CanvasSelectionStore } from './space/selection.ts'
export type {
  CanvasChatInjected, CanvasDetailInjected, CanvasDetailProps, CanvasRemote,
  CanvasSpaceInjected, CanvasSpacePageProps,
} from './contract.ts'
export * from './paste-table.ts'

/**
 * Required services: slots, sessions, the remote channel, the locale, and the
 * right-Sidebar faces (the tab-type registry and the navigation service the
 * detail tab's activation and attachment previews go through).
 * `remote.canvas` is deliberately NOT an inject: this plugin both mounts the
 * namespace (through `$mount` below) and consumes it, and the Cordis
 * property proxy only resolves services declared in `inject` or provided by
 * an ancestor fiber — declaring it would deadlock the loader. The mount is
 * awaited and the namespace is then read back from the global store with
 * `ctx.get` (the ui-file-preview precedent).
 */
export const inject = ['slots', 'remote', 'locale', 'sessions', 'sidebarRight', 'sidebarRightTabs']

/**
 * Client plugin body: mount the Remote, register the dictionaries, then the
 * four visibility-gated registrations (detail tab type + body, space main
 * panel + rail row).
 * @param ctx - client root context.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const disposers: Array<() => Promise<void>> = []
  const timers = new Set<ReturnType<typeof setTimeout>>()
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
   * Watch one sent turn: while the side-chat context runs, the agent's tool
   * calls land on the host board, so the shared rev is touched per poll and
   * both seats re-read. The sidechat namespace is probed through `ctx.get`
   * (never injected, never imported — a structural mirror of `getState`);
   * without it the board simply refreshes on the next gesture.
   */
  const watchTurn = (contextKey: string): void => {
    const sidechat = ctx.get('remote.sidechat') as {
      getState?: (key: string) => Promise<
        | { ok: true; value: { ok: true; state: { status: string } } | { ok: false } }
        | { ok: false }
      >
    } | undefined
    if (sidechat?.getState === undefined) return
    const getState = sidechat.getState.bind(sidechat)
    let polls = 0
    const tick = async (): Promise<void> => {
      polls += 1
      try {
        const result = await getState(contextKey)
        const status = result.ok && result.value.ok ? result.value.state.status : undefined
        if (status === 'running' || status === 'idle') selection.touch()
        if (status === 'running' && polls < 60) {
          const timer = setTimeout(() => {
            timers.delete(timer)
            void tick()
          }, 2000)
          timers.add(timer)
        }
      } catch {
        // A failed poll ends the watch silently; the next gesture refreshes.
      }
    }
    const first = setTimeout(() => {
      timers.delete(first)
      void tick()
    }, 1500)
    timers.add(first)
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

  const chatFace: CanvasChatInjected = {
    askAgent: async (sessionId, request) => {
      const result = touchOnSuccess(await requireRemote().askAgent(sessionId, request))
      if (result.ok && result.value.ok && result.value.sent) watchTurn(result.value.contextKey)
      return result
    },
    chatStatus: () => requireRemote().chatStatus(),
    openSideChat: contextKey => {
      try {
        // The side-chat kind's params are ITS contract; the call is mirrored
        // structurally — the package is never imported (the one edge is the
        // probed service, declared in dsh.references).
        ;(ctx.sidebarRight as unknown as {
          openTab(kind: string, options?: { params?: Record<string, unknown> }): void
        }).openTab('sidechat', { params: { contextKey } })
      } catch (error) {
        ctx.logger.warn('canvas: openTab(sidechat) failed (no mounted session?)', error)
      }
    },
  }

  const spaceFace = (): CanvasSpaceInjected => ({
    ...chatFace,
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
    ...chatFace,
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

  /* ------------------------- the preset-visibility self-hide (M2, fail-open) */

  const visibility = new CanvasPresetVisibility(ctx)
  const showSpace = (): boolean => visibility.show(ctx.sessions.list.getSnapshot().current)
  // Hiding the ACTIVE main panel would strand the frame on an unregistered
  // key: leave it first (the layout face is probed, never injected).
  const leaveCanvasPanel = (): void => {
    try {
      (ctx.get('layout') as { selectPanel?: (id: null) => void } | undefined)?.selectPanel?.(null)
    } catch { /* the next navigation re-selects; nothing to repair */ }
  }

  const mainToggle = new RegistrationToggle(
    () => ctx.slots.register({
      name: 'main',
      key: CANVAS_PANEL_ID,
      locale: NS,
      inject: spaceFace,
    }, CanvasSpacePage),
    showSpace,
    leaveCanvasPanel,
  )
  ctx.slots.inject('main', () => {
    mainToggle.setReady(true)
    return () => { mainToggle.setReady(false) }
  })

  const panelToggle = new RegistrationToggle(
    () => ctx.slots.register({
      name: 'sidebar.panellist',
      id: CANVAS_PANEL_ID,
      order: 100,
      label: () => t('space.nav'),
      locale: NS,
    }, CanvasNavIcon),
    showSpace,
  )
  ctx.slots.inject('sidebar.panellist', () => {
    panelToggle.setReady(true)
    return () => { panelToggle.setReady(false) }
  })

  // The tab type registration owns no slot arm, so its toggle is ready at once.
  const typeToggle = new RegistrationToggle(
    () => ctx.sidebarRightTabs.register(canvasDefinition(t)),
    showSpace,
  )
  typeToggle.setReady(true)

  const bodyToggle = new RegistrationToggle(
    () => ctx.slots.register({
      name: 'sidebar.right.pane.tab',
      key: CANVAS_TAB_ID,
      locale: NS,
      inject: detailFace,
    }, CanvasDetailView),
    showSpace,
  )
  ctx.slots.inject('sidebar.right.pane.tab', () => {
    bodyToggle.setReady(true)
    return () => { bodyToggle.setReady(false) }
  })

  ctx.effect(() => visibility.subscribe(() => {
    mainToggle.sync()
    panelToggle.sync()
    typeToggle.sync()
    bodyToggle.sync()
  }), 'canvas: space visibility')

  return async () => {
    for (const timer of timers) clearTimeout(timer)
    timers.clear()
    await Promise.all(disposers.map(dispose => dispose()))
  }
}
