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
import { IconRequestInspectorOutlineMedium } from './icons-local.tsx'
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
  /** A room decision (`room/decision` id): opens the turn holding it on the 房间 tab, that call selected. */
  readonly roomDecision?: string
  /**
   * Show one tool call in this session's conversation (a room lens handed it
   * over after switching to the member's session): select the call's turn,
   * then page, unfold and land on the call.
   */
  readonly locateCall?: {
    readonly callId: string
    /** The call's own host turn: where history is paged back to. */
    readonly hostTurn?: number
    /** The request the reader was on (start time, request number): selected, so both lenses show the same context. */
    readonly request?: { readonly startedAt: number; readonly requestNumber?: number }
    /** The session this call is for; another session's lens ignores the navigation. */
    readonly session?: string
    /** The reader's filter and open row on that request: applied to the same request here. */
    readonly view?: import('./member-jump.ts').ReadingView
  }
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
