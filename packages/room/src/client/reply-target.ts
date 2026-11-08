/**
 * Which message a member's reply answers, when that is not obvious
 * (room-timeline-interaction-order B③): the reply lands below a later
 * message the human sent the same member while the round ran — by
 * time order that is right (it finished later), but it reads as an answer to
 * the later message. The reply then opens with 「↑ 回复的是 21:56 那条 · 你
 * 22:05 那条刚开始处理」. Read entirely off the deliveries, so old logs get it
 * too.
 * @module @khorsheed/dsh-room/client/reply-target
 */
import { ANSWERED_QUESTION_TEXT } from '../delivery-notes.ts'
import type { RoomState } from '../types.ts'

export interface ReplyTarget {
  /** When the message this round ran was sent. */
  readonly answeredAt: number
  /** When the first later message to the same member was sent. */
  readonly laterAt: number
  /** That later message's receipt row (it waited, so it has one). */
  readonly target: string
}

/**
 * @param runId - the speech's run id (`<dispatchSeq>:<memberId>`).
 * @param speechTime - when the reply landed (epoch ms).
 * @param state - the room state.
 * @returns the reply's target, or undefined when no later message to this member was waiting.
 */
export function replyTarget(runId: string | undefined, speechTime: number, state: RoomState | undefined): ReplyTarget | undefined {
  if (runId === undefined || state === undefined) return undefined
  const deliveries = state.deliveries ?? []
  const row = deliveries.find(entry => entry.id === runId)
  if (row === undefined || row.origin !== 'human' || row.messageId === undefined) return undefined
  const roundStart = row.startedAt ?? row.queuedAt
  // A human message to the same member, sent while this round ran and not
  // taken into it (an answer to its question was taken in; a withdrawn or
  // held one was never the member's).
  const later = deliveries.find(entry => entry.memberId === row.memberId && entry.origin === 'human' && entry.dispatchSeq > row.dispatchSeq
    && entry.bubble === 'before' && entry.queuedAt >= roundStart && entry.queuedAt <= speechTime
    && entry.note !== ANSWERED_QUESTION_TEXT && entry.status !== 'cancelled' && entry.status !== 'held')
  if (later === undefined) return undefined
  return { answeredAt: row.queuedAt, laterAt: later.queuedAt, target: `[data-room-receipt="${later.dispatchSeq}"]` }
}
