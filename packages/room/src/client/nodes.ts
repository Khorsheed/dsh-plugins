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
import type { RoomDecisionEvent, RoomQuestionAnswer, RoomQuestionItem } from '../types.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type {
  ConversationNodeContext, ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-ui-conversation/client'

/** Chat node data of one member speech row. */
export interface RoomSpeechData {
  /** Partial output from a stopped or failed run; never a completed answer. */
  readonly interrupted?: 'cancelled' | 'failed'
  /** The member this reply was also reported to. */
  readonly reportedTo?: string
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
  /** The run this speech closed: its execution metadata (tokens) is keyed by it. */
  readonly runId?: string
  /** The member's closing message in its own session. */
  readonly messageId?: string
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
/** Chat node data of a member's tool approval (the 允许 / 拒绝 line). */
export interface RoomApprovalData {
  readonly seq: number
  readonly time: number
  readonly approvalId: string
  readonly member: string
  readonly tool: string
  readonly reason?: string
  readonly state: 'pending' | 'allowed-once' | 'rejected' | 'cancelled'
}

/** Chat node data of one decision the room made on its own (a timeline row). */
export interface RoomDecisionData {
  readonly seq: number
  readonly time: number
  readonly decision: RoomDecisionEvent
}

/** Chat node data of a member's question card (pick-to-answer). */
export interface RoomQuestionData {
  readonly seq: number
  readonly time: number
  readonly questionId: string
  readonly member: string
  readonly questions: readonly RoomQuestionItem[]
  readonly state: 'pending' | 'answered' | 'cancelled'
  readonly answers?: readonly RoomQuestionAnswer[]
}

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
  /** Why the message waits (absent on legacy relays). */
  readonly reason?: 'confirm' | 'hop-limit' | 'paused'
}

/** Chat node data of the held-reports line for one member. */
export interface RoomInboxData {
  /** Seq of the latest hold (the line sits there). */
  readonly seq: number
  readonly time: number
  readonly member: string
  /** Held dispatch seqs not yet released. */
  readonly held: readonly number[]
  /** The model's yes-probability on the latest hold, when it answered. */
  readonly probability?: number
}

declare module '@deepseek-ai/dsh-client-ui-chat/client' {
  interface ChatNodeDataMap {
    /** room: a member's reply (identity row + unframed markdown + actions). */
    'room-speech': RoomSpeechData
    /** room: a member run's live row (running; failed stays dim). */
    'room-run': RoomRunData
    /** room: a boundary line (join/leave). */
    'room-event': RoomEventData
    /** room: a member-to-member notification relay (gate row). */
    'room-relay': RoomRelayData
    /** room: a member's mode tool waiting for the human's approval. */
    'room-approval': RoomApprovalData
    /** room: a decision the room made on its own (rule or decision model). */
    'room-decision': RoomDecisionData
    /** room: a member's questions for the human (pick-to-answer card). */
    'room-question': RoomQuestionData
    /** room: reports the gate holds in a member's inbox. */
    'room-inbox': RoomInboxData
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
      ...event.data.interrupted === undefined ? {} : { interrupted: event.data.interrupted },
      ...event.data.reportedTo === undefined ? {} : { reportedTo: event.data.reportedTo },
      ...event.data.childSessionId === undefined ? {} : { childSessionId: event.data.childSessionId },
      ...event.data.durationMs === undefined ? {} : { durationMs: event.data.durationMs },
      ...event.data.runId === undefined ? {} : { runId: event.data.runId },
      ...event.data.messageId === undefined ? {} : { messageId: event.data.messageId },
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
    const { error: _error, elapsedMs: _elapsed, ...previous } = context.state
    return {
      ...previous,
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

/** A room decision: one single-event Context per `room/decision`. */
export const roomDecisionDefinition: ConversationNodeDefinition<RoomDecisionData> = {
  kind: 'room-decision',
  target: 'chat',
  match: event => event.type === 'room/decision' ? { id: event.data.id, role: 'start' } : null,
  start: (_context, match) => {
    const event = match.event
    if (event.type !== 'room/decision') throw new Error('room-decision start requires a room/decision event')
    return { seq: event.seq, time: event.time, decision: event.data }
  },
  update: context => context.state,
  buildViewNode: context => viewNode(context, 'room-decision'),
}

/**
 * A member's tool approval: one Context per approval, started by
 * `room/approval` and settled in place by `room/approval-resolved`.
 */
export const roomApprovalDefinition: ConversationNodeDefinition<RoomApprovalData> = {
  kind: 'room-approval',
  target: 'chat',
  match: (event) => {
    switch (event.type) {
      case 'room/approval':
        return { id: event.data.id, role: 'start' as const }
      case 'room/approval-resolved':
        return { id: event.data.id, role: 'update' as const }
      default:
        return null
    }
  },
  start: (_context, match) => {
    const event = match.event
    if (event.type !== 'room/approval') throw new Error('room-approval start requires a room/approval event')
    return {
      seq: event.seq, time: event.time, approvalId: event.data.id, member: event.data.member, tool: event.data.tool,
      ...event.data.reason === undefined ? {} : { reason: event.data.reason },
      state: 'pending',
    }
  },
  update: (context, match) => {
    const event = match.event
    if (event.type !== 'room/approval-resolved') return context.state
    return { ...context.state, state: event.data.outcome }
  },
  buildViewNode: context => viewNode(context, 'room-approval'),
}

/**
 * A member's question card: one Context per card, started by `room/question`
 * and settled in place (with the answers) by `room/question-resolved`.
 */
export const roomQuestionDefinition: ConversationNodeDefinition<RoomQuestionData> = {
  kind: 'room-question',
  target: 'chat',
  match: (event) => {
    switch (event.type) {
      case 'room/question':
        return { id: event.data.id, role: 'start' as const }
      case 'room/question-resolved':
        return { id: event.data.id, role: 'update' as const }
      default:
        return null
    }
  },
  start: (_context, match) => {
    const event = match.event
    if (event.type !== 'room/question') throw new Error('room-question start requires a room/question event')
    return { seq: event.seq, time: event.time, questionId: event.data.id, member: event.data.member, questions: event.data.questions, state: 'pending' }
  },
  update: (context, match) => {
    const event = match.event
    if (event.type !== 'room/question-resolved') return context.state
    return { ...context.state, state: event.data.outcome, ...event.data.answers === undefined ? {} : { answers: event.data.answers } }
  },
  buildViewNode: context => viewNode(context, 'room-question'),
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
      ...event.data.reason === undefined ? {} : { reason: event.data.reason },
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
 * The held-reports line: one Context per member (its gate verdicts), visible
 * while the gate holds reports for it — 「📥 dsh 的收件箱里有 2 条回报，先攒着」
 * with a 现在交给 button — and hidden once they are released. It moves to the
 * latest hold, so it always sits after the reply that was held.
 */
export const roomInboxDefinition: ConversationNodeDefinition<RoomInboxData> = {
  kind: 'room-inbox',
  target: 'chat',
  match: (event) => {
    if (event.type !== 'room/report-gate' || event.data.verdict === 'deliver') return null
    return { id: event.data.memberId, role: event.data.verdict === 'hold' ? 'start' as const : 'update' as const }
  },
  start: (context, match) => {
    const event = match.event
    if (event.type !== 'room/report-gate') throw new Error('room-inbox requires a room/report-gate event')
    const previous = context.state?.held ?? []
    return {
      seq: event.seq, time: event.time, member: event.data.member,
      held: [...previous.filter(seq => seq !== event.data.dispatchSeq), event.data.dispatchSeq],
      ...event.data.probability === undefined ? {} : { probability: event.data.probability },
    }
  },
  update: (context, match) => {
    const event = match.event
    if (event.type !== 'room/report-gate' || context.state === undefined) return context.state
    if (event.data.verdict === 'hold') {
      return { ...context.state, seq: event.seq, time: event.time, held: [...context.state.held.filter(seq => seq !== event.data.dispatchSeq), event.data.dispatchSeq],
        ...event.data.probability === undefined ? {} : { probability: event.data.probability } }
    }
    return { ...context.state, held: context.state.held.filter(seq => seq !== event.data.dispatchSeq) }
  },
  buildViewNode: context => viewNode(context, 'room-inbox', context.state !== undefined && context.state.held.length > 0 ? 'visible' : 'hidden'),
}
