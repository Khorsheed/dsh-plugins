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
 * report over now. Otherwise the decision model (the optional `typesafe`
 * service, probed — room never depends on it) answers one yes/no question
 * from what the recipient said it waits for, how long the human has been
 * waiting, and the progress of everything still out.
 * @module @khorsheed/dsh-room/report-gate
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { memberId, replay } from './journal.ts'
import type { RoomDelivery, RoomMember } from './types.ts'

/** How long held reports wait before the recipient is woken anyway. */
export const REPORT_HOLD_MS = 3 * 60_000

/** Above this "hand it over now" probability, the report is delivered. */
const DELIVER_THRESHOLD = 0.5

/** The bounded decision-model call. */
const JUDGE_TIMEOUT_MS = 8000

/** The slice of the typesafe service the gate calls (duck-typed probe). */
interface DecisionService {
  judge(input: { state: unknown; questions: readonly { id: string; type: 'noul'; instructions: string }[] }, options?: { timeoutMs?: number; fresh?: boolean }): Promise<
    { ok: true; judgement: { decisions: readonly { id: string; answer: string | number | boolean }[] } } | { ok: false; reason: string }
  >
}

/** The gate's verdict. */
export interface GateVerdict {
  readonly hold: boolean
  readonly reason: string
  readonly probability?: number
}

/** One arrived report, as the gate sees it. */
export interface ArrivedReport {
  readonly from: string
  readonly outcome: string
  readonly text: string
}

const QUESTION = {
  id: 'deliver_now',
  type: 'noul' as const,
  instructions:
    'A coordinating agent delegated work to other agents and their results arrive one by one. The human can already '
    + 'read every result in the room. Should the results that have arrived be handed to the coordinator now? Answer '
    + 'yes when they let it move the work forward (start the next step, answer the human, react to a problem) or when '
    + 'the human has been waiting long enough that an update helps. Answer no when the coordinator said it is waiting '
    + 'for the remaining results and those are still running normally.',
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
  readonly state: () => unknown
}): Promise<GateVerdict> {
  if (input.timing === 'each') return { hold: false, reason: 'setting' }
  if (input.outcome !== 'done') return { hold: false, reason: 'failure' }
  if (input.outstanding === 0) return { hold: false, reason: 'last' }
  const service = (ctx.get as (name: string) => unknown)('typesafe') as Partial<DecisionService> | undefined
  if (typeof service?.judge !== 'function') return { hold: false, reason: 'unavailable' }
  try {
    const result = await service.judge({ state: input.state(), questions: [QUESTION] }, { timeoutMs: JUDGE_TIMEOUT_MS, fresh: true })
    if (!result.ok) return { hold: false, reason: 'unavailable' }
    const answer = result.judgement.decisions.find(decision => decision.id === QUESTION.id)?.answer
    if (typeof answer !== 'number') return { hold: false, reason: 'unavailable' }
    return { hold: answer < DELIVER_THRESHOLD, reason: 'model', probability: answer }
  } catch {
    return { hold: false, reason: 'unavailable' }
  }
}
