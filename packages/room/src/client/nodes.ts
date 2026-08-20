/**
 * Room chat-flow projections: the Definitions claiming the room session's
 * `room/*` journal events into chat nodes — `room-speech` (a member's
 * reply), `room-run` (a run's running edge, updated by its terminal edge:
 * done/cancelled hide in place, failed stays as a dim error row), `room-event`
 * (boundary lines: member joined/left), and `room-relay` (the member-to-
 * member notification gate row, folding resolved edges in place). The
 * auto-seated main agent's member-added is bookkeeping, not a boundary
 * event, and is not claimed. `room/dispatch` is deliberately NOT claimed:
 * the human's @-message lands as a standard `user/message` event (see
 * RoomService.postMessage) and renders through the official user node.
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
  /** Why the run failed (failed terminal edges only). */
  readonly error?: string
}

/** Chat node data of one boundary line (member join/leave). */
export interface RoomEventData {
  /** Seq of the source event. */
  readonly seq: number
  /** Unix epoch ms from the event. */
  readonly time: number
  readonly sub: 'member-added' | 'member-removed'
  /** The joining/leaving member. */
  readonly member?: string
  /** The joining member's provider (member-added, cli members). */
  readonly provider?: string
  /** Who invited the joining member (member-added). */
  readonly invitedBy?: 'human' | 'agent'
}

/** Chat node data of one member-to-member notification relay row. */
export interface RoomRelayData {
  /** Seq of the relay's latest journal event. */
  readonly seq: number
  /** Unix epoch ms from the relay event. */
  readonly time: number
  /** The relay id (confirm/dismiss key). */
  readonly relayId: string
  readonly from: string
  readonly to: string
  readonly content: string
  readonly state: 'pending' | 'confirmed' | 'dismissed' | 'sent'
}

/** Chat node data of one task-advance line (the dim "✓ ada 完成了「…」" row). */
export interface RoomTaskLineData {
  /** Seq of the task's LATEST journal event (add or the closing update). */
  readonly seq: number
  /** Unix epoch ms of that event. */
  readonly time: number
  readonly taskId: string
  readonly member: string
  readonly title: string
  readonly status: 'pending' | 'in_progress' | 'done' | 'cancelled'
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ChatNodeDataMap {
    /** room: a member's reply (identity row + unframed markdown + actions). */
    'room-speech': RoomSpeechData
    /** room: a member run's live row (running; failed stays dim). */
    'room-run': RoomRunData
    /** room: a boundary line (join/leave). */
    'room-event': RoomEventData
    /** room: a member-to-member notification relay (gate row). */
    'room-relay': RoomRelayData
    /** room: a task closure's advance line (visible only once done). */
    'room-task-line': RoomTaskLineData
  }
}

/** The shared final-node materialization (single shape across the three kinds). */
function viewNode<State extends { readonly seq: number }>(
  context: ConversationNodeContext<State>,
  kind: string,
  visibility: 'visible' | 'hidden' = 'visible',
): ChatConversationViewNode | null {
  if (context.state === undefined) return null
  return {
    key: context.key,
    kind,
    id: context.id,
    target: 'chat',
    anchorSeq: context.state.seq,
    location: context.start?.location ?? { kind: 'unresolved' },
    visibility,
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
 * error row; done/cancelled hide the row IN PLACE — the assembler's live
 * incremental flush forbids withdrawing a materialized node with null (the
 * withdrawal contract is the same key with `visibility: 'hidden'`; a null
 * there throws and freezes the session's whole chat pipeline), while the
 * speech row or the cancel's own affordances carry the outcome.
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
      ...event.data.error === undefined ? {} : { error: event.data.error },
    }
  },
  buildViewNode: context => viewNode(context, 'room-run',
    context.state !== undefined && (context.state.state === 'done' || context.state.state === 'cancelled')
      ? 'hidden'
      : 'visible'),
}

/**
 * The boundary Definition: one single-event Context per member-added (cli
 * members only — the auto-seated main agent is skipped) or member-removed
 * event. `room/dispatch` stays unclaimed: the human's @-message renders
 * through the official user node (it is also appended as `user/message`).
 */
export const roomEventDefinition: ConversationNodeDefinition<RoomEventData> = {
  kind: 'room-event',
  target: 'chat',
  match: (event) => {
    switch (event.type) {
      case 'room/member-added':
        return event.data.kind === 'main-agent' ? null : { id: String(event.seq), role: 'start' as const }
      case 'room/member-removed':
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
      default:
        throw new Error('room-event start requires a room boundary event')
    }
  },
  update: context => context.state,
  buildViewNode: context => viewNode(context, 'room-event'),
}

/**
 * The relay Definition: one Context per relay (matched on the relay id),
 * started by the `room/relay` event (pending) and updated by each
 * `room/relay-resolved` edge — the gate row's state folds in place.
 */
export const roomRelayDefinition: ConversationNodeDefinition<RoomRelayData> = {
  kind: 'room-relay',
  target: 'chat',
  match: (event) => {
    switch (event.type) {
      case 'room/relay':
        return { id: event.data.id, role: 'start' as const }
      case 'room/relay-resolved':
        return { id: event.data.id, role: 'update' as const }
      default:
        return null
    }
  },
  start: (_context, match) => {
    const event = match.event
    if (event.type !== 'room/relay') throw new Error('room-relay start requires a room/relay event')
    return {
      seq: event.seq,
      time: event.time,
      relayId: event.data.id,
      from: event.data.from,
      to: event.data.to,
      content: event.data.content,
      state: 'pending',
    }
  },
  update: (context, match) => {
    const event = match.event
    if (event.type !== 'room/relay-resolved') return context.state
    return { ...context.state, seq: event.seq, state: event.data.state }
  },
  buildViewNode: context => viewNode(context, 'room-relay'),
}

/**
 * The task-advance Definition: one Context per task (matched on the task id),
 * started by the `room/task-added` event and updated by each
 * `room/task-updated` edge. The node stays HIDDEN while the task is open or
 * cancelled and materializes — at the closing event's seq, so the line sits
 * at the moment of completion — only when the task closes done: the dim
 * advance line `✓ ada 完成了「API 定稿」── 目标进度 2/5`. (The goal progress
 * suffix is computed by the renderer from the room store, not folded here.)
 */
export const roomTaskLineDefinition: ConversationNodeDefinition<RoomTaskLineData> = {
  kind: 'room-task-line',
  target: 'chat',
  match: (event) => {
    switch (event.type) {
      case 'room/task-added':
        return { id: event.data.id, role: 'start' as const }
      case 'room/task-updated':
        return { id: event.data.id, role: 'update' as const }
      default:
        return null
    }
  },
  start: (_context, match) => {
    const event = match.event
    if (event.type !== 'room/task-added') throw new Error('room-task-line start requires a room/task-added event')
    return {
      seq: event.seq,
      time: event.time,
      taskId: event.data.id,
      member: event.data.member,
      title: event.data.title,
      status: event.data.status,
    }
  },
  update: (context, match) => {
    const event = match.event
    if (event.type !== 'room/task-updated') return context.state
    return { ...context.state, seq: event.seq, time: event.time, status: event.data.status }
  },
  buildViewNode: context => viewNode(context, 'room-task-line',
    context.state !== undefined && context.state.status === 'done' ? 'visible' : 'hidden'),
}
