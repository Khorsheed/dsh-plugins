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
import { replayDeliveries } from './deliveries.ts'
import { replayJobs } from './jobs.ts'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type {
  RoomApproval, RoomQuestion, RoomExecution, RoomMember, RoomMemberRun, RoomRelay, RoomSettings, RoomState, RoomTask, RoomTaskProgress,
} from './types.ts'

/**
 * The native DSH member's addressing name in new rooms. It starts as the
 * coordinator; bare messages follow the selected coordinator thereafter.
 * Existing journals retain their recorded names, including legacy main.
 */
export const MAIN_AGENT_MEMBER = 'dsh'

/** Longest accepted public member role (`RoomMember.role`), in characters. */
export const ROOM_ROLE_MAX = 30

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
  'room/plan-state',
  'room/coordinator',
  'room/delivery-state',
  'room/member-added',
  'room/member-updated',
  'room/member-removed',
  'room/dispatch',
  'room/speech',
  'room/run-state',
  'room/execution-metadata',
  'room/relay',
  'room/relay-resolved',
  'room/approval',
  'room/approval-resolved',
  'room/question',
  'room/question-resolved',
  'room/task-added',
  'room/task-updated',
  'room/task-edited',
  'room/goal',
  'room/settings',
  'room/report-gate',
  'room/task-link',
  'room/job-stopped',
] as const

/** Collaboration settings of a room that never changed them. */
export const DEFAULT_ROOM_SETTINGS: RoomSettings = { memberMessages: 'free', hopLimit: 10, paused: false, reportTiming: 'judge' }

/** Whether an event log carries the room identity marker. */
export function isRoomLog(events: readonly SessionEvent[]): boolean {
  return events.some(event => event.type === 'room/created')
}

/**
 * Parse the leading `@name` tokens of a raw composer message.
 * @param raw - the raw text.
 * @returns the addressed names (deduped, order-preserving) and the body with
 * the mention prefix stripped. Only LEADING tokens address: an `@name`
 * inside prose is plain text (a bare message goes to the selected coordinator).
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
  const approvals = new Map<string, RoomApproval>()
  const questions = new Map<string, RoomQuestion>()
  const relayById = new Map<string, RoomRelay>()
  const tasks: RoomTask[] = []
  const taskById = new Map<string, RoomTask>()
  const runs = new Map<string, RoomMemberRun>()
  const executions = new Map<string, RoomExecution>()
  let goal: string | undefined
  let settings = DEFAULT_ROOM_SETTINGS
  let coordinator: RoomState['coordinator']
  let latestReplySeq: number | undefined
  for (const event of events) {
    switch (event.type) {
      case 'room/speech':
        // A reply to the room (not a report to another member).
        if (event.data.reportedTo === undefined) latestReplySeq = event.seq
        break
      case 'room/coordinator': {
        if (event.data.revision > (coordinator?.revision ?? 0)) coordinator = event.data
        break
      }
      case 'room/member-added': {
        if (byName.has(event.data.name)) break
        const added: RoomMember = {
          id: event.data.id ?? `legacy:${event.seq}`,
          name: event.data.name,
          kind: event.data.kind,
          invitedBy: event.data.invitedBy,
          ...event.data.provider === undefined ? {} : { provider: event.data.provider },
          ...event.data.instructions === undefined ? {} : { instructions: event.data.instructions },
          ...event.data.role === undefined ? {} : { role: event.data.role },
          ...event.data.preset === undefined ? {} : { preset: event.data.preset },
          ...event.data.cwd === undefined ? {} : { cwd: event.data.cwd },
          ...event.data.model === undefined ? {} : { model: event.data.model },
          ...event.data.effort === undefined ? {} : { effort: event.data.effort },
          ...event.data.childSessionId === undefined ? {} : { childSessionId: event.data.childSessionId },
        }
        byName.set(added.name, added)
        members.push(added)
        break
      }
      case 'room/member-updated': {
        const member = byName.get(event.data.name)
        if (member === undefined) break
        // null CLEARS a field (rebuild without the key —
        // exactOptionalPropertyTypes forbids writing undefined into it).
        const withoutInstructions: RoomMember = event.data.instructions === null
          ? (({ instructions: _cleared, ...rest }: RoomMember): RoomMember => rest)(member)
          : { ...member, ...event.data.instructions === undefined ? {} : { instructions: event.data.instructions } }
        const withoutRole: RoomMember = event.data.role === null
          ? (({ role: _cleared, ...rest }: RoomMember): RoomMember => rest)(withoutInstructions)
          : { ...withoutInstructions, ...event.data.role === undefined ? {} : { role: event.data.role } }
        const withoutCwd: RoomMember = event.data.cwd === null
          ? (({ cwd: _cleared, ...rest }: RoomMember): RoomMember => rest)(withoutRole)
          : { ...withoutRole, ...event.data.cwd === undefined ? {} : { cwd: event.data.cwd } }
        const withoutModel: RoomMember = event.data.model === null
          ? (({ model: _cleared, ...rest }: RoomMember): RoomMember => rest)(withoutCwd)
          : { ...withoutCwd, ...event.data.model === undefined ? {} : { model: event.data.model } }
        const withoutEffort: RoomMember = event.data.effort === null
          ? (({ effort: _cleared, ...rest }: RoomMember): RoomMember => rest)(withoutModel)
          : { ...withoutModel, ...event.data.effort === undefined ? {} : { effort: event.data.effort } }
        const patched: RoomMember = {
          ...withoutEffort,
          ...event.data.childSessionId === undefined ? {} : { childSessionId: event.data.childSessionId },
        }
        // First admission can precede publication of the native child handle.
        for (const [id, execution] of executions) {
          if (execution.memberId === member.id && execution.childSessionId === undefined && patched.childSessionId !== undefined) {
            executions.set(id, { ...execution, childSessionId: patched.childSessionId })
          }
        }
        // A rename migrates every name-keyed projection: the roster key, the
        // tasks' member (and blockedBy), the relays' from/to, and the runs
        // key. The child session id rides the member record and stays. A
        // colliding rename (the new name is taken — a hand-edited log; the
        // write path validates) drops the rename, keeps the rest.
        const rename = event.data.rename
        if (rename === undefined || rename === member.name || byName.has(rename)) {
          byName.set(member.name, patched)
          members[members.indexOf(member)] = patched
          break
        }
        const renamed: RoomMember = { ...patched, name: rename }
        byName.delete(member.name)
        byName.set(rename, renamed)
        members[members.indexOf(member)] = renamed
        for (let index = 0; index < tasks.length; index++) {
          const task = tasks[index]!
          if (task.member !== member.name && task.blockedBy !== member.name) continue
          const migrated: RoomTask = {
            ...task,
            ...task.member === member.name ? { member: rename } : {},
            ...task.blockedBy === member.name ? { blockedBy: rename } : {},
          }
          taskById.set(migrated.id, migrated)
          tasks[index] = migrated
        }
        for (let index = 0; index < relays.length; index++) {
          const relay = relays[index]!
          if (relay.from !== member.name && relay.to !== member.name) continue
          const migrated: RoomRelay = {
            ...relay,
            from: relay.from === member.name ? rename : relay.from,
            to: relay.to === member.name ? rename : relay.to,
          }
          relayById.set(migrated.id, migrated)
          relays[index] = migrated
        }
        const run = runs.get(member.name)
        if (run !== undefined) {
          runs.delete(member.name)
          runs.set(rename, { ...run, member: rename })
        }
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
          ...event.data.reason === undefined ? {} : { reason: event.data.reason },
          ...event.data.intent === undefined ? {} : { intent: event.data.intent },
        }
        relayById.set(relay.id, relay)
        relays.push(relay)
        break
      }
      case 'room/approval':
        approvals.set(event.data.id, { id: event.data.id, member: event.data.member, tool: event.data.tool, ...event.data.reason === undefined ? {} : { reason: event.data.reason }, time: event.time })
        break
      case 'room/question':
        questions.set(event.data.id, { id: event.data.id, member: event.data.member, questions: event.data.questions, time: event.time })
        break
      case 'room/question-resolved':
        questions.delete(event.data.id)
        break
      case 'room/approval-resolved':
        approvals.delete(event.data.id)
        break
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
          ...event.data.deliveryId === undefined ? {} : { deliveryId: event.data.deliveryId },
          status: event.data.status,
          ...event.data.blockedBy === undefined ? {} : { blockedBy: event.data.blockedBy },
          updatedAt: event.time,
        }
        taskById.set(task.id, task)
        tasks.push(task)
        break
      }
      case 'room/task-updated': {
        const task = taskById.get(event.data.id)
        if (task === undefined) break
        const updated: RoomTask = { ...task, status: event.data.status, updatedAt: event.time }
        taskById.set(updated.id, updated)
        tasks[tasks.indexOf(task)] = updated
        break
      }
      case 'room/task-edited': {
        const task = taskById.get(event.data.id)
        if (task === undefined) break
        // An explicit null blockedBy CLEARS the wait: rebuild without the key
        // (exactOptionalPropertyTypes forbids writing undefined into it).
        const base: RoomTask = event.data.blockedBy === null
          ? (({ blockedBy: _cleared, ...rest }: RoomTask): RoomTask => rest)(task)
          : { ...task, ...event.data.blockedBy === undefined ? {} : { blockedBy: event.data.blockedBy } }
        const edited: RoomTask = {
          ...base,
          ...event.data.title === undefined ? {} : { title: event.data.title },
          ...event.data.member === undefined ? {} : { member: event.data.member },
          updatedAt: event.time,
        }
        taskById.set(edited.id, edited)
        tasks[tasks.indexOf(task)] = edited
        break
      }
      case 'room/settings': {
        settings = {
          memberMessages: event.data.memberMessages ?? settings.memberMessages,
          hopLimit: event.data.hopLimit ?? settings.hopLimit,
          paused: event.data.paused ?? settings.paused,
          reportTiming: event.data.reportTiming ?? settings.reportTiming,
        }
        break
      }
      case 'room/goal': {
        // Latest goal event wins; a blank text clears the goal.
        const text = event.data.text.trim()
        goal = text === '' ? undefined : text
        break
      }
      case 'room/execution-metadata': {
        const previous = executions.get(event.data.runId)
        if (previous) executions.set(previous.id, { ...previous, ...event.data })
        break
      }
      case 'room/run-state': {
        const member = byName.get(event.data.member)
        const id = event.data.runId ?? `legacy:${member?.id ?? event.data.member}:${event.data.startedAt}`
        const previous = executions.get(id)
        executions.set(id, {
          id,
          ...member?.id === undefined ? {} : { memberId: member.id },
          ...member?.childSessionId === undefined ? {} : { childSessionId: member.childSessionId },
          ...member?.provider === undefined ? {} : { provider: member.provider },
          ...previous,
          ...event.data,
          ...event.data.state === 'running' || event.data.elapsedMs !== undefined ? {} : { elapsedMs: Math.max(0, event.time - event.data.startedAt) },
        })
        const current = runs.get(event.data.member)
        // An older turn may finish journaling after core admits its successor.
        // Its delivery outcome remains durable, but it cannot replace that successor.
        if (event.data.state !== 'running' && event.data.runId !== undefined && current?.runId !== undefined && current.runId !== event.data.runId) break
        runs.set(event.data.member, {
          member: event.data.member,
          state: event.data.state,
          startedAt: event.data.startedAt,
          ...event.data.runId === undefined ? {} : { runId: event.data.runId },
          ...event.data.elapsedMs === undefined ? {} : { elapsedMs: event.data.elapsedMs },
          ...event.data.error === undefined ? {} : { error: event.data.error },
        })
        break
      }
      default:
        break
    }
  }
  const planEvent = events.filter(event => event.type === 'room/plan-state').at(-1)
  const plan = planEvent?.type === 'room/plan-state' ? (({ requests: _requests, ...view }) => view)(planEvent.data) : undefined
  const deliveries = replayDeliveries(events)
  const jobs = deliveries.length === 0 ? [] : replayJobs(events, deliveries)
  return { members, relays, ...approvals.size === 0 ? {} : { approvals: [...approvals.values()] }, ...questions.size === 0 ? {} : { questions: [...questions.values()] }, tasks, ...executions.size === 0 ? {} : { executions: [...executions.values()] }, ...plan === undefined ? {} : { plan }, ...deliveries.length === 0 ? {} : { deliveries }, runs: [...runs.values()], ...coordinator === undefined ? {} : { coordinator }, ...goal === undefined ? {} : { goal }, ...latestReplySeq === undefined ? {} : { latestReplySeq }, settings, ...jobs.length === 0 ? {} : { jobs } }
}

/**
 * The goal progress pair: done tasks over the COUNTABLE total — cancelled
 * and failed tasks leave the denominator (a cancelled task was never part
 * of the plan; a failed one was planned but never advanced it).
 * @param tasks - the folded task board.
 * @returns done/total.
 */
export function taskProgress(tasks: readonly RoomTask[]): RoomTaskProgress {
  const countable = tasks.filter(task => task.status !== 'cancelled' && task.status !== 'failed')
  return { done: countable.filter(task => task.status === 'done').length, total: countable.length }
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
 * What changed in the room since a member's last dispatch, as one-line
 * notes for the next prompt: other members joining or leaving, renames, role
 * changes, the member's own role change, and a goal change. The full roster
 * rides only the first dispatch's briefing; later dispatches carry these
 * deltas instead (the member's own session holds the rest), and a member who
 * wants the whole picture calls `room_read`. Model, cwd and delegation-handle
 * updates never reach a prompt. A member with no cursor gets no deltas — the
 * briefing already covers everything.
 * @param events - the session's event log.
 * @param cursor - the member's pre-dispatch cursor ({@link previousCursor}).
 * @param self - the member's CURRENT name (its own rename is not news to it).
 * @returns the change notes (empty when nothing changed).
 */
export function roomChangesSince(
  events: readonly SessionEvent[],
  cursor: number | undefined,
  self: string,
): readonly string[] {
  if (cursor === undefined) return []
  const notes: string[] = []
  let goal: { readonly text: string } | undefined
  for (const event of events) {
    if (event.seq <= cursor) continue
    if (event.type === 'room/member-added' && event.data.name !== self && event.data.kind !== 'main-agent') {
      const detail = [event.data.role, event.data.provider].filter(Boolean).join(' · ')
      notes.push(`${event.data.name} 加入${detail === '' ? '' : `（${detail}）`}`)
    } else if (event.type === 'room/member-removed' && event.data.name !== self) {
      notes.push(`${event.data.name} 离开`)
    } else if (event.type === 'room/member-updated') {
      if (event.data.rename !== undefined && event.data.rename !== self) notes.push(`${event.data.name} 改名为 ${event.data.rename}`)
      if (event.data.role !== undefined) {
        const who = event.data.rename ?? event.data.name
        const subject = who === self ? '你的职责' : `${who} 的职责`
        notes.push(event.data.role === null ? `${subject}已清除` : `${subject}改为：${event.data.role}`)
      }
    } else if (event.type === 'room/goal') {
      goal = { text: event.data.text.trim() }
    }
  }
  if (goal !== undefined) notes.push(goal.text === '' ? '房间目标已清除' : `房间目标更新为：${goal.text}`)
  return notes
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
    } else if (event.type === 'room/member-updated' && event.data.name === member) {
      // A null instructions CLEARS the preset: nothing rides the next dispatch.
      if (event.data.instructions === null) {
        lastSeq = undefined
        lastInstructions = undefined
      } else if (event.data.instructions !== undefined) {
        lastSeq = event.seq
        lastInstructions = event.data.instructions
      }
    }
  }
  if (lastSeq === undefined || lastInstructions === undefined) return undefined
  if (cursor === undefined) return { kind: 'initial', instructions: lastInstructions }
  if (lastSeq > cursor) return { kind: 'update', instructions: lastInstructions }
  return undefined
}

/** Resolve legacy join identity through renames; never key a new dispatch by display name. */
export function memberId(events: readonly SessionEvent[], member: RoomMember): string {
  if (member.id !== undefined) return member.id
  let name = member.name
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]!
    if (event.type === 'room/member-updated' && event.data.rename === name) name = event.data.name
    if (event.type === 'room/member-added' && event.data.name === name) return event.data.id ?? `legacy:${event.seq}`
  }
  throw new Error('Room member has no join identity')
}

export function coordinatorMember(state: RoomState, events?: readonly SessionEvent[]): RoomMember | undefined {
  if (state.coordinator === undefined) return state.members.find(member => member.kind === 'main-agent')
  return state.members.find(member => (member.id ?? (events === undefined ? undefined : memberId(events, member))) === state.coordinator!.memberId)
}
