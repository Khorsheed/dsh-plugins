/**
 * Composed props contracts for the side chat's two browser surfaces: the
 * right-Sidebar tab body (`sidebar.right.pane.tab`, keyed by package name)
 * and the「引用到侧边对话」entry of `conversation.chat.assistant-actions`.
 *
 * Both are spelled structurally — `PropsRuntime` brings the seat's own
 * standard kit (the tab body's `useTabInfo`, the session scope's
 * `useSessions`), and the business faces are injected per registration, so
 * no seat-owner share leaks into either contract.
 *
 * @module @khorsheed/dsh-sidechat/client
 */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult, TypertRemoteNamespaceMap } from '@deepseek-ai/dsh-typert-protocol'
// Type-only: pulls the generated Remote API (ctx.remote merge + namespace).
import type {} from '@khorsheed/dsh-sidechat/remote'
// Type-only: pulls ui-session's GlobalStandardProps merge (useSessions).
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
// Type-only: pulls ui-chat's SlotMap merge ('conversation.chat.assistant-actions').
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
// Type-only: pulls ui-conversation's SlotMap merge (the same seat's declaration side).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the right-Sidebar SlotMap seat ('sidebar.right.pane.tab').
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
// Type-only: pulls the ui-layout frame's SlotMap merge ('shell.overlay').
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {
  SideChatListResult, SideChatQuoteOutcome, SideChatQuoteRequest,
  SideChatSendOutcome, SideChatSendRequest, SideChatStateOutcome,
} from '../types.ts'
import type { createSideChatDockStore } from './dock-store.ts'
import type {} from './locales.ts'

/** The sidechat Remote namespace, as mounted by this plugin. */
export type SideChatRemote = TypertRemoteNamespaceMap['sidechat']

/**
 * Business face injected into the side-chat tab body. `send` names its
 * session first because the host fences the state write on that session and
 * inherits its cwd for a fresh side session; the reads need neither. The two
 * dock verbs are probed/lazy: `dockAvailable` answers whether the
 * `shell.overlay` seat exists (the button hides without it), `openDock` is a
 * no-op until the dock entry has mounted.
 */
export interface SideChatInjected {
  /** Read one context's full state (label, pending refs, transcript, status). */
  getState: (contextKey: string) => Promise<RemoteResult<SideChatStateOutcome>>
  /** List every known context, most recently active first. */
  listContexts: () => Promise<RemoteResult<SideChatListResult>>
  /** Send one user message into one context (pending refs fold in and clear). */
  send: (sessionId: SessionId, request: SideChatSendRequest) => Promise<RemoteResult<SideChatSendOutcome>>
  /** Whether the floating dock's seat exists (the「弹出为浮层」button's visibility). */
  dockAvailable: () => boolean
  /** Open the floating dock on one context. */
  openDock: (contextKey: string) => void
}

/** Full props of the side-chat tab body. */
export type SideChatViewProps =
  PropsRuntime<'sidebar.right.pane.tab'>
  & InjectFace<SideChatInjected>
  & PropsLocale<'sidechat'>

/**
 * Business face injected into the floating dock (`shell.overlay`). The dock
 * is root-scoped: sends ride the CURRENTLY SELECTED session (the component
 * reads it from `useSessions`), and `closeToTab` hands the context back to
 * the right-Sidebar tab through the official navigation face.
 */
export interface SideChatDockInjected {
  /** Read one context's full state (label, pending refs, transcript, status). */
  getState: (contextKey: string) => Promise<RemoteResult<SideChatStateOutcome>>
  /** List every known context, most recently active first. */
  listContexts: () => Promise<RemoteResult<SideChatListResult>>
  /** Send one user message into one context (pending refs fold in and clear). */
  send: (sessionId: SessionId, request: SideChatSendRequest) => Promise<RemoteResult<SideChatSendOutcome>>
  /** Close the dock and reveal the tab on one context. */
  closeToTab: (contextKey: string) => void
}

/** Full props of the floating dock entry. */
export type SideChatDockProps =
  PropsRuntime<'shell.overlay'>
  & PropsStore<ReturnType<typeof createSideChatDockStore>>
  & InjectFace<SideChatDockInjected>
  & PropsLocale<'sidechat'>

/**
 * Business face injected into the「引用到侧边对话」entry. `quote` names the
 * source session (the wire resolves its agent; the host folds the message
 * text from its journal); `openSideChat` surfaces the tab on that context.
 */
export interface SideChatQuoteInjected {
  /** Land one assistant message as a ref on the session's side chat. */
  quote: (sessionId: SessionId, request: SideChatQuoteRequest) => Promise<RemoteResult<SideChatQuoteOutcome>>
  /** Surface the side-chat tab focused on one context (degrades to a no-op without the right Sidebar). */
  openSideChat: (contextKey: string) => void
}

/** Full props of the「引用到侧边对话」assistant-action entry. */
export type QuoteActionProps =
  PropsRuntime<'conversation.chat.assistant-actions'>
  & InjectFace<SideChatQuoteInjected>
  & PropsLocale<'sidechat'>
