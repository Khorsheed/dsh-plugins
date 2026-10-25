/**
 * The room's own decisions — one table entry per scenario. A scenario checks
 * its rules in order (the first that applies decides) and only then asks the
 * decision model (the optional `typesafe` service, probed — room never
 * depends on it) one fixed question about a state the room assembles from
 * its log. Every decision becomes a `room/decision` record: the rule that
 * decided, or the model call as it went out and came back (state, question,
 * answer, model, tokens, latency, cache, failure). Settings, the timeline row
 * and Context Lens all read the same scenario ids.
 *
 * Today's scenarios:
 * - `task-filing`: does an untagged human message continue an open task, or
 *   start a new one?
 * - `report-timing`: is an arrived member result handed to the member waiting
 *   on it now, or held to be handed over together later?
 * @module @khorsheed/dsh-room/decisions
 */
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { RoomDecisionCall, RoomDecisionEvent, RoomDecisionScenario, RoomJsonValue } from './types.ts'

/** The bounded decision-model call. */
export const DECISION_TIMEOUT_MS = 8000

/** One fixed question of a scenario (the typesafe wire shape). */
export interface DecisionQuestion {
  readonly id: string
  readonly type: 'noul' | 'choice'
  readonly instructions: string
  readonly criteria?: Record<string, string>
}

/** The scenario table: each scenario's fixed question (its criteria, when they depend on the room, are filled per call). */
export const DECISION_SCENARIOS: Record<RoomDecisionScenario, { readonly question: DecisionQuestion }> = {
  'task-filing': {
    question: {
      id: 'task',
      type: 'choice',
      instructions: 'A human sent this message to a team of agents that is still working on the open tasks listed. Does the message add to, correct or ask about one of those tasks, or does it start a new one?',
    },
  },
  'report-timing': {
    question: {
      id: 'deliver_now',
      type: 'noul',
      instructions:
        'A coordinating agent delegated work to other agents and their results arrive one by one. The human can already '
        + 'read every result in the room. Should the results that have arrived be handed to the coordinator now? Answer '
        + 'yes when they let it move the work forward (start the next step, answer the human, react to a problem) or when '
        + 'the human has been waiting long enough that an update helps. Answer no when the coordinator said it is waiting '
        + 'for the remaining results and those are still running normally.',
    },
  },
}

/** The slice of the typesafe service the room calls (duck-typed probe). */
interface DecisionService {
  judge(input: { state: unknown; questions: readonly DecisionQuestion[] }, options?: { timeoutMs?: number; fresh?: boolean }): Promise<
    | { ok: true; judgement: { model: string; decisions: readonly { id: string; answer: unknown; probabilities?: Record<string, number> }[]; usage?: { inputTokens: number; outputTokens: number }; latencyMs: number; cached: boolean } }
    | { ok: false; reason: string; detail?: string }
  >
  readonly config?: { readonly defaultModel?: string }
}

/** A model answer to one question, with the call that produced it. */
export type DecisionAnswer =
  | { readonly ok: true; readonly answer: unknown; readonly probabilities?: Record<string, number>; readonly call: RoomDecisionCall }
  | { readonly ok: false; readonly call?: RoomDecisionCall }

/** A JSON-safe copy (the record must survive the session log). */
function json(value: unknown): RoomJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as RoomJsonValue
}

/**
 * Whether the decision model is mounted.
 * @param ctx - host context.
 * @returns true when `typesafe.judge` can be called.
 */
export function hasDecisionModel(ctx: Context): boolean {
  return typeof ((ctx.get as (name: string) => unknown)('typesafe') as Partial<DecisionService> | undefined)?.judge === 'function'
}

/**
 * Ask the decision model one scenario question about a state, recording the
 * call whatever happens. Never throws: no service, a refusal, a timeout or a
 * malformed answer all come back as `ok: false` (with the call when one went out).
 * @param ctx - host context (probes `typesafe`).
 * @param question - the scenario's question, criteria filled.
 * @param state - the JSON-safe state the model judges.
 * @returns the answer and the recorded call.
 */
export async function askDecisionModel(ctx: Context, question: DecisionQuestion, state: unknown): Promise<DecisionAnswer> {
  const service = (ctx.get as (name: string) => unknown)('typesafe') as Partial<DecisionService> | undefined
  if (typeof service?.judge !== 'function') return { ok: false }
  const request = { state: json(state), questions: json([question]) }
  const asked = service.config?.defaultModel ?? 'typesafe'
  const started = Date.now()
  try {
    const result = await service.judge({ state, questions: [question] }, { timeoutMs: DECISION_TIMEOUT_MS, fresh: true })
    if (!result.ok) {
      return { ok: false, call: { model: asked, latencyMs: Date.now() - started, request, failure: { reason: result.reason, ...result.detail === undefined ? {} : { detail: result.detail } } } }
    }
    const judgement = result.judgement
    // Only what the service reported: an absent field stays absent (the log takes JSON only).
    const call: RoomDecisionCall = {
      model: typeof judgement.model === 'string' && judgement.model !== '' ? judgement.model : asked,
      latencyMs: typeof judgement.latencyMs === 'number' ? judgement.latencyMs : Date.now() - started,
      ...typeof judgement.cached === 'boolean' ? { cached: judgement.cached } : {},
      request, response: json(judgement.decisions),
      ...judgement.usage === undefined ? {} : { inputTokens: judgement.usage.inputTokens, outputTokens: judgement.usage.outputTokens },
    }
    const decision = judgement.decisions.find(entry => entry.id === question.id)
    if (decision === undefined) return { ok: false, call: { ...call, failure: { reason: 'decode', detail: 'no answer to the question' } } }
    return { ok: true, answer: decision.answer, ...decision.probabilities === undefined ? {} : { probabilities: decision.probabilities }, call }
  } catch (error) {
    return { ok: false, call: { model: asked, latencyMs: Date.now() - started, request, failure: { reason: 'transport', detail: String(error) } } }
  }
}

/**
 * Build one decision record.
 * @param scenario - the scenario.
 * @param fields - outcome, rule or probability, the call, what it was about.
 * @returns the `room/decision` event data.
 */
export function decisionRecord(scenario: RoomDecisionScenario, fields: Omit<RoomDecisionEvent, 'id' | 'scenario'>): RoomDecisionEvent {
  return { id: randomUUID(), scenario, ...fields }
}
