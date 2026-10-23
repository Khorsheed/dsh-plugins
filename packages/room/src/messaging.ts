/**
 * Member messaging: one path for every agent-originated message in a room —
 * the coordinator's delegations, free member-to-member messages (`task`
 * gets the recipient's reply reported back, `notify` is FYI), and delivery
 * reports. Each message is either journaled as a `room/dispatch` and handed
 * to the engine, or HELD as a pending relay carrying its would-be dispatch,
 * because the room is paused, the causal chain reached the hop limit, or the
 * room asks the human to confirm member messages. Releasing a held message
 * creates exactly the dispatch it would have been.
 *
 * Every dispatch knows its `hop` (position in the chain that a human message
 * starts) and renders an envelope line on delivery — who sent it, its
 * `#m<seq>` id, and whether a reply is expected — so a member can tell
 * concurrent requests apart and the report names the message it answers.
 * @module @khorsheed/dsh-room/messaging
 */
import { randomUUID } from 'node:crypto'
import type { Session } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { coordinatorMember, memberId, replay } from './journal.ts'
import type { RoomHeldDispatch, RoomHoldReason, RoomMember, RoomRelay, RoomState } from './types.ts'

/** `RoomHeldDispatch.task` marker: this send starts a task rooted at the dispatch itself. */
export const SELF_TASK = '@self'

/** The id members and the UI use for a dispatch. */
export function messageId(seq: number): string {
  return `m${seq}`
}

/** Parse `m12` / `#m12` / `12` back to a dispatch seq. */
export function parseMessageRef(ref: string | undefined): number | undefined {
  const match = ref === undefined ? null : /^#?m?(\d+)$/.exec(ref.trim())
  return match === null ? undefined : Number(match[1])
}

/** The hop a dispatch sits at (legacy dispatches count as a chain start). */
export function dispatchHop(events: readonly SessionEvent[], seq: number): number {
  const event = events.find(row => row.seq === seq)
  return event?.type === 'room/dispatch' ? event.data.hop ?? 1 : 1
}

/**
 * The hop of whatever a member is working on right now: its running
 * delivery's hop, or 0 when it is not inside a room delivery (a human
 * chatting with the room's agent directly) so its sends start a chain.
 */
export function workingHop(events: readonly SessionEvent[], state: RoomState, member: RoomMember): number {
  const run = state.runs.find(entry => entry.member === member.name && entry.state === 'running')
  const seq = run?.runId === undefined ? undefined : Number(run.runId.split(':', 1)[0])
  return seq === undefined || !Number.isInteger(seq) ? 0 : dispatchHop(events, seq)
}

/**
 * Why a message must wait for the human, if it must. A paused room holds
 * everything agents send; a chain past the limit stops; `confirm` holds
 * member-to-member messages only (never the coordinator's delegations or
 * reports, which the human already asked for).
 */
export function holdReason(state: RoomState, hop: number, origin: RoomHeldDispatch['origin']): RoomHoldReason | undefined {
  const settings = state.settings
  if (settings === undefined) return undefined
  if (settings.paused) return 'paused'
  if (hop > settings.hopLimit) return 'hop-limit'
  if (origin === 'member' && settings.memberMessages === 'confirm') return 'confirm'
  return undefined
}

/** One outgoing agent message. */
export interface OutgoingMessage {
  readonly to: RoomMember
  readonly text: string
  readonly intent: RoomHeldDispatch
  /** Sender's display name for a held card (`from`). */
  readonly fromName: string
}

/** What {@link sendOrHold} did. */
export type SendOutcome =
  | { readonly delivered: true; readonly seq: number }
  | { readonly delivered: false; readonly reason: RoomHoldReason; readonly relayId: string }

/**
 * Journal one agent message: a dispatch (plus the recipient's in-progress
 * board task for a `task`), or a held relay with its intent. The caller
 * flushes and, on delivery, hands `seq` to the engine.
 * @param session - the room session.
 * @param message - recipient, text and the would-be dispatch.
 * @param skipHold - release path: deliver regardless of the hold rules.
 * @returns the dispatch seq, or the hold.
 */
export function sendOrHold(session: Session, message: OutgoingMessage, skipHold = false): SendOutcome {
  const events = session.snapshotEvents()
  const state = replay(events)
  const reason = skipHold ? undefined : holdReason(state, message.intent.hop, message.intent.origin)
  if (reason !== undefined) {
    const relayId = randomUUID()
    session.append('room/relay', {
      id: relayId, from: message.fromName, to: message.to.name, content: message.text, reason, intent: message.intent,
    })
    return { delivered: false, reason, relayId }
  }
  const targetId = memberId(events, message.to)
  const intent = message.intent
  const id = randomUUID()
  // A send that starts a task of its own (no human message behind it) roots the task at itself.
  const task = intent.task === SELF_TASK ? id : intent.task
  const dispatch = session.append('room/dispatch', {
    id, origin: intent.origin,
    ...task === undefined ? {} : { task },
    ...intent.parent === undefined ? {} : { parent: intent.parent }, targets: [message.to.name], targetIds: [targetId], text: message.text, hop: intent.hop,
    ...intent.from === undefined ? {} : { from: intent.from },
    ...intent.kind === undefined ? {} : { kind: intent.kind },
    ...intent.inReplyTo === undefined ? {} : { inReplyTo: intent.inReplyTo },
    ...intent.note === undefined ? {} : { note: intent.note },
    ...intent.replyTo === undefined ? {} : { replyTo: intent.replyTo },
    ...intent.reportFor === undefined ? {} : { reportFor: intent.reportFor },
    ...intent.plan === undefined ? {} : { plan: intent.plan },
  })
  if (intent.origin !== 'report' && intent.kind !== 'notify') {
    const first = message.text.trim().split('\n', 1)[0] ?? ''
    session.append('room/task-added', {
      id: randomUUID(), member: message.to.name, title: first.length > 60 ? `${first.slice(0, 60)}…` : first,
      status: 'in_progress', deliveryId: `${dispatch.seq}:${targetId}`,
    })
  }
  return { delivered: true, seq: dispatch.seq }
}

/**
 * The would-be dispatch of a held relay, re-anchored for release: a chain
 * the human lets continue past the hop limit starts a fresh budget.
 */
export function releaseIntent(relay: RoomRelay): RoomHeldDispatch | undefined {
  if (relay.intent === undefined) return undefined
  return relay.reason === 'hop-limit' ? { ...relay.intent, hop: 1 } : relay.intent
}

const OUTCOME_LABEL: Readonly<Record<string, string>> = {
  done: '完成', cancelled: '已取消', failed: '失败', uncertain: '结果不确定',
}

/**
 * The envelope line a delivered message opens with, or undefined for a
 * dispatch without one (legacy journals). Names resolve against the CURRENT
 * roster, falling back to the last known name of a member who left.
 * @param events - the room log.
 * @param seq - the dispatch being delivered.
 * @returns the envelope line.
 */
export function envelopeLine(events: readonly SessionEvent[], seq: number): string | undefined {
  const event = events.find(row => row.seq === seq)
  if (event?.type !== 'room/dispatch') return undefined
  const dispatch = event.data
  const state = replay(events)
  const nameOf = (id: string | undefined): string | undefined => id === undefined ? undefined
    : state.members.find(member => memberId(events, member) === id)?.name
      ?? events.reduce<string | undefined>((name, row) => row.type === 'room/member-added' && row.data.id === id ? row.data.name : name, undefined)
  const reply = dispatch.inReplyTo === undefined ? '' : ` · 回复 #${messageId(dispatch.inReplyTo)}`
  switch (dispatch.origin) {
    case 'human':
    case undefined:
      return `【来自 你 · #${messageId(seq)}】`
    case 'report': {
      // Plan bookkeeping reports (goal-start:/reconcile:) carry their own text.
      if (dispatch.reportFor === undefined || !/^\d+:/.test(dispatch.reportFor)) return undefined
      const source = Number(dispatch.reportFor.split(':', 1)[0])
      const sender = nameOf(dispatch.reportFor?.split(':').slice(1).join(':'))
      const outcome = events.filter(row => row.type === 'room/delivery-state' && row.data.id === dispatch.reportFor).at(-1)
      const label = outcome?.type === 'room/delivery-state' ? OUTCOME_LABEL[outcome.data.state] ?? outcome.data.state : ''
      return `【#${messageId(source)} 的回报${sender === undefined ? '' : ` · 来自 ${sender}`}${label === '' ? '' : ` · ${label}`}】（这条回复用户已在房间里看到，不要复述）`
    }
    case 'relay':
      return undefined
    default: {
      const sender = nameOf(dispatch.from)
        ?? (dispatch.origin === 'coordinator' ? coordinatorMember(state, events)?.name : undefined) ?? '成员'
      if (dispatch.kind === 'notify') return `【来自 ${sender} · #${messageId(seq)} · 知会${reply}】`
      const back = dispatch.replyTo === undefined && dispatch.plan === undefined ? '' : '（你这一轮的最终回复会自动回报给对方，不用另外回复）'
      return `【来自 ${sender} · #${messageId(seq)} · 派活${reply}】${back}`
    }
  }
}
