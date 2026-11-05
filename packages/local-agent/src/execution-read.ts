/**
 * The read side of the execution records (batch 5 S6, "usage in one
 * place"): every execution of a member, read back from the member's own log.
 *
 * Nothing here is written anywhere. A call's usage lives only on its
 * `assistant/message.usage`, the CLI's self-reported round total only on the
 * execution's end record (`providerReportedUsage`), a compaction's facts only
 * on `local-agent/compaction`. A reader (room's timeline, a stats page) asks
 * for the reading and shows it; it never stores a copy.
 *
 * The range of an execution is explicit, never inferred from time: its turns
 * are the end record's `turns` (or, while it is open, the `turn/start`s after
 * its start record up to the next execution record), and its compaction facts
 * are the ones between its start record and its end record.
 * @module @khorsheed/dsh-local-agent/execution-read
 */
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {
  LocalAgentCompactionEvent,
  LocalAgentExecutionEndEvent,
  LocalAgentExecutionEvent,
  LocalAgentExecutionReading,
  LocalAgentExecutionStartEvent,
} from './types.ts'

const OPTIONAL_COUNTS = ['cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens'] as const

/**
 * Add one usage into a running sum. Each bucket is summed on its own; an
 * optional bucket appears in the sum once any addend carries it. The
 * provider-specific `totalTokens` is not summed (its meaning differs per CLI).
 * @param sum - the sum so far, or undefined.
 * @param usage - the usage to add.
 * @returns the new sum.
 */
export function addUsage(sum: TokenUsage | undefined, usage: TokenUsage): TokenUsage {
  const next: TokenUsage = {
    inputTokens: (sum?.inputTokens ?? 0) + finite(usage.inputTokens),
    outputTokens: (sum?.outputTokens ?? 0) + finite(usage.outputTokens),
  }
  for (const key of OPTIONAL_COUNTS) {
    if (sum?.[key] === undefined && usage[key] === undefined) continue
    next[key] = (sum?.[key] ?? 0) + finite(usage[key])
  }
  return next
}

function finite(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

function isUsage(value: unknown): value is TokenUsage {
  return typeof value === 'object' && value !== null
    && typeof (value as TokenUsage).inputTokens === 'number' && typeof (value as TokenUsage).outputTokens === 'number'
}

/**
 * Read every execution a member log records.
 * @param events - the member's session events, in seq order.
 * @returns the readings by execution id (only executions whose start record is in the log).
 */
export function executionReadingsOf(events: readonly SessionEvent[]): Map<string, LocalAgentExecutionReading> {
  // Pass 1: the records, the per-turn call usage, and the execution record positions.
  const starts: Array<{ index: number; start: LocalAgentExecutionStartEvent }> = []
  const ends = new Map<string, { index: number; end: LocalAgentExecutionEndEvent }>()
  const recordIndexes: number[] = []
  const perTurn = new Map<number, { usage: TokenUsage; calls: number }>()
  events.forEach((event, index) => {
    if (event.type === 'local-agent/execution') {
      const data = event.data as LocalAgentExecutionEvent
      recordIndexes.push(index)
      if (data.phase === 'start') starts.push({ index, start: data })
      else if (!ends.has(data.executionId)) ends.set(data.executionId, { index, end: data })
    } else if (event.type === 'assistant/message') {
      const data = event.data as { turn?: unknown; usage?: unknown }
      if (typeof data.turn !== 'number' || !isUsage(data.usage)) return
      const previous = perTurn.get(data.turn)
      perTurn.set(data.turn, { usage: addUsage(previous?.usage, data.usage), calls: (previous?.calls ?? 0) + 1 })
    }
  })
  const readings = new Map<string, LocalAgentExecutionReading>()
  for (const { index, start } of starts) {
    if (readings.has(start.executionId)) continue
    const ended = ends.get(start.executionId)
    // Open: the range runs to the next execution record (rounds of one
    // member are serialized, so the next record is the next execution's).
    const stop = ended?.index ?? recordIndexes.find(position => position > index) ?? events.length
    const turns = ended !== undefined
      ? [...ended.end.turns]
      : events.slice(index + 1, stop).flatMap(event => event.type === 'turn/start' && typeof (event.data as { turn?: unknown }).turn === 'number' ? [(event.data as { turn: number }).turn] : [])
    let callUsage: TokenUsage | undefined
    let calls = 0
    for (const turn of new Set(turns)) {
      const entry = perTurn.get(turn)
      if (entry === undefined) continue
      callUsage = addUsage(callUsage, entry.usage)
      calls += entry.calls
    }
    const compactions = events.slice(index + 1, stop)
      .flatMap(event => event.type === 'local-agent/compaction' ? [structuredClone(event.data as LocalAgentCompactionEvent)] : [])
    readings.set(start.executionId, {
      executionId: start.executionId,
      operation: start.operation,
      ...ended === undefined ? {} : { outcome: ended.end.outcome },
      turns,
      ...callUsage === undefined ? {} : { callUsage },
      calls,
      ...ended?.end.providerReportedUsage === undefined ? {} : { providerReportedUsage: structuredClone(ended.end.providerReportedUsage) },
      unrecorded: [...ended?.end.unrecorded ?? []],
      compactions,
    })
  }
  return readings
}
