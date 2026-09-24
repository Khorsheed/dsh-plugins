/**
 * Stage one of this package's right-Sidebar registration (0.1.5+): what the
 * `sidechat` tab type is.
 *
 * The type is a page, not a viewer: it claims no address and is opened by
 * kind — by the guide's capsule, or programmatically by the quote action (and
 * by future consumers) through `ctx.sidebarRight.openTab('sidechat', {
 * params: { contextKey } })`. Pages deduplicate within a pane, so re-opening
 * re-navigates the one tab and the body follows `navigation.params`.
 *
 * @module @khorsheed/dsh-sidechat/client
 */
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import { IconNewChatOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from './locales.ts'

/** The tab kind this package owns. */
export const SIDECHAT_KIND = 'sidechat'

/** This implementation's identity in the tab system, and the key its body registers under. */
export const SIDECHAT_TAB_ID = '@khorsheed/dsh-sidechat'

/** Navigation params an `openTab` caller hands the tab: which context to show. */
export interface SideChatTabParams {
  readonly contextKey?: string
}

declare module '@deepseek-ai/dsh-client-ui-sidebar-right/client' {
  interface SidebarRightTabParamsMap {
    /** The side chat page's context selection. */
    sidechat: SideChatTabParams
  }
}

/**
 * The type's registry definition. No `priority`: the default `extension` band
 * is exactly what a type shipped from outside the product is.
 * @param t - namespace-bound translate, read fresh on every label call.
 * @returns the definition to register.
 */
export function sidechatDefinition(t: TranslateNS<'sidechat'>): SidebarRightTabDefinition {
  return {
    id: SIDECHAT_TAB_ID,
    kind: SIDECHAT_KIND,
    title: () => t('tab.label'),
    guide: [{
      id: SIDECHAT_KIND,
      order: 50,
      title: () => t('tab.label'),
      description: () => t('guide.description'),
      icon: IconNewChatOutlineMedium,
    }],
  }
}
