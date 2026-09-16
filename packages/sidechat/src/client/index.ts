/**
 * Side chat (侧边对话), browser half: the right-Sidebar tab (transcript, ref
 * chips, composer) and the「引用到侧边对话」entry in the assistant message's
 * IconActions row.
 *
 * It mounts the sidechat Remote through the official `ctx.remote.$mount`
 * channel and surfaces through two PROBED seats: the page-type
 * `sidebar.right.pane.tab` entry and the `conversation.chat.assistant-actions`
 * list — both ride `ctx.slots.inject`, so a host that declares neither simply
 * never mounts the surfaces; with no `remote.sidechat` mounted, the views
 * still register and report the missing half instead of throwing through
 * boot.
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
import type { ISidebarRight } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import sidechatRemote from '@khorsheed/dsh-sidechat/remote'
import type { SideChatInjected, SideChatQuoteInjected, SideChatRemote } from './contract.ts'
import { SIDECHAT_KIND, SIDECHAT_TAB_ID, sidechatDefinition } from './definition.ts'
import { en, NS, zh } from './locales.ts'
import { QuoteAction } from './QuoteAction.tsx'
import { SideChatView } from './SideChatView.tsx'

export { SideChatView } from './SideChatView.tsx'
export { QuoteAction } from './QuoteAction.tsx'
export { SIDECHAT_KIND, SIDECHAT_TAB_ID, sidechatDefinition } from './definition.ts'
export type { SideChatTabParams } from './definition.ts'
export type { SideChatInjected, SideChatQuoteInjected, SideChatRemote, SideChatViewProps, QuoteActionProps } from './contract.ts'

/** Required services: slots, the remote channel, the locale, and the tab-type registry. */
export const inject = ['slots', 'remote', 'locale', 'sidebarRightTabs']

/**
 * Client plugin body: mount the Remote, register the dictionaries, then the
 * tab type and its body, then the assistant-message quote action.
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
  const browserFace = (): SideChatInjected => ({
    getState: contextKey => requireRemote().getState({ contextKey }),
    listContexts: () => requireRemote().listContexts(),
    // The mutating call hands the session to the host: it fences the state
    // write on that session and inherits its cwd for a fresh side session.
    send: (sessionId, request) => requireRemote().send(sessionId, request),
  })
  const quoteFace = (): SideChatQuoteInjected => ({
    quote: (sessionId, request) => requireRemote().quoteMessage(sessionId, request),
    // Programmatic tab activation: the official right-Sidebar navigation face,
    // probed — without it the ref still lands, only the reveal is skipped.
    openSideChat: (contextKey) => {
      const sidebarRight = ctx.get('sidebarRight') as ISidebarRight | undefined
      sidebarRight?.openTab(SIDECHAT_KIND, { params: { contextKey } })
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

  return async () => {
    await Promise.all(disposers.map(dispose => dispose()))
  }
}
