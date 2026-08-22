/**
 * The claude provider's live driver: one resident Claude Code stream-json
 * process per member (child session), driven over the vendor's
 * `--input-format stream-json --output-format stream-json` realtime mode
 * (protocol-probed against claude 2.1.236; the Agent SDK's streaming-input
 * mode is this same channel, driven here directly so no SDK dependency
 * lands). A delegation round is one `user` message on the resident process's
 * stdin instead of a fresh `claude -p` — which buys what the process boundary
 * could not: runtime-level graceful interrupt (`control_request
 * {subtype:'interrupt'}`; the process survives and the session stays
 * continuable) and the same-shape push stream folded live per turn.
 *
 * Auth discipline (a hard requirement): the resident process runs under the
 * family's scoped `CLAUDE_CONFIG_DIR` and nothing else — the OAuth marker in
 * the scoped `.claude.json` and the keychain entry hashed to that path are
 * exactly what the exec mode's one-shot processes already use. The driver
 * never touches the user's global `~/.claude`, never runs any `auth` verb,
 * and only adds `ANTHROPIC_BASE_URL` when the plugin config supplies it (the
 * exec path's exact env rule).
 *
 * Protocol facts (all probed): the first stdin `user` message triggers
 * `system/init` carrying the server-assigned session id (EVERY turn emits a
 * fresh init — the delegation records the first one); each turn closes with
 * a `result` event (`is_error`, usage, session id); the interrupt control
 * request answers with a `control_response` success; a new process with
 * `--resume <session_id>` reattaches the on-disk session in the same mode
 * (crash recovery); stdin EOF quiesces the process (the reclaim ladder).
 *
 * Fold: the resident stream speaks the exec path's exact event vocabulary
 * (`system`/`assistant`/`user`/`result`), so each turn folds through the
 * shared `ClaudeStreamParser` with the exec live mirror's hold-back rule (the
 * volatile last line waits for `result`, which carries the round's usage).
 * Token granularity (`--include-partial-messages` at spawn) adds
 * `stream_event` partials mapped to `assistant/chunk`.
 *
 * Lifecycle mirrors M1–M3's discipline: lazy spawn, one in-flight spawn per
 * member, idle-timeout reclaim (stdin EOF → grace → SIGTERM ladder), crash
 * re-spawn with `--resume`, a channel breaker with cooldown, `disposeAll` on
 * unload, and cancellation honored in every window (abort listener before
 * any await; the init wait races the abort signal).
 * @module @khorsheed/dsh-local-agent-claude-code/live-driver
 */

import { StringDecoder } from 'node:string_decoder'
import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
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
  appendClaudeTranscriptLine,
  claudeLineText,
  ClaudeStreamParser,
  DEFAULT_DISPOSE_GRACE_MS,
  registerClaudeMemberRun,
  textTask,
} from './claude-cli-provider.ts'
import { syncClaudeCredentialFile } from './records.ts'

/** Default idle lifetime of an unused resident runtime before reclaim. */
export const DEFAULT_LIVE_IDLE_MS = 30 * 60_000

/** Default timeout for the turn's system/init ack (a cold boot can be slow). */
export const DEFAULT_LIVE_INIT_TIMEOUT_MS = 60_000

/** Bounded wait for an interrupted turn to converge while a run disposes. */
export const DEFAULT_LIVE_DISPOSE_CONVERGE_MS = 5_000

/** How long a tripped channel breaker stays on the exec fallback. */
export const DEFAULT_LIVE_CHANNEL_RETRY_MS = 5 * 60_000

/** Grace between stdin EOF and SIGTERM when reclaiming a stream-json process. */
const RECLAIM_EOF_GRACE_MS = 1_000

/**
 * The stream-json channel could not come up (spawn failure or the first
 * turn's init never arrived). The provider catches exactly this and falls
 * back to the exec one-shot; any other error is a real round failure.
 */
export class LiveChannelUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LiveChannelUnavailableError'
  }
}

/** Internal timeouts; tests inject small values. */
export interface ClaudeLiveDriverTimeouts {
  readonly initMs: number
  readonly convergeMs: number
  readonly channelRetryMs: number
}

const DEFAULT_TIMEOUTS: ClaudeLiveDriverTimeouts = {
  initMs: DEFAULT_LIVE_INIT_TIMEOUT_MS,
  convergeMs: DEFAULT_LIVE_DISPOSE_CONVERGE_MS,
  channelRetryMs: DEFAULT_LIVE_CHANNEL_RETRY_MS,
}

/** How much of the live event stream crosses into the child session. */
export type ClaudeLiveMirrorGranularity = 'event' | 'token'

/** Fully resolved inputs for one live round. */
export interface ClaudeLiveRoundSpec {
  /** Parent Session workspace; also the runtime process cwd. */
  readonly cwd: string
  /** The `claude-code` harness's scoped home, injected as `CLAUDE_CONFIG_DIR`. */
  readonly homeDir: string
  /** dsh subagent session recording this delegation (always live on this path). */
  readonly childSession: Session
  /** The delegating session (member-channel registration). */
  readonly parentSessionId: string
  /**
   * Resume round: continue the session recorded as `cliSessionId` (also the
   * reattach path after a runtime crash — the respawn passes `--resume`).
   */
  readonly resume?: { readonly cliSessionId: string; readonly turn: number } | undefined
  /** Fresh round: called with the session id from the turn's system/init. */
  readonly onSessionId?: ((sessionId: string) => void) | undefined
}

type JsonObject = Record<string, unknown>

function thrown(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * One resident stream-json process: the NDJSON frame pump, the session id it
 * carries, the per-session turn chain (one turn at a time — claude queues
 * stdin user messages, but the cancelled turn's result must land before the
 * next turn's message goes out, keeping the stop-then-rephrase gesture's
 * streams unambiguous), and the reclaim ladder (stdin EOF → grace → SIGTERM).
 */
class ClaudeLiveRuntime {
  dead = false
  private reclaimed = false
  /** The member's claude session id (first turn's system/init). */
  sessionId: string | undefined
  /** Serializes turns per member (converge-before-next-message). */
  turnChain: Promise<unknown> = Promise.resolve()
  /** The active round's event sink; installed per round, cleared at settle. */
  onEvent: ((event: JsonObject) => void) | undefined
  /** Control responses by request_id (the interrupt ack). */
  private readonly controlResponses = new Map<string, () => void>()
  private controlSeq = 0
  onDead: (() => void) | undefined
  private buffer = ''
  private readonly decoder = new StringDecoder('utf8')
  private stderrTail = ''
  private readonly stderrDecoder = new StringDecoder('utf8')

  constructor(
    readonly child: SubprocessHandle,
    private readonly warn: (message: string) => void,
  ) {
    child.stdout?.on('data', (chunk: Buffer) => { this.feed(this.decoder.write(chunk)) })
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

  private feed(text: string): void {
    this.buffer += text
    let index = this.buffer.indexOf('\n')
    while (index >= 0) {
      const line = this.buffer.slice(0, index)
      this.buffer = this.buffer.slice(index + 1)
      index = this.buffer.indexOf('\n')
      if (line.trim() === '') continue
      let event: JsonObject
      try {
        event = JSON.parse(line) as JsonObject
      } catch {
        this.warn('subagent-claude live: ignored a malformed stream line')
        continue
      }
      try {
        this.dispatchEvent(event)
      } catch (error) {
        this.warn(`subagent-claude live: stream handler failed: ${thrown(error).message}`)
      }
    }
  }

  private dispatchEvent(event: JsonObject): void {
    if (event['type'] === 'control_response') {
      const response = event['response'] as JsonObject | undefined
      const requestId = response?.['request_id']
      if (typeof requestId === 'string') {
        this.controlResponses.get(requestId)?.()
        this.controlResponses.delete(requestId)
      }
      return
    }
    this.onEvent?.(event)
  }

  /** Write one stdin frame. */
  send(message: JsonObject): void {
    this.child.stdin?.write(JSON.stringify(message) + '\n')
  }

  /** The graceful runtime interrupt; resolves when the control ack lands (or never). */
  interrupt(): Promise<void> {
    if (this.dead) return Promise.resolve()
    this.controlSeq += 1
    const requestId = `live-interrupt-${this.controlSeq}`
    const acked = new Promise<void>((resolve) => { this.controlResponses.set(requestId, resolve) })
    this.send({ type: 'control_request', request_id: requestId, request: { subtype: 'interrupt' } })
    return acked
  }

  private markDead(): void {
    if (this.dead) return
    this.dead = true
    this.onDead?.()
  }

  /** Graceful teardown: EOF stdin, grace, then the terminate ladder. */
  async reclaim(): Promise<void> {
    if (this.reclaimed) return
    this.reclaimed = true
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
 * The claude live driver owns every resident stream-json runtime of this
 * provider generation. Created only when `live: true`; disposed with the
 * plugin.
 */
export class ClaudeLiveDriver {
  private readonly runtimes = new Map<string, ClaudeLiveRuntime>()
  private readonly ensuring = new Map<string, Promise<ClaudeLiveRuntime>>()
  private readonly idleTimers = new Map<string, NodeJS.Timeout>()
  /** Per-member round serialization (the resume lock covers resume-vs-resume only). */
  private readonly roundChains = new Map<string, Promise<unknown>>()
  private channelBrokenAt: number | undefined
  private disposed = false
  private readonly disposeController = new AbortController()

  constructor(
    private readonly ctx: Context,
    private readonly config: Pick<Config, 'permissionMode' | 'baseUrl'> & {
      liveIdleMs?: number
      liveMirrorGranularity?: ClaudeLiveMirrorGranularity
    },
    private readonly timeouts: ClaudeLiveDriverTimeouts = DEFAULT_TIMEOUTS,
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

  private ensureRuntime(spec: ClaudeLiveRoundSpec, signal: AbortSignal): Promise<ClaudeLiveRuntime> {
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
   * Spawn the member's resident stream-json process. There is no handshake
   * message — the channel proves itself with the first turn's system/init —
   * so spawn failure is the only breaker trip here; the init wait lives in
   * the round's accept window.
   */
  private async spawnRuntime(spec: ClaudeLiveRoundSpec, signal: AbortSignal): Promise<ClaudeLiveRuntime> {
    const key = String(spec.childSession.id)
    if (this.disposed) {
      throw new LiveChannelUnavailableError('the live driver is disposed')
    }
    // Keychain→file sync before EVERY spawn: claude 2.1.236 reads
    // <home>/.credentials.json at runtime while login and the process's own
    // refresh write the keychain — the file goes stale on every rotation
    // (single-rotation refresh tokens make a consumed copy poison for the
    // next spawn). The login watch's sync alone cannot keep a resident
    // runtime authenticatable across rotations. Best-effort: a missing grant
    // fails the turn with the CLI's own "Not logged in", not here.
    await syncClaudeCredentialFile(spec.homeDir).catch(() => false)
    // The member bridge rides the spawn argv (`--mcp-config` + `--allowedTools`),
    // exactly as in the exec path; the resident process serves one member, so
    // its token lives with the process.
    const member = registerClaudeMemberRun(this.ctx, String(spec.childSession.id), spec.parentSessionId)
    const granularity = this.config.liveMirrorGranularity ?? 'event'
    const argv = [
      'claude', '-p', '--verbose',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      ...(this.config.permissionMode ?? 'skip') === 'skip' ? ['--dangerously-skip-permissions'] : [],
      ...spec.resume === undefined ? [] : ['--resume', spec.resume.cliSessionId],
      // `--allowedTools` is variadic: without the `--` terminator it swallows
      // every following flag (the exec path's e191e27 lesson, same shape here).
      ...member === undefined ? [] : ['--mcp-config', member.mcpConfig, '--allowedTools', member.allowedTool, '--'],
      ...granularity === 'token' ? ['--include-partial-messages'] : [],
    ]
    const spawnSpec: SubprocessSpawnSpec = {
      argv,
      cwd: spec.cwd,
      stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
      graceMs: DEFAULT_DISPOSE_GRACE_MS,
      // The auth discipline: exactly the exec path's env — the scoped config
      // dir, plus the configured base URL override only.
      env: {
        CLAUDE_CONFIG_DIR: spec.homeDir,
        ...this.config.baseUrl === undefined ? {} : { ANTHROPIC_BASE_URL: this.config.baseUrl },
      },
    }
    let child: SubprocessHandle
    try {
      child = this.ctx.subprocess.spawn(spawnSpec)
    } catch (error) {
      member?.release()
      this.markChannelBroken()
      throw new LiveChannelUnavailableError(`the stream-json process failed to spawn: ${thrown(error).message}`)
    }
    member?.bind(child.pid)
    const runtime = new ClaudeLiveRuntime(child, message => { this.ctx.logger.warn(message) })
    runtime.onDead = () => {
      // Delete only OUR registration (crash-then-respawn interleave safety).
      if (this.runtimes.get(key) === runtime) this.runtimes.delete(key)
      this.clearIdleTimer(key)
      member?.release()
    }
    if (signal.aborted || this.disposeController.signal.aborted) {
      await runtime.reclaim()
      if (signal.aborted) throw new Error('subagent-claude: run cancelled locally')
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
   * Drive one delegation round on the member's resident stream-json process.
   * Mirrors the exec run's settlement contract exactly (settleRunResult +
   * turn/end bookkeeping); cancel is the interrupt control request and the
   * process survives.
   */
  async startRound(request: SubagentStartRequest, spec: ClaudeLiveRoundSpec): Promise<SubagentRun> {
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
  private async startRoundLocked(request: SubagentStartRequest, spec: ClaudeLiveRoundSpec): Promise<SubagentRun> {
    const task = textTask(request.prompt)
    if (request.signal.aborted) {
      throw new Error('subagent-claude: request was aborted before the run started')
    }
    if (this.disposed) {
      throw new Error('subagent-claude: the live driver is disposed')
    }

    const turn = spec.resume?.turn ?? 1
    const childSession = spec.childSession
    const granularity: ClaudeLiveMirrorGranularity = this.config.liveMirrorGranularity ?? 'event'
    const localAgent = this.ctx.get('localAgent')

    const runAbort = new AbortController()
    let roundSettled = false
    let runtime: ClaudeLiveRuntime | undefined
    /** True while this round's turn is in flight (interrupt targets it). */
    let turnInFlight = false
    /** True from the message going out until its result lands — the sink must
     *  survive settlement in that window so the chain can converge. */
    let awaitingResult = false
    let turnOpened = false
    /** This turn's fold (the exec live mirror's exact parser). */
    const parser = new ClaudeStreamParser()
    let mirrored = 0
    let persistQueue: Promise<unknown> = Promise.resolve()
    const persist = (): void => {
      persistQueue = persistQueue.then(() =>
        this.ctx.get('sessionPersistence')?.append(childSession.id, childSession.events))
    }

    const requestCancel = (): void => {
      if (roundSettled || runAbort.signal.aborted) return
      runAbort.abort(new Error('subagent-claude: run cancelled locally'))
      // The live driver's core win: a graceful runtime interrupt instead of a
      // process kill. Best-effort; local settlement does not wait for it.
      if (turnInFlight && runtime !== undefined && !runtime.dead) {
        void runtime.interrupt().catch(() => {})
      }
    }
    const onAbort = (): void => { requestCancel() }
    request.signal.addEventListener('abort', onAbort, { once: true })

    const abortBranch = new Promise<never>((_, reject) => {
      runAbort.signal.addEventListener('abort', () => reject(new Error('subagent-claude: run cancelled locally')), { once: true })
    })

    const collectOutput = (): ContentBlock[] => {
      const text = parser.text?.trim()
      return text === undefined || text === '' ? [] : [{ type: 'text', text: parser.text as string }]
    }

    /** Mirror folded lines [mirrored, upto); the last line is held back until `result`. */
    const mirrorUpTo = (upto: number, withUsage: boolean): void => {
      for (let index = mirrored; index < upto; index += 1) {
        const line = parser.lines[index]
        if (line === undefined) continue
        const lineUsage = withUsage && index === parser.lines.length - 1 ? parser.usage : undefined
        appendClaudeTranscriptLine(childSession, turn, index + 1, line, lineUsage)
        mirrored = index + 1
        localAgent?.reportRunProgress(childSession.id, { kind: 'delta', text: claudeLineText(line) })
      }
      if (upto > 0) persist()
    }

    let resolveResult!: (event: JsonObject) => void
    const resultEvent = new Promise<JsonObject>((resolve) => { resolveResult = resolve })
    let resolveInit!: (sessionId: string) => void
    let rejectInit!: (error: Error) => void
    const initArrived = new Promise<string>((resolve, reject) => { resolveInit = resolve; rejectInit = reject })

    /** The round's event sink (installed on the runtime while it runs). */
    const onEvent = (event: JsonObject): void => {
      const type = event['type']
      if (type === 'system' && typeof event['session_id'] === 'string') {
        // EVERY turn emits an init; the first one mints the delegation id.
        if (runtime !== undefined && runtime.sessionId === undefined) {
          runtime.sessionId = event['session_id']
          resolveInit(runtime.sessionId)
        }
        return
      }
      if (type === 'result') {
        // The turn closes: flush the held-back last line WITH the round's usage.
        awaitingResult = false
        parser.push('')
        mirrorUpTo(parser.lines.length, true)
        resolveResult(event)
        return
      }
      if (type === 'stream_event') {
        if (granularity !== 'token') return
        const inner = event['event'] as JsonObject | undefined
        const delta = inner?.['delta'] as JsonObject | undefined
        const deltaType = delta?.['type']
        const text = delta?.['text'] ?? delta?.['thinking']
        if ((deltaType === 'text_delta' || deltaType === 'thinking_delta') && typeof text === 'string' && text !== '') {
          childSession.append('assistant/chunk', {
            turn,
            step: mirrored + 1,
            chunk: {
              type: deltaType === 'text_delta' ? 'text-delta' : 'reasoning-delta',
              index: 0,
              text,
            },
          })
          localAgent?.reportRunProgress(childSession.id, { kind: 'delta', text })
        }
        return
      }
      if (type !== 'assistant' && type !== 'user') return
      // Feed the exec path's exact parser: one line per event, as the exec
      // stdout carried them.
      parser.push(JSON.stringify(event) + '\n')
      mirrorUpTo(parser.lines.length - 1, false)
    }

    const sendAndInit = async (): Promise<void> => {
      if (runAbort.signal.aborted) throw new Error('subagent-claude: run cancelled locally')
      const rt = runtime as ClaudeLiveRuntime
      // The sink installs only when this turn actually starts: an earlier
      // turn's result must land in ITS OWN round's sink, never in this one
      // (the chain below guarantees the previous result already landed).
      rt.onEvent = onEvent
      turnInFlight = true
      awaitingResult = true
      rt.send({
        type: 'user',
        message: { role: 'user', content: [{ type: 'text', text: task }] },
      })
      if (rt.sessionId === undefined) {
        const initWatchdog = setTimeout(() => {
          // The channel's only proof: without an init the runtime cannot
          // serve — trip the breaker and reclaim it.
          void (async () => {
            this.markChannelBroken()
            await this.reclaim(String(childSession.id))
            rejectInit(new LiveChannelUnavailableError('the stream-json init never arrived'))
          })()
        }, this.timeouts.initMs)
        initWatchdog.unref()
        try {
          const cancelled = new Promise<never>((_, reject) => {
            runAbort.signal.addEventListener('abort', () => reject(new Error('subagent-claude: run cancelled locally')), { once: true })
          })
          const sessionId = await Promise.race([initArrived, cancelled]).catch(async (error: unknown) => {
            // A cancel inside the init window reclaims the never-proven
            // runtime (the turn was sent but never acknowledged).
            if (runAbort.signal.aborted && !(error instanceof LiveChannelUnavailableError)) {
              await this.reclaim(String(childSession.id))
            }
            throw error
          })
          spec.onSessionId?.(sessionId)
        } finally {
          clearTimeout(initWatchdog)
        }
      }
    }

    const accepted: Promise<void> = (async () => {
      const rt = await this.ensureRuntime(spec, request.signal)
      runtime = rt
      if (runAbort.signal.aborted) {
        await this.reclaim(String(childSession.id))
        throw new Error('subagent-claude: run cancelled locally')
      }
      // The turn boundary opens before the message goes out (exec parity: the
      // exec path opens at spawn).
      childSession.append('turn/start', { turn })
      childSession.append('user/message', createUserMessage({
        content: [{ type: 'text', text: task }],
        source: { kind: 'user' },
      }), { surfaceOp: 'append' })
      turnOpened = true
      persist()
      localAgent?.reportRunProgress(childSession.id, { kind: 'delta', text: task })
      // One turn at a time per member: this message goes out only after the
      // previous turn's result landed (claude would queue the stdin frame,
      // but its result must never land in this round's sink).
      rt.turnChain = rt.turnChain.catch(() => {}).then(sendAndInit)
      await rt.turnChain
    })()

    const attempt: Promise<SubagentResult> = accepted.then(async () => {
      if (runAbort.signal.aborted) throw new Error('subagent-claude: run cancelled locally')
      const rt = runtime as ClaudeLiveRuntime
      const processFailure: Promise<never> = rt.child.done.then(
        outcome => Promise.reject(new Error(
          'subagent-claude: the live runtime exited mid-round '
          + `(code ${String(outcome.exitCode)}, signal ${String(outcome.signal)})`,
        )),
        (error: unknown) => Promise.reject(thrown(error)),
      )
      processFailure.catch(() => {})
      const resultPromise = Promise.race([resultEvent, processFailure])
      // Hold the chain until THIS turn's result lands, so the next round's
      // message never starts mid-turn.
      rt.turnChain = resultPromise
      const event = await resultPromise
      if (event['is_error'] === true) {
        const message = typeof event['error'] === 'string' ? event['error'] : 'claude reported an error'
        throw new Error(`subagent-claude live: ${message}`)
      }
      const output = collectOutput()
      if (output.length === 0) {
        throw new Error('subagent-claude live: the turn completed but produced no answer')
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
        this.ctx.logger.warn(`subagent-claude: live round failed (${stopReason}): ${error.message}${suffix}`)
      },
      signal: request.signal,
      onAbort,
    }).then((settled) => {
      roundSettled = true
      turnInFlight = false
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
      // Settlement clears the round's event sink — by identity, and only once
      // the turn's result landed: an in-flight turn's late result must still
      // reach this round's resolver so the chain can converge.
      if (runtime !== undefined && runtime.onEvent === onEvent && !awaitingResult) {
        runtime.onEvent = undefined
      }
      return settled
    })

    // Settle: the turn's result already flushed the fold (the result event IS
    // the reconciliation — the fold consumed every streamed line); report the
    // authoritative mirror count and re-arm the reaper.
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

    // Publication gate: hold start() until the session is known and the turn
    // is in flight (channel errors still throw for the exec fallback), but
    // never hold it hostage — a cancel returns immediately.
    await Promise.race([accepted, abortBranch.catch(() => undefined)])

    return subprocessRunHandle({
      id: childSession.id,
      result,
      signal: request.signal,
      onAbort,
      requestCancel,
      // The live teardown contract: NEVER kill the runtime here. The graceful
      // interrupt already went out; wait (bounded) for the turn's result to
      // land so the next round starts clean.
      teardown: async () => {
        if (roundSettled) return
        await Promise.race([resultEvent.catch(() => ({})), delay(this.timeouts.convergeMs)])
      },
    })
  }
}
