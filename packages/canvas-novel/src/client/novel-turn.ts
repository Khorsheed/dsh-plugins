/**
 * The chapter plans and outline proposals a Turn registered, published
 * against that Turn so their cards render in the Turn tail, beneath the
 * closing prose.
 *
 * Why the tail as well as the tool row: a finished Turn folds its tool calls
 * into one collapsed 「已调用工具」 group, so the plan card on the
 * `novel_write` row is hidden exactly when the reply says 「点一下确认计划」
 * (2026-10-09). The datasets package's review card (T96) and the host's own
 * turn-level artifacts take the same route: a Conversation Definition folds
 * the settled results into Turn data, and an entry in ui-chat's
 * `conversation.chat.turnTail` list reads it. The tool row keeps its card as
 * the record of the call, and still opens the sidebar when it watched the call
 * land.
 *
 * Read from the persisted results, so a session replayed later shows the same
 * cards, with their live state (等你确认 / 已确认) read afresh. A chapter
 * registered twice in one Turn shows once, as its latest answer.
 *
 * Types are structural: `@deepseek-ai/dsh-client-ui-conversation` and
 * `-ui-chat` are optional peers this package does not import at runtime.
 * @module @khorsheed/dsh-canvas-novel/client
 */
import { writeRowModel, type NovelToolBlock, type WriteRowModel } from './write-row.ts'

/** The tool whose settled results the tail shows. */
export const WRITE_TOOL = 'novel_write'

/** The Turn-data key this package publishes. */
export const NOVEL_TURN_KEY = 'canvas-novel-asks'

/** One thing a Turn asked the person to decide: a chapter plan or an outline proposal. */
export interface NovelTurnAsk {
  /** Dedup key: `chapter:<canvas>:<n>` or `outline:<canvas>`. */
  readonly key: string
  readonly seq?: number
  readonly row: WriteRowModel
}

/** The asks one Turn registered, in first-seen order. */
export interface NovelTurnData {
  readonly asks: readonly NovelTurnAsk[]
}

interface EventLike {
  readonly type: string
  readonly seq?: number
  readonly surfaceOp?: unknown
  readonly data?: unknown
}

interface MatchLike {
  readonly event: EventLike
}

interface TurnState {
  readonly turn: number
  readonly calls: ReadonlySet<string>
  readonly asks: readonly NovelTurnAsk[]
}

interface LocationData {
  readonly kind: 'turn'
  readonly turn: number
  readonly key: string
  readonly value: NovelTurnData
}

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' ? value as Record<string, unknown> : null

function turnOf(event: EventLike): number | null {
  const turn = record(event.data)?.['turn']
  return typeof turn === 'number' ? turn : null
}

/** The ask one settled `novel_write` result names, or undefined (a review, a failure). */
export function askOf(block: NovelToolBlock, seq?: number): NovelTurnAsk | undefined {
  const row = writeRowModel(block)
  if (row.state === 'chapter' && row.chapter !== null) {
    return { key: `chapter:${row.chapter.canvasId}:${row.chapter.n}`, ...(seq === undefined ? {} : { seq }), row }
  }
  if (row.state === 'outline' && row.canvasId !== undefined) {
    return { key: `outline:${row.canvasId}`, ...(seq === undefined ? {} : { seq }), row }
  }
  return undefined
}

/**
 * The structural Conversation Definition (`ConversationNodeDefinition` of
 * ui-conversation): Turn-local, publishes no view Node, only Turn data.
 */
export const novelTurnDefinition = {
  kind: NOVEL_TURN_KEY,
  match(event: EventLike): { id: string; role: 'start' | 'update' } | null {
    const turn = turnOf(event)
    if (turn === null) return null
    if (event.type === 'turn/start') return { id: String(turn), role: 'start' }
    if (event.type === 'tool/call') return { id: String(turn), role: 'update' }
    if (event.type === 'tool/result' && event.surfaceOp === 'append') return { id: String(turn), role: 'update' }
    return null
  },
  start(_context: unknown, match: MatchLike): TurnState {
    return { turn: turnOf(match.event) ?? -1, calls: new Set(), asks: [] }
  },
  update(context: { readonly state: TurnState }, match: MatchLike): TurnState {
    const { event } = match
    const data = record(event.data)
    if (data === null) return context.state
    if (event.type === 'tool/call') {
      if (data['name'] !== WRITE_TOOL) return context.state
      return { ...context.state, calls: new Set([...context.state.calls, String(data['callId'])]) }
    }
    if (event.type !== 'tool/result') return context.state
    const message = record(data['message'])
    const callId = record(message?.['source'])?.['callId']
    if (message === null || !context.state.calls.has(String(callId))) return context.state
    const ask = askOf({
      kind: 'tool-result',
      content: Array.isArray(message['content']) ? message['content'] as Array<{ type: string; text?: string }> : [],
      isError: message['isError'] === true,
    }, typeof event.seq === 'number' ? event.seq : undefined)
    if (ask === undefined) return context.state
    const kept = context.state.asks.filter(row => row.key !== ask.key)
    const at = context.state.asks.findIndex(row => row.key === ask.key)
    const asks = at === -1 ? [...kept, ask] : [...kept.slice(0, at), ask, ...kept.slice(at)]
    return { ...context.state, asks }
  },
  buildLocationData(
    context: { readonly state: TurnState | undefined },
    scope: string,
    previous: LocationData | null | undefined,
  ): LocationData | null {
    if (scope !== 'turn' || context.state === undefined) return null
    if (previous?.kind === 'turn' && previous.turn === context.state.turn && previous.key === NOVEL_TURN_KEY
      && previous.value.asks === context.state.asks) return previous
    return { kind: 'turn', turn: context.state.turn, key: NOVEL_TURN_KEY, value: { asks: context.state.asks } }
  },
}

/** The Turn-tail owner props this entry reads (ui-chat's `TurnTailOwnerProps`, structurally). */
export interface NovelTurnOwner {
  readonly turn: { readonly data: { get: (key: string) => unknown }; readonly end?: { readonly seq: number } | null }
  readonly seq?: number
}

/**
 * The asks one Turn registered, for the Turn-tail entry, bounded by the Turn's
 * own end (falling back to the owner's sequence).
 * @param owner - the Turn-tail owner props.
 * @returns the asks, empty when the Turn made none or the data is unreadable.
 */
export function asksInTurn(owner: NovelTurnOwner | null | undefined): readonly NovelTurnAsk[] {
  try {
    if (owner === null || owner === undefined) return []
    const asks = record(owner.turn.data.get(NOVEL_TURN_KEY))?.['asks']
    if (!Array.isArray(asks)) return []
    const bound = owner.turn.end?.seq ?? owner.seq ?? Number.POSITIVE_INFINITY
    return (asks as NovelTurnAsk[]).filter(ask => (ask.seq ?? 0) <= bound)
  } catch {
    return []
  }
}
