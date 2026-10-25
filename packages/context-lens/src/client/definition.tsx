/**
 * Stage one of this package's right-Sidebar registration: what the
 * `context-lens` tab type IS.
 *
 * The type is a page, not a viewer: it claims no address and is opened by
 * kind — by the session-header utility, by the assistant message's turn
 * action, or from the guide — through `ctx.sidebarRight.openTab(
 * 'context-lens', { params: { turnSeq } })`. Pages deduplicate within a
 * pane, so a repeat open re-navigates the one tab and the body follows
 * `navigation.params`.
 *
 * @module @khorsheed/dsh-context-lens/client
 */
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import { IconRequestInspectorOutlineMedium } from './icons.tsx'
import type {} from './locales.ts'

/** The tab kind this package owns. */
export const REQUEST_INSPECTOR_KIND = 'context-lens'

/** This implementation's identity in the tab system, and the key its body registers under. */
export const REQUEST_INSPECTOR_TAB_ID = '@khorsheed/dsh-context-lens'

/** Navigation params an `openTab` caller hands the tab: which turn to show. */
export interface RequestInspectorTabParams {
  /** 1-based per-session turn number; absent = the latest turn. */
  readonly turnSeq?: number
  /**
   * Inspect ANOTHER session than the one the sidebar belongs to (a room
   * member's child session); `messageId` picks the turn that message closed.
   * The next navigation without a session returns to the sidebar's own.
   */
  readonly sessionId?: string
  readonly messageId?: string
}

declare module '@deepseek-ai/dsh-client-ui-sidebar-right/client' {
  interface SidebarRightTabParamsMap {
    /** The context-lens page's initial turn. */
    'context-lens': RequestInspectorTabParams
  }
}

/**
 * The type's registry definition. No `priority`: the default `extension` band
 * is exactly what a type shipped from outside the product is.
 * @param t - namespace-bound translate, read fresh on every label call.
 * @returns the definition to register.
 */
export function requestInspectorDefinition(t: TranslateNS<'requestInspector'>): SidebarRightTabDefinition {
  return {
    id: REQUEST_INSPECTOR_TAB_ID,
    kind: REQUEST_INSPECTOR_KIND,
    title: () => t('tab.title'),
    guide: [{
      id: REQUEST_INSPECTOR_KIND,
      order: 60,
      title: () => t('tab.title'),
      description: () => t('guide.description'),
      icon: IconRequestInspectorOutlineMedium,
    }],
  }
}
