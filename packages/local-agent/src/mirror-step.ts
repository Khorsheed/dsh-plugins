/**
 * The family's one writer for mirrored CLI output. A provider parses its own
 * CLI stream, decides grouping, step coordinates, usage carriers and hold
 * rules, then hands each unit here as normalized blocks; this module writes
 * the host-shaped events (assistant/message with its stream and usage, each
 * tool's call/result pair with its execution timing) so every provider's
 * child log reads the same.
 * @module @khorsheed/dsh-local-agent/mirror-step
 */

import { createAssistantMessage, createToolResultMessage } from '@deepseek-ai/dsh-llm'
import type { AssistantStreamRecord, ContentBlock, ReasoningEffortId, TokenUsage } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEventMap } from '@deepseek-ai/dsh-session'
import type { SubagentStopReason } from '@deepseek-ai/dsh-subagent'
import { localAgentStreamRecords, type LocalAgentModelBlock } from './model-stream.ts'
import { localAgentToolTimingMeta, type LocalAgentToolTiming } from './tool-timing.ts'

// The id brands are compile-time only; take the field types from the
// consuming APIs instead of importing a brand factory.
type ToolCallEventCallId = SessionEventMap['tool/call']['callId']
type ToolResultCallId = Parameters<typeof createToolResultMessage>[0]['callId']
type ToolCallBlockId = Extract<ContentBlock, { type: 'tool-call' }>['id']

/**
 * The result text for a call whose result the CLI never recorded (a kill, a
 * truncated stream, a crash before the wire flushed). The released-log reader
 * resolves every advertised call before its step closes, so such a call folds
 * with this error result.
 */
export const MIRROR_INTERRUPTED_TOOL_RESULT = '（工具调用被中断，未能记录返回结果）'

/** A block's coarse generation interval (the CLI's own event times, or the driver's arrival times). */
export interface MirrorGeneration {
  startedAt: number
  endedAt: number
}

/** One normalized content block of a mirrored model call. */
export type MirrorBlock =
  | { kind: 'think' | 'text'; text: string; generation?: MirrorGeneration }
  | {
    kind: 'tool'
    id: string
    name: string
    args?: string
    /** Absent = never recorded: the call resolves with {@link MIRROR_INTERRUPTED_TOOL_RESULT}. */
    result?: string
    /** The CLI reported the call failed (its result text is still shown). */
    failed?: boolean
    timing?: LocalAgentToolTiming
    generation?: MirrorGeneration
  }

/** Who produced the mirrored message: one provider id for the message source and the tool timing meta. */
export interface MirrorSource {
  provider: string
  /** The model the provider observed for this call, or its fixed fallback label. */
  model: string
}

/** One mirrored model call: its blocks, accounting and completion state. */
export interface MirrorUnit {
  blocks: readonly MirrorBlock[]
  usage?: TokenUsage
  /** A partial written at a non-completed round's end (reads 已停止). */
  interrupted?: boolean
  /** An explicit model stream; omitted, it is derived from the blocks' generations. */
  stream?: AssistantStreamRecord[]
}

/** The request config a mirrored round declares (the host's `request/header` shape). */
export interface MirrorRequestConfig {
  provider: string
  model: string
  reasoningEffort?: ReasoningEffortId
  maxTokens?: number
}

/**
 * The host stream for a unit's blocks: one block-start/block-end pair per
 * block that carries a generation interval, indexed by the block's position.
 */
export function mirrorStreamRecords(blocks: readonly MirrorBlock[]): AssistantStreamRecord[] {
  return localAgentStreamRecords(blocks.flatMap((block, index): LocalAgentModelBlock[] => {
    const generation = block.generation
    if (generation === undefined) return []
    const base = { index, startedAt: generation.startedAt, endedAt: generation.endedAt }
    if (block.kind === 'tool') return [{ ...base, kind: 'tool-call', call: { id: block.id as ToolCallEventCallId, name: block.name, arguments: block.args ?? '' } }]
    return [{ ...base, kind: block.kind === 'think' ? 'reasoning' : 'text', text: block.text }]
  }))
}

/** The assistant message for a unit's blocks, attributed to its source. */
export function mirrorAssistantMessage(blocks: readonly MirrorBlock[], source: MirrorSource) {
  return createAssistantMessage({
    content: blocks.map((block): ContentBlock => block.kind === 'tool'
      ? { type: 'tool-call', id: block.id as ToolCallBlockId, name: block.name, arguments: block.args ?? '' }
      : { type: block.kind === 'think' ? 'reasoning' : 'text', text: block.text }),
    source: { provider: source.provider, model: source.model },
  })
}

/**
 * Write one unit's content at `(turn, step)` without the step boundary: the
 * assistant/message advertising every block (usage and stream on it), then
 * each tool's call/result pair. For a caller whose step is already open.
 */
export function appendMirrorContent(session: Session, turn: number, step: number, unit: MirrorUnit, source: MirrorSource): void {
  session.append('assistant/message', {
    turn,
    step,
    message: mirrorAssistantMessage(unit.blocks, source),
    stream: unit.stream ?? mirrorStreamRecords(unit.blocks),
    ...unit.usage === undefined ? {} : { usage: unit.usage },
    ...unit.interrupted === true ? { interrupted: true } : {},
  }, { surfaceOp: 'append' })
  for (const block of unit.blocks) {
    if (block.kind !== 'tool') continue
    const meta = block.timing === undefined ? undefined : localAgentToolTimingMeta(source.provider, block.timing)
    const call = session.append('tool/call', {
      turn,
      step,
      callId: block.id as ToolCallEventCallId,
      name: block.name,
      arguments: block.args ?? '',
    })
    session.append('tool/result', {
      turn,
      step,
      message: createToolResultMessage({
        callId: block.id as ToolResultCallId,
        content: [{ type: 'text', text: block.result ?? MIRROR_INTERRUPTED_TOOL_RESULT }],
        isError: block.result === undefined || block.failed === true,
      }),
      ...meta === undefined ? {} : { meta },
    }, { surfaceOp: 'append', sourceEventSeqs: [call.seq] })
  }
}

/**
 * Write one unit as one closed step: step/start, {@link appendMirrorContent},
 * step/end. The live conversation assembler needs the boundary to place the
 * step at all, and the released-log reader admits only one open step at a time.
 */
export function appendMirrorStep(session: Session, turn: number, step: number, unit: MirrorUnit, source: MirrorSource): void {
  session.append('step/start', { turn, step })
  appendMirrorContent(session, turn, step, unit, source)
  session.append('step/end', { turn, step })
}

/**
 * Write the round's request/header when its config differs from the child
 * log's last one: the first is `initial`, a differing one `change`, an
 * identical one skipped (the host logs changed snapshots, not per-call copies).
 */
export function appendRequestHeaderIfChanged(session: Session, config: MirrorRequestConfig): void {
  const serialized = JSON.stringify(config)
  let last: string | undefined
  for (const event of session.snapshotEvents()) {
    if (event.type === 'request/header') {
      last = JSON.stringify((event.data as { header?: { config?: unknown } }).header?.config)
    }
  }
  if (last === serialized) return
  session.append('request/header', {
    header: { config },
    reason: last === undefined ? 'initial' : 'change',
  })
}

/**
 * Close a mirrored round's turn: `completed`, `aborted` (by the parent), or
 * `error` carrying the provider's message — every terminal path closes it so
 * the turn's timing window never stays open.
 */
export function closeMirrorTurn(session: Session, turn: number, stopReason: SubagentStopReason, errorMessage: string): void {
  if (stopReason === 'completed') {
    session.append('turn/end', { turn, reason: { kind: 'completed' } })
  } else if (stopReason === 'aborted') {
    session.append('turn/end', { turn, reason: { kind: 'aborted', reason: { kind: 'parent' } } })
  } else {
    session.append('turn/end', { turn, reason: { kind: 'error', error: { message: errorMessage, code: 'UNKNOWN' } } })
  }
}

/**
 * Record a member's context occupancy after a round (one `local-agent/context`),
 * skipped when it equals the log's last reading unless `force` (a compaction
 * just ran, so the same number is news).
 */
export function recordContextOccupancy(
  session: Session,
  reading: { provider: string; usedTokens: number; contextWindow?: number | undefined },
  options: { force?: boolean } = {},
): void {
  const last = session.snapshotEvents().findLast(event => event.type === 'local-agent/context')?.data as SessionEventMap['local-agent/context'] | undefined
  if (options.force !== true && last?.usedTokens === reading.usedTokens && last.contextWindow === reading.contextWindow) return
  session.append('local-agent/context', {
    provider: reading.provider,
    usedTokens: reading.usedTokens,
    ...reading.contextWindow === undefined ? {} : { contextWindow: reading.contextWindow },
  })
}
