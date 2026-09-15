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
 * Every line folds 1:1. The always-enabled
 * `--include-partial-messages` adds incremental output on top: each `stream_event` partial accumulates into its kind's
 * stream (native message id + block index, with ordered legacy fallback),
 * which reserves a (turn, step) at its first delta and
 * appends throttled snapshot `assistant/message`s there — the host folds
 * repeated settles at one coordinate into one live-updating chat node, the
 * only streaming channel left after 0.1.5 retired the durable per-chunk
 * event. A streamed line's completion folds at its stream's reserved step and
 * finalizes it (no duplicated content); a stream whose completion never
 * arrives is force-finalized at settle (interrupted on a non-completed round,
 * so a cancelled turn reads 已停止 legitimately), the last one carrying the
 * round's usage when no folded line did.
 *
 * Lifecycle mirrors M1–M3's discipline: lazy spawn, one in-flight spawn per
 * member, idle-timeout reclaim (stdin EOF → grace → SIGTERM ladder), crash
 * re-spawn with `--resume`, a channel breaker with cooldown, `disposeAll` on
 * unload, and cancellation honored in every window (abort listener before
 * any await; the init wait races the abort signal).
 *
 * Two member-aware additions on top: the spawn binds the member's EFFECTIVE
 * model (session-level override, then the round's delegation model, then the
 * settings key — resolved by the config callback per spawn, scratched into
 * the scoped settings.json because a `--resume` respawn honors the file over
 * the flag), and a runtime whose bound model no longer matches is retired so
 * the round respawns onto the right one; and server→client control requests
 * (a `permissionMode: 'normal'` spawn's `can_use_tool` approval surface) are
 * auto-answered so an unattended runtime never hangs on a permission prompt.
 * @module @khorsheed/dsh-local-agent-claude-code/live-driver
 */

import { ClaudeControlRequests } from './control-requests.ts'
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
import { delegationEnv, persistChildSession, LiveStreamPublisher, LiveFlush, LIVE_FLUSH_INTERVAL_MS } from '@khorsheed/dsh-local-agent'
import type { Config } from './index.ts'
import {
  appendClaudeTranscriptLine,
  assistantEvent,
  claudeLineText,
  ClaudeStreamParser,
  claudeVersionFromInit,
  DEFAULT_DISPOSE_GRACE_MS,
  registerClaudeMemberRun,
  textTask,
  toolCallsOf,
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

/** Default minimum interval between one streaming kind's snapshot messages. */
export const DEFAULT_SNAPSHOT_MIN_INTERVAL_MS = LIVE_FLUSH_INTERVAL_MS

/** Default minimum text growth between one streaming kind's snapshot messages. */
export const DEFAULT_SNAPSHOT_MIN_CHARS = 0

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
  /**
   * The delegation layer's model: the model this DELEGATION requested on its
   * first round, re-requested by every resume round from the record. The
   * spawn binds it when no session-level override outranks it — a delegation
   * naming a model is no longer exec-only; its model binds at spawn like any
   * other layer.
   */
  readonly model?: string | undefined
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
  /** The model this runtime's process was spawned with (undefined = no flag). */
  model: string | undefined
  /** Serializes turns per member (converge-before-next-message). */
  turnChain: Promise<unknown> = Promise.resolve()
  /** The active round's event sink; installed per round, cleared at settle. */
  onEvent: ((event: JsonObject) => void) | undefined
  private readonly controls = new ClaudeControlRequests(message => this.send(message))
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
    if (this.controls.accept(event)) return
    if (event['type'] === 'control_request') {
      this.answerControlRequest(event)
      return
    }
    this.onEvent?.(event)
  }

  /**
   * Answer a server→client control request so the runtime never hangs on
   * one. A `permissionMode: 'normal'` spawn omits
   * `--dangerously-skip-permissions`, so the CLI routes its approval surface
   * (`can_use_tool`) here — and a subagent has no human to approve. The
   * auto-allow mirrors the exec path's effective behavior (its one-shot
   * spawns pre-allow the member bridge tool and otherwise run the same
   * unattended policy) and the kimi live driver's auto-allow of
   * `session/request_permission`. Any other subtype answers with an error so
   * the CLI's own fallback path runs instead of waiting forever.
   */
  private answerControlRequest(event: JsonObject): void {
    const requestId = event['request_id']
    if (typeof requestId !== 'string') return
    const request = event['request'] as JsonObject | undefined
    const subtype = request?.['subtype']
    if (subtype === 'can_use_tool') {
      const input = request?.['input']
      this.send({
        type: 'control_response',
        response: {
          subtype: 'success',
          request_id: requestId,
          response: {
            behavior: 'allow',
            updatedInput: typeof input === 'object' && input !== null ? input : {},
          },
        },
      })
      return
    }
    this.send({
      type: 'control_response',
      response: {
        subtype: 'error',
        request_id: requestId,
        error: `subagent-claude live: unsupported control request ${String(subtype)}`,
      },
    })
  }

  /** Write one stdin frame. */
  send(message: JsonObject): void {
    this.child.stdin?.write(JSON.stringify(message) + '\n')
  }

  /** The graceful runtime interrupt, bounded and checked for an actual success ack. */
  async interrupt(): Promise<void> {
    if (this.dead) return
    await this.controls.request({ subtype: 'interrupt' })
  }

  private markDead(): void {
    if (this.dead) return
    this.dead = true
    this.controls.close()
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
    private readonly config: Pick<Config, 'permissionMode' | 'baseUrl'> & {
      liveIdleMs?: number
      liveMirrorGranularity?: ClaudeLiveMirrorGranularity
      /** Maximum batching wait for incremental streaming messages. */
      snapshotMinIntervalMs?: number
      /** @deprecated Character growth no longer gates live publication. */
      snapshotMinChars?: number
      /**
       * Resolver for the member's effective model, read at each RUNTIME SPAWN
       * (the resident process is where a live round's CLI starts). Receives
       * the member and the round's delegation-layer model (the delegation's
       * own request, re-requested on resume from the record) and answers in
       * the family's order — session-level override, delegation, settings.
       * Absent, or resolving to nothing, leaves the spawn argv unchanged.
       */
      model?: (childSessionId: string, delegationModel?: string) => string | undefined
      /**
       * Scratch the spawn's effective model into the scoped settings.json
       * before the process starts (a `--resume` respawn restores the
       * session's stored model over the `--model` flag). index.ts wires the
       * shared {@link ClaudeScopedModelMemory}; absent, the file is untouched.
       */
      provisionModel?: (homeDir: string, model: string | undefined) => Promise<void>
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

  /**
   * True while the member's runtime exists or is being spawned. The settings
   * controller gates a new generation on this: a fresh driver must not serve
   * a member whose retiring generation still hosts the (same) claude session.
   */
  hasRuntime(key: string): boolean {
    return this.runtimes.has(key) || this.ensuring.has(key)
  }

  /** @deprecated Compatibility no-op: live output is always incremental. */
  setLiveMirrorGranularity(_granularity: ClaudeLiveMirrorGranularity): void {}

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
    if (existing !== undefined && !existing.dead && existing.model === this.spawnModel(key, spec)) {
      this.clearIdleTimer(key)
      return Promise.resolve(existing)
    }
    if (existing !== undefined) this.runtimes.delete(key)
    const pending = this.ensuring.get(key)
    if (pending !== undefined) return pending
    // A live runtime bound to a DIFFERENT model than this round would spawn
    // with (a composer switch the broker did not retire eagerly, or a
    // delegation naming its own model) is retired first — the respawn resumes
    // the same CLI session from disk, so the conversation carries over.
    const retire = existing !== undefined && !existing.dead ? existing.reclaim() : Promise.resolve()
    const spawn = retire
      .then(() => this.spawnRuntime(spec, signal))
      .finally(() => { this.ensuring.delete(key) })
    this.ensuring.set(key, spawn)
    return spawn
  }

  /** The model a spawn for this round would bind (the argv `--model` value). */
  private spawnModel(key: string, spec: ClaudeLiveRoundSpec): string | undefined {
    const model = this.config.model?.(key, spec.model)?.trim()
    return model === undefined || model === '' ? undefined : model
  }

  /**
   * The model the member's resident runtime was spawned with, or undefined
   * when the member has no live runtime (or it binds none). The model broker
   * compares this against a switch's new effective model.
   */
  runtimeModel(childSessionId: string): string | undefined {
    return this.runtimes.get(childSessionId)?.model
  }

  /**
   * Retire the member's resident runtime so the next round respawns with its
   * new effective model (the model broker's switch path). The caller refuses
   * switches while a round is in flight, so the reclaim never kills a run;
   * the CLI session survives on disk and the respawn resumes it.
   */
  async retireRuntime(childSessionId: string): Promise<void> {
    await (this.ensuring.get(childSessionId) ?? Promise.resolve()).catch(() => undefined)
    await this.reclaim(childSessionId)
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
    // The resident process serves one member, so the model resolved here binds
    // that member's runtime; a later change reaches it when the runtime is next
    // respawned (idle reclaim, crash, a broker-initiated retire, or the
    // model-aware retire in ensureRuntime above).
    const model = this.spawnModel(key, spec)
    // The settings.json scratch: a --resume respawn restores the session's
    // stored model over the --model flag, so the effective model also goes
    // into the scoped file (best-effort — the argv flag still applies).
    if (this.config.provisionModel !== undefined) {
      await this.config.provisionModel(spec.homeDir, model).catch(() => undefined)
    }
    const argv = [
      'claude', '-p', '--verbose',
      ...model === undefined ? [] : ['--model', model],
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--include-partial-messages',
      ...(this.config.permissionMode ?? 'skip') === 'skip' ? ['--dangerously-skip-permissions'] : [],
      ...spec.resume === undefined ? [] : ['--resume', spec.resume.cliSessionId],
      // `--allowedTools` is variadic: without the `--` terminator it swallows
      // every following flag (the exec path's e191e27 lesson, same shape here).
      ...member === undefined ? [] : ['--mcp-config', member.mcpConfig, '--allowedTools', member.allowedTool, '--'],
    ]
    const spawnSpec: SubprocessSpawnSpec = {
      argv,
      cwd: spec.cwd,
      stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
      graceMs: DEFAULT_DISPOSE_GRACE_MS,
      // The auth discipline: exactly the exec path's env — the scoped config
      // dir, plus the configured base URL override only.
      env: delegationEnv({
        CLAUDE_CONFIG_DIR: spec.homeDir,
        ...this.config.baseUrl === undefined ? {} : { ANTHROPIC_BASE_URL: this.config.baseUrl },
      }),
    }
    let child: SubprocessHandle
    try {
      child = this.ctx.subprocess.spawn(spawnSpec)
    } catch (error) {
      member?.release()
      this.markChannelBroken()
      throw new LiveChannelUnavailableError(`the stream-json process failed to spawn: ${thrown(error).message}`)
    }
    const runtime = new ClaudeLiveRuntime(child, message => { this.ctx.logger.warn(message) })
    runtime.model = model
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
  private async startRoundLocked(request: SubagentStartRequest, spec: ClaudeLiveRoundSpec): Promise<SubagentRun> {
    const task = textTask(request.prompt)
    if (request.signal.aborted) {
      throw new Error('subagent-claude: request was aborted before the run started')
    }
    // The drain race: the round chained before drain() but dequeued after it.
    // Refuse so the provider falls back to exec instead of reusing a runtime
    // the handoff is about to reclaim.
    if (this.draining) {
      throw new LiveChannelUnavailableError('the live driver is draining (a settings change retired this generation)')
    }
    if (this.disposed) {
      throw new Error('subagent-claude: the live driver is disposed')
    }

    const turn = spec.resume?.turn ?? 1
    const childSession = spec.childSession
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
    /**
     * The model and CLI build this turn's system/init named — the live
     * drive's half of the exec settle parse's read-back, reported as the
     * round's settled observation. EVERY turn re-emits its init, so a round
     * always observes its own.
     */
    let roundModel: string | undefined
    let roundCliVersion: string | undefined
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
     * The streaming kinds seen this round by stream key:
     * deltas accumulate into throttled snapshot assistant/messages appended
     * at the kind's reserved (turn, step) — the host folds repeated settles
     * at one coordinate into one live-updating chat node, which is the only
     * streaming channel left after 0.1.5 retired the durable per-chunk event.
     * The kind's completed line folds at the same step and finalizes it; an
     * entry whose completion never arrives is force-finalized at settle.
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
    /** The stream deltas currently accumulate into (kinds stream sequentially). */
    let activeStream: string | undefined
    let persistQueue: Promise<unknown> = Promise.resolve()
    const persist = (): void => {
      // Live sessions sync through the core's cached write handle, standalone
      // ones through a one-shot handle — the suffix append is idempotent on
      // both paths (the kimi session-mirror root cause).
      persistQueue = persistQueue.then(() => persistChildSession(this.ctx, childSession))
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

    // Native message identity plus content-block index separates same-kind
    // blocks. Older partials without those fields use a message-generation
    // key, paired with their completion in arrival order.
    let messageKey: string | undefined
    let legacyMessage = 0
    const streamKey = (kind: 'think' | 'text', index: unknown): string =>
      `${messageKey ?? `legacy-${turn}-${legacyMessage}`}:${typeof index === 'number' ? index : kind}`

    /**
     * Append one snapshot of a streaming kind at its reserved (turn, step).
     * Batched per stream on a bounded deadline unless `force`; the forced
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
      const usage = parser.usage
      childSession.append('assistant/message', {
        turn,
        step: stream.step,
        message: assistantEvent([
          stream.kind === 'think'
            ? { type: 'reasoning' as const, text: stream.text }
            : { type: 'text' as const, text: stream.text },
        ]),
        stream: [],
        ...withUsage && !usageCarried && usage !== undefined ? { usage } : {},
        ...interrupted ? { interrupted: true } : {},
      }, { surfaceOp: 'append' })
      if (withUsage && !usageCarried && usage !== undefined) usageCarried = true
      stream.lastSnapshotAt = now
      stream.lastSnapshotLen = stream.text.length
      persist()
    }

    /**
     * Reserve the step one streaming kind will occupy — past every completed
     * line (folded or held back) and every earlier reservation. A different
     * kind's deltas force one final snapshot of the current stream (its
     * completion still folds at its own reserved step when it lands).
     */
    const reserveStream = (itemId: string, kind: 'think' | 'text'): void => {
      if (activeStream !== undefined && activeStream !== itemId) {
        const previous = streams.get(activeStream)
        // A freshness snapshot on the kind switch, skipped when the text has
        // not grown since the last one (the settle force always lands).
        if (previous !== undefined && previous.text.length !== previous.lastSnapshotLen) {
          appendStreamSnapshot(previous, true, false)
        }
        activeStream = undefined
      }
      let stream = streams.get(itemId)
      if (stream === undefined) {
        const step = parser.lines.length + reservedSteps.length + 1
        reservedSteps.push(step)
        stream = { itemId, kind, step, text: '', lastSnapshotAt: 0, lastSnapshotLen: 0, opened: false }
        streams.set(itemId, stream)
      }
      activeStream = itemId
    }

    /** The sequential fold step for `parser.lines[index]`: its position shifted past every reservation before it. */
    const foldStep = (index: number): number => {
      let step = index + 1
      for (const reserved of reservedSteps) {
        if (reserved <= step) step += 1
        else break
      }
      return step
    }

    /** Mirror folded lines [mirrored, upto); the last line is held back until `result`. */
    const mirrorUpTo = (upto: number, withUsage: boolean): void => {
      // The usage rides the last NON-tool line (tool events carry no usage
      // slot, and a kill mid-command ends the transcript with a tool line).
      // A carrier mirrored in an earlier flush (before the usage was knowable)
      // loses the accounting to the settle's final snapshot — host 0.1.5 has
      // no usage-backfill event.
      let usageIndex = -1
      if (withUsage) {
        for (let index = 0; index < parser.lines.length; index += 1) {
          if (parser.lines[index]?.kind !== 'tool') usageIndex = index
        }
      }
      for (let index = mirrored; index < upto; index += 1) {
        const line = parser.lines[index]
        if (line === undefined) continue
        const lineUsage = withUsage && index === usageIndex ? parser.usage : undefined
        if (lineUsage !== undefined) usageCarried = true
        const stream = line.kind === 'tool' ? undefined
          : (line.streamId === undefined ? undefined : streams.get(line.streamId))
            ?? [...streams.values()].find(candidate => candidate.kind === line.kind && (line.streamId === undefined || candidate.itemId.startsWith('legacy-')))
        const itemId = stream?.itemId
        if (itemId !== undefined && stream !== undefined) {
          // A streamed line folds at its reserved step, finalizing the
          // snapshots: the step opens only if no snapshot ever landed (a
          // fast stream that stayed under the throttle), and closes here.
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
            message: assistantEvent(blocks),
            stream: [],
            ...lineUsage === undefined ? {} : { usage: lineUsage },
          }, { surfaceOp: 'append' })
          streamPublisher?.finish(stream.step)
          childSession.append('step/end', { turn, step: stream.step })
        } else {
          appendClaudeTranscriptLine(childSession, turn, foldStep(index), line, lineUsage)
        }
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
        // Its model/build fields are this round's settled observation (the
        // exec settle parse reads the same fields off the same event).
        if (runtime !== undefined && runtime.sessionId === undefined) {
          runtime.sessionId = event['session_id']
          resolveInit(runtime.sessionId)
        }
        if (typeof event['model'] === 'string' && event['model'] !== '') roundModel = event['model']
        roundCliVersion = claudeVersionFromInit(event['claude_code_version']) ?? roundCliVersion
        return
      }
      if (type === 'result') {
        // The turn closes: fold the result event itself (it carries the
        // round's usage — the fold's usage carrier rule needs it in both
        // granularities), then flush the held-back last line WITH the usage.
        awaitingResult = false
        parser.push(JSON.stringify(event) + '\n')
        mirrorUpTo(parser.lines.length, true)
        resolveResult(event)
        return
      }
      if (type === 'stream_event') {
        const inner = event['event'] as JsonObject | undefined
        if (inner?.['type'] === 'message_start') {
          const message = inner['message'] as JsonObject | undefined
          messageKey = typeof message?.['id'] === 'string' ? message['id'] : `legacy-${turn}-${++legacyMessage}`
          return
        }
        const delta = inner?.['delta'] as JsonObject | undefined
        const deltaType = delta?.['type']
        const text = delta?.['text'] ?? delta?.['thinking']
        if ((deltaType === 'text_delta' || deltaType === 'thinking_delta') && typeof text === 'string' && text !== '') {
          const kind = deltaType === 'thinking_delta' ? 'think' as const : 'text' as const
          reserveStream(streamKey(kind, inner?.['index']), kind)
          const stream = activeStream === undefined ? undefined : streams.get(activeStream)
          if (stream !== undefined) {
            stream.text += text
            appendStreamSnapshot(stream, false, false)
          }
          // The delta still rides the run-progress channel live.
          localAgent?.reportRunProgress(childSession.id, { kind: 'delta', text })
        }
        return
      }
      if (type !== 'assistant' && type !== 'user') return
      // Feed the exec path's exact parser: one line per event, as the exec
      // stdout carried them.
      parser.push(JSON.stringify(event) + '\n')
      mirrorUpTo(parser.lines.length - 1, false)
      if (type === 'assistant') { messageKey = undefined; legacyMessage++ }
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
      liveFlush.dispose()
      turnInFlight = false
      if (turnOpened) {
        // An aborted or failed turn never sees the result event, so its
        // held-back line (and the usage already observed) would be lost —
        // flush it now (the exec settle-mirror's partial-work contract).
        if (mirrored < parser.lines.length) mirrorUpTo(parser.lines.length, true)
        // Streams whose completion never arrived (abort, or the turn ended
        // mid-message) still finalize INSIDE the turn window: one forced
        // snapshot each — interrupted on a non-completed round, the LAST one
        // carrying the usage when no folded line did — then step/end.
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
      // Settlement clears the round's event sink — by identity, and only once
      // the turn's result landed: an in-flight turn's late result must still
      // reach this round's resolver so the chain can converge.
      if (runtime !== undefined && runtime.onEvent === onEvent && !awaitingResult) {
        runtime.onEvent = undefined
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
        }
      } finally {
        // Every settled round reports its observation through the registry's
        // channel (record merge + `settled` event) — the live drive's half of
        // the exec path's onRoundSettled: the init event's model and build,
        // the result event's usage, and the round's tool-call accounting, each
        // absent when the stream never yielded it. Degrades silently on a
        // core predating recordRoundSettled (the round still settles).
        if (turnOpened) {
          const toolCalls = toolCallsOf(parser.toolCalls)
          const round = {
            ...roundModel === undefined ? {} : { observedModel: roundModel },
            ...roundCliVersion === undefined ? {} : { cliVersion: roundCliVersion },
            ...parser.usage === undefined ? {} : { usage: parser.usage },
            ...toolCalls === undefined ? {} : { toolCalls },
          }
          const registry = localAgent as unknown as { recordRoundSettled?: (id: string, r: typeof round) => void } | undefined
          registry?.recordRoundSettled?.(childSession.id, round)
        }
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
