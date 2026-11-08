/**
 * The read side of a member CLI's own subagents (member-cli-subagents M5):
 * the member's catalog rows name its grandchild sessions, and each
 * grandchild execution whose `cli-subagent` cause names a member call is
 * that call's subagent — the card the member session draws at the call.
 *
 * Nothing is stored for the card: its state is the grandchild's execution
 * records, its usage the sum of the grandchild's per-request usage in the
 * execution's turns, its steps the grandchild's own mirrored steps. The
 * writer is `cli-subagent.ts`; this module only folds what it wrote.
 * @module @khorsheed/dsh-local-agent/subagent-calls
 */
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { CLI_SUBAGENT_SESSION_SEPARATOR } from './cli-subagent.ts'
import { addUsage } from './execution-read.ts'
import type {
  LocalAgentExecutionEndEvent,
  LocalAgentExecutionEvent,
  LocalAgentExecutionOutcome,
  LocalAgentExecutionStartEvent,
  LocalAgentSubagentCall,
  LocalAgentSubagentStep,
} from './types.ts'

/** The most steps one call carries in a read (the latest ones). */
export const SUBAGENT_STEP_LIMIT = 40

const STATE: Readonly<Record<LocalAgentExecutionOutcome, LocalAgentSubagentCall['state']>> = {
  done: 'done',
  failed: 'failed',
  cancelled: 'cancelled',
  uncertain: 'lost',
}

/** Argument keys a reader recognizes, in the order a summary prefers them. */
const SUMMARY_KEYS = ['file_path', 'path', 'pattern', 'command', 'query', 'url', 'description', 'prompt'] as const

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined

const turnOf = (event: SessionEvent): number | undefined => {
  const turn = (event.data as { turn?: unknown }).turn
  return typeof turn === 'number' && Number.isFinite(turn) ? turn : undefined
}

function firstLine(text: string, max: number): string | undefined {
  const line = text.split('\n').map(part => part.trim()).find(part => part !== '')
  if (line === undefined) return undefined
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

/**
 * A tool call's one-line summary: the first argument a reader recognizes
 * (path, pattern, command, …), else the raw text's first line.
 * @param args - the call's argument text (JSON, usually).
 */
export function toolArgumentSummary(args: string): string | undefined {
  let parsed: Record<string, unknown> | undefined
  try { parsed = record(JSON.parse(args)) } catch { parsed = undefined }
  if (parsed === undefined) return firstLine(args, 80)
  for (const key of SUMMARY_KEYS) {
    const value = parsed[key]
    if (typeof value === 'string' && value.trim() !== '') return firstLine(value, 80)
  }
  return undefined
}

/**
 * The member's grandchild sessions: its catalog rows whose child id is one
 * the CLI-subagent writer derives (`<member>.sub.<key>`), in catalog order.
 * @param memberSessionId - the member's child session.
 * @param events - the member's session events.
 */
export function grandchildIdsOf(memberSessionId: string, events: readonly SessionEvent[]): string[] {
  const prefix = `${memberSessionId}${CLI_SUBAGENT_SESSION_SEPARATOR}`
  const ids: string[] = []
  for (const event of events) {
    if (event.type !== 'subagent/catalog') continue
    const childId = (event.data as { childId?: unknown }).childId
    if (typeof childId === 'string' && childId.startsWith(prefix) && !ids.includes(childId)) ids.push(childId)
  }
  return ids
}

/** How long a model request generated: its stream's first to last record. */
function streamSpan(stream: unknown): number | undefined {
  if (!Array.isArray(stream)) return undefined
  const times = stream.flatMap(entry => typeof record(entry)?.['time'] === 'number' ? [record(entry)!['time'] as number] : [])
  if (times.length < 2) return undefined
  return Math.max(0, Math.max(...times) - Math.min(...times))
}

/** How long a tool ran: the result's recorded execution interval. */
function toolSpan(meta: unknown): number | undefined {
  const timing = record(record(meta)?.['localAgentTiming'])
  const startedAt = timing?.['startedAt']
  const endedAt = timing?.['endedAt']
  return typeof startedAt === 'number' && typeof endedAt === 'number' && endedAt >= startedAt ? endedAt - startedAt : undefined
}

interface Block { readonly type?: unknown; readonly text?: unknown; readonly id?: unknown; readonly name?: unknown; readonly arguments?: unknown }

/** The steps and usage of one execution's turns, in log order. */
function stepsOf(events: readonly SessionEvent[], turns: ReadonlySet<number>, ended: boolean): { steps: LocalAgentSubagentStep[]; usage?: TokenUsage } {
  const results = new Map<string, { failed: boolean; durationMs?: number }>()
  for (const event of events) {
    if (event.type !== 'tool/result' || !turns.has(turnOf(event) ?? Number.NaN)) continue
    const data = event.data as { message?: { callId?: unknown; source?: { callId?: unknown }; isError?: unknown }; meta?: unknown }
    const callId = data.message?.callId ?? data.message?.source?.callId
    if (typeof callId !== 'string') continue
    const durationMs = toolSpan(data.meta)
    results.set(callId, { failed: data.message?.isError === true, ...durationMs === undefined ? {} : { durationMs } })
  }
  const steps: LocalAgentSubagentStep[] = []
  let usage: TokenUsage | undefined
  let requests = 0
  const messages = events.filter(event => event.type === 'assistant/message' && turns.has(turnOf(event) ?? Number.NaN))
  messages.forEach((event, position) => {
    const data = event.data as { message?: { content?: unknown }; stream?: unknown; usage?: TokenUsage }
    if (data.usage !== undefined && typeof data.usage.inputTokens === 'number') usage = addUsage(usage, data.usage)
    const blocks = (Array.isArray(data.message?.content) ? data.message.content : []) as Block[]
    const text = blocks.filter(block => block.type === 'text' && typeof block.text === 'string').map(block => block.text as string).join('\n')
    const thought = blocks.filter(block => block.type === 'reasoning' && typeof block.text === 'string').map(block => block.text as string).join('\n')
    const tools = blocks.filter(block => block.type === 'tool-call' && typeof block.name === 'string')
    // The execution's last message, text only, once it ended: the answer handed back.
    const reply = ended && position === messages.length - 1 && tools.length === 0 ? firstLine(text, 240) : undefined
    requests += 1
    const label = reply !== undefined ? firstLine(thought, 120) : firstLine(thought, 120) ?? firstLine(text, 120)
    const durationMs = streamSpan(data.stream)
    steps.push({ kind: 'request', index: requests, ...label === undefined ? {} : { text: label }, ...durationMs === undefined ? {} : { durationMs } })
    for (const tool of tools) {
      const summary = typeof tool.arguments === 'string' ? toolArgumentSummary(tool.arguments) : undefined
      const result = typeof tool.id === 'string' ? results.get(tool.id) : undefined
      steps.push({
        kind: 'tool',
        name: tool.name as string,
        ...summary === undefined ? {} : { summary },
        ...result?.durationMs === undefined ? {} : { durationMs: result.durationMs },
        ...result?.failed === true ? { failed: true as const } : {},
      })
    }
    if (reply !== undefined) steps.push({ kind: 'reply', text: reply })
  })
  return { steps, ...usage === undefined ? {} : { usage } }
}

/**
 * Every member call's subagent the grandchildren record: one entry per
 * grandchild execution with a `cli-subagent` cause, in grandchild order then
 * log order.
 * @param grandchildren - each grandchild session's id and events.
 * @returns the calls (a call id appears once per subagent it ran).
 */
export function subagentCallsOf(grandchildren: readonly { readonly sessionId: string; readonly events: readonly SessionEvent[] }[]): LocalAgentSubagentCall[] {
  const calls: LocalAgentSubagentCall[] = []
  for (const { sessionId, events } of grandchildren) {
    const descriptor = events.find(event => event.type === 'subagent/descriptor')?.data as { label?: unknown } | undefined
    const label = typeof descriptor?.label === 'string' ? descriptor.label : undefined
    const positions: Array<{ index: number; data: LocalAgentExecutionEvent }> = []
    events.forEach((event, index) => {
      if (event.type === 'local-agent/execution') positions.push({ index, data: event.data as LocalAgentExecutionEvent })
    })
    const ends = new Map<string, LocalAgentExecutionEndEvent>()
    for (const { data } of positions) if (data.phase === 'end' && !ends.has(data.executionId)) ends.set(data.executionId, data)
    let ordinal = 0
    for (const { index, data } of positions) {
      if (data.phase !== 'start') continue
      const start = data as LocalAgentExecutionStartEvent
      const cause = start.cause
      if (cause?.kind !== 'cli-subagent') continue
      ordinal += 1
      const end = ends.get(start.executionId)
      const next = positions.find(entry => entry.index > index && entry.data.phase === 'start')?.index ?? events.length
      const turns = end !== undefined
        ? [...end.turns]
        : events.slice(index + 1, next).flatMap(event => event.type === 'turn/start' && turnOf(event) !== undefined ? [turnOf(event)!] : [])
      const { steps, usage } = stepsOf(events, new Set(turns), end !== undefined && end.outcome === 'done')
      const name = cause.name
      const description = label === undefined ? undefined
        : name !== undefined && label.startsWith(`${name}: `) ? label.slice(name.length + 2)
          : name !== undefined && label === name ? undefined : label
      const omitted = Math.max(0, steps.length - SUBAGENT_STEP_LIMIT)
      calls.push({
        callId: cause.callId,
        sessionId,
        executionId: start.executionId,
        ...name === undefined ? {} : { name },
        ...description === undefined ? {} : { description },
        ...cause.group === undefined ? {} : { group: { index: cause.group.index, size: cause.group.size } },
        ...cause.background === true ? { background: true as const } : {},
        ordinal,
        ...turns[0] === undefined ? {} : { turn: turns[0] },
        state: end === undefined ? 'running' : STATE[end.outcome],
        startedAt: start.admittedAt,
        ...end === undefined ? {} : { endedAt: end.endedAt },
        ...usage === undefined ? {} : { usage },
        steps: omitted === 0 ? steps : steps.slice(omitted),
        ...omitted === 0 ? {} : { stepsOmitted: omitted },
      })
    }
  }
  return calls
}
