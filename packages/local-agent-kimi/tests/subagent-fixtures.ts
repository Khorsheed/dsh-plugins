/**
 * Synthetic Kimi subagent wires for the member-cli-subagents M3 specs,
 * generated from builders here — never copied from a real Kimi home. The
 * field shapes follow kimi-code protocol 1.5 as the design records them
 * (member wire `subagent.spawned/started/completed`, `subagent.*` times in
 * seconds; each subagent's `agents/<id>/wire.jsonl` with one `turn.prompt`
 * of origin `system_trigger`/`subagent` per call, loop-event times in ms);
 * every text is a placeholder.
 */
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** The synthetic member session every fixture writes under. */
export const FIXTURE_SESSION = '0f1e2d3c-0000-4000-8000-00000000abcd'

/** The session directory of {@link FIXTURE_SESSION} under a scoped home. */
export function sessionDir(homeDir: string): string {
  return join(homeDir, 'sessions', 'wd_fixture_000', `session_${FIXTURE_SESSION}`)
}

type Line = Record<string, unknown>

function write(path: string, lines: readonly Line[], append: boolean): void {
  mkdirSync(join(path, '..'), { recursive: true })
  const text = lines.map(line => JSON.stringify(line)).join('\n') + (lines.length > 0 ? '\n' : '')
  if (append) appendFileSync(path, text)
  else writeFileSync(path, text)
}

/** Write (or append to) the member's own wire. */
export function writeMainWire(homeDir: string, lines: readonly Line[], append = false): void {
  write(join(sessionDir(homeDir), 'agents', 'main', 'wire.jsonl'), lines, append)
}

/** Write (or append to) one subagent's wire. */
export function writeSubWire(homeDir: string, subagentId: string, lines: readonly Line[], append = false): void {
  write(join(sessionDir(homeDir), 'agents', subagentId, 'wire.jsonl'), lines, append)
}

/** Kimi's usage counters. */
export interface WireUsage {
  inputOther: number
  output: number
  inputCacheRead: number
  inputCacheCreation: number
}

export const usage = (inputOther: number, output: number, inputCacheRead = 0, inputCacheCreation = 0): WireUsage =>
  ({ inputOther, output, inputCacheRead, inputCacheCreation })

/** Sum wire usages (the running total Kimi reports on a resumed subagent's completion). */
export function totalOf(...parts: readonly WireUsage[]): WireUsage {
  return parts.reduce((sum, part) => ({
    inputOther: sum.inputOther + part.inputOther,
    output: sum.output + part.output,
    inputCacheRead: sum.inputCacheRead + part.inputCacheRead,
    inputCacheCreation: sum.inputCacheCreation + part.inputCacheCreation,
  }), usage(0, 0))
}

/** The member's own prompt (a human round). */
export const memberPrompt = (text: string, time = 1_000_000): Line =>
  ({ type: 'turn.prompt', agentId: 'main', input: [{ type: 'text', text }], origin: { kind: 'user' }, time })

/** `subagent.spawned` (time in seconds, as Kimi writes it). */
export function spawned(options: {
  readonly id: string
  readonly callId: string
  readonly name?: string
  readonly description?: string
  readonly background?: boolean
  readonly taskId?: string
  readonly swarmIndex?: number
  readonly seconds?: number
}): Line {
  return {
    type: 'subagent.spawned',
    subagentId: options.id,
    subagentName: options.name ?? 'explore',
    parentToolCallId: options.callId,
    parentAgentId: 'main',
    callerAgentId: 'main',
    description: options.description ?? '占位任务',
    ...options.swarmIndex === undefined ? {} : { swarmIndex: options.swarmIndex },
    runInBackground: options.background === true,
    model: 'k-fixture',
    thinkingEffort: 'high',
    ...options.taskId === undefined ? {} : { taskId: options.taskId },
    time: options.seconds ?? 1_000,
  }
}

export const started = (id: string, seconds = 1_000): Line => ({ type: 'subagent.started', subagentId: id, time: seconds })

export const completed = (id: string, total: WireUsage, seconds = 1_010): Line =>
  ({ type: 'subagent.completed', subagentId: id, resultSummary: '占位结论', usage: total, contextTokens: 1, time: seconds })

/** One wire step of a subagent: content parts, tool calls, and its usage record. */
export interface StepSpec {
  readonly think?: string
  readonly text?: string
  readonly tools?: ReadonlyArray<{ readonly id: string; readonly name: string; readonly args?: Record<string, unknown>; readonly result?: string }>
  readonly usage: WireUsage
  /** False: the step never closed (no tool results, no `step.end`): Kimi was cut off. */
  readonly closed?: boolean
}

/**
 * One subagent call as wire lines: its prompt, its steps, and (unless
 * `ended` is false) its `turn.ended`. `turnId` is the wire's own 0-based
 * round counter; `at` the first line's ms time.
 */
export function subTurn(options: {
  readonly id: string
  readonly turnId: number
  readonly prompt: string
  readonly steps: readonly StepSpec[]
  readonly at?: number
  readonly ended?: false | string
}): Line[] {
  let time = options.at ?? 1_000_000 + options.turnId * 100_000
  const tick = (): number => (time += 100)
  const loop = (event: Line): Line => ({ type: 'context.append_loop_event', agentId: options.id, event: { turnId: String(options.turnId), ...event }, time: tick() })
  const lines: Line[] = [
    { type: 'turn.prompt', agentId: options.id, input: [{ type: 'text', text: options.prompt }], origin: { kind: 'system_trigger', name: 'subagent' }, turnId: options.turnId, time: tick() },
    { type: 'context.append_message', agentId: options.id, message: { role: 'user', content: [{ type: 'text', text: options.prompt }], origin: { kind: 'system_trigger', name: 'subagent' } }, time: tick() },
  ]
  options.steps.forEach((step, index) => {
    const number = index + 1
    lines.push(loop({ type: 'step.begin', step: number, uuid: `${options.id}-${options.turnId}-${number}` }))
    lines.push({ type: 'llm.request', agentId: options.id, model: 'k-fixture', thinkingEffort: 'high', maxTokens: 32_768, turnStep: `${options.turnId}.${number}`, time: tick() })
    lines.push({ type: 'usage.record', agentId: options.id, model: 'k-fixture', usage: step.usage, usageScope: 'turn', time: tick() })
    if (step.think !== undefined) lines.push(loop({ type: 'content.part', step: number, part: { type: 'think', think: step.think } }))
    if (step.text !== undefined) lines.push(loop({ type: 'content.part', step: number, part: { type: 'text', text: step.text } }))
    for (const tool of step.tools ?? []) {
      lines.push(loop({ type: 'tool.call', step: number, toolCallId: tool.id, uuid: `u-${tool.id}`, name: tool.name, args: tool.args ?? {} }))
    }
    if (step.closed === false) return
    for (const tool of step.tools ?? []) {
      lines.push(loop({ type: 'tool.result', parentUuid: `u-${tool.id}`, toolCallId: tool.id, result: { output: tool.result ?? '占位输出' } }))
    }
    lines.push(loop({ type: 'step.end', step: number, finishReason: (step.tools ?? []).length > 0 ? 'tool_use' : 'stop', llmFirstTokenLatencyMs: 50 }))
  })
  if (options.ended !== false) lines.push({ type: 'turn.ended', agentId: options.id, turnId: options.turnId, reason: options.ended ?? 'completed', time: tick() })
  return lines
}

/** The usual two-step call: a step that reads a file, then the answer. */
export function readThenAnswer(id: string, turnId: number, prompt: string, answer: string, usages: readonly [WireUsage, WireUsage]): Line[] {
  return subTurn({
    id,
    turnId,
    prompt,
    steps: [
      { think: '先看文件', tools: [{ id: `${id}-t${turnId}-read`, name: 'ReadFile', args: { path: 'a.txt' }, result: '文件内容占位' }], usage: usages[0] },
      { text: answer, usage: usages[1] },
    ],
  })
}
