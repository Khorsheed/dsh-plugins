/**
 * The codex provider's live driver: one resident `codex app-server --stdio`
 * process per member (child session), driven over the vendor's experimental
 * JSON-RPC app-server wire (protocol-probed against codex-cli 0.144.0's
 * `app-server generate-json-schema`; the harness `subagent-codex` package is
 * the reference implementation). A delegation round is a `turn/start` on the
 * member's resident thread instead of a fresh `codex exec` process, which buys
 * what the process boundary could not: runtime-level graceful interrupt
 * (`turn/interrupt`; the process survives and the thread stays continuable)
 * and push-mode mirroring (`item/completed` + delta notifications instead of
 * folding a polled stdout stream).
 *
 * Lifecycle mirrors the dsh live driver's discipline (M1): lazy spawn with an
 * initialize handshake, one in-flight spawn per member, idle-timeout reclaim
 * (stdin EOF → grace → SIGTERM ladder — the app-server wire has no shutdown
 * method), crash re-spawn with `thread/resume` of the recorded thread id, a
 * channel breaker with cooldown, and `disposeAll` on plugin unload. The wire
 * adapter is self-contained (no new dependency): line framing with a
 * StringDecoder for split UTF-8 tails, request correlation, and unattended
 * auto-answers for the server→client approval requests (the proposal's
 * default permission policy: answer exactly as the unattended exec mode does).
 * @module @khorsheed/dsh-local-agent-codex/live-driver
 */

import { randomUUID } from 'node:crypto'
import { StringDecoder } from 'node:string_decoder'
import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock, TokenUsage } from '@deepseek-ai/dsh-llm'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
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
import type { Config } from './index.ts'
import type { LocalAgentResolvedConfiguration } from '@khorsheed/dsh-local-agent/types'
import {
  appendCodexTranscriptLine,
  codexAssistantEvent,
  codexLineText,
  DEFAULT_DISPOSE_GRACE_MS,
  registerCodexMemberRun,
  textTask,
  type CodexTranscriptLine,
} from './codex-cli-provider.ts'
import { codexRolloutRoundFacts } from './records.ts'

/** Default idle lifetime of an unused resident runtime before reclaim. */
export const DEFAULT_LIVE_IDLE_MS = 30 * 60_000

/** Default timeout for a wire request acknowledgement. */
export const DEFAULT_LIVE_REQUEST_TIMEOUT_MS = 30_000

/** Default timeout for the app-server handshake (a cold boot can be slow). */
export const DEFAULT_LIVE_INITIALIZE_TIMEOUT_MS = 60_000

/** Bounded wait for an interrupted turn to converge while a run disposes. */
export const DEFAULT_LIVE_DISPOSE_CONVERGE_MS = 5_000

/** How long a tripped channel breaker stays on the exec fallback. */
export const DEFAULT_LIVE_CHANNEL_RETRY_MS = 5 * 60_000

/** Grace between stdin EOF and SIGTERM when reclaiming an app-server. */
const RECLAIM_EOF_GRACE_MS = 1_000

/** Default minimum interval between one streaming item's snapshot messages. */
export const DEFAULT_SNAPSHOT_MIN_INTERVAL_MS = LIVE_FLUSH_INTERVAL_MS

/** Default minimum text growth between one streaming item's snapshot messages. */
export const DEFAULT_SNAPSHOT_MIN_CHARS = 0

/**
 * The app-server channel could not come up (spawn failure or handshake
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
export interface CodexLiveDriverTimeouts {
  readonly initializeMs: number
  readonly requestMs: number
  readonly convergeMs: number
  readonly channelRetryMs: number
}

const DEFAULT_TIMEOUTS: CodexLiveDriverTimeouts = {
  initializeMs: DEFAULT_LIVE_INITIALIZE_TIMEOUT_MS,
  requestMs: DEFAULT_LIVE_REQUEST_TIMEOUT_MS,
  convergeMs: DEFAULT_LIVE_DISPOSE_CONVERGE_MS,
  channelRetryMs: DEFAULT_LIVE_CHANNEL_RETRY_MS,
}

/** How much of the live event stream crosses into the child session. */
export type CodexLiveMirrorGranularity = 'event' | 'token'

/** Fully resolved inputs for one live round. */
export interface CodexLiveRoundSpec {
  /** Parent Session workspace; also the runtime process cwd. */
  readonly cwd: string
  /** The codex harness's scoped home, injected as the runtime's `CODEX_HOME`. */
  readonly homeDir: string
  /** dsh subagent session recording this delegation (always live on this path). */
  readonly childSession: Session
  /** The delegating session (member-channel registration). */
  readonly parentSessionId: string
  /**
   * Resume round: continue the thread recorded as `cliSessionId`, appending
   * under this turn number. Also the reattach path after a runtime crash.
   */
  readonly resume?: { readonly cliSessionId: string; readonly turn: number } | undefined
  /** Fresh round: called with the server-assigned thread id (delegation record). */
  readonly onThreadId?: ((threadId: string) => void) | undefined
  /**
   * The member's START model — the delegation's own requested model, or the
   * composer's session-level override, as resolved by the provider. When it
   * names one, a resident runtime bound to a DIFFERENT model is retired
   * before the spawn so the round respawns onto it (the same CLI session
   * resumes — the rollout carries over). Absent means the spawn resolver
   * decides (override → recorded → settings).
   */
  readonly startModel?: string | undefined
  readonly configuration?: LocalAgentResolvedConfiguration
}

type JsonObject = Record<string, unknown>

function thrown(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

/**
 * Auth-shaped failure signatures in codex's error output: the endpoint
 * rejected the credential. Mirrors the exec path's detector
 * (CODEX_AUTH_FAILURE in codex-cli-provider.ts); the live path matches
 * against turn-failure messages, which is where a mid-run 401 surfaces when
 * the process does not exit.
 */
export const CODEX_LIVE_AUTH_FAILURE = /401 unauthorized|unauthorized|authentication failed|not logged in|access token/i

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Map one app-server `item/completed` ThreadItem onto the shared transcript
 * line shape — the live transport's entry into the SAME fold the exec NDJSON
 * parser owns (`foldCodexStreamLine`); both produce `CodexTranscriptLine`s
 * and append through `appendCodexTranscriptLine`, so the two drivers' final
 * child transcripts cannot drift.
 */
export function codexAppServerItemToLine(item: JsonObject): CodexTranscriptLine | undefined {
  // The app-server ThreadItem carries its own id; the fold falls back to a
  // synthetic one when it is absent (pairing only needs per-run uniqueness).
  const itemId = typeof item['id'] === 'string' ? item['id'] : undefined
  switch (item['type']) {
    case 'reasoning': {
      const parts = [item['summary'], item['content']]
        .filter(Array.isArray)
        .flat()
        .filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '')
      return parts.length === 0
        ? undefined
        : { kind: 'think', text: parts.join('\n'), ...itemId === undefined ? {} : { itemId } }
    }
    case 'agentMessage':
      return typeof item['text'] === 'string'
        ? { kind: 'text', text: item['text'], ...itemId === undefined ? {} : { itemId } }
        : undefined
    case 'commandExecution': {
      const command = typeof item['command'] === 'string' ? item.command : undefined
      const output = typeof item['aggregatedOutput'] === 'string' && item['aggregatedOutput'].trim() !== ''
        ? item['aggregatedOutput'] as string
        : undefined
      if (command === undefined && output === undefined) return undefined
      return {
        kind: 'tool',
        id: itemId ?? `codex-live-${randomUUID()}`,
        name: 'Bash',
        ...command === undefined ? {} : { args: command },
        ...output === undefined ? {} : { result: output },
      }
    }
    case 'webSearch':
      return { kind: 'tool', id: itemId ?? `codex-live-${randomUUID()}`, name: 'WebSearch' }
    case 'fileChange': {
      // A patch application: {id, changes: [{path, kind, diff?}], status}.
      // Without this case codex's file edits were invisible in the mirror.
      const changes = Array.isArray(item['changes']) ? item['changes'] as JsonObject[] : []
      const args = changes
        .map(change => `${typeof change['kind'] === 'string' ? change['kind'] : 'update'}: ${typeof change['path'] === 'string' ? change['path'] : '?'}`)
        .join('\n')
      const diff = changes
        .map(change => change['diff'])
        .filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '')
        .join('\n')
      return {
        kind: 'tool',
        id: itemId ?? `codex-live-${randomUUID()}`,
        name: 'ApplyPatch',
        ...args === '' ? {} : { args },
        ...diff === '' ? {} : { result: diff },
      }
    }
    case 'dynamicToolCall': {
      // Non-shell tools (e.g. the multi-agent `wait`): {id, tool, arguments, status}.
      const tool = typeof item['tool'] === 'string' ? item.tool : 'dynamic'
      const args = item['arguments'] === undefined || item['arguments'] === null
        ? undefined
        : typeof item['arguments'] === 'string' ? item['arguments'] : JSON.stringify(item['arguments'])
      return {
        kind: 'tool',
        id: itemId ?? `codex-live-${randomUUID()}`,
        name: tool,
        ...args === undefined || args === '' ? {} : { args },
      }
    }
    case 'collabAgentToolCall': {
      const tool = typeof item['tool'] === 'string' ? item.tool : 'collab'
      return { kind: 'tool', id: itemId ?? `codex-live-${randomUUID()}`, name: `collab/${tool}` }
    }
    case 'mcpToolCall': {
      const server = typeof item['server'] === 'string' ? item.server : undefined
      const tool = typeof item['tool'] === 'string' ? item.tool : undefined
      return {
        kind: 'tool',
        id: itemId ?? `codex-live-${randomUUID()}`,
        name: server !== undefined && tool !== undefined ? `${server}/${tool}` : tool ?? 'mcp',
      }
    }
    case 'plan':
      return typeof item['text'] === 'string' && item['text'].trim() !== ''
        ? { kind: 'think', text: item['text'] }
        : undefined
    default:
      return undefined
  }
}

/** Map the app-server's per-turn usage breakdown onto the shared usage contract. */
function usageFromAppServer(breakdown: JsonObject): TokenUsage {
  const input = Number(breakdown['inputTokens'])
  const cached = Number(breakdown['cachedInputTokens'])
  const output = Number(breakdown['outputTokens'])
  const usage: TokenUsage = {
    inputTokens: Number.isFinite(input) && Number.isFinite(cached)
      ? Math.max(0, input - cached)
      : Number.isFinite(input) ? input : 0,
    outputTokens: Number.isFinite(output) ? output : 0,
  }
  if (Number.isFinite(cached) && cached > 0) usage.cacheReadTokens = cached
  return usage
}

/**
 * The app-server wire peer: newline-delimited JSON-RPC over the child's
 * stdio. Self-contained on purpose (no new package dependency): request
 * correlation, StringDecoder framing, and server→client request answering
 * (the approval surface, auto-declined per the unattended policy).
 */
class CodexWirePeer {
  private buffer = ''
  private readonly decoder = new StringDecoder('utf8')
  private nextId = 0
  private readonly pending = new Map<string, {
    resolve: (result: unknown) => void
    reject: (error: Error) => void
    timer: NodeJS.Timeout
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

  request<T>(method: string, params: JsonObject, timeoutMs?: number): Promise<T> {
    if (this.closed) return Promise.reject(new Error('subagent-codex live: the wire is closed'))
    this.nextId += 1
    const id = `req_${this.nextId}`
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`subagent-codex live: ${method} timed out`))
        timer.unref()
      }, timeoutMs ?? this.requestMs)
      timer.unref()
      this.pending.set(id, { resolve: result => resolve(result as T), reject, timer })
      this.write({ jsonrpc: '2.0', id, method, params })
    })
  }

  notify(method: string, params?: JsonObject): void {
    this.write(params === undefined ? { jsonrpc: '2.0', method } : { jsonrpc: '2.0', method, params })
  }

  /** Detach and reject every outstanding request. */
  close(): void {
    if (this.closed) return
    this.closed = true
    for (const request of this.pending.values()) {
      clearTimeout(request.timer)
      request.reject(new Error('subagent-codex live: the wire closed'))
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
      this.warn('subagent-codex live: ignored a malformed wire line')
      return
    }
    try {
      const hasId = typeof message.id === 'string' || typeof message.id === 'number'
      if (hasId && typeof message.method === 'string') {
        // A server→client REQUEST (the approval surface): answer unattended.
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
        clearTimeout(request.timer)
        const wireError = message.error as { message?: string } | undefined
        if (wireError !== undefined && wireError !== null) {
          request.reject(new Error(`subagent-codex live: ${wireError.message ?? 'wire error'}`))
        } else {
          request.resolve(message.result)
        }
        return
      }
      if (typeof message.method === 'string') {
        this.onNotification(message.method, (message.params ?? {}) as JsonObject)
      }
    } catch (error) {
      this.warn(`subagent-codex live: wire line handler failed: ${thrown(error).message}`)
    }
  }
}

/** One resident app-server process: the wire peer, the loaded thread's id, and
 * the reclaim ladder (stdin EOF → grace → SIGTERM → grace → SIGKILL).
 */
class CodexLiveRuntime {
  dead = false
  private reclaimed = false
  readonly peer: CodexWirePeer
  /** The member's loaded thread; assigned by the first round's thread/start or thread/resume. */
  threadId: string | undefined
  /**
   * The model this process bound at spawn (the `-c model=…` override), or
   * undefined when it spawned with no model flag at all. A round whose start
   * model differs retires the runtime instead of silently running the old one.
   */
  configurationKey: string | undefined
  boundModel: string | undefined
  /** Turn ids of settled/interrupted rounds — their late notifications are tagged out. */
  readonly retiredTurnIds = new Set<string>()
  /** The active round's notification sink; installed per round, cleared at settle. */
  onWireNotification: ((method: string, params: JsonObject) => void) | undefined
  onDead: (() => void) | undefined
  private stderrTail = ''
  private readonly stderrDecoder = new StringDecoder('utf8')

  constructor(
    readonly child: SubprocessHandle,
    onServerRequest: (method: string, params: JsonObject) => unknown,
    warn: (message: string) => void,
    requestMs: number,
  ) {
    this.peer = new CodexWirePeer(
      child.stdout,
      child.stdin,
      warn,
      onServerRequest,
      (method, params) => { this.onWireNotification?.(method, params) },
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

/** Unattended approval answer: prefer cancel, else decline (harness-proven tables). */
function unattendedDecision(params: JsonObject): 'cancel' | 'decline' {
  const available = params['availableDecisions']
  if (Array.isArray(available)) {
    if (available.includes('cancel')) return 'cancel'
    if (available.includes('decline')) return 'decline'
  }
  return 'decline'
}

/**
 * The codex live driver owns every resident app-server runtime of this
 * provider generation. Created only when `live: true`; disposed with the
 * plugin.
 */
export class CodexLiveDriver {
  private readonly runtimes = new Map<string, CodexLiveRuntime>()
  /** In-flight spawns by member: concurrent rounds share one, disposeAll waits them out. */
  private readonly ensuring = new Map<string, Promise<CodexLiveRuntime>>()
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
    private readonly config: Pick<Config, 'sandbox'> & {
      liveIdleMs?: number
      liveMirrorGranularity?: CodexLiveMirrorGranularity
      /** Maximum batching wait for incremental streaming messages. */
      snapshotMinIntervalMs?: number
      /** @deprecated Character growth no longer gates live publication. */
      snapshotMinChars?: number
      /**
       * Resolver for the member's configured model, read at each RUNTIME SPAWN
       * (the app-server is where a live round's CLI starts). Receives the
       * member's child session id so the session-level override can outrank
       * the settings value; absent, or resolving to nothing, leaves the spawn
       * argv unchanged.
       */
      model?: (childSessionId: string) => string | undefined
    },
    private readonly timeouts: CodexLiveDriverTimeouts = DEFAULT_TIMEOUTS,
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
   * a member whose retiring generation still hosts the (same) codex thread.
   */
  hasRuntime(key: string): boolean {
    return this.runtimes.has(key) || this.ensuring.has(key)
  }

  /** @deprecated Compatibility no-op: live output is always incremental. */
  setLiveMirrorGranularity(_granularity: CodexLiveMirrorGranularity): void {}

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
   * undefined when the runtime spawned with no model flag. Null when the
   * member has no live runtime in this generation — the broker's switch check
   * distinguishes "no runtime to retire" from "runtime bound to no model".
   */
  boundModelOf(key: string): string | undefined | null {
    const runtime = this.runtimes.get(key)
    if (runtime === undefined || runtime.dead) return null
    return runtime.boundModel
  }

  /**
   * Retire the member's resident runtime so the NEXT round respawns (the CLI
   * session itself carries over via thread/resume). The composer's model
   * switch calls this after storing the new override; the caller guarantees
   * no round is in flight for the member.
   */
  async retireRuntime(key: string): Promise<void> {
    await this.reclaim(key)
  }

  /** The member's runtime, spawning it (once per member at a time) when absent or dead. */
  private async ensureRuntime(spec: CodexLiveRoundSpec, signal: AbortSignal): Promise<CodexLiveRuntime> {
    const key = String(spec.childSession.id)
    const startModel = spec.startModel?.trim()
    const existing = this.runtimes.get(key)
    if (existing !== undefined && !existing.dead) {
      // A round that names its own start model never runs on a runtime bound
      // to a different one: retire so the respawn binds the asked-for model
      // (the codex thread resumes — only the process is replaced).
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
    const spawn = this.spawnRuntime(spec, signal)
      .finally(() => { this.ensuring.delete(key) })
    this.ensuring.set(key, spawn)
    return spawn
  }

  /**
   * Spawn the member's resident app-server and prove the wire with a
   * handshake. Failure trips the channel breaker; a cancellation mid-spawn
   * reclaims the half-started process without touching the breaker.
   */
  private async spawnRuntime(spec: CodexLiveRoundSpec, signal: AbortSignal): Promise<CodexLiveRuntime> {
    const key = String(spec.childSession.id)
    if (this.disposed) {
      throw new LiveChannelUnavailableError('the live driver is disposed')
    }
    // The member bridge rides a per-process `-c` override, exactly as in the
    // exec path; the resident process carries one member, so its token lives
    // with the process (released on reclaim/crash), not per round.
    const member = registerCodexMemberRun(this.ctx, String(spec.childSession.id), spec.parentSessionId)
    // `codex app-server` has no `-m` (verified against codex-cli 0.144.0), so
    // the model rides the process-level `-c` override the CLI documents for
    // exactly this — the same mechanism the member bridge already uses. The
    // member's START model (a delegation-level request or the session-level
    // override, resolved by the provider) wins; otherwise the spawn resolver
    // reads the member's configured model (override → settings). The resident
    // process carries one member, so reading here binds the model for that
    // member's runtime; a later switch reaches it by retiring the runtime
    // first (idle reclaim, crash, a live toggle, or the composer's model
    // picker).
    const startModel = spec.startModel?.trim()
    const model = spec.configuration !== undefined ? spec.configuration.model
      : startModel !== undefined && startModel !== '' ? startModel : this.config.model?.(key)?.trim()
    const spawnSpec: SubprocessSpawnSpec = {
      argv: [
        'codex', 'app-server',
        ...member === undefined ? [] : ['-c', member.configOverride],
        ...model === undefined || model === '' ? [] : ['-c', `model=${JSON.stringify(model)}`],
        ...spec.configuration?.effort === undefined ? [] : ['-c', `model_reasoning_effort=${JSON.stringify(spec.configuration.effort)}`],
        '--stdio',
      ],
      cwd: spec.cwd,
      stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
      graceMs: DEFAULT_DISPOSE_GRACE_MS,
      env: delegationEnv({ CODEX_HOME: spec.homeDir }),
    }
    let child: SubprocessHandle
    try {
      child = this.ctx.subprocess.spawn(spawnSpec)
    } catch (error) {
      member?.release()
      this.markChannelBroken()
      throw new LiveChannelUnavailableError(`the app-server failed to spawn: ${thrown(error).message}`)
    }
    const runtime = new CodexLiveRuntime(
      child,
      (method, params) => this.answerServerRequest(method, params),
      message => { this.ctx.logger.warn(message) },
      this.timeouts.requestMs,
    )
    // A blank resolution binds no model at all — record exactly what the argv
    // carries so a later start-model comparison never retires needlessly.
    runtime.boundModel = model === undefined || model === '' ? undefined : model
    runtime.configurationKey = spec.configuration === undefined ? undefined : JSON.stringify(spec.configuration)
    runtime.onDead = () => {
      // Delete only OUR registration (crash-then-respawn interleave safety).
      if (this.runtimes.get(key) === runtime) this.runtimes.delete(key)
      this.clearIdleTimer(key)
      member?.release()
    }
    const aborted = new Promise<never>((_, reject) => {
      const cancel = (): void => { reject(new Error('subagent-codex: run cancelled locally')) }
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
      await Promise.race([
        runtime.peer.request('initialize', {
          clientInfo: { name: 'dsh-local-agent-codex', title: 'dsh local-agent codex live driver', version: '0.1.0' },
          capabilities: { experimentalApi: false, requestAttestation: false },
        }, this.timeouts.initializeMs),
        aborted,
      ])
      runtime.peer.notify('initialized')
    } catch (error) {
      await runtime.reclaim()
      if (signal.aborted) throw thrown(error)
      this.markChannelBroken()
      throw new LiveChannelUnavailableError(`the app-server handshake failed: ${thrown(error).message}`)
    }
    if (this.disposed) {
      await runtime.reclaim()
      throw new LiveChannelUnavailableError('the live driver was disposed during spawn')
    }
    this.channelBrokenAt = undefined
    this.runtimes.set(key, runtime)
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
    if (!CODEX_LIVE_AUTH_FAILURE.test(error.message)) return
    // Duck-typed: the method lands with the auth-truthfulness core; older
    // cores simply skip the mark.
    const registry = this.ctx.localAgent as unknown as {
      reportAuthFailure?: (harness: string, detail: string) => void
    }
    if (typeof registry.reportAuthFailure === 'function') {
      registry.reportAuthFailure('codex', error.message.split('\n').find(line => line.trim() !== '') ?? error.message)
    }
  }

  /**
   * Auto-answer the app-server's approval/elicitation requests, matching the
   * unattended exec behavior (and the harness reference implementation's
   * tables): the live driver never grants interactive approval. This is the
   * proposal's default permission policy; the relay hook for a human
   * approval UI is a later increment.
   */
  private answerServerRequest(method: string, params: JsonObject): unknown {
    switch (method) {
      case 'item/commandExecution/requestApproval':
      case 'item/fileChange/requestApproval':
        return { decision: unattendedDecision(params) }
      case 'item/permissions/requestApproval':
        return { permissions: {}, scope: 'turn' }
      case 'item/tool/requestUserInput':
        return { answers: {} }
      case 'mcpServer/elicitation/request':
        return { action: 'decline', content: null, _meta: null }
      default:
        throw new Error(`subagent-codex live: unsupported app-server request ${method}`)
    }
  }

  /**
   * Drive one delegation round on the member's resident app-server. Mirrors
   * the exec run's settlement contract exactly so the facade, the tool, and
   * the projections cannot tell the difference — except `cancel` is a runtime
   * interrupt and the process survives. Cancellation is honored in every
   * window (the M1 acceptance lesson): the abort listener registers before
   * any await, the spawn/handshake races it, and a pre-accept cancel reclaims
   * the fresh runtime instead of letting the turn run unwatched.
   */
  /** Create/resume the native thread without starting a model turn. */
  async prepare(spec: CodexLiveRoundSpec, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    if (this.draining || this.disabled) throw new LiveChannelUnavailableError('the live driver is unavailable for preparation')
    try {
      const runtime = await this.ensureRuntime(spec, signal)
      await this.ensureThread(runtime, spec)
      signal.throwIfAborted()
      this.armIdleTimer(String(spec.childSession.id))
    } catch (error) {
      await this.reclaim(String(spec.childSession.id))
      throw error
    }
  }

  private async ensureThread(rt: CodexLiveRuntime, spec: CodexLiveRoundSpec): Promise<void> {
    if (rt.threadId === undefined) {
      const permissionParams = {
        approvalPolicy: 'never',
        sandbox: this.config.sandbox ?? 'workspace-write',
      }
      if (spec.resume === undefined) {
        const response = await rt.peer.request<{ thread: { id: string } }>('thread/start', {
          cwd: spec.cwd,
          ephemeral: false,
          ...permissionParams,
        })
        if (typeof response?.thread?.id !== 'string') {
          throw new Error('subagent-codex live: thread/start returned no thread id')
        }
        rt.threadId = response.thread.id
      } else {
        const response = await rt.peer.request<{ thread: { id: string } }>('thread/resume', {
          threadId: spec.resume.cliSessionId,
          cwd: spec.cwd,
          ...permissionParams,
        })
        if (typeof response?.thread?.id !== 'string') {
          throw new Error('subagent-codex live: thread/resume returned no thread')
        }
        rt.threadId = response.thread.id
      }
    }
    if (spec.resume === undefined && rt.threadId !== undefined) spec.onThreadId?.(rt.threadId)
  }

  async startRound(request: SubagentStartRequest, spec: CodexLiveRoundSpec): Promise<SubagentRun> {
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
  private async startRoundLocked(request: SubagentStartRequest, spec: CodexLiveRoundSpec): Promise<SubagentRun> {
    const task = textTask(request.prompt)
    if (request.signal.aborted) {
      throw new Error('subagent-codex: request was aborted before the run started')
    }
    // The drain race: the round chained before drain() but dequeued after it.
    // Refuse so the provider falls back to exec instead of reusing a runtime
    // the handoff is about to reclaim.
    if (this.draining) {
      throw new LiveChannelUnavailableError('the live driver is draining (a settings change retired this generation)')
    }
    if (this.disposed) {
      throw new Error('subagent-codex: the live driver is disposed')
    }

    const turn = spec.resume?.turn ?? 1
    const childSession = spec.childSession
    const localAgent = this.ctx.get('localAgent')
    /** The round's start moment, anchoring the settle read-back's rollout time window. */
    const startedAtMs = Date.now()

    const runAbort = new AbortController()
    let roundSettled = false
    let runtime: CodexLiveRuntime | undefined
    /** The in-flight turn's server-assigned id; interrupt needs it. */
    let activeTurnId: string | undefined
    /** Pre-ack turn id observed via turn/started (notifications can precede the response). */
    let pendingTurnId: string | undefined
    let turnOpened = false
    let lastText = ''
    /** Final-answer selection per the harness wire: final_answer phase beats unphased. */
    let lastFinalAnswer: string | undefined
    let lastUnphasedAnswer: string | undefined
    /** The round's folded transcript (the exec fold's line shape). */
    const lines: CodexTranscriptLine[] = []
    let mirrored = 0
    let usage: TokenUsage | undefined
    /** Whether a folded line already carries the round's usage (no backfill event exists). */
    let usageCarried = false
    /**
     * The step ledger: `reservedSteps` holds every step a stream reservation
     * consumed (in increasing order — permanently, whether the stream later
     * completes or stays an orphan snapshot), and a sequential line folds at
     * its index shifted past every reservation before it. A tool completed
     * mid-stream therefore folds ABOVE the stream's step and the projection
     * renders the round's chronological order.
     */
    const reservedSteps: number[] = []
    /**
     * The streaming items seen this round by item id:
     * deltas accumulate into throttled snapshot assistant/messages appended
     * at the item's reserved (turn, step) — the host folds repeated settles
     * at one coordinate into one live-updating chat node, which is the only
     * streaming channel left after 0.1.5 retired the durable per-chunk event.
     * The item's completion folds at the same step and finalizes it; an entry
     * whose completion never arrives is force-finalized at settle.
     */
    const streams = new Map<string, {
      readonly itemId: string
      readonly kind: 'think' | 'text'
      readonly step: number
      text: string
      lastSnapshotAt: number
      lastSnapshotLen: number
      /** step/start already emitted for this reservation. */
      opened: boolean
    }>()
    /** The item deltas currently accumulate into (items stream sequentially). */
    let activeStream: string | undefined
    /** Items/completions that arrived before the turn id was known. */
    const earlyNotifications: { method: string; params: JsonObject }[] = []
    let persistQueue: Promise<unknown> = Promise.resolve()
    const persist = (): void => {
      persistQueue = persistQueue.then(() => persistChildSession(this.ctx, childSession))
    }

    const requestCancel = (): void => {
      if (roundSettled || runAbort.signal.aborted) return
      runAbort.abort(new Error('subagent-codex: run cancelled locally'))
      // The live driver's core win: a graceful runtime interrupt instead of a
      // process kill. Best-effort; local settlement does not wait for it. The
      // turn id comes from the accept response — or from the turn/started
      // notification, which can land FIRST, so the accept window is covered
      // too (the B1 review finding).
      const turnId = activeTurnId ?? pendingTurnId
      if (turnId !== undefined && runtime?.threadId !== undefined && !runtime.dead) {
        void runtime.peer.request('turn/interrupt', {
          threadId: runtime.threadId,
          turnId,
        }).catch(() => {})
      }
    }
    const onAbort = (): void => { requestCancel() }
    request.signal.addEventListener('abort', onAbort, { once: true })

    const abortBranch = new Promise<never>((_, reject) => {
      runAbort.signal.addEventListener('abort', () => reject(new Error('subagent-codex: run cancelled locally')), { once: true })
    })

    const collectOutput = (): ContentBlock[] => {
      const partial = activeStream === undefined ? '' : streams.get(activeStream)?.text ?? ''
      const selected = lastFinalAnswer ?? lastUnphasedAnswer ?? (lastText !== '' ? lastText : partial === '' ? undefined : partial)
      return selected === undefined || selected.trim() === '' ? [] : [{ type: 'text', text: selected }]
    }

    /**
     * Append one snapshot of a streaming item at its reserved (turn, step).
     * Throttled per item by interval and growth unless `force`; the forced
     * final snapshot carries `interrupted` (a cancelled turn reads 已停止
     * legitimately) and, when `withUsage` and no folded line carried it, the
     * round's usage.
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
      const attachUsage = withUsage && !usageCarried && usage !== undefined
      childSession.append('assistant/message', {
        turn,
        step: stream.step,
        message: codexAssistantEvent([
          stream.kind === 'think'
            ? { type: 'reasoning' as const, text: stream.text }
            : { type: 'text' as const, text: stream.text },
        ]),
        stream: [],
        ...withUsage && !usageCarried && usage !== undefined ? { usage } : {},
        ...interrupted ? { interrupted: true } : {},
      }, { surfaceOp: 'append' })
      if (attachUsage) usageCarried = true
      stream.lastSnapshotAt = now
      stream.lastSnapshotLen = stream.text.length
      persist()
    }

    /**
     * Reserve the step one new streaming item will occupy — past every
     * completed line (folded or held back) and every earlier reservation. A
     * different item's deltas force one final snapshot of the current stream
     * (its completion still folds at its own reserved step when it lands).
     */
    const reserveStream = (itemId: string, kind: 'think' | 'text'): void => {
      if (activeStream !== undefined && activeStream !== itemId) {
        const previous = streams.get(activeStream)
        // A freshness snapshot on the item switch, skipped when the text has
        // not grown since the last one (the settle force always lands).
        if (previous !== undefined && previous.text.length !== previous.lastSnapshotLen) {
          appendStreamSnapshot(previous, true, false)
        }
        activeStream = undefined
      }
      let stream = streams.get(itemId)
      if (stream === undefined) {
        const step = lines.length + reservedSteps.length + 1
        reservedSteps.push(step)
        stream = { itemId, kind, step, text: '', lastSnapshotAt: 0, lastSnapshotLen: 0, opened: false }
        streams.set(itemId, stream)
      }
      activeStream = itemId
    }

    /** The sequential fold step for `lines[index]`: its position shifted past every reservation before it. */
    const foldStep = (index: number): number => {
      let step = index + 1
      for (const reserved of reservedSteps) {
        if (reserved <= step) step += 1
        else break
      }
      return step
    }

    /** Mirror folded lines [mirrored, upto); the last line is held back until completion. */
    const mirrorUpTo = (upto: number, withUsage: boolean): void => {
      // The usage rides the last NON-tool line (tool events carry no usage
      // slot, and a kill mid-command ends the transcript with a tool line).
      // A carrier mirrored in an earlier flush (before the usage was knowable)
      // loses the accounting — host 0.1.5 has no usage-backfill event.
      let usageIndex = -1
      if (withUsage) {
        for (let index = 0; index < lines.length; index += 1) {
          if (lines[index]?.kind !== 'tool') usageIndex = index
        }
      }
      for (let index = mirrored; index < upto; index += 1) {
        const line = lines[index]
        if (line === undefined) continue
        const lineUsage = withUsage && index === usageIndex ? usage : undefined
        if (lineUsage !== undefined) usageCarried = true
        const itemId = line.kind === 'tool' ? undefined : line.itemId
        const stream = itemId === undefined ? undefined : streams.get(itemId)
        if (itemId !== undefined && stream !== undefined) {
          // A streamed item folds at its reserved step, finalizing the
          // snapshots: the step opens only if no snapshot ever landed (a
          // fast item that stayed under the throttle), and closes here.
          liveFlush.cancel(stream.step)
          streams.delete(itemId)
          if (activeStream === itemId) activeStream = undefined
          if (!stream.opened) childSession.append('step/start', { turn, step: stream.step })
          const blocks = stream.kind === 'think'
            ? [{ type: 'reasoning' as const, text: line.kind === 'tool' ? '' : line.text }]
            : [{ type: 'text' as const, text: line.kind === 'tool' ? '' : line.text }]
          childSession.append('assistant/message', {
            turn,
            step: stream.step,
            message: codexAssistantEvent(blocks),
            stream: [],
            ...lineUsage === undefined ? {} : { usage: lineUsage },
          }, { surfaceOp: 'append' })
          streamPublisher?.finish(stream.step)
          childSession.append('step/end', { turn, step: stream.step })
        } else {
          appendCodexTranscriptLine(childSession, turn, foldStep(index), line, lineUsage)
        }
        mirrored = index + 1
        localAgent?.reportRunProgress(childSession.id, { kind: 'delta', text: codexLineText(line) })
      }
      if (upto > 0) persist()
    }

    let resolveCompletion!: (outcome: { status: string; error?: JsonObject }) => void
    const completion = new Promise<{ status: string; error?: JsonObject }>((resolve) => { resolveCompletion = resolve })

    const openTurn = (): void => {
      // The boundary opens after the accept ack (a definitive reject leaves no
      // dangling turn/start); the prompt and any early items flush inside it.
      childSession.append('turn/start', { turn })
      childSession.append('user/message', createUserMessage({
        content: [{ type: 'text', text: task }],
        source: { kind: 'user' },
      }), { surfaceOp: 'append' })
      turnOpened = true
      persist()
      localAgent?.reportRunProgress(childSession.id, { kind: 'delta', text: task })
      for (const early of earlyNotifications.splice(0)) {
        dispatchTurnNotification(early.method, early.params)
      }
    }

    /** Process one turn-scoped notification for the round's own turn id. */
    const dispatchTurnNotification = (method: string, params: JsonObject): void => {
      if (method === 'item/completed') {
        const item = params['item'] as JsonObject
        const line = codexAppServerItemToLine(item)
        if (item['type'] === 'agentMessage' && typeof item['text'] === 'string') {
          const phase = item['phase']
          if (phase === 'final_answer') lastFinalAnswer = item['text']
          else if (phase === null || phase === undefined) lastUnphasedAnswer = item['text']
          lastText = item['text']
        }
        if (line === undefined) return
        lines.push(line)
        // Hold back the volatile last line until turn/completed (it is the
        // round's usage carrier) — the exec live mirror's exact rule.
        mirrorUpTo(lines.length - 1, false)
        return
      }
      if (method === 'item/agentMessage/delta' || method === 'item/reasoning/textDelta') {
        if (typeof params['delta'] !== 'string') return
        const text = params['delta']
        if (text === '') return
        const reasoning = method === 'item/reasoning/textDelta'
        // The item id pairs the stream with its completion (the fold then
        // lands at the reserved step); a delta without one shares a
        // per-kind stream, matching the pre-item-id behavior.
        const itemId = typeof params['itemId'] === 'string'
          ? params['itemId']
          : `codex-stream-${reasoning ? 'think' : 'text'}-${turn}`
        reserveStream(itemId, reasoning ? 'think' : 'text')
        const stream = activeStream === undefined ? undefined : streams.get(activeStream)
        if (stream !== undefined) {
          stream.text += text
          appendStreamSnapshot(stream, false, false)
        }
        localAgent?.reportRunProgress(childSession.id, { kind: 'delta', text })
        return
      }
      if (method === 'thread/tokenUsage/updated') {
        const tokenUsage = params['tokenUsage'] as JsonObject | undefined
        const last = tokenUsage?.['last'] as JsonObject | undefined
        if (last !== undefined) usage = usageFromAppServer(last)
        return
      }
      if (method === 'turn/completed') {
        const turnData = params['turn'] as JsonObject
        mirrorUpTo(lines.length, true)
        resolveCompletion({
          status: String(turnData['status']),
          ...(turnData['error'] === null || turnData['error'] === undefined
            ? {}
            : { error: turnData['error'] as JsonObject }),
        })
      }
    }

    /** Route one wire notification: round-scoped, turn-id tagged, early ones buffered. */
    const dispatchNotification = (method: string, params: JsonObject): void => {
      const paramThreadId = params['threadId']
      if (typeof paramThreadId === 'string' && runtime?.threadId !== undefined && paramThreadId !== runtime.threadId) return
      if (method === 'turn/started') {
        const turnData = params['turn'] as JsonObject | undefined
        const id = turnData?.['id']
        if (typeof id === 'string' && activeTurnId === undefined && !runtime?.retiredTurnIds.has(id)) {
          pendingTurnId = id
        }
        return
      }
      if (!['item/completed', 'item/agentMessage/delta', 'item/reasoning/textDelta',
        'thread/tokenUsage/updated', 'turn/completed'].includes(method)) return
      // turn/completed carries the id inside its turn object; the rest carry
      // a top-level turnId.
      const turnId = method === 'turn/completed'
        ? (params['turn'] as JsonObject | undefined)?.['id']
        : params['turnId']
      const matchesActive = activeTurnId !== undefined && turnId === activeTurnId
      const matchesPending = activeTurnId === undefined && pendingTurnId !== undefined && turnId === pendingTurnId
      if (!matchesActive && !matchesPending) return // retired or foreign turn
      if (!turnOpened) {
        earlyNotifications.push({ method, params })
        return
      }
      dispatchTurnNotification(method, params)
    }

    const accepted: Promise<void> = (async () => {
      const rt = await this.ensureRuntime(spec, request.signal)
      runtime = rt
      if (runAbort.signal.aborted) {
        await this.reclaim(String(childSession.id))
        throw new Error('subagent-codex: run cancelled locally')
      }
      rt.onWireNotification = dispatchNotification
      try {
        await this.ensureThread(rt, spec)
        const response = await rt.peer.request<{ turn: { id: string } }>('turn/start', {
          threadId: rt.threadId,
          input: [{ type: 'text', text: task, text_elements: [] }],
          ...spec.configuration?.model === undefined ? {} : { model: spec.configuration.model },
          ...spec.configuration?.effort === undefined ? {} : { effort: spec.configuration.effort },
        })
        if (typeof response?.turn?.id !== 'string') {
          throw new Error('subagent-codex live: turn/start returned no turn id')
        }
        activeTurnId = response.turn.id
      } catch (error) {
        // The accept failed: the runtime's thread/turn state is unknown, so do
        // not reuse it — reclaim and fail the round loudly. The turn never
        // opened parent-side, so no dangling turn/start. (An auth-shaped
        // failure here flows through settleRunResult's onError, which owns
        // the registry mark — reporting here too would double it.)
        if (!runAbort.signal.aborted) await this.reclaim(String(childSession.id))
        throw thrown(error)
      }
      // The turn exists sub-side from here on: if a cancel landed mid-accept,
      // the interrupt goes out immediately (never leave a turn running wild).
      if (runAbort.signal.aborted && runtime !== undefined && runtime.threadId !== undefined) {
        void runtime.peer.request('turn/interrupt', {
          threadId: runtime.threadId,
          turnId: activeTurnId,
        }).catch(() => {})
      }
      openTurn()
    })()

    const attempt: Promise<SubagentResult> = accepted.then(async () => {
      if (runAbort.signal.aborted) throw new Error('subagent-codex: run cancelled locally')
      const rt = runtime as CodexLiveRuntime
      const processFailure: Promise<never> = rt.child.done.then(
        outcome => Promise.reject(new Error(
          'subagent-codex: the live runtime exited mid-round '
          + `(code ${String(outcome.exitCode)}, signal ${String(outcome.signal)})`,
        )),
        (error: unknown) => Promise.reject(thrown(error)),
      )
      processFailure.catch(() => {})
      const outcome = await Promise.race([completion, processFailure])
      if (outcome.status === 'interrupted') {
        return { output: collectOutput(), stopReason: 'aborted' as const }
      }
      if (outcome.status === 'failed') {
        const message = typeof outcome.error?.['message'] === 'string'
          ? outcome.error['message']
          : 'the codex turn failed'
        throw new Error(`subagent-codex live: ${message}`)
      }
      if (outcome.status !== 'completed') {
        throw new Error(`subagent-codex live: the turn ended with unexpected status ${outcome.status}`)
      }
      const output = collectOutput()
      if (output.length === 0) {
        throw new Error('subagent-codex live: the turn completed but produced no answer')
      }
      return { output, stopReason: 'completed' as const }
    })

    const result: Promise<SubagentResult> = settleRunResult({
      attempt: () => Promise.race([attempt, abortBranch]),
      collectOutput,
      cancelled: () => runAbort.signal.aborted,
      onError: (error: Error, stopReason: SubagentStopReason) => {
        const diagnostics = runtime?.diagnostics ?? ''
        const suffix = diagnostics === '' ? '' : `; ${diagnostics}`
        this.ctx.logger.warn(`subagent-codex: live round failed (${stopReason}): ${error.message}${suffix}`)
        this.reportAuthIfShaped(error)
      },
      signal: request.signal,
      onAbort,
    }).then((settled) => {
      roundSettled = true
      liveFlush.dispose()
      if (turnOpened) {
        // An aborted or failed turn never sees turn/completed, so its
        // hold-back line (and the usage already observed) would be lost —
        // flush it now (the exec settle-mirror's partial-work contract).
        if (mirrored < lines.length) mirrorUpTo(lines.length, true)
        // Streams whose item/completed never arrived (abort, or the server
        // ended the turn mid-item) still finalize INSIDE the turn window:
        // one forced snapshot each — interrupted on a non-completed round,
        // the LAST one carrying the usage when no folded line did — then
        // step/end.
        if (streams.size > 0) {
          const remaining = [...streams.values()]
          for (const [position, stream] of remaining.entries()) {
            appendStreamSnapshot(stream, true, settled.stopReason !== 'completed', position === remaining.length - 1, true)
            streamPublisher?.finish(stream.step)
            if (stream.opened) childSession.append('step/end', { turn, step: stream.step })
          }
          streams.clear()
          activeStream = undefined
        }
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
      // Settlement retires the turn: its late notifications are tagged out,
      // and the round's sink is cleared so a stray notification drops dead.
      if (runtime !== undefined) {
        if (activeTurnId !== undefined) runtime.retiredTurnIds.add(activeTurnId)
        runtime.onWireNotification = undefined
      }
      streamPublisher?.dispose()
      return settled
    })

    // Final mirror report + reaper re-arm, mirroring the exec settle pass's
    // progress contract. A round that never opened owns no span — skip it.
    void result.then(async () => {
      try {
        if (turnOpened) {
          await persistQueue.catch(() => {})
          localAgent?.reportRunProgress(childSession.id, { kind: 'mirror', mirroredLines: mirrored })
          // Every settled round reports its observation through the registry's
          // channel (record merge + `settled` event) — the live drive's half
          // of the exec path's onRoundSettled. The app-server wire names no
          // model (codex 0.144.0), so the round's own rollout file answers,
          // exactly as in the exec settle mirror; a non-completed turn's
          // unstreamed spend comes back from the same read. Best-effort: a
          // missing rollout leaves the fields absent, never guessed.
          const facts = await codexRolloutRoundFacts(spec.homeDir, {
            threadId: runtime?.threadId,
            windowStart: startedAtMs,
            cwd: spec.cwd,
          })
          const settledUsage = usage ?? facts.usage
          const round = {
            ...facts.model === undefined ? {} : { observedModel: facts.model },
            ...facts.cliVersion === undefined ? {} : { cliVersion: facts.cliVersion },
            ...settledUsage === undefined ? {} : { usage: settledUsage },
          }
          // Degrades silently on a core predating recordRoundSettled.
          const registry = localAgent as unknown as { recordRoundSettled?: (id: string, r: typeof round) => void } | undefined
          registry?.recordRoundSettled?.(childSession.id, round)
        }
      } catch (error) {
        this.ctx.logger.warn(`subagent-codex: live settle observation failed: ${thrown(error).message}`)
      } finally {
        this.armIdleTimer(String(childSession.id))
      }
    })

    // Publication gate: hold start() until the turn is accepted (channel
    // errors still throw for the provider's exec fallback), but never hold it
    // hostage to the slow windows — a cancel returns the run immediately.
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
        await Promise.race([completion.catch(() => ({ status: 'interrupted' })), delay(this.timeouts.convergeMs)])
      },
    })
  }
}
