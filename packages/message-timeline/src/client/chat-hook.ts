/**
 * Chat snapshot hook seat. Host 0.1.2 split the chat snapshot out of the
 * session snapshot into the `useChat` session standard prop (ui-chat); its
 * snapshot carries the fields the panel reads (`order`, `nodes`) at the top
 * level. The rc-line `useSession(...).chat` seat went away with the baseline
 * flip, so there is no second arm: the helper reads `useChat` and degrades to
 * an empty slice (panel hidden, never a throw) when the prop is absent.
 */
import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'

/**
 * The chat slice the panel's selectors read — the narrow face of ui-chat's
 * ChatSnapshot the rail depends on (a structural subset, so the official
 * `UseChat` hook is directly assignable).
 */
export interface ChatSlice {
  /** Visible chat node keys in render order. */
  readonly order: readonly string[]
  /** Live per-key node store. */
  readonly nodes: {
    get(key: string): ChatConversationViewNode | undefined
    values(): readonly ChatConversationViewNode[]
  }
}

/** Selector hook over the chat slice. */
export type ChatSliceHook = SnapshotSelectorHook<ChatSlice>

/** Empty slice behind the absent-prop degrade: no rows, so the panel hides. */
const EMPTY_SLICE: ChatSlice = {
  order: [],
  nodes: { get: () => undefined, values: () => [] },
}

/** Constant hook answering every selector from the empty slice. */
const EMPTY_HOOK: ChatSliceHook = <S,>(selector: (chat: ChatSlice) => S): S => selector(EMPTY_SLICE)

/**
 * Pick the live chat hook for this entry.
 * @param props - the entry's composed props (useChat present on 0.1.2 hosts).
 * @returns the `useChat` prop, or the empty-slice hook when the seat is absent.
 */
export function chatHookOf(props: { useChat?: SnapshotSelectorHook<ChatSlice> }): ChatSliceHook {
  return props.useChat ?? EMPTY_HOOK
}
