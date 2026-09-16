/**
 * The side-chat service core (`ctx.sideChat`): the contextKey → agent-session
 * lifecycle, the cross-plugin `openWith` seam, and the transcript surface the
 * Remote face delegates to.
 *
 * The model: each contextKey binds ONE persistent agent session — created
 * lazily on the first send (`ctx.agents.create`, the eval/room precedent),
 * cold-resumed on the first gesture after a restart (`ctx.agents.resume`),
 * and projected from its session journal (never a shadow copy, so history
 * survives restart by construction). `openWith` is per-turn FRESH, never a
 * create-time snapshot: the agent-scoped prompt section's text provider reads
 * the record's latest segment at every assembly, and caller tools re-attach
 * by name on the live agent.
 *
 * Mutations serialize through one in-process queue; every state write rides
 * the store's re-rooted fence (the session that carried the gesture stamps
 * the policy when there is one).
 *
 * @module @khorsheed/dsh-sidechat
 */
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentSetup } from '@deepseek-ai/dsh-agent'
import { FsError, type FsVersion } from '@deepseek-ai/dsh-fs'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, type Session } from '@deepseek-ai/dsh-session'
// Type-only: pulls the ctx.systemPrompt service merge (the agent-scope section registration).
import type {} from '@deepseek-ai/dsh-system-prompt'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { composeSideAgent, inspectCold } from './agent-setup.ts'
import { PACKAGE_NAME } from './invariant.ts'
import { messageTextOf, projectTranscript } from './journal.ts'
import { SideChatStore } from './store.ts'
import {
  foldRefsIntoText, MAX_REFS_PER_CONTEXT, refLabelOf, SIDECHAT_DEFAULT_SEGMENT, SIDECHAT_SECTION_NAME,
  SIDECHAT_SECTION_ORDER,
  type SideChatContextRecord, type SideChatContextsDoc, type SideChatContextSummary,
  type SideChatListResult, type SideChatOpenInput, type SideChatQuoteOutcome, type SideChatQuoteRequest,
  type SideChatRef, type SideChatSendOutcome, type SideChatSendRequest, type SideChatState,
  type SideChatStateOutcome, type SideChatStatus, type SideChatSurfaceHints,
} from './types.ts'

/** Plugin config for the side-chat service; every key is optional. */
export interface SideChatConfig {
  /** State root override (defaults to `$DSH_HOME/state/sidechat`). */
  readonly stateRoot?: string
  /** Agent preset every side-chat agent composes (defaults to the deployment default preset). */
  readonly agentPreset?: string
}

/** One context's in-memory runtime: the durable record plus the process-local pieces. */
interface ContextRuntime {
  record: SideChatContextRecord
  /** Caller-supplied tools by name (host-side objects — never persisted, never on the wire). */
  readonly tools: Map<string, ToolDefinition>
  /** Live-agent tool registration disposers by name. */
  readonly toolDisposers: Map<string, () => void>
  /** In-flight agent creation/resume (concurrent gestures dedupe onto it). */
  pending?: Promise<Agent>
}

/** The segment one assembly renders: the built-in orientation plus the consumer's latest segment. */
function renderSegment(segment: string | undefined): string {
  return segment === undefined || segment === ''
    ? SIDECHAT_DEFAULT_SEGMENT
    : `${SIDECHAT_DEFAULT_SEGMENT}\n\n${segment}`
}

/** The live status overlay for one record (synchronous — the list verb's per-row read). */
function liveStatusOf(agents: Context['agents'], record: SideChatContextRecord): SideChatStatus {
  if (record.sessionId === undefined) return 'new'
  const live = agents.get(SessionId(record.sessionId))
  return live === undefined ? 'cold' : live.status
}

/**
 * The side-chat service core. Provided as `ctx.sideChat`; the Remote face
 * (`remote.sidechat`) is a thin adapter over it.
 */
export class SideChatService {
  /** The state store (probes the mounted filesystem itself). */
  readonly store: SideChatStore

  private readonly contexts = new Map<string, ContextRuntime>()
  /** contextKey → owned agent handle (the create/resume ownership capability). */
  private readonly handles = new Map<string, { dispose(): Promise<void> }>()
  private docVersion: FsVersion | null = null
  private loaded = false
  private queue: Promise<unknown> = Promise.resolve()
  private warnedMemoryOnly = false

  /**
   * @param ctx - host context (`agents`/`sessions` are the plugin's declared injects).
   * @param config - optional state-root and agent-preset overrides.
   */
  constructor(private readonly ctx: Context, private readonly config: SideChatConfig = {}) {
    this.store = new SideChatStore(ctx, config)
  }

  /* ------------------------------------------------------------- the doc */

  /** Log the memory-only degrade exactly once. */
  private warnMemoryOnly(): void {
    if (this.warnedMemoryOnly) return
    this.warnedMemoryOnly = true
    this.ctx.logger.warn('sidechat: no filesystem is mounted — contexts live in memory only and are lost on restart')
  }

  /** Load the persisted mapping into memory (once; a store failure reads as empty, logged). */
  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return
    this.loaded = true
    if (!this.store.available) {
      this.warnMemoryOnly()
      return
    }
    try {
      const read = await this.store.read()
      this.docVersion = read.version
      for (const record of read.doc.contexts) {
        this.contexts.set(record.contextKey, { record, tools: new Map(), toolDisposers: new Map() })
      }
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
      toolDisposers: new Map(),
    }
    this.contexts.set(contextKey, runtime)
    return runtime
  }

  /* ------------------------------------------------------ the agent world */

  /**
   * Compose one context's agent-scoped contributions: the prompt section
   * whose text provider reads the record's LATEST segment at every assembly
   * (per-turn freshness by construction), plus the caller-supplied tools.
   * Every registration is probed — a scope without the service degrades to
   * none rather than failing the agent's creation.
   * @param agentCtx - the agent's scope context (creation/resume setup, or `agent.ctx` live).
   * @param runtime - the context's runtime.
   */
  private contribute(agentCtx: Context, runtime: ContextRuntime): void {
    if (agentCtx.get('systemPrompt') !== undefined) {
      try {
        agentCtx.systemPrompt.section({
          name: SIDECHAT_SECTION_NAME,
          order: SIDECHAT_SECTION_ORDER,
          text: () => renderSegment(runtime.record.segment),
        })
      } catch (error) {
        this.ctx.logger.warn(`sidechat: the prompt section was refused: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    this.attachTools(agentCtx, runtime, [...runtime.tools.values()])
  }

  /**
   * Attach caller tools by name on one agent scope, replacing same-named
   * registrations (the caller's newer definition always wins). Origin tagging
   * is the CALLER's responsibility — side-chat never tags on its behalf.
   */
  private attachTools(agentCtx: Context, runtime: ContextRuntime, defs: readonly ToolDefinition[]): void {
    if (defs.length === 0 || agentCtx.get('tools') === undefined) return
    for (const def of defs) {
      try {
        runtime.toolDisposers.get(def.name)?.()
        runtime.toolDisposers.delete(def.name)
        runtime.toolDisposers.set(def.name, agentCtx.tools.register(def))
      } catch (error) {
        this.ctx.logger.warn(`sidechat: tool "${def.name}" was refused: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  /** The cwd one new side session inherits: the source conversation's when the contextKey names a live session, else the calling session's. */
  private inheritCwd(contextKey: string, calling: Agent | undefined): string | undefined {
    const source = this.ctx.sessions.get(SessionId(contextKey))
    if (source !== undefined) return source.header.cwd ?? undefined
    const cwd = calling?.session.header.cwd
    return cwd === undefined || cwd === '' ? undefined : cwd
  }

  /**
   * Create or cold-resume one context's agent, deduped per context. A resume
   * failure (a torn or removed session log) falls through to a FRESH session
   * rather than erroring the gesture — the mapping is corrected, the lost
   * history is simply gone.
   */
  private async ensureAgent(runtime: ContextRuntime, calling: Agent | undefined): Promise<Agent> {
    const { record } = runtime
    if (record.sessionId !== undefined) {
      const live = this.ctx.agents.get(SessionId(record.sessionId))
      if (live !== undefined) return live
    }
    runtime.pending ??= this.spawnAgent(runtime, calling).finally(() => { delete runtime.pending })
    return runtime.pending
  }

  /** One creation/resume pass for one context (see {@link ensureAgent}). */
  private async spawnAgent(runtime: ContextRuntime, calling: Agent | undefined): Promise<Agent> {
    const composition = await composeSideAgent(this.ctx, runtime.record.agentPreset ?? this.config.agentPreset)
    const setup: AgentSetup = async (agentCtx, agent) => {
      if (composition.setup !== undefined) await composition.setup(agentCtx, agent)
      this.contribute(agentCtx, runtime)
    }
    if (runtime.record.sessionId !== undefined) {
      try {
        const handle = await this.ctx.agents.resume({ resumeSessionId: SessionId(runtime.record.sessionId), setup })
        this.handles.set(runtime.record.contextKey, handle)
        return handle.agent
      } catch (error) {
        this.ctx.logger.warn(`sidechat: resuming "${runtime.record.contextKey}" failed, starting a fresh session: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    const cwd = this.inheritCwd(runtime.record.contextKey, calling)
    const handle = await this.ctx.agents.create({
      sessionId: SessionId(randomUUID()),
      meta: {
        ...cwd === undefined ? {} : { cwd },
        ...composition.agentPreset === undefined ? {} : { agentPreset: composition.agentPreset },
      },
      setup,
    })
    this.handles.set(runtime.record.contextKey, handle)
    runtime.record = {
      ...runtime.record,
      sessionId: String(handle.agent.session.id),
      ...composition.agentPreset === undefined ? {} : { agentPreset: composition.agentPreset },
      updatedAt: new Date().toISOString(),
    }
    await this.persist(calling?.session)
    return handle.agent
  }

  /* ------------------------------------------------------------- the seam */

  /**
   * The cross-plugin seam: open (or update) one side-chat context. Repeated
   * calls with the same contextKey UPDATE — the label, the prompt segment
   * (read fresh at the next assembly, never a create-time snapshot), the
   * caller tools (re-attached by name on the live agent), and any refs — and
   * NEVER recreate the session. The agent itself stays lazy: it spins up on
   * the first send, not here.
   * @param input - context identity, display label, and the optional prompt/tools/refs contributions.
   */
  async openWith(input: SideChatOpenInput): Promise<void> {
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
      // The prompt section reads the record fresh by itself; tools need a live re-attach.
      if (input.tools !== undefined && runtime.record.sessionId !== undefined) {
        const live = this.ctx.agents.get(SessionId(runtime.record.sessionId))
        if (live !== undefined) this.attachTools(live.ctx, runtime, input.tools)
      }
    })
  }

  /* -------------------------------------------------------- remote backing */

  /**
   * One context's full presentation state. Read-only: a cold context answers
   * from a persistence inspection, never by resuming its agent.
   * @param contextKey - the context to read.
   * @returns the state, or `not-found` when the context has no record yet.
   */
  async getState(contextKey: string): Promise<SideChatStateOutcome> {
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
    if (record.sessionId !== undefined) {
      const live = this.ctx.agents.get(SessionId(record.sessionId))
      if (live !== undefined) {
        status = live.status
        transcript = projectTranscript(live.session.snapshotEvents())
      } else {
        status = 'cold'
        const cold = await inspectCold(this.ctx, SessionId(record.sessionId))
        transcript = cold === undefined ? [] : projectTranscript(cold.events)
      }
    }
    return {
      contextKey: record.contextKey,
      label: record.label,
      status,
      refs: record.refs,
      transcript,
    }
  }

  /**
   * The openWith revisions of every known context — the surfacer's diff
   * basis. The lightest read the service offers: memory only, no projection,
   * no inspection, so a 2.5s poll costs one map iteration.
   * @returns contextKey → openWith revision pairs.
   */
  async surfaceHints(): Promise<SideChatSurfaceHints> {
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

  /**
   * List every known context, most recently active first. Each row carries
   * the latest assistant-row time of its journal projection (live contexts
   * from the snapshot, cold contexts from a persistence inspection — the
   * read-only path, never a resume) so the client can mark unread activity.
   * @returns the summaries with the live status overlay.
   */
  async listContexts(): Promise<SideChatListResult> {
    return this.mutate(async () => {
      await this.ensureLoaded()
      const items: SideChatContextSummary[] = []
      for (const runtime of this.contexts.values()) {
        items.push({
          contextKey: runtime.record.contextKey,
          label: runtime.record.label,
          status: liveStatusOf(this.ctx.agents, runtime.record),
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
   * ordering). Read-only: live from the snapshot, cold from an inspection.
   */
  private async activityOf(record: SideChatContextRecord): Promise<{ lastAssistantAt: number | null; lastActivityAt: number | null }> {
    if (record.sessionId === undefined) return { lastAssistantAt: null, lastActivityAt: null }
    const live = this.ctx.agents.get(SessionId(record.sessionId))
    const events = live !== undefined
      ? live.session.snapshotEvents()
      : (await inspectCold(this.ctx, SessionId(record.sessionId)))?.events
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
   * refs) fold into the message and clear, the context's agent spins up
   * lazily, and the turn starts as a plugin-sourced followup. The CALLING
   * agent's session only donates the fence and the cwd inheritance — the
   * message never touches it.
   * @param calling - the calling session's agent (the wire's agent-first convention).
   * @param request - contextKey, text, optional label and one-shot refs.
   * @returns the fresh state (already `running`), or the refusal.
   */
  async send(calling: Agent, request: SideChatSendRequest): Promise<SideChatSendOutcome> {
    const text = request.text.trim()
    if (text === '') return { ok: false, error: 'empty' }
    return this.mutate(async () => {
      await this.ensureLoaded()
      const runtime = this.ensureRuntime(request.contextKey, request.label)
      const refs: readonly SideChatRef[] = [...runtime.record.refs, ...(request.refs ?? [])].slice(-MAX_REFS_PER_CONTEXT)
      let agent: Agent
      try {
        agent = await this.ensureAgent(runtime, calling)
        runtime.record = { ...runtime.record, refs: [], updatedAt: new Date().toISOString() }
        await this.persist(calling.session)
      } catch (error) {
        if (error instanceof FsError) return { ok: false, error: 'io' }
        this.ctx.logger.warn(`sidechat: no agent for "${request.contextKey}": ${error instanceof Error ? error.message : String(error)}`)
        return { ok: false, error: 'agent-unavailable' }
      }
      agent.followup(createUserMessage({
        content: [{ type: 'text', text: foldRefsIntoText(refs, text) }],
        source: { kind: 'plugin', plugin: PACKAGE_NAME },
      }))
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

  /** Tear down every owned agent handle (plugin unload); the sessions stay persisted. */
  async disposeAgents(): Promise<void> {
    for (const handle of this.handles.values()) {
      await handle.dispose().catch(() => undefined)
    }
    this.handles.clear()
  }
}
