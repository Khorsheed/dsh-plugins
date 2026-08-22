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
import type { Config } from './index.ts'
import {
  appendCodexTranscriptLine,
  codexLineText,
  DEFAULT_DISPOSE_GRACE_MS,
  registerCodexMemberRun,
  textTask,
  type CodexTranscriptLine,
} from './codex-cli-provider.ts'

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
}

type JsonObject = Record<string, unknown>

function thrown(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

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
  switch (item['type']) {
    case 'reasoning': {
      const parts = [item['summary'], item['content']]
        .filter(Array.isArray)
        .flat()
        .filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '')
      return parts.length === 0 ? undefined : { kind: 'think', text: parts.join('\n') }
    }
    case 'agentMessage':
      return typeof item['text'] === 'string' ? { kind: 'text', text: item['text'] } : undefined
    case 'commandExecution': {
      const command = typeof item['command'] === 'string' ? item.command : undefined
      const output = typeof item['aggregatedOutput'] === 'string' ? item.aggregatedOutput : undefined
      if (command === undefined && output === undefined) return undefined
      const detail = command !== undefined && output !== undefined && output.trim() !== ''
        ? `${command}\n${output}`
        : command ?? output
      return {
        kind: 'tool',
        name: 'Bash',
        ...detail === undefined ? {} : { detail },
      }
    }
    case 'webSearch':
      return { kind: 'tool', name: 'WebSearch' }
    case 'mcpToolCall': {
      const server = typeof item['server'] === 'string' ? item.server : undefined
      const tool = typeof item['tool'] === 'string' ? item.tool : undefined
      return { kind: 'tool', name: server !== undefined && tool !== undefined ? `${server}/${tool}` : tool ?? 'mcp' }
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
    if (!this.dead && this.child.pid > 0) {
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
  private channelBrokenAt: number | undefined
  private disposed = false
  private readonly disposeController = new AbortController()

  constructor(
    private readonly ctx: Context,
    private readonly config: Pick<Config, 'sandbox'> & {
      liveIdleMs?: number
      liveMirrorGranularity?: CodexLiveMirrorGranularity
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

  /** The member's runtime, spawning it (once per member at a time) when absent or dead. */
  private ensureRuntime(spec: CodexLiveRoundSpec, signal: AbortSignal): Promise<CodexLiveRuntime> {
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
    const spawnSpec: SubprocessSpawnSpec = {
      argv: [
        'codex', 'app-server',
        ...member === undefined ? [] : ['-c', member.configOverride],
        '--stdio',
      ],
      cwd: spec.cwd,
      stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
      graceMs: DEFAULT_DISPOSE_GRACE_MS,
      env: { CODEX_HOME: spec.homeDir },
    }
    let child: SubprocessHandle
    try {
      child = this.ctx.subprocess.spawn(spawnSpec)
    } catch (error) {
      member?.release()
      this.markChannelBroken()
      throw new LiveChannelUnavailableError(`the app-server failed to spawn: ${thrown(error).message}`)
    }
    member?.bind(child.pid)
    const runtime = new CodexLiveRuntime(
      child,
      (method, params) => this.answerServerRequest(method, params),
      message => { this.ctx.logger.warn(message) },
      this.timeouts.requestMs,
    )
    runtime.onDead = () => {
      this.runtimes.delete(key)
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
  async startRound(request: SubagentStartRequest, spec: CodexLiveRoundSpec): Promise<SubagentRun> {
    const task = textTask(request.prompt)
    if (request.signal.aborted) {
      throw new Error('subagent-codex: request was aborted before the run started')
    }
    if (this.disposed) {
      throw new Error('subagent-codex: the live driver is disposed')
    }

    const turn = spec.resume?.turn ?? 1
    const childSession = spec.childSession
    const granularity: CodexLiveMirrorGranularity = this.config.liveMirrorGranularity ?? 'event'
    const localAgent = this.ctx.get('localAgent')

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
    /** Token-granularity block index per streaming item id. */
    const blockIndexes = new Map<string, number>()
    /** Items/completions that arrived before the turn id was known. */
    const earlyNotifications: { method: string; params: JsonObject }[] = []
    let persistQueue: Promise<unknown> = Promise.resolve()
    const persist = (): void => {
      persistQueue = persistQueue.then(() =>
        this.ctx.get('sessionPersistence')?.append(childSession.id, childSession.events))
    }

    const requestCancel = (): void => {
      if (roundSettled || runAbort.signal.aborted) return
      runAbort.abort(new Error('subagent-codex: run cancelled locally'))
      // The live driver's core win: a graceful runtime interrupt instead of a
      // process kill. Best-effort; local settlement does not wait for it.
      if (activeTurnId !== undefined && runtime?.threadId !== undefined && !runtime.dead) {
        void runtime.peer.request('turn/interrupt', {
          threadId: runtime.threadId,
          turnId: activeTurnId,
        }).catch(() => {})
      }
    }
    const onAbort = (): void => { requestCancel() }
    request.signal.addEventListener('abort', onAbort, { once: true })

    const abortBranch = new Promise<never>((_, reject) => {
      runAbort.signal.addEventListener('abort', () => reject(new Error('subagent-codex: run cancelled locally')), { once: true })
    })

    const collectOutput = (): ContentBlock[] => {
      const selected = lastFinalAnswer ?? lastUnphasedAnswer ?? (lastText === '' ? undefined : lastText)
      return selected === undefined || selected.trim() === '' ? [] : [{ type: 'text', text: selected }]
    }

    /** Mirror folded lines [mirrored, upto); the last line is held back until completion. */
    const mirrorUpTo = (upto: number, withUsage: boolean): void => {
      for (let index = mirrored; index < upto; index += 1) {
        const line = lines[index]
        if (line === undefined) continue
        const lineUsage = withUsage && index === lines.length - 1 ? usage : undefined
        appendCodexTranscriptLine(childSession, turn, index + 1, line, lineUsage)
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
        if (granularity !== 'token' || typeof params['delta'] !== 'string') return
        const itemId = String(params['itemId'] ?? '')
        if (!blockIndexes.has(itemId)) blockIndexes.set(itemId, blockIndexes.size)
        childSession.append('assistant/chunk', {
          turn,
          step: mirrored + 1,
          chunk: {
            type: method === 'item/agentMessage/delta' ? 'text-delta' : 'reasoning-delta',
            index: blockIndexes.get(itemId) ?? 0,
            text: params['delta'],
          },
        })
        localAgent?.reportRunProgress(childSession.id, { kind: 'delta', text: params['delta'] })
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
            spec.onThreadId?.(rt.threadId)
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
        const response = await rt.peer.request<{ turn: { id: string } }>('turn/start', {
          threadId: rt.threadId,
          input: [{ type: 'text', text: task, text_elements: [] }],
        })
        if (typeof response?.turn?.id !== 'string') {
          throw new Error('subagent-codex live: turn/start returned no turn id')
        }
        activeTurnId = response.turn.id
      } catch (error) {
        // The accept failed: the runtime's thread/turn state is unknown, so do
        // not reuse it — reclaim and fail the round loudly. The turn never
        // opened parent-side, so no dangling turn/start.
        if (!runAbort.signal.aborted) await this.reclaim(String(childSession.id))
        throw thrown(error)
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
      },
      signal: request.signal,
      onAbort,
    }).then((settled) => {
      roundSettled = true
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
      // Settlement retires the turn: its late notifications are tagged out,
      // and the round's sink is cleared so a stray notification drops dead.
      if (runtime !== undefined) {
        if (activeTurnId !== undefined) runtime.retiredTurnIds.add(activeTurnId)
        runtime.onWireNotification = undefined
      }
      return settled
    })

    // Final mirror report + reaper re-arm, mirroring the exec settle pass's
    // progress contract. A round that never opened owns no span — skip it.
    void result.then(async () => {
      try {
        if (turnOpened) {
          await persistQueue.catch(() => {})
          localAgent?.reportRunProgress(childSession.id, { kind: 'mirror', mirroredLines: mirrored })
        }
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
