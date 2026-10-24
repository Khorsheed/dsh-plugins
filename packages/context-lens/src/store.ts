/**
 * The context-lens capture store: an in-memory ring of sessions → turns →
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
 * @module @khorsheed/dsh-context-lens/store
 */
import { countToolCalls } from './tool-summary.ts'
import type {
  AgentScopeOverview,
  BackfillInfo,
  CaptureOrigin,
  CapturedRequest,
  CapturedResponse,
  ListTurnsResult,
  SessionTrend,
  RequestConfig,
  RequestListItem,
  RequestTiming,
  RequestUsage,
  ResponseSummary,
  ScopeFilter,
  RequestLink,
  ScopedRefusal,
  SegmentItem,
  TimingLane,
  ToolTiming,
  TurnListItem,
  TurnOverview,
  TurnTiming,
} from './types.ts'
import { splitRequest, rebaseSegments, type CapturedToolSchema, type ScopeFingerprint, type AssemblyRecord } from './segmenter.ts'
import { AMBIENT_SOURCES, lastParagraph, previewLine, type CapturedMessage } from './messages.ts'
import type { LogTurn } from './log-lane.ts'
import { prefixTextChange } from './prefix-diff.ts'
import { diffRequests, type FactLookup, type ReplacementFact } from './changes.ts'
import { applyRoomEvent, emptyRoom, roomTurnSeq, runsOf, type RoomRun, type RoomState } from './room.ts'

/** Replacement facts kept per session; older facts only matter for requests long evicted. */
const REPLACEMENT_CAP = 2048

/** Retention knobs (InspectorConfig in the service mirrors these). */
export interface StoreConfig {
  /** Turns retained per session (oldest closed first, backfilled before live). Default 30. */
  maxTurnsPerSession?: number
  /** Log-reconstructed main-scope requests retained per session. Default 500. */
  maxBackfillRequestsPerSession?: number
  /**
   * Global budget of stored segment text characters across all sessions — the
   * real memory driver is the segments' `full` text (~200KB per request), not
   * the row count. Default 150M chars (~150MB).
   */
  maxStoredCharsTotal?: number
}

const DEFAULT_MAX_TURNS_PER_SESSION = 30
const DEFAULT_MAX_BACKFILL_REQUESTS_PER_SESSION = 500
const DEFAULT_MAX_STORED_CHARS_TOTAL = 150_000_000

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
  /**
   * text/reasoning content: delta-accumulated while streaming, overwritten by
   * the authoritative assembled block at block-end. This is what makes a
   * cancelled mid-block response partially visible.
   */
  text?: string
}

/** One tool execution interval attributed to the request that issued the call. */
export interface ToolExecSpan {
  callId: string
  name: string
  start: number
  end?: number
  isError?: boolean
  result?: string
}

/** A request row as the store keeps it — the wire shapes assemble on query. */
export interface StoredRequest {
  requestNumber?: number
  /** The request's own session turn (log lane): a member child's run is one of these. */
  hostTurn?: number
  seq: number
  sessionId: string
  scopeId: string
  turnSeq: number
  purpose?: string
  compaction?: CapturedRequest['compaction']
  startedAt: number
  status: 'streaming' | 'ok' | 'failed'
  error?: string
  config: RequestConfig
  usage?: RequestUsage
  responseSummary: ResponseSummary
  segments: CapturedRequest['segments']
  totalChars: number
  /** The response's own char weight (counted in the store budget, not in 请求体 totalChars). */
  responseChars?: number
  /** Execution result storage, excluded from request/input metrics. */
  executionChars?: number
  /** The request's own response, set at settle (see CapturedRequest.response). */
  response?: CapturedResponse
  firstChunkAt?: number
  settledAt?: number
  finishKind?: string
  blocks: BlockSpan[]
  execs: ToolExecSpan[]
  fingerprint: ScopeFingerprint
  /** Live capture preceded availability of its conversation-history baseline. */
  needsHistoryBaseline?: boolean
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
  /** Per-session 1-based ordinal in scope-creation order (the chip's `#N`). */
  scopeSeq: number
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
  /** The child's `subagent/descriptor` provider (`dsh-cli`, `codex-local`, …), once seen. */
  provider?: string
}

/** One turn row's internal record (exported for the eviction hook's signature). */
export interface TurnRecord {
  /**
   * The panel-facing address. Real turns key on the host's own turn number
   * (the `turn/start` payload — a stable per-session ordinal shared with the
   * log lane, so live-captured and log-reconstructed turns can never
   * duplicate); purpose pseudo-turns take negative addresses from the
   * session's bucket counter.
   */
  turnSeq: number
  /** The host's own turn number; absent on purpose pseudo-turns. */
  hostTurn?: number
  /** Purpose key on pseudo-turns (`compaction`, `session-title`, …). */
  purpose?: string
  /** True once any live (in-process) request or bracket landed here — backfill never merges into such a turn. */
  liveContent: boolean
  /** Capture observed the turn opening, so this turn’s live request order is complete. */
  liveStartObserved?: boolean
  /** A live turn that ended with no captured request has been compared with the log once. */
  logChecked?: boolean
  query: string
  /** A room round: the dispatch's targets (see room.ts). */
  room?: { targets: string[] }
  /** First non-human message of the turn (see LogTurn.trigger). */
  trigger?: { source: string; text: string }
  /** The `turn/start` event's log seq. */
  startSeq?: number
  startedAt: number
  endedAt?: number
  closingMessageId?: string
  scopes: Map<string, ScopeRecord>
}

/** The eviction hook's view of a turn (the log lane drops child cursors on it). */
export type EvictedTurn = TurnRecord

interface SessionRecord {
  id: string
  activeCompactions: Map<string, { id: string; hostTurn?: number }>
  prunings: Map<string, { beforeChars: number; afterChars: number }>
  /** Surface replacement facts by replacing id, and by each shadowed id (bounded). */
  replacements: Map<string, ReplacementFact>
  replacedBy: Map<string, ReplacementFact>
  turns: TurnRecord[]
  /** The bracket currently open; cleared (not deleted) at turn/end. */
  openTurn: TurnRecord | undefined
  /** purpose → its pseudo-turn. */
  buckets: Map<string, TurnRecord>
  /** The next bucket address (negative, descending — never collides with host turn numbers). */
  nextBucketSeq: number
  /** The next scope's per-session ordinal (creation order, 1-based). */
  nextScopeSeq: number
  /** Backfill watermark: retryable until 'complete', 'broken' stops retries. */
  backfillState: 'none' | 'partial' | 'complete' | 'broken'
  /** The decode failure summary while broken. */
  backfillReason: string | undefined
  /** Log-reconstructed main-scope requests currently held (per-session cap accounting). */
  backfilledRequests: number
  /** Pending tool/call rows by callId (exec starts + delegation binding). */
  pendingCalls: Map<string, PendingCall>
  /** messageId → producing request's generation ms (assistant row durations). */
  messageTurns: Map<string, number>
  messageDurations: Map<string, number>
  /** The latest settled purpose-less request — the assistant/message pairing heuristic. */
  lastSettledMain?: StoredRequest
  /** Turns evicted under the retention caps (the "collected then dropped" signal). */
  evictedTurns: number
  /** Agent-local next ordinal, retained independently of body eviction. */
  nextRequestNumbers: Map<string, number>
  /** When a panel last read this session — the least recently read yields its backfill first. */
  lastAccess: number
  /** The backfill window's newest host turn; absent means the latest turns. */
  windowEnd?: number
  /** First and last host turn the session's log holds (known after a backfill). */
  logRange?: { first: number; last: number }
  /** Every main turn's span, loaded or not (log + live): orders rounds and finds the time outside turns. */
  turnSpans: Map<number, { start: number; end?: number }>
  /** The room plugin's events, read structurally (room.ts). */
  room?: RoomState
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
  /** The instance epoch stamped on query results (restart invalidation); a mount-time id by default. */
  generation?: string
}

/**
 * Whether one scope passes a read's allow-list: unfiltered when the filter
 * carries no `scopes`, otherwise membership. Shared by the store's query
 * methods and the service's child-log gate.
 */
export function scopeAuthorized(scopeId: string, filter?: ScopeFilter): boolean {
  return filter?.scopes === undefined || filter.scopes.includes(scopeId)
}

/** The scope's fidelity marker for the wire; absent while it holds no captured content. */
function scopeOrigin(scope: ScopeRecord): CaptureOrigin | undefined {
  if (scope.logFilled) return 'log-reconstructed'
  if (scope.live || scope.requests.length > 0) return 'live'
  return undefined
}

/** The in-memory capture store. All mutation enters through the `note*`/`observe*` methods. */
export class InspectorStore {
  private readonly sessions = new Map<string, SessionRecord>()
  private readonly childToParent = new Map<string, string>()
  /** A session opened on its own that its log header names as a child (`parentSession`). */
  private readonly parents = new Map<string, NonNullable<ListTurnsResult['parent']>>()
  /** callId → the request whose response issued the call (exec attribution). */
  private readonly callOwners = new Map<string, StoredRequest>()
  private readonly callNames = new Map<string, string>()
  /** Recently observed rendered assemblies (system-section attribution). */
  private readonly assemblies: AssemblyRecord[] = []
  private readonly now: () => number
  private readonly onTurnEvicted: ((sessionId: string, turn: TurnRecord) => void) | undefined
  private readonly maxTurnsPerSession: number
  private readonly maxBackfillRequestsPerSession: number
  private readonly maxStoredCharsTotal: number
  /** The instance epoch stamped on every query result (restart invalidation). */
  private readonly generation: string
  private seqCounter = 0
  /** Stored segment text characters across all sessions (the memory driver). */
  private totalChars = 0

  constructor(config: StoreConfig = {}, deps: StoreDeps = {}) {
    this.maxTurnsPerSession = config.maxTurnsPerSession ?? DEFAULT_MAX_TURNS_PER_SESSION
    this.maxBackfillRequestsPerSession = config.maxBackfillRequestsPerSession ?? DEFAULT_MAX_BACKFILL_REQUESTS_PER_SESSION
    this.maxStoredCharsTotal = config.maxStoredCharsTotal ?? DEFAULT_MAX_STORED_CHARS_TOTAL
    this.now = deps.now ?? Date.now
    this.onTurnEvicted = deps.onTurnEvicted
    this.generation = deps.generation ?? `${this.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
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
        activeCompactions: new Map(),
        prunings: new Map(),
        replacements: new Map(),
        lastAccess: this.now(),
        turnSpans: new Map(),
        replacedBy: new Map(),
        openTurn: undefined,
        buckets: new Map(),
        nextBucketSeq: -1,
        nextScopeSeq: 1,
        backfillState: 'none',
        backfillReason: undefined,
        backfilledRequests: 0,
        pendingCalls: new Map(),
        messageTurns: new Map(),
        messageDurations: new Map(),
        evictedTurns: 0,
        nextRequestNumbers: new Map(),
      }
      this.sessions.set(id, record)
    }
    return record
  }

  /** Allocate one turn row; the caller sets the address (`turnSeq`) in `init`. */
  private mintTurn(session: SessionRecord, at: number, init: Partial<TurnRecord> & Pick<TurnRecord, 'turnSeq'>): TurnRecord {
    const turn: TurnRecord = {
      liveContent: false,
      query: '',
      startedAt: at,
      scopes: new Map(),
      ...init,
    }
    session.turns.push(turn)
    return turn
  }

  private mainScope(session: SessionRecord, turn: TurnRecord, at: number): ScopeRecord {
    let scope = turn.scopes.get('main')
    if (scope === undefined) {
      scope = {
        scopeId: 'main',
        scopeSeq: session.nextScopeSeq,
        kind: 'main',
        status: 'running',
        config: {},
        requests: [],
        startedAt: at,
        live: false,
        logFilled: false,
      }
      session.nextScopeSeq += 1
      turn.scopes.set('main', scope)
    }
    return scope
  }

  /** Observe durable compression boundaries without manufacturing model calls. */
  noteCompaction(sessionId: string, type: string, data: Record<string, unknown>): void {
    const session = this.session(this.rootOf(sessionId))
    const id = data['compactionId']
    if (typeof id !== 'string') return
    if (type === 'compaction/start') session.activeCompactions.set(sessionId, { id, ...typeof data['turn'] === 'number' ? { hostTurn: data['turn'] } : {} })
    if (type === 'compaction/end') session.activeCompactions.delete(sessionId)
    if (type === 'compaction/summary' || type === 'compaction/applied') {
      for (const turn of session.turns) for (const scope of turn.scopes.values()) for (const request of scope.requests) {
        if (request.compaction?.id !== id) continue
        if (Array.isArray(data['shadowedSeqs'])) request.compaction.replacedCount = data['shadowedSeqs'].length
        if (type === 'compaction/applied') request.compaction.applied = true
      }
    }
  }

  /** Preserve pruning metadata across later requests, with bounded observation state. */
  notePruning(sessionId: string, messageId: string, beforeChars: number, afterChars: number): void {
    const state = this.session(this.rootOf(sessionId)).prunings
    const key = `${sessionId}:${messageId}`
    if (afterChars >= beforeChars && !state.has(key)) return
    state.set(key, { beforeChars: state.get(key)?.beforeChars ?? beforeChars, afterChars })
    if (state.size > 512) state.delete(state.keys().next().value!)
  }

  /** Record one host surface replacement (live event or log backfill) for the change list. */
  noteReplacement(sessionId: string, fact: ReplacementFact): void {
    const session = this.session(this.rootOf(sessionId))
    session.replacements.set(fact.newId, fact)
    for (const id of fact.replacedIds) if (id !== fact.newId) session.replacedBy.set(id, fact)
    while (session.replacements.size > REPLACEMENT_CAP) session.replacements.delete(session.replacements.keys().next().value!)
    while (session.replacedBy.size > REPLACEMENT_CAP * 4) session.replacedBy.delete(session.replacedBy.keys().next().value!)
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
    const compaction = snapshot.purpose === 'compaction' ? session.activeCompactions.get(snapshot.sessionId) : undefined

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
      // lands in the same kind of bucket under 'ad-hoc' (and a turn/end that
      // later closes a pre-mount turn drains it — see turnEnd).
      const purpose = snapshot.purpose ?? 'ad-hoc'
      const bucketKey = compaction ? `${purpose}:${compaction.id}` : purpose
      let bucket = session.buckets.get(bucketKey)
      if (bucket === undefined) {
        bucket = this.mintTurn(session, startedAt, {
          purpose,
          query: purpose,
          turnSeq: session.nextBucketSeq,
        })
        session.nextBucketSeq -= 1
        session.buckets.set(bucketKey, bucket)
      }
      turn = bucket
      scopeId = 'main'
    } else {
      turn = session.openTurn
      scopeId = 'main'
    }

    const scope = scopeId === 'main'
      ? this.mainScope(session, turn, startedAt)
      : turn.scopes.get(scopeId)
    if (scope === undefined) return undefined

    // UI scopes belong to turns; the main agent's input history does not reset there.
    const previous = scope.previous ?? (snapshot.purpose === undefined
      ? this.previousRequest(session, scopeId, startedAt, this.seqCounter)?.fingerprint : undefined)

    const segments = splitRequest({
      messages: snapshot.messages.map(message => {
        const pruning = message.id === undefined ? undefined : session.prunings.get(`${snapshot.sessionId}:${message.id}`)
        return pruning === undefined ? message : { ...message, pruning }
      }),
      ...snapshot.systemSlot === undefined ? {} : { systemSlot: snapshot.systemSlot },
      ...snapshot.tools === undefined ? {} : { tools: snapshot.tools },
      context: {
        ...previous === undefined || snapshot.purpose === 'compaction' ? {} : { previous },
        assemblies: this.assemblies,
        resolveToolName: callId => this.callNames.get(callId),
        durationFor: messageId => session.messageDurations.get(messageId),
        turnFor: messageId => session.messageTurns.get(messageId),
      },
    })
    if (snapshot.purpose !== 'compaction') scope.previous = segments.fingerprint

    const request: StoredRequest = {
      seq: this.seqCounter,
      sessionId: rootId,
      scopeId: scope.scopeId,
      turnSeq: turn.turnSeq,
      ...snapshot.purpose === undefined ? {} : { purpose: snapshot.purpose },
      ...compaction === undefined ? {} : { compaction: { ...compaction } },
      startedAt,
      status: 'streaming',
      config: snapshot.config,
      responseSummary: { kind: snapshot.purpose === 'compaction' ? 'compaction' : 'none' },
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
      ...snapshot.purpose === undefined && previous === undefined ? { needsHistoryBaseline: true } : {},
    }
    this.seqCounter += 1
    // Auxiliary/purpose calls have no complete conversation-history baseline.
    const nextNumber = snapshot.purpose === undefined ? session.nextRequestNumbers.get(scopeId) : undefined
    if (nextNumber !== undefined) {
      request.requestNumber = nextNumber
      session.nextRequestNumbers.set(scopeId, nextNumber + 1)
    }
    scope.requests.push(request)
    turn.liveContent = true
    this.totalChars += request.totalChars
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
    if (built.purpose === undefined) found.scope.previous = built.fingerprint
    this.totalChars += request.totalChars
    this.attachResponse(request, built.response)
    this.accountExecutionResults(request)
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
    text?: string
    argumentsDelta?: string
    block?: { type: string; id?: string; name?: string; arguments?: string; text?: string }
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
      case 'text-delta':
      case 'reasoning-delta': {
        // Delta-accumulate so a cancelled mid-block response stays partially visible.
        const span = request.blocks.find(block => block.index === chunk.index && block.end === undefined)
        if (span === undefined || chunk.text === undefined) return
        span.text = (span.text ?? '') + chunk.text
        return
      }
      case 'tool-call-delta': {
        const span = request.blocks.find(block => block.index === chunk.index && block.end === undefined)
        if (span === undefined || chunk.argumentsDelta === undefined) return
        span.args = (span.args ?? '') + chunk.argumentsDelta
        return
      }
      case 'block-end': {
        const span = request.blocks.find(block => block.index === chunk.index && block.end === undefined)
        if (span === undefined) return
        span.end = at
        // The assembled block is authoritative over the accumulated deltas.
        if (chunk.block?.text !== undefined) span.text = chunk.block.text
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
    request.responseSummary = request.purpose === 'compaction' ? { kind: 'compaction' } : summarizeResponse(request)
    this.attachResponse(request, responseFromSpans(request.blocks))
    const session = this.sessions.get(request.sessionId)
    if (session !== undefined && request.purpose === undefined) {
      session.lastSettledMain = request
    }
  }

  /** Set the request's response and count its chars into the store budget. */
  private attachResponse(request: StoredRequest, response: CapturedResponse | undefined): void {
    if (response === undefined) return
    request.response = response
    const chars = responseSize(response)
    request.responseChars = chars
    this.totalChars += chars
  }

  private accountExecutionResults(request: StoredRequest): void {
    const chars = executionSize(request)
    this.totalChars += chars - (request.executionChars ?? 0)
    request.executionChars = chars
  }

  /** Incremental child folds mutate shared execution spans after insertion. */
  refreshExecutionResults(sessionId: string, scopeId: string): void {
    const session = this.sessions.get(sessionId)
    const scope = session && this.findScope(session, scopeId)?.scope
    for (const request of scope?.requests ?? []) this.accountExecutionResults(request)
    this.enforceCaps()
  }

  /** turn/start on a root session (child sessions route their events to the parent instead). */
  /** @param seq - the `turn/start` event's log seq (the chat's history-jump target). */
  turnStart(sessionId: string, hostTurn: number, at: number, seq?: number): void {
    const rootId = this.rootOf(sessionId)
    const session = this.session(rootId)
    const scopeId = sessionId === rootId ? 'main' : sessionId
    if (hostTurn === 1 && !session.nextRequestNumbers.has(scopeId)) session.nextRequestNumbers.set(scopeId, 1)
    if (this.isChild(sessionId)) return
    if (!session.turnSpans.has(hostTurn)) session.turnSpans.set(hostTurn, { start: at })
    if (session.openTurn !== undefined) return
    // The host turn number is the canonical address: a turn the log lane
    // already reconstructed reopens here rather than duplicating (defensive —
    // host numbers never repeat within one process).
    const existing = session.turns.find(turn => turn.hostTurn === hostTurn && turn.purpose === undefined)
    if (existing !== undefined) {
      session.openTurn = existing
      if (seq !== undefined) existing.startSeq = seq
      return
    }
    session.openTurn = this.mintTurn(session, at, { hostTurn, turnSeq: hostTurn, liveContent: true, liveStartObserved: true })
    if (seq !== undefined) session.openTurn.startSeq = seq
  }

  /** turn/end: close the open turn, resolve its main scope, sweep abandoned streams. */
  turnEnd(sessionId: string, hostTurn: number, reason: { kind: string; error?: { message: string } }, at: number): void {
    if (this.isChild(sessionId)) return
    const span = this.sessions.get(sessionId)?.turnSpans.get(hostTurn)
    if (span !== undefined) span.end = at
    const session = this.sessions.get(sessionId)
    if (session === undefined) return
    let turn = session.openTurn
    if (turn === undefined) {
      // The plugin mounted mid-turn: the open bracket predates the capture, so
      // the turn's live requests drifted into the ad-hoc bucket. Drain them
      // into a record for this host turn — the overlap rule (any live request
      // ⇒ fully live, the log lane never merges in) then holds for it.
      const bucket = session.buckets.get('ad-hoc')
      const drifted = bucket?.scopes.get('main')?.requests.filter(request => request.purpose === undefined) ?? []
      if (drifted.length === 0) return
      turn = this.mintTurn(session, at, { hostTurn, turnSeq: hostTurn, liveContent: true })
      const main = this.mainScope(session, turn, drifted[0]?.startedAt ?? at)
      for (const request of drifted) {
        request.turnSeq = turn.turnSeq
        main.requests.push(request)
      }
      const bucketScope = bucket?.scopes.get('main')
      if (bucket !== undefined && bucketScope !== undefined) {
        bucketScope.requests = bucketScope.requests.filter(request => !drifted.includes(request))
        if (bucketScope.requests.length === 0) {
          bucket.scopes.delete('main')
          session.buckets.delete('ad-hoc')
          session.turns = session.turns.filter(candidate => candidate !== bucket)
        }
      }
    }
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
    if (sourceKind !== 'user') {
      if (turn.trigger === undefined && !AMBIENT_SOURCES.has(sourceKind)) turn.trigger = { source: sourceKind, text: lastParagraph(text) }
      return
    }
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

  /** Source turns belong to session events, not the immutable message payload. */
  noteMessageTurn(sessionId: string, messageId: string, turn?: number): void {
    const root = this.childToParent.get(sessionId) ?? sessionId
    const session = this.sessions.get(root)
    const value = turn ?? session?.openTurn?.hostTurn
    if (session && value !== undefined) session.messageTurns.set(messageId, value)
  }

  /** tool/result: close the exec interval; resolve a delegation scope's outcome. */
  toolResult(sessionId: string, callId: string, isError: boolean, result: string, at: number): void {
    const rootId = this.rootOf(sessionId)
    const session = this.sessions.get(rootId)
    const owner = this.callOwners.get(callId)
    if (owner !== undefined) {
      const span = owner.execs.find(exec => exec.callId === callId && exec.end === undefined)
      if (span !== undefined) {
        span.end = at
        span.isError = isError
        span.result = result
        this.accountExecutionResults(owner)
        this.enforceCaps()
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
    if (isError) scope.error = previewLine(result)
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
    // A child started outside any turn (a room member a human addressed) has
    // no turn of its own: it waits in the hidden holder, read by room rounds.
    const turn = session.openTurn ?? this.holderTurn(session, at)
    const scope: ScopeRecord = {
      scopeId,
      scopeSeq: session.nextScopeSeq,
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
    session.nextScopeSeq += 1
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

  // ---------- history backfill ----------

  /** The session's backfill watermark (retryable until 'complete'). */
  backfillState(sessionId: string): BackfillInfo['state'] {
    return this.sessions.get(sessionId)?.backfillState ?? 'none'
  }

  /** A durably unreadable log stops the backfill from retrying it on every query. */
  markBackfillBroken(sessionId: string, reason: string): void {
    const session = this.session(sessionId)
    session.backfillState = 'broken'
    session.backfillReason = reason
  }

  /**
   * Insert log-reconstructed turns (the pre-mount history), newest-first within
   * budget: live-content turns win the budget outright, a host turn with any
   * record is never merged into (the overlap rule), and one oversized turn is
   * SKIPPED without aborting the older ones. Scope ordinals are renumbered
   * afterwards so the chips' `#N` stay chronological across the live/backfill
   * boundary (scopeSeq is a display anchor, not an address).
   *
   * The watermark is honest: 'complete' only when every candidate fit; a
   * budget-dropped candidate keeps the state 'partial', and the service
   * re-reads the log on later queries (eviction may have freed room). The
   * insert itself never evicts a live turn: char pressure evicts the oldest
   * BACKFILLED turns first.
   *
   * @returns the number of turns actually inserted.
   */
  insertLogTurns(sessionId: string, logTurns: readonly LogTurn[]): number {
    const session = this.session(sessionId)
    session.lastAccess = this.now()
    this.reconcileRequestNumbers(session, logTurns)
    const hosts = logTurns.filter(turn => turn.purpose === undefined).map(turn => turn.hostTurn)
    if (hosts.length > 0) session.logRange = { first: Math.min(...hosts), last: Math.max(...hosts) }
    for (const turn of logTurns) {
      if (turn.purpose === undefined) session.turnSpans.set(turn.hostTurn, { start: turn.startedAt, ...turn.endedAt === undefined ? {} : { end: turn.endedAt } })
    }
    // Children started outside any turn always load: room rounds read them whatever the window.
    for (const holder of logTurns.filter(turn => turn.purpose === 'room-members')) {
      const target = this.holderTurn(session, holder.startedAt)
      for (const delegation of holder.delegations) {
        if (delegation.childId === undefined || this.findScope(session, delegation.childId) === undefined) this.addDelegationScope(session, target, delegation)
      }
    }
    // A live turn that captured nothing (an external agent's session: its
    // requests reach only the log) takes the log's turn once it has ended.
    for (const empty of this.emptyLiveTurns(session)) {
      const logged = logTurns.find(turn => turn.purpose === undefined && turn.hostTurn === empty.hostTurn)
      if (logged === undefined || logged.endedAt === undefined) continue
      empty.logChecked = true
      if (logged.requests.length === 0) continue
      const startSeq = empty.startSeq
      this.evictTurn(session, empty, false)
      this.insertLogTurn(session, logged)
      const placed = session.turns.find(turn => turn.hostTurn === logged.hostTurn && turn.purpose === undefined)
      if (placed !== undefined && placed.startSeq === undefined && startSeq !== undefined) placed.startSeq = startSeq
      this.renumberScopes(session)
    }
    if (session.backfillState === 'complete' || session.backfillState === 'broken') return 0
    const keep = this.windowOf(session, hosts)
    const window = logTurns.filter(turn => turn.purpose === undefined && keep.has(turn.hostTurn))
    if (window.length === 0) {
      session.backfillState = 'complete'
      return 0
    }
    const lo = Math.min(...window.map(turn => turn.hostTurn)), hi = Math.max(...window.map(turn => turn.hostTurn))
    const startAt = window.find(turn => turn.hostTurn === lo)!.startedAt
    const nextAfter = logTurns.filter(turn => turn.purpose === undefined && turn.hostTurn > hi).sort((x, y) => x.hostTurn - y.hostTurn)[0]?.startedAt ?? Number.POSITIVE_INFINITY
    // Purpose calls (compactions) ride with the window's turns: by their host turn, else by time.
    const inWindow = (turn: LogTurn): boolean => {
      if (turn.purpose === 'room-members') return false
      if (turn.purpose === undefined) return turn.hostTurn >= lo && turn.hostTurn <= hi
      const host = turn.requests[0]?.compaction?.hostTurn
      return host !== undefined ? host >= lo && host <= hi : turn.startedAt >= startAt && turn.startedAt < nextAfter
    }
    const candidates = logTurns.filter(logTurn => inWindow(logTurn) &&
      !session.turns.some(turn => logTurn.purpose === undefined
        ? turn.purpose === undefined && turn.hostTurn === logTurn.hostTurn
        : [...turn.scopes.values()].some(scope => scope.requests.some(request => request.compaction?.id === logTurn.requests[0]?.compaction?.id))))
    let dropped = 0
    let inserted = 0
    // Newest-first. The loaded turns stay one contiguous run, so the unloaded
    // ones are always older and paging back makes progress: the first turn
    // that does not fit ends the fill — unless nothing fit yet, when it is
    // skipped so one oversized turn cannot pin the window.
    const stop = (i: number): boolean => {
      if (inserted === 0) { dropped += 1; return false }
      dropped += i + 1
      return true
    }
    for (let i = candidates.length - 1; i >= 0; i -= 1) {
      const candidate = candidates[i] as LogTurn
      const candidateChars = candidate.requests.reduce((n, request) => n + request.totalChars + executionSize(request) + responseSize(request.response), 0)
      if (candidate.requests.length > this.maxBackfillRequestsPerSession - session.backfilledRequests) {
        if (stop(i)) break
        continue
      }
      // Within a session a candidate never displaces a present turn (it is
      // older than anything already inserted). Across sessions, the backfill
      // of the least recently read session yields its room first.
      if (this.totalChars + candidateChars > this.maxStoredCharsTotal) this.freeChars(session, candidateChars)
      if (this.totalChars + candidateChars > this.maxStoredCharsTotal) {
        if (stop(i)) break
        continue
      }
      this.insertLogTurn(session, candidate)
      inserted += 1
    }
    session.backfillState = dropped > 0 ? 'partial' : 'complete'
    if (inserted > 0) this.renumberScopes(session)
    return inserted
  }

  /**
   * The backfill window over a log's host turns: the newest
   * `maxTurnsPerSession` at or before the window's end. At the latest, live
   * turns the log does not hold yet take window slots too. The log lane
   * materializes only these turns' requests.
   */
  windowHosts(sessionId: string, hosts: readonly number[]): Set<number> {
    return this.windowOf(this.session(sessionId), hosts)
  }

  private windowOf(session: SessionRecord, hosts: readonly number[]): Set<number> {
    const end = session.windowEnd ?? Number.POSITIVE_INFINITY
    const logged = new Set(hosts)
    const liveAhead = session.windowEnd === undefined
      ? session.turns.filter(turn => turn.liveContent && turn.hostTurn !== undefined && !logged.has(turn.hostTurn)).length : 0
    return new Set([...logged].filter(host => host <= end).sort((x, y) => y - x).slice(0, Math.max(0, this.maxTurnsPerSession - liveAhead)))
  }

  /**
   * Make room for `needed` chars by evicting other sessions' backfilled
   * turns, least recently read session first, oldest turn first. Live
   * content never yields. A session that lost backfill re-reads it when next
   * read (its state drops back to partial).
   */
  private freeChars(current: SessionRecord, needed: number): void {
    const others = [...this.sessions.values()].filter(other => other !== current).sort((x, y) => x.lastAccess - y.lastAccess)
    for (const other of others) {
      const victims = other.turns.filter(turn => !turn.liveContent && !this.turnIsLive(turn)).sort((x, y) => x.startedAt - y.startedAt)
      for (const victim of victims) {
        if (this.totalChars + needed <= this.maxStoredCharsTotal) return
        this.evictTurn(other, victim, false)
        if (other.backfillState === 'complete') other.backfillState = 'partial'
      }
    }
  }

  /**
   * Move a session's backfill window: drop its backfilled turns (live turns
   * stay) and let the next read refill the window ending at `end` (the
   * latest turns when absent).
   */
  setWindow(sessionId: string, end: number | undefined): void {
    const session = this.session(sessionId)
    if (end === undefined) delete session.windowEnd
    else session.windowEnd = end
    for (const turn of [...session.turns]) {
      if (!turn.liveContent && !this.turnIsLive(turn)) this.evictTurn(session, turn, false)
    }
    if (session.backfillState !== 'broken') session.backfillState = 'none'
  }

  /** A complete log can anchor live turns without retaining old request bodies. */
  private reconcileRequestNumbers(session: SessionRecord, logTurns: readonly LogTurn[]): void {
    for (const logged of logTurns) {
      if (logged.purpose !== undefined) continue
      const live = session.turns.find(t => t.hostTurn === logged.hostTurn && t.purpose === undefined && t.liveStartObserved)
      const first = logged.requests[0]?.requestNumber
      if (!live || first === undefined) continue
      const requests = live.scopes.get('main')?.requests ?? []
      for (let i = 0; i < requests.length; i++) requests[i]!.requestNumber ??= first + i
    }
    // An older partial live turn need not prevent a later, fully anchored turn
    // from continuing. Only the latest observed request must have a number.
    const liveTurns = session.turns.filter(t => t.liveContent && t.purpose === undefined)
      .sort((a, b) => a.startedAt - b.startedAt || a.turnSeq - b.turnSeq)
    const liveRequests = liveTurns.flatMap(t => t.scopes.get('main')?.requests ?? [])
    if (liveRequests.length && liveRequests.at(-1)?.requestNumber === undefined) return
    let next = session.nextRequestNumbers.get('main')
    for (const r of [...logTurns.flatMap(t => t.requests), ...liveRequests]) {
      if (r.requestNumber !== undefined) next = Math.max(next ?? 1, r.requestNumber + 1)
    }
    if (next !== undefined) session.nextRequestNumbers.set('main', next)
  }

  /** Retry numbering after a streaming turn’s first durable response becomes available. */
  /** Ended live main turns with no request in any view, not yet compared with the log. */
  private emptyLiveTurns(session: SessionRecord): TurnRecord[] {
    return session.turns.filter(turn => turn.liveContent && turn.purpose === undefined && turn.hostTurn !== undefined
      && turn.endedAt !== undefined && turn !== session.openTurn && !turn.logChecked
      && [...turn.scopes.values()].every(scope => scope.requests.length === 0))
  }

  /** Whether a read should re-read the log for live turns that captured nothing. */
  needsLogTurns(sessionId: string): boolean {
    const session = this.sessions.get(sessionId)
    return session !== undefined && this.emptyLiveTurns(session).length > 0
  }

  needsRequestNumbers(sessionId: string): boolean {
    return this.sessions.get(sessionId)?.turns.some(t => t.liveStartObserved && (t.scopes.get('main')?.requests.some(r => r.purpose === undefined && r.requestNumber === undefined) ?? false)) ?? false
  }

  /** One reconstructed turn → one TurnRecord (main scope + delegation stubs). */
  private insertLogTurn(session: SessionRecord, logTurn: LogTurn): void {
    const turn = this.mintTurn(session, logTurn.startedAt, {
      ...logTurn.purpose === undefined ? { hostTurn: logTurn.hostTurn } : { purpose: logTurn.purpose },
      turnSeq: logTurn.purpose === undefined ? logTurn.hostTurn : session.nextBucketSeq--,
      query: logTurn.query,
    })
    if (logTurn.trigger !== undefined) turn.trigger = logTurn.trigger
    if (logTurn.startSeq !== undefined) turn.startSeq = logTurn.startSeq
    if (logTurn.closingMessageId !== undefined) turn.closingMessageId = logTurn.closingMessageId
    const lastSettled = logTurn.requests.reduce<number | undefined>(
      (latest, request) => request.settledAt !== undefined && (latest === undefined || request.settledAt > latest)
        ? request.settledAt
        : latest,
      undefined,
    )
    // A turn the log never closed (a crash) reads as failed/interrupted, and
    // still gets an end time so eviction treats it as closed.
    turn.endedAt = logTurn.endedAt ?? lastSettled ?? logTurn.startedAt
    const mainStatus: ScopeRecord['status'] =
      logTurn.endReasonKind === 'completed' || logTurn.endReasonKind === 'max-tokens' ? 'ok' : 'failed'
    const main: ScopeRecord = {
      scopeId: 'main',
      scopeSeq: 0, // renumbered after the insert
      kind: 'main',
      status: mainStatus,
      // The scope's config line comes from its first request's header.
      config: logTurn.requests[0]?.config ?? {},
      requests: [],
      startedAt: logTurn.startedAt,
      endedAt: turn.endedAt,
      live: false,
      logFilled: true,
    }
    if (mainStatus === 'failed') {
      main.error = logTurn.endReasonKind === undefined
        ? 'interrupted (no turn/end in the log)'
        : (logTurn.endError ?? logTurn.endReasonKind)
    }
    turn.scopes.set('main', main)
    for (const built of logTurn.requests) {
      const request: StoredRequest = {
        ...built,
        seq: this.seqCounter,
        sessionId: session.id,
        scopeId: 'main',
        turnSeq: turn.turnSeq,
      }
      this.seqCounter += 1
      main.requests.push(request)
      this.totalChars += request.totalChars
      session.backfilledRequests += 1
      this.attachResponse(request, built.response)
      this.accountExecutionResults(request)
    }
    for (const delegation of logTurn.delegations) this.addDelegationScope(session, turn, delegation)
  }

  /** One reconstructed delegation → its child scope on `turn`. */
  private addDelegationScope(session: SessionRecord, turn: TurnRecord, delegation: LogTurn['delegations'][number]): void {
    const scopeId = delegation.childId ?? `call:${delegation.callId}`
    if (delegation.childId !== undefined) this.childToParent.set(delegation.childId, session.id)
    const label = delegation.catalogLabel ?? delegation.label
    const scope: ScopeRecord = {
      scopeId,
      scopeSeq: 0,
      kind: 'subagent',
      ...label === undefined ? {} : { label },
      // A catalog-only child has no tool/result to judge it by; no evidence of failure is not failure.
      status: delegation.callId === '' ? 'ok' : delegation.isError === true || delegation.resultAt === undefined ? 'failed' : 'ok',
      ...delegation.isError === true && delegation.errorPreview !== undefined
        ? { error: delegation.errorPreview }
        : delegation.resultAt === undefined && delegation.callId !== '' ? { error: 'no tool/result in the log' } : {},
      config: {},
      requests: [],
      startedAt: delegation.at,
      ...delegation.resultAt === undefined ? {} : { endedAt: delegation.resultAt },
      live: false,
      logFilled: false,
      ...delegation.callId === '' ? {} : { callId: delegation.callId },
    }
    turn.scopes.set(scopeId, scope)
  }

  /** The hidden turn holding children started outside any turn (never listed; room rounds read it). */
  private holderTurn(session: SessionRecord, at: number): TurnRecord {
    const found = session.turns.find(turn => turn.purpose === 'room-members')
    if (found !== undefined) return found
    const turn = this.mintTurn(session, at, { purpose: 'room-members', query: '', turnSeq: session.nextBucketSeq })
    session.nextBucketSeq -= 1
    return turn
  }

  /** Renumber one session's scope ordinals chronologically (turn order, then creation order). */
  private renumberScopes(session: SessionRecord): void {
    let next = 1
    const ordered = [...session.turns].sort((a, b) => a.startedAt - b.startedAt || a.turnSeq - b.turnSeq)
    for (const turn of ordered) {
      for (const scope of turn.scopes.values()) {
        scope.scopeSeq = next
        next += 1
      }
    }
  }

  // ---------- queries ----------

  /**
   * Light turn list of one session plus its backfill watermark (sorted newest
   * last). A {@link ScopeFilter} restricts every aggregate to the authorized
   * scopes; the turn rows themselves (query preview, timestamps) are
   * session-level metadata and stay listed.
   */
  listTurns(sessionId: string, filter?: ScopeFilter): ListTurnsResult {
    const session = this.sessions.get(sessionId)
    if (session !== undefined) session.lastAccess = this.now()
    const backfill: BackfillInfo = session === undefined
      ? { state: 'none' }
      : {
        state: session.backfillState,
        ...session.backfillReason === undefined ? {} : { reason: session.backfillReason },
      }
    if (session === undefined) return { turns: [], backfill, generation: this.generation, ...this.parents.has(sessionId) ? { parent: this.parents.get(sessionId)! } : {} }
    const ordinals = this.ordinals(session)
    const listed = [...session.turns, ...this.roomTurns(session, filter)]
      .filter(turn => turn.purpose !== 'room-members' && this.attachedTurn(session, turn) === undefined)
      .sort((a, b) => a.startedAt - b.startedAt || a.turnSeq - b.turnSeq)
    const handoffs = (session.room?.handoffs ?? []).map(h => ({ at: h.at, name: session.room!.members.get(h.memberId) ?? h.memberId }))
    return {
      turns: listed.map(turn => {
        const item = this.turnItem(sessionId, turn, filter)
        const ordinal = ordinals.get(turn.hostTurn !== undefined ? `h${turn.hostTurn}` : `t${turn.turnSeq}`)
        return ordinal === undefined ? item : { ...item, ordinal }
      }),
      backfill,
      total: ordinals.size,
      unloaded: this.unloadedRuns(session, ordinals),
      ...handoffs.length === 0 ? {} : { handoffs },
      generation: this.generation,
      ...this.parents.has(sessionId) ? { parent: this.parents.get(sessionId)! } : {},
      ...session.logRange === undefined ? {} : { range: session.logRange },
      ...session.evictedTurns === 0 ? {} : { evictedTurnCount: session.evictedTurns },
      ...filter?.scopes === undefined ? {} : { authorizedScopes: this.authorizedScopes(session, filter) },
    }
  }

  /** The session's existing scopes that pass the filter (turn order, then creation order). */
  private authorizedScopes(session: SessionRecord, filter: ScopeFilter): readonly string[] {
    const allowed = new Set(filter.scopes)
    const out: string[] = []
    for (const turn of [...session.turns].sort((a, b) => a.startedAt - b.startedAt || a.turnSeq - b.turnSeq)) {
      for (const scope of turn.scopes.values()) {
        if (allowed.has(scope.scopeId) && !out.includes(scope.scopeId)) out.push(scope.scopeId)
      }
    }
    return out
  }

  private turnItem(sessionId: string, turn: TurnRecord, filter?: ScopeFilter): TurnListItem {
    let requestCount = 0
    let scopeCount = 0
    let failedScopeCount = 0
    let totalInputTokens = 0
    let totalOutputTokens = 0
    for (const scope of turn.scopes.values()) {
      if (!scopeAuthorized(scope.scopeId, filter)) continue
      scopeCount += 1
      requestCount += scope.requests.length
      if (scope.status === 'failed') failedScopeCount += 1
      for (const request of scope.requests) {
        // The usage buckets are disjoint: the turn total counts all three.
        totalInputTokens += (request.usage?.inputTokens ?? 0)
          + (request.usage?.cacheReadTokens ?? 0)
          + (request.usage?.cacheWriteTokens ?? 0)
        totalOutputTokens += request.usage?.outputTokens ?? 0
      }
    }
    return {
      sessionId,
      turnSeq: turn.turnSeq,
      ...turn.hostTurn === undefined ? {} : { hostTurn: turn.hostTurn },
      query: turn.query,
      ...turn.query === '' && turn.trigger !== undefined ? { trigger: turn.trigger } : {},
      ...turn.room === undefined ? {} : { room: turn.room },
      ...turn.startSeq === undefined ? {} : { startSeq: turn.startSeq },
      startedAt: turn.startedAt,
      ...turn.endedAt === undefined ? {} : { endedAt: turn.endedAt },
      requestCount,
      scopeCount,
      failedScopeCount,
      totalInputTokens,
      totalOutputTokens,
      origin: turn.liveContent ? 'live' : 'log-reconstructed',
      ...turn.closingMessageId === undefined ? {} : { closingMessageId: turn.closingMessageId },
    }
  }

  /** One turn's scope/request overview, without segments. */
  getTurn(sessionId: string, turnSeq: number, filter?: ScopeFilter): TurnOverview | undefined {
    const session = this.sessions.get(sessionId)
    if (session !== undefined) session.lastAccess = this.now()
    const turn = session === undefined ? undefined : this.findTurn(session, turnSeq, filter)
    if (session === undefined || turn === undefined) return undefined
    const item = this.turnItem(sessionId, turn, filter)
    const scopes: AgentScopeOverview[] = [...turn.scopes.values()]
      .filter(scope => scopeAuthorized(scope.scopeId, filter))
      .map(scope => this.scopeOverview(session, turn, scope))
    // Compactions attach to the turn they happened in, as one more view beside the agents.
    if (turn.hostTurn !== undefined && scopeAuthorized('main', filter)) {
      for (const pseudo of session.turns) {
        if (this.attachedTurn(session, pseudo) !== turn) continue
        for (const scope of pseudo.scopes.values()) scopes.push(this.scopeOverview(session, pseudo, scope))
      }
    }
    return {
      turn: item,
      scopes,
      generation: this.generation,
      ...filter?.scopes === undefined ? {} : { authorizedScopes: scopes.map(scope => scope.scopeId) },
    }
  }

  /** Record one `room/*` event of a main session (log backfill or live). */
  noteRoomEvent(sessionId: string, type: string, data: unknown, seq: number | undefined, at: number | undefined): void {
    if (this.isChild(sessionId) || !type.startsWith('room/')) return
    const session = this.session(sessionId)
    session.room ??= emptyRoom()
    applyRoomEvent(session.room, type, data, seq, at)
  }

  /** A listed turn or a room round, by its panel address. */
  private findTurn(session: SessionRecord, turnSeq: number, filter?: ScopeFilter): TurnRecord | undefined {
    return session.turns.find(candidate => candidate.turnSeq === turnSeq)
      ?? (turnSeq < -999_999 ? this.roomTurns(session, filter).find(candidate => candidate.turnSeq === turnSeq) : undefined)
  }

  /** Whether a moment falls inside some main turn (loaded or not). */
  private insideMainTurn(session: SessionRecord, at: number): boolean {
    for (const span of session.turnSpans.values()) {
      if (at >= span.start && at <= (span.end ?? Number.POSITIVE_INFINITY)) return true
    }
    return false
  }

  /**
   * Every human room dispatch made outside a main turn, as a round: the
   * dispatch's message, and per member run the child session's requests of
   * that run (its recorded child turn, else the run's time span). Built on
   * read from the room state and the children's scopes; nothing is stored.
   */
  private roomTurns(session: SessionRecord, filter?: ScopeFilter): TurnRecord[] {
    const room = session.room
    if (room === undefined) return []
    return room.dispatches.filter(dispatch => !this.insideMainTurn(session, dispatch.at)).map((dispatch): TurnRecord => {
      const scopes = new Map<string, ScopeRecord>()
      const runs = runsOf(room, dispatch.seq)
      for (const run of runs) {
        const child = this.childOfRun(session, run)
        if (child !== undefined && !scopeAuthorized(child.scopeId, filter)) continue
        // The child's own scope id: its requests open by that id from any view.
        const scopeId = child?.scopeId ?? `room:${dispatch.seq}:${run.memberId}`
        const from = (run.startedAt ?? dispatch.at) - 2000, to = (run.endedAt ?? this.now()) + 2000
        const requests = (child?.requests ?? []).filter(request => run.childTurn !== undefined && request.hostTurn !== undefined
          ? request.hostTurn === run.childTurn
          : request.startedAt >= from && request.startedAt <= to)
        scopes.set(scopeId, {
          scopeId,
          scopeSeq: child?.scopeSeq ?? 0,
          kind: 'subagent',
          label: run.member ?? room.members.get(run.memberId) ?? child?.label ?? run.memberId,
          ...child?.provider === undefined ? {} : { provider: child.provider },
          status: run.state === 'failed' ? 'failed' : run.state === 'done' ? 'ok' : 'running',
          config: child?.config ?? {},
          requests,
          startedAt: run.startedAt ?? dispatch.at,
          ...run.endedAt === undefined ? {} : { endedAt: run.endedAt },
          live: false,
          logFilled: true,
        })
      }
      const ends = runs.map(run => run.endedAt).filter((end): end is number => end !== undefined)
      return {
        turnSeq: roomTurnSeq(dispatch.seq),
        purpose: 'room',
        query: dispatch.text,
        room: { targets: dispatch.targets },
        startedAt: dispatch.at,
        ...ends.length === 0 ? {} : { endedAt: Math.max(...ends) },
        liveContent: false,
        scopes,
      }
    })
  }

  /** The child session a run went to: named by the run, else the child catalogued closest to the run's start. */
  private childOfRun(session: SessionRecord, run: RoomRun): ScopeRecord | undefined {
    if (run.childSessionId !== undefined) {
      const named = this.findScope(session, run.childSessionId)?.scope
      if (named !== undefined) return named
    }
    if (run.startedAt === undefined) return undefined
    let best: ScopeRecord | undefined
    for (const turn of session.turns) for (const scope of turn.scopes.values()) {
      if (scope.kind !== 'subagent' || Math.abs(scope.startedAt - run.startedAt) > 10_000) continue
      if (best === undefined || Math.abs(scope.startedAt - run.startedAt) < Math.abs(best.startedAt - run.startedAt)) best = scope
    }
    return best
  }

  /**
   * One numbering for the whole session, by time: every main turn (loaded or
   * not) and every room round. Keys: `h<hostTurn>` for main turns,
   * `t<turnSeq>` for room rounds.
   */
  private ordinals(session: SessionRecord): Map<string, number> {
    const units: { key: string; at: number; host: number }[] = []
    const hosts = new Set<number>()
    for (const [host, span] of session.turnSpans) { units.push({ key: `h${host}`, at: span.start, host }); hosts.add(host) }
    for (const turn of session.turns) {
      if (turn.hostTurn !== undefined && !hosts.has(turn.hostTurn)) units.push({ key: `h${turn.hostTurn}`, at: turn.startedAt, host: turn.hostTurn })
    }
    for (const round of this.roomTurns(session)) units.push({ key: `t${round.turnSeq}`, at: round.startedAt, host: Number.POSITIVE_INFINITY })
    units.sort((a, b) => a.at - b.at || a.host - b.host)
    return new Map(units.map((unit, i) => [unit.key, i + 1]))
  }

  /** Runs of main turns the log holds but the store has not loaded, in ordinals, with their host-turn ends. */
  private unloadedRuns(session: SessionRecord, ordinals: Map<string, number>): NonNullable<ListTurnsResult['unloaded']> {
    const loaded = new Set(session.turns.filter(turn => turn.hostTurn !== undefined).map(turn => turn.hostTurn!))
    const missing = [...session.turnSpans.keys()].filter(host => !loaded.has(host))
      .map(host => ({ host, ordinal: ordinals.get(`h${host}`)! })).sort((a, b) => a.ordinal - b.ordinal)
    const out: NonNullable<ListTurnsResult['unloaded']> = []
    for (const { host, ordinal } of missing) {
      const last = out.at(-1)
      if (last !== undefined && last.to === ordinal - 1) { last.to = ordinal; last.lastHost = host }
      else out.push({ from: ordinal, to: ordinal, firstHost: host, lastHost: host })
    }
    return out
  }

  /** A compaction pseudo-turn's host turn: the one it started in, else the next turn to begin; undefined for any other turn. */
  private attachedTurn(session: SessionRecord, turn: TurnRecord): TurnRecord | undefined {
    if (turn.purpose !== 'compaction') return undefined
    const real = session.turns.filter(t => t.hostTurn !== undefined).sort((a, b) => a.startedAt - b.startedAt)
    const hostTurn = [...turn.scopes.values()].flatMap(scope => scope.requests).find(r => r.compaction?.hostTurn !== undefined)?.compaction?.hostTurn
    return (hostTurn === undefined ? undefined : real.find(t => t.hostTurn === hostTurn))
      ?? real.find(t => t.startedAt >= turn.startedAt) ?? real.at(-1)
  }

  /** Where the panel addresses a request: compaction requests live in their host turn's `compaction:` view. */
  private addressOf(session: SessionRecord, request: StoredRequest): RequestLink {
    const pseudo = session.turns.find(t => t.turnSeq === request.turnSeq)
    const host = pseudo === undefined ? undefined : this.attachedTurn(session, pseudo)
    return {
      turnSeq: host?.turnSeq ?? request.turnSeq,
      scopeId: host === undefined ? request.scopeId : `compaction:${request.turnSeq}`,
      seq: request.seq,
      ...request.requestNumber === undefined ? {} : { requestNumber: request.requestNumber },
    }
  }

  private scopeOverview(session: SessionRecord, turn: TurnRecord, scope: ScopeRecord): AgentScopeOverview {
    const origin = scopeOrigin(scope)
    const host = this.attachedTurn(session, turn)
    const scopeId = host === undefined ? scope.scopeId : `compaction:${turn.turnSeq}`
    const main = turn.scopes.get('main')
    const delegator = scope.callId === undefined ? undefined
      : main?.requests.find(r => r.response?.toolCalls.some(call => call.callId === scope.callId))
    const compaction = host === undefined ? undefined : scope.requests.find(r => r.compaction !== undefined)?.compaction
    const after = host === undefined ? undefined : host.scopes.get('main')?.requests
      .filter(r => r.startedAt <= turn.startedAt).sort((a, b) => b.startedAt - a.startedAt)[0]
    return {
      scopeId,
      scopeSeq: scope.scopeSeq,
      kind: host !== undefined ? 'compaction' : scope.kind,
      ...scope.label === undefined ? {} : { label: scope.label },
      ...scope.provider === undefined ? {} : { provider: scope.provider },
      ...delegator === undefined ? {} : { delegatedBy: this.addressOf(session, delegator) },
      ...compaction === undefined ? {} : { compaction: {
        ...compaction.replacedCount === undefined ? {} : { replacedCount: compaction.replacedCount },
        ...after === undefined ? {} : { after: this.addressOf(session, after) },
        ...compaction.hostTurn === undefined ? { betweenTurns: true } : {},
      } },
      status: scope.status,
      ...scope.error === undefined ? {} : { error: scope.error },
      config: scope.config,
      startedAt: scope.startedAt,
      ...scope.endedAt === undefined ? {} : { endedAt: scope.endedAt },
      ...origin === undefined ? {} : { origin },
      requests: scope.requests.map((request): RequestListItem => ({
        seq: request.seq,
        ...request.requestNumber === undefined ? {} : { requestNumber: request.requestNumber },
        scopeId,
        status: request.status,
        config: request.config,
        responseSummary: request.responseSummary,
        startedAt: request.startedAt,
        ...request.usage === undefined ? {} : { usage: request.usage },
        ...request.settledAt === undefined ? {} : { totalMs: request.settledAt - request.startedAt },
        ...request.compaction?.inputPartial ? { timingApproximate: true } : {},
        totalChars: request.totalChars,
        toolErrors: request.execs.filter(exec => exec.isError).length,
      })),
    }
  }

  /** Record the child's provider from its `subagent/descriptor` (live child events or its log). */
  noteChildProvider(childId: string, provider: string): void {
    const root = this.childToParent.get(childId)
    const session = root === undefined ? undefined : this.sessions.get(root)
    const found = session === undefined ? undefined : this.findScope(session, childId)
    if (found !== undefined) found.scope.provider = provider
  }

  /** A session opened on its own that is some other session's child. */
  noteParent(sessionId: string, parent: NonNullable<ListTurnsResult['parent']>): void {
    this.parents.set(sessionId, parent)
  }

  /** Whether a child's parent link is already known (the service resolves it once). */
  hasParent(sessionId: string): boolean {
    return this.parents.has(sessionId)
  }

  /**
   * One request's full four-segment breakdown. A request whose scope the
   * filter excludes answers with a {@link ScopedRefusal} — distinguishable
   * from `undefined` (no such seq on this instance).
   */
  getRequest(sessionId: string, seq: number, filter?: ScopeFilter): CapturedRequest | ScopedRefusal | undefined {
    const session = this.sessions.get(sessionId)
    if (session === undefined) return undefined
    for (const turn of session.turns) {
      for (const scope of turn.scopes.values()) {
        const request = scope.requests.find(candidate => candidate.seq === seq)
        if (request === undefined) continue
        if (!scopeAuthorized(scope.scopeId, filter)) {
          return { refused: 'no-authorized-content', generation: this.generation }
        }
        const previous = session.turns.flatMap(t => [...t.scopes.values()])
          .filter(s => s.scopeId === scope.scopeId)
          .flatMap(s => s.requests)
          .filter(r => r.purpose === request.purpose && (r.startedAt < request.startedAt || (r.startedAt === request.startedAt && r.seq < request.seq)))
          .sort((a, b) => b.startedAt - a.startedAt || b.seq - a.seq)[0]
        return { ...this.requestView(request), ...previous === undefined || request.compaction?.inputPartial || previous.compaction?.inputPartial ? {} : { prefix: this.withLinks(session, request, previous, comparePrefix(previous, request, factLookup(session))) } }
      }
    }
    return undefined
  }

  /** Resolve change entries to retained requests: the compaction call, and the request that still held un-pruned text. */
  private withLinks(session: SessionRecord, request: StoredRequest, previous: StoredRequest, prefix: NonNullable<CapturedRequest['prefix']>): NonNullable<CapturedRequest['prefix']> {
    if (prefix.changes === undefined) return prefix
    const link = (r: StoredRequest): RequestLink => this.addressOf(session, r)
    const retained = session.turns.flatMap(turn => [...turn.scopes.values()]).flatMap(scope => scope.requests)
    return { ...prefix, changes: prefix.changes.map(change => {
      if (change.kind === 'compaction' && change.compactionId !== undefined) {
        const target = retained.find(r => r.compaction?.id === change.compactionId && r.seq !== request.seq)
        return target === undefined ? change : { ...change, compactionRequest: link(target) }
      }
      return change.kind === 'prune' ? { ...change, pruneBefore: link(previous) } : change
    }) }
  }

  private previousRequest(session: SessionRecord, scopeId: string, at: number, seq: number): StoredRequest | undefined {
    return session.turns.flatMap(turn => turn.scopes.get(scopeId)?.requests ?? [])
      .filter(r => r.purpose === undefined && (r.startedAt < at || (r.startedAt === at && r.seq < seq)))
      .sort((a, b) => b.startedAt - a.startedAt || b.seq - a.seq)[0]
  }

  private requestView(request: StoredRequest): CapturedRequest {
    const session = this.sessions.get(request.sessionId)
    const baseline = request.needsHistoryBaseline && session !== undefined
      ? this.previousRequest(session, request.scopeId, request.startedAt, request.seq) : undefined
    const segments = baseline === undefined ? request.segments
      : rebaseSegments(request.segments, request.fingerprint, baseline.fingerprint)
    const owners = new Map<string, number>()
    for (const turn of this.sessions.get(request.sessionId)?.turns ?? []) {
      for (const r of turn.scopes.get(request.scopeId)?.requests ?? []) {
        if (r.requestNumber !== undefined) for (const c of r.response?.toolCalls ?? []) {
          if (c.callId !== undefined) owners.set(c.callId, r.requestNumber)
        }
      }
    }
    const retained = (this.sessions.get(request.sessionId)?.turns ?? []).flatMap(turn => turn.scopes.get(request.scopeId)?.requests ?? [])
    const link = (r: StoredRequest): RequestLink => session === undefined ? { turnSeq: r.turnSeq, scopeId: r.scopeId, seq: r.seq } : this.addressOf(session, r)
    const before = retained.filter(r => r.purpose === undefined && r.startedAt < request.startedAt).sort((a, b) => b.startedAt - a.startedAt)[0]
    const provenance = (items: SegmentItem[]) => items.map(item => {
      const number = item.toolCallId === undefined ? undefined : owners.get(item.toolCallId)
      const compression = item.compactionId === undefined ? undefined : retained.find(r => r.compaction?.id === item.compactionId)
      const original = item.pruning === undefined ? undefined : retained.filter(r => r.startedAt < request.startedAt && [...r.segments.history, ...r.segments.added].some(old => old.messageId === item.messageId && !old.pruning)).sort((a, b) => b.startedAt - a.startedAt)[0]
      return { ...item,
        ...number === undefined ? {} : { sourceRequestNumber: number },
        ...compression === undefined ? {} : { compactionRequest: link(compression) },
        ...item.pruning === undefined ? {} : { pruning: { ...item.pruning, ...original === undefined ? {} : { before: link(original) } } },
      }
    })
    const response = request.response && { ...request.response, toolCalls: request.response.toolCalls.map(call => {
      const exec = call.callId === undefined ? undefined : request.execs.find(e => e.callId === call.callId)
      return exec === undefined ? call : { ...call, execution: {
        status: exec.isError === true ? 'failed' as const : exec.end !== undefined || exec.isError === false ? 'ok' as const : 'running' as const,
        ...exec.result === undefined ? {} : { result: exec.result },
      } }
    }) }
    return {
      seq: request.seq,
      ...request.requestNumber === undefined ? {} : { requestNumber: request.requestNumber },
      scopeId: session === undefined ? request.scopeId : this.addressOf(session, request).scopeId,
      sessionId: request.sessionId,
      ...request.purpose === undefined ? {} : { purpose: request.purpose },
      ...request.compaction === undefined ? {} : { compaction: { ...request.compaction, ...before === undefined ? {} : { before: link(before) } } },
      startedAt: request.startedAt,
      status: request.status,
      ...request.error === undefined ? {} : { error: request.error },
      config: request.config,
      ...request.usage === undefined ? {} : { usage: request.usage },
      timing: requestTiming(request),
      generation: this.generation,
      responseSummary: request.responseSummary,
      ...response === undefined ? {} : { response },
      segments: { ...segments, history: provenance(segments.history), added: provenance(segments.added) },
    }
  }

  /** One turn's whole-turn timing aggregation, filtered to the authorized scopes. */
  getTurnTiming(sessionId: string, turnSeq: number, filter?: ScopeFilter): TurnTiming | undefined {
    const session = this.sessions.get(sessionId)
    const turn = session === undefined ? undefined : this.findTurn(session, turnSeq, filter)
    if (session === undefined || turn === undefined) return undefined
    const lanes: TimingLane[] = []
    const tools = new Map<string, ToolTiming>()
    for (const scope of turn.scopes.values()) {
      if (!scopeAuthorized(scope.scopeId, filter)) continue
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
            callId: exec.callId,
            ...exec.isError === undefined ? {} : { isError: exec.isError },
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
      startedAt: turn.startedAt,
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
      generation: this.generation,
      ...filter?.scopes === undefined ? {} : {
        authorizedScopes: [...turn.scopes.values()]
          .filter(scope => scopeAuthorized(scope.scopeId, filter))
          .map(scope => scope.scopeId),
      },
    }
  }

  /** Session request headers only; excluded scopes contribute no rows or aggregates. */
  getSessionTrend(sessionId: string, filter?: ScopeFilter): SessionTrend {
    const list = this.listTurns(sessionId, filter)
    return { ...list, requests: list.turns.flatMap(turn =>
      (this.getTurn(sessionId, turn.turnSeq, filter)?.scopes ?? []).flatMap(scope =>
        scope.requests.map(request => ({ ...request, turnSeq: turn.turnSeq })))) }
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
    this.totalChars = 0
  }

  // ---------- eviction ----------

  /** @param counted - false for a window move or cross-session room, which the "collected then dropped" signal does not report. */
  private evictTurn(session: SessionRecord, turn: TurnRecord, counted = true): void {
    session.turns = session.turns.filter(candidate => candidate !== turn)
    if (counted) session.evictedTurns += 1
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
        this.totalChars -= request.totalChars + (request.responseChars ?? 0) + (request.executionChars ?? 0)
      }
      if (scope.kind === 'subagent') session.nextRequestNumbers.delete(scope.scopeId)
      // The per-session backfill cap tracks reconstructed main-scope rows.
      if (!turn.liveContent && scope.kind === 'main') session.backfilledRequests -= scope.requests.length
    }
    // Pending delegation bindings are time-bracketed by their turn.
    const end = turn.endedAt ?? this.now()
    for (const [callId, pending] of session.pendingCalls) {
      if (pending.at >= turn.startedAt && pending.at <= end) session.pendingCalls.delete(callId)
    }
    this.onTurnEvicted?.(session.id, turn)
    // A session with nothing left releases its slot (and its child links) —
    // unless its backfill is only moving (window, cross-session room).
    if (session.turns.length === 0 && counted) {
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

  /** The globally oldest closed backfilled turn (char-pressure eviction order). */
  private oldestBackfilledTurn(): { session: SessionRecord; turn: TurnRecord } | undefined {
    let victim: { session: SessionRecord; turn: TurnRecord } | undefined
    for (const session of this.sessions.values()) {
      for (const turn of session.turns) {
        if (turn.liveContent || this.turnIsLive(turn)) continue
        if (victim === undefined || turn.startedAt < victim.turn.startedAt) victim = { session, turn }
      }
    }
    return victim
  }

  private enforceCaps(): void {
    for (const session of this.sessions.values()) {
      // Live-captured turns and the backfill window are capped separately, so
      // a window moved to older turns never pushes out the live ones (or vice versa).
      const real = (live: boolean) => session.turns.filter(turn => turn.hostTurn !== undefined && turn.liveContent === live)
      while (real(true).length > this.maxTurnsPerSession) {
        const victim = real(true).sort((x, y) => x.startedAt - y.startedAt).find(turn => !this.turnIsLive(turn))
        if (victim === undefined) break
        this.evictTurn(session, victim)
      }
      while (real(false).length > this.maxTurnsPerSession) {
        const victim = real(false).sort((x, y) => x.startedAt - y.startedAt)[0]
        if (victim === undefined) break
        this.evictTurn(session, victim)
      }
    }
    // The global char budget bounds stored segment text across sessions:
    // oldest backfilled turns evict first; live content never yields to it.
    while (this.totalChars > this.maxStoredCharsTotal) {
      const victim = this.oldestBackfilledTurn()
      if (victim === undefined) return
      this.evictTurn(victim.session, victim.turn)
      // Its window has a hole now: the next read refills it.
      if (victim.session.backfillState === 'complete') victim.session.backfillState = 'partial'
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

/**
 * Assemble a request's own response from its recorded block spans: the
 * authoritative block-end content, falling back to delta-accumulated text for
 * blocks a cancelled stream never closed. `undefined` when nothing was
 * produced (a failure before any block — the `error` field covers that).
 */
export function responseFromSpans(blocks: readonly BlockSpan[]): CapturedResponse | undefined {
  const reasoning = blocks.filter(block => block.kind === 'reasoning').map(block => block.text ?? '').join('')
  const text = blocks.filter(block => block.kind === 'text').map(block => block.text ?? '').join('')
  const toolCalls = blocks
    .filter(block => block.kind === 'tool-call' && block.toolName !== undefined)
    .map(block => ({ ...block.callId === undefined ? {} : { callId: block.callId }, name: block.toolName as string, arguments: block.args ?? '' }))
  if (reasoning === '' && text === '' && toolCalls.length === 0) return undefined
  return {
    ...reasoning === '' ? {} : { reasoning },
    ...text === '' ? {} : { text },
    toolCalls,
  }
}

/** 明细头锚点（结构化）：响应流里的工具调用 → `{kind:'tool', name, hint?, more?}`；纯文本 → `{kind:'text'}`；纯思考 → `{kind:'reasoning'}`；空响应 → `{kind:'none'}`。 */
function summarizeResponse(request: StoredRequest): ResponseSummary {
  const calls = request.blocks.filter(block => block.kind === 'tool-call' && block.toolName !== undefined)
  if (calls.length > 0) {
    const first = calls[0] as BlockSpan
    const hint = toolHint(first.args)
    return {
      kind: 'tool',
      name: first.toolName as string,
      ...hint === undefined ? {} : { hint },
      ...calls.length > 1 ? { more: calls.length - 1, toolCounts: countToolCalls(calls.map(call => call.toolName as string)) } : {},
    }
  }
  const hasText = request.blocks.some(block => block.kind === 'text')
  if (hasText) return { kind: 'text' }
  return request.blocks.some(block => block.kind === 'reasoning') ? { kind: 'reasoning' } : { kind: 'none' }
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

/** Content comparison is independent of durable message identity and provider cache behavior. */
/** `provider/model`, or '' when the capture recorded neither. */
function configKey(config: RequestConfig): string {
  return config.provider === undefined && config.model === undefined ? '' : `${config.provider ?? '?'}/${config.model ?? '?'}`
}

function factLookup(session: SessionRecord): FactLookup {
  return { byNewId: id => session.replacements.get(id), byReplacedId: id => session.replacedBy.get(id) }
}

function comparePrefix(previous: StoredRequest, current: StoredRequest, facts: FactLookup): NonNullable<CapturedRequest['prefix']> {
  const rows = (request: StoredRequest) => [...request.segments.system, ...request.segments.history, ...request.segments.added]
    .sort((a, b) => a.index - b.index)
  const a = rows(previous), b = rows(current)
  let i = 0
  while (i < a.length && i < b.length && a[i]?.full === b[i]?.full && a[i]?.category === b[i]?.category) i++
  // Appending new messages preserves the old prefix; deletion or replacement breaks it.
  const text = i < a.length ? prefixTextChange(a[i]?.full ?? '', b[i]?.full ?? '') : undefined
  const changed = text === undefined ? undefined : {
    index: b[i]?.index ?? a[i]?.index ?? 0,
    before: `${text.leadingOmitted ? '…' : ''}${text.leading}${text.removed}${text.removedChars > 160 ? '…' : ''}${text.trailing}${text.trailingOmitted ? '…' : ''}`,
    after: `${text.leadingOmitted ? '…' : ''}${text.leading}${text.added}${text.addedChars > 160 ? '…' : ''}${text.trailing}${text.trailingOmitted ? '…' : ''}`,
    ...a[i] === undefined ? {} : { beforeCategory: a[i]!.category },
    ...b[i] === undefined ? {} : { afterCategory: b[i]!.category },
    text,
  }
  const listed = diffRequests({ rows: a, tools: previous.segments.tools }, { rows: b, tools: current.segments.tools }, facts, changed === undefined ? undefined : changed.index)
  return { previousSeq: previous.seq, ...previous.requestNumber === undefined ? {} : { previousRequestNumber: previous.requestNumber }, gapMs: Math.max(0, current.startedAt - (previous.settledAt ?? previous.startedAt)),
    changes: listed.changes, toolChanges: listed.tools, ...listed.tail === undefined ? {} : { tail: listed.tail },
    ...configKey(previous.config) === configKey(current.config) || configKey(previous.config) === '' || configKey(current.config) === '' ? {} : { configChanged: { from: configKey(previous.config), to: configKey(current.config) } },
    toolsChanged: JSON.stringify(previous.segments.tools.map(({ added, ...tool }) => tool)) !== JSON.stringify(current.segments.tools.map(({ added, ...tool }) => tool)),
    ...changed === undefined ? {} : { changed } }
}

/** Extra captured bodies consume retention budget, never input character totals. */
function executionSize(request: Pick<StoredRequest, 'execs'>): number {
  return request.execs.reduce((n, exec) => n + (exec.result?.length ?? 0), 0)
}
function responseSize(response: CapturedResponse | undefined): number {
  return (response?.reasoning?.length ?? 0) + (response?.text?.length ?? 0)
    + (response?.toolCalls.reduce((n, call) => n + call.name.length + call.arguments.length, 0) ?? 0)
}
