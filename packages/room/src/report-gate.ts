/**
 * The report gate: decides only WHEN a delivery's report is handed to the
 * member waiting on it — now (a round that wakes it), or held in its inbox
 * until more results arrive. What the recipient then says or does next is
 * its own call; the gate never edits, drops or summarizes a report, and a
 * held report still reaches the recipient (a native agent's inbox, or carried
 * by a CLI member's next round).
 *
 * Rules answer first: failures and uncertain outcomes, the last outstanding
 * result, the `each` setting, and an unavailable decision model all hand the
 * report over now. Otherwise the decision model answers the `report-timing`
 * scenario question (decisions.ts) from what the recipient said it waits for,
 * how long the human has been waiting, and the progress of everything still
 * out; the room's threshold turns its probability into now / later.
 * @module @khorsheed/dsh-room/report-gate
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { memberId, replay } from './journal.ts'
import type { RoomDecisionCall, RoomDelivery, RoomMember } from './types.ts'
import { askDecisionModel, DECISION_SCENARIOS, hasDecisionModel } from './decisions.ts'

/** The gate's verdict. */
export interface GateVerdict {
  readonly hold: boolean
  readonly reason: string
  readonly probability?: number
  /** The decision-model call behind it, when one went out. */
  readonly call?: RoomDecisionCall
}

/** One arrived report, as the gate sees it. */
export interface ArrivedReport {
  readonly from: string
  readonly outcome: string
  readonly text: string
}

/** Deliveries still out that report to this member (queued or running), newest first. */
export function outstandingFor(deliveries: readonly RoomDelivery[], recipientId: string, except: string): readonly RoomDelivery[] {
  return deliveries.filter(row => row.id !== except && row.replyTo === recipientId && (row.status === 'queued' || row.status === 'running'))
}

/**
 * The state the decision model judges.
 * @param events - the room log.
 * @param recipient - the member waiting on the report.
 * @param arrived - this report plus the ones held for the same member.
 * @param now - the clock.
 * @returns a JSON-safe state.
 */
export function gateState(events: readonly SessionEvent[], recipient: RoomMember, arrived: readonly ArrivedReport[], now: number): unknown {
  const state = replay(events)
  const recipientId = memberId(events, recipient)
  const lastHuman = events.filter(event => event.type === 'user/message' && event.data.source.kind === 'user').at(-1)
  const lastSpoken = events.filter(event => event.type === 'assistant/message' && event.seq > (lastHuman?.seq ?? -1)).at(-1)
  const nameOf = (id: string): string => state.members.find(member => memberId(events, member) === id)?.name ?? id
  const since = lastHuman?.seq ?? -1
  const batch = (state.deliveries ?? []).filter(row => row.replyTo === recipientId && row.dispatchSeq > since)
  const running = (state.executions ?? []).filter(row => row.state === 'running')
  const notes = batch.flatMap((row) => {
    const event = events.find(entry => entry.seq === row.dispatchSeq)
    return event?.type === 'room/dispatch' && event.data.note !== undefined ? [event.data.note] : []
  })
  return {
    userRequest: lastHuman?.type === 'user/message'
      ? lastHuman.data.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n').slice(0, 2000) : '',
    coordinatorNotes: [...new Set(notes)],
    userWaitingSeconds: Math.max(0, Math.round((now - (lastSpoken?.time ?? lastHuman?.time ?? now)) / 1000)),
    progress: {
      done: batch.filter(row => !['queued', 'running'].includes(row.status)).length,
      total: batch.length,
      running: batch.filter(row => row.status === 'queued' || row.status === 'running').map((row) => {
        const execution = running.find(entry => entry.id === row.id)
        return { member: nameOf(row.memberId), task: row.text.slice(0, 200), seconds: execution === undefined ? 0 : Math.round((now - execution.startedAt) / 1000) }
      }),
    },
    arrived: arrived.map(report => ({ ...report, text: report.text.slice(0, 1500) })),
  }
}

/**
 * Decide whether to hand a report over now.
 * @param ctx - host context (probes `typesafe`).
 * @param input - what the rules and the model read.
 * @returns the verdict with its reason.
 */
export async function judgeReport(ctx: Context, input: {
  readonly timing: 'judge' | 'each'
  readonly outcome: string
  readonly outstanding: number
  /** The "hand it over now" probability at or above which the report is delivered (default 0.5). */
  readonly threshold?: number
  readonly state: () => unknown
}): Promise<GateVerdict> {
  if (input.timing === 'each') return { hold: false, reason: 'setting' }
  if (input.outcome !== 'done') return { hold: false, reason: 'failure' }
  if (input.outstanding === 0) return { hold: false, reason: 'last' }
  if (!hasDecisionModel(ctx)) return { hold: false, reason: 'unavailable' }
  const asked = await askDecisionModel(ctx, DECISION_SCENARIOS['report-timing'].question, input.state())
  if (!asked.ok || typeof asked.answer !== 'number') {
    return { hold: false, reason: 'unavailable', ...asked.call === undefined ? {} : { call: asked.call } }
  }
  return { hold: asked.answer < (input.threshold ?? 0.5), reason: 'model', probability: asked.answer, call: asked.call }
}

/** One open task offered to the attribution question. */
export interface OpenTaskSummary {
  readonly number: number
  readonly title: string
  readonly running: readonly string[]
}

/**
 * Suggest which open task a new human message continues, or `new`. Only
 * asked while some task is still open; the coordinator sees the suggestion
 * and can override it when it dispatches (`task`).
 * @param ctx - host context (probes `typesafe`).
 * @param message - the new human message text.
 * @param open - the open tasks.
 * @returns the suggested task number (or `new`) with its probability and the call, or `new` by the `unavailable` rule.
 */
export async function suggestTask(ctx: Context, message: string, open: readonly OpenTaskSummary[]): Promise<{
  readonly task: number | 'new'
  /** The rule that decided (`unavailable` after a failed or missing model); absent = the model decided. */
  readonly rule?: string
  readonly probability?: number
  readonly call?: RoomDecisionCall
}> {
  if (!hasDecisionModel(ctx)) return { task: 'new', rule: 'unavailable' }
  const scenario = DECISION_SCENARIOS['task-filing'].question
  const criteria: Record<string, string> = Object.fromEntries(open.map(job => [String(job.number),
    `Continues task ${job.number}: "${job.title.slice(0, 200)}"${job.running.length === 0 ? '' : ` (still running: ${job.running.join(', ')})`}`]))
  criteria['new'] = 'Starts a new, unrelated task'
  const asked = await askDecisionModel(ctx, { ...scenario, criteria }, {
    message: message.slice(0, 2000),
    openTasks: open.map(job => ({ number: job.number, title: job.title.slice(0, 200), running: job.running })),
  })
  if (!asked.ok || typeof asked.answer !== 'string') return { task: 'new', rule: 'unavailable', ...asked.call === undefined ? {} : { call: asked.call } }
  const probability = asked.probabilities?.[asked.answer] ?? 0
  return { task: asked.answer === 'new' ? 'new' : Number(asked.answer), probability, call: asked.call }
}
