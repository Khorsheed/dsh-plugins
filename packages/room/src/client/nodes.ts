/**
 * Room chat-flow projections: the three Definitions claiming the room
 * session's `room/*` journal events into chat nodes — `room-speech` (a
 * member's reply), `room-run` (a run's running edge, updated by its terminal
 * edge: done/cancelled vanish, failed stays as a dim error row), and
 * `room-event` (boundary lines: member joined/left, plus the human's own
 * dispatch/note messages, which otherwise never appear in the flow — the
 * room composer appends journal events, not user/message events). The
 * auto-seated main agent's member-added is bookkeeping, not a boundary
 * event, and is not claimed.
 * @module @khorsheed/dsh-room/client/nodes
 */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  ChatConversationViewNode, ConversationNodeContext, ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-runtime/client'

/** Chat node data of one member speech row. */
export interface RoomSpeechData {
  /** Seq of the room/speech event. */
  readonly seq: number
  /** Unix epoch ms from the event. */
  readonly time: number
  readonly member: string
  readonly text: string
  /** The member's child session (jump target), when recorded. */
  readonly childSessionId?: SessionId
  /** Dispatch→settle milliseconds, when measured. */
  readonly durationMs?: number
}

/** Chat node data of one member run row. */
export interface RoomRunData {
  /** Seq of the running edge's event. */
  readonly seq: number
  /** Unix epoch ms from the running edge's event. */
  readonly time: number
  readonly member: string
  readonly startedAt: number
  readonly state: 'running' | 'done' | 'cancelled' | 'failed'
  /** Settled run milliseconds (terminal edges only). */
  readonly elapsedMs?: number
}

/** Chat node data of one boundary/blackboard line. */
export interface RoomEventData {
  /** Seq of the source event. */
  readonly seq: number
  /** Unix epoch ms from the event. */
  readonly time: number
  readonly sub: 'member-added' | 'member-removed' | 'dispatch' | 'note'
  /** The joining/leaving member (member-added/member-removed). */
  readonly member?: string
  /** The joining member's provider (member-added, cli members). */
  readonly provider?: string
  /** Who invited the joining member (member-added). */
  readonly invitedBy?: 'human' | 'agent'
  /** Addressed members (dispatch). */
  readonly targets?: readonly string[]
  /** The human's text (dispatch/note). */
  readonly text?: string
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ChatNodeDataMap {
    /** room: a member's reply (identity row + unframed markdown + actions). */
    'room-speech': RoomSpeechData
    /** room: a member run's live row (running; failed stays dim). */
    'room-run': RoomRunData
    /** room: a boundary line (join/leave) or the human's own message. */
    'room-event': RoomEventData
  }
}

/** The shared final-node materialization (single shape across the three kinds). */
function viewNode<State extends { readonly seq: number }>(
  context: ConversationNodeContext<State>,
  kind: string,
): ChatConversationViewNode | null {
  if (context.state === undefined) return null
  return {
    key: context.key,
    kind,
    id: context.id,
    target: 'chat',
    anchorSeq: context.state.seq,
    location: context.start?.location ?? { kind: 'unresolved' },
    visibility: 'visible',
    data: context.state,
  } as ChatConversationViewNode
}

/**
 * The member-speech Definition: one single-event Context per room/speech
 * event (a CLI member's reply mirrored onto the blackboard).
 */
export const roomSpeechDefinition: ConversationNodeDefinition<RoomSpeechData> = {
  kind: 'room-speech',
  target: 'chat',
  match: event => event.type === 'room/speech'
    ? { id: String(event.seq), role: 'start' }
    : null,
  start: (_context, match) => {
    const event = match.event
    if (event.type !== 'room/speech') throw new Error('room-speech start requires a room/speech event')
    return {
      seq: event.seq,
      time: event.time,
      member: event.data.member,
      text: event.data.text,
      ...event.data.childSessionId === undefined ? {} : { childSessionId: event.data.childSessionId },
      ...event.data.durationMs === undefined ? {} : { durationMs: event.data.durationMs },
    }
  },
  update: context => context.state,
  buildViewNode: context => viewNode(context, 'room-speech'),
}

/**
 * The member-run Definition: one Context per run (matched on
 * member+startedAt), started by the running edge and updated by its terminal
 * edge. A running run renders the live row; a failed run stays as a dim
 * error row; done/cancelled dematerialize (the speech row or the cancel's
 * own affordances carry the outcome).
 */
export const roomRunDefinition: ConversationNodeDefinition<RoomRunData> = {
  kind: 'room-run',
  target: 'chat',
  match: event => event.type === 'room/run-state'
    ? {
      id: `${event.data.member}:${event.data.startedAt}`,
      role: event.data.state === 'running' ? 'start' : 'update',
    }
    : null,
  start: (_context, match) => {
    const event = match.event
    if (event.type !== 'room/run-state') throw new Error('room-run start requires a room/run-state event')
    return {
      seq: event.seq,
      time: event.time,
      member: event.data.member,
      startedAt: event.data.startedAt,
      state: event.data.state,
    }
  },
  update: (context, match) => {
    const event = match.event
    if (event.type !== 'room/run-state') return context.state
    return {
      ...context.state,
      state: event.data.state,
      ...event.data.elapsedMs === undefined ? {} : { elapsedMs: event.data.elapsedMs },
    }
  },
  buildViewNode: (context) => {
    // Terminal edges dematerialize the row — except a failure, which stays.
    if (context.state !== undefined
      && (context.state.state === 'done' || context.state.state === 'cancelled')) return null
    return viewNode(context, 'room-run')
  },
}

/**
 * The boundary/blackboard Definition: one single-event Context per
 * member-added (cli members only — the auto-seated main agent is skipped),
 * member-removed, dispatch, or note event.
 */
export const roomEventDefinition: ConversationNodeDefinition<RoomEventData> = {
  kind: 'room-event',
  target: 'chat',
  match: (event) => {
    switch (event.type) {
      case 'room/member-added':
        return event.data.kind === 'main-agent' ? null : { id: String(event.seq), role: 'start' as const }
      case 'room/member-removed':
      case 'room/dispatch':
      case 'room/note':
        return { id: String(event.seq), role: 'start' as const }
      default:
        return null
    }
  },
  start: (_context, match) => {
    const event = match.event
    switch (event.type) {
      case 'room/member-added':
        return {
          seq: event.seq,
          time: event.time,
          sub: 'member-added',
          member: event.data.name,
          invitedBy: event.data.invitedBy,
          ...event.data.provider === undefined ? {} : { provider: event.data.provider },
        }
      case 'room/member-removed':
        return { seq: event.seq, time: event.time, sub: 'member-removed', member: event.data.name }
      case 'room/dispatch':
        return { seq: event.seq, time: event.time, sub: 'dispatch', targets: event.data.targets, text: event.data.text }
      case 'room/note':
        return { seq: event.seq, time: event.time, sub: 'note', text: event.data.text }
      default:
        throw new Error('room-event start requires a room boundary/blackboard event')
    }
  },
  update: context => context.state,
  buildViewNode: context => viewNode(context, 'room-event'),
}
