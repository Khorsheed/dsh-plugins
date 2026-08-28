/**
 * Dual-host-line chat snapshot hook. rc hosts carry the chat snapshot inside
 * the session snapshot (`useSession(...).chat`); host 0.1.2 split it out into
 * the `useChat` session standard prop (ui-chat, upstream the chat package
 * split) — its snapshot carries the same field names (`order`, `nodes`,
 * `timeline`) at the top level. The prop choice is fixed per host line, so
 * the hook call order never varies within a host.
 */
import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'

/** The chat slice the panel's selectors read (the session snapshot's `chat` field on rc hosts). */
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
