/**
 * The log lane: reconstructs a fresh-process subagent child's requests from its
 * on-disk session log. A `subagent_dsh` one-shot child runs in a NEW process —
 * the parent's `llm/stream` never sees its requests — so the scope's detail
 * comes from the child's `session.v4.jsonl.zstd`, read through the host's
 * `sessionPersistence` service (which owns the root layout, the zstd framing,
 * and the format-version chain).
 *
 * Honesty contract (one-shot logs lack two things by design): no
 * `request/header` events means `config` stays `{}` until a header says
 * otherwise, and the child's system prompt never lands in the log, so the
 * system segment stays empty. The lane never invents either.
 *
 * Reconstruction is incremental: the cursor folds new events only, and each
 * `assistant/message` (a settled, usage-carrying response) or
 * `assistant/attempt` (a settled failure) completes one request row.
 *
 * @module @khorsheed/dsh-request-inspector/child-log
 */
import type { RequestConfig, RequestUsage, ResponseSummary } from './types.ts'
import type { BlockSpan, StoredRequest } from './store.ts'
import { splitRequest, type ScopeFingerprint } from './segmenter.ts'
import { fromLogMessage, previewLine, type CapturedMessage } from './messages.ts'

/** The structural minimum of one decoded session-log row (untrusted JSON). */
export interface SessionLogRow {
  type: string
  seq?: number
  time?: number
  data?: unknown
  ignorable?: true
}

/** What the lane asks of the host's persistence service (structural probe). */
export interface SessionLogHandle {
  read(offset?: number, length?: number): Promise<{ events: SessionLogRow[] }>
  close(): Promise<void>
}

/** The `sessionPersistence` service face this lane uses. */
export interface SessionLogReader {
  open(id: string, access: 'read'): Promise<SessionLogHandle>
}

/** Structural check for the probed `sessionPersistence` service. */
export function isSessionLogReader(value: unknown): value is SessionLogReader {
  return typeof value === 'object' && value !== null
    && typeof (value as { open?: unknown }).open === 'function'
}

/** A folded message plus its log position (fold order ≠ request membership). */
interface FoldedMessage {
  seq: number
  message: CapturedMessage
}

/** Incremental per-child fold state; survives across refreshes. */
export interface ChildLogCursor {
  /** Events consumed so far (the next read's offset). */
  consumed: number
  /** Model-visible messages folded so far, in log order. */
  messages: FoldedMessage[]
  /** The latest step/start time — the next request's dispatch proxy. */
  stepStartAt: number | undefined
  /** The latest request/header config, when the log carries any. */
  config: RequestConfig | undefined
  /** The latest request/header tool list, when the log carries any. */
  tools: { name: string; description: string; parameters: Record<string, unknown> }[] | undefined
  /** tool/call times by callId. */
  callAt: Map<string, number>
  /** callId → tool name (tool-row labels). */
  callNames: Map<string, string>
  /** callId → the built request whose response issued it (exec attribution). */
  callOwners: Map<string, BuiltLogRequest>
  /** messageId → producing request's generation ms. */
  messageDurations: Map<string, number>
  /** The previous request's diff baseline. */
  previous: ScopeFingerprint | undefined
  /** Requests built so far (kept for late tool-exec closes). */
  requests: BuiltLogRequest[]
  /** Set once a read failed this cursor; the lane stops hammering a bad log. */
  broken: string | undefined
}

/** A request row built from the log, before the store assigns its sequence. */
export type BuiltLogRequest = Omit<StoredRequest, 'seq' | 'sessionId' | 'scopeId' | 'turnSeq'>

/** A fresh cursor for one child scope. */
export function openCursor(): ChildLogCursor {
  return {
    consumed: 0,
    messages: [],
    stepStartAt: undefined,
    config: undefined,
    tools: undefined,
    callAt: new Map(),
    callNames: new Map(),
    callOwners: new Map(),
    messageDurations: new Map(),
    previous: undefined,
    requests: [],
    broken: undefined,
  }
}

/**
 * Fold new log rows into the cursor, returning the requests completed by THIS
 * batch. The caller appends them to the scope (the store assigns seqs) and
 * then applies {@link closeToolExecs} pairing — tool exec spans can open and
 * close in later batches, so pairing data lives on the cursor.
 */
export function foldLogRows(cursor: ChildLogCursor, rows: readonly SessionLogRow[]): BuiltLogRequest[] {
  const built: BuiltLogRequest[] = []
  for (const row of rows) {
    cursor.consumed += 1
    const data = (typeof row.data === 'object' && row.data !== null ? row.data : {}) as Record<string, unknown>
    switch (row.type) {
      case 'step/start':
        cursor.stepStartAt = row.time
        break
      case 'request/header': {
        const header = data['header'] as { config?: Record<string, unknown>; tools?: unknown } | undefined
        const config = header?.config
        if (config !== undefined) {
          cursor.config = {
            ...typeof config['provider'] === 'string' ? { provider: config['provider'] } : {},
            ...typeof config['model'] === 'string' ? { model: config['model'] } : {},
            ...typeof config['maxTokens'] === 'number' ? { maxTokens: config['maxTokens'] } : {},
          }
        }
        if (Array.isArray(header?.tools)) {
          cursor.tools = header.tools.filter(
            (tool): tool is { name: string; description: string; parameters: Record<string, unknown> } =>
              typeof tool === 'object' && tool !== null
              && typeof (tool as { name?: unknown }).name === 'string'
              && typeof (tool as { description?: unknown }).description === 'string'
              && typeof (tool as { parameters?: unknown }).parameters === 'object',
          )
        }
        break
      }
      case 'system/message':
      case 'developer/message': {
        const message = fromLogMessage(data['message'])
        if (message !== undefined) cursor.messages.push({ seq: row.seq ?? cursor.consumed, message })
        break
      }
      case 'user/message': {
        const message = fromLogMessage(data)
        if (message !== undefined) cursor.messages.push({ seq: row.seq ?? cursor.consumed, message })
        break
      }
      case 'assistant/message': {
        const request = buildRequest(cursor, row, data, false)
        built.push(request)
        cursor.requests.push(request)
        const message = fromLogMessage(data['message'])
        if (message !== undefined) {
          cursor.messages.push({ seq: row.seq ?? cursor.consumed, message })
          if (message.id !== undefined && request.settledAt !== undefined) {
            cursor.messageDurations.set(message.id, request.settledAt - request.startedAt)
          }
          for (const block of message.content) {
            if (block.type === 'tool-call' && block.id !== undefined) {
              cursor.callOwners.set(block.id, request)
            }
          }
        }
        break
      }
      case 'assistant/attempt': {
        const request = buildRequest(cursor, row, data, true)
        built.push(request)
        cursor.requests.push(request)
        break
      }
      case 'tool/call': {
        const callId = typeof data['callId'] === 'string' ? data['callId'] : undefined
        const name = typeof data['name'] === 'string' ? data['name'] : undefined
        if (callId !== undefined) {
          cursor.callAt.set(callId, row.time ?? 0)
          if (name !== undefined) cursor.callNames.set(callId, name)
          const owner = cursor.callOwners.get(callId)
          if (owner !== undefined && name !== undefined) {
            owner.execs.push({ callId, name, start: row.time ?? owner.settledAt ?? owner.startedAt })
          }
        }
        break
      }
      case 'tool/result': {
        const message = fromLogMessage(data['message'])
        if (message !== undefined) cursor.messages.push({ seq: row.seq ?? cursor.consumed, message })
        const callId = message?.toolCallId
          ?? (typeof data['toolCallId'] === 'string' ? data['toolCallId'] : undefined)
        if (callId !== undefined) {
          const owner = cursor.callOwners.get(callId)
          const span = owner?.execs.find(exec => exec.callId === callId && exec.end === undefined)
          if (span !== undefined) {
            if (row.time !== undefined) span.end = row.time
            span.isError = message?.isError === true
          }
        }
        break
      }
      default:
        // Unknown / log-only rows carry no request information; ignorable
        // plugin rows (e.g. local-agent/stream) land here by design.
        break
    }
  }
  return built
}

/** One settled request out of its assistant event: stream timing, usage, and the segment split. */
function buildRequest(
  cursor: ChildLogCursor,
  row: SessionLogRow,
  data: Record<string, unknown>,
  failed: boolean,
): BuiltLogRequest {
  const startedAt = cursor.stepStartAt ?? row.time ?? 0
  const settledAt = row.time ?? startedAt
  const stream = Array.isArray(data['stream']) ? data['stream'] : []
  const streamFacts = readStream(stream)
  const usage = readUsage(data['usage'])
  const segments = splitRequest({
    messages: cursor.messages.map(folded => folded.message),
    ...cursor.tools === undefined ? {} : { tools: cursor.tools },
    context: {
      ...cursor.previous === undefined ? {} : { previous: cursor.previous },
      assemblies: [],
      resolveToolName: callId => cursor.callNames.get(callId),
      durationFor: messageId => cursor.messageDurations.get(messageId),
    },
  })
  cursor.previous = segments.fingerprint

  const message = failed ? undefined : fromLogMessage(data['message'])
  const blocks = message !== undefined
    ? spansFromMessage(message, streamFacts, startedAt)
    : streamFacts.blocks

  const finish = streamFacts.finish
  const error = failed
    ? (finish?.failure ?? 'attempt settled without a committed message')
    : undefined
  const finishKind = finish?.kind
  return {
    startedAt,
    status: failed ? 'failed' : 'ok',
    ...error === undefined ? {} : { error },
    config: cursor.config ?? {},
    ...usage === undefined ? {} : { usage },
    responseSummary: message !== undefined ? summarizeMessage(message) : summarizeBlocks(streamFacts.blocks),
    segments: {
      system: segments.system,
      tools: segments.tools,
      history: segments.history,
      added: segments.added,
    },
    totalChars: segments.totalChars,
    ...streamFacts.firstChunkAt === undefined ? {} : { firstChunkAt: streamFacts.firstChunkAt },
    settledAt,
    ...finishKind === undefined ? {} : { finishKind },
    blocks,
    execs: [],
    fingerprint: segments.fingerprint,
  }
}

/** Block spans for a committed response: stream timing with the message's tool-call identity. */
function spansFromMessage(
  message: CapturedMessage,
  facts: StreamFacts,
  fallbackStart: number,
): BlockSpan[] {
  const calls = message.content.filter(block => block.type === 'tool-call')
  const spans = facts.blocks.map(span => ({ ...span }))
  for (const span of spans) {
    if (span.kind !== 'tool-call') continue
    // The stream's block-end carries the assembled block on the in-process
    // lane; the log's compact records do too (raw chunk records), so the span
    // may already know its call. Match by stream order otherwise.
    if (span.callId !== undefined) continue
    const call = calls.find(block => block.id !== undefined
      && !spans.some(other => other !== span && other.callId === block.id))
    if (call?.id !== undefined) {
      span.callId = call.id
      if (call.name !== undefined) span.toolName = call.name
      if (call.arguments !== undefined) span.args = call.arguments
    }
  }
  if (spans.length === 0 && message.content.length > 0) {
    // A response with no surviving block records (compact runs only): one
    // coarse span keeps the lane honest about when the response was live.
    return [{ kind: 'text', index: 0, start: facts.firstChunkAt ?? fallbackStart }]
  }
  return spans
}

/** The response hint from a committed message's blocks (structured 明细头锚点). */
function summarizeMessage(message: CapturedMessage): ResponseSummary {
  const calls = message.content.filter(block => block.type === 'tool-call' && block.name !== undefined)
  if (calls.length > 0) {
    const first = calls[0] as CapturedMessage['content'][number]
    const hint = hintFromArgs(first.arguments)
    return {
      kind: 'tool',
      name: first.name as string,
      ...hint === undefined ? {} : { hint },
      ...calls.length > 1 ? { more: calls.length - 1 } : {},
    }
  }
  const hasText = message.content.some(block => block.type === 'text' && (block.text ?? '').trim().length > 0)
  return hasText ? { kind: 'text' } : { kind: 'none' }
}

/** The response summary when only stream spans survived (an attempt). */
function summarizeBlocks(blocks: readonly BlockSpan[]): ResponseSummary {
  const calls = blocks.filter(block => block.kind === 'tool-call' && block.toolName !== undefined)
  if (calls.length === 0) return blocks.some(block => block.kind === 'text') ? { kind: 'text' } : { kind: 'none' }
  const first = calls[0] as BlockSpan
  const hint = hintFromArgs(first.args)
  return {
    kind: 'tool',
    name: first.toolName as string,
    ...hint === undefined ? {} : { hint },
    ...calls.length > 1 ? { more: calls.length - 1 } : {},
  }
}

/** The one-line argument hint — the reference reconstruction's key order. */
function hintFromArgs(args: string | undefined): string | undefined {
  if (args === undefined) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(args)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const value = parsed as Record<string, unknown>
  const what = value['what']
  if (typeof what === 'string' && what.length > 0) return previewLine(what, 40)
  const file = value['file_path'] ?? value['path'] ?? value['filePath']
  if (typeof file === 'string' && file.length > 0) return previewLine(file.split('/').pop() ?? file, 40)
  const purpose = value['for']
  if (typeof purpose === 'string' && purpose.length > 0) return previewLine(purpose, 40)
  const description = value['description']
  if (typeof description === 'string' && description.length > 0) return previewLine(description, 40)
  return undefined
}

interface StreamFacts {
  firstChunkAt?: number
  blocks: BlockSpan[]
  finish?: { kind: string; failure?: string }
}

/**
 * Block timing out of one compact stream record list (`AssistantStreamRecord`):
 * block-start/block-end ride as raw `chunk` records, deltas pack into runs
 * whose `time0` still counts toward the first-chunk time.
 */
function readStream(records: readonly unknown[]): StreamFacts {
  const blocks: BlockSpan[] = []
  let firstChunkAt: number | undefined
  let finish: StreamFacts['finish']
  const note = (time: unknown) => {
    if (typeof time !== 'number') return
    if (firstChunkAt === undefined || time < firstChunkAt) firstChunkAt = time
  }
  for (const raw of records) {
    if (typeof raw !== 'object' || raw === null) continue
    const record = raw as Record<string, unknown>
    if (record['type'] === 'chunk') {
      const time = record['time']
      const chunk = record['chunk'] as Record<string, unknown> | undefined
      if (typeof time !== 'number' || chunk === undefined) continue
      note(time)
      switch (chunk['type']) {
        case 'block-start':
          blocks.push({
            kind: typeof chunk['blockType'] === 'string' ? chunk['blockType'] : 'unknown',
            index: typeof chunk['index'] === 'number' ? chunk['index'] : blocks.length,
            start: time,
          })
          break
        case 'block-end': {
          const index = chunk['index']
          const span = blocks.find(block => block.index === index && block.end === undefined)
          if (span !== undefined) {
            span.end = time
            const block = chunk['block'] as Record<string, unknown> | undefined
            if (block?.['type'] === 'tool-call') {
              if (typeof block['id'] === 'string') span.callId = block['id']
              if (typeof block['name'] === 'string') span.toolName = block['name']
              if (typeof block['arguments'] === 'string') span.args = block['arguments']
            }
          }
          break
        }
        case 'finish': {
          const reason = chunk['reason'] as Record<string, unknown> | undefined
          const kind = typeof reason?.['kind'] === 'string' ? reason['kind'] : undefined
          const failure = reason?.['failure'] as Record<string, unknown> | undefined
          finish = {
            kind: kind ?? 'unknown',
            ...typeof failure?.['message'] === 'string' ? { failure: failure['message'] } : {},
          }
          break
        }
        default:
          break
      }
    } else {
      // Packed delta runs: their time0 is the run's first chunk's time.
      note(record['time0'])
    }
  }
  return {
    ...firstChunkAt === undefined ? {} : { firstChunkAt },
    blocks,
    ...finish === undefined ? {} : { finish },
  }
}

/** Structural read of one usage object (provider figures, cache fields optional). */
function readUsage(raw: unknown): RequestUsage | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const value = raw as Record<string, unknown>
  if (typeof value['inputTokens'] !== 'number' || typeof value['outputTokens'] !== 'number') return undefined
  return {
    inputTokens: value['inputTokens'],
    outputTokens: value['outputTokens'],
    ...typeof value['totalTokens'] === 'number' ? { totalTokens: value['totalTokens'] } : {},
    ...typeof value['cacheReadTokens'] === 'number' ? { cacheReadTokens: value['cacheReadTokens'] } : {},
  }
}
