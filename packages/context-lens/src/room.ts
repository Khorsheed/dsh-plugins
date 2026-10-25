/**
 * Room rounds. In a room session the main conversation stops running turns
 * once another member coordinates or a human addresses members directly; the
 * work then happens in the members' own child sessions, started by the room
 * plugin's dispatches. This module reads the room plugin's session events
 * structurally (no dependency on the package; absent events change nothing)
 * and keeps what the panel needs to show each human dispatch made outside a
 * main turn as a round of its own, with the member runs it started:
 *
 * - `room/member-added` / `room/member-updated`: member id → display name.
 * - `room/dispatch` with `origin: 'human'`: the message, its time, its targets.
 * - `room/run-state`: one member run per `runId` (`<dispatchSeq>:<memberId>`),
 *   its time span, its child session, and — when the producer records it —
 *   the child turn the run became (`childTurn`).
 * - `room/coordinator`: coordinator handoffs, drawn on the session map.
 *
 * @module @khorsheed/dsh-context-lens/room
 */
import type { LensJsonValue, RoomDecisionRow } from './types.ts'

/** One member run of a dispatch. */
export interface RoomRun {
  runId: string
  dispatchSeq: number
  memberId: string
  member?: string
  state?: string
  startedAt?: number
  endedAt?: number
  childSessionId?: string
  /** The child session turn this run became, when the producer records it. */
  childTurn?: number
}

/** One human message to the room. */
export interface RoomDispatch {
  seq: number
  at: number
  text: string
  targets: string[]
}

/** What one session's room events say, accumulated (log backfill and live alike). */
export interface RoomState {
  members: Map<string, string>
  dispatches: RoomDispatch[]
  runs: Map<string, RoomRun>
  handoffs: { seq: number; at: number; memberId: string }[]
  /** The decision-model calls the room recorded (`room/decision` with a call). */
  decisions: RoomDecisionRow[]
  /** Event seqs already applied (backfill and live may both deliver one). */
  seen: Set<number>
}

export function emptyRoom(): RoomState {
  return { members: new Map(), dispatches: [], runs: new Map(), handoffs: [], decisions: [], seen: new Set() }
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
    case 'room/member-added':
    case 'room/member-updated': {
      const id = str(d['id']), name = str(d['name'])
      if (id !== undefined && name !== undefined) room.members.set(id, name)
      return true
    }
    case 'room/dispatch': {
      if (d['origin'] !== 'human' || seq === undefined || at === undefined) return true
      const targets = Array.isArray(d['targets']) ? d['targets'].filter((t): t is string => typeof t === 'string') : []
      room.dispatches.push({ seq, at, text: str(d['text']) ?? '', targets })
      return true
    }
    case 'room/run-state': {
      const runId = str(d['runId'])
      if (runId === undefined) return true
      const [head, ...rest] = runId.split(':')
      const dispatchSeq = Number(head)
      if (!Number.isSafeInteger(dispatchSeq)) return true
      const run = room.runs.get(runId) ?? { runId, dispatchSeq, memberId: rest.join(':') }
      const member = str(d['member']), state = str(d['state']), child = str(d['childSessionId'])
      const startedAt = num(d['startedAt']), elapsed = num(d['elapsedMs']), childTurn = num(d['childTurn'])
      if (member !== undefined) run.member = member
      if (state !== undefined) run.state = state
      if (startedAt !== undefined) run.startedAt = startedAt
      if (startedAt !== undefined && elapsed !== undefined) run.endedAt = startedAt + elapsed
      else if ((state === 'done' || state === 'failed') && at !== undefined) run.endedAt ??= at
      if (child !== undefined) run.childSessionId = child
      if (childTurn !== undefined) run.childTurn = childTurn
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
      })
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

/** The runs a dispatch started, in start order. */
export function runsOf(room: RoomState, dispatchSeq: number): RoomRun[] {
  return [...room.runs.values()].filter(run => run.dispatchSeq === dispatchSeq)
    .sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0))
}

/** A synthetic, stable panel address for a room round (far below any purpose bucket). */
export const ROOM_TURN_BASE = -1_000_000
export const roomTurnSeq = (dispatchSeq: number): number => ROOM_TURN_BASE - dispatchSeq
