import type { SessionTrend } from './types.ts'
/**
 * The context-lens service core: wires the three read-only capture lanes
 * into the host and answers the Remote face's queries from the store.
 *
 * Lanes:
 * 1. **`llm/stream`** (primary, full fidelity) — a waterfall tee that snapshots
 *    the frozen `GenerateOptions` at dispatch and forwards every chunk
 *    unchanged while recording block timing, usage, and tool-call identity.
 * 2. **`system-prompt/assemble`** — records each post-waterfall assembly into
 *    the section-attribution ring (read-only: always returns `next()`'s value).
 * 3. **`session/event`** — turn brackets, the user query preview, closing
 *    assistant message ids, tool exec pairing, and `subagent/catalog` scope
 *    correlation.
 *
 * The fourth input is the **log lane** (`sessionPersistence`, lazy): child
 * scopes of fresh-process `subagent_dsh` runs fill from the child's on-disk
 * log (the parent's waterfall never sees those requests), and a session's
 * pre-mount turns reconstruct from its own log — once per session at first
 * query, budgeted behind the live turns (the history backfill).
 *
 * Capture is observation, never interception: any capture-internal failure is
 * logged and the model path forwards untouched (the tee degrades to a bare
 * `next()`; listener bodies are individually contained).
 *
 * @module @khorsheed/dsh-context-lens/service
 */
import type { Context } from '@deepseek-ai/cordis'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { PromptAssembly } from '@deepseek-ai/dsh-system-prompt'
import type { CapturedRequest, ListTurnsResult, ScopeFilter, ScopedRefusal, TurnOverview, TurnTiming } from './types.ts'
import { InspectorStore, scopeAuthorized, type EvictedTurn, type RequestSnapshot, type StoredRequest, type StoreConfig } from './store.ts'
import { recordAssembly } from './segmenter.ts'
import { fromRequestMessage, serializeMessage } from './messages.ts'
import { messageOfRow, meterOf, replacementFact, replacementFactsOf, type PendingMeter, type ReplacementRow } from './changes.ts'
import {
  foldLogRows,
  isSessionLogReader,
  openCursor,
  reconstructSession,
  type SessionLogCursor,
  type SessionLogRow,
  type SessionLogHandle,
  type SessionLogReader,
} from './log-lane.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The context-lens service core. */
    requestInspector: InspectorService
  }
}

/**
 * Subagent providers that run inside this host, so their requests pass
 * through the capture. Every other provider (claude-local, codex-local,
 * kimi-cli, dsh-cli, …) is its own process: its session is log-driven.
 */
const IN_PROCESS_PROVIDERS = new Set(['spawn', 'fork'])

/** Plugin config: capture retention knobs. */
export interface InspectorConfig {
  /** Turns retained per session (oldest evicted first, backfilled before live). Default 30. */
  maxTurnsPerSession?: number
  /** Log-reconstructed requests retained per session. Default 500. */
  maxBackfillRequestsPerSession?: number
  /** Global budget of stored segment text characters. Default 150M (~150MB). */
  maxStoredCharsTotal?: number
}

/** Test seams: the clock, the persistence probe, and the warning sink. */
export interface InspectorDeps {
  now?: () => number
  /** Overrides the `sessionPersistence` probe (tests inject the fixture here). */
  persistence?: SessionLogReader
  logger?: { warn(message: string): void }
  /** Overrides the instance epoch stamped on query results (restart invalidation tests). */
  generation?: string
}

/** The capture store's query face (Remote delegates here). */
export class InspectorService {
  private readonly store: InspectorStore
  private readonly disposers: (() => void)[]
  /** childId → open read handle (persistent: reads are offset-incremental). */
  private readonly handles = new Map<string, SessionLogHandle>()
  private readonly cursors = new Map<string, SessionLogCursor>()
  /** In-flight refresh per childId — concurrent panel queries share one read. */
  private readonly refreshing = new Map<string, Promise<void>>()
  /** sessionId → the metering event (`compaction/summary` | `compaction/prune`) just seen; the host appends its replacement next. */
  private readonly meters = new Map<string, PendingMeter>()
  private readonly now: () => number
  private readonly logWarn: (message: string) => void
  private readonly persistenceOverride?: SessionLogReader | undefined

  constructor(
    readonly ctx: Context,
    readonly config: InspectorConfig = {},
    deps: InspectorDeps = {},
  ) {
    this.now = deps.now ?? Date.now
    this.logWarn = deps.logger?.warn.bind(deps.logger) ?? ((message: string) => ctx.logger.warn(message))
    this.persistenceOverride = deps.persistence
    const storeConfig: StoreConfig = {
      ...config.maxTurnsPerSession === undefined ? {} : { maxTurnsPerSession: config.maxTurnsPerSession },
      ...config.maxBackfillRequestsPerSession === undefined ? {} : { maxBackfillRequestsPerSession: config.maxBackfillRequestsPerSession },
      ...config.maxStoredCharsTotal === undefined ? {} : { maxStoredCharsTotal: config.maxStoredCharsTotal },
    }
    this.store = new InspectorStore(storeConfig, {
      now: this.now,
      onTurnEvicted: (_sessionId, turn) => this.dropEvictedChildState(turn),
      ...deps.generation === undefined ? {} : { generation: deps.generation },
    })
    this.disposers = [
      ctx.on('llm/stream', (options, next) => this.onStream(options, next)),
      ctx.on('system-prompt/assemble', (_assembly, _context, next) => this.onAssemble(next)),
      ctx.on('session/event', (session, event) => this.onSessionEvent(session, event)),
    ]
  }

  // ---------- lane 1: llm/stream (in-process, full fidelity) ----------

  /**
   * The waterfall tee: snapshot the (possibly deep-frozen) request at dispatch,
   * then forward every chunk unchanged while observing. A capture-side failure
   * at setup degrades to the bare downstream stream; mid-stream failures only
   * lose the remaining observations.
   */
  private onStream(
    options: GenerateOptions,
    next: () => AsyncIterable<StreamChunk>,
  ): AsyncIterable<StreamChunk> {
    let request: StoredRequest | undefined
    try {
      request = this.store.beginRequest(snapshotOptions(options), this.now())
    } catch (error) {
      this.logWarn(`context-lens: capture setup failed, forwarding uncaptured (${String(error)})`)
      return next()
    }
    if (request === undefined) return next()
    return this.tee(request, next)
  }

  private tee(request: StoredRequest, next: () => AsyncIterable<StreamChunk>): AsyncIterable<StreamChunk> {
    const { store, now } = this
    const warn = this.logWarn
    return (async function* () {
      let thrown: unknown
      try {
        for await (const chunk of next()) {
          try {
            store.observeChunk(request, chunk, now())
          } catch (error) {
            warn(`context-lens: chunk observation dropped (${String(error)})`)
          }
          yield chunk
        }
      } catch (error) {
        thrown = error
        throw error
      } finally {
        try {
          store.settleRequest(request, now(), thrown)
        } catch (error) {
          warn(`context-lens: request settlement dropped (${String(error)})`)
        }
      }
    })()
  }

  // ---------- lane 2: system-prompt/assemble (read-only attribution feed) ----------

  /**
   * Record the post-waterfall assembly for section attribution. The returned
   * value passes through unchanged — this listener observes, it never rewrites
   * a prompt.
   */
  private async onAssemble(next: () => Promise<PromptAssembly>): Promise<PromptAssembly> {
    const result = await next()
    try {
      recordAssembly(this.store.assemblyRing, result, this.now())
    } catch (error) {
      this.logWarn(`context-lens: assembly record dropped (${String(error)})`)
    }
    return result
  }

  // ---------- lane 3: session/event (turn brackets + tool pairing + catalog) ----------

  private onSessionEvent(session: Session, event: SessionEvent): void {
    try {
      this.dispatchSessionEvent(session, event)
    } catch (error) {
      this.logWarn(`context-lens: session event "${String(event.type)}" dropped (${String(error)})`)
    }
  }

  private dispatchSessionEvent(session: Session, event: SessionEvent): void {
    const sessionId: string = session.id
    const at = event.time
    const eventType: string = event.type
    this.noteReplacement(session, event as unknown as ReplacementRow)
    this.store.noteLogActivity(sessionId)
    if (eventType.startsWith('compaction/')) this.store.noteCompaction(sessionId, eventType, event.data as unknown as Record<string, unknown>)
    if (eventType.startsWith('room/')) {
      this.store.noteRoomEvent(sessionId, eventType, event.data, event.seq, at)
      return
    }
    if (event.type === 'tool/result' && event.surfaceOp !== 'append') {
      const original = session.eventAt(event.surfaceOp.startSeq)
      if (original?.type === 'tool/result') {
        this.store.notePruning(sessionId, event.data.message.id,
          serializeMessage(fromRequestMessage(original.data.message)).length,
          serializeMessage(fromRequestMessage(event.data.message)).length)
      }
      // A replacement updates context, not the original execution's result.
      return
    }

    switch (event.type) {
      case 'turn/start':
        this.store.turnStart(sessionId, event.data.turn, at, event.seq)
        return
      case 'turn/end':
        this.store.turnEnd(sessionId, event.data.turn, event.data.reason, at)
        return
      case 'user/message': {
        const message = fromRequestMessage(event.data)
        if (message.compactionId !== undefined && event.surfaceOp !== 'append') this.store.noteCompaction(sessionId, 'compaction/applied', { compactionId: message.compactionId })
        if (message.id) this.store.noteMessageTurn(sessionId, message.id)
        this.store.noteUserMessage(sessionId, message.sourceKind, serializeMessage(message))
        return
      }
      case 'assistant/message':
        this.store.noteMessageTurn(sessionId, event.data.message.id, event.data.turn)
        this.store.noteAssistantMessage(sessionId, event.data.message.id)
        return
      case 'tool/call':
        this.store.toolCall(sessionId, event.data.callId, event.data.name, event.data.arguments, at)
        return
      case 'tool/result': {
        this.store.noteMessageTurn(sessionId, event.data.message.id, event.data.turn)
        const message = fromRequestMessage(event.data.message)
        this.store.toolResult(
          sessionId,
          event.data.message.toolCallId,
          event.data.message.isError === true,
          serializeMessage(message),
          at,
        )
        return
      }
      default:
        break
    }
    // `subagent/catalog` belongs to the subagent package's SessionEventMap
    // merge — read structurally so this plugin neither depends on that package
    // nor breaks when the composition lacks it.
    const type: string = event.type
    if (type === 'subagent/descriptor') {
      const provider = (event.data as Record<string, unknown>)['provider']
      if (typeof provider === 'string') {
        this.store.noteChildProvider(sessionId, provider)
        if (!IN_PROCESS_PROVIDERS.has(provider)) this.store.markLogDriven(sessionId)
      }
      return
    }
    if (type === 'subagent/catalog') {
      const data = event.data as Record<string, unknown>
      const childId = data['childId']
      if (typeof childId === 'string' && childId.length > 0) {
        const label = data['label']
        this.store.subagentCatalog(
          sessionId,
          childId,
          typeof label === 'string' && label.length > 0 ? label : undefined,
          at,
        )
      }
    }
  }

  // ---------- lane 4: child logs (fresh-process subagent fallback) ----------

  /** The probed `sessionPersistence` service, when the composition mounts one. */
  private reader(): SessionLogReader | undefined {
    if (this.persistenceOverride !== undefined) return this.persistenceOverride
    try {
      const candidate: unknown = this.ctx.get('sessionPersistence')
      return isSessionLogReader(candidate) ? candidate : undefined
    } catch {
      return undefined
    }
  }

  /**
   * Refresh the log-sourced child scopes of one session (query-time,
   * incremental). A scope the query's {@link ScopeFilter} excludes is skipped
   * outright — its log is not opened on an unauthorized query's behalf.
   */
  private async refreshChildren(rootSessionId: string, filter?: ScopeFilter): Promise<void> {
    const reader = this.reader()
    if (reader === undefined) return
    const scopes = this.store.childScopes(rootSessionId)
    await Promise.all(scopes.map(scope => scopeAuthorized(scope.scopeId, filter)
      ? this.refreshChild(rootSessionId, scope.scopeId, reader, scope.live)
      : Promise.resolve()))
  }

  private refreshChild(
    rootSessionId: string,
    childId: string,
    reader: SessionLogReader,
    live: boolean,
  ): Promise<void> {
    if (live) return Promise.resolve()
    const pending = this.refreshing.get(childId)
    if (pending !== undefined) return pending
    const job = this.doRefreshChild(rootSessionId, childId, reader)
      .finally(() => {
        this.refreshing.delete(childId)
      })
    this.refreshing.set(childId, job)
    return job
  }

  private async doRefreshChild(
    rootSessionId: string,
    childId: string,
    reader: SessionLogReader,
  ): Promise<void> {
    let cursor = this.cursors.get(childId)
    if (cursor?.broken !== undefined) return
    if (cursor === undefined) {
      cursor = openCursor()
      this.cursors.set(childId, cursor)
    }
    try {
      let handle = this.handles.get(childId)
      if (handle === undefined) {
        handle = await reader.open(childId, 'read')
        this.handles.set(childId, handle)
      }
      const { events } = await handle.read(cursor.consumed)
      const descriptor = events.find(row => row.type === 'subagent/descriptor')
      const provider = (descriptor?.data as Record<string, unknown> | undefined)?.['provider']
      if (typeof provider === 'string') this.store.noteChildProvider(childId, provider)
      for (const request of foldLogRows(cursor, events)) {
        this.store.appendLogRequest(rootSessionId, childId, request)
      }
      this.store.refreshExecutionResults(rootSessionId, childId)
    } catch (error) {
      // A not-yet-materialized child log is transient (the child process flushes
      // on its own schedule) — retry on the next refresh. Anything else is a
      // durable unreadability (format drift, unknown event vocabulary): stop
      // hammering it and keep the scope's honest empty state.
      if (error instanceof Error && error.name === 'SessionPersistenceNotFoundError') return
      cursor.broken = error instanceof Error ? error.message : String(error)
      this.logWarn(`context-lens: child log "${childId}" unreadable (${cursor.broken})`)
    }
  }

  /** Turn eviction drops the child cursors/handles whose scopes lived on it. */
  private dropEvictedChildState(turn: EvictedTurn): void {
    for (const scopeId of turn.scopes.keys()) {
      if (scopeId === 'main') continue
      this.cursors.delete(scopeId)
      const handle = this.handles.get(scopeId)
      if (handle !== undefined) {
        this.handles.delete(scopeId)
        void handle.close().catch(() => undefined)
      }
    }
  }

  // ---------- lane 5: main-session history backfill ----------

  /**
   * Reconstruct the session's pre-mount history from its own log, once per
   * session (the store's watermark holds). The read is one full pass at first
   * query; the store keeps the newest turns that fit the budget behind the
   * live ones. A not-yet-materialized log is transient (retry next query); any
   * other read failure marks the session broken and stops hammering it.
   */
  /** Pair a surface replacement with what it shadowed, typed by the metering event right before it. */
  private noteReplacement(session: Session, row: ReplacementRow): void {
    const meter = this.meters.get(session.id)
    this.meters.delete(session.id)
    const next = meterOf(row)
    if (next !== undefined) this.meters.set(session.id, next)
    const fact = replacementFact(row, seq => {
      const shadowed = session.eventAt(seq as Parameters<Session['eventAt']>[0])
      return shadowed === undefined ? undefined : messageOfRow(shadowed as unknown as ReplacementRow)?.id
    }, meter)
    if (fact !== undefined) this.store.noteReplacement(session.id, fact)
  }

  private async backfillMainSession(sessionId: string): Promise<void> {
    const reader = this.reader()
    if (reader === undefined) return
    // Retryable until complete: a partial fill re-reads on later queries
    // (eviction may have freed room); the read is one zstd decode.
    const state = this.store.backfillState(sessionId)
    if (state === 'broken' || (state === 'complete' && !this.store.needsRequestNumbers(sessionId) && !this.store.needsLogRead(sessionId))) return
    const jobKey = `main:${sessionId}`
    const pending = this.refreshing.get(jobKey)
    if (pending !== undefined) return pending
    const job = this.doBackfillMainSession(sessionId, reader)
      .finally(() => {
        this.refreshing.delete(jobKey)
      })
    this.refreshing.set(jobKey, job)
    return job
  }

  private async doBackfillMainSession(sessionId: string, reader: SessionLogReader): Promise<void> {
    try {
      const handle = await reader.open(sessionId, 'read')
      try {
        const { events } = await handle.read(0)
        // Materialize only the window's requests: every request carries its
        // whole context, so a long log rebuilt at once grows quadratically.
        const hosts = events.filter(row => row.type === 'turn/start')
          .map(row => (row.data as { turn?: unknown } | undefined)?.turn).filter((turn): turn is number => typeof turn === 'number')
        // An external agent's own session: its requests reach only this log.
        const provider = (events.find(row => row.type === 'subagent/descriptor')?.data as Record<string, unknown> | undefined)?.['provider']
        if (typeof provider === 'string' && !IN_PROCESS_PROVIDERS.has(provider)) this.store.markLogDriven(sessionId)
        const keep = this.store.windowHosts(sessionId, hosts)
        this.store.insertLogTurns(sessionId, reconstructSession(events, host => host === undefined || keep.has(host)))
        for (const fact of replacementFactsOf(events)) this.store.noteReplacement(sessionId, fact)
        for (const row of events) {
          if (row.type.startsWith('room/')) this.store.noteRoomEvent(sessionId, row.type, row.data, row.seq, row.time)
        }
        await this.resolveParent(sessionId, events, reader)
      } finally {
        void handle.close().catch(() => undefined)
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'SessionPersistenceNotFoundError') return
      const reason = error instanceof Error ? error.message : String(error)
      this.store.markBackfillBroken(sessionId, reason)
      this.logWarn(`context-lens: session "${sessionId}" log unreadable, history backfill skipped (${reason})`)
    }
  }

  /**
   * A session opened on its own whose log header names a `parentSession`:
   * read the parent's log once for its title, the turn whose catalog row
   * started this child, and that row's label. Best effort — an unreadable
   * parent leaves just its id.
   */
  private async resolveParent(sessionId: string, events: readonly SessionLogRow[], reader: SessionLogReader): Promise<void> {
    const header = events[0]
    const parentId = header?.type === 'session' ? (header as unknown as { parentSession?: unknown }).parentSession : undefined
    if (typeof parentId !== 'string' || parentId.length === 0 || this.store.hasParent(sessionId)) return
    const parent: { sessionId: string; title?: string; hostTurn?: number; label?: string } = { sessionId: parentId }
    try {
      const handle = await reader.open(parentId, 'read')
      try {
        const { events: rows } = await handle.read(0)
        let turn: number | undefined
        for (const row of rows) {
          const data = (row.data ?? {}) as Record<string, unknown>
          if (row.type === 'turn/start' && typeof data['turn'] === 'number') turn = data['turn']
          if (row.type === 'session/title' && typeof data['title'] === 'string') parent.title = data['title']
          if (row.type === 'subagent/catalog' && data['childId'] === sessionId) {
            if (turn !== undefined) parent.hostTurn = turn
            if (typeof data['label'] === 'string') parent.label = data['label']
          }
        }
      } finally {
        void handle.close().catch(() => undefined)
      }
    } catch {
      // The id alone still says whose child this is.
    }
    this.store.noteParent(sessionId, parent)
  }

  // ---------- queries (the Remote face delegates here) ----------

  /**
   * Light turn list of one session plus its backfill watermark. The optional
   * {@link ScopeFilter} restricts rows and aggregates to the authorized
   * scopes; absent is the unfiltered local semantics.
   */
  async listTurns(sessionId: string, filter?: ScopeFilter): Promise<ListTurnsResult> {
    await this.backfillMainSession(sessionId)
    await this.refreshChildren(sessionId, filter)
    return this.store.listTurns(sessionId, filter)
  }

  /**
   * Move the session's backfill window to the turns ending at `end` (the
   * latest turns when null) and answer the refreshed turn list. Live turns
   * stay; the window refills from the log in the same call.
   */
  async loadTurns(sessionId: string, end: number | null, filter?: ScopeFilter): Promise<ListTurnsResult> {
    const pending = this.refreshing.get(`main:${sessionId}`)
    if (pending !== undefined) await pending
    this.store.setWindow(sessionId, end ?? undefined)
    return this.listTurns(sessionId, filter)
  }

  /** One turn's scope/request overview, without segments. */
  async getTurn(sessionId: string, turnSeq: number, filter?: ScopeFilter): Promise<TurnOverview | undefined> {
    await this.backfillMainSession(sessionId)
    await this.refreshChildren(sessionId, filter)
    return this.store.getTurn(sessionId, turnSeq, filter)
  }

  /** One request's full four-segment breakdown (a {@link ScopedRefusal} when the filter excludes its scope). */
  async getRequest(sessionId: string, seq: number, filter?: ScopeFilter): Promise<CapturedRequest | ScopedRefusal | undefined> {
    await this.backfillMainSession(sessionId)
    await this.refreshChildren(sessionId, filter)
    const request = this.store.getRequest(sessionId, seq, filter)
    const tools = request !== undefined && 'prefix' in request ? request.prefix?.toolChanges : undefined
    if (tools === undefined || tools.length === 0) return request
    return { ...request as CapturedRequest, prefix: { ...(request as CapturedRequest).prefix!, toolChanges: tools.map(tool => {
      const owner = this.toolOwner(tool.name)
      return owner === undefined ? tool : { ...tool, owner }
    }) } }
  }

  /** The declaring package from a registered tool's host-side origin tag (capability-catalog convention); absent when untagged. */
  private toolOwner(name: string): string | undefined {
    try {
      const registry = this.ctx.get('tools' as never) as { get?: (name: string) => unknown } | undefined
      const definition = registry?.get?.(name)
      if (typeof definition !== 'object' || definition === null) return undefined
      const origin = (definition as Record<symbol, unknown>)[Symbol.for('dsh.tool.origin')] as { owner?: unknown } | undefined
      return typeof origin?.owner === 'string' ? origin.owner : undefined
    } catch {
      return undefined
    }
  }

  /** Read the session map through the same backfill and scope-filtered path. */
  async getSessionTrend(sessionId: string, filter?: ScopeFilter): Promise<SessionTrend> {
    await this.listTurns(sessionId, filter)
    return this.store.getSessionTrend(sessionId, filter)
  }

  /** One turn's whole-turn timing aggregation. */
  async getTurnTiming(sessionId: string, turnSeq: number, filter?: ScopeFilter): Promise<TurnTiming | undefined> {
    await this.backfillMainSession(sessionId)
    await this.refreshChildren(sessionId, filter)
    return this.store.getTurnTiming(sessionId, turnSeq, filter)
  }

  /** Release every session buffer, listener, and open child-log handle (plugin dispose). */
  dispose(): void {
    for (const dispose of this.disposers.splice(0)) dispose()
    this.store.dispose()
    for (const handle of this.handles.values()) {
      void handle.close().catch(() => undefined)
    }
    this.handles.clear()
    this.cursors.clear()
  }
}

/** The dispatch-time snapshot of one GenerateOptions (never mutates the frozen input). */
function snapshotOptions(options: GenerateOptions): RequestSnapshot {
  return {
    ...options.sessionId === undefined ? {} : { sessionId: options.sessionId },
    ...options.purpose === undefined ? {} : { purpose: options.purpose },
    config: {
      provider: options.provider,
      model: options.model,
      ...options.reasoningEffort === undefined ? {} : { reasoningEffort: options.reasoningEffort },
      ...options.temperature === undefined ? {} : { temperature: options.temperature },
      ...options.maxTokens === undefined ? {} : { maxTokens: options.maxTokens },
    },
    messages: options.messages.map(fromRequestMessage),
    ...options.system === undefined ? {} : { systemSlot: options.system },
    ...options.tools === undefined ? {} : { tools: options.tools },
  }
}
