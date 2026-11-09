/**
 * What the row above the room composer says about waiting messages
 * (room-timeline-interaction-order D): never a message that already has its
 * bubble in the timeline (its state reads on its receipt line) — only
 * member-level state: 「⏳ N 条消息在等 X ↑」 (a count; ↑ scrolls to the first
 * one) and 「⏸ X 的队列已暂停 · 继续」 (pausing is the member's, not a
 * message's). A round a restart cut off has no capsule: its card says so,
 * and continuing it is the restart banner's (restart-recovery consolidation).
 * @module @khorsheed/dsh-room/client/queue-capsules
 */
import type { RoomState } from '../types.ts'

/** One member-level capsule. */
export type QueueCapsule =
  | { readonly kind: 'waiting'; readonly memberId: string; readonly member: string; readonly count: number; readonly firstSeq: number }
  | { readonly kind: 'paused'; readonly memberId: string; readonly member: string; readonly childSessionId?: string }

/**
 * The capsules for one room state, in roster order: per member, its waiting
 * count, then its paused queue.
 * @param state - the room state.
 * @returns the capsules.
 */
export function queueCapsules(state: RoomState | undefined): readonly QueueCapsule[] {
  if (state === undefined) return []
  const out: QueueCapsule[] = []
  const deliveries = state.deliveries ?? []
  const paused = new Set(state.restartFacts?.queuePaused ?? [])
  for (const member of state.members) {
    if (member.id === undefined) continue
    const waiting = deliveries.filter(row => row.memberId === member.id && row.origin === 'human' && row.status === 'queued' && row.bubble === 'before')
    if (waiting.length > 0) out.push({ kind: 'waiting', memberId: member.id, member: member.name, count: waiting.length, firstSeq: Math.min(...waiting.map(row => row.dispatchSeq)) })
    if (paused.has(member.id)) out.push({ kind: 'paused', memberId: member.id, member: member.name, ...member.childSessionId === undefined ? {} : { childSessionId: String(member.childSessionId) } })
  }
  return out
}
