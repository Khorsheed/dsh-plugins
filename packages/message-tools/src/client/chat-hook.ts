/**
 * Chat snapshot access on host 0.1.2: the chat snapshot lives OUTSIDE the
 * Session snapshot — components read it through the `useChat` session
 * standard prop (ui-chat), the apply world through the conversation binding's
 * chat target (`ctx.uiConversation.binding(sessionId).target('chat')`). The
 * target snapshot is `undefined` until the first subscriber activates the
 * chat view; callers treat that as "no chat yet", never as an error.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ChatSnapshot, UseChat } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { HostObservable, SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the ctx.uiConversation service merge and ui-chat's
// ConversationViewSnapshotMap 'chat' target merge.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'

/** The chat slice the plugin's selectors read. */
export type ChatSlice = ChatSnapshot

/** Selector hook over the chat slice. */
export type ChatSliceHook = SnapshotSelectorHook<ChatSlice>

/**
 * Frozen empty chat snapshot for the degraded render path: a composition
 * without ui-chat never mounts the `conversation.chat.node` slot at all, so
 * this only guards a stray render — hook call order stays stable and every
 * selector reads the empty state.
 */
const EMPTY_CHAT: ChatSlice = {
  order: [],
  nodes: {
    get: () => undefined,
    source: () => ({ getSnapshot: () => undefined, subscribe: () => () => {} }),
    turnDataSource: () => ({ getSnapshot: () => [], subscribe: () => () => {} }),
    processSource: () => ({ getSnapshot: () => undefined, subscribe: () => () => {} }),
    values: () => [],
  },
  locations: { getTurn: () => [], getStep: () => [] },
  navigation: { items: () => [] },
  timeline: { turnOrder: [], turns: new Map() },
  legacy: { nodes: [], turnTimings: new Map(), turnEnds: new Map(), partial: null, runningCalls: [] },
}

/**
 * Pick the live chat hook from the entry's composed props (`useChat` is a
 * session standard prop on 0.1.2), degrading to the frozen empty snapshot
 * when the framework composed none.
 * @param props - the entry's composed props.
 * @returns the chat selector hook.
 */
export function chatHookOf(props: { useChat?: UseChat }): ChatSliceHook {
  const direct = props.useChat
  if (direct !== undefined) return direct
  return selector => selector(EMPTY_CHAT)
}

/**
 * Resolve the apply-world chat source for one session.
 * @param ctx - client root context.
 * @param sessionId - owning session.
 * @returns the conversation binding's chat target (its snapshot is undefined
 *   until the first subscription activates the view), or undefined when the
 *   uiConversation service or the session binding is absent.
 */
export function chatSourceOf(ctx: Context, sessionId: SessionId): HostObservable<ChatSlice | undefined> | undefined {
  const uiConversation = ctx.get('uiConversation')
  if (uiConversation === undefined) return undefined
  try {
    return uiConversation.binding(sessionId).target('chat')
  } catch {
    return undefined // unknown session — the caller's undefined branch
  }
}
