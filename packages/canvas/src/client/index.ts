/**
 * Inspiration canvas, browser half (M3): the right-Sidebar canvas tab in
 * wide mode — the ONLY seat (the main-panel space route is retired: the
 * host's RightbarRoot renders the right Sidebar for the conversation panel
 * only, so a custom main panel makes every right-Sidebar surface fail by
 * construction; the tab is the answer isomorphic with the host's layout).
 *
 * It mounts the canvas Remote through the official `ctx.remote.$mount`
 * channel, registers the `canvas` tab type and its body on the keyed
 * `sidebar.right.pane.tab` seat, reports the open canvas to the host
 * (`focusCanvas`, so the MAIN session's canvas tools target it), and fires
 * the wide-mode suggestion once per session (fullscreen right panel +
 * collapsed session list, through the probed layout face — the user's own
 * controls own it from then on). Every seat is probed, never assumed:
 * registrations ride `ctx.slots.inject`, and with no `remote.canvas` mounted
 * the tab still registers and reports the missing half instead of throwing
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
// Type-only: pulls the ctx.sidebarRight/ctx.sidebarRightTabs service merges
// and the right-Sidebar SlotMap seat ('sidebar.right.pane.tab').
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { fileAddressFor } from '@deepseek-ai/dsh-util-workspace-path'
import canvasRemote from '@khorsheed/dsh-canvas/remote'
import type { CanvasChatInjected, CanvasRemote, CanvasTabInjected } from './contract.ts'
import { CANVAS_TAB_ID, canvasDefinition } from './definition.ts'
import { en, NS, zh } from './locales.ts'
import { CanvasSelectionStore } from './space/selection.ts'
import { CanvasTab } from './tab/CanvasTab.tsx'

export { CanvasDetailView } from './detail/CanvasDetailView.tsx'
export { CANVAS_KIND, CANVAS_TAB_ID } from './definition.ts'
export { CanvasSelectionStore } from './space/selection.ts'
export { BoardView } from './space/BoardView.tsx'
export { CardTextarea } from './space/CardTextarea.tsx'
export { CanvasTab } from './tab/CanvasTab.tsx'
export { CanvasSwitcher } from './tab/CanvasSwitcher.tsx'
export { DraftView } from './tab/DraftView.tsx'
export type {
  CanvasChatInjected, CanvasDetailInjected, CanvasDetailProps, CanvasRemote,
  CanvasTabInjected, CanvasTabProps,
} from './contract.ts'
export * from './paste-table.ts'

/**
 * Required services: slots, the remote channel, the locale, and the
 * right-Sidebar faces (the tab-type registry and the navigation service the
 * tab's activation and attachment previews go through).
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
 * tab type and its body.
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

  // The selection/freshness store: one instance, published into the tab's face.
  const selection = new CanvasSelectionStore()
  /** Sessions already handed the wide-mode suggestion (one shot each). */
  const wideSuggested = new Set<string>()

  // Read lazily and through `ctx.get`: a composition without the host half
  // yields undefined, and the view reports that instead of the plugin
  // pending forever on an inject it cannot satisfy.
  const requireRemote = (): CanvasRemote => {
    const mounted = ctx.get('remote.canvas') as CanvasRemote | undefined
    if (mounted === undefined) throw new Error('canvas: the host half is not installed')
    return mounted
  }

  /**
   * Every mutating wrapper in the face lands here: a landed board mutation
   * touches the shared store, so every reader re-reads. (The mutating view
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
   * every reader re-reads. The sidechat namespace is probed through
   * `ctx.get` (never injected, never imported — a structural mirror of
   * `getState`); without it the board simply refreshes on the next gesture.
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

  const tabFace = (): CanvasTabInjected => ({
    ...chatFace,
    listCanvases: () => requireRemote().listCanvases(),
    readBoard: request => requireRemote().readBoard(request),
    probeV1Pad: request => requireRemote().list(request),
    openFile: (sessionId, cwd, path) => {
      try {
        ctx.sidebarRight.openResource(fileAddressFor(sessionId, cwd, path))
      } catch (error) {
        ctx.logger.warn('canvas: openResource failed (no mounted session?)', error)
      }
    },
    // The mutating calls hand the TAB's session to the host (the tab is
    // session scope; the fence resolves that session's mode).
    createCanvas: async (sessionId, request) => touchOnSuccess(await requireRemote().createCanvas(sessionId, request)),
    putCard: async (sessionId, request) => touchOnSuccess(await requireRemote().putCard(sessionId, request)),
    patchCard: async (sessionId, request) => touchOnSuccess(await requireRemote().patchCard(sessionId, request)),
    addComment: async (sessionId, request) => touchOnSuccess(await requireRemote().addComment(sessionId, request)),
    archiveCanvas: async (sessionId, request) => touchOnSuccess(await requireRemote().archiveCanvas(sessionId, request)),
    importV1: async (sessionId, request) => touchOnSuccess(await requireRemote().importV1(sessionId, request)),
    selectCard: (canvasId, cardId) => { selection.select(canvasId, cardId) },
    openCanvas: canvasId => { selection.openCanvas(canvasId) },
    clearCard: () => { selection.clearCard() },
    focusCanvas: async (sessionId, request) => touchOnSuccess(await requireRemote().focusCanvas(sessionId, request)),
    readDraft: request => requireRemote().readDraft(request),
    writeDraft: async (sessionId, request) => touchOnSuccess(await requireRemote().writeDraft(sessionId, request)),
    // The one-shot layout suggestion (M3.1): ONLY the session-list collapse
    // — the fullscreen suggestion is gone (the host's fullscreen hides the
    // right panel's resize handle, so it can never be a default suggestion;
    // the user adjusts the width by hand and the layout remembers). Gated on
    // the frame's collapsed marker: never a blind toggle, never re-forced.
    suggestWideMode: (sessionId) => {
      if (wideSuggested.has(String(sessionId))) return
      wideSuggested.add(String(sessionId))
      try {
        const layout = ctx.get('layout') as { toggleSidebar?: () => void } | undefined
        if (layout === undefined) return
        const frame = document.querySelector('[data-side]')
        if (frame !== null && !frame.hasAttribute('data-sidebar-collapsed')) layout.toggleSidebar?.()
      } catch {
        // A suggestion, never a failure: the user can widen the panel by hand.
      }
    },
    hooks: { selection: selection.source },
  })

  // Stage one of the right-Sidebar registration: the page type itself (guide
  // entry, no address claims). The default band is 'extension', correct for a
  // type shipped from outside the product.
  ctx.effect(() => ctx.sidebarRightTabs.register(canvasDefinition(t)), 'canvas: tab type')

  // Stage two: the tab body under the type's id in the keyed pane seat.
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: CANVAS_TAB_ID,
    locale: NS,
    inject: tabFace,
  }, CanvasTab)), 'canvas: tab body')

  return async () => {
    for (const timer of timers) clearTimeout(timer)
    timers.clear()
    await Promise.all(disposers.map(dispose => dispose()))
  }
}
