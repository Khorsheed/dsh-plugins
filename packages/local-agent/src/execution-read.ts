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
  LocalAgentExecutionSubagentReading,
  LocalAgentTaskRef,
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
      ...ended?.end.taskResults === undefined || ended.end.taskResults.length === 0 ? {} : { taskResults: structuredClone(ended.end.taskResults) },
    })
  }
  return readings
}

/**
 * The member execution a mirrored tool call ran in: the `assistant/message`
 * whose content holds the `tool-call` block `callId` → its turn → the prompt
 * execution whose turns hold that turn. Every link is a recorded fact; any
 * missing link answers undefined (never the nearest execution by time).
 * @param events - the member's session events, in seq order.
 * @param callId - the tool call id (the CLI's own, as the mirror wrote it).
 * @param readings - the log's readings, when the caller already has them.
 * @returns the execution id, or undefined.
 */
export function executionOfToolCall(
  events: readonly SessionEvent[],
  callId: string,
  readings: ReadonlyMap<string, LocalAgentExecutionReading> = executionReadingsOf(events),
): string | undefined {
  let turn: number | undefined
  for (const event of events) {
    if (event.type !== 'assistant/message') continue
    const data = event.data as { turn?: unknown; message?: { content?: unknown } }
    const content = data.message?.content
    if (typeof data.turn !== 'number' || !Array.isArray(content)) continue
    if (content.some(block => typeof block === 'object' && block !== null
      && (block as { type?: unknown }).type === 'tool-call' && (block as { id?: unknown }).id === callId)) {
      turn = data.turn
      break
    }
  }
  if (turn === undefined) return undefined
  let found: string | undefined
  for (const reading of readings.values()) {
    if (reading.operation === 'prompt' && reading.turns.includes(turn)) found = reading.executionId
  }
  return found
}

/**
 * The task an execution's start record names, copied verbatim (a self-opened
 * round inherits the task of the execution that started its background work).
 * @param events - the member's session events.
 * @param executionId - the execution.
 * @returns the task, or undefined when the start names none or is absent.
 */
export function executionTaskOf(events: readonly SessionEvent[], executionId: string): LocalAgentTaskRef | undefined {
  for (const event of events) {
    if (event.type !== 'local-agent/execution') continue
    const data = event.data as LocalAgentExecutionEvent
    if (data.phase === 'start' && data.executionId === executionId) return data.task === undefined ? undefined : structuredClone(data.task)
  }
  return undefined
}

/**
 * The notification ids of the rounds a member's CLI opened itself that the
 * member's log holds as rounds of their own (member-self-started-rounds A③):
 * a `self` start record naming a `notificationId`, followed by a `turn/start`
 * before the next execution record. A start whose turn never opened (a crash
 * between the two) is not one — the transcript then keeps folding that round
 * into the next, as the child log does.
 * @param events - the member's session events, in seq order.
 * @returns the notification ids.
 */
export function ownSelfRounds(events: readonly SessionEvent[]): Set<string> {
  const own = new Set<string>()
  let pending: string | undefined
  for (const event of events) {
    if (event.type === 'local-agent/execution') {
      const data = event.data as LocalAgentExecutionEvent
      if (data.phase !== 'start') continue
      pending = data.cause?.kind === 'self' ? data.cause.notificationId : undefined
    } else if (event.type === 'turn/start' && pending !== undefined) {
      own.add(pending)
      pending = undefined
    }
  }
  return own
}

/**
 * The execution the member's CLI opened for one of its background tasks: the
 * last start record whose cause is `self` naming `taskId`.
 * @param events - the member's session events, in seq order.
 * @param taskId - the CLI's task id.
 * @returns the execution id, or undefined when none is recorded.
 */
export function selfExecutionOfTask(events: readonly SessionEvent[], taskId: string): string | undefined {
  let found: string | undefined
  for (const event of events) {
    if (event.type !== 'local-agent/execution') continue
    const data = event.data as LocalAgentExecutionEvent
    if (data.phase === 'start' && data.cause?.kind === 'self' && data.cause.taskId === taskId) found = data.executionId
  }
  return found
}

/**
 * The member CLI's subagent executions that ran for one member execution
 * (subagent design M0; wired into `readExecution` at M6): every grandchild
 * start record whose `cli-subagent` cause names `executionId`, read with
 * {@link executionReadingsOf} in its own log. `subagentUsage` sums their
 * per-call usage only — a subagent's CLI-reported total stays on its own
 * entry, never added in.
 * @param executionId - the member's execution.
 * @param grandchildren - each grandchild session's id and events.
 * @returns the subagent readings (empty when none ran) and their call sum.
 */
export function subagentReadingsFor(
  executionId: string,
  grandchildren: readonly { readonly sessionId: string; readonly events: readonly SessionEvent[] }[],
): { subagents: LocalAgentExecutionSubagentReading[]; subagentUsage?: TokenUsage } {
  const subagents: LocalAgentExecutionSubagentReading[] = []
  let subagentUsage: TokenUsage | undefined
  for (const { sessionId, events } of grandchildren) {
    const readings = executionReadingsOf(events)
    for (const event of events) {
      if (event.type !== 'local-agent/execution') continue
      const data = event.data as LocalAgentExecutionEvent
      if (data.phase !== 'start' || data.cause?.kind !== 'cli-subagent' || data.cause.executionId !== executionId) continue
      const reading = readings.get(data.executionId)
      if (reading === undefined || subagents.some(entry => entry.sessionId === sessionId && entry.executionId === data.executionId)) continue
      subagents.push({
        sessionId,
        executionId: data.executionId,
        ...data.cause.name === undefined ? {} : { name: data.cause.name },
        ...reading.callUsage === undefined ? {} : { callUsage: reading.callUsage },
        calls: reading.calls,
        ...reading.providerReportedUsage === undefined ? {} : { providerReportedUsage: reading.providerReportedUsage },
      })
      if (reading.callUsage !== undefined) subagentUsage = addUsage(subagentUsage, reading.callUsage)
    }
  }
  return { subagents, ...subagentUsage === undefined ? {} : { subagentUsage } }
}
