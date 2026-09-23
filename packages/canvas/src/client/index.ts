/**
 * Inspiration canvas, browser half (M3): the right-Sidebar seats in wide mode
 * — one canvas board tab, plus one detail tab per open card (stage ⑧). The
 * main-panel space route is retired: the host's RightbarRoot renders the right
 * Sidebar for the conversation panel only, so a custom main panel makes every
 * right-Sidebar surface fail by construction; the tab is the answer
 * isomorphic with the host's layout.
 *
 * It mounts the canvas Remote through the official `ctx.remote.$mount`
 * channel, registers TWO tab types on the keyed `sidebar.right.pane.tab`
 * seat — `canvas` for the board page and `canvasDetail` for one card's detail
 * (stage ⑧: a detail is a resource of the `canvas` type, so two cards are two
 * tabs and a re-click focuses the tab already showing it) — reports the open
 * canvas to the host (`focusCanvas`, so the MAIN session's canvas tools target
 * it), and fires the wide-mode suggestion once per session (fullscreen right
 * panel + collapsed session list, through the probed layout face — the user's
 * own controls own it from then on). Every seat is probed, never assumed:
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
// Type-only: pulls the ctx.sessions service merge (ISessions) — the tab
// type's preset-visibility criterion reads the current session.
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import { fileAddressFor } from '@deepseek-ai/dsh-util-workspace-path'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import canvasRemote from '@khorsheed/dsh-canvas/remote'
import type { CanvasChatInjected, CanvasRemote, CanvasTabInjected } from './contract.ts'
import {
  CANVAS_DETAIL_KIND, CANVAS_DETAIL_TAB_ID, CANVAS_TAB_ID,
  canvasDefinition, canvasDetailDefinition,
} from './definition.ts'
import { cardDetailAddress, draftDetailAddress } from './detail/detail-address.ts'
import { en, NS, zh } from './locales.ts'
import { CanvasImageSrcs } from './images.ts'
import {
  CanvasTabVisibility, RegistrationToggle, type CanvasPluginInventorySnapshot,
} from './preset-visibility.ts'
import { CanvasSelectionStore } from './space/selection.ts'
import { CanvasDetailTab } from './detail/CanvasDetailTab.tsx'
import { CanvasDetailTitle } from './detail/CanvasDetailTitle.tsx'
import { CanvasTab } from './tab/CanvasTab.tsx'

export { CanvasDetailView } from './detail/CanvasDetailView.tsx'
export { CANVAS_KIND, CANVAS_DETAIL_KIND, CANVAS_DETAIL_TAB_ID, CANVAS_TAB_ID } from './definition.ts'
export { CanvasSelectionStore } from './space/selection.ts'
export { BoardView } from './space/BoardView.tsx'
export { CardTextarea } from './space/CardTextarea.tsx'
export { CanvasTab } from './tab/CanvasTab.tsx'
export { CanvasSwitcher } from './tab/CanvasSwitcher.tsx'
export type {
  CanvasChatInjected, CanvasDetailInjected, CanvasDetailProps, CanvasRemote,
  CanvasTabInjected, CanvasTabProps,
} from './contract.ts'
export * from './paste-table.ts'

/**
 * Required services: slots, the remote channel, the locale, the right-Sidebar
 * faces (the tab-type registry and the navigation service the tab's
 * activation and attachment previews go through), and the session list (the
 * tab type's preset-visibility criterion reads the current session).
 * `remote.canvas` is deliberately NOT an inject: this plugin both mounts the
 * namespace (through `$mount` below) and consumes it, and the Cordis
 * property proxy only resolves services declared in `inject` or provided by
 * an ancestor fiber — declaring it would deadlock the loader. The mount is
 * awaited and the namespace is then read back from the global store with
 * `ctx.get` (the ui-file-preview precedent).
 */
export const inject = ['slots', 'remote', 'locale', 'sidebarRight', 'sidebarRightTabs', 'sessions']

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

  // The image read leg (§10.3): ONE cache for every seat, so a pointer read
  // for one render is already paid for by the next. The reader calls
  // `requireRemote` when it reads, never at construction: a composition
  // without the host half throws inside one read, and the cache records that
  // pointer as unreadable instead of failing the tab.
  const images = new CanvasImageSrcs(ref => requireRemote().imageBytes({ ref }))

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
    // The category catalog (stage ⑤): one write for rename / add / retire, so a
    // retired row and the cards under it can never disagree between two calls.
    setCategories: async (sessionId, request) => touchOnSuccess(await requireRemote().setCategories(sessionId, request)),
    // The layout (stage ⑥): one write for the places, lanes and lines a gesture
    // moved, so a lane drag cannot strand the cards that were inside it.
    setLayout: async (sessionId, request) => touchOnSuccess(await requireRemote().setLayout(sessionId, request)),
    // The image arm (§10.3): the write leg names no session, because there is
    // no board file to fence — the store is content-addressed outside every
    // workspace, and the card that cites the pointer is written by the normal
    // (fenced) patch verb afterwards.
    attachImage: request => requireRemote().attachImage(request),
    images,
    // The detail is a RESOURCE tab of the same dock (stage ⑧): naming the kind
    // is the decision, so the host skips its glob ranking and only `canOpen`
    // applies — and `openResource` still throws on an address outside
    // `dsh-resource://`, which is a wiring mistake, hence the same degrade as
    // `openFile` (no mounted session, no right Sidebar).
    openCardDetail: (canvasId, cardId, heading) => {
      try {
        ctx.sidebarRight.openResource(cardDetailAddress(canvasId, cardId), {
          kind: CANVAS_DETAIL_KIND,
          params: { heading },
        })
      } catch (error) {
        ctx.logger.warn('canvas: openResource(card detail) failed (no mounted session?)', error)
      }
    },
    openCardDraft: (canvasId, kind, heading) => {
      try {
        ctx.sidebarRight.openResource(draftDetailAddress(canvasId), {
          kind: CANVAS_DETAIL_KIND,
          params: { heading, kind },
        })
      } catch (error) {
        ctx.logger.warn('canvas: openResource(card draft) failed (no mounted session?)', error)
      }
    },
    openCanvas: canvasId => { selection.openCanvas(canvasId) },
    focusCanvas: async (sessionId, request) => touchOnSuccess(await requireRemote().focusCanvas(sessionId, request)),
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
    hooks: { selection: selection.source, imageRev: images.source },
  })

  // Stage one of the right-Sidebar registration: the page type itself (guide
  // entry, no address claims). The default band is 'extension', correct for a
  // type shipped from outside the product. The type registers exactly while
  // the current session can reach the canvas tools — root-mounted agent row
  // (the community default) OR the session's preset composition naming it
  // (the writing-mode recipe); every unreadable path fails open. Hidden means
  // NOT registered: the guide enumerates the registry, opened tabs are stored
  // per session, and an unregistered kind renders the host's tab.unavailable
  // fallback.
  const pluginInventory = ctx.get('remote.pluginInventory') as {
    list: () => Promise<RemoteResult<CanvasPluginInventorySnapshot>>
  } | undefined
  const tabVisibility = new CanvasTabVisibility(ctx, pluginInventory)
  ctx.effect(() => {
    // BOTH types ride the one decision: a detail tab with no board to come
    // from is a stranded tab, and an ungranted session must show neither.
    const toggle = new RegistrationToggle(
      () => {
        const disposePage = ctx.sidebarRightTabs.register(canvasDefinition(t))
        const disposeDetail = ctx.sidebarRightTabs.register(canvasDetailDefinition(t))
        return () => { disposePage(); disposeDetail() }
      },
      () => tabVisibility.show(ctx.sessions.list.getSnapshot().current),
    )
    toggle.setReady(true)
    const unsubscribe = tabVisibility.subscribe(() => { toggle.sync() })
    return () => { unsubscribe(); toggle.setReady(false) }
  }, 'canvas: tab type visibility')

  // Stage two: the tab bodies under each type's id in the keyed pane seat (the
  // board page, and since stage ⑧ one detail per card — both from the one face,
  // because a detail is the same package's own reader).
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: CANVAS_TAB_ID,
    locale: NS,
    inject: tabFace,
  }, CanvasTab)), 'canvas: tab body')

  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: CANVAS_DETAIL_TAB_ID,
    locale: NS,
    inject: tabFace,
  }, CanvasDetailTab)), 'canvas: detail tab body')

  // The chip's live text (the host freezes `title` at open time, so the card's
  // heading travels as navigation params and this registrant reads it back).
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab.title',
    key: CANVAS_DETAIL_TAB_ID,
  }, CanvasDetailTitle)), 'canvas: detail tab title')

  return async () => {
    for (const timer of timers) clearTimeout(timer)
    timers.clear()
    await Promise.all(disposers.map(dispose => dispose()))
  }
}
