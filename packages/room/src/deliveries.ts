import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { RoomDelivery } from './types.ts'

/** Accepted delivery intents and their latest durable outcomes. */
export function replayDeliveries(events: readonly SessionEvent[]): RoomDelivery[] {
  const rows = new Map<string, RoomDelivery>()
  for (const event of events) {
    if (event.type === 'room/dispatch' && event.data.targetIds !== undefined) {
      for (const memberId of event.data.targetIds) {
        const id = `${event.seq}:${memberId}`
        if (!rows.has(id)) rows.set(id, { id, dispatchSeq: event.seq, memberId, status: 'queued', text: event.data.text, origin: event.data.origin ?? 'human' })
      }
    } else if (event.type === 'room/delivery-state') {
      const row = rows.get(event.data.id)
      if (row === undefined || row.memberId !== event.data.memberId || row.dispatchSeq !== event.data.dispatchSeq) continue
      rows.set(row.id, { ...row, status: event.data.state, ...event.data.error === undefined ? {} : { error: event.data.error } })
    }
  }
  return [...rows.values()]
}
