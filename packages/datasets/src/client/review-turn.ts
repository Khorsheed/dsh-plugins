/**
 * T96 · the proposals a Turn filed, published against that Turn so the
 * 「核对并登记」 entry renders in the Turn tail, beneath the closing prose.
 *
 * Why the tail and not the tool row: a finished Turn folds its tool calls into
 * one collapsed 「已完成」 group, so a card on the `datasets_propose_registration`
 * row is hidden exactly when the person reads the summary that points at it
 * (measured on 0.2.0-rc.2). The host's own turn-level artifacts (ui-schedule's
 * created-task card, ui-deliverables' changed files) solve the same problem
 * this way: a Conversation Definition folds the settled results into Turn
 * data, and an entry in ui-chat's `conversation.chat.turnTail` list reads it.
 * The call's own row stays with ui-tool's generic tool view.
 *
 * The result is narrowed from the call's persisted arguments and result JSON,
 * so a session replayed days later still shows the entry for the proposal it
 * filed. Only `filed` results are kept: a dry run or a failure filed nothing,
 * and its tool row already says so.
 *
 * Types are structural: `@deepseek-ai/dsh-client-ui-conversation` and
 * `-ui-chat` are optional peers this package does not import at runtime.
 * @module @khorsheed/dsh-datasets/client
 */
import { proposeCardOf, type ProposeToolBlock } from './review-card.ts'

/** The wire name of the tool whose filed results the tail shows. */
export const PROPOSE_TOOL = 'datasets_propose_registration'

/** The Turn-data key this package publishes. */
export const PROPOSED_KEY = 'datasets-proposed'

/** The session events this Definition reads, structurally. */
interface EventLike {
  readonly type: string
  readonly seq?: number
  readonly surfaceOp?: unknown
  readonly data?: unknown
}

interface MatchLike {
  readonly event: EventLike
}

/** Proposals filed in one Turn, in settlement order. */
export interface ProposedTurnData {
  readonly filed: readonly ProposeToolBlock[]
}

interface ProposedState {
  readonly turn: number
  readonly calls: ReadonlyMap<string, string>
  readonly filed: readonly ProposeToolBlock[]
}

interface LocationData {
  readonly kind: 'turn'
  readonly turn: number
  readonly key: string
  readonly value: ProposedTurnData
}

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' ? value as Record<string, unknown> : null

function turnOf(event: EventLike): number | null {
  const turn = record(event.data)?.['turn']
  return typeof turn === 'number' ? turn : null
}

/** An append-origin surface event (the host's `isAppendSurfaceEvent`, structurally). */
const appended = (event: EventLike): boolean => event.surfaceOp === 'append'

/**
 * The structural Conversation Definition (`ConversationNodeDefinition` of
 * ui-conversation): Turn-local, publishes no view Node, only Turn data.
 */
export const proposedTurnDefinition = {
  kind: PROPOSED_KEY,
  match(event: EventLike): { id: string; role: 'start' | 'update' } | null {
    const turn = turnOf(event)
    if (turn === null) return null
    if (event.type === 'turn/start') return { id: String(turn), role: 'start' }
    if (event.type === 'tool/call') return { id: String(turn), role: 'update' }
    if (event.type === 'tool/result' && appended(event)) return { id: String(turn), role: 'update' }
    return null
  },
  start(_context: unknown, match: MatchLike): ProposedState {
    return { turn: turnOf(match.event) ?? -1, calls: new Map(), filed: [] }
  },
  update(context: { readonly state: ProposedState }, match: MatchLike): ProposedState {
    const { event } = match
    const data = record(event.data)
    if (data === null) return context.state
    if (event.type === 'tool/call') {
      if (data['name'] !== PROPOSE_TOOL) return context.state
      const calls = new Map(context.state.calls)
      calls.set(String(data['callId']), typeof data['arguments'] === 'string' ? data['arguments'] : '')
      return { ...context.state, calls }
    }
    if (event.type !== 'tool/result') return context.state
    const message = record(data['message'])
    const callId = record(message?.['source'])?.['callId']
    const argsRaw = context.state.calls.get(String(callId))
    if (message === null || argsRaw === undefined) return context.state
    const block: ProposeToolBlock = {
      kind: 'tool-result',
      ...(typeof event.seq === 'number' ? { seq: event.seq } : {}),
      call: { name: PROPOSE_TOOL, argsRaw },
      content: Array.isArray(message['content']) ? message['content'] as Array<{ type: string; text?: string }> : [],
      isError: message['isError'] === true,
    }
    if (proposeCardOf(block).state !== 'filed') return context.state
    return { ...context.state, filed: [...context.state.filed, block] }
  },
  buildLocationData(
    context: { readonly state: ProposedState | undefined },
    scope: string,
    previous: LocationData | null | undefined,
  ): LocationData | null {
    if (scope !== 'turn' || context.state === undefined) return null
    if (previous?.kind === 'turn' && previous.turn === context.state.turn && previous.key === PROPOSED_KEY
      && previous.value.filed === context.state.filed) return previous
    return { kind: 'turn', turn: context.state.turn, key: PROPOSED_KEY, value: { filed: context.state.filed } }
  },
}

/** The Turn-tail owner props this entry reads (ui-chat's `TurnTailOwnerProps`, structurally). */
export interface ProposedTurnOwner {
  readonly turn: { readonly data: { get: (key: string) => unknown }; readonly end?: { readonly seq: number } | null }
  readonly seq?: number
}

/**
 * The proposals one Turn filed, for the Turn-tail entry. Bounded by the Turn's
 * own end (falling back to the owner's sequence), as ui-schedule's tail does.
 * @param owner - the Turn-tail owner props.
 * @returns the filed results, empty when the Turn filed none or the data is unreadable.
 */
export function proposedInTurn(owner: ProposedTurnOwner | null | undefined): readonly ProposeToolBlock[] {
  try {
    if (owner === null || owner === undefined) return []
    const filed = record(owner.turn.data.get(PROPOSED_KEY))?.['filed']
    if (!Array.isArray(filed)) return []
    const bound = owner.turn.end?.seq ?? owner.seq ?? Number.POSITIVE_INFINITY
    return (filed as ProposeToolBlock[]).filter(block => (block.seq ?? 0) <= bound)
  } catch {
    return []
  }
}
