/**
 * The log lane: reconstructs requests from an on-disk session log, read through
 * the host's `sessionPersistence` service (which owns the root layout, the
 * zstd framing, and the format-version chain). Two drivers share one fold:
 *
 * - **Child scopes** — a `subagent_dsh` one-shot child runs in a NEW process,
 *   so the parent's `llm/stream` never sees its requests; the scope fills from
 *   the child's own log, incrementally (the cursor resumes at the consumed
 *   offset across panel queries).
 * - **Main-session backfill** — the panel otherwise shows only turns captured
 *   live since mount; the session's own log reconstructs the pre-mount history
 *   at log fidelity ({@link reconstructSession}), once per session.
 *
 * Honesty contract (one-shot child logs lack two things by design): no
 * `request/header` events means `config` stays `{}` until a header says
 * otherwise, and a missing system prompt never lands in the log, so the system
 * segment stays empty. Main-session logs carry both (`request/header` →
 * config + tools; `system/message` → the rendered prompt as ONE block — the
 * assemble-section attribution is the live lane's upgrade, the log keeps no
 * section names). The lane never invents either.
 *
 * Each `assistant/message` (a settled, usage-carrying response) or
 * `assistant/attempt` (a settled failure) completes one request row.
 *
 * @module @khorsheed/dsh-context-lens/log-lane
 */
import { countToolCalls } from './tool-summary.ts'
import type { RequestConfig, RequestUsage, ResponseSummary } from './types.ts'
import type { CapturedResponse } from './types.ts'
import { responseFromSpans, type BlockSpan, type StoredRequest } from './store.ts'
import { contentHash, splitRequest, type ScopeFingerprint } from './segmenter.ts'
import { AMBIENT_SOURCES, fromLogMessage, lastParagraph, messageKey, previewLine, serializeMessage, type CapturedMessage } from './messages.ts'

/** The structural minimum of one decoded session-log row (untrusted JSON). */
export interface SessionLogRow {
  type: string
  seq?: number
  time?: number
  data?: unknown
  ignorable?: true
  surfaceOp?: 'append' | { op: 'replace'; startSeq: number; endSeq: number }
  sourceEventSeqs?: number[]
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

/** One delegation call correlated across tool/call → subagent/catalog → tool/result. */
export interface LogDelegation {
  /** The host turn that ran the delegation, when the log scopes it. */
  hostTurn?: number
  /** The delegating tool call; '' for a catalog-only child (an external agent no tool call started). */
  callId: string
  name: string
  at: number
  /** The call arguments' description (the subagent_dsh convention). */
  label?: string
  childId?: string
  catalogLabel?: string
  resultAt?: number
  isError?: boolean
  errorPreview?: string
}

/** Incremental per-log fold state; survives across refreshes (child lane) or one shot (backfill). */
export interface SessionLogCursor {
  /** Events consumed so far (the next read's offset). */
  consumed: number
  /** The log begins at its header/event zero, so request ordinals are anchored. */
  numberedFromStart: boolean
  /** Model-visible messages folded so far, in log order. */
  messages: FoldedMessage[]
  compactions: Map<string, { startedAt: number; hostTurn?: number; request?: BuiltLogRequest }>
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
  /** The currently open host turn's number (turn/start … turn/end). */
  turnHost: number | undefined
  /** Whether the current turn already contributed its query preview. */
  turnQuerySeen: boolean
  /** Whether the current turn already named the non-human message that started it. */
  turnTriggerSeen: boolean
  /** Delegation calls awaiting their catalog/result. */
  pendingDelegations: Map<string, LogDelegation>
  /** Set once a read failed this cursor; the lane stops hammering a bad log. */
  broken: string | undefined
  /**
   * Whether a request of this host turn keeps its full segments. Every
   * request carries its whole context, so materializing a long log at once
   * grows with the square of its length; the backfill materializes only its
   * window and records the rest as bodiless rows. Absent: materialize all.
   */
  materialize?: (hostTurn: number | undefined) => boolean
  /** The last request's messages when it was not materialized (the next full one diffs against them). */
  previousMessages?: CapturedMessage[]
  previousToolNames?: string[]
}

/** A request row built from the log, before the store assigns its sequence. */
export type BuiltLogRequest = Omit<StoredRequest, 'seq' | 'sessionId' | 'scopeId' | 'turnSeq'>

/** Optional fold hooks beyond the request rows (the backfill driver uses them all). */
export interface FoldSink {
  turnStart?(hostTurn: number, at: number | undefined, seq?: number): void
  turnEnd?(hostTurn: number, reason: { kind: string; error?: { message?: string } }, at: number | undefined): void
  /** The turn's first human user message (the turn list's query preview). */
  queryText?(hostTurn: number | undefined, text: string, at: number | undefined): void
  /** The turn's first message from a non-human producer (the turn's trigger when no human spoke). */
  triggerText?(hostTurn: number | undefined, source: string, text: string): void
  /** Each committed assistant message id; the last one of a turn is its closing message. */
  closingMessage?(hostTurn: number | undefined, messageId: string): void
  /** One completed request, tagged with its host turn when the log scopes it. */
  request?(hostTurn: number | undefined, request: BuiltLogRequest): void
  /** One delegation run, emitted when its tool/result lands (or at fold flush). */
  delegation?(delegation: LogDelegation): void
}

/** A fresh cursor for one log. */
export function openCursor(): SessionLogCursor {
  return {
    consumed: 0,
    numberedFromStart: false,
    messages: [],
    compactions: new Map(),
    stepStartAt: undefined,
    config: undefined,
    tools: undefined,
    callAt: new Map(),
    callNames: new Map(),
    callOwners: new Map(),
    messageDurations: new Map(),
    previous: undefined,
    requests: [],
    turnHost: undefined,
    turnQuerySeen: false,
    turnTriggerSeen: false,
    pendingDelegations: new Map(),
    broken: undefined,
  }
}

/**
 * Fold new log rows into the cursor. Returns the requests completed by THIS
 * batch (the child-scope driver's whole output); the sink receives those plus
 * the turn/delegation structure (the backfill driver). Tool exec spans can
 * open and close in later batches, so pairing data lives on the cursor.
 */
export function foldLogRows(
  cursor: SessionLogCursor,
  rows: readonly SessionLogRow[],
  sink: FoldSink = {},
): BuiltLogRequest[] {
  const built: BuiltLogRequest[] = []
  for (const row of rows) {
    if (cursor.consumed === 0) cursor.numberedFromStart = row.type === 'session' || row.seq === 0
    cursor.consumed += 1
    if (row.ignorable) continue
    const data = (typeof row.data === 'object' && row.data !== null ? row.data : {}) as Record<string, unknown>
    switch (row.type) {
      case 'turn/start': {
        const hostTurn = typeof data['turn'] === 'number' ? data['turn'] : undefined
        cursor.turnHost = hostTurn
        cursor.turnQuerySeen = false
        cursor.turnTriggerSeen = false
        if (hostTurn !== undefined) sink.turnStart?.(hostTurn, row.time, row.seq)
        break
      }
      case 'turn/end': {
        const hostTurn = typeof data['turn'] === 'number' ? data['turn'] : cursor.turnHost
        const reason = typeof data['reason'] === 'object' && data['reason'] !== null
          ? data['reason'] as { kind: string; error?: { message?: string } }
          : { kind: 'unknown' }
        if (hostTurn !== undefined) sink.turnEnd?.(hostTurn, reason, row.time)
        cursor.turnHost = undefined
        break
      }
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
            ...typeof config['reasoningEffort'] === 'string' ? { reasoningEffort: config['reasoningEffort'] } : {},
            ...typeof config['temperature'] === 'number' ? { temperature: config['temperature'] } : {},
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
        if (message !== undefined) message.sourceTurn = typeof data['turn'] === 'number' ? data['turn'] : cursor.turnHost
        if (message !== undefined) placeMessage(cursor, row, message)
        break
      }
      case 'user/message': {
        const message = fromLogMessage(data)
        if (message !== undefined) message.sourceTurn = cursor.turnHost
        if (message !== undefined) {
          placeMessage(cursor, row, message)
          if (!cursor.turnQuerySeen && message.sourceKind === 'user') {
            cursor.turnQuerySeen = true
            sink.queryText?.(cursor.turnHost, collapseQuery(serializeMessage(message)), row.time)
          } else if (!cursor.turnTriggerSeen && (row.surfaceOp === undefined || row.surfaceOp === 'append') && !AMBIENT_SOURCES.has(message.sourceKind)) {
            cursor.turnTriggerSeen = true
            sink.triggerText?.(cursor.turnHost, message.sourceKind, lastParagraph(serializeMessage(message)))
          }
        }
        break
      }
      case 'assistant/message': {
        const request = buildRequest(cursor, row, data, false)
        built.push(request)
        cursor.requests.push(request)
        const hostTurn = typeof data['turn'] === 'number' ? data['turn'] : cursor.turnHost
        sink.request?.(hostTurn, request)
        const message = fromLogMessage(data['message'])
        if (message !== undefined) message.sourceTurn = typeof data['turn'] === 'number' ? data['turn'] : cursor.turnHost
        if (message !== undefined) {
          placeMessage(cursor, row, message)
          if (message.id !== undefined) {
            if (request.settledAt !== undefined) {
              cursor.messageDurations.set(message.id, request.settledAt - request.startedAt)
            }
            sink.closingMessage?.(hostTurn, message.id)
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
        sink.request?.(typeof data['turn'] === 'number' ? data['turn'] : cursor.turnHost, request)
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
          if (name !== undefined && isDelegationTool(name)) {
            const delegation: LogDelegation = {
              ...typeof data['turn'] === 'number' ? { hostTurn: data['turn'] } : {},
              callId,
              name,
              at: row.time ?? 0,
              ...delegationLabel(typeof data['arguments'] === 'string' ? data['arguments'] : ''),
            }
            cursor.pendingDelegations.set(callId, delegation)
          }
        }
        break
      }
      case 'subagent/catalog': {
        const childId = typeof data['childId'] === 'string' ? data['childId'] : undefined
        if (childId !== undefined && childId.length > 0) {
          // FIFO bind: the catalog belongs to the oldest unbound delegation call.
          let bound = false
          for (const pending of cursor.pendingDelegations.values()) {
            if (pending.childId === undefined) {
              pending.childId = childId
              if (typeof data['label'] === 'string' && data['label'].length > 0) pending.catalogLabel = data['label']
              bound = true
              break
            }
          }
          // A child no tool call started (an external agent a provider or the
          // user brought in) still is a child of this turn: surface it as-is.
          if (!bound) {
            sink.delegation?.({
              ...cursor.turnHost === undefined ? {} : { hostTurn: cursor.turnHost },
              callId: '',
              name: 'subagent/catalog',
              at: row.time ?? 0,
              childId,
              ...typeof data['label'] === 'string' && data['label'].length > 0 ? { catalogLabel: data['label'] } : {},
            })
          }
        }
        break
      }
      case 'compaction/start': {
        const id = data['compactionId']
        if (typeof id === 'string') cursor.compactions.set(id, { startedAt: row.time ?? 0, ...typeof data['turn'] === 'number' ? { hostTurn: data['turn'] } : {} })
        break
      }
      case 'compaction/summary': {
        const request = buildCompaction(cursor, row, data)
        if (request) {
          const id = request.compaction!.id
          cursor.compactions.set(id, { ...cursor.compactions.get(id), startedAt: request.startedAt, request })
          built.push(request); sink.request?.(cursor.turnHost, request)
        }
        break
      }
      case 'compaction/end':
        if (typeof data['compactionId'] === 'string') cursor.compactions.delete(data['compactionId'])
        break
      case 'tool/result': {
        const message = fromLogMessage(data['message'])
        if (message !== undefined) message.sourceTurn = typeof data['turn'] === 'number' ? data['turn'] : cursor.turnHost
        if (message !== undefined) placeMessage(cursor, row, message)
        if (row.surfaceOp && row.surfaceOp !== 'append') break
        const callId = message?.toolCallId
          ?? (typeof data['toolCallId'] === 'string' ? data['toolCallId'] : undefined)
        if (callId !== undefined) {
          const owner = cursor.callOwners.get(callId)
          const span = owner?.execs.find(exec => exec.callId === callId && exec.end === undefined)
          if (span !== undefined) {
            if (row.time !== undefined) span.end = row.time
            span.isError = message?.isError === true
            if (message !== undefined) span.result = serializeMessage(message)
          }
          const delegation = cursor.pendingDelegations.get(callId)
          if (delegation !== undefined) {
            cursor.pendingDelegations.delete(callId)
            if (row.time !== undefined) delegation.resultAt = row.time
            delegation.isError = message?.isError === true
            if (delegation.isError && message !== undefined) {
              delegation.errorPreview = previewLine(serializeMessage(message))
            }
            sink.delegation?.(delegation)
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

/** Apply inclusive endpoints in CURRENT surface order (seq order may differ). */
function placeMessage(cursor: SessionLogCursor, row: SessionLogRow, message: CapturedMessage): void {
  const node = { seq: row.seq ?? cursor.consumed, message }
  const op = row.surfaceOp
  // Markerless legacy fixtures behave as append; native decoded logs carry the marker.
  if (op === undefined || op === 'append') { cursor.messages.push(node); return }
  const start = cursor.messages.findIndex(item => item.seq === op.startSeq)
  const end = cursor.messages.findIndex(item => item.seq === op.endSeq)
  if (op.op !== 'replace' || start < 0 || end < start) throw new Error(`Invalid context surface replacement at event ${row.seq}`)
  if (row.type === 'tool/result') {
    const original = cursor.messages[start]!.message
    const beforeChars = original.pruning?.beforeChars ?? serializeMessage(original).length
    const afterChars = serializeMessage(message).length
    if (afterChars < beforeChars) message.pruning = { beforeChars, afterChars }
  }
  cursor.messages.splice(start, end - start + 1, node)
  const compression = message.compactionId === undefined ? undefined : cursor.compactions.get(message.compactionId)?.request?.compaction
  if (compression) compression.applied = true
}

/** Recover recorded model-backed summaries without inventing the missing instruction. */
function buildCompaction(cursor: SessionLogCursor, row: SessionLogRow, data: Record<string, unknown>): BuiltLogRequest | undefined {
  const id = data['compactionId']
  if (typeof id !== 'string' || (data['llmStreamCall'] !== true && data['usage'] === undefined)) return undefined
  const start = cursor.compactions.get(id)
  const seqs = Array.isArray(data['shadowedSeqs']) ? data['shadowedSeqs'] : []
  const selected = new Set(seqs)
  const region = cursor.messages.filter(item => selected.has(item.seq))
  const summary = fromLogMessage({ role: 'assistant', content: data['summary'] })
  if (!summary) return undefined
  const temp = openCursor()
  if (cursor.materialize !== undefined) temp.materialize = cursor.materialize
  temp.turnHost = start?.hostTurn
  // The summarize call replays the conversation prefix: the system head at
  // surface node 0, the header's tools, then the region (compaction-basic
  // buildSummarizationInput). Only its trailing instruction lives in host
  // code rather than the log, so the request stays inputPartial.
  const head = cursor.messages[0]
  temp.messages = head !== undefined && head.message.role === 'system' && !selected.has(head.seq) ? [head, ...region] : region
  if (cursor.tools !== undefined) temp.tools = cursor.tools
  temp.stepStartAt = start?.startedAt ?? row.time
  temp.config = {
    ...typeof data['provider'] === 'string' ? { provider: data['provider'] } : {},
    ...typeof data['model'] === 'string' ? { model: data['model'] } : {},
    ...typeof data['maxTokens'] === 'number' ? { maxTokens: data['maxTokens'] } : {},
  }
  const result = buildRequest(temp, row, { message: { role: 'assistant', content: data['summary'] }, usage: data['usage'] }, false)
  return { ...result, responseSummary: { kind: 'compaction' }, purpose: 'compaction', compaction: {
    id, applied: false, ...start?.hostTurn === undefined ? {} : { hostTurn: start.hostTurn },
    ...Array.isArray(data['shadowedSeqs']) && region.length === seqs.length ? { replacedCount: region.length, replacedChars: region.reduce((n, item) => n + serializeMessage(item.message).length, 0) } : {}, inputPartial: true,
  } }
}

/**
 * One-shot reconstruction of a whole session log into turns (the main-session
 * backfill). Requests group by their host turn number (step-scoped events
 * carry it; a torn bracket falls back to the fold's open-turn state). Turns
 * never closed by a turn/end (a crash) come out with `endReasonKind` unset.
 */
export function reconstructSession(rows: readonly SessionLogRow[], materialize?: (hostTurn: number | undefined) => boolean): LogTurn[] {
  const cursor = openCursor()
  if (materialize !== undefined) cursor.materialize = materialize
  const turns: LogTurn[] = []
  const byHostTurn = new Map<number, LogTurn>()
  const turnFor = (hostTurn: number | undefined, at: number | undefined): LogTurn | undefined => {
    if (hostTurn === undefined) return undefined
    let turn = byHostTurn.get(hostTurn)
    if (turn === undefined) {
      turn = {
        hostTurn,
        query: '',
        ...at === undefined ? { startedAt: 0 } : { startedAt: at },
        requests: [],
        delegations: [],
      }
      byHostTurn.set(hostTurn, turn)
      turns.push(turn)
    } else if (turn.startedAt === 0 && at !== undefined) {
      turn.startedAt = at
    }
    return turn
  }
  foldLogRows(cursor, rows, {
    turnStart: (hostTurn, at, seq) => {
      const turn = turnFor(hostTurn, at)
      if (turn !== undefined && seq !== undefined && turn.startSeq === undefined) turn.startSeq = seq
    },
    turnEnd: (hostTurn, reason, at) => {
      const turn = turnFor(hostTurn, at)
      if (turn === undefined) return
      if (at !== undefined) turn.endedAt = at
      turn.endReasonKind = reason.kind
      if (reason.kind === 'error' && reason.error?.message !== undefined) turn.endError = reason.error.message
    },
    queryText: (hostTurn, text, at) => {
      const turn = turnFor(hostTurn, at)
      if (turn !== undefined && turn.query === '') turn.query = text
    },
    triggerText: (hostTurn, source, text) => {
      const turn = turnFor(hostTurn, undefined)
      if (turn !== undefined && turn.trigger === undefined) turn.trigger = { source, text }
    },
    closingMessage: (hostTurn, messageId) => {
      const turn = turnFor(hostTurn, undefined)
      if (turn !== undefined) turn.closingMessageId = messageId
    },
    request: (hostTurn, request) => {
      if (request.compaction) {
        turns.push({ hostTurn: -turns.length - 1, purpose: 'compaction', query: 'compaction', startedAt: request.startedAt, endedAt: request.settledAt ?? request.startedAt, endReasonKind: 'completed', requests: [request], delegations: [] })
      } else turnFor(hostTurn, request.startedAt)?.requests.push(request)
    },
    delegation: (delegation) => {
      turnFor(delegation.hostTurn, delegation.at)?.delegations.push(delegation)
    },
  })
  // A delegation whose result never landed (a crashed turn) still surfaces.
  for (const pending of cursor.pendingDelegations.values()) {
    turnFor(pending.hostTurn, pending.at)?.delegations.push(pending)
  }
  return turns
}

/** One reconstructed turn (the store turns this into a TurnRecord). */
export interface LogTurn {
  hostTurn: number
  purpose?: string
  query: string
  /** First non-human message of the turn: who started it when no human did. */
  trigger?: { source: string; text: string }
  /** The `turn/start` row's seq (the chat's history-jump target). */
  startSeq?: number
  startedAt: number
  endedAt?: number
  closingMessageId?: string
  /** The turn/end reason kind; absent when the log never closed the turn. */
  endReasonKind?: string
  endError?: string
  requests: BuiltLogRequest[]
  delegations: LogDelegation[]
}

/** The delegation tool family whose calls pair with `subagent/catalog` events. */
function isDelegationTool(name: string): boolean {
  return /^subagent[_-]/.test(name)
}

/** The delegation label out of the call arguments (`description` is the subagent_dsh convention). */
function delegationLabel(args: string): { label?: string } {
  try {
    const parsed: unknown = JSON.parse(args)
    if (typeof parsed === 'object' && parsed !== null) {
      const description = (parsed as { description?: unknown }).description
      if (typeof description === 'string' && description.length > 0) return { label: description }
    }
  } catch {
    // Unparseable model arguments simply carry no label.
  }
  return {}
}

/** The turn-list query preview: one collapsed line, capped. */
function collapseQuery(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 120)
}

/** One settled request out of its assistant event: stream timing, usage, and the segment split. */
function buildRequest(
  cursor: SessionLogCursor,
  row: SessionLogRow,
  data: Record<string, unknown>,
  failed: boolean,
): BuiltLogRequest {
  const startedAt = cursor.stepStartAt ?? row.time ?? 0
  const settledAt = row.time ?? startedAt
  const stream = Array.isArray(data['stream']) ? data['stream'] : []
  const streamFacts = readStream(stream)
  const usage = readUsage(data['usage'])
  const hostTurn = typeof data['turn'] === 'number' ? data['turn'] : cursor.turnHost
  const messages = cursor.messages.map(folded => folded.message)
  let segments: ReturnType<typeof splitRequest>
  if (cursor.materialize?.(hostTurn) === false) {
    // Outside the window: keep the structure, not the copied context.
    cursor.previousMessages = messages
    cursor.previousToolNames = (cursor.tools ?? []).map(tool => tool.name)
    cursor.previous = undefined
    segments = { system: [], tools: [], history: [], added: [], totalChars: 0, fingerprint: { messageKeys: [], toolNames: [] } }
  } else {
    if (cursor.previous === undefined && cursor.previousMessages !== undefined) {
      cursor.previous = { messageKeys: cursor.previousMessages.map(message => messageKey(message, contentHash)), toolNames: cursor.previousToolNames ?? [] }
    }
    delete cursor.previousMessages
    segments = splitRequest({
      messages,
      ...cursor.tools === undefined ? {} : { tools: cursor.tools },
      context: {
        ...cursor.previous === undefined ? {} : { previous: cursor.previous },
        assemblies: [],
        resolveToolName: callId => cursor.callNames.get(callId),
        durationFor: messageId => cursor.messageDurations.get(messageId),
      },
    })
    cursor.previous = segments.fingerprint
  }

  const message = failed ? undefined : fromLogMessage(data['message'])
  const blocks = message !== undefined
    ? spansFromMessage(message, streamFacts, startedAt)
    : streamFacts.blocks
  // The response's own content: the committed message is authoritative; an
  // attempt (failed) keeps whatever its stream delivered.
  const response = message !== undefined
    ? responseFromMessage(message)
    : responseFromSpans(streamFacts.blocks)

  const finish = streamFacts.finish
  const error = failed
    ? (finish?.failure ?? 'attempt settled without a committed message')
    : undefined
  const finishKind = finish?.kind
  return {
    ...cursor.numberedFromStart ? { requestNumber: cursor.requests.length + 1 } : {},
    startedAt,
    status: failed ? 'failed' : 'ok',
    ...error === undefined ? {} : { error },
    config: cursor.config ?? {},
    ...usage === undefined ? {} : { usage },
    responseSummary: message !== undefined ? summarizeMessage(message) : summarizeBlocks(streamFacts.blocks),
    ...response === undefined ? {} : { response },
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

/** The response's own content from a committed assistant message (authoritative). */
function responseFromMessage(message: CapturedMessage): CapturedResponse | undefined {
  const reasoning = message.content
    .filter(block => block.type === 'reasoning')
    .map(block => block.text ?? '')
    .join('')
  const text = message.content
    .filter(block => block.type === 'text')
    .map(block => block.text ?? '')
    .join('')
  const toolCalls = message.content
    .filter(block => block.type === 'tool-call' && block.name !== undefined)
    .map(block => ({ ...block.id === undefined ? {} : { callId: block.id }, name: block.name as string, arguments: block.arguments ?? '' }))
  if (reasoning === '' && text === '' && toolCalls.length === 0) return undefined
  return {
    ...reasoning === '' ? {} : { reasoning },
    ...text === '' ? {} : { text },
    toolCalls,
  }
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
      ...calls.length > 1 ? { more: calls.length - 1, toolCounts: countToolCalls(calls.map(call => call.name as string)) } : {},
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
    ...calls.length > 1 ? { more: calls.length - 1, toolCounts: countToolCalls(calls.map(call => call.toolName as string)) } : {},
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
            // The assembled block is authoritative over the accumulated runs.
            if (typeof block?.['text'] === 'string') span.text = block['text']
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
      // Packed delta runs: their time0 is the run's first chunk's time. Their
      // fragments accumulate onto the open span so a torn stream keeps the
      // partial response (the attempt path reads it).
      note(record['time0'])
      const span = blocks.find(block => block.index === record['index'] && block.end === undefined)
      if (span !== undefined) {
        if (Array.isArray(record['texts'])) {
          span.text = (span.text ?? '') + record['texts'].join('')
        } else if (Array.isArray(record['args'])) {
          span.args = (span.args ?? '') + record['args'].join('')
        }
      }
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
