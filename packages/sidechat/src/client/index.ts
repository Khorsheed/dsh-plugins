/**
 * Side chat (侧边对话), browser half: the right-Sidebar tab (transcript, ref
 * chips, composer), the「引用到侧边对话」entry in the assistant message's
 * IconActions row, and — M2 — the floating dock (`shell.overlay`) the shared
 * panel also mounts on.
 *
 * It mounts the sidechat Remote through the official `ctx.remote.$mount`
 * channel and surfaces through PROBED seats: the page-type
 * `sidebar.right.pane.tab` entry, the `conversation.chat.assistant-actions`
 * list, and the `shell.overlay` frame layer — all ride `ctx.slots.inject`,
 * so a host that declares none of them simply never mounts the surfaces;
 * with no `remote.sidechat` mounted, the views still register and report the
 * missing half instead of throwing through boot.
 *
 * The tab and the dock meet through the apply-closure controller (the
 * worktrees panel-service pattern): the tab's `openDock` reaches the dock
 * store's actions once the overlay entry's inject attaches them, and the
 * dock's close routes back to the tab through the official right-Sidebar
 * navigation face.
 *
 * @module @khorsheed/dsh-sidechat/client
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the ctx.slots service merge.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the ctx.locale service merge.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the generated Remote API and ctx.remote merge.
import type {} from '@khorsheed/dsh-sidechat/remote'
// Type-only: pulls the ctx.sidebarRightTabs service merge, the right-Sidebar
// SlotMap seat ('sidebar.right.pane.tab'), and the ctx.sidebarRight face.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
// Type-only: pulls ui-chat's SlotMap merge ('conversation.chat.assistant-actions').
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
// Type-only: pulls the ui-layout frame's SlotMap merge ('shell.overlay').
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { BoundActions } from '@deepseek-ai/dsh-client-ui-slots'
import type { ISidebarRight } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import sidechatRemote from '@khorsheed/dsh-sidechat/remote'
import type { SideChatInjected, SideChatQuoteInjected, SideChatDockInjected, SideChatRemote } from './contract.ts'
import { SIDECHAT_KIND, SIDECHAT_TAB_ID, sidechatDefinition } from './definition.ts'
import { createSideChatDockStore } from './dock-store.ts'
import { en, NS, zh } from './locales.ts'
import { QuoteAction } from './QuoteAction.tsx'
import { SideChatDock } from './SideChatDock.tsx'
import { SideChatView } from './SideChatView.tsx'

export { SideChatView } from './SideChatView.tsx'
export { SideChatDock } from './SideChatDock.tsx'
export { SideChatPanel } from './SideChatPanel.tsx'
export type { SideChatPanelProps, SideChatPanelRemote } from './SideChatPanel.tsx'
export { RefChips } from './RefChips.tsx'
export { QuoteAction } from './QuoteAction.tsx'
export { SIDECHAT_KIND, SIDECHAT_TAB_ID, sidechatDefinition } from './definition.ts'
export type { SideChatTabParams } from './definition.ts'
export { createSideChatDockStore } from './dock-store.ts'
export { lastSeenOf, markSeen } from './seen.ts'
export { useOpenWithSurfacer, SURFACE_POLL_MS, SURFACE_NARROW_WIDTH } from './use-open-with-surfacer.ts'
export type { OpenWithSurfacerOptions } from './use-open-with-surfacer.ts'
export type {
  SideChatInjected, SideChatQuoteInjected, SideChatDockInjected, SideChatRemote,
  SideChatViewProps, QuoteActionProps, SideChatDockProps,
} from './contract.ts'

/** Required services: slots, the remote channel, the locale, and the tab-type registry. */
export const inject = ['slots', 'remote', 'locale', 'sidebarRightTabs']

/** The dock store's bound action set (framework-baked, draft params peeled). */
type DockActions = BoundActions<ReturnType<typeof createSideChatDockStore>>

/**
 * The tab↔dock bridge: the dock store's actions are attached by its
 * shell.overlay entry's inject; a tab gesture that lands before that surface
 * ever mounted is a no-op (the worktrees panel-service pattern).
 */
class SideChatDockController {
  #dock: DockActions | undefined

  /** Adopt the dock store's actions. Called from the overlay entry's inject. */
  attach(actions: DockActions): void {
    this.#dock = actions
  }

  /** Open the dock on one context (no-op until the overlay entry mounted). */
  openDock(contextKey: string): void {
    this.#dock?.open(contextKey)
  }
}

/**
 * Client plugin body: mount the Remote, register the dictionaries, then the
 * tab type and its body, the assistant-message quote action, and the dock.
 * @param ctx - client root context.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const disposers: Array<() => Promise<void>> = []
  try {
    disposers.push(await ctx.remote.$mount(sidechatRemote))
  } catch (error) {
    // A Remote already mounted by another composition fails loud at boot; the
    // rest of the plugin still registers.
    /* v8 ignore next -- double-mount is a composition error, not a runtime path */
    ctx.logger.error(error)
  }
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'sidechat: dictionaries')
  const t = ctx.locale.bind(NS)

  // Read lazily and through `ctx.get`: a composition without the host half
  // yields undefined, and the view reports that instead of the plugin
  // pending forever on an inject it cannot satisfy.
  const requireRemote = (): SideChatRemote => {
    const mounted = ctx.get('remote.sidechat') as SideChatRemote | undefined
    if (mounted === undefined) throw new Error('sidechat: the host half is not installed')
    return mounted
  }
  const controller = new SideChatDockController()
  // Surface one context on the right-Sidebar tab: the official navigation
  // face, probed — without it the call is a no-op (never a boot failure).
  const openTabWith = (contextKey: string): void => {
    const sidebarRight = ctx.get('sidebarRight') as ISidebarRight | undefined
    sidebarRight?.openTab(SIDECHAT_KIND, { params: { contextKey } })
  }
  const browserFace = (): SideChatInjected => ({
    getState: contextKey => requireRemote().getState({ contextKey }),
    listContexts: () => requireRemote().listContexts(),
    // The mutating call hands the session to the host: it fences the state
    // write on that session and inherits its cwd for a fresh side session.
    send: (sessionId, request) => requireRemote().send(sessionId, request),
    surfaceHints: () => requireRemote().surfaceHints(),
    // The overlay seat is probed lazily (at the tab body's mount, after the
    // shell's own apply): without it the「弹出为浮层」button simply hides.
    dockAvailable: () => ctx.slots.spec('shell.overlay') !== undefined,
    openDock: (contextKey) => { controller.openDock(contextKey) },
    openTab: openTabWith,
  })
  const quoteFace = (): SideChatQuoteInjected => ({
    quote: (sessionId, request) => requireRemote().quoteMessage(sessionId, request),
    openSideChat: openTabWith,
  })
  const dockFace = (actions: DockActions): SideChatDockInjected => ({
    getState: contextKey => requireRemote().getState({ contextKey }),
    listContexts: () => requireRemote().listContexts(),
    send: (sessionId, request) => requireRemote().send(sessionId, request),
    surfaceHints: () => requireRemote().surfaceHints(),
    openTab: openTabWith,
    // Close the dock AND reveal the tab on the same context: the「回到侧栏
    // tab」gesture is a hand-off, not a dismissal.
    closeToTab: (contextKey) => {
      actions.close()
      openTabWith(contextKey)
    },
  })

  ctx.effect(() => ctx.sidebarRightTabs.register(sidechatDefinition(t)), 'sidechat: tab type')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: SIDECHAT_TAB_ID,
    locale: NS,
    inject: browserFace,
  }, SideChatView)), 'sidechat: sidebar tab body')

  // 「引用到侧边对话」on finalized assistant messages (the ui-message-feedback
  // seat; order 20 leaves the official copy/branch/feedback order untouched).
  ctx.effect(() => ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({
    name: 'conversation.chat.assistant-actions',
    id: 'sidechat-quote',
    order: 20,
    locale: NS,
    inject: quoteFace,
  }, QuoteAction)), 'sidechat: quote action')

  // The floating dock on the frame-wide overlay layer (root scope; degrades
  // silently on a host without the seat — the tab stays the whole surface).
  ctx.effect(() => ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'sidechat-dock',
    order: 150,
    locale: NS,
    store: createSideChatDockStore,
    inject: (actions): SideChatDockInjected => {
      controller.attach(actions)
      return dockFace(actions)
    },
  }, SideChatDock)), 'sidechat: dock overlay')

  return async () => {
    await Promise.all(disposers.map(dispose => dispose()))
  }
}
