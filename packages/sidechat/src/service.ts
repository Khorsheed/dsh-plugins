/**
 * The side-chat service core (`ctx.sideChat`): the contextKey → agent-session
 * lifecycle, the cross-plugin `openWith` seam, and the transcript surface the
 * Remote face delegates to.
 *
 * The model: each contextKey binds ONE persistent agent session — created
 * lazily on the first send and cold-resumed on the first gesture after a
 * restart — through the EXECUTION BACKEND port (`SideChatExecutionBackend`;
 * the default is the `ctx.agents` behavior extracted as-is, a mounting side
 * may inject its own target). The transcript projects from the session's
 * events (never a shadow copy, so history survives restart by construction).
 * `openWith` is per-turn FRESH, never a create-time snapshot: the prompt
 * segment and the caller tools reach the backend as LIVE READERS, re-read at
 * every assembly.
 *
 * Mutations serialize through one in-process queue; every state write rides
 * the store's re-rooted fence (the session that carried the gesture stamps
 * the policy when there is one). A send may carry NO calling session (a
 * host-side consumer without a conversation): the fence then resolves the
 * deployment default mode and the route/cwd fall to the explicit config or
 * the deployment defaults. Disposal is terminal — every public verb refuses
 * with a coded error afterwards.
 *
 * @module @khorsheed/dsh-sidechat
 */
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentOptions, ModelSelection } from '@deepseek-ai/dsh-agent'
import { FsError, type FsVersion } from '@deepseek-ai/dsh-fs'
import type { ContextFormed, MessageSource } from '@deepseek-ai/dsh-llm'
import { SessionId, type Session } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import {
  SideChatDefaultExecutionBackend, type SideChatExecutionBackend, type SideChatExecutionOpenInit,
  type SideChatExecutionSession,
} from './execution.ts'
import { PACKAGE_NAME } from './invariant.ts'
import { messageTextOf, projectTranscript, projectTurnError } from './journal.ts'
import { SideChatStore } from './store.ts'
import {
  foldRefsIntoText, MAX_REFS_PER_CONTEXT, refLabelOf, SIDECHAT_DEFAULT_SEGMENT,
  type SideChatContextRecord, type SideChatContextsDoc, type SideChatContextSummary,
  type SideChatListResult, type SideChatOpenInput, type SideChatQuoteOutcome, type SideChatQuoteRequest,
  type SideChatRef, type SideChatSendOutcome, type SideChatSendRequest, type SideChatState,
  type SideChatStateOutcome, type SideChatStatus, type SideChatStopOutcome, type SideChatSurfaceHints,
} from './types.ts'

/**
 * The sidechat producer's durable identity: the current producer-owned kind
 * (`sidechat`) and the released V3 wrapper's `plugin` value (the official
 * V3→V4 migration rewrites it to `kind: 'plugin:@khorsheed/dsh-sidechat'`).
 * {@link isSidechatSource} accepts all three forms; new writes always carry
 * the producer kind.
 */
export const SIDECHAT_KIND = 'sidechat'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** sidechat producer: one user message sent into a side-chat context. */
    sidechat: { kind: 'sidechat' } & ContextFormed
  }
}

/** The producer-owned source of a side-chat send. */
export function sidechatSource(): MessageSource {
  return Object.freeze({ kind: SIDECHAT_KIND })
}

/**
 * Whether a durable source belongs to the sidechat producer, in every form
 * the log can hold: the current producer-owned kind, the V3→V4 migrated
 * kind, and the released V3 wrapper a pre-V4 (0.1.5) host still serves
 * verbatim.
 * @param source - the persisted message source to test.
 * @returns true when the source names this producer.
 */
export function isSidechatSource(source: unknown): boolean {
  if (typeof source !== 'object' || source === null) return false
  const record = source as { kind?: unknown; plugin?: unknown }
  return record.kind === SIDECHAT_KIND
    || record.kind === `plugin:${PACKAGE_NAME}`
    || (record.kind === 'plugin' && record.plugin === PACKAGE_NAME)
}

/** Plugin config for the side-chat service; every key is optional. */
export interface SideChatConfig {
  /** State root override (defaults to `$DSH_HOME/state/sidechat`). */
  readonly stateRoot?: string
  /** Agent preset every side-chat agent composes (defaults to the deployment default preset). */
  readonly agentPreset?: string
  /**
   * Explicit execution route every new side-chat agent uses. A usable
   * provider/model pair WINS over the whole inheritance chain (the calling
   * session's folded request header, then the probed `agentDefaultModel`
   * deployment default); unset — or a pair that cannot route — leaves the
   * chain byte-identical.
   */
  readonly agentRoute?: AgentOptions
  /**
   * Explicit cwd anchor every new side-chat session runs at. A non-empty
   * value WINS over cwd inheritance (the source conversation's cwd, then the
   * calling session's); unset keeps the inheritance chain.
   */
  readonly cwd?: string
  /**
   * The execution backend every context's session opens through (the canvas
   * factory-config precedent: construction-time, one per service instance).
   * Absent = the default backend (the `ctx.agents` behavior, byte-identical
   * to before). An injected backend owns execution: it receives the resolved
   * route/preset/cwd in the open payload, and the service never falls back
   * to deployment defaults on its behalf.
   */
  readonly executionBackend?: SideChatExecutionBackend
}

/**
 * Thrown by every public verb after {@link SideChatService.disposeAgents}
 * ran (plugin unload): a coded, package-named refusal, never a bare throw.
 * The disposed instance stays dead — a rebuild over the same state root is a
 * NEW service instance's business.
 */
export class SideChatDisposedError extends Error {
  constructor(message: string, readonly code: 'disposed') {
    super(message)
    this.name = 'SideChatDisposedError'
  }
}

/** One context's in-memory runtime: the durable record plus the process-local pieces. */
interface ContextRuntime {
  record: SideChatContextRecord
  /** Caller-supplied tools by name (host-side objects — never persisted, never on the wire). */
  readonly tools: Map<string, ToolDefinition>
  /** In-flight session open (concurrent gestures dedupe onto it). */
  pending?: Promise<SideChatExecutionSession>
}

/** The segment one assembly renders: the built-in orientation plus the consumer's latest segment. */
function renderSegment(segment: string | undefined): string {
  return segment === undefined || segment === ''
    ? SIDECHAT_DEFAULT_SEGMENT
    : `${SIDECHAT_DEFAULT_SEGMENT}\n\n${segment}`
}

/** The agentDefaultModel face this package consumes (probed, never injected — the session-controller's own fallback). */
export type AgentDefaultModelProbe = Pick<{ currentSelection(): ModelSelection }, 'currentSelection'>

/**
 * The side-chat service core. Provided as `ctx.sideChat`; the Remote face
 * (`remote.sidechat`) is a thin adapter over it.
 */
export class SideChatService {
  /** The state store (probes the mounted filesystem itself). */
  readonly store: SideChatStore

  private readonly contexts = new Map<string, ContextRuntime>()
  /** contextKey → live execution session (the open ownership handle). */
  private readonly liveSessions = new Map<string, SideChatExecutionSession>()
  /** The execution target every session opens through (default: the `ctx.agents` behavior). */
  private readonly backend: SideChatExecutionBackend
  /** true when no backend was injected — the deployment-default route probe and the calling-less route rule apply. */
  private readonly backendIsDefault: boolean
  private docVersion: FsVersion | null = null
  private loaded = false
  private queue: Promise<unknown> = Promise.resolve()
  private warnedMemoryOnly = false
  /** Set by {@link disposeAgents} (plugin unload); every public verb refuses afterwards. */
  private disposed = false

  /**
   * @param ctx - host context (`agents`/`sessions` are the plugin's declared injects).
   * @param config - optional state-root, agent-preset, route/cwd and execution-backend overrides.
   */
  constructor(private readonly ctx: Context, private readonly config: SideChatConfig = {}) {
    this.backend = config.executionBackend ?? new SideChatDefaultExecutionBackend(ctx)
    this.backendIsDefault = config.executionBackend === undefined
    this.store = new SideChatStore(ctx, config)
    // fs arriving LATE (the common mount order: the 3080 bug was it never
    // being seen at all): allow one fresh ensureLoaded, which merges the disk
    // document into memory and flushes any records created meanwhile back to
    // disk. The memory-only warn flag resets too, so a composition where fs
    // genuinely never mounts still warns on its first real write.
    this.store.onFsReady(() => {
      this.loaded = false
      this.warnedMemoryOnly = false
    })
  }

  /* ------------------------------------------------------------- the doc */

  /** Log the memory-only degrade exactly once per fs-absence window (writes only, never construction or reads). */
  private warnMemoryOnly(): void {
    if (this.warnedMemoryOnly) return
    this.warnedMemoryOnly = true
    this.ctx.logger.warn('sidechat: no filesystem is mounted — contexts live in memory only and are lost on restart')
  }

  /**
   * Load the persisted mapping into memory (once per fs-arrival window; a
   * store failure reads as empty, logged). Memory stays authoritative for the
   * keys it already holds (single-writer rule) — records created BEFORE fs
   * arrived are kept and flushed back to disk on this reload.
   */
  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return
    this.loaded = true
    if (!this.store.available) return
    try {
      const read = await this.store.read()
      this.docVersion = read.version
      let merged = 0
      for (const record of read.doc.contexts) {
        if (this.contexts.has(record.contextKey)) continue
        this.contexts.set(record.contextKey, { record, tools: new Map() })
        merged += 1
      }
      // Memory knows records disk does not (created before fs arrived): flush
      // the union once so the fresh filesystem catches up with this window.
      if (this.contexts.size > merged) await this.persist()
    } catch (error) {
      this.ctx.logger.warn(`sidechat: the contexts document could not be read: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Mirror the in-memory mapping to the store under the version guard. Memory
   * is authoritative (this process is the document's only writer), so a stale
   * token re-reads the fresh version and retries exactly once — never a merge,
   * never an unconditional overwrite.
   * @param session - the session that carried the gesture, when there is one.
   */
  private async persist(session?: Session): Promise<void> {
    if (!this.store.available) {
      this.warnMemoryOnly()
      return
    }
    const doc: SideChatContextsDoc = {
      version: 1,
      contexts: [...this.contexts.values()].map(rt => rt.record),
    }
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        this.docVersion = await this.store.write(doc, this.docVersion, session)
        return
      } catch (error) {
        const retryable = error instanceof FsError && (error.code === 'FS_STALE_VERSION' || error.code === 'FS_NOT_OBSERVED')
        if (!retryable || attempt === 1) throw error
        const fresh = await this.store.read()
        this.docVersion = fresh.version
      }
    }
  }

  /** Serialize one mutation through the service queue (sends, quotes, openWith never interleave). */
  private mutate<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn)
    this.queue = run.catch(() => undefined)
    return run
  }

  /**
   * Refuse one public verb after disposal (the reader's disposed-flag
   * precedent, hardened into a coded package error): the instance is dead
   * and nothing it could still answer is meant to be consumed.
   */
  private assertAlive(verb: string): void {
    if (this.disposed) throw new SideChatDisposedError(`sidechat: ${verb} after dispose`, 'disposed')
  }

  /* ------------------------------------------------------------- records */

  /**
   * Resolve one context's runtime, creating its record on first use. A
   * non-empty label always renames (the latest caller's display name wins).
   */
  private ensureRuntime(contextKey: string, label: string | undefined): ContextRuntime {
    const existing = this.contexts.get(contextKey)
    if (existing !== undefined) {
      if (label !== undefined && label !== '' && label !== existing.record.label) {
        existing.record = { ...existing.record, label }
      }
      return existing
    }
    const now = new Date().toISOString()
    const runtime: ContextRuntime = {
      record: { contextKey, label: label === undefined || label === '' ? contextKey : label, refs: [], createdAt: now, updatedAt: now },
      tools: new Map(),
    }
    this.contexts.set(contextKey, runtime)
    return runtime
  }

  /* ------------------------------------------------------ the agent world */

  /** The cwd one new side session runs at: the explicit config anchor when set, else the inheritance chain ({@link inheritCwd}). */
  private cwdOf(contextKey: string, calling: Agent | undefined): string | undefined {
    const anchor = this.config.cwd
    if (anchor !== undefined && anchor !== '') return anchor
    return this.inheritCwd(contextKey, calling)
  }

  /** The cwd one new side session inherits: the source conversation's when the contextKey names a live session, else the calling session's. */
  private inheritCwd(contextKey: string, calling: Agent | undefined): string | undefined {
    const source = this.ctx.sessions.get(SessionId(contextKey))
    if (source !== undefined) return source.header.cwd ?? undefined
    const cwd = calling?.session.header.cwd
    return cwd === undefined || cwd === '' ? undefined : cwd
  }

  /**
   * The model route one new side session runs with. Without it the loop's
   * `prepareRequest` throws `agent has no provider/model` BEFORE the user
   * message reaches the journal — the turn dies silently and the sent
   * message "disappears" (the 3080 bug; the durable inbox still claims it
   * next turn, so no data repair is needed once the route exists). The
   * chain: the explicit config route first (a mounting side that must pin
   * WHERE side agents execute sets it; a pair that cannot route reads as
   * unset), then the CALLING session's own folded request header (the user
   * talks to the same model in the side chat as in the conversation), then
   * the deployment default via the probed `agentDefaultModel` service
   * (probe-with-degrade, never an inject) — DEFAULT backend only: an
   * injected backend owns execution and the service never falls back to
   * deployment defaults on its behalf — else nothing, and the turn error
   * then surfaces through `lastError` instead of vanishing.
   * @param calling - the calling session's agent, when a wire gesture carried one.
   * @returns the route for the open payload, or undefined.
   */
  private agentOptionsOf(calling: Agent | undefined): AgentOptions | undefined {
    const route = this.config.agentRoute
    if (route !== undefined && route.provider !== undefined && route.provider !== ''
      && route.model !== undefined && route.model !== '') {
      return { ...route }
    }
    const config = calling?.session.requestHeader?.()?.config
    if (config !== undefined && config.provider !== '' && config.model !== '') {
      return {
        provider: config.provider,
        model: config.model,
        ...config.reasoningEffort === undefined ? {} : { reasoningEffort: config.reasoningEffort },
      }
    }
    if (!this.backendIsDefault) return undefined
    const defaults = this.ctx.get('agentDefaultModel') as AgentDefaultModelProbe | undefined
    const selection = typeof defaults?.currentSelection === 'function'
      ? defaults.currentSelection()
      : undefined
    if (selection !== undefined && selection.provider !== '' && selection.model !== '') {
      return {
        provider: selection.provider,
        model: selection.model,
        ...selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort },
      }
    }
    return undefined
  }

  /**
   * Open one context's session live, deduped per context. A resume failure
   * (a torn or removed session log) falls through to a FRESH session rather
   * than erroring the gesture — the mapping is corrected, the lost history
   * is simply gone.
   */
  private async ensureSession(runtime: ContextRuntime, calling: Agent | undefined): Promise<SideChatExecutionSession> {
    const live = this.liveSessions.get(runtime.record.contextKey)
    if (live !== undefined) return live
    runtime.pending ??= this.openSession(runtime, calling).finally(() => { delete runtime.pending })
    return runtime.pending
  }

  /** One open pass for one context (see {@link ensureSession}). */
  private async openSession(runtime: ContextRuntime, calling: Agent | undefined): Promise<SideChatExecutionSession> {
    const route = this.agentOptionsOf(calling)
    // A send with NO calling agent must resolve a route up front — DEFAULT
    // backend only (an injected backend owns routing): with no user-facing
    // session an unrouted turn's error is invisible, so refuse honestly
    // (send maps this onto `agent-unavailable`) instead of creating a deaf
    // agent.
    if (calling === undefined && route === undefined && this.backendIsDefault) {
      throw new Error('sidechat: no execution route resolves without a calling session (set the explicit config route or mount agentDefaultModel)')
    }
    const { record } = runtime
    // The open payload: identity plus the RESOLVED route/preset/cwd, plus the
    // live readers a backend re-reads at every assembly (per-turn freshness
    // survives any backend by construction).
    const init = (sessionId: string, resume: boolean): SideChatExecutionOpenInit => {
      // RESUME replays the recorded preset (the header's comment semantics);
      // CREATE inherits the CALLING session's own preset first (a
      // standard-mode conversation gets a standard-mode side chat), then the
      // recorded preset, then the plugin config — the backend resolves its
      // own default when none is named.
      const presetId = resume
        ? (record.agentPreset ?? this.config.agentPreset)
        : (calling?.session.header.agentPreset ?? record.agentPreset ?? this.config.agentPreset)
      // The cwd anchor is a FIRST-OPEN fact: a resume replays what created
      // the session.
      const cwd = resume ? undefined : this.cwdOf(record.contextKey, calling)
      return {
        contextKey: record.contextKey,
        sessionId,
        resume,
        ...route === undefined ? {} : { route },
        ...presetId === undefined ? {} : { presetId },
        ...cwd === undefined ? {} : { cwd },
        segmentText: () => renderSegment(runtime.record.segment),
        tools: () => [...runtime.tools.values()],
      }
    }
    if (record.sessionId !== undefined) {
      try {
        const session = await this.backend.open(init(record.sessionId, true))
        await this.refuseLateSession(session)
        this.liveSessions.set(record.contextKey, session)
        return session
      } catch (error) {
        if (error instanceof SideChatDisposedError) throw error
        this.ctx.logger.warn(`sidechat: resuming "${record.contextKey}" failed, starting a fresh session: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    const session = await this.backend.open(init(randomUUID(), false))
    await this.refuseLateSession(session)
    this.liveSessions.set(record.contextKey, session)
    runtime.record = {
      ...runtime.record,
      sessionId: session.sessionId,
      ...session.resolvedPresetId === undefined ? {} : { agentPreset: session.resolvedPresetId },
      updatedAt: new Date().toISOString(),
    }
    await this.persist(calling?.session)
    return session
  }

  /**
   * Close the open/dispose race: a session that comes back AFTER disposal
   * ran is released on the spot (never leaked into the owned set) and the
   * caller is refused with the coded error (no resurrected usability).
   * Without the race this is a no-op.
   * @param session - the just-opened execution session.
   */
  private async refuseLateSession(session: SideChatExecutionSession): Promise<void> {
    if (!this.disposed) return
    await session.release().catch(() => undefined)
    throw new SideChatDisposedError('sidechat: the session arrived after dispose and was released at once', 'disposed')
  }

  /* ------------------------------------------------------------- the seam */

  /**
   * The cross-plugin seam: open (or update) one side-chat context. Repeated
   * calls with the same contextKey UPDATE — the label, the prompt segment
   * (read fresh at the next assembly, never a create-time snapshot), the
   * caller tools (re-synced by name on the live session, when the backend
   * attaches caller tools at all), and any refs — and NEVER recreate the
   * session. The session itself stays lazy: it opens on the first send, not
   * here.
   * @param input - context identity, display label, and the optional prompt/tools/refs contributions.
   */
  async openWith(input: SideChatOpenInput): Promise<void> {
    this.assertAlive('openWith')
    if (input.contextKey === '') throw new TypeError('sidechat: contextKey must not be empty')
    return this.mutate(async () => {
      await this.ensureLoaded()
      const runtime = this.ensureRuntime(input.contextKey, input.label)
      let record = runtime.record
      if (input.systemPrompt !== undefined && input.systemPrompt !== record.segment) {
        record = { ...record, segment: input.systemPrompt }
      }
      if (input.refs !== undefined && input.refs.length > 0) {
        record = { ...record, refs: [...record.refs, ...input.refs].slice(-MAX_REFS_PER_CONTEXT) }
      }
      if (input.tools !== undefined) {
        for (const def of input.tools) runtime.tools.set(def.name, def)
      }
      // Every openWith bumps the revision: the client's surfacer diffs it
      // over the wire and surfaces the context the consumer just opened.
      runtime.record = { ...record, rev: (record.rev ?? 0) + 1, updatedAt: new Date().toISOString() }
      await this.persist()
      // The prompt segment reaches the backend as a live reader (fresh by
      // itself); caller tools need a live re-sync — skipped silently when
      // the backend attaches no caller tools.
      if (input.tools !== undefined && runtime.record.sessionId !== undefined) {
        const live = this.liveSessions.get(input.contextKey)
        if (live !== undefined && this.backend.capabilities.callerTools) live.syncTools?.()
      }
    })
  }

  /* -------------------------------------------------------- remote backing */

  /**
   * One context's full presentation state. Read-only: a cold context answers
   * from the backend's cold read, never by resuming its session (a backend
   * without cold reads answers the honest unknown).
   * @param contextKey - the context to read.
   * @returns the state, or `not-found` when the context has no record yet.
   */
  async getState(contextKey: string): Promise<SideChatStateOutcome> {
    this.assertAlive('getState')
    return this.mutate(async () => {
      await this.ensureLoaded()
      const runtime = this.contexts.get(contextKey)
      if (runtime === undefined) return { ok: false, error: 'not-found' }
      return { ok: true, state: await this.stateOf(runtime) }
    })
  }

  /** Project one runtime into its presentation state (see {@link getState}). */
  private async stateOf(runtime: ContextRuntime): Promise<SideChatState> {
    const { record } = runtime
    let status: SideChatStatus = 'new'
    let transcript: SideChatState['transcript'] = []
    let lastError: string | null = null
    if (record.sessionId !== undefined) {
      const live = this.liveSessions.get(record.contextKey)
      if (live !== undefined) {
        status = live.status
        const events = live.events()
        transcript = projectTranscript(events)
        lastError = projectTurnError(events)
      } else {
        status = 'cold'
        const events = await this.readCold(record.sessionId)
        transcript = events === undefined ? [] : projectTranscript(events)
        lastError = events === undefined ? null : projectTurnError(events)
      }
    }
    return {
      contextKey: record.contextKey,
      label: record.label,
      status,
      refs: record.refs,
      transcript,
      lastError,
    }
  }

  /**
   * Cold read through the backend's `coldRead` capability: a backend without
   * it (or a failing read) answers the honest UNKNOWN — no events, never a
   * resume, never a crash.
   */
  private async readCold(sessionId: string): Promise<readonly SessionEvent[] | undefined> {
    if (!this.backend.capabilities.coldRead || this.backend.readCold === undefined) return undefined
    try {
      return await this.backend.readCold(sessionId)
    } catch (error) {
      this.ctx.logger.warn(`sidechat: cold read of "${sessionId}" failed: ${error instanceof Error ? error.message : String(error)}`)
      return undefined
    }
  }

  /**
   * The openWith revisions of every known context — the surfacer's diff
   * basis. The lightest read the service offers: memory only, no projection,
   * no inspection, so a 2.5s poll costs one map iteration.
   * @returns contextKey → openWith revision pairs.
   */
  async surfaceHints(): Promise<SideChatSurfaceHints> {
    this.assertAlive('surfaceHints')
    return this.mutate(async () => {
      await this.ensureLoaded()
      return {
        items: [...this.contexts.values()].map(runtime => ({
          contextKey: runtime.record.contextKey,
          rev: runtime.record.rev ?? 0,
        })),
      }
    })
  }

  /** The live status overlay for one record (synchronous — the list verb's per-row read). */
  private liveStatusOf(record: SideChatContextRecord): SideChatStatus {
    if (record.sessionId === undefined) return 'new'
    const live = this.liveSessions.get(record.contextKey)
    return live === undefined ? 'cold' : live.status
  }

  /**
   * List every known context, most recently active first. Each row carries
   * the latest assistant-row time of its journal projection (live contexts
   * from the snapshot, cold contexts from the backend's cold read — the
   * read-only path, never a resume) so the client can mark unread activity.
   * @returns the summaries with the live status overlay.
   */
  async listContexts(): Promise<SideChatListResult> {
    this.assertAlive('listContexts')
    return this.mutate(async () => {
      await this.ensureLoaded()
      const items: SideChatContextSummary[] = []
      for (const runtime of this.contexts.values()) {
        items.push({
          contextKey: runtime.record.contextKey,
          label: runtime.record.label,
          status: this.liveStatusOf(runtime.record),
          refs: runtime.record.refs.length,
          updatedAt: runtime.record.updatedAt,
          ...await this.activityOf(runtime.record),
        })
      }
      items.sort((a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0) || b.updatedAt.localeCompare(a.updatedAt))
      return { items }
    })
  }

  /**
   * The projection times of one record's journal: the latest assistant row
   * (the unread marker's basis) and the latest row of any kind (the list's
   * ordering). Read-only: live from the snapshot, cold from the backend's
   * cold read.
   */
  private async activityOf(record: SideChatContextRecord): Promise<{ lastAssistantAt: number | null; lastActivityAt: number | null }> {
    if (record.sessionId === undefined) return { lastAssistantAt: null, lastActivityAt: null }
    const live = this.liveSessions.get(record.contextKey)
    const events = live !== undefined ? live.events() : await this.readCold(record.sessionId)
    if (events === undefined) return { lastAssistantAt: null, lastActivityAt: null }
    let lastAssistantAt: number | null = null
    let lastActivityAt: number | null = null
    for (const row of projectTranscript(events)) {
      lastActivityAt = row.time
      if (row.kind === 'assistant') lastAssistantAt = row.time
    }
    return { lastAssistantAt, lastActivityAt }
  }

  /**
   * Send one user message into one context: pending refs (plus any one-shot
   * refs) fold into the message and clear, the context's session opens lazily
   * through the execution backend, and the turn starts as a producer-sourced
   * followup. The CALLING agent's session — when the gesture carries one —
   * only donates the fence and the cwd inheritance; the message never touches
   * it. Without one the write fences at the deployment default mode and the
   * route/cwd resolve from the explicit config or (default backend only) the
   * deployment defaults — a calling-less send with NO resolvable route
   * refuses `agent-unavailable` rather than creating a deaf agent.
   * @param calling - the calling session's agent, when the gesture carries one (the wire's agent-first convention).
   * @param request - contextKey, text, optional label and one-shot refs.
   * @returns the fresh state (already `running`), or the refusal.
   */
  async send(calling: Agent | undefined, request: SideChatSendRequest): Promise<SideChatSendOutcome> {
    this.assertAlive('send')
    const text = request.text.trim()
    if (text === '') return { ok: false, error: 'empty' }
    return this.mutate(async () => {
      await this.ensureLoaded()
      const runtime = this.ensureRuntime(request.contextKey, request.label)
      const refs: readonly SideChatRef[] = [...runtime.record.refs, ...(request.refs ?? [])].slice(-MAX_REFS_PER_CONTEXT)
      let session: SideChatExecutionSession
      try {
        session = await this.ensureSession(runtime, calling)
        runtime.record = { ...runtime.record, refs: [], updatedAt: new Date().toISOString() }
        await this.persist(calling?.session)
      } catch (error) {
        if (error instanceof SideChatDisposedError) throw error
        if (error instanceof FsError) return { ok: false, error: 'io' }
        this.ctx.logger.warn(`sidechat: no agent for "${request.contextKey}": ${error instanceof Error ? error.message : String(error)}`)
        return { ok: false, error: 'agent-unavailable' }
      }
      session.send({ text: foldRefsIntoText(refs, text), source: sidechatSource() })
      return { ok: true, state: await this.stateOf(runtime) }
    })
  }

  /**
   * Land one assistant message of the CALLING session as a ref on that
   * session's side chat (contextKey = the calling session's id — the message
   * action「引用到侧边对话」). The text is folded from the session journal by
   * messageId, so the wire carries no message body at all.
   * @param calling - the calling session's agent; its session is both the quote source and the context owner.
   * @param request - the message id and an optional display label for a first-time context.
   * @returns the bound contextKey and the pending-ref count, or the refusal.
   */
  async quoteMessage(calling: Agent, request: SideChatQuoteRequest): Promise<SideChatQuoteOutcome> {
    this.assertAlive('quoteMessage')
    return this.mutate(async () => {
      await this.ensureLoaded()
      let text: string | undefined
      for (const event of calling.session.snapshotEvents()) {
        if (event.type === 'assistant/message' && String(event.data.message.id) === request.messageId) {
          text = messageTextOf(event.data.message.content)
        }
      }
      if (text === undefined) return { ok: false, error: 'message-not-found' }
      if (text === '') return { ok: false, error: 'empty' }
      const contextKey = String(calling.session.id)
      const runtime = this.ensureRuntime(contextKey, request.label)
      const refs = [...runtime.record.refs, { label: refLabelOf(text), text }].slice(-MAX_REFS_PER_CONTEXT)
      runtime.record = { ...runtime.record, refs, updatedAt: new Date().toISOString() }
      try {
        await this.persist(calling.session)
      } catch (error) {
        if (error instanceof FsError) return { ok: false, error: 'io' }
        throw error
      }
      return { ok: true, contextKey, refs: refs.length }
    })
  }

  /**
   * Stop one context's running turn (host-side only — the wire carries no
   * stop gesture). Cancel is a no-op on an idle session; a cold or
   * never-opened context has nothing to stop. The refusal is coded:
   * `not-found` (no such context), `cancel-unsupported` (the backend declares
   * no cancel capability, or the live session cannot), `not-running`
   * (nothing live to stop right now).
   * @param contextKey - the context to stop.
   */
  async stop(contextKey: string): Promise<SideChatStopOutcome> {
    this.assertAlive('stop')
    return this.mutate(async () => {
      await this.ensureLoaded()
      const runtime = this.contexts.get(contextKey)
      if (runtime === undefined) return { ok: false, error: 'not-found' }
      if (!this.backend.capabilities.cancel) return { ok: false, error: 'cancel-unsupported' }
      const live = this.liveSessions.get(contextKey)
      if (live === undefined || live.status !== 'running') return { ok: false, error: 'not-running' }
      if (live.cancel === undefined) return { ok: false, error: 'cancel-unsupported' }
      live.cancel()
      return { ok: true }
    })
  }

  /**
   * Tear down every owned execution session (plugin unload); the sessions
   * stay persisted. Idempotent and TERMINAL: afterwards every public verb
   * refuses with {@link SideChatDisposedError}, and an open still in flight
   * is released on arrival rather than leaked into the owned set. A rebuild
   * over the same state root is a NEW service instance's business.
   */
  async disposeAgents(): Promise<void> {
    this.disposed = true
    for (const session of this.liveSessions.values()) {
      await session.release().catch(() => undefined)
    }
    this.liveSessions.clear()
  }
}
