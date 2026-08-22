/**
 * The kimi provider's live driver: one resident `kimi acp` process per member
 * (child session), driven over the vendor's Agent Client Protocol (ACP) —
 * JSON-RPC NDJSON over stdio (protocol-probed against kimi 0.36.1; the
 * harness `subagent-acp` package is the reference implementation). A
 * delegation round is a `session/prompt` on the member's resident session
 * instead of a fresh `kimi -p` process, which buys what the process boundary
 * could not: runtime-level graceful interrupt (`session/cancel`; the process
 * survives and the session stays continuable) and push-driven mirroring
 * (`session/update` notifications trigger throttled file-mirror passes — see
 * below why the transcript itself stays file-sourced).
 *
 * Mirroring contract (the kimi-specific call): kimi's ACP updates are
 * token-level chunks, NOT the wire.jsonl line fold the exec mirror owns — so
 * the live transport mirrors NOTHING directly except opt-in token chunks.
 * The kimi ACP runtime writes the same wire.jsonl in the same scoped home
 * (session-view.ts documents this), so push events merely TRIGGER throttled
 * `mirrorKimiDelta` passes and the settle pass stays authoritative: one fold,
 * one offset, zero divergence between the two drivers.
 *
 * Lifecycle mirrors the dsh/codex live drivers' discipline: lazy spawn with an
 * initialize handshake (loadSession capability required — crash recovery is
 * `session/load` of the recorded session id), one in-flight spawn per member,
 * idle-timeout reclaim (stdin EOF → grace → SIGTERM ladder), a channel breaker
 * with cooldown, `disposeAll` on unload, and cancellation honored in every
 * window. The wire adapter is self-contained (no `@agentclientprotocol/sdk`
 * dependency): StringDecoder framing, request correlation, and unattended
 * auto-answers for `session/request_permission` (allow — matching the exec
 * mode's auto-approve behavior; the proposal's default policy).
 * @module @khorsheed/dsh-local-agent-kimi/live-driver
 */

import { StringDecoder } from 'node:string_decoder'
import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import {
  settleRunResult,
  subprocessRunHandle,
  type SubagentResult,
  type SubagentRun,
  type SubagentStartRequest,
  type SubagentStopReason,
} from '@deepseek-ai/dsh-subagent'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { MEMBER_BRIDGE_SOCKET_ENV, MEMBER_BRIDGE_TOKEN_ENV } from '@khorsheed/dsh-local-agent/types'
import {
  DEFAULT_DISPOSE_GRACE_MS,
  mirrorKimiDelta,
  textTask,
} from './kimi-cli-provider.ts'

/** Default idle lifetime of an unused resident runtime before reclaim. */
export const DEFAULT_LIVE_IDLE_MS = 30 * 60_000

/** Default timeout for a wire request acknowledgement (never for session/prompt). */
export const DEFAULT_LIVE_REQUEST_TIMEOUT_MS = 30_000

/** Default timeout for the ACP handshake (a cold boot can be slow). */
export const DEFAULT_LIVE_INITIALIZE_TIMEOUT_MS = 60_000

/** Bounded wait for an interrupted turn to converge while a run disposes. */
export const DEFAULT_LIVE_DISPOSE_CONVERGE_MS = 5_000

/** How long a tripped channel breaker stays on the exec fallback. */
export const DEFAULT_LIVE_CHANNEL_RETRY_MS = 5 * 60_000

/** Minimum gap between push-triggered mirror passes. */
export const DEFAULT_LIVE_MIRROR_THROTTLE_MS = 500

/** Grace between stdin EOF and SIGTERM when reclaiming an ACP server. */
const RECLAIM_EOF_GRACE_MS = 1_000

/** The ACP protocol version this driver speaks (kimi 0.36.1 probe). */
const ACP_PROTOCOL_VERSION = 1

/**
 * The ACP channel could not come up (spawn failure, handshake
 * timeout/mismatch, or a missing loadSession capability). The provider
 * catches exactly this and falls back to the exec one-shot; any other error
 * is a real round failure.
 */
export class LiveChannelUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LiveChannelUnavailableError'
  }
}

/** Internal timeouts; tests inject small values. */
export interface KimiLiveDriverTimeouts {
  readonly initializeMs: number
  readonly requestMs: number
  readonly convergeMs: number
  readonly channelRetryMs: number
  readonly mirrorThrottleMs: number
}

const DEFAULT_TIMEOUTS: KimiLiveDriverTimeouts = {
  initializeMs: DEFAULT_LIVE_INITIALIZE_TIMEOUT_MS,
  requestMs: DEFAULT_LIVE_REQUEST_TIMEOUT_MS,
  convergeMs: DEFAULT_LIVE_DISPOSE_CONVERGE_MS,
  channelRetryMs: DEFAULT_LIVE_CHANNEL_RETRY_MS,
  mirrorThrottleMs: DEFAULT_LIVE_MIRROR_THROTTLE_MS,
}

/** How much of the live event stream crosses into the child session. */
export type KimiLiveMirrorGranularity = 'event' | 'token'

/** Fully resolved inputs for one live round. */
export interface KimiLiveRoundSpec {
  /** Parent Session workspace; also the runtime process cwd and ACP session cwd. */
  readonly cwd: string
  /** The `kimi` harness's scoped home, injected as the runtime's `KIMI_CODE_HOME`. */
  readonly homeDir: string
  /** dsh subagent session recording this delegation (always live on this path). */
  readonly childSession: Session
  /** The delegating session (member-channel registration). */
  readonly parentSessionId: string
  /**
   * Resume round: continue the session recorded as `cliSessionId`, appending
   * under this turn number. Also the reattach path after a runtime crash.
   */
  readonly resume?: { readonly cliSessionId: string; readonly turn: number } | undefined
  /** Fresh round: called with the server-assigned session id (delegation record). */
  readonly onCliSessionId?: ((cliSessionId: string) => void) | undefined
}

type JsonObject = Record<string, unknown>

function thrown(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

/**
 * Auth-shaped failure signatures in kimi's error output: the endpoint
 * rejected the credential. Mirrors the exec path's detector
 * (KIMI_AUTH_FAILURE in kimi-cli-provider.ts); the live path matches against
 * session/prompt failure messages, which is where a mid-run 401 surfaces
 * when the process does not exit.
 */
export const KIMI_LIVE_AUTH_FAILURE = /401|unauthorized|invalid api key|not authenticated|authentication required/i

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Map an ACP prompt stop reason onto the shared stop contract (the harness
 * subagent-acp mapping, verbatim): an unclean stop is never 'completed'.
 */
export function acpStopReasonToHarness(reason: string): SubagentStopReason {
  switch (reason) {
    case 'end_turn':
      return 'completed'
    case 'max_tokens':
      return 'max-tokens'
    case 'refusal':
      return 'refusal'
    case 'cancelled':
      return 'aborted'
    default:
      return 'error'
  }
}

/**
 * The ACP wire peer: newline-delimited JSON-RPC over the child's stdio.
 * Self-contained on purpose (no SDK dependency): StringDecoder framing for
 * split UTF-8 tails, request correlation, and server→client request answering
 * (the permission surface).
 */
class AcpWirePeer {
  private buffer = ''
  private readonly decoder = new StringDecoder('utf8')
  private nextId = 0
  private readonly pending = new Map<string, {
    resolve: (result: unknown) => void
    reject: (error: Error) => void
    timer: NodeJS.Timeout | undefined
  }>()
  private closed = false

  constructor(
    input: SubprocessHandle['stdout'],
    private readonly output: SubprocessHandle['stdin'],
    private readonly warn: (message: string) => void,
    private readonly onServerRequest: (method: string, params: JsonObject) => unknown,
    private readonly onNotification: (method: string, params: JsonObject) => void,
    private readonly requestMs: number,
  ) {
    input?.on('data', (chunk: Buffer) => { this.feed(this.decoder.write(chunk)) })
  }

  private write(message: JsonObject): void {
    this.output?.write(JSON.stringify(message) + '\n')
  }

  /** Send one request; `timeoutMs` 0 means turn-length (no timer — session/prompt). */
  request<T>(method: string, params: JsonObject, timeoutMs?: number): Promise<T> {
    if (this.closed) return Promise.reject(new Error('subagent-kimi live: the wire is closed'))
    this.nextId += 1
    const id = `req_${this.nextId}`
    const timeout = timeoutMs ?? this.requestMs
    return new Promise<T>((resolve, reject) => {
      let timer: NodeJS.Timeout | undefined
      if (timeout > 0) {
        timer = setTimeout(() => {
          this.pending.delete(id)
          reject(new Error(`subagent-kimi live: ${method} timed out`))
          timer?.unref()
        }, timeout)
        timer.unref()
      }
      this.pending.set(id, { resolve: result => resolve(result as T), reject, timer })
      this.write({ jsonrpc: '2.0', id, method, params })
    })
  }

  notify(method: string, params?: JsonObject): void {
    this.write(params === undefined ? { jsonrpc: '2.0', method } : { jsonrpc: '2.0', method, params })
  }

  /** Detach and reject every outstanding request (a turn-length prompt settles here on teardown). */
  close(): void {
    if (this.closed) return
    this.closed = true
    for (const request of this.pending.values()) {
      if (request.timer !== undefined) clearTimeout(request.timer)
      request.reject(new Error('subagent-kimi live: the wire closed'))
    }
    this.pending.clear()
  }

  private feed(text: string): void {
    this.buffer += text
    let index = this.buffer.indexOf('\n')
    while (index >= 0) {
      const line = this.buffer.slice(0, index)
      this.buffer = this.buffer.slice(index + 1)
      index = this.buffer.indexOf('\n')
      if (line.trim() !== '') this.dispatchLine(line)
    }
  }

  /** Handle one wire line; a malformed or hostile line never escapes this frame. */
  private dispatchLine(line: string): void {
    let message: { id?: unknown; result?: unknown; error?: unknown; method?: unknown; params?: unknown }
    try {
      message = JSON.parse(line) as typeof message
    } catch {
      this.warn('subagent-kimi live: ignored a malformed wire line')
      return
    }
    try {
      const hasId = typeof message.id === 'string' || typeof message.id === 'number'
      if (hasId && typeof message.method === 'string') {
        // A server→client REQUEST (permission / fs / terminal): answer unattended.
        const id = message.id
        try {
          const result = this.onServerRequest(message.method, (message.params ?? {}) as JsonObject)
          this.write({ jsonrpc: '2.0', id: id as string, result: result as unknown })
        } catch (error) {
          this.write({
            jsonrpc: '2.0', id: id as string,
            error: { code: -32603, message: thrown(error).message },
          })
        }
        return
      }
      if (hasId && ('result' in message || 'error' in message)) {
        const request = this.pending.get(String(message.id))
        if (request === undefined) return
        this.pending.delete(String(message.id))
        if (request.timer !== undefined) clearTimeout(request.timer)
        const wireError = message.error as { message?: string } | undefined
        if (wireError !== undefined && wireError !== null) {
          request.reject(new Error(`subagent-kimi live: ${wireError.message ?? 'wire error'}`))
        } else {
          request.resolve(message.result)
        }
        return
      }
      if (typeof message.method === 'string') {
        this.onNotification(message.method, (message.params ?? {}) as JsonObject)
      }
    } catch (error) {
      this.warn(`subagent-kimi live: wire line handler failed: ${thrown(error).message}`)
    }
  }
}

/**
 * One resident `kimi acp` process: the wire peer, the loaded session id, the
 * per-session turn chain (one prompt at a time — a cancelled turn converges
 * before the next prompt goes out), and the reclaim ladder.
 */
class KimiLiveRuntime {
  dead = false
  private reclaimed = false
  readonly peer: AcpWirePeer
  /** The member's ACP session; assigned by the first round's session/new or session/load. */
  sessionId: string | undefined
  /** Serializes session/prompt per member (converge-before-next-turn). */
  turnChain: Promise<unknown> = Promise.resolve()
  /** The active round's notification sink; installed per round, cleared at settle. */
  onSessionUpdate: ((update: JsonObject) => void) | undefined
  onDead: (() => void) | undefined
  private stderrTail = ''
  private readonly stderrDecoder = new StringDecoder('utf8')

  constructor(
    readonly child: SubprocessHandle,
    onServerRequest: (method: string, params: JsonObject) => unknown,
    warn: (message: string) => void,
    requestMs: number,
  ) {
    this.peer = new AcpWirePeer(
      child.stdout,
      child.stdin,
      warn,
      onServerRequest,
      (method, params) => {
        if (method !== 'session/update') return
        const sessionId = params['sessionId']
        if (sessionId !== this.sessionId) return
        this.onSessionUpdate?.((params['update'] ?? {}) as JsonObject)
      },
      requestMs,
    )
    child.stderr?.on('data', (chunk: Buffer) => {
      this.stderrTail = (this.stderrTail + this.stderrDecoder.write(chunk)).slice(-4096)
    })
    void child.done.then(
      () => { this.markDead() },
      () => { this.markDead() },
    )
  }

  get diagnostics(): string {
    return this.stderrTail.trim()
  }

  private markDead(): void {
    if (this.dead) return
    this.dead = true
    this.peer.close()
    this.onDead?.()
  }

  /** Graceful teardown: close the wire, EOF stdin, grace, then the terminate ladder. */
  async reclaim(): Promise<void> {
    if (this.reclaimed) return
    this.reclaimed = true
    this.peer.close()
    if (!this.dead) {
      this.child.stdin?.end()
      await Promise.race([this.child.done.catch(() => {}), delay(RECLAIM_EOF_GRACE_MS)])
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
 * The kimi live driver owns every resident ACP runtime of this provider
 * generation. Created only when `live: true`; disposed with the plugin.
 */
export class KimiAcpLiveDriver {
  private readonly runtimes = new Map<string, KimiLiveRuntime>()
  private readonly ensuring = new Map<string, Promise<KimiLiveRuntime>>()
  private readonly idleTimers = new Map<string, NodeJS.Timeout>()
  /** Per-member round serialization (the resume lock covers resume-vs-resume only). */
  private readonly roundChains = new Map<string, Promise<unknown>>()
  private channelBrokenAt: number | undefined
  private disposed = false
  private readonly disposeController = new AbortController()

  constructor(
    private readonly ctx: Context,
    private readonly config: {
      liveIdleMs?: number
      liveMirrorGranularity?: KimiLiveMirrorGranularity
    } = {},
    private readonly timeouts: KimiLiveDriverTimeouts = DEFAULT_TIMEOUTS,
  ) {}

  /** Whether the channel is in its post-failure cooldown (rounds fall back to exec). */
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

  private armIdleTimer(key: string): void {
    this.clearIdleTimer(key)
    const idleMs = this.config.liveIdleMs ?? DEFAULT_LIVE_IDLE_MS
    const timer = setTimeout(() => { void this.reclaim(key) }, idleMs)
    timer.unref()
    this.idleTimers.set(key, timer)
  }

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
    this.disposeController.abort()
    await Promise.all([...this.ensuring.values()].map(pending => pending.catch(() => undefined)))
    for (const key of [...this.runtimes.keys()]) {
      await this.reclaim(key)
    }
  }

  private ensureRuntime(spec: KimiLiveRoundSpec, signal: AbortSignal): Promise<KimiLiveRuntime> {
    const key = String(spec.childSession.id)
    const existing = this.runtimes.get(key)
    if (existing !== undefined && !existing.dead) {
      this.clearIdleTimer(key)
      return Promise.resolve(existing)
    }
    if (existing !== undefined) this.runtimes.delete(key)
    const pending = this.ensuring.get(key)
    if (pending !== undefined) return pending
    const spawn = this.spawnRuntime(spec, signal)
      .finally(() => { this.ensuring.delete(key) })
    this.ensuring.set(key, spawn)
    return spawn
  }

  /**
   * Spawn the member's resident `kimi acp` and prove the wire: initialize +
   * the loadSession capability (crash recovery needs it — without it the
   * channel is not live-capable and the breaker trips). A cancellation
   * mid-spawn reclaims the half-started process without touching the breaker.
   */
  private async spawnRuntime(spec: KimiLiveRoundSpec, signal: AbortSignal): Promise<KimiLiveRuntime> {
    const key = String(spec.childSession.id)
    if (this.disposed) {
      throw new LiveChannelUnavailableError('the live driver is disposed')
    }
    // The member bridge rides the ACP session's inline mcpServers declaration
    // (NOT the scoped mcp.json — that file is the exec path's per-run
    // channel); the resident process serves one member, so its token lives
    // with the process.
    const member = this.registerMember(spec)
    const spawnSpec: SubprocessSpawnSpec = {
      argv: ['kimi', 'acp'],
      cwd: spec.cwd,
      stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
      graceMs: DEFAULT_DISPOSE_GRACE_MS,
      env: { KIMI_CODE_HOME: spec.homeDir },
    }
    let child: SubprocessHandle
    try {
      child = this.ctx.subprocess.spawn(spawnSpec)
    } catch (error) {
      member?.release()
      this.markChannelBroken()
      throw new LiveChannelUnavailableError(`kimi acp failed to spawn: ${thrown(error).message}`)
    }
    member?.bind(child.pid)
    const runtime = new KimiLiveRuntime(
      child,
      (method, params) => this.answerServerRequest(method, params),
      message => { this.ctx.logger.warn(message) },
      this.timeouts.requestMs,
    )
    runtime.onDead = () => {
      // Delete only OUR registration (crash-then-respawn interleave safety).
      if (this.runtimes.get(key) === runtime) this.runtimes.delete(key)
      this.clearIdleTimer(key)
      member?.release()
    }
    const aborted = new Promise<never>((_, reject) => {
      const cancel = (): void => { reject(new Error('subagent-kimi: run cancelled locally')) }
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
        runtime.peer.request<{ agentCapabilities?: { loadSession?: boolean } }>('initialize', {
          protocolVersion: ACP_PROTOCOL_VERSION,
          // Advertise NO optional client capabilities (no fs, no terminal):
          // the child self-serves in its own process.
          clientCapabilities: {},
        }, this.timeouts.initializeMs),
        aborted,
      ])
      if (hello?.agentCapabilities?.loadSession !== true) {
        throw new Error('kimi acp does not advertise loadSession (crash recovery requires it)')
      }
    } catch (error) {
      await runtime.reclaim()
      if (signal.aborted) throw thrown(error)
      this.markChannelBroken()
      throw new LiveChannelUnavailableError(`the kimi acp handshake failed: ${thrown(error).message}`)
    }
    if (this.disposed) {
      await runtime.reclaim()
      throw new LiveChannelUnavailableError('the live driver was disposed during spawn')
    }
    this.channelBrokenAt = undefined
    this.runtimes.set(key, runtime)
    // Stash the member handle for the session declarations.
    runtimeMember.set(runtime, member)
    return runtime
  }

  private markChannelBroken(): void {
    this.channelBrokenAt = Date.now()
  }

  /**
   * Report an auth-shaped round failure to the family registry's auth-failure
   * mark (the exec path's post-exit 401 detection ported to a process that
   * never exits: the match runs against the settled error instead). Degrades
   * silently on a core predating reportAuthFailure.
   */
  private reportAuthIfShaped(error: Error): void {
    if (!KIMI_LIVE_AUTH_FAILURE.test(error.message)) return
    // Duck-typed: the method lands with the auth-truthfulness core; older
    // cores simply skip the mark.
    const registry = this.ctx.localAgent as unknown as {
      reportAuthFailure?: (harness: string, detail: string) => void
    }
    if (typeof registry.reportAuthFailure === 'function') {
      registry.reportAuthFailure('kimi', error.message.split('\n').find(line => line.trim() !== '') ?? error.message)
    }
  }

  /**
   * Register the member channel for one resident process (token + bridge
   * coordinates), duck-typed like the exec path's memberRun but WITHOUT the
   * mcp.json write — the ACP session declares the bridge inline.
   */
  private registerMember(spec: KimiLiveRoundSpec): {
    mcpServers: JsonObject[]
    bind(pid: number): void
    release(): void
  } | undefined {
    const registry = this.ctx.localAgent
    if (
      typeof registry.registerMemberRun !== 'function'
      || typeof registry.memberBridgeSocketPath !== 'function'
      || typeof registry.memberBridgeCommand !== 'function'
    ) return undefined
    const token = registry.registerMemberRun({
      childSessionId: String(spec.childSession.id),
      parentSessionId: spec.parentSessionId,
      provider: 'kimi-cli',
    })
    const bridge = registry.memberBridgeCommand()
    let released = false
    return {
      mcpServers: [{
        name: 'dsh-member',
        command: bridge.command,
        args: [...bridge.args],
        env: [
          { name: MEMBER_BRIDGE_SOCKET_ENV, value: registry.memberBridgeSocketPath() },
          { name: MEMBER_BRIDGE_TOKEN_ENV, value: token },
        ],
      }],
      bind: pid => registry.bindMemberRunPid(token, pid),
      release: () => {
        if (released) return
        released = true
        registry.unregisterMemberRun(token)
      },
    }
  }

  /**
   * Auto-answer the ACP permission surface unattended. `session/request_permission`
   * selects the first allow option (allow_once/allow_always) — matching the
   * exec mode's auto-approve behavior for `kimi -p` — and cancels when the
   * child offered none. Anything else (fs/terminal, which we never
   * advertised) is an error response.
   */
  private answerServerRequest(method: string, params: JsonObject): unknown {
    if (method === 'session/request_permission') {
      const options = Array.isArray(params['options']) ? params['options'] as { kind?: string; optionId?: string }[] : []
      const allow = options.find(o => o.kind === 'allow_once' || o.kind === 'allow_always')
      if (allow !== undefined && typeof allow.optionId === 'string') {
        return { outcome: { outcome: 'selected', optionId: allow.optionId } }
      }
      return { outcome: { outcome: 'cancelled' } }
    }
    throw new Error(`subagent-kimi live: unsupported ACP request ${method}`)
  }

  /**
   * Drive one delegation round on the member's resident ACP session. Mirrors
   * the exec run's settlement contract exactly (settleRunResult + turn/end
   * bookkeeping); cancel is `session/cancel` and the process survives.
   */
  async startRound(request: SubagentStartRequest, spec: KimiLiveRoundSpec): Promise<SubagentRun> {
    const key = String(spec.childSession.id)
    const previous = this.roundChains.get(key) ?? Promise.resolve()
    const round = previous.catch(() => {}).then(() => this.startRoundLocked(request, spec))
    this.roundChains.set(key, round.then(
      handle => handle.result.catch(() => ({})),
      () => ({}),
    ))
    return round
  }

  /** The serialized round body. */
  private async startRoundLocked(request: SubagentStartRequest, spec: KimiLiveRoundSpec): Promise<SubagentRun> {
    const task = textTask(request.prompt)
    if (request.signal.aborted) {
      throw new Error('subagent-kimi: request was aborted before the run started')
    }
    if (this.disposed) {
      throw new Error('subagent-kimi: the live driver is disposed')
    }

    const turn = spec.resume?.turn ?? 1
    const childSession = spec.childSession
    const granularity: KimiLiveMirrorGranularity = this.config.liveMirrorGranularity ?? 'event'
    const localAgent = this.ctx.get('localAgent')

    const runAbort = new AbortController()
    let roundSettled = false
    let runtime: KimiLiveRuntime | undefined
    /** True while this round's session/prompt is in flight (cancel targets it). */
    let promptInFlight = false
    let turnOpened = false
    /** The round's accumulated assistant text (the run output — chunks are the only source). */
    let roundText = ''
    let lastMirrorAt = 0
    let mirrorQueue: Promise<unknown> = Promise.resolve()

    /** Throttled push-triggered mirror pass; the file fold stays the only transcript source. */
    const triggerMirror = (): void => {
      const now = Date.now()
      if (now - lastMirrorAt < this.timeouts.mirrorThrottleMs) return
      lastMirrorAt = now
      mirrorQueue = mirrorQueue.then(() =>
        mirrorKimiDelta(this.ctx, childSession, spec.homeDir, runtime?.sessionId).catch((error: unknown) => {
          this.ctx.logger.warn(`subagent-kimi: live mirror pass failed: ${thrown(error).message}`)
        }))
    }

    const requestCancel = (): void => {
      if (roundSettled || runAbort.signal.aborted) return
      runAbort.abort(new Error('subagent-kimi: run cancelled locally'))
      // The live driver's core win: a graceful runtime cancel instead of a
      // process kill. Best-effort; local settlement does not wait for it.
      if (promptInFlight && runtime?.sessionId !== undefined && !runtime.dead) {
        runtime.peer.notify('session/cancel', { sessionId: runtime.sessionId })
      }
    }
    const onAbort = (): void => { requestCancel() }
    request.signal.addEventListener('abort', onAbort, { once: true })

    const abortBranch = new Promise<never>((_, reject) => {
      runAbort.signal.addEventListener('abort', () => reject(new Error('subagent-kimi: run cancelled locally')), { once: true })
    })

    const collectOutput = (): ContentBlock[] => {
      const text = roundText.trim()
      return text === '' ? [] : [{ type: 'text', text: roundText }]
    }

    /** The round's update sink (installed on the runtime while it runs). */
    const onSessionUpdate = (update: JsonObject): void => {
      const kind = update['sessionUpdate']
      if (kind === 'agent_message_chunk') {
        const content = update['content'] as { type?: string; text?: string } | undefined
        const text = content?.type === 'text' ? content.text ?? '' : ''
        if (text !== '') {
          roundText += text
          if (granularity === 'token') {
            childSession.append('assistant/chunk', {
              turn,
              step: 1,
              chunk: { type: 'text-delta', index: 0, text },
            })
            localAgent?.reportRunProgress(childSession.id, { kind: 'delta', text })
          }
        }
      } else if (kind === 'agent_thought_chunk' && granularity === 'token') {
        const content = update['content'] as { type?: string; text?: string } | undefined
        const text = content?.text ?? ''
        if (text !== '') {
          childSession.append('assistant/chunk', {
            turn,
            step: 1,
            chunk: { type: 'reasoning-delta', index: 0, text },
          })
        }
      }
      // Every update (chunks, tool calls, plans) triggers a throttled mirror
      // pass; the wire.jsonl fold owns the transcript content.
      triggerMirror()
    }

    const accepted: Promise<void> = (async () => {
      const rt = await this.ensureRuntime(spec, request.signal)
      runtime = rt
      if (runAbort.signal.aborted) {
        await this.reclaim(String(childSession.id))
        throw new Error('subagent-kimi: run cancelled locally')
      }
      rt.onSessionUpdate = onSessionUpdate
      const member = runtimeMember.get(rt)
      try {
        if (rt.sessionId === undefined) {
          if (spec.resume === undefined) {
            const response = await rt.peer.request<{ sessionId?: string }>('session/new', {
              cwd: spec.cwd,
              mcpServers: member?.mcpServers ?? [],
            })
            if (typeof response?.sessionId !== 'string') {
              throw new Error('subagent-kimi live: session/new returned no session id')
            }
            rt.sessionId = response.sessionId
            spec.onCliSessionId?.(rt.sessionId)
          } else {
            await rt.peer.request('session/load', {
              sessionId: spec.resume.cliSessionId,
              cwd: spec.cwd,
              mcpServers: member?.mcpServers ?? [],
            })
            rt.sessionId = spec.resume.cliSessionId
          }
        }
      } catch (error) {
        // The accept failed: the runtime's session state is unknown, so do
        // not reuse it — reclaim and fail the round loudly. The turn never
        // opened parent-side, so no dangling turn/start. (An auth-shaped
        // failure here flows through settleRunResult's onError, which owns
        // the registry mark — reporting here too would double it.)
        if (!runAbort.signal.aborted) await this.reclaim(String(childSession.id))
        throw thrown(error)
      }
      // The turn boundary opens before the prompt goes out (exec parity: the
      // exec path opens at spawn). session/prompt has no separate accept ack —
      // the request IS the turn.
      childSession.append('turn/start', { turn })
      turnOpened = true
    })()

    const attempt: Promise<SubagentResult> = accepted.then(async () => {
      if (runAbort.signal.aborted) throw new Error('subagent-kimi: run cancelled locally')
      const rt = runtime as KimiLiveRuntime
      const processFailure: Promise<never> = rt.child.done.then(
        outcome => Promise.reject(new Error(
          'subagent-kimi: the live runtime exited mid-round '
          + `(code ${String(outcome.exitCode)}, signal ${String(outcome.signal)})`,
        )),
        (error: unknown) => Promise.reject(thrown(error)),
      )
      processFailure.catch(() => {})
      // One prompt at a time per member: a cancelled turn converges (its
      // prompt settles 'cancelled') before the next prompt goes out — the
      // stop-then-rephrase gesture cannot interleave two turns' chunks.
      const sendPrompt = (): Promise<{ stopReason?: string }> => {
        if (runAbort.signal.aborted) return Promise.reject(new Error('subagent-kimi: run cancelled locally'))
        promptInFlight = true
        // Turn-length request: no wire timeout.
        return rt.peer.request<{ stopReason?: string }>('session/prompt', {
          sessionId: rt.sessionId as string,
          prompt: [{ type: 'text', text: task }],
        }, 0)
      }
      const promptPromise: Promise<{ stopReason?: string }> = rt.turnChain.catch(() => {}).then(sendPrompt)
      rt.turnChain = promptPromise
      const promptResult = await Promise.race([promptPromise, processFailure])
      const stopReason = acpStopReasonToHarness(String(promptResult?.stopReason ?? ''))
      // The exec path's silent-failure guard: an end_turn with no answer is an
      // error, never a 'completed' success with empty output.
      if (stopReason === 'completed' && collectOutput().length === 0) {
        throw new Error('subagent-kimi live: the turn completed but produced no answer')
      }
      return { output: collectOutput(), stopReason }
    })

    const result: Promise<SubagentResult> = settleRunResult({
      attempt: () => Promise.race([attempt, abortBranch]),
      collectOutput,
      cancelled: () => runAbort.signal.aborted,
      onError: (error: Error, stopReason: SubagentStopReason) => {
        const diagnostics = runtime?.diagnostics ?? ''
        const suffix = diagnostics === '' ? '' : `; ${diagnostics}`
        this.ctx.logger.warn(`subagent-kimi: live round failed (${stopReason}): ${error.message}${suffix}`)
        this.reportAuthIfShaped(error)
      },
      signal: request.signal,
      onAbort,
    }).then((settled) => {
      roundSettled = true
      promptInFlight = false
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
      // Settlement clears the round's update sink.
      if (runtime !== undefined) runtime.onSessionUpdate = undefined
      return settled
    })

    // Settle reconciliation: one authoritative final mirror pass (the ACP
    // runtime flushed its wire.jsonl by turn end), then re-arm the reaper.
    void result.then(async () => {
      try {
        if (turnOpened) {
          await mirrorQueue.catch(() => {})
          const delta = await mirrorKimiDelta(this.ctx, childSession, spec.homeDir, runtime?.sessionId)
          localAgent?.reportRunProgress(childSession.id, { kind: 'mirror', mirroredLines: delta.total })
        }
      } catch (error) {
        this.ctx.logger.warn(`subagent-kimi: live settle mirror failed: ${thrown(error).message}`)
      } finally {
        this.armIdleTimer(String(childSession.id))
      }
    })

    // Publication gate: hold start() until the session is ready and the
    // boundary open (channel errors still throw for the provider's exec
    // fallback), but never hold it hostage — a cancel returns immediately.
    await Promise.race([accepted, abortBranch.catch(() => undefined)])

    return subprocessRunHandle({
      id: childSession.id,
      result,
      signal: request.signal,
      onAbort,
      requestCancel,
      // The live teardown contract: NEVER kill the runtime here. The graceful
      // cancel already went out; wait (bounded) for the turn to converge so
      // the next round's prompt starts clean.
      teardown: async () => {
        if (roundSettled) return
        const rt = runtime
        if (rt === undefined) return
        await Promise.race([rt.turnChain.catch(() => {}), delay(this.timeouts.convergeMs)])
      },
    })
  }
}

/** The member handle each runtime carries (for its session declarations). */
const runtimeMember = new WeakMap<KimiLiveRuntime, {
  mcpServers: JsonObject[]
  bind(pid: number): void
  release(): void
} | undefined>()
