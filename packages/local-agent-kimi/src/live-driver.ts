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
 * completed items always fold from the file: push events merely TRIGGER
 * throttled `mirrorKimiDelta` passes and the settle pass stays authoritative
 * (one fold, one offset, zero divergence between the two drivers). Every
 * transcript item folds 1:1 into the child session log.
 * Live output also mirrors the in-flight item: chunk
 * deltas accumulate per streaming item and append throttled snapshot
 * assistant/messages at the item's reserved (turn, step) — the host folds
 * repeated settles at one coordinate into one live-updating chat node — and
 * the wire line completing the item folds at the same step, finalizing it.
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

import type { LocalAgentResolvedConfiguration } from '@khorsheed/dsh-local-agent/types'
import { configureKimiSession } from './session-configuration.ts'
import { kimiNativeConfiguration, type KimiNativeConfiguration } from './model-catalog.ts'
import { StringDecoder } from 'node:string_decoder'
import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
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
import { delegationEnv, persistChildSession, LiveStreamPublisher, LiveFlush, LIVE_FLUSH_INTERVAL_MS } from '@khorsheed/dsh-local-agent'
import { MEMBER_BRIDGE_SOCKET_ENV, MEMBER_BRIDGE_TOKEN_ENV } from '@khorsheed/dsh-local-agent/types'
import {
  DEFAULT_DISPOSE_GRACE_MS,
  mirrorKimiDelta,
  textTask,
} from './kimi-cli-provider.ts'
import { assistantEvent, nextKimiSessionStep } from './session-mirror.ts'
import type { KimiMirrorDelta, KimiMirrorOptions, KimiMirrorStreams } from './session-mirror.ts'
import { addTokenUsage } from './session-view.ts'
import { guardKimiCredential } from './credential-guard.ts'
import { writeKimiDefaultModel } from './provision.ts'

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

/** Default minimum interval between one streaming item's snapshot messages. */
export const DEFAULT_SNAPSHOT_MIN_INTERVAL_MS = LIVE_FLUSH_INTERVAL_MS

/** Default minimum text growth between one streaming item's snapshot messages. */
export const DEFAULT_SNAPSHOT_MIN_CHARS = 0

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

/** Settle-mirror quiescence: poll cadence, required consecutive stable reads, and the overall bound. */
const SETTLE_MIRROR_POLL_MS = 300
const SETTLE_MIRROR_STABLE_READS = 3
const SETTLE_MIRROR_QUIESCE_MS = 3_000

/** How much of the live event stream crosses into the child session. */
export type KimiLiveMirrorGranularity = 'event' | 'token'

/** Fully resolved inputs for one live round. */
export interface KimiLiveRoundSpec {
  readonly configuration?: LocalAgentResolvedConfiguration
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

/**
 * kimi ACP session ids are directory names (`session_<uuid>`); the family
 * delegation record convention is the bare uuid (the exec path's settle-time
 * stderr parse). Strip the prefix so live- and exec-written records stay
 * interchangeable.
 */
export function bareKimiSessionId(acpSessionId: string): string {
  return acpSessionId.startsWith('session_') ? acpSessionId.slice('session_'.length) : acpSessionId
}

/** The ACP-native form of a recorded kimi session id (idempotent). */
export function acpKimiSessionId(recordedId: string): string {
  return recordedId.startsWith('session_') ? recordedId : `session_${recordedId}`
}

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
  /**
   * The model this process was spawned with (the scoped `default_model` value
   * rewritten just before spawn; undefined means the config decided). A round
   * resolving a different model for the member retires this runtime so the
   * respawn binds the new one.
   */
  configurationKey: string | undefined
  boundModel: string | undefined
  modelConfiguration: KimiNativeConfiguration | undefined
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
        const update = (params['update'] ?? {}) as JsonObject
        if (update['sessionUpdate'] === 'config_option_update') this.modelConfiguration = kimiNativeConfiguration(update)
        this.onSessionUpdate?.(update)
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
 * The kimi live driver owns every resident ACP runtime of this provider
 * generation. Created only when `live: true`; disposed with the plugin.
 */
export class KimiAcpLiveDriver {
  private readonly runtimes = new Map<string, KimiLiveRuntime>()
  private readonly ensuring = new Map<string, Promise<KimiLiveRuntime>>()
  /** The model each in-flight spawn is binding (a stale-model spawn never serves a switched member). */
  private readonly ensuringModel = new Map<string, string | undefined>()
  private readonly ensuringConfiguration = new Map<string, string | undefined>()
  private readonly idleTimers = new Map<string, NodeJS.Timeout>()
  /** Per-member round serialization (the resume lock covers resume-vs-resume only). */
  private readonly roundChains = new Map<string, Promise<unknown>>()
  private channelBrokenAt: number | undefined
  private disposed = false
  /**
   * Set by drain() (a settings-driven generation handoff): new rounds are
   * refused so the provider falls back to exec, while in-flight rounds finish
   * on their runtime undisturbed. Unlike `disposed`, the driver still serves
   * what it already accepted.
   */
  private draining = false
  private readonly disposeController = new AbortController()

  constructor(
    private readonly ctx: Context,
    private readonly config: {
      liveIdleMs?: number
      liveMirrorGranularity?: KimiLiveMirrorGranularity
      /** Maximum batching wait for incremental streaming messages. */
      snapshotMinIntervalMs?: number
      /** @deprecated Character growth no longer gates live publication. */
      snapshotMinChars?: number
      /**
       * Resolver for the member's effective model, read at each RUNTIME
       * SPAWN. `kimi acp` takes no model flag, so this path pins the scoped
       * config's `default_model` instead of extending the argv. Absent, or
       * resolving to nothing for the member, writes nothing at all. A runtime
       * whose bound model no longer matches the member's resolved model is
       * retired and respawned onto the new one.
       */
      model?: (childSessionId: string) => string | undefined
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

  /**
   * True while the member's runtime exists or is being spawned. The settings
   * controller gates a new generation on this: a fresh driver must not serve
   * a member whose retiring generation still hosts the (same) kimi session.
   */
  hasRuntime(key: string): boolean {
    return this.runtimes.has(key) || this.ensuring.has(key)
  }

  /** @deprecated Compatibility no-op: live output is always incremental. */
  setLiveMirrorGranularity(_granularity: KimiLiveMirrorGranularity): void {}

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

  /** The model a runtime spawned for this member right now would bind. */
  private resolveBoundModel(key: string): string | undefined {
    const model = this.config.model?.(key)?.trim()
    return model === undefined || model === '' ? undefined : model
  }

  private ensureRuntime(spec: KimiLiveRoundSpec, signal: AbortSignal): Promise<KimiLiveRuntime> {
    const key = String(spec.childSession.id)
    const model = spec.configuration === undefined ? this.resolveBoundModel(key) : spec.configuration.model
    const configurationKey = spec.configuration === undefined ? undefined : JSON.stringify(spec.configuration)
    const existing = this.runtimes.get(key)
    if (existing !== undefined && !existing.dead && existing.boundModel === model
      && existing.configurationKey === configurationKey) {
      this.clearIdleTimer(key)
      return Promise.resolve(existing)
    }
    // A model switch retires the member's runtime: the resident process bound
    // its model at spawn, so the next round respawns onto the new model and
    // session/loads the SAME CLI session (the conversation carries over).
    if (existing !== undefined) {
      this.runtimes.delete(key)
      this.clearIdleTimer(key)
      if (!existing.dead) void existing.reclaim()
    }
    const pending = this.ensuring.get(key)
    if (pending !== undefined && this.ensuringModel.get(key) === model && this.ensuringConfiguration.get(key) === configurationKey) return pending
    // A stale-model spawn in flight: chain behind it, then spawn onto the new
    // model (the chained spawn reclaims the stale runtime via the mismatch
    // path on its own ensure).
    const spawn = (pending ?? Promise.resolve())
      .catch(() => undefined)
      .then(async (stale) => {
        if (stale !== undefined && !stale.dead) {
          if (this.runtimes.get(key) === stale) this.runtimes.delete(key)
          await stale.reclaim()
        }
        return this.spawnRuntime(spec, signal, model)
      })
      .finally(() => {
        if (this.ensuring.get(key) === spawn) {
          this.ensuring.delete(key)
          this.ensuringModel.delete(key)
          this.ensuringConfiguration.delete(key)
        }
      })
    this.ensuring.set(key, spawn)
    this.ensuringModel.set(key, model)
    this.ensuringConfiguration.set(key, configurationKey)
    return spawn
  }

  /**
   * Retire one member's resident runtime (a composer-driven model switch):
   * the process is reclaimed and the member's next round respawns onto the
   * new model, resuming the same CLI session. A member with no runtime (or
   * only a dead one) is a no-op. Lazy: nothing spawns here.
   */
  async retireRuntime(childSessionId: string): Promise<void> {
    const pending = this.ensuring.get(childSessionId)
    if (pending !== undefined) await pending.catch(() => undefined)
    await this.reclaim(childSessionId)
  }

  /**
   * The model the member's live runtime is bound to, or undefined when the
   * member has no live runtime (or it bound none). The broker compares this
   * against the post-switch effective model to make a same-model set a no-op.
   */
  runtimeModel(childSessionId: string): string | undefined {
    const runtime = this.runtimes.get(childSessionId)
    return runtime === undefined || runtime.dead ? undefined : runtime.boundModel
  }

  runtimeConfiguration(childSessionId: string): KimiNativeConfiguration | undefined {
    const runtime = this.runtimes.get(childSessionId)
    return runtime === undefined || runtime.dead ? undefined : runtime.modelConfiguration
  }

  /**
   * Spawn the member's resident `kimi acp` and prove the wire: initialize +
   * the loadSession capability (crash recovery needs it — without it the
   * channel is not live-capable and the breaker trips). A cancellation
   * mid-spawn reclaims the half-started process without touching the breaker.
   */
  private async spawnRuntime(spec: KimiLiveRoundSpec, signal: AbortSignal, boundModel: string | undefined): Promise<KimiLiveRuntime> {
    const key = String(spec.childSession.id)
    if (this.disposed) {
      throw new LiveChannelUnavailableError('the live driver is disposed')
    }
    // The member bridge rides the ACP session's inline mcpServers declaration
    // (NOT the scoped mcp.json — that file is the exec path's per-run
    // channel); the resident process serves one member, so its token lives
    // with the process.
    const member = this.registerMember(spec)
    // `kimi acp` has no `-m` (verified against kimi 0.39.1), so the resident
    // path pins the model the only way the CLI offers: the scoped config's
    // `default_model`, rewritten before the process reads it. The write is
    // surgical and idempotent — a runtime already on this model rewrites
    // nothing. Best-effort: a home whose config cannot be written still gets
    // its runtime, running whatever the config already named, and the round's
    // model read-back is what catches the mismatch.
    if (spec.configuration === undefined && boundModel !== undefined) {
      await writeKimiDefaultModel(spec.homeDir, boundModel).catch((error: unknown) => {
        this.ctx.logger.warn(`local-agent-kimi: pinning default_model for the resident runtime failed: ${thrown(error).message}`)
        return false
      })
    }
    const spawnSpec: SubprocessSpawnSpec = {
      argv: ['kimi', ...spec.configuration?.model === undefined ? [] : ['--model', spec.configuration.model], 'acp'],
      cwd: spec.cwd,
      stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
      graceMs: DEFAULT_DISPOSE_GRACE_MS,
      env: delegationEnv({ KIMI_CODE_HOME: spec.homeDir }),
    }
    let child: SubprocessHandle
    try {
      child = this.ctx.subprocess.spawn(spawnSpec)
    } catch (error) {
      member?.release()
      this.markChannelBroken()
      throw new LiveChannelUnavailableError(`kimi acp failed to spawn: ${thrown(error).message}`)
    }
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
    runtime.boundModel = boundModel
    runtime.configurationKey = spec.configuration === undefined ? undefined : JSON.stringify(spec.configuration)
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
  private reportAuthIfShaped(error: Error, homeDir?: string): void {
    if (!KIMI_LIVE_AUTH_FAILURE.test(error.message)) return
    // The sentinel: if the credential file was wiped into an empty shell, a
    // restore here makes the caller's retry (or the next round) succeed.
    if (homeDir !== undefined) {
      void guardKimiCredential(homeDir, message => { this.ctx.logger.warn(message) })
    }
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
  /** Initialize the native session and model controls without sending a prompt. */
  async prepare(spec: KimiLiveRoundSpec, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    if (this.draining || this.disabled) throw new LiveChannelUnavailableError('the live driver is unavailable for preparation')
    try {
      const runtime = await this.ensureRuntime(spec, signal)
      await this.configureSession(runtime, spec)
      signal.throwIfAborted()
      this.armIdleTimer(String(spec.childSession.id))
    } catch (error) {
      await this.reclaim(String(spec.childSession.id))
      throw error
    }
  }

  private async configureSession(rt: KimiLiveRuntime, spec: KimiLiveRoundSpec): Promise<void> {
    const member = runtimeMember.get(rt)
    if (rt.sessionId === undefined) {
      if (spec.resume === undefined) {
        const response = await rt.peer.request<JsonObject & { sessionId?: string }>('session/new', {
          cwd: spec.cwd,
          mcpServers: member?.mcpServers ?? [],
        })
        if (typeof response?.sessionId !== 'string') {
          throw new Error('subagent-kimi live: session/new returned no session id')
        }
        rt.sessionId = response.sessionId
        rt.modelConfiguration = kimiNativeConfiguration(response)
        // The record convention is the bare uuid (the exec path's
        // settle-time parse); the ACP id is a directory name
        // (`session_<uuid>`). Strip before recording so live- and
        // exec-written records stay interchangeable.
      } else {
        // Resume: the record may be bare (exec-written) or carry the ACP
        // prefix (legacy live records); the wire always wants the
        // ACP-native form.
        rt.sessionId = acpKimiSessionId(spec.resume.cliSessionId)
        const response = await rt.peer.request('session/load', {
          sessionId: rt.sessionId,
          cwd: spec.cwd,
          mcpServers: member?.mcpServers ?? [],
        })
        rt.modelConfiguration = kimiNativeConfiguration(response)
      }
    }
    if (spec.configuration !== undefined) {
      rt.modelConfiguration = await configureKimiSession(rt.sessionId, rt.modelConfiguration, spec.configuration,
        (method, params) => rt.peer.request(method, params))
    }
    if (spec.resume === undefined && rt.sessionId !== undefined) spec.onCliSessionId?.(bareKimiSessionId(rt.sessionId))
  }

  async startRound(request: SubagentStartRequest, spec: KimiLiveRoundSpec): Promise<SubagentRun> {
    // A draining generation refuses new rounds BEFORE chaining so the
    // provider's exec fallback does not queue behind an in-flight round.
    if (this.draining) {
      throw new LiveChannelUnavailableError('the live driver is draining (a settings change retired this generation)')
    }
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
    // The drain race: the round chained before drain() but dequeued after it.
    // Refuse so the provider falls back to exec instead of reusing a runtime
    // the handoff is about to reclaim.
    if (this.draining) {
      throw new LiveChannelUnavailableError('the live driver is draining (a settings change retired this generation)')
    }
    if (this.disposed) {
      throw new Error('subagent-kimi: the live driver is disposed')
    }

    const turn = spec.resume?.turn ?? 1
    const childSession = spec.childSession
    const localAgent = this.ctx.get('localAgent')

    const runAbort = new AbortController()
    let roundSettled = false
    let runtime: KimiLiveRuntime | undefined
    /** True while this round's session/prompt is in flight (cancel targets it). */
    let promptInFlight = false
    let turnOpened = false
    /** The round's accumulated assistant text (the run output — chunks are the only source). */
    let roundText = ''
    /**
     * The step ledger: every step a stream reservation consumed this round
     * (in increasing order — permanently, whether the stream later completes
     * or stays an orphan snapshot). The file fold skips these steps for its
     * sequential folds, so a tool card folded mid-stream lands ABOVE the
     * stream's step and the projection renders the round's chronological
     * order.
     */
    const reservedSteps: number[] = []
    /**
     * The streaming items seen this round . kimi's ACP
     * chunks carry no item id, so the stream key is synthetic per kind per
     * round (the codex live driver's fallback shape): thought chunks share
     * one stream, message chunks another. Deltas accumulate into throttled
     * snapshot assistant/messages appended at the stream's reserved
     * (turn, step) — the host folds repeated settles at one coordinate into
     * one live-updating chat node. The wire line that completes the stream's
     * kind folds at the same step and finalizes it; an entry whose completion
     * never folds is force-finalized at settle.
     */
    const streams = new Map<string, {
      readonly kind: 'think' | 'text'
      readonly step: number
      text: string
      lastSnapshotAt: number
      lastSnapshotLen: number
      /** step/start already emitted for this reservation. */
      opened: boolean
    }>()
    /** The stream the latest delta accumulated into (a kind switch force-snapshots it). */
    let activeStream: string | undefined
    /**
     * The round's usage NOT carried by a folded line, summed across mirror
     * passes (each pass's window is disjoint). The settle's final snapshot
     * carries the remainder when no folded message did — host 0.1.5 has no
     * usage-backfill event.
     */
    let roundUsage: TokenUsage | undefined
    /**
     * The model identifier the wire named this round (a mirror pass's
     * `usage.record` / `llm.request` `model`, last one seen), reported as the
     * round's settled observation — the live drive's half of the exec path's
     * settle-mirror read-back.
     */
    let roundModel: string | undefined
    let lastMirrorAt = 0
    let mirrorQueue: Promise<unknown> = Promise.resolve()
    let persistQueue: Promise<unknown> = Promise.resolve()
    const persist = (): void => {
      persistQueue = persistQueue.then(() => persistChildSession(this.ctx, childSession))
    }

    /** A stream's synthetic key: kimi's ACP deltas carry no item id, so kind + turn pairs them. */
    let generation = 0
    const seenToolCalls = new Set<string>()
    const toolSteps = new Map<string, number>()
    const streamKey = (kind: 'think' | 'text'): string => `kimi-stream-${kind}-${turn}-${generation}`
    /** The plan stream's key: a snapshot stream beside the think/text delta streams. */
    const planKey = `kimi-stream-plan-${turn}`

    /**
     * Fold one non-text chunk as a placeholder: image/resource_link content
     * has no text channel, so the transcript keeps a visible marker (and the
     * run output notes the drop) instead of the chunk vanishing. Flows exactly
     * like a text delta from here.
     */
    const foldDelta = (text: string): void => {
      roundText += text
      const key = streamKey('text')
      reserveStream(key, 'text')
      const stream = streams.get(key)
      if (stream !== undefined) {
        stream.text += text
        appendStreamSnapshot(stream, false, false)
      }
      localAgent?.reportRunProgress(childSession.id, { kind: 'delta', text })
    }

    /**
     * Render one ACP plan snapshot ({entries: [{content, status}]}) as
     * think-style lines. Each update carries the WHOLE plan, so the fold
     * replaces rather than appends.
     */
    const renderPlan = (update: JsonObject): string => {
      const entries = Array.isArray(update['entries']) ? update['entries'] as JsonObject[] : []
      const lines = entries.map((entry) => {
        const content = typeof entry['content'] === 'string' ? entry['content'] : ''
        const status = entry['status']
        const mark = status === 'completed' ? '☑' : status === 'in_progress' ? '▶' : '☐'
        return `${mark} ${content}`
      }).filter(line => line.trim() !== '☐' && line !== '')
      return lines.join('\n')
    }
    const foldPlan = (update: JsonObject): void => {
      const plan = renderPlan(update)
      if (plan === '') return
      // The plan's own snapshot stream (think-styled): every update replaces
      // the text and lands a snapshot at the reserved (turn, step); the
      // stream force-finalizes at settle (the wire carries no plan line
      // that could complete it).
      reserveStream(planKey, 'think')
      const stream = streams.get(planKey)
      if (stream !== undefined && stream.text !== plan) {
        stream.text = plan
        appendStreamSnapshot(stream, true, false)
      }
    }

    /**
     * Append one snapshot of a streaming item at its reserved (turn, step).
     * Batched per stream on a bounded deadline unless `force`; the forced
     * final snapshot carries `interrupted` (a cancelled turn reads 已停止
     * legitimately) and, when `withUsage`, the round's uncarried usage. An
     * empty stream leaves no boundary at all.
     */
    const streamPublisher = localAgent?.liveStreams === undefined ? undefined
      : new LiveStreamPublisher(localAgent.liveStreams, childSession, turn, persist,
        error => this.ctx.logger.warn(`live checkpoint failed: ${String(error)}`))
    const liveFlush = new LiveFlush(
      error => this.ctx.logger.warn(`live mirror flush failed: ${String(error)}`),
      this.config.snapshotMinIntervalMs ?? DEFAULT_SNAPSHOT_MIN_INTERVAL_MS,
    )

    const appendStreamSnapshot = (
      stream: { readonly step: number; kind: 'think' | 'text'; text: string; lastSnapshotAt: number; lastSnapshotLen: number; opened: boolean },
      force: boolean,
      interrupted: boolean,
      withUsage = false,
      final = false,
    ): void => {
      if (stream.text.trim() === '') return
      const now = Date.now()
      if (!force) {
        liveFlush.schedule(stream.step, () => appendStreamSnapshot(stream, true, interrupted, withUsage))
        return
      }
      liveFlush.cancel(stream.step)
      if (streamPublisher !== undefined && !final) {
        if (!stream.opened) {
          childSession.append('step/start', { turn, step: stream.step })
          stream.opened = true
        }
        streamPublisher.update(stream.step, stream.kind, stream.text)
        stream.lastSnapshotAt = now
        stream.lastSnapshotLen = stream.text.length
        return
      }
      if (!stream.opened) {
        childSession.append('step/start', { turn, step: stream.step })
        stream.opened = true
      }
      childSession.append('assistant/message', {
        turn,
        step: stream.step,
        message: assistantEvent([
          stream.kind === 'think'
            ? { type: 'reasoning' as const, text: stream.text }
            : { type: 'text' as const, text: stream.text },
        ]),
        stream: [],
        ...withUsage && roundUsage !== undefined ? { usage: roundUsage } : {},
        ...interrupted ? { interrupted: true } : {},
      }, { surfaceOp: 'append' })
      if (withUsage) roundUsage = undefined
      stream.lastSnapshotAt = now
      stream.lastSnapshotLen = stream.text.length
      persist()
    }

    /**
     * Reserve the step one streaming item will occupy — past every folded
     * line (the session's own event ledger: the file fold writes events
     * synchronously) and every earlier reservation. A kind switch forces one
     * freshness snapshot of the current stream (skipped when its text has not
     * grown since the last one); its completion still folds at its own
     * reserved step when the wire line lands.
     */
    const reserveStream = (key: string, kind: 'think' | 'text'): void => {
      if (activeStream !== undefined && activeStream !== key) {
        const previous = streams.get(activeStream)
        if (previous !== undefined && previous.text.length !== previous.lastSnapshotLen) {
          appendStreamSnapshot(previous, true, false)
        }
        activeStream = undefined
      }
      let stream = streams.get(key)
      if (stream === undefined) {
        let step = nextKimiSessionStep(childSession, turn)
        for (const reserved of reservedSteps) step = Math.max(step, reserved + 1)
        reservedSteps.push(step)
        stream = { kind, step, text: '', lastSnapshotAt: 0, lastSnapshotLen: 0, opened: false }
        streams.set(key, stream)
      }
      activeStream = key
    }

    /**
     * The fold-pass coordination surface : the file
     * fold skips reserved steps for sequential folds and pairs a completed
     * think/assistant line with its stream — scoped to THIS round's turn, so
     * an earlier round's leftover lines never consume this round's stream.
     */
    const mirrorStreams: KimiMirrorStreams = {
      reservedSteps: t => t === turn ? reservedSteps : [],
      completeTool: (line) => {
        if (line.turn !== turn) return undefined
        const step = toolSteps.get(line.id)
        if (step === undefined) return undefined
        toolSteps.delete(line.id)
        return { step, opened: true }
      },
      completeStream: (line) => {
        if (line.turn !== turn) return undefined
        const kind = line.kind === 'think' ? 'think' : 'text'
        const entry = [...streams.entries()].find(([key, stream]) => key !== planKey && stream.kind === kind)
        if (entry === undefined) return undefined
        const [key, stream] = entry
        liveFlush.cancel(stream.step)
        streamPublisher?.finish(stream.step)
        streams.delete(key)
        if (activeStream === key) activeStream = undefined
        return { step: stream.step, opened: stream.opened }
      },
    }
    const mirrorOptions = (): KimiMirrorOptions => ({ streams: mirrorStreams })

    /**
     * Observation accounting across mirror passes: a pass whose window
     * attached its usage to a folded message is already carried; anything else
     * sums into the round's uncarried remainder (the final snapshot's payload).
     * The wire's model rides every pass that saw one — the settle report reads
     * the latest.
     */
    const noteMirrorUsage = (delta: KimiMirrorDelta): void => {
      if (delta.usage !== undefined && delta.usageAttached !== true) {
        roundUsage = addTokenUsage(roundUsage, delta.usage)
      }
      if (delta.model !== undefined) roundModel = delta.model
    }

    /** Throttled push-triggered mirror pass; the file fold stays the only transcript source. */
    const triggerMirror = (): void => {
      const now = Date.now()
      if (now - lastMirrorAt < this.timeouts.mirrorThrottleMs) return
      lastMirrorAt = now
      mirrorQueue = mirrorQueue.then(() =>
        mirrorKimiDelta(this.ctx, childSession, spec.homeDir, runtime?.sessionId === undefined ? undefined : bareKimiSessionId(runtime.sessionId), mirrorOptions()).then((delta) => {
          noteMirrorUsage(delta)
        }).catch((error: unknown) => {
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
        if (content !== undefined && content.type !== undefined && content.type !== 'text') {
          // A non-text chunk (image, resource_link, …): no text channel exists,
          // so fold a visible placeholder instead of dropping it silently.
          foldDelta(`[未支持的内容类型 ${content.type}]`)
          triggerMirror()
          return
        }
        const text = content?.text ?? ''
        if (text !== '') foldDelta(text)
      } else if (kind === 'agent_thought_chunk') {
        const content = update['content'] as { type?: string; text?: string } | undefined
        const text = content?.text ?? ''
        if (text !== '') {
          const key = streamKey('think')
          reserveStream(key, 'think')
          const stream = streams.get(key)
          if (stream !== undefined) {
            stream.text += text
            appendStreamSnapshot(stream, false, false)
          }
        }
      } else if (kind === 'tool_call') {
        const id = typeof update['toolCallId'] === 'string' ? update['toolCallId'] : undefined
        if (id === undefined || !seenToolCalls.has(id)) {
          if (id !== undefined) {
            seenToolCalls.add(id)
            let step = nextKimiSessionStep(childSession, turn)
            for (const reserved of reservedSteps) step = Math.max(step, reserved + 1)
            reservedSteps.push(step)
            toolSteps.set(id, step)
            childSession.append('step/start', { turn, step })
            persist()
          }
          // ACP has no text-item ids. A new tool call separates generation
          // segments; late file folds consume same-kind segments in order.
          generation++
        }
      } else if (kind === 'plan') {
        // ACP plan updates are full-plan snapshots; the wire.jsonl fold never
        // carries them (kimi records text/think parts only), so the driver
        // itself folds them — a snapshot stream in the token granularity, one
        // settle-time fold otherwise.
        foldPlan(update)
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
      try {
        await this.configureSession(rt, spec)
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
      // the request IS the turn. The prompt's user/message lands here too
      // (codex/claude live parity): immediately visible instead of waiting
      // for the wire flush + mirror pass — which would render the streamed
      // think/text ABOVE the question. The fold skips it (turn+text dedupe).
      childSession.append('turn/start', { turn })
      childSession.append('user/message', createUserMessage({
        content: [{ type: 'text', text: task }],
        source: { kind: 'user' },
      }), { surfaceOp: 'append' })
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

    /**
     * Settle reconciliation: the kimi wire flushes asynchronously past the
     * prompt response (prompt lines early, the answer by turn end), so the
     * final mirror folds until consecutive reads see no growth — bounded, so
     * a stuck flush cannot pin the round beyond the quiescence window.
     */
    const settleMirror = async (): Promise<void> => {
      await mirrorQueue.catch(() => {})
      const sessionId = runtime?.sessionId === undefined ? undefined : bareKimiSessionId(runtime.sessionId)
      let lastTotal = -1
      let stableReads = 0
      const deadline = Date.now() + SETTLE_MIRROR_QUIESCE_MS
      for (;;) {
        const delta = await mirrorKimiDelta(this.ctx, childSession, spec.homeDir, sessionId, mirrorOptions())
        noteMirrorUsage(delta)
        localAgent?.reportRunProgress(childSession.id, { kind: 'mirror', mirroredLines: delta.total })
        stableReads = delta.total === lastTotal ? stableReads + 1 : 0
        lastTotal = delta.total
        if (stableReads >= SETTLE_MIRROR_STABLE_READS) break
        if (Date.now() >= deadline) break
        await delay(SETTLE_MIRROR_POLL_MS)
      }
    }

    const result: Promise<SubagentResult> = settleRunResult({
      attempt: () => Promise.race([attempt, abortBranch]),
      collectOutput,
      cancelled: () => runAbort.signal.aborted,
      onError: (error: Error, stopReason: SubagentStopReason) => {
        const diagnostics = runtime?.diagnostics ?? ''
        const suffix = diagnostics === '' ? '' : `; ${diagnostics}`
        this.ctx.logger.warn(`subagent-kimi: live round failed (${stopReason}): ${error.message}${suffix}`)
        this.reportAuthIfShaped(error, spec.homeDir)
      },
      signal: request.signal,
      onAbort,
    }).then(async (settled) => {
      roundSettled = true
      liveFlush.dispose()
      promptInFlight = false
      if (turnOpened) {
        // Reconcile the file fold INSIDE the turn window
        // (bounded quiescence — the price of the wire flush race; a mirror
        // failure never fails the round), so every streamed item's completion
        // fold lands at its reserved step before turn/end. Streams whose
        // completing wire line never folded (abort, or a flush outlasting the
        // quiescence window) then finalize in place: one forced snapshot each
        // — interrupted on a non-completed round, the LAST one carrying the
        // round's uncarried usage — then step/end.
        try {
          await settleMirror()
        } catch (error) {
          this.ctx.logger.warn(`subagent-kimi: live settle mirror failed: ${thrown(error).message}`)
        }
        if (streams.size > 0) {
          const remaining = [...streams.values()]
          for (const [position, stream] of remaining.entries()) {
            appendStreamSnapshot(stream, true, settled.stopReason !== 'completed', position === remaining.length - 1, true)
            streamPublisher?.finish(stream.step)
            if (stream.opened) childSession.append('step/end', { turn, step: stream.step })
          }
          streams.clear()
          activeStream = undefined
          persist()
        }
        for (const step of toolSteps.values()) childSession.append('step/end', { turn, step })
        toolSteps.clear()
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
      streamPublisher?.dispose()
      // Settlement clears the round's update sink.
      if (runtime !== undefined) runtime.onSessionUpdate = undefined
      return settled
    })

    // Re-arm the reaper and publish observations after in-turn reconciliation.
    void result.then(() => {
      // Every settled round reports its observed model through the
      // registry's observation channel (record merge + `settled` event) —
      // the live drive's half of the exec path's onRoundSettled. A mirror
      // failure never drops an observation an earlier pass already saw, and
      // a round that never opened owns no span to observe. Degrades
      // silently on a core predating recordRoundSettled.
      if (turnOpened) {
        const round = {
          ...roundModel === undefined ? {} : { observedModel: roundModel },
        }
        const registry = localAgent as unknown as { recordRoundSettled?: (id: string, r: typeof round) => void } | undefined
        registry?.recordRoundSettled?.(childSession.id, round)
      }
      this.armIdleTimer(String(childSession.id))
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
  release(): void
} | undefined>()
