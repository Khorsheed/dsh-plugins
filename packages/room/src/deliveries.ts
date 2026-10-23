import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { RoomDelivery } from './types.ts'

/** Whether an event is a message the human typed (not a producer's followup). */
export function isHumanMessage(event: SessionEvent): event is SessionEvent<'user/message'> {
  return event.type === 'user/message' && event.data.source.kind === 'user'
}

/** Every human message's latest task link (message id → task root id). */
export function taskLinks(events: readonly SessionEvent[]): Map<string, string> {
  const links = new Map<string, string>()
  for (const event of events) if (event.type === 'room/task-link') links.set(event.data.message, event.data.task)
  return links
}

/** The task a human message belongs to: its latest link, else its own id (a task of its own). */
export function linkedTask(links: ReadonlyMap<string, string>, messageId: string): string {
  return links.get(messageId) ?? messageId
}

/**
 * Accepted delivery intents and their latest durable outcomes, with the
 * timing edges the task views draw (dispatched, admitted, settled, held,
 * released). A delivery's task is its dispatch's `task`; dispatches written
 * before tasks were recorded fall back by cause: a report or release takes
 * its source's task, anything else the task of the latest human message
 * before it (the turn that sent it), and a human dispatch with no message
 * (an invite's first task) is a task of its own.
 * @param events - the room log.
 * @returns the deliveries in dispatch order.
 */
export function replayDeliveries(events: readonly SessionEvent[]): RoomDelivery[] {
  const rows = new Map<string, RoomDelivery>()
  const taskBySeq = new Map<number, string>()
  const links = new Map<string, string>()
  let lastHuman: { readonly id: string; readonly seq: number } | undefined
  const set = (id: string, patch: Partial<RoomDelivery>): void => {
    const row = rows.get(id)
    if (row !== undefined) rows.set(id, { ...row, ...patch })
  }
  for (const event of events) {
    if (isHumanMessage(event)) {
      lastHuman = { id: event.data.id, seq: event.seq }
    } else if (event.type === 'room/task-link') {
      links.set(event.data.message, event.data.task)
    } else if (event.type === 'room/dispatch' && event.data.targetIds !== undefined) {
      const data = event.data
      const targetIds = data.targetIds ?? []
      const sourceSeq = data.reportFor !== undefined && /^\d+:/.test(data.reportFor) ? Number(data.reportFor.split(':', 1)[0]) : data.releases?.[0]
      const task = data.task
        ?? (sourceSeq === undefined ? undefined : taskBySeq.get(sourceSeq))
        ?? (data.origin === 'human' && lastHuman === undefined ? data.id : undefined)
        ?? (lastHuman === undefined ? data.id : linkedTask(links, lastHuman.id))
      if (task !== undefined) taskBySeq.set(event.seq, task)
      for (const memberId of targetIds) {
        const id = `${event.seq}:${memberId}`
        if (rows.has(id)) continue
        rows.set(id, {
          id, dispatchSeq: event.seq, memberId, status: data.held === true ? 'held' : 'queued', text: data.text,
          origin: data.origin ?? 'human', queuedAt: event.time,
          ...data.replyTo === undefined ? {} : { replyTo: data.replyTo },
          ...data.from === undefined ? {} : { from: data.from },
          ...data.kind === undefined ? {} : { kind: data.kind },
          ...data.plan === undefined ? {} : { plan: data.plan },
          ...task === undefined ? {} : { task },
          ...data.parent === undefined ? {} : { parent: data.parent },
          ...data.held === true ? { heldAt: event.time } : {},
        })
      }
    } else if (event.type === 'room/delivery-state') {
      const row = rows.get(event.data.id)
      if (row === undefined || row.memberId !== event.data.memberId || row.dispatchSeq !== event.data.dispatchSeq) continue
      const terminal = event.data.state !== 'running'
      rows.set(row.id, {
        ...row, status: event.data.state,
        ...event.data.error === undefined ? {} : { error: event.data.error },
        ...event.data.state === 'running' && row.startedAt === undefined ? { startedAt: event.time } : {},
        ...terminal ? { endedAt: event.time } : {},
      })
    } else if (event.type === 'room/report-gate') {
      const id = `${event.data.dispatchSeq}:${event.data.memberId}`
      if (event.data.verdict === 'hold') set(id, { heldAt: event.time })
      else if (event.data.verdict === 'release' && rows.get(id)?.releasedAt === undefined) set(id, { releasedAt: event.time })
    }
  }
  return [...rows.values()]
}
