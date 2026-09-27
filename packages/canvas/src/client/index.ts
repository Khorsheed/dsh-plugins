/**
 * Inspiration canvas, browser half (M3): the right-Sidebar seat in wide mode —
 * ONE tab type holding the whole surface. The main-panel space route is retired:
 * the host's RightbarRoot renders the right Sidebar for the conversation panel
 * only, so a custom main panel makes every right-Sidebar surface fail by
 * construction; the tab is the answer isomorphic with the host's layout.
 *
 * Stage ⑧ had registered a SECOND tab type (`canvasDetail`) so a card could open
 * beside the board. Round 3 item ⑥ took it back: the dock is one chrome layer
 * above the board those cards came from, its chip said 画布 for all of them and
 * its × could not be intercepted. The strip now lives INSIDE the page (see
 * `tab/CanvasTab.tsx`) and the store below is its state, so every verb that used
 * to travel through `ctx.sidebarRight.openResource` is a store write instead.
 *
 * It mounts the canvas Remote through the official `ctx.remote.$mount`
 * channel, registers the page type on the keyed `sidebar.right.pane.tab` seat,
 * mirrors the active inner tab onto that tab's dock chip
 * (`sidebar.right.pane.tab.title`), reports the open canvas to the host
 * (`focusCanvas`, so the MAIN session's canvas tools target it), and fires the
 * wide-mode suggestion once per session (collapse the session list, through the
 * probed layout face — the user's own controls own it from then on). Every seat
 * is probed, never assumed: registrations ride `ctx.slots.inject`, and with no
 * `remote.canvas` mounted the tab still registers and reports the missing half
 * instead of throwing through boot.
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
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { fileAddressFor } from '@deepseek-ai/dsh-util-workspace-path'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import canvasRemote from '@khorsheed/dsh-canvas/remote'
import type { CanvasRemote, CanvasTabInjected, CanvasTalkInjected } from './contract.ts'
import { mergedDraft } from './quote.ts'
import { CANVAS_TAB_ID, canvasDefinition } from './definition.ts'
import { en, NS, zh } from './locales.ts'
import { CanvasImageSrcs } from './images.ts'
import {
  CanvasTabVisibility, RegistrationToggle, type CanvasPluginInventorySnapshot,
} from './preset-visibility.ts'
import { CanvasSelectionStore } from './space/selection.ts'
import { CanvasTab } from './tab/CanvasTab.tsx'
import { CanvasTabTitle } from './tab/CanvasTabTitle.tsx'

export { CanvasDetailView } from './detail/CanvasDetailView.tsx'
export { CANVAS_KIND, CANVAS_TAB_ID } from './definition.ts'
export { CanvasSelectionStore } from './space/selection.ts'
export { BoardView } from './space/BoardView.tsx'
export { CardTextarea } from './space/CardTextarea.tsx'
export { CanvasTab } from './tab/CanvasTab.tsx'
export { CanvasSwitcher } from './tab/CanvasSwitcher.tsx'
export type {
  CanvasDetailInjected, CanvasDetailProps, CanvasRemote,
  CanvasTabInjected, CanvasTabProps, CanvasTalkInjected,
} from './contract.ts'
export * from './paste-table.ts'

/**
 * The on-screen session across host lines: 0.1.6-alpha.2 dropped
 * `SessionListState.current` for per-row `retainedBy.mainView` counts (the
 * `mainView` reference source is declared by ui-session, outside this
 * package's type program — hence the duck shape), while 0.1.5 publishes only
 * `current`. One build reads both.
 * @param list - sessions list snapshot.
 * @returns the main-view session id, or undefined when nothing is on screen.
 */
type SessionListCurrent = SessionListState & {
  current?: SessionId
  byId: Record<SessionId, { id: SessionId; retainedBy?: Readonly<Record<string, number>> }>
}
function mainSessionId(list: SessionListState): SessionId | undefined {
  const view = list as SessionListCurrent
  return Object.values(view.byId).find(s => (s.retainedBy?.mainView ?? 0) > 0)?.id ?? view.current
}

/** The slice of ui-conversation's per-session input the quote gestures use (structural). */
interface ConversationInput {
  readonly state: { getSnapshot(): { draft: string } }
  setDraft(value: string): void
  focus?: () => void
}

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
   * The session's conversation input, when the composition has one. The input
   * is ui-conversation's per-session facade, reached structurally the way the
   * reader package reaches it (never imported: a composition may omit it).
   * `focus` is probed per call, because older host lines lack it.
   */
  const inputFor = (sessionId: SessionId): ConversationInput | undefined => {
    try {
      const scope = ctx.get('sessions')?.scope(sessionId)
      const input = (scope?.get('conversation') as { input?: { for(actx: unknown): unknown } } | undefined)
        ?.input?.for(scope)
      const face = input as Partial<ConversationInput> | undefined
      return typeof face?.setDraft === 'function' && typeof face.state?.getSnapshot === 'function'
        ? face as ConversationInput
        : undefined
    } catch {
      return undefined
    }
  }

  const talkFace: CanvasTalkInjected = {
    talkAvailable: sessionId => inputFor(sessionId) !== undefined,
    quoteToConversation: (sessionId, block) => {
      const input = inputFor(sessionId)
      if (input === undefined) return false
      input.setDraft(mergedDraft(input.state.getSnapshot().draft, block))
      if (typeof input.focus === 'function') input.focus()
      return true
    },
    refreshBoards: () => { selection.touch() },
  }

  const tabFace = (): CanvasTabInjected => ({
    ...talkFace,
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
    // A delete reaches the strip too: a row naming a canvas that no longer
    // exists, or standing on a deleted card, would open onto 「找不到」.
    deleteCanvas: async (sessionId, request) => {
      const result = touchOnSuccess(await requireRemote().deleteCanvas(sessionId, request))
      if (result.ok && result.value.ok) selection.forget(request.canvasId)
      return result
    },
    deleteCard: async (sessionId, request) => {
      const result = touchOnSuccess(await requireRemote().deleteCard(sessionId, request))
      if (result.ok && result.value.ok) selection.forget(request.canvasId, request.cardId)
      return result
    },
    // Manuscripts (成稿): a body write bumps the board's version too (the
    // metadata rides the board), so every reader re-reads the list.
    readManuscript: request => requireRemote().readManuscript(request),
    writeManuscript: async (sessionId, request) => touchOnSuccess(await requireRemote().writeManuscript(sessionId, request)),
    patchManuscript: async (sessionId, request) => touchOnSuccess(await requireRemote().patchManuscript(sessionId, request)),
    deleteManuscript: async (sessionId, request) => {
      const result = touchOnSuccess(await requireRemote().deleteManuscript(sessionId, request))
      if (result.ok && result.value.ok) selection.forget(request.canvasId, undefined, request.manuscriptId)
      return result
    },
    exportManuscript: async (sessionId, request) => touchOnSuccess(await requireRemote().exportManuscript(sessionId, request)),
    openManuscript: (canvasId, manuscriptId, heading) => { selection.openManuscriptTab(canvasId, manuscriptId, heading) },
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
    // The strip is the surface's own state (round 3 item ⑥): a card open is a
    // store write, not a dock navigation. A row is one canvas and a card open
    // moves where that row stands (scheme B); the ids are derived from the
    // canvas (`selection.ts`), so "open it twice, you get one row" needs no
    // cooperation from the caller.
    openCardDetail: (canvasId, cardId, heading) => { selection.openCardTab(canvasId, cardId, heading) },
    openCardDraft: (canvasId, kind, heading) => { selection.openDraftTab(canvasId, kind, heading) },
    activateTab: id => { selection.activate(id) },
    closeTab: id => { selection.close(id) },
    openCanvas: canvasId => { selection.openCanvas(canvasId) },
    backToBoard: canvasId => { selection.backToBoard(canvasId) },
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
    const toggle = new RegistrationToggle(
      () => ctx.sidebarRightTabs.register(canvasDefinition(t)),
      () => tabVisibility.show(mainSessionId(ctx.sessions.list.getSnapshot())),
    )
    toggle.setReady(true)
    const unsubscribe = tabVisibility.subscribe(() => { toggle.sync() })
    return () => { unsubscribe(); toggle.setReady(false) }
  }, 'canvas: tab type visibility')

  // Stage two: the tab body and its chip, both under this package's id in the
  // keyed seats. The chip registers because the surface now holds more than the
  // board: with a card showing, a chip that still says 画布 leaves the reader
  // without a clue which of the dock's tabs they are in.
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: CANVAS_TAB_ID,
    locale: NS,
    inject: tabFace,
  }, CanvasTab)), 'canvas: tab body')

  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab.title',
    key: CANVAS_TAB_ID,
    inject: () => ({ hooks: { selection: selection.source } }),
  }, CanvasTabTitle)), 'canvas: tab chip title')

  return async () => {
    await Promise.all(disposers.map(dispose => dispose()))
  }
}
