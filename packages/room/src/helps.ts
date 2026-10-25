/**
 * Cross-session help threads, folded from a room's log (pure: the room
 * state replay and the client both read it). See help.ts for the flow.
 * @module @khorsheed/dsh-room/helps
 */
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { RoomHelp, RoomLinkedSession } from './types.ts'

/**
 * Fold a room's help threads from its log.
 * @param events - the room's events.
 * @returns the threads, oldest first.
 */
export function replayHelps(events: readonly SessionEvent[]): RoomHelp[] {
  const helps = new Map<string, RoomHelp>()
  for (const event of events) {
    if (event.type === 'room/help') {
      helps.set(event.data.id, { ...event.data, state: 'queued', since: event.time, messages: [], time: event.time })
    } else if (event.type === 'room/help-message') {
      const help = helps.get(event.data.help)
      if (help !== undefined) helps.set(help.id, { ...help, messages: [...help.messages, { ...event.data, time: event.time }] })
    } else if (event.type === 'room/help-state') {
      const help = helps.get(event.data.help)
      if (help === undefined) continue
      const { error: _old, ...rest } = help
      helps.set(help.id, { ...rest, state: event.data.state, since: help.state === event.data.state ? help.since : event.time, ...event.data.error === undefined ? {} : { error: event.data.error } })
    }
  }
  return [...helps.values()]
}

/**
 * The outside sessions this room keeps on its member list (「加入房间成员」),
 * and the sessions whose join hint the human dismissed.
 * @param events - the room's events.
 * @returns linked sessions (oldest first) and dismissed hints.
 */
export function replayLinks(events: readonly SessionEvent[]): { readonly linked: RoomLinkedSession[]; readonly nudgesDismissed: string[] } {
  const linked = new Map<string, RoomLinkedSession>()
  const dismissed = new Set<string>()
  for (const event of events) {
    if (event.type === 'room/help-link') linked.set(event.data.sessionId, { sessionId: event.data.sessionId, title: event.data.title, time: event.time })
    else if (event.type === 'room/help-unlink') linked.delete(event.data.sessionId)
    else if (event.type === 'room/help-nudge-dismissed') dismissed.add(event.data.sessionId)
  }
  return { linked: [...linked.values()], nudgesDismissed: [...dismissed] }
}

/** Asks of one session after which its reply row suggests 加入房间成员. */
export const NUDGE_AFTER = 3
