/**
 * Slot-facing types of the context-lens client half: the injected faces
 * and the composed props of its three entries — the right-Sidebar page tab
 * (`sidebar.right.pane.tab`), the per-turn icon in the assistant message's
 * action row (`conversation.chat.assistant-actions`), and the session-header
 * utility (`conversation.session.header.utilities`).
 */
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type {
  InjectFace, PropsLocale, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult, TypertRemoteNamespaceMap } from '@deepseek-ai/dsh-typert-protocol'
// Type-only: pulls the generated Remote API and the ctx.remote merge.
import type {} from '@khorsheed/dsh-context-lens/remote'
// Type-only: pulls ui-chat's SlotMap merge ('conversation.chat.assistant-actions').
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
// Type-only: pulls ui-conversation's SlotMap merge
// ('conversation.session.header.utilities').
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls ui-session's SessionStandardProps merge (sessionId).
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
// Type-only: pulls the right-Sidebar SlotMap seats ('sidebar.right.pane.tab')
// and the tab-params map this package merges into.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
// Type-only: pulls this plugin's LocaleNamespaceMap merge.
import type {} from './locales.ts'
import type {
  SessionTrend, CapturedRequest, ListTurnsResult, ScopedRefusal, TurnOverview, TurnTiming,
} from '../types.ts'

/** The requestInspector Remote namespace (as mounted by this plugin). */
export type InspectorRemote = TypertRemoteNamespaceMap['requestInspector']

/** Business face injected into the right-Sidebar tab body. */
export interface InspectorTabInjected {
  getSessionTrend?: (sessionId: SessionId) => Promise<RemoteResult<SessionTrend>>
  /** Light turn list of one session plus its backfill watermark, newest last. */
  listTurns: (sessionId: SessionId) => Promise<RemoteResult<ListTurnsResult>>
  /**
   * Page the chat's loaded history back until it covers log `seq` (the
   * session's own jump loader, the one message-timeline uses). Absent on a
   * host without a session binding; a jump then only scrolls what is loaded.
   */
  loadThrough?: (sessionId: SessionId, seq: number) => Promise<void>
  /** Move the loaded window to the turns ending at `end` (latest when null); answers the new list. */
  loadTurns?: (sessionId: SessionId, end: number | null) => Promise<RemoteResult<ListTurnsResult>>
  /** One turn's scope/request overview — the left column, no segments. */
  getTurn: (sessionId: SessionId, turnSeq: number) => Promise<RemoteResult<TurnOverview | undefined>>
  /**
   * One request's full four-segment breakdown — the right column. The
   * {@link ScopedRefusal} half only answers a query that carried a scope
   * filter; the panel never sends one and narrows it away at the call site.
   */
  getRequest: (sessionId: SessionId, seq: number) => Promise<RemoteResult<CapturedRequest | ScopedRefusal | undefined>>
  /** One turn's whole-turn timing aggregation — the 耗时分布 tab. */
  getTurnTiming: (sessionId: SessionId, turnSeq: number) => Promise<RemoteResult<TurnTiming | undefined>>
}

/** Full props of the right-Sidebar tab body entry. */
export type InspectorTabProps =
  PropsRuntime<'sidebar.right.pane.tab'>
  & InjectFace<InspectorTabInjected>
  & PropsLocale<'requestInspector'>

/**
 * Business face injected into the assistant message's turn action: resolve
 * the message's turn (`TurnListItem.closingMessageId`, latest-turn fallback)
 * and open the inspector tab on it.
 */
export interface InspectorActionInjected {
  /** Resolve `messageId`'s turn and open the tab there. Never throws. */
  open: (sessionId: SessionId, messageId: string) => Promise<void>
}

/** Full props of the assistant-message turn action entry. */
export type InspectorActionProps =
  PropsRuntime<'conversation.chat.assistant-actions'>
  & InjectFace<InspectorActionInjected>
  & PropsLocale<'requestInspector'>

/** Business face injected into the session-header utility: open the tab at the latest turn. */
export interface InspectorUtilityInjected {
  /** Open the inspector tab at the session's latest turn. Never throws. */
  openLatest: (sessionId: SessionId) => void
}

/** Full props of the session-header utility entry. */
export type InspectorUtilityProps =
  PropsRuntime<'conversation.session.header.utilities'>
  & InjectFace<InspectorUtilityInjected>
  & PropsLocale<'requestInspector'>
