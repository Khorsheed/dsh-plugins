/**
 * Room rounds. In a room session the main conversation stops running turns
 * once another member coordinates or a human addresses members directly; the
 * work then happens in the members' own child sessions, started by the room
 * plugin's dispatches. This module reads the room plugin's session events
 * structurally (no dependency on the package; absent events change nothing)
 * and keeps what the panel needs to show each human dispatch made outside a
 * main turn as a round of its own, with the whole collaboration tree descended
 * from it. Non-human dispatches contribute parent/report links, never rounds:
 *
 * - `room/member-added`: member id → display name; `room/member-updated`
 *   with `rename`: that member's new name (it addresses the member by name).
 * - `room/dispatch` with `origin: 'human'`: the message, its time, its targets;
 *   other origins retain `parent` / `reportFor` / `releases` as tree links.
 * - `room/run-state`: one member run per `runId` — `<dispatchSeq>:<memberId>`
 *   for a journaled dispatch's delivery, a bare UUID for one that is not (a
 *   confirmed relay's delivery), absent on legacy journals (keyed by member
 *   and start then) — its time span, its child session, and — when the
 *   producer records it — the child turn the run became (`childTurn`) and the
 *   member execution it is (`executionId`, batch 5). Only runs with a
 *   dispatch seq belong to a round.
 * - `room/decision` with a call: the decision-model call, and the run and
 *   task it was made for (`runId`, `task`, batch 5 S9) when recorded.
 * - `room/coordinator`: coordinator handoffs, drawn on the session map.
 *
 * @module @khorsheed/dsh-context-lens/room
 */
import type { LensJsonValue, RoomDecisionRow } from './types.ts'
import { readAnswers, readQuestions, type RoomQuestionRecord } from './ask.ts'

/**
 * A round the member's CLI opened on its own when a background task ended
 * (local-agent cause `self`, member-self-started-rounds A①): the task, how it
 * ended, and the execution that started it (`startedBy`, written only when
 * the core followed the recorded chain; never guessed here either).
 */
export interface SelfCause {
  taskId: string
  taskStatus: string
  startedBy?: string
}

/** The `self` cause of an execution start, read structurally; undefined for any other cause. */
export function selfCauseOf(cause: Record<string, unknown> | undefined): SelfCause | undefined {
  if (cause?.['kind'] !== 'self') return undefined
  const taskId = cause['taskId'], taskStatus = cause['taskStatus'], startedBy = cause['startedBy']
  return {
    taskId: typeof taskId === 'string' ? taskId : '',
    taskStatus: typeof taskStatus === 'string' ? taskStatus : '',
    ...typeof startedBy === 'string' && startedBy !== '' ? { startedBy } : {},
  }
}

/** One member run of a dispatch. */
export interface RoomRun {
  /** The producer's run id; `legacy:<member>:<startedAt>` for a legacy run without one. */
  runId: string
  /** The human/agent dispatch the run delivered; absent for a run id that names none (a relay delivery's UUID, a legacy run). */
  dispatchSeq?: number
  /** The member's roster id: from the run id, else resolved from the run's member name, else that name. */
  memberId: string
  member?: string
  state?: string
  startedAt?: number
  endedAt?: number
  childSessionId?: string
  /** The child session turn this run became, when the producer records it. */
  childTurn?: number
  /** The member's local-agent execution this run is (batch 5 S5): its records in the child name the run's requests. */
  executionId?: string
  /** `compact` for a `/compact` run. */
  operation?: string
}

/**
 * Whether a run carries a write-side record that names its requests: an
 * execution id (the child's `local-agent/execution` records) or a child turn
 * the producer wrote. A run with neither has no room-dimension view.
 */
export const runRecorded = (run: RoomRun): boolean => run.executionId !== undefined || run.childTurn !== undefined

/** One human message to the room. */
export interface RoomDispatch {
  seq: number
  at: number
  text: string
  targets: string[]
  /** The human's user/message the post appended alongside (the chat's anchor for the round). */
  messageId?: string
}

/** A non-human dispatch's place in the collaboration tree; it never opens a numbered round. */
export interface RoomDispatchLink {
  seq: number
  origin: string
  parent?: string
  reportFor?: string
  /** The task the dispatch belongs to (the human message id that started it), when room recorded one. */
  task?: string
  releases: number[]
}

/** What one session's room events say, accumulated (log backfill and live alike). */
export interface RoomState {
  members: Map<string, string>
  dispatches: RoomDispatch[]
  dispatchLinks: Map<number, RoomDispatchLink>
  runs: Map<string, RoomRun>
  handoffs: { seq: number; at: number; memberId: string }[]
  /** The decision-model calls the room recorded (`room/decision` with a call). */
  decisions: RoomDecisionRow[]
  /** The questions members asked the human (`room/question`), with how each resolved. */
  questions: Map<string, RoomQuestionRecord>
  /** Event seqs already applied (backfill and live may both deliver one). */
  seen: Set<number>
}

export function emptyRoom(): RoomState {
  return { members: new Map(), dispatches: [], dispatchLinks: new Map(), runs: new Map(), handoffs: [], decisions: [], questions: new Map(), seen: new Set() }
}

/**
 * Mirror of the local-agent core's `isCompactCommand` (lens stays
 * dependency-free): a human dispatch that is `/compact` alone runs a
 * compaction round, not a round of its own. Pinned to the core by the room
 * contract fixture (`tests/fixtures/room-contract.json`, generated by room's
 * `tests/lens-contract.host.spec.ts`).
 * @param text - a human dispatch's text.
 * @returns whether it asks for a compaction.
 */
export function isCompactCommand(text: string): boolean {
  return text.trim() === '/compact'
}

const str = (value: unknown): string | undefined => typeof value === 'string' && value.length > 0 ? value : undefined
const num = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) ? value : undefined

/**
 * Apply one `room/*` event. Unknown types and malformed payloads are ignored.
 * @returns whether the event was a room event this module reads.
 */
export function applyRoomEvent(room: RoomState, type: string, data: unknown, seq: number | undefined, at: number | undefined): boolean {
  if (!type.startsWith('room/')) return false
  if (seq !== undefined) {
    if (room.seen.has(seq)) return true
    room.seen.add(seq)
  }
  const d = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>
  switch (type) {
    case 'room/member-added': {
      const id = str(d['id']), name = str(d['name'])
      if (id !== undefined && name !== undefined) room.members.set(id, name)
      return true
    }
    case 'room/member-updated': {
      // Addressed by the member's CURRENT name; a rename carries the new one.
      const name = str(d['name']), rename = str(d['rename'])
      if (name === undefined || rename === undefined) return true
      for (const [id, current] of room.members) if (current === name) room.members.set(id, rename)
      return true
    }
    case 'room/dispatch': {
      if (seq === undefined || at === undefined) return true
      const origin = str(d['origin']) ?? ''
      if (origin !== 'human') {
        const parent = str(d['parent']), reportFor = str(d['reportFor']), task = str(d['task'])
        const releases = Array.isArray(d['releases']) ? d['releases'].filter((value): value is number => typeof value === 'number' && Number.isSafeInteger(value)) : []
        room.dispatchLinks.set(seq, { seq, origin, ...parent === undefined ? {} : { parent }, ...reportFor === undefined ? {} : { reportFor }, ...task === undefined ? {} : { task }, releases })
        return true
      }
      const targets = Array.isArray(d['targets']) ? d['targets'].filter((t): t is string => typeof t === 'string') : []
      const messageId = str(d['messageId'])
      room.dispatches.push({ seq, at, text: str(d['text']) ?? '', targets, ...messageId === undefined ? {} : { messageId } })
      return true
    }
    case 'room/run-state': {
      const member = str(d['member']), state = str(d['state']), child = str(d['childSessionId'])
      const startedAt = num(d['startedAt']), elapsed = num(d['elapsedMs']), childTurn = num(d['childTurn'])
      const runId = str(d['runId']) ?? (member !== undefined && startedAt !== undefined ? `legacy:${member}:${startedAt}` : undefined)
      if (runId === undefined) return true
      const delivery = /^(\d+):(.+)$/.exec(runId)
      const dispatchSeq = delivery === null ? undefined : Number(delivery[1])
      const memberId = delivery?.[2] ?? (member === undefined ? undefined : memberIdByName(room, member)) ?? member ?? runId
      const run = room.runs.get(runId) ?? { runId, ...dispatchSeq === undefined || !Number.isSafeInteger(dispatchSeq) ? {} : { dispatchSeq }, memberId }
      if (member !== undefined) run.member = member
      if (state !== undefined) run.state = state
      if (startedAt !== undefined) run.startedAt = startedAt
      // Only a terminal edge ends a run: its own elapsedMs when it reports one,
      // else the edge's time. The first terminal edge wins (a restart's
      // `failed` is followed by a `cancelled` when the human moves on).
      const terminal = state === 'done' || state === 'failed' || state === 'cancelled'
      if (terminal && startedAt !== undefined && elapsed !== undefined) run.endedAt ??= startedAt + elapsed
      else if (terminal && at !== undefined) run.endedAt ??= at
      if (child !== undefined) run.childSessionId = child
      if (childTurn !== undefined) run.childTurn = childTurn
      const executionId = str(d['executionId']), operation = str(d['operation'])
      if (executionId !== undefined) run.executionId = executionId
      if (operation !== undefined) run.operation = operation
      room.runs.set(runId, run)
      return true
    }
    case 'room/decision': {
      const call = (typeof d['call'] === 'object' && d['call'] !== null ? d['call'] : undefined) as Record<string, unknown> | undefined
      const id = str(d['id']), scenario = str(d['scenario']), outcome = str(d['outcome'])
      if (call === undefined || id === undefined || scenario === undefined || outcome === undefined || seq === undefined || at === undefined) return true
      const request = (typeof call['request'] === 'object' && call['request'] !== null ? call['request'] : {}) as Record<string, unknown>
      const failure = call['failure'] as { reason?: unknown; detail?: unknown } | undefined
      const about = (typeof d['about'] === 'object' && d['about'] !== null ? d['about'] : {}) as RoomDecisionRow['about']
      room.decisions.push({
        id, seq, at, scenario, outcome, model: str(call['model']) ?? 'typesafe', about,
        request: { state: (request['state'] ?? null) as LensJsonValue, questions: (request['questions'] ?? null) as LensJsonValue },
        ...str(d['rule']) === undefined ? {} : { rule: str(d['rule'])! },
        ...num(d['probability']) === undefined ? {} : { probability: num(d['probability'])! },
        ...num(call['latencyMs']) === undefined ? {} : { latencyMs: num(call['latencyMs'])! },
        ...typeof call['cached'] === 'boolean' ? { cached: call['cached'] } : {},
        ...num(call['inputTokens']) === undefined ? {} : { inputTokens: num(call['inputTokens'])! },
        ...num(call['outputTokens']) === undefined ? {} : { outputTokens: num(call['outputTokens'])! },
        ...call['response'] === undefined ? {} : { response: call['response'] as LensJsonValue },
        ...typeof failure?.reason === 'string' ? { failure: { reason: failure.reason, ...typeof failure.detail === 'string' ? { detail: failure.detail } : {} } } : {},
        ...str(d['task']) === undefined ? {} : { task: str(d['task'])! },
        ...str(d['runId']) === undefined ? {} : { runId: str(d['runId'])! },
        ...str(d['executionId']) === undefined ? {} : { executionId: str(d['executionId'])! },
      })
      return true
    }
    case 'room/question': {
      const id = str(d['id']), questions = readQuestions(d['questions'])
      if (id === undefined || questions === undefined || at === undefined) return true
      const member = str(d['member']), memberId = str(d['memberId']), runId = str(d['runId'])
      room.questions.set(id, {
        id, questions, askedAt: at,
        ...member === undefined ? {} : { member },
        ...memberId === undefined ? {} : { memberId },
        ...runId === undefined ? {} : { runId },
      })
      return true
    }
    case 'room/question-resolved': {
      // A question can resolve twice: cancelled (expired), then answered late.
      const record = room.questions.get(str(d['id']) ?? '')
      if (record === undefined) return true
      const outcome = d['outcome'] === 'answered' ? 'answered' : d['outcome'] === 'cancelled' ? 'cancelled' : undefined
      if (outcome === undefined || (record.outcome === 'answered' && outcome === 'cancelled')) return true
      record.outcome = outcome
      if (at !== undefined) record.resolvedAt = at
      const answers = readAnswers(d['answers'])
      if (answers !== undefined) record.answers = answers
      if (d['late'] === true) record.late = true
      return true
    }
    case 'room/coordinator': {
      const memberId = str(d['memberId'])
      if (memberId !== undefined && seq !== undefined && at !== undefined) room.handoffs.push({ seq, at, memberId })
      return true
    }
    default:
      return true
  }
}

/** A member's roster id by its current name (run-state edges name the member as it was called then). */
function memberIdByName(room: RoomState, name: string): string | undefined {
  for (const [id, current] of room.members) if (current === name) return id
  return undefined
}

/** The runs a dispatch started, in start order. */
export function runsOf(room: RoomState, dispatchSeq: number): RoomRun[] {
  return [...room.runs.values()].filter(run => run.dispatchSeq === dispatchSeq)
    .sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0))
}

/** Every run descended from one human dispatch through recorded parent/report links. */
export function collaborationRuns(room: RoomState, dispatchSeq: number): RoomRun[] {
  const out = runsOf(room, dispatchSeq)
  const seenRuns = new Set(out.map(run => run.runId))
  const seenDispatches = new Set([dispatchSeq])
  for (let index = 0; index < out.length; index += 1) {
    const runId = out[index]!.runId
    const children = [...room.dispatchLinks.values()].filter(link => link.parent === runId || link.reportFor === runId
      || link.releases.some(seq => room.dispatchLinks.get(seq)?.reportFor === runId))
      .sort((a, b) => a.seq - b.seq)
    for (const link of children) {
      if (seenDispatches.has(link.seq)) continue
      seenDispatches.add(link.seq)
      for (const run of runsOf(room, link.seq)) {
        if (seenRuns.has(run.runId)) continue
        seenRuns.add(run.runId)
        out.push(run)
      }
    }
  }
  return out.sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0) || (a.dispatchSeq ?? Number.MAX_SAFE_INTEGER) - (b.dispatchSeq ?? Number.MAX_SAFE_INTEGER) || a.runId.localeCompare(b.runId))
}

/** The human root of every run that belongs to a collaboration tree; first recorded root wins malformed duplicates. */
export function collaborationRoots(room: RoomState): Map<string, number> {
  const roots = new Map<string, number>()
  for (const dispatch of room.dispatches) {
    for (const run of collaborationRuns(room, dispatch.seq)) if (!roots.has(run.runId)) roots.set(run.runId, dispatch.seq)
  }
  return roots
}

/** How far back a human room post's own user/message may sit before its room/dispatch. */
export const HUMAN_MESSAGE_LOOKBACK = 12

/** A synthetic, stable panel address for a room round (far below any purpose bucket). */
export const ROOM_TURN_BASE = -1_000_000
export const roomTurnSeq = (dispatchSeq: number): number => ROOM_TURN_BASE - dispatchSeq

/** The room's 未归轮 group's panel address (no dispatch has seq 0: that is the log header). */
export const ROOM_UNATTRIBUTED_TURN = ROOM_TURN_BASE
