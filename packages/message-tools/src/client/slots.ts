/**
 * Slot-facing types of the message-tools client half: the injected action
 * face and the composed props of its two `conversation.chat.node` entries.
 */
import type { ModelSelection } from '@deepseek-ai/dsh-api-remotes/client'
import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls ui-chat's SlotMap merge ('conversation.chat.node') and its
// useChat session standard prop.
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
// Type-only: pulls this plugin's LocaleNamespaceMap and ChatNodeDataMap merges.
import type {} from './locales.ts'
import type {} from './withdrawn-node.ts'

/** Injected action face of the shadowed user-message entry. */
export interface MessageToolsInjected {
  hooks: {
    /** The session's shared model directory (the composer seat's own store; a frozen empty stub when ui-model-selection is absent). */
    modelDirectory: HostObservable<ModelDirectoryState>
  }
  /** Whether the editor's model chip can switch models in this session. */
  modelsAvailable: boolean
  /** Refresh the advisory model directory (fire-and-forget; errors land on the store). */
  loadModels: () => void
  /** Submit a provider/model/effort selection; resolves to host acceptance. */
  selectModel: (selection: ModelSelection) => Promise<boolean>
  /**
   * Edit one user message in place: replace it (and the surface tail) with
   * the edited text, then start the regeneration turn.
   */
  editMessage: (targetSeq: number, text: string) => Promise<void>
  /** Withdraw one user message and everything after it. */
  withdrawMessage: (targetSeq: number) => Promise<void>
  /**
   * Backfill text into the session's composer draft (append on a new line
   * when the draft is non-empty) and surface an info notice; never sends.
   * Wired to a successful withdrawal — the「重新编辑」divider action shares
   * the same path.
   */
  backfillDraft: (text: string) => void
}

/** Full props of the shadowed 'user'/'steering'/'message-tools-edited'/'message-tools-restored' renderer (all keys share it). */
export type UserMessageViewProps =
  PropsRuntime<'conversation.chat.node', 'user' | 'steering' | 'message-tools-edited' | 'message-tools-restored'>
  & InjectFace<MessageToolsInjected>
  & PropsLocale<'message-tools'>

/** Injected action face of the withdrawal divider entry. */
export interface WithdrawnDividerInjected {
  /** Restore the span's withdrawn user message as a fresh tail message. */
  restoreMessage: (targetSeq: number) => Promise<void>
}

/** Full props of the withdrawal divider renderer. */
export type WithdrawnDividerViewProps =
  PropsRuntime<'conversation.chat.node', 'message-tools-withdrawn'>
  & InjectFace<WithdrawnDividerInjected>
  & PropsLocale<'message-tools'>
