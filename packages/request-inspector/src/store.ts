/**
 * The request-inspector capture store: an in-memory ring of sessions → turns →
 * agent scopes → requests, plus the correlation tables the lanes feed.
 *
 * Correlation model:
 * - **Turns** come from `turn/start` / `turn/end` on a root session; a request
 *   whose `sessionId` is the root lands in the turn open at dispatch time.
 * - **Aux requests** (`purpose: compaction | session-title | …`) are not
 *   conversation steps even when one fires mid-turn: they accumulate in a
 *   per-session pseudo-turn keyed by purpose, sorted into the turn list at
 *   first sight.
 * - **Scopes**: `main` is the conversation itself; each `subagent/catalog`
 *   event opens a child scope pinned to the turn that delegated it. A request
 *   whose `sessionId` is a known child joins that scope (in-process drivers);
 *   fresh-process children fill the same scope from the log lane instead.
 * - **Tool timing** pairs `tool/call` → `tool/result` by callId and attributes
 *   the interval to the request whose response issued the call (callId owner
 *   table, fed from tool-call stream blocks).
 *
 * Eviction is turn-granular (never a half turn): per-session turn cap and a
 * global request cap both evict the oldest CLOSED turn; a turn holding a live
 * stream is skipped, so the caps are soft while streams are open.
 *
 * @module @khorsheed/dsh-request-inspector/store
 */
import type {
  AgentScopeOverview,
  CapturedRequest,
  RequestConfig,
  RequestListItem,
  RequestTiming,
  RequestUsage,
  TimingLane,
  ToolTiming,
  TurnListItem,
  TurnOverview,
  TurnTiming,
} from './types.ts'
import { splitRequest, type CapturedToolSchema, type ScopeFingerprint, type AssemblyRecord } from './segmenter.ts'
import type { CapturedMessage } from './messages.ts'

/** Retention knobs (InspectorConfig in the service mirrors these). */
export interface StoreConfig {
  /** Turns retained per session (oldest closed first). Default 20. */
  maxTurnsPerSession?: number
  /** Total retained requests across all sessions. Default 200. */
  maxRequestsTotal?: number
}

const DEFAULT_MAX_TURNS_PER_SESSION = 20
const DEFAULT_MAX_REQUESTS_TOTAL = 200

/** One streamed content block's open/closed time span. */
export interface BlockSpan {
  kind: string
  index: number
  start: number
  end?: number
  /** tool-call blocks: call id, name, and raw arguments (the response hint's source). */
  callId?: string
  toolName?: string
  args?: string
}

/** One tool execution interval attributed to the request that issued the call. */
export interface ToolExecSpan {
  callId: string
  name: string
  start: number
  end?: number
  isError?: boolean
}

/** A request row as the store keeps it — the wire shapes assemble on query. */
export interface StoredRequest {
  seq: number
  sessionId: string
  scopeId: string
  turnSeq: number
  purpose?: string
  startedAt: number
  status: 'streaming' | 'ok' | 'failed'
  error?: string
  config: RequestConfig
  usage?: RequestUsage
  responseSummary: string
  segments: CapturedRequest['segments']
  totalChars: number
  firstChunkAt?: number
  settledAt?: number
  finishKind?: string
  blocks: BlockSpan[]
  execs: ToolExecSpan[]
  fingerprint: ScopeFingerprint
}

/** One delegation call awaiting its catalog binding / result. */
interface PendingCall {
  callId: string
  name: string
  at: number
  /** The delegation label from the call arguments, when the producer uses one. */
  label?: string
  /** Catalog-bound child, once known. */
  childId?: string
}

/** One scope row's internal record (exported via {@link TurnRecord}). */
export interface ScopeRecord {
  scopeId: string
  kind: 'main' | 'subagent'
  label?: string
  status: 'running' | 'ok' | 'failed'
  error?: string
  config: RequestConfig
  requests: StoredRequest[]
  startedAt: number
  endedAt?: number
  /** Fingerprint of the scope's latest request — the next request's diff baseline. */
  previous?: ScopeFingerprint
  /** True once a live (in-process) request landed; the log lane then stays out. */
  live: boolean
  /** True once the log lane reconstructed requests here; live capture then stays out. */
  logFilled: boolean
  /** The delegation call this scope answers, when bound. */
  callId?: string
}

/** One turn row's internal record (exported for the eviction hook's signature). */
export interface TurnRecord {
  turnSeq: number
  /** The host's own turn number; absent on purpose pseudo-turns. */
  hostTurn?: number
  /** Purpose key on pseudo-turns (`compaction`, `session-title`, …). */
  purpose?: string
  query: string
  startedAt: number
  endedAt?: number
  closingMessageId?: string
  scopes: Map<string, ScopeRecord>
}

/** The eviction hook's view of a turn (the log lane drops child cursors on it). */
export type EvictedTurn = TurnRecord

interface SessionRecord {
  id: string
  turns: TurnRecord[]
  /** The bracket currently open; cleared (not deleted) at turn/end. */
  openTurn: TurnRecord | undefined
  /** purpose → its pseudo-turn. */
  buckets: Map<string, TurnRecord>
  nextTurnSeq: number
  /** Pending tool/call rows by callId (exec starts + delegation binding). */
  pendingCalls: Map<string, PendingCall>
  /** messageId → producing request's generation ms (assistant row durations). */
  messageDurations: Map<string, number>
  /** The latest settled purpose-less request — the assistant/message pairing heuristic. */
  lastSettledMain?: StoredRequest
}

/** Snapshot one request needs at dispatch — the normalized GenerateOptions face. */
export interface RequestSnapshot {
  sessionId?: string
  purpose?: string
  config: RequestConfig
  messages: CapturedMessage[]
  systemSlot?: string
  tools?: CapturedToolSchema[]
}

/** The clock and the eviction hook are injectable; everything else is internal. */
export interface StoreDeps {
  now?: () => number
  /** Turn-eviction notice (the log lane closes its per-child handles here). */
  onTurnEvicted?: (sessionId: string, turn: TurnRecord) => void
}

/** The in-memory capture store. All mutation enters through the `note*`/`observe*` methods. */
export class InspectorStore {
  private readonly sessions = new Map<string, SessionRecord>()
  private readonly childToParent = new Map<string, string>()
  /** callId → the request whose response issued the call (exec attribution). */
  private readonly callOwners = new Map<string, StoredRequest>()
  private readonly callNames = new Map<string, string>()
  /** Recently observed rendered assemblies (system-section attribution). */
  private readonly assemblies: AssemblyRecord[] = []
  private readonly now: () => number
  private readonly onTurnEvicted: ((sessionId: string, turn: TurnRecord) => void) | undefined
  private readonly maxTurnsPerSession: number
  private readonly maxRequestsTotal: number
  private seqCounter = 0
  private totalRequests = 0

  constructor(config: StoreConfig = {}, deps: StoreDeps = {}) {
    this.maxTurnsPerSession = config.maxTurnsPerSession ?? DEFAULT_MAX_TURNS_PER_SESSION
    this.maxRequestsTotal = config.maxRequestsTotal ?? DEFAULT_MAX_REQUESTS_TOTAL
    this.now = deps.now ?? Date.now
    this.onTurnEvicted = deps.onTurnEvicted
  }

  /** The shared assembly ring (service feeds it from the assemble waterfall). */
  get assemblyRing(): AssemblyRecord[] {
    return this.assemblies
  }

  /** Whether `sessionId` is a known subagent child of some captured session. */
  isChild(sessionId: string): boolean {
    return this.childToParent.has(sessionId)
  }

  /** The root session one request/event belongs to (children resolve up). */
  private rootOf(sessionId: string): string {
    let cursor = sessionId
    const seen = new Set<string>()
    while (this.childToParent.has(cursor) && !seen.has(cursor)) {
      seen.add(cursor)
      cursor = this.childToParent.get(cursor) as string
    }
    return cursor
  }

  private session(id: string): SessionRecord {
    let record = this.sessions.get(id)
    if (record === undefined) {
      record = {
        id,
        turns: [],
        openTurn: undefined,
        buckets: new Map(),
        nextTurnSeq: 1,
        pendingCalls: new Map(),
        messageDurations: new Map(),
      }
      this.sessions.set(id, record)
    }
    return record
  }

  /** Allocate the next capture-wide turn number for one session. */
  private mintTurn(session: SessionRecord, at: number, init: Partial<TurnRecord>): TurnRecord {
    const turn: TurnRecord = {
      turnSeq: session.nextTurnSeq,
      query: '',
      startedAt: at,
      scopes: new Map(),
      ...init,
    }
    session.nextTurnSeq += 1
    session.turns.push(turn)
    return turn
  }

  private mainScope(turn: TurnRecord, at: number): ScopeRecord {
    let scope = turn.scopes.get('main')
    if (scope === undefined) {
      scope = {
        scopeId: 'main',
        kind: 'main',
        status: 'running',
        config: {},
        requests: [],
        startedAt: at,
        live: false,
        logFilled: false,
      }
      turn.scopes.set('main', scope)
    }
    return scope
  }

  /**
   * Begin one captured request: correlate session/turn/scope, split the
   * segments against the scope's previous fingerprint, assign the sequence.
   *
   * @returns the stored row, or `undefined` when the request carries no
   *   session identity the capture can place (a host call with no sessionId
   *   and no purpose is out of the panel's scope).
   */
  beginRequest(snapshot: RequestSnapshot, startedAt: number): StoredRequest | undefined {
    if (snapshot.sessionId === undefined) return undefined
    const rootId = this.rootOf(snapshot.sessionId)
    const session = this.session(rootId)
    const isChild = snapshot.sessionId !== rootId

    let turn: TurnRecord
    let scopeId: string
    if (isChild) {
      // In-process child: the scope was opened by the catalog event; find it.
      // A scope the log lane already filled stays log-sourced (no double count).
      const found = this.findScope(session, snapshot.sessionId)
      if (found === undefined || found.scope.logFilled) return undefined
      turn = found.turn
      scopeId = found.scope.scopeId
      found.scope.live = true
    } else if (snapshot.purpose !== undefined || session.openTurn === undefined) {
      // Aux requests (`compaction`, `session-title`, …) are not conversation
      // steps even when one fires mid-turn: they accumulate in the per-session
      // pseudo-turn keyed by purpose. A purpose-less request with no open turn
      // lands in the same kind of bucket under 'ad-hoc'.
      const purpose = snapshot.purpose ?? 'ad-hoc'
      let bucket = session.buckets.get(purpose)
      if (bucket === undefined) {
        bucket = this.mintTurn(session, startedAt, { purpose, query: purpose })
        session.buckets.set(purpose, bucket)
      }
      turn = bucket
      scopeId = 'main'
    } else {
      turn = session.openTurn
      scopeId = 'main'
    }

    const scope = scopeId === 'main'
      ? this.mainScope(turn, startedAt)
      : turn.scopes.get(scopeId)
    if (scope === undefined) return undefined

    const segments = splitRequest({
      messages: snapshot.messages,
      ...snapshot.systemSlot === undefined ? {} : { systemSlot: snapshot.systemSlot },
      ...snapshot.tools === undefined ? {} : { tools: snapshot.tools },
      context: {
        ...scope.previous === undefined ? {} : { previous: scope.previous },
        assemblies: this.assemblies,
        resolveToolName: callId => this.callNames.get(callId),
        durationFor: messageId => session.messageDurations.get(messageId),
      },
    })
    scope.previous = segments.fingerprint

    const request: StoredRequest = {
      seq: this.seqCounter,
      sessionId: rootId,
      scopeId: scope.scopeId,
      turnSeq: turn.turnSeq,
      ...snapshot.purpose === undefined ? {} : { purpose: snapshot.purpose },
      startedAt,
      status: 'streaming',
      config: snapshot.config,
      responseSummary: '',
      segments: {
        system: segments.system,
        tools: segments.tools,
        history: segments.history,
        added: segments.added,
      },
      totalChars: segments.totalChars,
      blocks: [],
      execs: [],
      fingerprint: segments.fingerprint,
    }
    this.seqCounter += 1
    scope.requests.push(request)
    this.totalRequests += 1
    if (scope.config.provider === undefined && snapshot.config.provider !== undefined) {
      scope.config = snapshot.config
    }
    this.enforceCaps()
    return request
  }

  /** Attach a purpose-built (log-lane) request row to an existing child scope. */
  appendLogRequest(
    rootSessionId: string,
    scopeId: string,
    built: Omit<StoredRequest, 'seq' | 'sessionId' | 'scopeId' | 'turnSeq'>,
  ): StoredRequest | undefined {
    const session = this.sessions.get(rootSessionId)
    if (session === undefined) return undefined
    const found = this.findScope(session, scopeId)
    if (found === undefined || found.scope.live) return undefined
    found.scope.logFilled = true
    const request: StoredRequest = {
      ...built,
      seq: this.seqCounter,
      sessionId: rootSessionId,
      scopeId,
      turnSeq: found.turn.turnSeq,
    }
    this.seqCounter += 1
    found.scope.requests.push(request)
    found.scope.previous = built.fingerprint
    this.totalRequests += 1
    this.enforceCaps()
    return request
  }

  private findScope(session: SessionRecord, scopeId: string): { turn: TurnRecord; scope: ScopeRecord } | undefined {
    for (const turn of session.turns) {
      const scope = turn.scopes.get(scopeId)
      if (scope !== undefined) return { turn, scope }
    }
    return undefined
  }

  /** One stream chunk observed on a live request's tee. */
  observeChunk(request: StoredRequest, chunk: {
    type: string
    index?: number
    blockType?: string
    block?: { type: string; id?: string; name?: string; arguments?: string }
    usage?: RequestUsage
    reason?: { kind: string; failure?: { message: string } }
  }, at: number): void {
    if (request.firstChunkAt === undefined) request.firstChunkAt = at
    switch (chunk.type) {
      case 'block-start': {
        if (chunk.index === undefined) return
        request.blocks.push({
          kind: chunk.blockType ?? 'unknown',
          index: chunk.index,
          start: at,
        })
        return
      }
      case 'block-end': {
        const span = request.blocks.find(block => block.index === chunk.index && block.end === undefined)
        if (span === undefined) return
        span.end = at
        if (chunk.block?.type === 'tool-call') {
          if (chunk.block.name !== undefined) span.toolName = chunk.block.name
          if (chunk.block.id !== undefined) {
            span.callId = chunk.block.id
            this.callOwners.set(chunk.block.id, request)
            if (chunk.block.name !== undefined) this.callNames.set(chunk.block.id, chunk.block.name)
          }
          if (chunk.block.arguments !== undefined) span.args = chunk.block.arguments
        }
        return
      }
      case 'usage':
        if (chunk.usage !== undefined) request.usage = chunk.usage
        return
      case 'finish':
        if (chunk.reason !== undefined) request.finishKind = chunk.reason.kind
        if (chunk.reason?.kind === 'error' || chunk.reason?.kind === 'aborted') {
          request.error = chunk.reason.failure?.message ?? chunk.reason.kind
        }
        return
      default:
    }
  }

  /** Settle one request: ok on a clean finish, failed on an error finish or a raised error. */
  settleRequest(request: StoredRequest, at: number, thrown?: unknown): void {
    if (request.status !== 'streaming') return
    request.settledAt = at
    if (thrown !== undefined) {
      request.status = 'failed'
      request.error = thrown instanceof Error ? thrown.message : String(thrown)
    } else if (request.error !== undefined) {
      request.status = 'failed'
    } else if (request.finishKind === undefined) {
      // The stream closed without a finish chunk (consumer abandoned it).
      request.status = 'failed'
      request.error = 'stream closed before its finish chunk'
    } else {
      request.status = 'ok'
    }
    request.responseSummary = summarizeResponse(request)
    const session = this.sessions.get(request.sessionId)
    if (session !== undefined && request.purpose === undefined) {
      session.lastSettledMain = request
    }
  }

  /** turn/start on a root session (child sessions route their events to the parent instead). */
  turnStart(sessionId: string, hostTurn: number, at: number): void {
    if (this.isChild(sessionId)) return
    const session = this.session(sessionId)
    if (session.openTurn !== undefined) return
    session.openTurn = this.mintTurn(session, at, { hostTurn })
  }

  /** turn/end: close the open turn, resolve its main scope, sweep abandoned streams. */
  turnEnd(sessionId: string, reason: { kind: string; error?: { message: string } }, at: number): void {
    if (this.isChild(sessionId)) return
    const session = this.sessions.get(sessionId)
    const turn = session?.openTurn
    if (session === undefined || turn === undefined) return
    turn.endedAt = at
    session.openTurn = undefined
    const main = turn.scopes.get('main')
    if (main !== undefined) {
      main.status = reason.kind === 'completed' || reason.kind === 'max-tokens' ? 'ok' : 'failed'
      if (main.status === 'failed') {
        main.error = reason.kind === 'error' ? (reason.error?.message ?? 'turn failed') : reason.kind
      }
      main.endedAt = at
    }
    for (const scope of turn.scopes.values()) {
      for (const request of scope.requests) {
        if (request.status === 'streaming') {
          this.settleRequest(request, at, new Error('stream still open at turn end'))
        }
      }
    }
    this.enforceCaps()
  }

  /** A human message entering the turn — the turn list's query preview. */
  noteUserMessage(sessionId: string, sourceKind: string, text: string): void {
    if (this.isChild(sessionId)) return
    const turn = this.sessions.get(sessionId)?.openTurn
    if (turn === undefined || turn.query !== '') return
    if (sourceKind !== 'user') return
    turn.query = text.replace(/\s+/g, ' ').trim().slice(0, 120)
  }

  /** The turn's closing assistant message id + generation-time backfill for history rows. */
  noteAssistantMessage(sessionId: string, messageId: string): void {
    const session = this.sessions.get(this.rootOf(sessionId))
    if (session === undefined) return
    if (!this.isChild(sessionId) && session.openTurn !== undefined) {
      session.openTurn.closingMessageId = messageId
    }
    const producer = session.lastSettledMain
    if (producer !== undefined) {
      const total = producer.settledAt === undefined ? undefined : producer.settledAt - producer.startedAt
      if (total !== undefined) session.messageDurations.set(messageId, total)
    }
  }

  /** tool/call: open the exec interval (when the issuing request is known) and queue delegation binding. */
  toolCall(sessionId: string, callId: string, name: string, args: string, at: number): void {
    const rootId = this.rootOf(sessionId)
    const session = this.session(rootId)
    this.callNames.set(callId, name)
    const owner = this.callOwners.get(callId)
    if (owner !== undefined) {
      owner.execs.push({ callId, name, start: at })
    }
    if (isDelegationTool(name)) {
      const pending: PendingCall = { callId, name, at, ...delegationLabel(args) }
      session.pendingCalls.set(callId, pending)
    }
  }

  /** tool/result: close the exec interval; resolve a delegation scope's outcome. */
  toolResult(sessionId: string, callId: string, isError: boolean, preview: string, at: number): void {
    const rootId = this.rootOf(sessionId)
    const session = this.sessions.get(rootId)
    const owner = this.callOwners.get(callId)
    if (owner !== undefined) {
      const span = owner.execs.find(exec => exec.callId === callId && exec.end === undefined)
      if (span !== undefined) {
        span.end = at
        span.isError = isError
      }
    }
    if (session === undefined) return
    const pending = session.pendingCalls.get(callId)
    if (pending === undefined) return
    session.pendingCalls.delete(callId)
    // A delegation call that produced no catalog event (the child never
    // materialized) still opens a scope so the failed run shows with zero
    // requests instead of vanishing.
    const scopeId = pending.childId ?? `call:${callId}`
    const found = this.findScope(session, scopeId)
    const scope = found?.scope ?? this.openChildScope(session, scopeId, pending.label, at, callId)
    if (scope === undefined) return
    scope.status = isError ? 'failed' : 'ok'
    if (isError) scope.error = preview
    scope.endedAt = at
  }

  /** subagent/catalog: open the child scope on the current turn and bind the pending call. */
  subagentCatalog(sessionId: string, childId: string, label: string | undefined, at: number): void {
    if (this.isChild(sessionId)) return
    const session = this.session(sessionId)
    this.childToParent.set(childId, sessionId)
    const scope = this.openChildScope(session, childId, label, at)
    if (scope === undefined) return
    for (const pending of session.pendingCalls.values()) {
      if (pending.childId === undefined) {
        pending.childId = childId
        scope.callId = pending.callId
        if (pending.label !== undefined && scope.label === undefined) scope.label = pending.label
        break
      }
    }
  }

  /** Open one child scope on the session's current turn (or latest turn as a fallback). */
  private openChildScope(
    session: SessionRecord,
    scopeId: string,
    label: string | undefined,
    at: number,
    callId?: string,
  ): ScopeRecord | undefined {
    const existing = this.findScope(session, scopeId)
    if (existing !== undefined) return existing.scope
    const turn = session.openTurn ?? session.turns[session.turns.length - 1]
    if (turn === undefined) return undefined
    const scope: ScopeRecord = {
      scopeId,
      kind: 'subagent',
      ...label === undefined ? {} : { label },
      status: 'running',
      config: {},
      requests: [],
      startedAt: at,
      live: false,
      logFilled: false,
      ...callId === undefined ? {} : { callId },
    }
    turn.scopes.set(scopeId, scope)
    return scope
  }

  /** Every child scope of one session (the log lane iterates these). */
  childScopes(sessionId: string): { scopeId: string; live: boolean; status: string }[] {
    const session = this.sessions.get(sessionId)
    if (session === undefined) return []
    const out: { scopeId: string; live: boolean; status: string }[] = []
    for (const turn of session.turns) {
      for (const scope of turn.scopes.values()) {
        if (scope.kind === 'subagent' && !scope.scopeId.startsWith('call:')) {
          out.push({ scopeId: scope.scopeId, live: scope.live, status: scope.status })
        }
      }
    }
    return out
  }

  // ---------- queries ----------

  /** Light turn list of one session, newest last. */
  listTurns(sessionId: string): TurnListItem[] {
    const session = this.sessions.get(sessionId)
    if (session === undefined) return []
    return session.turns.map(turn => this.turnItem(sessionId, turn))
  }

  private turnItem(sessionId: string, turn: TurnRecord): TurnListItem {
    let requestCount = 0
    let failedScopeCount = 0
    let totalInputTokens = 0
    let totalOutputTokens = 0
    for (const scope of turn.scopes.values()) {
      requestCount += scope.requests.length
      if (scope.status === 'failed') failedScopeCount += 1
      for (const request of scope.requests) {
        totalInputTokens += request.usage?.inputTokens ?? 0
        totalOutputTokens += request.usage?.outputTokens ?? 0
      }
    }
    return {
      sessionId,
      turnSeq: turn.turnSeq,
      query: turn.query,
      startedAt: turn.startedAt,
      ...turn.endedAt === undefined ? {} : { endedAt: turn.endedAt },
      requestCount,
      scopeCount: turn.scopes.size,
      failedScopeCount,
      totalInputTokens,
      totalOutputTokens,
      ...turn.closingMessageId === undefined ? {} : { closingMessageId: turn.closingMessageId },
    }
  }

  /** One turn's scope/request overview, without segments. */
  getTurn(sessionId: string, turnSeq: number): TurnOverview | undefined {
    const session = this.sessions.get(sessionId)
    const turn = session?.turns.find(candidate => candidate.turnSeq === turnSeq)
    if (session === undefined || turn === undefined) return undefined
    const item = this.turnItem(sessionId, turn)
    const scopes: AgentScopeOverview[] = [...turn.scopes.values()].map(scope => ({
      scopeId: scope.scopeId,
      kind: scope.kind,
      ...scope.label === undefined ? {} : { label: scope.label },
      status: scope.status,
      ...scope.error === undefined ? {} : { error: scope.error },
      config: scope.config,
      startedAt: scope.startedAt,
      ...scope.endedAt === undefined ? {} : { endedAt: scope.endedAt },
      requests: scope.requests.map((request): RequestListItem => ({
        seq: request.seq,
        scopeId: request.scopeId,
        status: request.status,
        responseSummary: request.responseSummary,
        startedAt: request.startedAt,
        ...request.usage === undefined ? {} : { usage: request.usage },
        ...request.settledAt === undefined ? {} : { totalMs: request.settledAt - request.startedAt },
        totalChars: request.totalChars,
      })),
    }))
    return { turn: item, scopes }
  }

  /** One request's full four-segment breakdown. */
  getRequest(sessionId: string, seq: number): CapturedRequest | undefined {
    const session = this.sessions.get(sessionId)
    if (session === undefined) return undefined
    for (const turn of session.turns) {
      for (const scope of turn.scopes.values()) {
        const request = scope.requests.find(candidate => candidate.seq === seq)
        if (request !== undefined) return this.requestView(request)
      }
    }
    return undefined
  }

  private requestView(request: StoredRequest): CapturedRequest {
    return {
      seq: request.seq,
      scopeId: request.scopeId,
      sessionId: request.sessionId,
      ...request.purpose === undefined ? {} : { purpose: request.purpose },
      startedAt: request.startedAt,
      status: request.status,
      ...request.error === undefined ? {} : { error: request.error },
      config: request.config,
      ...request.usage === undefined ? {} : { usage: request.usage },
      timing: requestTiming(request),
      responseSummary: request.responseSummary,
      segments: request.segments,
    }
  }

  /** One turn's whole-turn timing aggregation. */
  getTurnTiming(sessionId: string, turnSeq: number): TurnTiming | undefined {
    const session = this.sessions.get(sessionId)
    const turn = session?.turns.find(candidate => candidate.turnSeq === turnSeq)
    if (session === undefined || turn === undefined) return undefined
    const lanes: TimingLane[] = []
    const tools = new Map<string, ToolTiming>()
    for (const scope of turn.scopes.values()) {
      for (const request of scope.requests) {
        lanes.push(...requestLanes(request))
        for (const exec of request.execs) {
          if (exec.end === undefined) continue
          lanes.push({
            kind: 'tool-exec',
            requestSeq: request.seq,
            scopeId: request.scopeId,
            startedAt: exec.start,
            durationMs: exec.end - exec.start,
            tool: exec.name,
          })
          const argsMs = request.blocks
            .filter(block => block.callId === exec.callId && block.end !== undefined)
            .reduce((n, block) => n + ((block.end as number) - block.start), 0)
          const aggregate = tools.get(exec.name) ?? { tool: exec.name, calls: 0, totalMs: 0, argsMs: 0 }
          aggregate.calls += 1
          aggregate.totalMs += exec.end - exec.start
          aggregate.argsMs += argsMs
          tools.set(exec.name, aggregate)
        }
      }
    }
    lanes.sort((a, b) => a.startedAt - b.startedAt || a.requestSeq - b.requestSeq)
    const sum = (kind: TimingLane['kind']) => lanes
      .filter(lane => lane.kind === kind)
      .reduce((n, lane) => n + lane.durationMs, 0)
    const endedAt = turn.endedAt ?? this.now()
    return {
      turnSeq: turn.turnSeq,
      totalMs: Math.max(0, endedAt - turn.startedAt),
      buckets: {
        waitMs: sum('wait'),
        reasoningMs: sum('reasoning'),
        toolArgsMs: sum('tool-args'),
        textMs: sum('text'),
        toolExecMs: sum('tool-exec'),
        otherMs: sum('other'),
      },
      lanes,
      tools: [...tools.values()].sort((a, b) => b.totalMs - a.totalMs),
    }
  }

  /** Release every session buffer (plugin dispose). */
  dispose(): void {
    const sessionIds = [...this.sessions.keys()]
    for (const sessionId of sessionIds) {
      const session = this.sessions.get(sessionId)
      if (session === undefined) continue
      for (const turn of [...session.turns]) this.evictTurn(session, turn)
    }
    this.sessions.clear()
    this.childToParent.clear()
    this.callOwners.clear()
    this.callNames.clear()
    this.totalRequests = 0
  }

  // ---------- eviction ----------

  private evictTurn(session: SessionRecord, turn: TurnRecord): void {
    session.turns = session.turns.filter(candidate => candidate !== turn)
    for (const [purpose, bucket] of session.buckets) {
      if (bucket === turn) session.buckets.delete(purpose)
    }
    if (session.openTurn === turn) session.openTurn = undefined
    for (const scope of turn.scopes.values()) {
      for (const request of scope.requests) {
        for (const block of request.blocks) {
          if (block.callId !== undefined) {
            this.callOwners.delete(block.callId)
            this.callNames.delete(block.callId)
          }
        }
        this.totalRequests -= 1
      }
    }
    // Pending delegation bindings are time-bracketed by their turn.
    const end = turn.endedAt ?? this.now()
    for (const [callId, pending] of session.pendingCalls) {
      if (pending.at >= turn.startedAt && pending.at <= end) session.pendingCalls.delete(callId)
    }
    this.onTurnEvicted?.(session.id, turn)
    // A session with nothing left releases its slot (and its child links).
    if (session.turns.length === 0) {
      this.sessions.delete(session.id)
      for (const [childId, parentId] of this.childToParent) {
        if (parentId === session.id) this.childToParent.delete(childId)
      }
    }
  }

  private turnIsLive(turn: TurnRecord): boolean {
    if (turn.endedAt === undefined && turn.purpose === undefined) return true
    for (const scope of turn.scopes.values()) {
      if (scope.requests.some(request => request.status === 'streaming')) return true
    }
    return false
  }

  private enforceCaps(): void {
    for (const session of this.sessions.values()) {
      while (session.turns.length > this.maxTurnsPerSession) {
        const victim = session.turns.find(turn => !this.turnIsLive(turn))
        if (victim === undefined) return
        this.evictTurn(session, victim)
      }
    }
    while (this.totalRequests > this.maxRequestsTotal) {
      let victim: { session: SessionRecord; turn: TurnRecord } | undefined
      for (const session of this.sessions.values()) {
        for (const turn of session.turns) {
          if (this.turnIsLive(turn)) continue
          if (victim === undefined
            || turn.startedAt < victim.turn.startedAt
            || (turn.startedAt === victim.turn.startedAt && turn.turnSeq < victim.turn.turnSeq)) {
            victim = { session, turn }
          }
        }
      }
      if (victim === undefined) return
      this.evictTurn(victim.session, victim.turn)
    }
    // Turn-less residue (a stray tool/call before any turn/start) frees its slot.
    for (const session of [...this.sessions.values()]) {
      if (session.turns.length === 0 && session.openTurn === undefined) {
        this.sessions.delete(session.id)
        for (const [childId, parentId] of this.childToParent) {
          if (parentId === session.id) this.childToParent.delete(childId)
        }
      }
    }
  }
}

/** The six-way timing split of one request, computed from its recorded spans. */
export function requestTiming(request: StoredRequest): RequestTiming {
  const closed = request.blocks.filter((block): block is BlockSpan & { end: number } => block.end !== undefined)
  const sum = (kind: string) => closed
    .filter(block => block.kind === kind)
    .reduce((n, block) => n + (block.end - block.start), 0)
  const closedExecs = request.execs.filter((exec): exec is ToolExecSpan & { end: number } => exec.end !== undefined)
  const toolExecMs = closedExecs.reduce((n, exec) => n + (exec.end - exec.start), 0)
  return {
    ...request.firstChunkAt === undefined ? {} : { waitMs: request.firstChunkAt - request.startedAt },
    ...closed.some(block => block.kind === 'reasoning') ? { reasoningMs: sum('reasoning') } : {},
    ...closed.some(block => block.kind === 'tool-call') ? { toolArgsMs: sum('tool-call') } : {},
    ...closed.some(block => block.kind === 'text') ? { textMs: sum('text') } : {},
    ...closedExecs.length > 0 ? { toolExecMs } : {},
    ...request.settledAt === undefined ? {} : { totalMs: request.settledAt - request.startedAt },
  }
}

const LANE_KIND: Record<string, TimingLane['kind']> = {
  reasoning: 'reasoning',
  'tool-call': 'tool-args',
  text: 'text',
}

/**
 * One request's lane partition of [startedAt, settledAt]: wait, then blocks in
 * time order, with the gaps between known activity as `other` lanes. Overlaps
 * clamp to the running cursor, so the lanes never double-count wall time.
 */
function requestLanes(request: StoredRequest): TimingLane[] {
  if (request.settledAt === undefined) return []
  const lanes: TimingLane[] = []
  const base = { requestSeq: request.seq, scopeId: request.scopeId }
  let cursor = request.startedAt
  const push = (kind: TimingLane['kind'], start: number, end: number, tool?: string) => {
    if (end <= start) return
    lanes.push({ kind, ...base, startedAt: start, durationMs: end - start, ...tool === undefined ? {} : { tool } })
  }
  if (request.firstChunkAt !== undefined && request.firstChunkAt > cursor) {
    push('wait', cursor, request.firstChunkAt)
    cursor = request.firstChunkAt
  }
  const closed = request.blocks
    .filter((block): block is BlockSpan & { end: number } => block.end !== undefined)
    .sort((a, b) => a.start - b.start)
  for (const block of closed) {
    const start = Math.max(block.start, cursor)
    if (start > cursor) push('other', cursor, start)
    push(LANE_KIND[block.kind] ?? 'other', start, Math.max(start, block.end), block.toolName)
    cursor = Math.max(cursor, block.end)
  }
  if (request.settledAt > cursor) push('other', cursor, request.settledAt)
  return lanes
}

/** `tool:hint`（如 `novel_read:chapter`）或「直接回答」— the 明细头锚点, from the response blocks. */
function summarizeResponse(request: StoredRequest): string {
  const calls = request.blocks.filter(block => block.kind === 'tool-call' && block.toolName !== undefined)
  if (calls.length > 0) {
    const first = calls[0] as BlockSpan
    const hint = toolHint(first.args)
    const name = first.toolName as string
    const suffix = calls.length > 1 ? ` +${calls.length - 1}` : ''
    return `tool:${name}${hint === undefined ? '' : `:${hint}`}${suffix}`
  }
  const hasText = request.blocks.some(block => block.kind === 'text')
  return hasText ? '直接回答' : ''
}

/**
 * The one-line argument hint behind `tool:name` — the reference
 * reconstruction's key order (what → file basename → for → description),
 * truncated so the summary stays one line.
 */
function toolHint(args: string | undefined): string | undefined {
  if (args === undefined) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(args)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const value = parsed as Record<string, unknown>
  const pick = (...keys: string[]): string | undefined => {
    for (const key of keys) {
      const candidate = value[key]
      if (typeof candidate === 'string' && candidate.length > 0) return candidate
    }
    return undefined
  }
  const what = pick('what')
  if (what !== undefined) return clip(what)
  const file = pick('file_path', 'path', 'filePath')
  if (file !== undefined) return clip(file.split('/').pop() ?? file)
  const purpose = pick('for')
  if (purpose !== undefined) return clip(purpose)
  const description = pick('description')
  return description === undefined ? undefined : clip(description)
}

/** One-line clip for hint values. */
function clip(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  return collapsed.length <= 40 ? collapsed : `${collapsed.slice(0, 39)}…`
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
