/**
 * The receipt line under a human message (room-timeline-interaction-order
 * B①/B②): one quiet row that says what became of the message for each
 * recipient — 排队中 / 已暂停 / 等核对 / 暂存 / 排队 N 后送达 / 当作回答交给了
 * 这一轮 / 已撤回 / 没送达. Its only source is the room's deliveries (the same
 * rows the member-to-member 排队中 tag reads); the official bubble cannot
 * carry it (its seat names no message id), so it is a node of its own,
 * claiming the human's `room/dispatch` — no Definition claimed it before.
 *
 * Old logs: every delivery there has settled, so the line shows only where
 * something worth knowing happened (it waited, was withdrawn, failed, was
 * superseded, answered a question); a dispatch from before `targetIds` has
 * no delivery rows and no line. A message the room's own agent writes when
 * it takes the message in (the direct path) has no bubble above the
 * dispatch, so no line either — it waits in the queue above the composer.
 * @module @khorsheed/dsh-room/client/receipt
 */
import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import { ANSWERED_QUESTION_TEXT, WITHDRAWN_TEXT } from '../delivery-notes.ts'
import type { RoomDelivery, RoomState } from '../types.ts'

/** Chat node data of one human message's receipt line. */
export interface RoomReceiptData {
  /** Seq of the human `room/dispatch` (its deliveries are keyed by it). */
  readonly seq: number
  readonly time: number
  /** The human message it is the receipt of. */
  readonly messageId: string
}

declare module '@deepseek-ai/dsh-client-ui-chat/client' {
  interface ChatNodeDataMap {
    /** room: the delivery state under a human message (排队中 · 撤回 …). */
    'room-receipt': RoomReceiptData
  }
}

/**
 * The receipt Definition: one single-event Context per human `room/dispatch`
 * that names its message (an invite's first task names none) and is not the
 * room's own 「全部继续」 (its own row). Delivery state is read from the room
 * state at render time, so no update edge is claimed.
 */
export const roomReceiptDefinition: ConversationNodeDefinition<RoomReceiptData> = {
  kind: 'room-receipt',
  target: 'chat',
  match: (event) => {
    if (event.type !== 'room/dispatch') return null
    const data = event.data
    if ((data.origin ?? 'human') !== 'human' || data.via === 'auto-continue' || data.messageId === undefined || data.targetIds === undefined) return null
    return { id: String(event.seq), role: 'start' as const }
  },
  start: (_context, match) => {
    const event = match.event
    if (event.type !== 'room/dispatch' || event.data.messageId === undefined) throw new Error('room-receipt start requires a human room/dispatch event')
    return { seq: event.seq, time: event.time, messageId: event.data.messageId }
  },
  update: context => context.state,
  buildViewNode: (context) => {
    if (context.state === undefined) return null
    return {
      key: context.key, kind: 'room-receipt', id: context.id, target: 'chat', anchorSeq: context.state.seq,
      location: context.start?.location ?? { kind: 'unresolved' }, visibility: 'visible', data: context.state,
    } as ChatConversationViewNode
  },
}

/**
 * Below this, a message reached its member "at once": no line (most messages
 * do — noise on every bubble would bury the ones that waited).
 */
export const QUEUE_SHOWN_MS = 10_000

/** One recipient's state on the line. */
export interface ReceiptPart {
  readonly deliveryId: string
  readonly dispatchSeq: number
  readonly memberId: string
  /** The recipient's current name (a removed member keeps its id). */
  readonly member: string
  readonly kind: 'queued' | 'paused' | 'reconcile' | 'held' | 'waited' | 'answered' | 'withdrawn' | 'cancelled' | 'failed' | 'uncertain' | 'received'
  /** `waited`: how long it queued before its member took it in. */
  readonly waitedMs?: number
  /** `cancelled`/`failed`/`uncertain`: why, in the settling edge's words. */
  readonly reason?: string
}

/** How a part reads (the line's colour). */
export function receiptTone(kind: ReceiptPart['kind']): 'wait' | 'ok' | 'bad' | 'quiet' | 'into' {
  switch (kind) {
    case 'queued': case 'paused': case 'reconcile': return 'wait'
    case 'answered': return 'into'
    case 'failed': case 'uncertain': return 'bad'
    case 'received': return 'ok'
    default: return 'quiet'
  }
}

function partOf(row: RoomDelivery, state: RoomState): ReceiptPart {
  const base = { deliveryId: row.id, dispatchSeq: row.dispatchSeq, memberId: row.memberId, member: state.members.find(member => member.id === row.memberId)?.name ?? row.memberId }
  switch (row.status) {
    case 'queued':
      if (row.waiting === 'reconcile') return { ...base, kind: 'reconcile' }
      return { ...base, kind: state.restartFacts?.queuePaused?.includes(row.memberId) === true ? 'paused' : 'queued' }
    case 'held':
      return { ...base, kind: 'held' }
    case 'running':
    case 'done': {
      if (row.note === ANSWERED_QUESTION_TEXT) return { ...base, kind: 'answered' }
      const waited = row.startedAt === undefined ? 0 : row.startedAt - row.queuedAt
      return waited >= QUEUE_SHOWN_MS ? { ...base, kind: 'waited', waitedMs: waited } : { ...base, kind: 'received' }
    }
    case 'cancelled':
      if (row.note === WITHDRAWN_TEXT) return { ...base, kind: 'withdrawn' }
      return { ...base, kind: 'cancelled', ...row.note === undefined ? {} : { reason: row.note } }
    case 'failed':
      return { ...base, kind: 'failed', ...row.error === undefined ? {} : { reason: row.error } }
    case 'uncertain':
      return { ...base, kind: 'uncertain', ...row.error === undefined ? {} : { reason: row.error } }
  }
}

/**
 * The receipt line of one human dispatch: each recipient's part, in the
 * dispatch's target order. Undefined when there is nothing to say — no
 * delivery rows (a legacy dispatch), no bubble above the dispatch (the
 * direct path), or every recipient took it in at once.
 * @param state - the room state (deliveries, roster, restart facts).
 * @param dispatchSeq - the human dispatch's seq.
 * @returns the parts, or undefined.
 */
export function receiptParts(state: RoomState | undefined, dispatchSeq: number): readonly ReceiptPart[] | undefined {
  const rows = (state?.deliveries ?? []).filter(row => row.dispatchSeq === dispatchSeq && row.origin === 'human')
  if (state === undefined || rows.length === 0 || rows.some(row => row.bubble !== 'before')) return undefined
  const parts = rows.map(row => partOf(row, state))
  return parts.every(part => part.kind === 'received') ? undefined : parts
}

/** Whether every recipient's delivery was withdrawn (the bubble reads as taken back). */
export function receiptWithdrawn(parts: readonly ReceiptPart[] | undefined): boolean {
  return parts !== undefined && parts.length > 0 && parts.every(part => part.kind === 'withdrawn')
}
