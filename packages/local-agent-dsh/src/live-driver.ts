import type { LocalAgentResolvedConfiguration } from '@khorsheed/dsh-local-agent/types'
/**
 * The dsh provider's live driver: one resident sub-dsh serve process per
 * member (child session), driven over the family-internal wire
 * (`@khorsheed/dsh-local-agent-dsh-headless/wire`). A delegation round is a
 * `turn/start` request to the member's resident runtime instead of a fresh
 * one-shot process, which buys what the process boundary could not:
 * runtime-level graceful interrupt (`turn/interrupt` → in-process
 * `Agent.cancel`; the process survives and the session stays continuable)
 * and push-mode mirroring (session events arrive as `session/event`
 * notifications and are mirrored event-by-event through the same fold the
 * file mirror owns, with the file-based `mirrorDshSession` as the settle
 * reconciliation pass).
 *
 * Lifecycle (the mode's main cost): the runtime spawns lazily on the member's
 * first live round, is reclaimed after an idle timeout or on plugin unload,
 * and is re-spawned — resuming the on-disk session — after a crash. Every
 * process is registered in {@link DshLiveDriver.runtimes} until reclaimed, so
 * no zombies survive a profile restart.
 * @module @khorsheed/dsh-local-agent-dsh/live-driver
 */

import { StringDecoder } from 'node:string_decoder'
import type { Context } from '@deepseek-ai/cordis'
import { BlockAssembler, createAssistantMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import {
  settleRunResult,
  subprocessRunHandle,
  type SubagentResult,
  type SubagentRun,
  type SubagentStartRequest,
  type SubagentStopReason,
} from '@deepseek-ai/dsh-subagent'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { delegationEnv, persistChildSession, LiveStreamPublisher, LiveFlush } from '@khorsheed/dsh-local-agent'
import {
  LIVE_SERVER_NAME,
  LIVE_WIRE_PROTOCOL_VERSION,
  type LiveAssistantStreamParams,
  type LiveInitializeResult,
  type LiveTurnReason,
  type LiveTurnStartResult,
} from '@khorsheed/dsh-local-agent-dsh-headless/wire'
import type { LocalAgentDshConfig } from './index.ts'
import {
  DEFAULT_DISPOSE_GRACE_MS,
  dshLaunchArgv,
  dshTextTask,
  registerMemberRun,
  resolveApiKey,
} from './dsh-cli-provider.ts'
import { DEFAULT_SUB_PROFILE_NAME, provisionDshSubProfile } from './provision.ts'
import { mirrorDshLiveEvent, mirrorDshSession, type DshLiveMirrorGranularity } from './session-mirror.ts'

type AssistantStreamFrame = LiveAssistantStreamParams['frame']

/** Default idle lifetime of an unused resident runtime before reclaim. */
export const DEFAULT_LIVE_IDLE_MS = 30 * 60_000

/** Default timeout for a wire request acknowledgement. */
export const DEFAULT_LIVE_REQUEST_TIMEOUT_MS = 30_000

/** Default timeout for the serve handshake (a cold sub-dsh boot can be slow). */
export const DEFAULT_LIVE_INITIALIZE_TIMEOUT_MS = 60_000

/** Bounded wait for an interrupted turn to converge while a run disposes. */
export const DEFAULT_LIVE_DISPOSE_CONVERGE_MS = 5_000

/** Bounded wait for a reclaimed runtime's own shutdown before SIGTERM. */
const RECLAIM_SHUTDOWN_GRACE_MS = 1_000

/** How long the channel stays broken before a round retries live. */
export const DEFAULT_LIVE_CHANNEL_RETRY_MS = 5 * 60_000

/**
 * The serve channel could not come up (spawn failure or handshake
 * timeout/mismatch). The provider catches exactly this and falls back to the
 * exec one-shot; any other error is a real round failure.
 */
export class LiveChannelUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LiveChannelUnavailableError'
  }
}

/** Internal timeouts; tests inject small values. */
export interface DshLiveDriverTimeouts {
  readonly initializeMs: number
  readonly requestMs: number
  readonly convergeMs: number
  /** How long a broken channel stays on the exec fallback before a retry. */
  readonly channelRetryMs: number
}

const DEFAULT_TIMEOUTS: DshLiveDriverTimeouts = {
  initializeMs: DEFAULT_LIVE_INITIALIZE_TIMEOUT_MS,
  requestMs: DEFAULT_LIVE_REQUEST_TIMEOUT_MS,
  convergeMs: DEFAULT_LIVE_DISPOSE_CONVERGE_MS,
  channelRetryMs: DEFAULT_LIVE_CHANNEL_RETRY_MS,
}

/** Fully resolved inputs for one live round (the live counterpart of DshCliRunSpec). */
export interface DshLiveRoundSpec {
  /** Parent Session workspace; also the runtime process cwd. */
  readonly cwd: string
  /** The `dsh` harness's scoped home, injected as the runtime's `$DSH_HOME`. */
  readonly homeDir: string
  /** dsh subagent session recording this delegation (always live on this path). */
  readonly childSession: Session
  /** The sub-dsh session id — the caller-supplied uuid, == the child session id. */
  readonly sessionId: string
  /** The delegating session (member-channel registration). */
  readonly parentSessionId: string
  /** Resume round: continue the session, appending under this turn number. */
  readonly resume?: { readonly turn: number } | undefined
  /**
   * The member's START model — the delegation's own requested model, or the
   * composer's session-level override, as resolved by the provider. When it
   * names one, a resident runtime bound to a DIFFERENT model is retired
   * before the spawn so the round respawns onto it (the sub-dsh session
   * resumes from disk — only the process is replaced). Absent means the
   * spawn resolver decides (override → settings).
   */
  readonly startModel?: string | undefined
  readonly configuration?: LocalAgentResolvedConfiguration
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function thrown(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

/**
 * One resident serve process: the wire client, the process registry entry,
 * and the reclaim ladder (wire shutdown → grace → SIGTERM → grace → SIGKILL
 * via the subprocess handle's own terminate).
 */
class LiveRuntime {
  /** Set once the process exited or was reclaimed; a dead runtime never serves again. */
  dead = false
  /**
   * The model this process bound at spawn (`--model`), or undefined when it
   * spawned with no model flag at all. A round whose start model differs
   * retires the runtime instead of silently running the old one.
   */
  configurationKey: string | undefined
  boundModel: string | undefined
  private reclaimed = false
  private readonly pending = new Map<number, {
    resolve: (result: unknown) => void
    reject: (error: Error) => void
    timer: NodeJS.Timeout
  }>()
  private nextId = 0
  private buffer = ''
  private readonly decoder = new StringDecoder('utf8')
  private readonly stderrDecoder = new StringDecoder('utf8')
  private stderrTail = ''

  /**
   * Per-round handlers, installed by the active round (one at a time per
   * member) and CLEARED when it settles — a notification with no active
   * round is dropped, never delivered into a stale closure.
   */
  onEvent: ((sessionId: string, turn: number | null, event: SessionEvent) => void) | undefined
  onStream: ((sessionId: string, turn: number, frame: AssistantStreamFrame) => void) | undefined
  onIdle: ((sessionId: string, turn: number, reason: LiveTurnReason | null) => void) | undefined
  /** Fires once when the process dies or is reclaimed (driver bookkeeping). */
  onDead: (() => void) | undefined

  constructor(
    readonly child: SubprocessHandle,
    private readonly timeouts: DshLiveDriverTimeouts,
    private readonly warn: (message: string) => void,
  ) {
    // StringDecoders hold a multi-byte UTF-8 tail split across chunks instead
    // of corrupting it into U+FFFD (the wire carries arbitrary CJK text).
    child.stdout?.on('data', (chunk: Buffer) => { this.feed(this.decoder.write(chunk)) })
    child.stderr?.on('data', (chunk: Buffer) => {
      this.stderrTail = (this.stderrTail + this.stderrDecoder.write(chunk)).slice(-4096)
    })
    void child.done.then(
      () => { this.markDead() },
      () => { this.markDead() },
    )
  }

  /** Diagnostic tail for round-failure logs. */
  get diagnostics(): string {
    return this.stderrTail.trim()
  }

  private feed(text: string): void {
    this.buffer += text
    let index = this.buffer.indexOf('\n')
    while (index >= 0) {
      const line = this.buffer.slice(0, index)
      this.buffer = this.buffer.slice(index + 1)
      index = this.buffer.indexOf('\n')
      if (line.trim() === '') continue
      this.dispatchLine(line)
    }
  }

  /** Handle one wire line; a malformed or hostile line never escapes this frame. */
  private dispatchLine(line: string): void {
    let message: { id?: unknown; result?: unknown; error?: unknown; method?: unknown; params?: unknown }
    try {
      message = JSON.parse(line) as typeof message
    } catch {
      this.warn('subagent-dsh live: ignored a malformed wire line')
      return
    }
    try {
      if (typeof message.id === 'number' && ('result' in message || 'error' in message)) {
        const request = this.pending.get(message.id)
        if (request === undefined) return
        this.pending.delete(message.id)
        clearTimeout(request.timer)
        const wireError = message.error as { message?: string } | undefined
        if (wireError !== undefined && wireError !== null) {
          request.reject(new Error(`subagent-dsh live: ${wireError.message ?? 'wire error'}`))
        } else {
          request.resolve(message.result)
        }
        return
      }
      const params = (message.params ?? {}) as { sessionId?: unknown; turn?: unknown; event?: unknown; reason?: unknown; frame?: unknown }
      if (typeof params.sessionId !== 'string') return
      if (message.method === 'session/event') {
        const event = params.event as SessionEvent | undefined
        if (event === null || typeof event !== 'object' || typeof event.type !== 'string') return
        this.onEvent?.(params.sessionId, typeof params.turn === 'number' ? params.turn : null, event)
      } else if (message.method === 'session/assistant-stream') {
        if (typeof params.turn !== 'number' || params.frame === null || typeof params.frame !== 'object') return
        this.onStream?.(params.sessionId, params.turn, params.frame as AssistantStreamFrame)
      } else if (message.method === 'session/idle') {
        if (typeof params.turn !== 'number') return
        this.onIdle?.(params.sessionId, params.turn, (params.reason ?? null) as LiveTurnReason | null)
      }
    } catch (error) {
      // A handler fault (bad event shape, append failure) degrades to a warn;
      // the wire pump and the process stay alive.
      this.warn(`subagent-dsh live: notification handler failed: ${thrown(error).message}`)
    }
  }

  /** Send one request and await its acknowledgement. */
  request<T>(method: string, params: Record<string, unknown>, timeoutMs?: number): Promise<T> {
    if (this.dead) {
      return Promise.reject(new Error('subagent-dsh live: the runtime process is gone'))
    }
    this.nextId += 1
    const id = this.nextId
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`subagent-dsh live: ${method} timed out`))
        timer.unref()
      }, timeoutMs ?? this.timeouts.requestMs)
      timer.unref()
      this.pending.set(id, {
        resolve: result => resolve(result as T),
        reject,
        timer,
      })
      this.child.stdin?.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    })
  }

  private markDead(): void {
    if (this.dead) return
    this.dead = true
    for (const request of this.pending.values()) {
      clearTimeout(request.timer)
      request.reject(new Error('subagent-dsh live: the runtime process exited'))
    }
    this.pending.clear()
    this.onDead?.()
  }

  /** Graceful teardown: wire shutdown, a beat to exit on its own, then the terminate ladder. */
  async reclaim(): Promise<void> {
    if (this.reclaimed) return
    this.reclaimed = true
    if (!this.dead) {
      await this.request('shutdown', {}, RECLAIM_SHUTDOWN_GRACE_MS).catch(() => {})
      await Promise.race([this.child.done.catch(() => {}), delay(RECLAIM_SHUTDOWN_GRACE_MS)])
    }
    if (!this.dead) {
      // Host 0.1.5 hides the child pid; terminate() is an idempotent no-op
      // once the managed range is gone.
      this.child.terminate()
      await this.child.waitForExit()
    }
    await this.child.done.catch(() => {})
    this.markDead()
  }
}

/**
 * The live driver owns every resident runtime of this provider generation.
 * The LiveDriverSwitch builds a generation when the settings resolve live on,
 * retires one with {@link DshLiveDriver.drain} (never interrupts), and
 * disposes with the enabled toggle (disposeAll).
 */
export class DshLiveDriver {
  private readonly runtimes = new Map<string, LiveRuntime>()
  /** In-flight spawns by member: concurrent rounds share one, disposeAll waits them out. */
  private readonly ensuring = new Map<string, Promise<LiveRuntime>>()
  private readonly idleTimers = new Map<string, NodeJS.Timeout>()
  /** Per-member round serialization (the resume lock covers resume-vs-resume only). */
  private readonly roundChains = new Map<string, Promise<unknown>>()
  /** When the channel last failed its spawn/handshake probe (breaker with cooldown). */
  private channelBrokenAt: number | undefined
  private disposed = false
  /**
   * Set by drain() (a settings-driven generation handoff): new rounds are
   * refused so the provider falls back to exec, while in-flight rounds finish
   * on their runtime undisturbed. Unlike `disposed`, the driver still serves
   * what it already accepted.
   */
  private draining = false
  /** Aborts in-flight spawns when the driver is disposed mid-handshake. */
  private readonly disposeController = new AbortController()

  constructor(
    private readonly ctx: Context,
    private readonly config: LocalAgentDshConfig & {
      /**
       * Resolver for the member's configured model, read at each RUNTIME
       * SPAWN (the serve process is where a live round's model binds, through
       * its `--model` flag). Receives the member's child session id so the
       * session-level override can outrank the settings value; absent, or
       * resolving to nothing, the spawn carries no `--model` and the sub-dsh
       * inherits the host instance's default selection.
       */
      modelFor?: (childSessionId: string) => string | undefined
    },
    private readonly timeouts: DshLiveDriverTimeouts = DEFAULT_TIMEOUTS,
  ) {}

  /**
   * Whether the channel is in its post-failure cooldown. A spawn/handshake
   * failure trips the breaker (rounds fall back to exec), but only for
   * `channelRetryMs` — a transient boot fault must not disable live driving
   * until the next plugin reload.
   */
  get disabled(): boolean {
    return this.channelBrokenAt !== undefined
      && Date.now() - this.channelBrokenAt < (this.timeouts.channelRetryMs ?? DEFAULT_LIVE_CHANNEL_RETRY_MS)
  }

  /** Count of resident runtimes currently registered (zombie accounting in tests). */
  get liveCount(): number {
    return this.runtimes.size
  }

  private clearIdleTimer(key: string): void {
    const timer = this.idleTimers.get(key)
    if (timer !== undefined) clearTimeout(timer)
    this.idleTimers.delete(key)
  }

  /** Arm the idle reaper; every round settlement re-arms it. */
  private armIdleTimer(key: string): void {
    this.clearIdleTimer(key)
    const idleMs = this.config.liveIdleMs ?? DEFAULT_LIVE_IDLE_MS
    const timer = setTimeout(() => { void this.reclaim(key) }, idleMs)
    timer.unref()
    this.idleTimers.set(key, timer)
  }

  /** Reclaim one runtime: deregister, wire shutdown, terminate ladder, member release. */
  private async reclaim(key: string): Promise<void> {
    const runtime = this.runtimes.get(key)
    this.clearIdleTimer(key)
    if (runtime === undefined) return
    this.runtimes.delete(key)
    await runtime.reclaim()
  }

  /** Reclaim every runtime (plugin unload); no process survives the profile. */
  async disposeAll(): Promise<void> {
    this.disposed = true
    // Abort in-flight spawns (their handshakes race this signal), then wait
    // them out: each self-reclaims, so no process registers past the teardown.
    this.disposeController.abort()
    await Promise.all([...this.ensuring.values()].map(pending => pending.catch(() => undefined)))
    for (const key of [...this.runtimes.keys()]) {
      await this.reclaim(key)
    }
  }

  /**
   * True while the member's runtime exists or is being spawned. The settings
   * controller gates a new generation on this: a fresh driver must not serve
   * a member whose retiring generation still hosts the (same) sub-dsh session.
   */
  hasRuntime(key: string): boolean {
    return this.runtimes.has(key) || this.ensuring.has(key)
  }

  /** @deprecated Compatibility no-op: live output is always incremental. */
  setLiveMirrorGranularity(_granularity: DshLiveMirrorGranularity): void {}

  /**
   * Drain for a settings-driven generation handoff: refuse new rounds (the
   * provider's catch falls back to exec), let every in-flight round finish on
   * its runtime, then reclaim. Resolves when no runtime or spawn remains.
   * Unlike disposeAll, in-flight work is never interrupted.
   */
  async drain(): Promise<void> {
    this.draining = true
    // Snapshot: rounds chain synchronously at startRound, so every accepted
    // round is already in roundChains; anything later is refused.
    const keys = new Set([...this.runtimes.keys(), ...this.ensuring.keys(), ...this.roundChains.keys()])
    await Promise.all([...keys].map(async (key) => {
      await (this.roundChains.get(key) ?? Promise.resolve()).catch(() => undefined)
      await (this.ensuring.get(key) ?? Promise.resolve()).catch(() => undefined)
      await this.reclaim(key)
    }))
  }

  /**
   * The model the member's live runtime bound at spawn: the identifier, or
   * undefined when the runtime spawned with no `--model`. Null when the
   * member has no live runtime in this generation — the broker's switch check
   * distinguishes "no runtime to retire" from "runtime bound to no model".
   */
  boundModelOf(key: string): string | undefined | null {
    const runtime = this.runtimes.get(key)
    if (runtime === undefined || runtime.dead) return null
    return runtime.boundModel
  }

  /**
   * Retire the member's resident runtime so the NEXT round respawns (the
   * sub-dsh session itself carries over via the on-disk resume). The
   * composer's model switch calls this after storing the new override; the
   * caller guarantees no round is in flight for the member.
   */
  async retireRuntime(key: string): Promise<void> {
    await this.reclaim(key)
  }

  /**
   * The member's live runtime, spawning it (once per member at a time) when
   * absent or dead. `signal` abandons the spawn on cancellation.
   */
  private async ensureRuntime(spec: DshLiveRoundSpec, apiKey: string, signal: AbortSignal): Promise<LiveRuntime> {
    const key = spec.sessionId
    const startModel = spec.startModel?.trim()
    const existing = this.runtimes.get(key)
    if (existing !== undefined && !existing.dead) {
      // A round that names its own start model never runs on a runtime bound
      // to a different one: retire so the respawn binds the asked-for model
      // (the sub-dsh session resumes from disk — only the process is
      // replaced).
      if ((spec.configuration !== undefined && existing.configurationKey !== JSON.stringify(spec.configuration))
        || (spec.configuration === undefined && existing.configurationKey !== undefined)
        || (startModel !== undefined && startModel !== '' && existing.boundModel !== startModel)) {
        await this.reclaim(key)
      } else {
        this.clearIdleTimer(key)
        return existing
      }
    } else if (existing !== undefined) {
      this.runtimes.delete(key)
    }
    const pending = this.ensuring.get(key)
    if (pending !== undefined) return pending
    const spawn = this.spawnRuntime(spec, apiKey, signal)
      .finally(() => { this.ensuring.delete(key) })
    this.ensuring.set(key, spawn)
    return spawn
  }

  /**
   * Spawn the member's resident runtime and prove the wire with a handshake.
   * Spawn/handshake failure trips the channel breaker (exec fallback) and
   * throws {@link LiveChannelUnavailableError}; a later crash is NOT a broken
   * channel — the next round re-spawns and resumes the on-disk session. A
   * cancellation mid-spawn reclaims the half-started runtime and throws the
   * abort instead, without touching the breaker.
   */
  private async spawnRuntime(spec: DshLiveRoundSpec, apiKey: string, signal: AbortSignal): Promise<LiveRuntime> {
    const key = spec.sessionId
    if (this.disposed) {
      throw new LiveChannelUnavailableError('the live driver is disposed')
    }
    const profileName = this.config.profileName ?? DEFAULT_SUB_PROFILE_NAME
    // The member-channel coordinates ride the spawn env: the resident process
    // carries them for its whole lifetime, so the token is registered with the
    // process (released on reclaim/crash), not per round like the exec path.
    const member = registerMemberRun(this.ctx, 'dsh-cli', spec.sessionId, spec.parentSessionId)
    // The model binds at spawn through the headless launch's `--model`, which
    // under `--serve` applies to every session the resident process hosts —
    // one process carries one member, so this IS the member's model. The
    // member's START model (a delegation-level request or the session-level
    // override, resolved by the provider) wins; otherwise the spawn resolver
    // reads the member's configured model (override → settings). A later
    // switch reaches the runtime by retiring it first.
    const startModel = spec.startModel?.trim()
    const model = spec.configuration !== undefined ? spec.configuration.model
      : startModel !== undefined && startModel !== '' ? startModel : this.config.modelFor?.(key)?.trim()
    const spawnSpec: SubprocessSpawnSpec = {
      argv: [
        ...dshLaunchArgv(this.config),
        '--profile', profileName,
        '--serve',
        ...model === undefined || model === '' ? [] : ['--model', model],
        ...spec.configuration?.effort === undefined ? [] : ['--effort', spec.configuration.effort],
      ],
      cwd: spec.cwd,
      stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
      graceMs: DEFAULT_DISPOSE_GRACE_MS,
      // Same explicit env layer as the exec path: the credential-shaped key
      // and the DSH_* facts survive the shared scrub only here.
      env: delegationEnv({
        DSH_HOME: spec.homeDir,
        DEEPSEEK_API_KEY: apiKey,
        // Same tsx tsconfig carry-over as the exec path (see startDshCliRun).
        ...process.env.TSX_TSCONFIG_PATH === undefined
          ? {}
          : { TSX_TSCONFIG_PATH: process.env.TSX_TSCONFIG_PATH },
        ...member === undefined ? {} : member.env,
      }),
    }
    let child: SubprocessHandle
    try {
      child = this.ctx.subprocess.spawn(spawnSpec)
    } catch (error) {
      member?.release()
      this.markChannelBroken()
      throw new LiveChannelUnavailableError(`the serve process failed to spawn: ${thrown(error).message}`)
    }
    const runtime = new LiveRuntime(child, this.timeouts, message => { this.ctx.logger.warn(message) })
    // A blank resolution binds no model at all — record exactly what the argv
    // carries so a later start-model comparison never retires needlessly.
    runtime.boundModel = model === undefined || model === '' ? undefined : model
    runtime.configurationKey = spec.configuration === undefined ? undefined : JSON.stringify(spec.configuration)
    runtime.onDead = () => {
      // Delete only OUR registration: a crash-then-respawn can interleave so
      // the dead runtime's late onDead would otherwise evict the NEW
      // runtime's entry and leak it (the registry race the review caught).
      if (this.runtimes.get(key) === runtime) this.runtimes.delete(key)
      this.clearIdleTimer(key)
      member?.release()
    }
    const aborted = new Promise<never>((_, reject) => {
      const cancel = (): void => { reject(new Error('subagent-dsh: run cancelled locally')) }
      const unload = (): void => { reject(new LiveChannelUnavailableError('the live driver was disposed during spawn')) }
      if (signal.aborted) {
        cancel()
        return
      }
      if (this.disposeController.signal.aborted) {
        unload()
        return
      }
      signal.addEventListener('abort', cancel, { once: true })
      this.disposeController.signal.addEventListener('abort', unload, { once: true })
    })
    aborted.catch(() => {})
    try {
      const hello = await Promise.race([
        runtime.request<LiveInitializeResult>('initialize', {}, this.timeouts.initializeMs),
        aborted,
      ])
      if (hello.protocolVersion !== LIVE_WIRE_PROTOCOL_VERSION || hello.serverInfo.name !== LIVE_SERVER_NAME) {
        throw new Error('the serve handshake reported an unexpected identity')
      }
    } catch (error) {
      await runtime.reclaim()
      // A caller-cancelled handshake says nothing about the channel's health.
      if (signal.aborted) throw thrown(error)
      this.markChannelBroken()
      throw new LiveChannelUnavailableError(`the serve handshake failed: ${thrown(error).message}`)
    }
    if (this.disposed) {
      // The plugin unloaded mid-spawn: reclaim instead of leaking the process.
      await runtime.reclaim()
      throw new LiveChannelUnavailableError('the live driver was disposed during spawn')
    }
    // A good handshake heals the breaker (the cooldown retry path).
    this.channelBrokenAt = undefined
    this.runtimes.set(key, runtime)
    return runtime
  }

  private markChannelBroken(): void {
    this.channelBrokenAt = Date.now()
  }

  /**
   * Drive one delegation round on the member's resident runtime. Rounds of
   * one member are strictly serialized: the facade's resume lock covers
   * resume-vs-resume only, and a resume racing an in-flight fresh round would
   * otherwise overwrite the runtime's single notification sink and strand
   * the earlier round forever.
   */
  /** Prepare the owned headless agent and validate its adapter without a model turn. */
  async prepare(spec: DshLiveRoundSpec, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    if (this.draining || this.disabled) throw new LiveChannelUnavailableError('the live driver is unavailable for preparation')
    try {
      provisionDshSubProfile(spec.homeDir, this.config)
      const apiKey = await resolveApiKey(this.ctx, this.config)
      const runtime = await this.ensureRuntime(spec, apiKey, signal)
      await runtime.request('session/prepare', { sessionId: spec.sessionId, resume: spec.resume !== undefined })
      signal.throwIfAborted()
      this.armIdleTimer(spec.sessionId)
    } catch (error) {
      await this.reclaim(spec.sessionId)
      throw error
    }
  }

  async startRound(request: SubagentStartRequest, spec: DshLiveRoundSpec): Promise<SubagentRun> {
    // A draining generation refuses new rounds BEFORE chaining so the
    // provider's exec fallback does not queue behind an in-flight round.
    if (this.draining) {
      throw new LiveChannelUnavailableError('the live driver is draining (a settings change retired this generation)')
    }
    const key = String(spec.childSession.id)
    const previous = this.roundChains.get(key) ?? Promise.resolve()
    const round = previous.catch(() => {}).then(() => this.startRoundLocked(request, spec))
    // The chain holds until the round's result SETTLES (never rejects by the
    // seam contract), not merely until the handle publishes.
    this.roundChains.set(key, round.then(
      handle => handle.result.catch(() => ({})),
      () => ({}),
    ))
    return round
  }

  /**
   * The serialized round body. Mirrors the exec run's settlement contract
   * exactly (settleRunResult + turn/end bookkeeping) so the facade, the
   * tool, and the projections cannot tell the difference — except `cancel`
   * is a runtime interrupt and the process survives. Cancellation is honored
   * in EVERY window: a slow spawn/handshake or a slow accept races the abort
   * signal and settles aborted instead of running the turn to completion
   * unwatched.
   */
  private async startRoundLocked(request: SubagentStartRequest, spec: DshLiveRoundSpec): Promise<SubagentRun> {
    const task = dshTextTask(request.prompt)
    if (request.signal.aborted) {
      throw new Error('subagent-dsh: request was aborted before the run started')
    }
    // The drain race: the round chained before drain() but dequeued after it.
    // Refuse so the provider falls back to exec instead of reusing a runtime
    // the handoff is about to reclaim.
    if (this.draining) {
      throw new LiveChannelUnavailableError('the live driver is draining (a settings change retired this generation)')
    }
    if (this.disposed) {
      throw new Error('subagent-dsh: the live driver is disposed')
    }

    const turn = spec.resume?.turn ?? 1
    const childSession = spec.childSession
    const localAgent = this.ctx.get('localAgent')

    const runAbort = new AbortController()
    let roundSettled = false
    let runtime: LiveRuntime | undefined
    /** True once turn/start may have reached the sub-dsh (interrupt becomes meaningful). */
    let acceptSent = false
    /** True once the parent's turn/start boundary is in the child session. */
    let turnOpened = false
    let lastText = ''
    let mirroredMessages = 0
    /** Events of this round that arrived before the boundary opened (same-chunk batching). */
    const bufferedEvents: ({ kind: 'event'; event: SessionEvent } | { kind: 'stream'; frame: AssistantStreamFrame })[] = []
    let persistQueue: Promise<unknown> = Promise.resolve()
    const persist = (): void => {
      persistQueue = persistQueue.then(() => persistChildSession(this.ctx, childSession))
    }

    const streamPublisher = localAgent?.liveStreams === undefined ? undefined
      : new LiveStreamPublisher(localAgent.liveStreams, childSession, turn, persist,
        error => this.ctx.logger.warn(`live checkpoint failed: ${String(error)}`))
    const liveFlush = new LiveFlush(error => this.ctx.logger.warn(`subagent-dsh: live flush failed: ${String(error)}`))
    let streaming: { id: string; step: number; assembler: BlockAssembler; next: number } | undefined
    const publishStream = (): void => {
      if (streaming === undefined || streamPublisher === undefined) return
      const blocks = streaming.assembler.interruptedBlocks()
      const text = blocks.map(block => 'text' in block ? block.text : '').join('\n\n')
      if (text !== '') streamPublisher.update(streaming.step, blocks.every(block => block.type === 'reasoning') ? 'think' : 'text', text)
    }
    const acceptStream = (frame: AssistantStreamFrame): void => {
      if (streamPublisher === undefined) return
      if (frame.type === 'start') {
        if (streaming !== undefined) liveFlush.cancel(streaming.step)
        streaming = { id: String(frame.attemptId), step: frame.step, assembler: new BlockAssembler(), next: 0 }
      } else if (frame.type === 'chunk' && streaming?.id === frame.attemptId) {
        if (frame.index < streaming.next) return
        if (frame.index !== streaming.next) throw new Error('non-contiguous DSH assistant stream')
        streaming.next++
        streaming.assembler.push(frame.chunk)
        liveFlush.schedule(streaming.step, publishStream)
      }
    }

    const requestCancel = (): void => {
      if (roundSettled || runAbort.signal.aborted) return
      runAbort.abort(new Error('subagent-dsh: run cancelled locally'))
      // The live driver's core win: a graceful runtime interrupt instead of a
      // process kill. Best-effort; local settlement does not wait for it.
      if (acceptSent && runtime !== undefined && !runtime.dead) {
        void runtime.request('turn/interrupt', { sessionId: spec.sessionId }).catch(() => {})
      }
    }
    const onAbort = (): void => { requestCancel() }
    // Registered before any await: a cancel during the slow spawn/handshake/
    // accept windows is exactly where the graceful interrupt matters most.
    request.signal.addEventListener('abort', onAbort, { once: true })

    const abortBranch = new Promise<never>((_, reject) => {
      runAbort.signal.addEventListener('abort', () => reject(new Error('subagent-dsh: run cancelled locally')), { once: true })
    })

    const mirrorOne = (event: SessionEvent): void => {
      const text = mirrorDshLiveEvent(childSession, event)
      if (event.type === 'assistant/message') {
        liveFlush.cancel(event.data.step)
        streamPublisher?.finish(event.data.step)
        if (streaming?.step === event.data.step) streaming = undefined
      }
      if (event.type === 'user/message' || event.type === 'assistant/message') {
        mirroredMessages += 1
        persist()
      }
      if (text !== undefined) {
        localAgent?.reportRunProgress(childSession.id, { kind: 'delta', text })
      }
      if (event.type === 'assistant/message' && text !== undefined && text !== '') lastText = text
    }

    const openTurn = (): void => {
      // The boundary opens after the accept ack (a definitive reject leaves no
      // dangling turn/start); events that arrived in the ack's chunk were
      // buffered and flush now, in wire order, inside the boundary.
      childSession.append('turn/start', { turn })
      turnOpened = true
      for (const entry of bufferedEvents.splice(0)) {
        if (entry.kind === 'event') mirrorOne(entry.event)
        else acceptStream(entry.frame)
      }
    }

    let resolveIdle!: (outcome: { reason: LiveTurnReason | null }) => void
    const idle = new Promise<{ reason: LiveTurnReason | null }>((resolve) => { resolveIdle = resolve })

    const installHandlers = (rt: LiveRuntime): void => {
      rt.onEvent = (sessionId, eventTurn, event) => {
        // Only this round's events: a cancelled round's late unwind (tagged
        // with ITS turn) and out-of-round events (null) never cross.
        if (sessionId !== spec.sessionId || eventTurn !== turn) return
        if (!turnOpened) {
          bufferedEvents.push({ kind: 'event', event })
          return
        }
        mirrorOne(event)
      }
      rt.onStream = (sessionId, eventTurn, frame) => {
        if (sessionId !== spec.sessionId || eventTurn !== turn || roundSettled) return
        if (!turnOpened) bufferedEvents.push({ kind: 'stream', frame })
        else acceptStream(frame)
      }
      rt.onIdle = (sessionId, idleTurn, reason) => {
        // Only this round's idle settles it — a cancelled round's unwind idle
        // must not mis-settle the round that is actually running.
        if (sessionId !== spec.sessionId || idleTurn !== turn) return
        resolveIdle({ reason })
      }
    }

    // Provisioning is idempotent; re-running heals a drifted sub-profile.
    provisionDshSubProfile(spec.homeDir, this.config)
    const apiKey = await resolveApiKey(this.ctx, this.config)

    const accepted: Promise<void> = (async () => {
      const rt = await this.ensureRuntime(spec, apiKey, request.signal)
      runtime = rt
      if (runAbort.signal.aborted) {
        // Cancelled while the runtime came up and no turn exists sub-side: the
        // fresh runtime serves nothing — reclaim it, don't warm an abandoned
        // member.
        await this.reclaim(spec.sessionId)
        throw new Error('subagent-dsh: run cancelled locally')
      }
      installHandlers(rt)
      acceptSent = true
      try {
        await rt.request<LiveTurnStartResult>('turn/start', {
          sessionId: spec.sessionId,
          text: task,
          resume: spec.resume !== undefined,
          turn,
        })
      } catch (error) {
        // The accept failed: the runtime's turn state is unknown, so do not
        // reuse it — reclaim and fail the round loudly. The turn never opened
        // parent-side, so no dangling turn/start (an explicit reject means
        // the sub-dsh provably never started the turn; the narrow timeout
        // race is the same class as exec's SIGKILL-mid-turn window).
        if (!runAbort.signal.aborted) await this.reclaim(spec.sessionId)
        throw thrown(error)
      }
      openTurn()
    })()

    const attempt: Promise<SubagentResult> = accepted.then(async () => {
      if (runAbort.signal.aborted) throw new Error('subagent-dsh: run cancelled locally')
      const rt = runtime as LiveRuntime
      const processFailure: Promise<never> = rt.child.done.then(
        outcome => Promise.reject(new Error(
          'subagent-dsh: the live runtime exited mid-round '
          + `(code ${String(outcome.exitCode)}, signal ${String(outcome.signal)})`,
        )),
        (error: unknown) => Promise.reject(thrown(error)),
      )
      processFailure.catch(() => {})
      const { reason } = await Promise.race([idle, processFailure])
      if (reason?.kind === 'aborted') {
        return { output: collectOutput(), stopReason: 'aborted' as const }
      }
      if (reason?.kind === 'error') {
        throw new Error(`subagent-dsh live: the turn failed: ${reason.error.message}`)
      }
      if (reason?.kind !== 'completed') {
        throw new Error('subagent-dsh live: the turn produced no outcome')
      }
      const output = collectOutput()
      if (output.length === 0) {
        throw new Error('subagent-dsh live: the turn completed but produced no answer')
      }
      return { output, stopReason: 'completed' as const }
    })

    const collectOutput = (): ContentBlock[] =>
      lastText === '' ? [] : [{ type: 'text', text: lastText }]

    const result: Promise<SubagentResult> = settleRunResult({
      attempt: () => Promise.race([attempt, abortBranch]),
      collectOutput,
      cancelled: () => runAbort.signal.aborted,
      onError: (error: Error, stopReason: SubagentStopReason) => {
        const diagnostics = runtime?.diagnostics ?? ''
        const suffix = diagnostics === '' ? '' : `; ${diagnostics}`
        this.ctx.logger.warn(`subagent-dsh: live round failed (${stopReason}): ${error.message}${suffix}`)
      },
      signal: request.signal,
      onAbort,
    }).then((settled) => {
      roundSettled = true
      liveFlush.dispose()
      if (turnOpened && streaming !== undefined && streamPublisher !== undefined) {
        const blocks = streaming.assembler.interruptedBlocks()
        if (blocks.length > 0) {
          childSession.append('assistant/message', {
            turn, step: streaming.step,
            message: createAssistantMessage({ content: blocks, source: { provider: 'dsh-local', model: 'unobserved' } }), stream: [],
            interrupted: true,
          }, { surfaceOp: 'append' })
          streamPublisher.finish(streaming.step)
          persist()
        }
      }
      streamPublisher?.dispose()
      // Identical turn/end bookkeeping to the exec path — but only for a turn
      // that actually opened (a pre-accept cancel records no turn at all).
      if (turnOpened) {
        if (settled.stopReason === 'completed') {
          childSession.append('turn/end', { turn, reason: { kind: 'completed' } })
        } else if (settled.stopReason === 'aborted') {
          childSession.append('turn/end', { turn, reason: { kind: 'aborted', reason: { kind: 'parent' } } })
        } else {
          childSession.append('turn/end', {
            turn,
            reason: { kind: 'error', error: { message: 'the live round did not complete', code: 'UNKNOWN' } },
          })
        }
      }
      // Settlement clears the round's handlers: a late notification drops at
      // the runtime frame instead of landing in a dead closure.
      if (runtime !== undefined) {
        runtime.onStream = undefined
        runtime.onEvent = undefined
        runtime.onIdle = undefined
      }
      return settled
    })

    // Settle reconciliation: the file-based mirror pass (the serve side flushed
    // before its idle notification) dedupes against the live-mirrored prefix
    // and catches anything the wire dropped; the final mirror progress report
    // is authoritative, exactly as in the exec path. Then re-arm the reaper. A
    // round that never opened owns no span — skip the pass entirely (it would
    // re-scan the previous round or, under exec fallback, fight its polling).
    void result.then(async () => {
      try {
        if (turnOpened) {
          await persistQueue
          if (mirroredMessages > 0) persist()
          await persistQueue.catch(() => {})
          const delta = await mirrorDshSession(this.ctx, childSession, spec.homeDir, spec.sessionId)
          if (localAgent !== undefined) {
            for (const text of delta.texts) {
              localAgent.reportRunProgress(childSession.id, { kind: 'delta', text })
            }
            localAgent.reportRunProgress(childSession.id, { kind: 'mirror', mirroredLines: delta.total })
            // Every settled round reports its observation through the
            // registry's channel (record merge + `settled` event) — the live
            // drive's half of the exec path's settle-mirror report: the
            // sub-dsh session's own model attribution, the round's usage and
            // tool-call accounting, each absent when the round's events name
            // none. Degrades silently on a core predating recordRoundSettled.
            const round = {
              ...delta.observedModel === undefined ? {} : { observedModel: delta.observedModel },
              ...delta.usage === undefined ? {} : { usage: delta.usage },
              ...delta.toolCalls === undefined ? {} : { toolCalls: delta.toolCalls },
            }
            const registry = localAgent as unknown as { recordRoundSettled?: (id: string, r: typeof round) => void } | undefined
            registry?.recordRoundSettled?.(childSession.id, round)
          }
        }
      } catch (error) {
        this.ctx.logger.warn(`subagent-dsh: live settle mirror failed: ${thrown(error).message}`)
      } finally {
        this.armIdleTimer(spec.sessionId)
      }
    })

    // Publication gate: hold start() until the turn is accepted (channel
    // errors still throw for the provider's exec fallback), but NEVER hold it
    // hostage to the slow windows — a cancel returns the run immediately and
    // the result settles aborted.
    await Promise.race([accepted, abortBranch.catch(() => undefined)])

    return subprocessRunHandle({
      id: childSession.id,
      result,
      signal: request.signal,
      onAbort,
      requestCancel,
      // The live teardown contract: NEVER kill the runtime here. The graceful
      // interrupt already went out via requestCancel; wait (bounded) for the
      // turn to converge so the runtime is left consistent for the next round.
      teardown: async () => {
        if (roundSettled) return
        await Promise.race([idle.catch(() => ({ reason: null })), delay(this.timeouts.convergeMs)])
      },
    })
  }
}
