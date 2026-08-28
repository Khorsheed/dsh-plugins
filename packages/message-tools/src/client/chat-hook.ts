/**
 * Dual-host-line chat snapshot access. rc hosts carry the chat snapshot
 * inside the session snapshot (`useSession(...).chat` in components,
 * `Session.getSnapshot().chat` in the apply world); host 0.1.2 split it out —
 * components get the `useChat` session standard prop (ui-chat), the apply
 * world reads `ctx.uiConversation.binding(sessionId).target('chat')`. The
 * 0.1.2 snapshot carries the same field names (`order`, `nodes`, `timeline`)
 * at its top level. The seat choice is fixed per host line, so hook call
 * order never varies within a host.
 */
import type { ClientContext, ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type { HostObservable, SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'

/** The chat slice the plugin's selectors read (the session snapshot's `chat` field on rc hosts). */
export type ChatSlice = ConversationSnapshot['chat']

/** Selector hook over the chat slice (identical field names on both host lines). */
export type ChatSliceHook = SnapshotSelectorHook<ChatSlice>

/**
 * Pick the live chat hook for this host line.
 * @param props - the entry's composed props (useChat present only on 0.1.2).
 * @returns the 0.1.2 `useChat` prop when present, else a `useSession` wrapper
 *   projecting the rc `chat` slice.
 */
export function chatHookOf(props: { useSession: SnapshotSelectorHook<ConversationSnapshot> }): ChatSliceHook {
  const direct = (props as unknown as { useChat?: SnapshotSelectorHook<unknown> }).useChat
  const { useSession } = props
  if (direct !== undefined) return direct as ChatSliceHook
  return <S,>(selector: (chat: ChatSlice) => S, equal?: (a: S, b: S) => boolean): S =>
    useSession(snapshot => selector(snapshot.chat), equal)
}

/** Structural face of the 0.1.2 uiConversation service (absent on rc hosts). */
interface UiConversationProbe {
  binding(sessionId: SessionId): { target(target: 'chat'): HostObservable<unknown> }
}

/**
 * Resolve the apply-world chat source for one session on either host line.
 * @param ctx - client root context.
 * @param sessionId - owning session.
 * @returns an observable chat-slice source: the 0.1.2 conversation binding's
 *   chat target when the uiConversation service exists, else a projection
 *   over the rc Session snapshot; undefined while the session is unbound.
 */
export function chatSourceOf(ctx: ClientContext, sessionId: SessionId): HostObservable<ChatSlice> | undefined {
  const uiConversation = (ctx.get.bind(ctx) as (name: string) => unknown)('uiConversation') as UiConversationProbe | undefined
  if (uiConversation !== undefined) {
    let binding: ReturnType<UiConversationProbe['binding']>
    try {
      binding = uiConversation.binding(sessionId)
    } catch {
      return undefined // unknown session — the caller's undefined branch
    }
    const source = binding.target('chat')
    return {
      getSnapshot: () => source.getSnapshot() as ChatSlice,
      subscribe: listener => source.subscribe(listener),
    }
  }
  const session = ctx.sessions.binding(sessionId)?.session
  if (session === undefined) return undefined
  return {
    getSnapshot: () => session.getSnapshot().chat,
    subscribe: listener => session.subscribe(listener),
  }
}
