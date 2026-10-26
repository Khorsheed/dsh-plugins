/**
 * Wire vocabulary shared by the messageTools Host Remote and its browser
 * callers. Types only: the generated Remote codecs import this module
 * type-side, and the client bundle never inlines host runtime code.
 * @module @khorsheed/dsh-client-message-tools/types
 */
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/**
 * Withdraw one user message: hide it and everything logged after it from the
 * model surface and the chat projection.
 */
export interface MessageToolsWithdrawRequest {
  /** Session that owns the target message. */
  readonly sessionId: SessionId
  /** Seq of the append-surface `user/message` event to withdraw. */
  readonly targetSeq: number
}

/** What a landed withdrawal appended. */
export interface MessageToolsWithdrawal {
  /** Seq of the replacement event now standing in for the withdrawn span. */
  readonly replacementSeq: number
  /** Count of surface nodes the replacement shadows. */
  readonly shadowedCount: number
}

/** Withdrawal failure vocabulary (closed union). */
export type MessageToolsWithdrawFailure =
  | { readonly code: 'session-not-found' }
  | { readonly code: 'target-not-found' }
  | { readonly code: 'not-a-user-message' }
  | { readonly code: 'already-withdrawn' }

/** Withdrawal outcome: a landed receipt or a rejected failure. */
export type MessageToolsWithdrawResult =
  | { readonly ok: true; readonly value: MessageToolsWithdrawal }
  | { readonly ok: false; readonly error: MessageToolsWithdrawFailure }

/**
 * Restore a withdrawn user message: replay its content as a fresh user
 * message at the conversation tail (positional restore is impossible — see
 * the package README).
 */
export interface MessageToolsRestoreRequest {
  /** Session that owns the withdrawn message. */
  readonly sessionId: SessionId
  /** Seq of the withdrawn append-surface `user/message` event to restore. */
  readonly targetSeq: number
}

/** What a landed restore appended. */
export interface MessageToolsRestoration {
  /** Seq of the appended replay event. */
  readonly restoredSeq: number
}

/** Restore failure vocabulary (closed union). */
export type MessageToolsRestoreFailure =
  | { readonly code: 'session-not-found' }
  | { readonly code: 'target-not-found' }
  | { readonly code: 'not-a-user-message' }
  | { readonly code: 'not-withdrawn' }

/** Restore outcome: a landed receipt or a rejected failure. */
export type MessageToolsRestoreResult =
  | { readonly ok: true; readonly value: MessageToolsRestoration }
  | { readonly ok: false; readonly error: MessageToolsRestoreFailure }

/**
 * Edit a user message in place: replace it (and the surface tail) with the
 * edited text, then start a regeneration turn over the replaced surface.
 */
export interface MessageToolsEditRequest {
  /** Session that owns the target message. */
  readonly sessionId: SessionId
  /** Seq of the editable user message (an original or a previous edit's replacement). */
  readonly targetSeq: number
  /** The edited text (non-blank). */
  readonly text: string
}

/** What a landed edit appended and started. */
export interface MessageToolsEdit {
  /** Seq of the replacement event carrying the edited text. */
  readonly replacementSeq: number
  /** Whether the regeneration turn was triggered (false when no live agent). */
  readonly triggered: boolean
}

/** Edit failure vocabulary (closed union). */
export type MessageToolsEditFailure =
  | { readonly code: 'session-not-found' }
  | { readonly code: 'target-not-found' }
  | { readonly code: 'not-a-user-message' }
  | { readonly code: 'already-withdrawn' }
  | { readonly code: 'empty-text' }

/** Edit outcome: a landed receipt or a rejected failure. */
export type MessageToolsEditResult =
  | { readonly ok: true; readonly value: MessageToolsEdit }
  | { readonly ok: false; readonly error: MessageToolsEditFailure }
