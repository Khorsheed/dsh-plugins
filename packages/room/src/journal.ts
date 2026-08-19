/**
 * Room journal replay: folds the room session's `room/*` custom events into
 * the derived {@link RoomState} — roster, notification relays, the task
 * board, and run states. Pure: the Remote surface reads through it, the
 * dispatch engine reads instruction cursors through it, and the unit tests
 * exercise it without a cordis composition. Reload-replay recovers the exact
 * same state, which is what makes the journal the room's single source of
 * truth. There is NO blackboard fold: member prompts never consume the
 * room's running log (see the design note) — speech/dispatch events are
 * journaled for UI projection and replay only.
 * @module @khorsheed/dsh-room/journal
 */
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type {
  RoomMember, RoomMemberRun, RoomRelay, RoomState, RoomTask,
} from './types.ts'

/**
 * The addressing name of the room's own main agent, added to the roster at
 * room creation: an equal member with no privilege. Bare human messages go
 * to it through the official submit path; @-dispatch works like any member.
 */
export const MAIN_AGENT_MEMBER = 'main'

/**
 * Every `room/*` session-event type this package introduces. Room registers
 * them into the harness's KNOWN_SESSION_EVENT_TYPES persistence catalog at
 * apply time (see the RoomService constructor): the catalog's read-path
 * refusal exists so a build that does NOT understand an event type never
 * silently mangles the log — a build with room mounted understands these, so
 * registration is the semantically correct declaration, and a build without
 * room keeps refusing them. The catalog's own header defers a registration
 * surface for out-of-repo plugins "until such a consumer exists"; this
 * in-place add is that surface's temporary form — migrate to the official
 * one when it lands upstream.
 */
export const ROOM_EVENT_TYPES = [
  'room/created',
  'room/member-added',
  'room/member-updated',
  'room/member-removed',
  'room/dispatch',
  'room/speech',
  'room/run-state',
  'room/relay',
  'room/relay-resolved',
  'room/task-added',
  'room/task-updated',
] as const

/** Whether an event log carries the room identity marker. */
export function isRoomLog(events: readonly SessionEvent[]): boolean {
  return events.some(event => event.type === 'room/created')
}

/**
 * Parse the leading `@name` tokens of a raw composer message.
 * @param raw - the raw text.
 * @returns the addressed names (deduped, order-preserving) and the body with
 * the mention prefix stripped. Only LEADING tokens address: an `@name`
 * inside prose is plain text (a bare message goes to the main agent through
 * the official submit path).
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
 * The fallback notification channel: a member reply's TRAILING own line of
 * the form `@name <content>` (the format the roster injection teaches).
 * Only the last line counts — an `@name` inside prose is a mention, not a
 * notification. Leading whitespace on that line is tolerated (models indent
 * under their own bullet/list style). The caller checks the target against
 * the roster.
 * @param text - the member's reply text.
 * @returns the parsed directive, or undefined.
 */
export function parseRelayDirective(text: string): { readonly to: string; readonly content: string } | undefined {
  const trimmed = text.trimEnd()
  if (trimmed === '') return undefined
  const last = trimmed.slice(trimmed.lastIndexOf('\n') + 1).trimStart()
  const match = /^@(\S+)\s+(\S[\s\S]*)$/.exec(last)
  if (match === null) return undefined
  return { to: match[1]!, content: match[2]!.trim() }
}

/**
 * Fold a session's event log into the room state.
 *
 * Write-side invariants (invite/update/remove validate before appending) are
 * NOT re-enforced here: a replayed log may be hand-edited or forked, so the
 * fold is defensive — a duplicate member-added keeps the first record (first
 * wins, a replay cannot re-seat a member), and updates/removals naming an
 * unknown member are dropped. Unknown event types (e.g. a `room/note` from
 * the dropped blackboard design) fall through the switch and are skipped.
 * Removal also drops the member's run state: the roster reads clean after a
 * remove. Relays and tasks fold by id, latest resolution winning.
 * @param events - the session's event log.
 * @returns the folded room state (empty for a non-room log).
 */
export function replay(events: readonly SessionEvent[]): RoomState {
  const members: RoomMember[] = []
  const byName = new Map<string, RoomMember>()
  const relays: RoomRelay[] = []
  const relayById = new Map<string, RoomRelay>()
  const tasks: RoomTask[] = []
  const taskById = new Map<string, RoomTask>()
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
          ...event.data.cwd === undefined ? {} : { cwd: event.data.cwd },
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
        runs.delete(event.data.name)
        break
      }
      case 'room/relay': {
        if (relayById.has(event.data.id)) break
        const relay: RoomRelay = {
          id: event.data.id,
          from: event.data.from,
          to: event.data.to,
          content: event.data.content,
          state: 'pending',
          ...event.data.provenance === undefined ? {} : { provenance: event.data.provenance },
        }
        relayById.set(relay.id, relay)
        relays.push(relay)
        break
      }
      case 'room/relay-resolved': {
        const relay = relayById.get(event.data.id)
        if (relay === undefined) break
        const resolved: RoomRelay = { ...relay, state: event.data.state }
        relayById.set(resolved.id, resolved)
        relays[relays.indexOf(relay)] = resolved
        break
      }
      case 'room/task-added': {
        if (taskById.has(event.data.id)) break
        const task: RoomTask = {
          id: event.data.id,
          member: event.data.member,
          title: event.data.title,
          status: event.data.status,
        }
        taskById.set(task.id, task)
        tasks.push(task)
        break
      }
      case 'room/task-updated': {
        const task = taskById.get(event.data.id)
        if (task === undefined) break
        const updated: RoomTask = { ...task, status: event.data.status }
        taskById.set(updated.id, updated)
        tasks[tasks.indexOf(task)] = updated
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
  return { members, relays, tasks, runs: [...runs.values()] }
}

/**
 * The member's dispatch cursor as of JUST BEFORE a given dispatch event: the
 * latest earlier dispatch naming them. The engine reads the role-instruction
 * carry against this cursor (pass {@link Number.MAX_SAFE_INTEGER} for a
 * dispatch that is not itself journaled, e.g. a relay delivery).
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
