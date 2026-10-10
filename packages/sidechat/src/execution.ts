/**
 * The side-chat EXECUTION port (`SideChatExecutionBackend`): where one
 * context's agent session actually runs.
 *
 * The service core owns identity, the contexts document, refs, and the
 * transcript projection; EVERYTHING that touches a live execution target goes
 * through this port — lazy open (create) and cold resume per context, send
 * (one user message, refs already folded into the text), live read (status
 * plus the session event snapshot), cold read (a persisted session's events),
 * cancel (the stop gesture), and release (the ownership handle's dispose).
 * The default backend ({@link SideChatDefaultExecutionBackend}) is exactly
 * the `ctx.agents` behavior, extracted as-is; a mounting side injects its own
 * backend through `SideChatConfig.executionBackend` to execute elsewhere.
 * With an injected backend the service never falls back to deployment
 * defaults: execution, and any routing the payload does not settle, is the
 * backend's own business.
 *
 * Capabilities are declarative: a backend states what it honors
 * ({@link SideChatExecutionCapabilities}) and the service degrades per
 * capability — never a crash. The init payload's `segmentText`/`tools` are
 * LIVE READERS (in-process thunks, never on a wire): the per-turn-freshness
 * rule survives any backend, because the reader re-reads the record at every
 * assembly.
 *
 * @module @khorsheed/dsh-sidechat/execution
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentOptions, AgentSetup } from '@deepseek-ai/dsh-agent'
import { createUserMessage, type MessageSource } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
// Type-only: pulls the ctx.systemPrompt service merge (the agent-scope section registration).
import type {} from '@deepseek-ai/dsh-system-prompt'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { composeSideAgent, inspectCold, type SideAgentComposition } from './agent-setup.ts'
import { SIDECHAT_SECTION_NAME, SIDECHAT_SECTION_ORDER, type SideChatStatus } from './types.ts'

/** What one execution backend honors; every `false` degrades, never crashes. */
export interface SideChatExecutionCapabilities {
  /** Honors the resolved preset id (the default backend composes it through the probed presets roster). */
  readonly presets: boolean
  /** Renders the prompt-segment reader into the execution world's system prompt. */
  readonly promptContext: boolean
  /** Attaches caller-supplied tools to the execution agent (and hot-swaps them by name). */
  readonly callerTools: boolean
  /** Cancels a running turn on request (the service's stop verb; without it the stop is refused coded). */
  readonly cancel: boolean
  /** Reads a persisted-but-not-live session's events (without it cold reads answer honestly unknown). */
  readonly coldRead: boolean
}

/**
 * One open's payload: the service-owned identity plus everything the
 * resolution chains settled. `route`/`presetId`/`cwd` are the RESOLVED
 * values (explicit config first, then the calling session, the record, and
 * the plugin config — the route chain's last rung, the deployment-default
 * probe, runs only for the DEFAULT backend: an injected backend owns
 * execution and the service never falls back to deployment defaults). A
 * backend honors what its capabilities declare and ignores the rest.
 */
export interface SideChatExecutionOpenInit {
  /** The context this session binds. */
  readonly contextKey: string
  /** The service-owned session identity: fresh on a first open, the recorded one on resume. */
  readonly sessionId: string
  /** true when a persisted log for {@link sessionId} is expected (the cold-resume path); a resume failure throws. */
  readonly resume: boolean
  /** The resolved model route; absent when nothing resolved (an injected backend then routes on its own). */
  readonly route?: AgentOptions
  /** The resolved preset id (absent = the backend's own default); honored when capabilities.presets. */
  readonly presetId?: string
  /** The resolved cwd anchor — first open only (a resume replays what created the session). */
  readonly cwd?: string
  /** Live reader of the context's latest prompt segment — re-read at EVERY turn assembly, never a snapshot. */
  readonly segmentText: () => string
  /** Live reader of the caller-supplied tool definitions (by-name replacement semantics). */
  readonly tools: () => readonly ToolDefinition[]
}

/** One user message a session sends: the refs already folded into the text, the producer source riding along. */
export interface SideChatExecutionMessage {
  readonly text: string
  readonly source: MessageSource
}

/**
 * One live execution session (the backend's half of a context binding).
 * `release` tears the handle down; the session itself stays persisted.
 */
export interface SideChatExecutionSession {
  /** The service-assigned session identity (echoed from the open init). */
  readonly sessionId: string
  /** The roster-resolved preset id the service records on a first open, when one resolved. */
  readonly resolvedPresetId?: string | undefined
  /** Live status for the list/state overlay. */
  readonly status: Extract<SideChatStatus, 'idle' | 'running'>
  /** The session event stream snapshot (the transcript/activity projection's input). */
  events(): readonly SessionEvent[]
  /** Send one user message (fire-and-forget; the turn runs asynchronously). */
  send(message: SideChatExecutionMessage): void
  /** Caller tools changed (the openWith hot-swap): re-read the init's tools reader. Present when capabilities.callerTools. */
  syncTools?(): void
  /** Cancel the running turn (a no-op when idle). Present when the session can cancel. */
  cancel?(): void
  /** Release the ownership handle (plugin unload); the session stays persisted. */
  release(): Promise<void>
}

/** The execution port the service consumes for every live-target touch. */
export interface SideChatExecutionBackend {
  /** What this backend honors (the service degrades per flag, never crashes). */
  readonly capabilities: SideChatExecutionCapabilities
  /**
   * Lazy open (create) or cold resume of one context's session. A resume
   * failure THROWS — the service falls back to a fresh open itself (the
   * mapping is corrected, the lost history simply gone).
   */
  open(init: SideChatExecutionOpenInit): Promise<SideChatExecutionSession>
  /**
   * Cold read of one persisted session's events — never a resume. Answers
   * undefined when the session is unknown or unreadable. Present when
   * capabilities.coldRead.
   * @param sessionId - the recorded session identity.
   */
  readCold?(sessionId: string): Promise<readonly SessionEvent[] | undefined>
}

/**
 * Attach caller tools by name on one agent scope, replacing same-named
 * registrations (the caller's newer definition always wins). Origin tagging
 * is the CALLER's responsibility — side-chat never tags on its behalf.
 */
function attachTools(
  agentCtx: Context,
  disposers: Map<string, () => void>,
  defs: readonly ToolDefinition[],
  warn: (message: string) => void,
): void {
  if (defs.length === 0 || agentCtx.get('tools') === undefined) return
  for (const def of defs) {
    try {
      disposers.get(def.name)?.()
      disposers.delete(def.name)
      disposers.set(def.name, agentCtx.tools.register(def))
    } catch (error) {
      warn(`sidechat: tool "${def.name}" was refused: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

/** The default session: one live host agent (the create/resume ownership handle) behind the port. */
class DefaultExecutionSession implements SideChatExecutionSession {
  readonly resolvedPresetId?: string | undefined
  /** Present only when the underlying agent exposes a stop capability (an old host line may not). */
  readonly cancel?: () => void

  constructor(
    private readonly init: SideChatExecutionOpenInit,
    private readonly agent: Agent,
    private readonly handle: { dispose(): Promise<void> },
    resolvedPresetId: string | undefined,
    private readonly toolDisposers: Map<string, () => void>,
    private readonly warn: (message: string) => void,
  ) {
    this.resolvedPresetId = resolvedPresetId
    const cancel = (agent as Partial<Pick<Agent, 'cancel'>>).cancel
    if (typeof cancel === 'function') {
      this.cancel = () => agent.cancel({ kind: 'user' })
    }
  }

  get sessionId(): string {
    return String(this.agent.session.id)
  }

  get status(): 'idle' | 'running' {
    return this.agent.status
  }

  events(): readonly SessionEvent[] {
    return this.agent.session.snapshotEvents()
  }

  send(message: SideChatExecutionMessage): void {
    this.agent.followup(createUserMessage({
      content: [{ type: 'text', text: message.text }],
      source: message.source,
    }))
  }

  syncTools(): void {
    attachTools(this.agent.ctx, this.toolDisposers, this.init.tools(), this.warn)
  }

  release(): Promise<void> {
    return this.handle.dispose()
  }
}

/**
 * The default execution backend: the `ctx.agents` behavior, extracted as-is
 * — create/resume through the Context's agents registry with the resolved
 * route/preset/cwd, the preset composed through the (probed) roster, the
 * prompt section and caller tools contributed to the agent's scope, cold
 * reads from persistence, cancel through the agent's own stop capability.
 * Every scope contribution stays probed: a scope without the service
 * degrades to none rather than failing the agent's creation.
 */
export class SideChatDefaultExecutionBackend implements SideChatExecutionBackend {
  readonly capabilities: SideChatExecutionCapabilities = {
    presets: true,
    promptContext: true,
    callerTools: true,
    cancel: true,
    coldRead: true,
  }

  /**
   * @param ctx - the service's own context (the agents registry, the probed rosters).
   */
  constructor(private readonly ctx: Context) {}

  async open(init: SideChatExecutionOpenInit): Promise<SideChatExecutionSession> {
    // The route MUST travel with both create and resume: resume rebuilds the
    // agent world with no logged header yet, so the seed route comes from
    // these options alone.
    const agentOptions = init.route
    const toolDisposers = new Map<string, () => void>()
    const warn = (message: string): void => { this.ctx.logger.warn(message) }
    const setupFor = (composition: SideAgentComposition): AgentSetup =>
      async (agentCtx, agent) => {
        if (composition.setup !== undefined) await composition.setup(agentCtx, agent)
        if (agentCtx.get('systemPrompt') !== undefined) {
          try {
            agentCtx.systemPrompt.section({
              name: SIDECHAT_SECTION_NAME,
              order: SIDECHAT_SECTION_ORDER,
              text: init.segmentText,
            })
          } catch (error) {
            warn(`sidechat: the prompt section was refused: ${error instanceof Error ? error.message : String(error)}`)
          }
        }
        attachTools(agentCtx, toolDisposers, init.tools(), warn)
      }
    if (init.resume) {
      // History was composed under the recorded preset — resume keeps it
      // (the header's comment semantics: replay under what created it). A
      // failure (a torn or removed log) throws; the service falls back to a
      // fresh open.
      const composition = await composeSideAgent(this.ctx, init.presetId)
      const handle = await this.ctx.agents.resume({
        resumeSessionId: SessionId(init.sessionId),
        ...agentOptions === undefined ? {} : { agentOptions },
        setup: setupFor(composition),
      })
      return new DefaultExecutionSession(init, handle.agent, handle, undefined, toolDisposers, warn)
    }
    const composition = await composeSideAgent(this.ctx, init.presetId)
    const handle = await this.ctx.agents.create({
      sessionId: SessionId(init.sessionId),
      meta: {
        ...init.cwd === undefined ? {} : { cwd: init.cwd },
        ...composition.agentPreset === undefined ? {} : { agentPreset: composition.agentPreset },
      },
      ...agentOptions === undefined ? {} : { agentOptions },
      setup: setupFor(composition),
    })
    return new DefaultExecutionSession(init, handle.agent, handle, composition.agentPreset, toolDisposers, warn)
  }

  async readCold(sessionId: string): Promise<readonly SessionEvent[] | undefined> {
    const cold = await inspectCold(this.ctx, SessionId(sessionId))
    return cold?.events
  }
}
