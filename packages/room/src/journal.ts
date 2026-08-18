/**
 * Room journal replay: folds the room session's `room/*` custom events into
 * the derived {@link RoomState} — roster, blackboard, per-member dispatch
 * cursors, and run states. Pure: the Remote surface reads through it, the
 * dispatch engine (next step) reads the cursors through it, and the unit
 * tests exercise it without a cordis composition. Reload-replay recovers the
 * exact same state, which is what makes the journal the room's single source
 * of truth.
 * @module @khorsheed/dsh-room/journal
 */
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type {
  RoomBlackboardEntry, RoomMember, RoomMemberRun, RoomState,
} from './types.ts'

/**
 * The addressing name of the room's own main agent, added to the roster at
 * room creation: an equal member with no privilege — not @-addressed, it
 * perceives nothing and says nothing. `main-agent` kind, never a provider.
 */
export const MAIN_AGENT_MEMBER = 'main'

/** Whether an event log carries the room identity marker. */
export function isRoomLog(events: readonly SessionEvent[]): boolean {
  return events.some(event => event.type === 'room/created')
}

/**
 * Parse the leading `@name` tokens of a raw composer message.
 * @param raw - the raw text.
 * @returns the addressed names (deduped, order-preserving) and the body with
 * the mention prefix stripped. Only LEADING tokens address: an `@name`
 * inside prose is plain text (and the message is a note when nothing leads).
 */
export function parseMentions(raw: string): { readonly targets: readonly string[]; readonly text: string } {
  const targets: string[] = []
  let rest = raw.trim()
  for (;;) {
    const match = /^@(\S+)(?:\s+|$)/.exec(rest)
    if (match === null) break
    const name = match[1]!
    if (!targets.includes(name)) targets.push(name)
    rest = rest.slice(match[0].length).trim()
  }
  return { targets, text: rest }
}

/**
 * Fold a session's event log into the room state.
 *
 * Write-side invariants (invite/update/remove validate before appending) are
 * NOT re-enforced here: a replayed log may be hand-edited or forked, so the
 * fold is defensive — a duplicate member-added keeps the first record (first
 * wins, a replay cannot re-seat a member), and updates/removals naming an
 * unknown member are dropped. Removal also drops the member's dispatch
 * cursor and run state: the roster reads clean after a remove.
 * @param events - the session's event log.
 * @returns the folded room state (empty for a non-room log).
 */
export function replay(events: readonly SessionEvent[]): RoomState {
  const members: RoomMember[] = []
  const byName = new Map<string, RoomMember>()
  const blackboard: RoomBlackboardEntry[] = []
  const cursors = new Map<string, number>()
  const runs = new Map<string, RoomMemberRun>()
  for (const event of events) {
    switch (event.type) {
      case 'room/member-added': {
        if (byName.has(event.data.name)) break
        const added: RoomMember = {
          name: event.data.name,
          kind: event.data.kind,
          invitedBy: event.data.invitedBy,
          ...event.data.provider === undefined ? {} : { provider: event.data.provider },
          ...event.data.instructions === undefined ? {} : { instructions: event.data.instructions },
          ...event.data.childSessionId === undefined ? {} : { childSessionId: event.data.childSessionId },
        }
        byName.set(added.name, added)
        members.push(added)
        break
      }
      case 'room/member-updated': {
        const member = byName.get(event.data.name)
        if (member === undefined) break
        const updated: RoomMember = {
          ...member,
          ...event.data.instructions === undefined ? {} : { instructions: event.data.instructions },
          ...event.data.childSessionId === undefined ? {} : { childSessionId: event.data.childSessionId },
        }
        byName.set(updated.name, updated)
        members[members.indexOf(member)] = updated
        break
      }
      case 'room/member-removed': {
        const member = byName.get(event.data.name)
        if (member === undefined) break
        byName.delete(event.data.name)
        members.splice(members.indexOf(member), 1)
        cursors.delete(event.data.name)
        runs.delete(event.data.name)
        break
      }
      case 'room/dispatch': {
        blackboard.push({ kind: 'dispatch', seq: event.seq, targets: [...event.data.targets], text: event.data.text })
        for (const target of event.data.targets) cursors.set(target, event.seq)
        break
      }
      case 'room/note': {
        blackboard.push({ kind: 'note', seq: event.seq, text: event.data.text })
        break
      }
      case 'room/speech': {
        blackboard.push({
          kind: 'speech',
          seq: event.seq,
          member: event.data.member,
          text: event.data.text,
          ...event.data.childSessionId === undefined ? {} : { childSessionId: event.data.childSessionId },
          ...event.data.durationMs === undefined ? {} : { durationMs: event.data.durationMs },
        })
        break
      }
      case 'room/run-state': {
        runs.set(event.data.member, {
          member: event.data.member,
          state: event.data.state,
          startedAt: event.data.startedAt,
          ...event.data.elapsedMs === undefined ? {} : { elapsedMs: event.data.elapsedMs },
        })
        break
      }
      default:
        break
    }
  }
  return {
    members,
    blackboard,
    cursors: [...cursors.entries()].map(([member, seq]) => ({ member, seq })),
    runs: [...runs.values()],
  }
}

/**
 * The member's dispatch cursor as of JUST BEFORE a given dispatch event: the
 * latest earlier dispatch naming them. The engine reads its blackboard
 * increment from this cursor (the current dispatch's own text rides the
 * prompt tail instead, so it is never duplicated into the increment).
 * @param events - the session's event log.
 * @param member - the dispatch target.
 * @param beforeSeq - the current dispatch event's seq.
 * @returns the previous dispatch seq, or undefined on the member's first dispatch.
 */
export function previousCursor(
  events: readonly SessionEvent[],
  member: string,
  beforeSeq: number,
): number | undefined {
  let cursor: number | undefined
  for (const event of events) {
    if (event.type !== 'room/dispatch' || event.seq >= beforeSeq) continue
    if (event.data.targets.includes(member)) cursor = event.seq
  }
  return cursor
}

/**
 * The role-instructions carry for the next dispatch to a member: 'initial'
 * when the member has never been dispatched (their instructions open the
 * first prompt), 'update' when the latest member-added/member-updated event
 * naming them postdates their dispatch cursor (an edit rides the next
 * dispatch as a context update). Instructions events older than the cursor
 * were already carried.
 * @param events - the session's event log.
 * @param member - the dispatch target.
 * @param cursor - the member's pre-dispatch cursor ({@link previousCursor}).
 * @returns the carry, or undefined when nothing needs carrying.
 */
export function pendingInstructions(
  events: readonly SessionEvent[],
  member: string,
  cursor: number | undefined,
): { readonly kind: 'initial' | 'update'; readonly instructions: string } | undefined {
  let lastSeq: number | undefined
  let lastInstructions: string | undefined
  for (const event of events) {
    if (event.type === 'room/member-added' && event.data.name === member
      && event.data.instructions !== undefined) {
      lastSeq = event.seq
      lastInstructions = event.data.instructions
    } else if (event.type === 'room/member-updated' && event.data.name === member
      && event.data.instructions !== undefined) {
      lastSeq = event.seq
      lastInstructions = event.data.instructions
    }
  }
  if (lastSeq === undefined || lastInstructions === undefined) return undefined
  if (cursor === undefined) return { kind: 'initial', instructions: lastInstructions }
  if (lastSeq > cursor) return { kind: 'update', instructions: lastInstructions }
  return undefined
}
