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

import type { Context } from '@deepseek-ai/cordis'
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
import {
  LIVE_SERVER_NAME,
  LIVE_WIRE_PROTOCOL_VERSION,
  type LiveInitializeResult,
  type LiveSessionEventParams,
  type LiveSessionIdleParams,
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
}

const DEFAULT_TIMEOUTS: DshLiveDriverTimeouts = {
  initializeMs: DEFAULT_LIVE_INITIALIZE_TIMEOUT_MS,
  requestMs: DEFAULT_LIVE_REQUEST_TIMEOUT_MS,
  convergeMs: DEFAULT_LIVE_DISPOSE_CONVERGE_MS,
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
  private reclaimed = false
  private readonly pending = new Map<number, {
    resolve: (result: unknown) => void
    reject: (error: Error) => void
    timer: NodeJS.Timeout
  }>()
  private nextId = 0
  private buffer = ''
  private stderrTail = ''

  /** Per-round handlers, installed by the active round (one at a time per member). */
  onEvent: ((sessionId: string, event: SessionEvent) => void) | undefined
  onIdle: ((sessionId: string, reason: LiveTurnReason | null) => void) | undefined
  /** Fires once when the process dies or is reclaimed (driver bookkeeping). */
  onDead: (() => void) | undefined

  constructor(
    readonly child: SubprocessHandle,
    private readonly timeouts: DshLiveDriverTimeouts,
  ) {
    child.stdout?.on('data', (chunk: Buffer) => { this.feed(chunk.toString('utf8')) })
    child.stderr?.on('data', (chunk: Buffer) => {
      this.stderrTail = (this.stderrTail + chunk.toString('utf8')).slice(-4096)
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
      let message: { id?: unknown; result?: unknown; error?: unknown; method?: unknown; params?: unknown }
      try {
        message = JSON.parse(line) as typeof message
      } catch {
        continue
      }
      if (typeof message.id === 'number' && ('result' in message || 'error' in message)) {
        const request = this.pending.get(message.id)
        if (request === undefined) continue
        this.pending.delete(message.id)
        clearTimeout(request.timer)
        const wireError = message.error as { message?: string } | undefined
        if (wireError !== undefined && wireError !== null) {
          request.reject(new Error(`subagent-dsh live: ${wireError.message ?? 'wire error'}`))
        } else {
          request.resolve(message.result)
        }
        continue
      }
      if (message.method === 'session/event') {
        const params = message.params as LiveSessionEventParams
        this.onEvent?.(params.sessionId, params.event)
      } else if (message.method === 'session/idle') {
        const params = message.params as LiveSessionIdleParams
        this.onIdle?.(params.sessionId, params.reason)
      }
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
    if (!this.dead && this.child.pid > 0) {
      this.child.terminate()
      await this.child.waitForExit()
    }
    await this.child.done.catch(() => {})
    this.markDead()
  }
}

/**
 * The live driver owns every resident runtime of this provider generation.
 * Created only when `live: true`; disposed with the toggle (disposeAll).
 */
export class DshLiveDriver {
  private readonly runtimes = new Map<string, LiveRuntime>()
  private readonly idleTimers = new Map<string, NodeJS.Timeout>()
  /** Set when the channel proved unusable; the provider falls back to exec permanently. */
  private channelBroken = false

  constructor(
    private readonly ctx: Context,
    private readonly config: LocalAgentDshConfig,
    private readonly timeouts: DshLiveDriverTimeouts = DEFAULT_TIMEOUTS,
  ) {}

  /** Whether the channel already failed its spawn/handshake probe. */
  get disabled(): boolean {
    return this.channelBroken
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
    for (const key of [...this.runtimes.keys()]) {
      await this.reclaim(key)
    }
  }

  /**
   * Spawn the member's resident runtime and prove the wire with a handshake.
   * Spawn/handshake failure breaks the channel (exec fallback) and throws
   * {@link LiveChannelUnavailableError}; a later crash is NOT a broken
   * channel — the next round re-spawns and resumes the on-disk session.
   */
  private async ensureRuntime(spec: DshLiveRoundSpec, apiKey: string): Promise<LiveRuntime> {
    const key = spec.sessionId
    const existing = this.runtimes.get(key)
    if (existing !== undefined && !existing.dead) {
      this.clearIdleTimer(key)
      return existing
    }
    if (existing !== undefined) this.runtimes.delete(key)

    const profileName = this.config.profileName ?? DEFAULT_SUB_PROFILE_NAME
    // The member-channel coordinates ride the spawn env: the resident process
    // carries them for its whole lifetime, so the token is registered with the
    // process (released on reclaim/crash), not per round like the exec path.
    const member = registerMemberRun(this.ctx, 'dsh-cli', spec.sessionId, spec.parentSessionId)
    const spawnSpec: SubprocessSpawnSpec = {
      argv: [...dshLaunchArgv(this.config), '--profile', profileName, '--serve'],
      cwd: spec.cwd,
      stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
      graceMs: DEFAULT_DISPOSE_GRACE_MS,
      // Same explicit env layer as the exec path: the credential-shaped key
      // and the DSH_* facts survive the shared scrub only here.
      env: {
        DSH_HOME: spec.homeDir,
        DEEPSEEK_API_KEY: apiKey,
        ...member === undefined ? {} : member.env,
      },
    }
    let child: SubprocessHandle
    try {
      child = this.ctx.subprocess.spawn(spawnSpec)
    } catch (error) {
      member?.release()
      this.channelBroken = true
      throw new LiveChannelUnavailableError(`the serve process failed to spawn: ${thrown(error).message}`)
    }
    member?.bind(child.pid)
    const runtime = new LiveRuntime(child, this.timeouts)
    runtime.onDead = () => {
      this.runtimes.delete(key)
      this.clearIdleTimer(key)
      member?.release()
    }
    try {
      const hello = await runtime.request<LiveInitializeResult>('initialize', {}, this.timeouts.initializeMs)
      if (hello.protocolVersion !== LIVE_WIRE_PROTOCOL_VERSION || hello.serverInfo.name !== LIVE_SERVER_NAME) {
        throw new Error('the serve handshake reported an unexpected identity')
      }
    } catch (error) {
      await runtime.reclaim()
      this.channelBroken = true
      throw new LiveChannelUnavailableError(`the serve handshake failed: ${thrown(error).message}`)
    }
    this.runtimes.set(key, runtime)
    return runtime
  }

  /**
   * Drive one delegation round on the member's resident runtime. Mirrors the
   * exec run's settlement contract exactly (settleRunResult + turn/end
   * bookkeeping) so the facade, the tool, and the projections cannot tell the
   * difference — except `cancel` is a runtime interrupt and the process
   * survives.
   */
  async startRound(request: SubagentStartRequest, spec: DshLiveRoundSpec): Promise<SubagentRun> {
    const task = dshTextTask(request.prompt)
    if (request.signal.aborted) {
      throw new Error('subagent-dsh: request was aborted before the run started')
    }
    // Provisioning is idempotent; re-running heals a drifted sub-profile.
    provisionDshSubProfile(spec.homeDir, this.config)
    const apiKey = await resolveApiKey(this.ctx, this.config)
    const runtime = await this.ensureRuntime(spec, apiKey)

    const turn = spec.resume?.turn ?? 1
    const childSession = spec.childSession
    const granularity: DshLiveMirrorGranularity = this.config.liveMirrorGranularity ?? 'event'
    const localAgent = this.ctx.get('localAgent')

    // The turn opens BEFORE the wire request goes out: line processing is
    // synchronous, so the accept ack's chunk could also carry the turn's first
    // events, and a mirrored event landing before the parent's turn/start
    // would break the fold's round scoping (and double-mirror at settle). A
    // channel failure still leaves no dangling turn/start: the exec fallback
    // triggers only on ensureRuntime's LiveChannelUnavailableError above; an
    // accept failure below matches the exec path's spawn-failure precedent.
    childSession.append('turn/start', { turn })

    let lastText = ''
    let mirroredMessages = 0
    let persistQueue: Promise<unknown> = Promise.resolve()
    const persist = (): void => {
      persistQueue = persistQueue.then(() =>
        this.ctx.get('sessionPersistence')?.append(childSession.id, childSession.events))
    }
    runtime.onEvent = (sessionId, event) => {
      if (sessionId !== spec.sessionId) return
      const text = mirrorDshLiveEvent(childSession, event, { granularity })
      if (event.type === 'user/message' || event.type === 'assistant/message') {
        mirroredMessages += 1
        persist()
      }
      if (text !== undefined) {
        localAgent?.reportRunProgress(childSession.id, { kind: 'delta', text })
      }
      if (event.type === 'assistant/message' && text !== undefined && text !== '') lastText = text
    }

    const idle = new Promise<{ reason: LiveTurnReason | null }>((resolve) => {
      runtime.onIdle = (sessionId, reason) => {
        if (sessionId === spec.sessionId) resolve({ reason })
      }
    })

    try {
      await runtime.request<LiveTurnStartResult>('turn/start', {
        sessionId: spec.sessionId,
        text: task,
        resume: spec.resume !== undefined,
      })
    } catch (error) {
      // The accept failed: the runtime's turn state is unknown, so do not
      // reuse it — reclaim and fail the round loudly.
      await this.reclaim(spec.sessionId)
      throw thrown(error)
    }

    const runAbort = new AbortController()
    let roundSettled = false
    const requestCancel = (): void => {
      if (roundSettled || runAbort.signal.aborted) return
      runAbort.abort(new Error('subagent-dsh: run cancelled locally'))
      // The live driver's core win: a graceful runtime interrupt instead of a
      // process kill. Best-effort; local settlement does not wait for it.
      void runtime.request('turn/interrupt', { sessionId: spec.sessionId }).catch(() => {})
    }
    const onAbort = (): void => { requestCancel() }
    request.signal.addEventListener('abort', onAbort, { once: true })

    const abortBranch = new Promise<never>((_, reject) => {
      runAbort.signal.addEventListener('abort', () => reject(new Error('subagent-dsh: run cancelled locally')), { once: true })
    })

    const processFailure: Promise<never> = runtime.child.done.then(
      outcome => Promise.reject(new Error(
        'subagent-dsh: the live runtime exited mid-round '
        + `(code ${String(outcome.exitCode)}, signal ${String(outcome.signal)})`,
      )),
      (error: unknown) => Promise.reject(thrown(error)),
    )
    processFailure.catch(() => {})

    const collectOutput = (): ContentBlock[] =>
      lastText === '' ? [] : [{ type: 'text', text: lastText }]

    const result: Promise<SubagentResult> = settleRunResult({
      attempt: () => Promise.race([
        idle.then(({ reason }) => {
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
        }),
        processFailure,
        abortBranch,
      ]),
      collectOutput,
      cancelled: () => runAbort.signal.aborted,
      onError: (error: Error, stopReason: SubagentStopReason) => {
        const suffix = runtime.diagnostics === '' ? '' : `; ${runtime.diagnostics}`
        this.ctx.logger.warn(`subagent-dsh: live round failed (${stopReason}): ${error.message}${suffix}`)
      },
      signal: request.signal,
      onAbort,
    }).then((settled) => {
      roundSettled = true
      // Identical turn/end bookkeeping to the exec path.
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
      return settled
    })

    // Settle reconciliation: the file-based mirror pass (the serve side flushed
    // before its idle notification) dedupes against the live-mirrored prefix
    // and catches anything the wire dropped; the final mirror progress report
    // is authoritative, exactly as in the exec path. Then re-arm the reaper.
    void result.then(async () => {
      try {
        await persistQueue
        if (mirroredMessages > 0) persist()
        await persistQueue.catch(() => {})
        const delta = await mirrorDshSession(this.ctx, childSession, spec.homeDir, spec.sessionId)
        if (localAgent !== undefined) {
          for (const text of delta.texts) {
            localAgent.reportRunProgress(childSession.id, { kind: 'delta', text })
          }
          localAgent.reportRunProgress(childSession.id, { kind: 'mirror', mirroredLines: delta.total })
        }
      } catch (error) {
        this.ctx.logger.warn(`subagent-dsh: live settle mirror failed: ${thrown(error).message}`)
      } finally {
        this.armIdleTimer(spec.sessionId)
      }
    })

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
