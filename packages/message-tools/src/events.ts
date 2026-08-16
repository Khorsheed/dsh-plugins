/**
 * Event construction for message edit/withdraw. Pure logic, no React.
 * The session log is append-only: edit and withdraw are NEW events that
 * reference the original user/message by seq; projections consume them to
 * produce the effective view.
 * @module @khorsheed/dsh-client-message-tools/events
 */

/** One text block of a message payload (mirrors the session content type). */
export type MessageTextBlock = { type: 'text'; text: string }

/** Edit event: replaces the content of the target user message. */
export interface UserMessageEditedEvent {
  type: 'user/message/edited'
  data: {
    /** seq of the original user/message being edited. */
    targetSeq: number
    /** Full replacement content (the model sees this instead of the old). */
    content: MessageTextBlock[]
    /** When the edit happened. */
    ts?: number
  }
}

/** Withdraw event: hides the target user message from the model view. */
export interface UserMessageWithdrawnEvent {
  type: 'user/message/withdrawn'
  data: {
    /** seq of the original user/message being withdrawn. */
    targetSeq: number
    /** When the withdrawal happened. */
    ts?: number
  }
}

/** Build an edit event. @param targetSeq - original user/message seq. @param text - new text. @param ts - now. */
export function editEvent(targetSeq: number, text: string, ts: number): UserMessageEditedEvent {
  return { type: 'user/message/edited', data: { targetSeq, content: [{ type: 'text', text }], ts } }
}

/** Build a withdraw event. @param targetSeq - original user/message seq. @param ts - now. */
export function withdrawEvent(targetSeq: number, ts: number): UserMessageWithdrawnEvent {
  return { type: 'user/message/withdrawn', data: { targetSeq, ts } }
}
