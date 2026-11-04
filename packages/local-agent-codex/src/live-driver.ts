/**
 * The codex provider's live driver: one resident `codex app-server --stdio`
 * process per member (child session), driven over the vendor's experimental
 * JSON-RPC app-server wire (protocol-probed against codex-cli 0.144.0's
 * `app-server generate-json-schema`; the harness `subagent-codex` package is
 * the reference implementation). A delegation round is a `turn/start` on the
 * member's resident thread instead of a fresh `codex exec` process, which buys
 * what the process boundary could not: runtime-level graceful interrupt
 * (`turn/interrupt`; the process survives and the thread stays continuable)
 * and push-mode mirroring (`item/started` / `item/completed` + delta
 * notifications instead of folding a polled stdout stream).
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
import type { ContentBlock, ReasoningEffortId, TokenUsage } from '@deepseek-ai/dsh-llm'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session'
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
  appendMirrorContent,
  appendRequestHeaderIfChanged,
  closeMirrorTurn,
  openMirrorTurn,
  delegationEnv,
  persistChildSession,
  recordContextOccupancy,
  LiveStreamPublisher,
  LiveFlush,
  LIVE_FLUSH_INTERVAL_MS,
  type MirrorBlock,
} from '@khorsheed/dsh-local-agent'
import type { Config } from './index.ts'
import type { LocalAgentResolvedConfiguration } from '@khorsheed/dsh-local-agent/types'
import {
  codexMirrorSource,
  codexLineText,
  commandOutcome,
  DEFAULT_DISPOSE_GRACE_MS,
  registerCodexMemberRun,
  textTask,
  type CodexTranscriptLine,
} from './codex-cli-provider.ts'
import { codexRolloutRoundFacts } from './records.ts'
import { endpointAuthEnv, endpointConfigOverrides, type CodexEndpointAuth } from './endpoint-auth.ts'

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

/**
 * One model call of a live round: the items first seen between two
 * `thread/tokenUsage/updated` boundaries (see the round's step ledger). It is
 * written as ONE step — one assistant/message with every block, the call's
 * usage once, then each tool's call/result pair.
 */
interface CodexCall {
  /** Item ids in first-seen order (start, first delta, or completion): the call's block order. */
  readonly items: string[]
  /** Items started (or streaming) whose completion has not arrived yet. */
  readonly pending: Set<string>
  /** Items whose completion arrived (with or without a transcript line). */
  readonly completed: Set<string>
  /** Completed transcript lines by item id. */
  readonly lines: Map<string, CodexTranscriptLine>
  /** Its token-usage boundary arrived: no later item joins it. */
  ended: boolean
  /** The call's own usage (the boundary's `tokenUsage.last`). */
  usage?: TokenUsage
  /** The log step it holds open while its items stream. */
  step?: number
  folded: boolean
}

/** One streaming item of a round (see the round's step ledger). */
interface CodexStream {
  readonly itemId: string
  readonly kind: 'think' | 'text'
  /** Provisional key for the live flush and the preview — never a log step. */
  readonly step: number
  /** The model call the item belongs to; its blocks share the call's step. */
  readonly call: CodexCall
  text: string
  /** Arrival time of the item's first delta. */
  startedAt: number
  lastSnapshotAt: number
  lastSnapshotLen: number
  /** It streams under its call's step (opened by it, or joined). */
  opened: boolean
  /** It joined a step an earlier block of its call opened (a sub-item of that step). */
  joined?: boolean
  /** The log step it occupies, once opened. */
  durable?: number
}
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
  /** The sandbox the member's thread starts under (its session's mode; see CodexCliProvider.sandboxFor). */
  readonly sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access'
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
  /** `compact`: compact the thread instead of starting a turn (see {@link CodexLiveDriver.compactLocked}). */
  readonly operation?: 'compact' | undefined
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

/** A compaction round waits for its turn to complete at most this long. */
const COMPACTION_TIMEOUT_MS = 10 * 60_000
/** How long a requested reload may take to spawn the fresh process and resume the session. */
const RELOAD_TIMEOUT_MS = 30_000

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Map one app-server `item/completed` ThreadItem onto the shared transcript
 * line shape — the live transport's entry into the SAME fold the exec NDJSON
 * parser owns (`foldCodexStreamLine`); both produce `CodexTranscriptLine`s
 * and write them through the core mirror writer, so the two drivers' blocks
 * cannot drift (the live driver groups them per model call, the exec path —
 * whose stream names no call boundary — one step per line).
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
      const outcome = commandOutcome(item['aggregatedOutput'], item['exitCode'], item['status'])
      if (command === undefined && outcome.result === undefined) return undefined
      return {
        kind: 'tool',
        id: itemId ?? `codex-live-${randomUUID()}`,
        name: 'Bash',
        ...command === undefined ? {} : { args: command },
        ...outcome.result === undefined ? {} : { result: outcome.result },
        ...outcome.failed ? { failed: true } : {},
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
      // Non-shell tools (e.g. the multi-agent `wait`, the deferred `exec`
      // discovery tool): {id, tool, arguments, status, contentItems, success}
      // — the app-server carries the result INLINE on the completed item.
      const tool = typeof item['tool'] === 'string' ? item.tool : 'dynamic'
      const args = item['arguments'] === undefined || item['arguments'] === null
        ? undefined
        : typeof item['arguments'] === 'string' ? item['arguments'] : JSON.stringify(item['arguments'])
      const content = item['contentItems']
      const result = Array.isArray(content)
        ? content
            .filter((block): block is JsonObject => typeof block === 'object' && block !== null)
            .map(block => typeof block['text'] === 'string' ? block['text'] : undefined)
            .filter((text): text is string => text !== undefined && text !== '')
            .join('\n')
        : undefined
      return {
        kind: 'tool',
        id: itemId ?? `codex-live-${randomUUID()}`,
        name: tool,
        ...args === undefined || args === '' ? {} : { args },
        ...result === undefined || result === '' ? {} : { result },
      }
    }
    case 'collabAgentToolCall': {
      const tool = typeof item['tool'] === 'string' ? item.tool : 'collab'
      return { kind: 'tool', id: itemId ?? `codex-live-${randomUUID()}`, name: `collab/${tool}` }
    }
    case 'mcpToolCall': {
      // An MCP call (the member bridge's room tools): {server, tool,
      // arguments, status, result?: {content}, error?: {message}} — the
      // arguments and the outcome ride the completed item; without them a
      // member's ask_user_question read as a bare name.
      const server = typeof item['server'] === 'string' ? item.server : undefined
      const tool = typeof item['tool'] === 'string' ? item.tool : undefined
      const args = item['arguments'] === undefined || item['arguments'] === null
        ? undefined
        : typeof item['arguments'] === 'string' ? item['arguments'] : JSON.stringify(item['arguments'])
      const outcome = item['result'] as { content?: unknown } | null | undefined
      const content = Array.isArray(outcome?.content) ? outcome.content : []
      const text = content
        .filter((block): block is JsonObject => typeof block === 'object' && block !== null)
        .map(block => typeof block['text'] === 'string' ? block['text'] : undefined)
        .filter((entry): entry is string => entry !== undefined && entry !== '')
        .join('\n')
      const error = item['error'] as { message?: unknown } | null | undefined
      const failure = typeof error?.message === 'string' && error.message !== '' ? error.message : undefined
      return {
        kind: 'tool',
        id: itemId ?? `codex-live-${randomUUID()}`,
        name: server !== undefined && tool !== undefined ? `${server}/${tool}` : tool ?? 'mcp',
        ...args === undefined || args === '' || args === '{}' ? {} : { args },
        ...failure !== undefined ? { result: failure, failed: true } : text === '' ? {} : { result: text },
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

/**
 * Whether a ThreadItem is output of a model call: the turn's echoed user
 * prompt and codex's own context compaction are not, so they never open or
 * hold a call.
 */
function modelItem(item: JsonObject | undefined): boolean {
  return item !== undefined && item['type'] !== 'userMessage' && item['type'] !== 'contextCompaction'
}

/**
 * One breakdown minus another, field by field (non-numeric fields dropped,
 * floored at zero). The wire's `tokenUsage.total` is the THREAD's running
 * total, so a round's own spend is its last total minus the thread total
 * before the round's first call.
 */
function breakdownMinus(total: JsonObject, before: JsonObject): JsonObject {
  const out: JsonObject = {}
  for (const [key, value] of Object.entries(total)) {
    const a = Number(value)
    if (!Number.isFinite(a)) continue
    const b = Number(before[key])
    out[key] = Math.max(0, a - (Number.isFinite(b) ? b : 0))
  }
  return out
}

/** Map the app-server's per-turn usage breakdown onto the shared usage contract. */
function usageFromAppServer(breakdown: JsonObject): TokenUsage {
  const input = Number(breakdown['inputTokens'])
  const cached = Number(breakdown['cachedInputTokens'])
  const cacheWrite = Number(breakdown['cacheWriteInputTokens'])
  const output = Number(breakdown['outputTokens'])
  // Codex's input total already contains both cache buckets (total = input +
  // output); the shared contract keeps the three input buckets disjoint.
  const usage: TokenUsage = {
    inputTokens: Number.isFinite(input) && Number.isFinite(cached)
      ? Math.max(0, input - cached - (Number.isFinite(cacheWrite) ? cacheWrite : 0))
      : Number.isFinite(input) ? input : 0,
    outputTokens: Number.isFinite(output) ? output : 0,
  }
  // The field rides every payload (zero included): write it whenever present,
  // so "no hits" never reads as "not reported".
  if (Number.isFinite(cached)) usage.cacheReadTokens = cached
  if (Number.isFinite(cacheWrite) && cacheWrite > 0) usage.cacheWriteTokens = cacheWrite
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
  /** The thread's context occupancy and window, as its last request reported them. */
  contextTokens: number | undefined
  contextWindow: number | undefined
  /**
   * The last `thread/tokenUsage/updated` reading's identity (its thread
   * total): codex re-emits an unchanged reading, and a repeat — even one
   * carried over from the previous round — is no new model call.
   */
  lastUsageReading: string | undefined
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
  /** Rounds accepted and not yet settled, per member (a reload asked meanwhile waits for them). */
  private readonly roundsInFlight = new Map<string, number>()
  /** The spec each member's runtime was last ensured with: a reload respawns from it. */
  private readonly lastSpecs = new Map<string, CodexLiveRoundSpec>()
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
      /**
       * Resolver for the scope's endpoint credential, read at each RUNTIME
       * SPAWN so a settings-card write reaches the next respawn without a
       * reload. A resolution carrying a key routes the app-server at the
       * relay (custom `model_providers` `-c` overrides plus the key in the
       * process env), exactly as on the exec path.
       */
      endpoint?: (scopeHome: string) => Promise<CodexEndpointAuth>
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
   * Round-start self-heal: a resident process whose CLI lacks the member's
   * mode tools (its bridge served the placeholder, or an empty list while the
   * mode has tools) is retired here, between rounds, so this round respawns
   * a fresh `codex app-server` that resumes the same CLI session and lists again.
   * codex only logs `notifications/tools/list_changed` (codex 0.163), so a new process is the only way its tool list refreshes. The registry decides (`memberToolsStale`); an older core
   * without it keeps the process.
   */
  private async retireIfToolsStale(key: string): Promise<void> {
    const runtime = this.runtimes.get(key)
    const token = runtime === undefined || runtime.dead ? undefined : runtimeTokens.get(runtime)
    const registry = this.ctx.localAgent
    if (token === undefined || typeof registry.memberToolsStale !== 'function') return
    const reason = await registry.memberToolsStale(token).catch(() => undefined)
    if (reason === undefined || this.runtimes.get(key) !== runtime) return
    this.ctx.logger.warn(`local-agent-codex: respawning member ${key}'s codex process before its round: ${reason}`)
    await this.retireRuntime(key)
    // The edit dialog and the room show that it happened (an older core lacks the hook).
    if (typeof registry.noteMemberToolsRespawn === 'function') registry.noteMemberToolsRespawn(key, token)
  }

  /**
   * Reload a member's process on request (the room's edit dialog): retire the
   * resident runtime and spawn a fresh one that resumes the same CLI session,
   * without a prompt. `codex app-server` starts the
   * bridge and lists its tools at thread/start and thread/resume.
   * Chained on the member's round queue, so a running round finishes first
   * (`after-round`) and the next round waits for the reload. Undefined when
   * this driver hosts no process for the member.
   */
  reloadMember(key: string, hooks: { readonly onStart: () => void }): { readonly when: 'now' | 'after-round'; readonly done: Promise<'respawned' | 'no-process' | 'failed'> } | undefined {
    if (this.disposed || this.draining || !this.hasRuntime(key)) return undefined
    const when = (this.roundsInFlight.get(key) ?? 0) > 0 ? 'after-round' : 'now'
    const previous = this.roundChains.get(key) ?? Promise.resolve()
    const done = previous.catch(() => {}).then(async () => {
      hooks.onStart()
      return await this.reloadLocked(key)
    })
    this.roundChains.set(key, done.catch(() => ({})))
    return { when, done }
  }

  /** The reload body, between rounds. */
  private async reloadLocked(key: string): Promise<'respawned' | 'no-process' | 'failed'> {
    if (this.disposed || this.draining) return 'no-process'
    const pending = this.ensuring.get(key)
    if (pending !== undefined) await pending.catch(() => undefined)
    const runtime = this.runtimes.get(key)
    const spec = this.lastSpecs.get(key)
    if (runtime === undefined || runtime.dead || spec === undefined) return 'no-process'
    const cliSessionId = runtime.threadId ?? spec.resume?.cliSessionId
    await this.retireRuntime(key)
    const { onThreadId: _fresh, operation: _operation, ...base } = spec
    try {
      await this.prepare({ ...base, ...cliSessionId === undefined ? {} : { resume: { cliSessionId, turn: spec.resume?.turn ?? 0 } } }, AbortSignal.timeout(RELOAD_TIMEOUT_MS))
      return 'respawned'
    } catch (error) {
      this.ctx.logger.warn(`local-agent-codex: reloading member ${key}'s codex process failed: ${thrown(error).message}`)
      return 'failed'
    }
  }

  /**
   * Whether {@link startMember} would start the member's process now: the
   * driver is live and holds no process, spawn or round for the member.
   */
  canStartMember(key: string): boolean {
    return !this.disposed && !this.draining && !this.disabled && !this.hasRuntime(key) && (this.roundsInFlight.get(key) ?? 0) === 0
  }

  /**
   * Start a member's resident process with no round: the room's 立即载入
   * for a member that has none (after a host restart, or an idle reclaim).
   * `prepare` runs on a resume spec the core built from durable state, so
   * `codex app-server` resumes the recorded thread and lists the bridge's tools at thread/resume, with no prompt and no model call.
   * Chained on the member's round queue; `no-process` when a process or a
   * round appeared meanwhile.
   */
  startMember(spec: CodexLiveRoundSpec): Promise<'respawned' | 'no-process' | 'failed'> {
    const key = String(spec.childSession.id)
    if (!this.canStartMember(key)) return Promise.resolve('no-process')
    const previous = this.roundChains.get(key) ?? Promise.resolve()
    const done = previous.catch(() => {}).then(async (): Promise<'respawned' | 'no-process' | 'failed'> => {
      if (!this.canStartMember(key)) return 'no-process'
      try {
        await this.prepare(spec, AbortSignal.timeout(RELOAD_TIMEOUT_MS))
        return 'respawned'
      } catch (error) {
        this.ctx.logger.warn(`local-agent-codex: starting member ${key}'s codex process failed: ${thrown(error).message}`)
        return 'failed'
      }
    })
    this.roundChains.set(key, done.catch(() => ({})))
    return done
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
    this.lastSpecs.set(key, spec)
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
    // The endpoint credential routes the resident process too: with a key the
    // app-server spawns onto the relay's custom provider (the same `-c`
    // overrides the exec path carries), so a live round never consults
    // auth.json either. Read per spawn — a card write reaches the next respawn.
    const endpoint = this.config.endpoint === undefined
      ? undefined
      : await this.config.endpoint(spec.homeDir).catch(() => undefined)
    const spawnSpec: SubprocessSpawnSpec = {
      argv: [
        'codex', 'app-server',
        ...member === undefined ? [] : ['-c', member.configOverride],
        ...endpointConfigOverrides(endpoint),
        ...model === undefined || model === '' ? [] : ['-c', `model=${JSON.stringify(model)}`],
        ...spec.configuration?.effort === undefined ? [] : ['-c', `model_reasoning_effort=${JSON.stringify(spec.configuration.effort)}`],
        '--stdio',
      ],
      cwd: spec.cwd,
      stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
      graceMs: DEFAULT_DISPOSE_GRACE_MS,
      env: delegationEnv({ CODEX_HOME: spec.homeDir, ...endpointAuthEnv(endpoint) }),
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
    if (member !== undefined) runtimeTokens.set(runtime, member.token)
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
   * never exits: the match runs against the settled error instead).
   */
  private reportAuthIfShaped(error: Error): void {
    if (!CODEX_LIVE_AUTH_FAILURE.test(error.message)) return
    this.ctx.localAgent.reportAuthFailure('codex', error.message.split('\n').find(line => line.trim() !== '') ?? error.message)
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
        sandbox: this.config.sandbox ?? spec.sandbox ?? 'workspace-write',
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
    const round = previous.catch(() => {}).then(() => spec.operation === 'compact' ? this.compactLocked(request, spec) : this.startRoundLocked(request, spec))
    this.roundsInFlight.set(key, (this.roundsInFlight.get(key) ?? 0) + 1)
    this.roundChains.set(key, round.then(
      handle => handle.result.catch(() => ({})),
      () => ({}),
    ).finally(() => {
      const left = (this.roundsInFlight.get(key) ?? 1) - 1
      if (left > 0) this.roundsInFlight.set(key, left)
      else this.roundsInFlight.delete(key)
    }))
    return round
  }

  /**
   * A compaction round: `thread/compact/start` runs as a turn of its own (a
   * `contextCompaction` item), and the round holds the member's queue until
   * that turn completes — codex refuses a `turn/start` meanwhile
   * (`ActiveTurnNotSteerable { turn_kind: Compact }`). Writes no turn: one
   * `local-agent/compaction` event (codex gives no summary text).
   */
  private async compactLocked(request: SubagentStartRequest, spec: CodexLiveRoundSpec): Promise<SubagentRun> {
    if (request.signal.aborted) throw new Error('subagent-codex: request was aborted before the compaction started')
    if (this.draining) throw new LiveChannelUnavailableError('the live driver is draining (a settings change retired this generation)')
    if (this.disposed) throw new Error('subagent-codex: the live driver is disposed')
    const childSession = spec.childSession
    const key = String(childSession.id)
    const rt = await this.ensureRuntime(spec, request.signal)
    try {
      await this.ensureThread(rt, spec)
    } catch (error) {
      await this.reclaim(key)
      throw thrown(error)
    }
    const startedAt = Date.now()
    const boundarySeq = childSession.snapshotEvents().at(-1)?.seq ?? -1
    const beforeTokens = rt.contextTokens
    let compactTurn: string | undefined
    let usage: TokenUsage | undefined
    let settle!: (outcome: { ok: true } | { ok: false; error: string }) => void
    const finished = new Promise<{ ok: true } | { ok: false; error: string }>((resolve) => { settle = resolve })
    rt.onWireNotification = (method, params) => {
      const turnOf = (params['turn'] as JsonObject | undefined)?.['id'] ?? params['turnId']
      if (method === 'turn/started' && compactTurn === undefined && typeof turnOf === 'string') compactTurn = turnOf
      if (method === 'thread/tokenUsage/updated' && turnOf === compactTurn) {
        const reported = params['tokenUsage'] as JsonObject | undefined
        const last = reported?.['last'] as JsonObject | undefined
        if (last !== undefined) usage = usageFromAppServer(last)
        const window = Number(reported?.['modelContextWindow'])
        if (Number.isFinite(window) && window > 0) rt.contextWindow = window
      }
      if (method === 'turn/completed' && turnOf === compactTurn) {
        const turn = params['turn'] as JsonObject | undefined
        const error = (turn?.['error'] as JsonObject | null | undefined)?.['message']
        settle(turn?.['status'] === 'completed' ? { ok: true } : { ok: false, error: typeof error === 'string' ? error : `compaction ${String(turn?.['status'])}` })
      }
    }
    const result: Promise<SubagentResult> = (async () => {
      let outcome: { ok: true } | { ok: false; error: string }
      try {
        await rt.peer.request('thread/compact/start', { threadId: rt.threadId })
        outcome = await Promise.race([finished, delay(COMPACTION_TIMEOUT_MS).then(() => ({ ok: false as const, error: 'compaction did not finish in time' }))])
      } catch (error) {
        outcome = { ok: false, error: thrown(error).message }
      } finally {
        rt.onWireNotification = undefined
        if (compactTurn !== undefined) rt.retiredTurnIds.add(compactTurn)
      }
      childSession.append('local-agent/compaction', {
        source: 'manual', outcome: outcome.ok ? 'completed' : 'failed', provider: 'codex-local',
        ...rt.boundModel === undefined ? {} : { model: rt.boundModel },
        ...beforeTokens === undefined ? {} : { beforeTokens },
        ...rt.contextWindow === undefined ? {} : { contextWindow: rt.contextWindow },
        ...usage === undefined ? {} : { usage },
        ...outcome.ok ? {} : { error: outcome.error },
        startedAt, endedAt: Date.now(), boundarySeq,
      })
      await persistChildSession(this.ctx, childSession).catch((error: unknown) => {
        this.ctx.logger.warn(`subagent-codex: compaction persistence failed: ${thrown(error).message}`)
      })
      this.armIdleTimer(key)
      return outcome.ok
        ? { stopReason: 'completed', output: [] }
        : { stopReason: 'error', output: [], diagnostic: outcome.error }
    })()
    return subprocessRunHandle({
      id: SessionId(randomUUID()),
      result,
      signal: request.signal,
      // Codex runs the compaction to its end once accepted; the round settles then.
      onAbort: () => {},
      requestCancel: () => {},
      teardown: async () => {},
    })
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
    /** Compactions codex ran on its own inside this turn (a `contextCompaction` item), with the occupancy before each. */
    const autoCompactions: { at: number; beforeTokens?: number }[] = []
    let lastUnphasedAnswer: string | undefined
    /** Transcript lines written to the log (the settle's progress report). */
    let mirrored = 0
    let usage: TokenUsage | undefined
    /**
     * The round's own total for the settled report: the wire's
     * `tokenUsage.total` is cumulative over the whole THREAD, so it is
     * diffed against the thread total before this round's first call
     * (that first notification's total minus its own `last`).
     */
    let totalUsage: TokenUsage | undefined
    let threadTotalBefore: JsonObject | undefined
    /**
     * The round's model calls, oldest first. One `thread/tokenUsage/updated`
     * notification closes one call: codex emits a call's token count after
     * its last item — tool outputs included, the next request needs them —
     * so every item first seen since the previous boundary belongs to the
     * call the next boundary closes, and that boundary's `tokenUsage.last` is
     * the call's own usage.
     */
    const calls: CodexCall[] = []
    /** Item id → the call it was first seen in. */
    const callOfItem = new Map<string, CodexCall>()
    /** Synthetic ids for items the wire sent without one. */
    let anonymousItems = 0
    /**
     * The streaming items seen this round by item id: deltas accumulate into
     * throttled snapshots at their call's step once it may open in the log
     * (previewed live before that) — the host folds repeated settles at one
     * coordinate into one live-updating chat node. The call's fold writes
     * the final text and finishes them; a stream whose completion never
     * arrives lands from its live text when its call folds.
     */
    const streams = new Map<string, CodexStream>()
    /** Provisional stream keys (live flush and preview identity), never log steps. */
    let streamKeys = 0
    /** The item deltas currently accumulate into (items stream sequentially). */
    let activeStream: string | undefined
    /** Tool item id → its notification time, paired with item/completed. */
    const toolStarts = new Map<string, number>()
    const toolArgStarts = new Map<string, number>()
    let lastEventAt: number | undefined
    /** Items/completions that arrived before the turn id was known. */
    const earlyNotifications: { method: string; params: JsonObject; observedAt: number }[] = []
    let persistQueue: Promise<unknown> = Promise.resolve()
    const persist = (): void => {
      persistQueue = persistQueue.then(() => persistChildSession(this.ctx, childSession)).catch((error: unknown) => {
        this.ctx.logger.warn(`subagent-codex: live persistence failed: ${thrown(error).message}`)
      })
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

    const streamPublisher = localAgent?.liveStreams === undefined ? undefined
      : new LiveStreamPublisher(localAgent.liveStreams, childSession, turn, persist,
        error => this.ctx.logger.warn(`live checkpoint failed: ${String(error)}`))
    const liveFlush = new LiveFlush(
      error => this.ctx.logger.warn(`live mirror flush failed: ${String(error)}`),
      this.config.snapshotMinIntervalMs ?? DEFAULT_SNAPSHOT_MIN_INTERVAL_MS,
    )

    // The step ledger. The log admits steps strictly in sequence — one open
    // at a time, numbered when it is WRITTEN (`lastStep`) — and one model
    // call is ONE step (the claude paths' grouping): its reasoning, text and
    // tool blocks land in one assistant/message carrying the call's usage
    // once, then each tool's call/result pair, then step/end. Calls write in
    // order. A call's step opens in the log once its first stream may
    // snapshot (every earlier call written; until then the browser previews
    // it) and the call's later streams join that open step; a call that
    // never streamed opens its step at its fold.
    let lastStep = 0
    let openStep: number | undefined
    const mirrorSource = () => codexMirrorSource(spec.configuration?.model ?? runtime?.boundModel)
    const closeOpenStep = (): void => {
      if (openStep === undefined) return
      childSession.append('step/end', { turn, step: openStep })
      openStep = undefined
    }
    /** Take the step a call writes at: its open step, else a fresh one. */
    const takeStep = (call: CodexCall): number => {
      if (call.step !== undefined && call.step === openStep) return call.step
      closeOpenStep()
      lastStep += 1
      childSession.append('step/start', { turn, step: lastStep })
      openStep = lastStep
      call.step = lastStep
      return lastStep
    }
    const openStreamStep = (stream: CodexStream): void => {
      const joined = stream.call.step !== undefined && stream.call.step === openStep
      if (joined) stream.joined = true
      stream.durable = takeStep(stream.call)
      stream.opened = true
      // From here it streams under its durable step: the preview goes
      // (a core predating dropPreview keeps it until the item finishes).
      streamPublisher?.dropPreview?.(stream.step, stream.itemId)
    }
    const canOpenStream = (stream: CodexStream): boolean => stream.call.step !== undefined
      ? stream.call.step === openStep
      : openStep === undefined && calls.slice(0, calls.indexOf(stream.call)).every(call => call.folded)
    const streamBlock = (stream: CodexStream, now: number): MirrorBlock =>
      ({ kind: stream.kind, text: stream.text, generation: { startedAt: stream.startedAt, endedAt: now } })

    /**
     * The call an item belongs to: the one it was first seen in, else the
     * round's open call (a fresh one after a boundary). An item of a call
     * already written (a completion that outlived its call) joins the open
     * call instead.
     */
    const callFor = (itemId: string): CodexCall => {
      const known = callOfItem.get(itemId)
      if (known !== undefined && !known.folded) return known
      let call = calls.at(-1)
      if (call === undefined || call.ended || call.folded) {
        call = { items: [], pending: new Set(), completed: new Set(), lines: new Map(), ended: false, folded: false }
        calls.push(call)
      }
      call.items.push(itemId)
      callOfItem.set(itemId, call)
      return call
    }

    const pendingStreamArrival = new Map<number, number>()
    /**
     * Append one live snapshot of a stream at its call's step. Throttled per
     * item by interval and growth unless `force`. With live streams the text
     * goes to the publisher (a joined block as a sub-item of the call's
     * step); without them the snapshot is a durable assistant/message at the
     * step carrying every opened block of the call so far. The call's fold
     * writes the final message.
     */
    const appendStreamSnapshot = (stream: CodexStream, force: boolean): void => {
      if (stream.text.trim() === '') return
      const now = Date.now()
      if (!force) {
        if (!pendingStreamArrival.has(stream.step)) pendingStreamArrival.set(stream.step, now)
        liveFlush.schedule(stream.step, () => appendStreamSnapshot(stream, true))
        return
      }
      liveFlush.cancel(stream.step)
      const receivedAt = pendingStreamArrival.get(stream.step) ?? now
      pendingStreamArrival.delete(stream.step)
      if (!stream.opened) {
        if (!canOpenStream(stream)) {
          // Not its turn in the log yet: show it live, write it at its fold.
          streamPublisher?.preview(stream.step, stream.kind, stream.text, { itemId: stream.itemId, receivedAt })
          return
        }
        openStreamStep(stream)
      }
      stream.lastSnapshotAt = now
      stream.lastSnapshotLen = stream.text.length
      if (streamPublisher !== undefined) {
        streamPublisher.update(stream.durable!, stream.kind, stream.text, { receivedAt, ...stream.joined === true ? { itemId: stream.itemId } : {} })
        return
      }
      const blocks = [...streams.values()]
        .filter(candidate => candidate.call === stream.call && candidate.opened && candidate.text.trim() !== '')
        .map(candidate => streamBlock(candidate, now))
      appendMirrorContent(childSession, turn, stream.durable!, { blocks }, mirrorSource())
      persist()
    }

    /** Close a stream's live presentation once its final text is in the log. */
    const finishStream = (stream: CodexStream): void => {
      liveFlush.cancel(stream.step)
      streams.delete(stream.itemId)
      if (activeStream === stream.itemId) activeStream = undefined
      streamPublisher?.finish(stream.step)
      if (stream.durable !== undefined) streamPublisher?.finish(stream.durable)
    }

    /**
     * Track one new streaming item: its provisional key (live flush and
     * preview identity) and its call. A different item's deltas force one
     * freshness snapshot of the current stream.
     */
    const reserveStream = (itemId: string, kind: 'think' | 'text', observedAt: number): void => {
      if (activeStream !== undefined && activeStream !== itemId) {
        const previous = streams.get(activeStream)
        // A freshness snapshot on the item switch, skipped when the text has
        // not grown since the last one (the settle force always lands).
        if (previous !== undefined && previous.text.length !== previous.lastSnapshotLen) {
          appendStreamSnapshot(previous, true)
        }
        activeStream = undefined
      }
      let stream = streams.get(itemId)
      if (stream === undefined) {
        const call = callFor(itemId)
        // Streaming means started: the call waits for its completion.
        if (!call.completed.has(itemId)) call.pending.add(itemId)
        streamKeys += 1
        stream = { itemId, kind, step: streamKeys, call, text: '', startedAt: observedAt, lastSnapshotAt: 0, lastSnapshotLen: 0, opened: false }
        streams.set(itemId, stream)
      }
      activeStream = itemId
    }

    /**
     * Write one call at its step: one assistant/message with the call's
     * blocks in first-seen order (a block whose item never completed rides
     * from its live text), the call's usage once, each tool's call/result
     * pair, step/end. `interrupted` marks the message of a call cut off
     * mid-block on a non-completed round.
     */
    const foldCall = (call: CodexCall, interrupted: boolean): void => {
      const now = Date.now()
      const owned = [...streams.values()].filter(stream => stream.call === call)
      const written: CodexTranscriptLine[] = []
      const blocks: MirrorBlock[] = []
      let partial = false
      for (const itemId of call.items) {
        const line = call.lines.get(itemId)
        if (line !== undefined) {
          blocks.push(line)
          written.push(line)
          continue
        }
        const stream = streams.get(itemId)
        if (stream === undefined || stream.call !== call || stream.text.trim() === '') continue
        // A delta stream with no item id never pairs with its completion:
        // the completed line of its kind already carries the text.
        if (stream.itemId.startsWith('codex-stream-') && [...call.lines.values()].some(entry => entry.kind === stream.kind)) continue
        blocks.push(streamBlock(stream, now))
        if (!call.completed.has(itemId)) partial = true
      }
      if (blocks.length > 0) {
        const step = takeStep(call)
        appendMirrorContent(childSession, turn, step, {
          blocks,
          ...call.usage === undefined ? {} : { usage: call.usage },
          interrupted: interrupted && partial,
        }, mirrorSource())
      }
      for (const stream of owned) finishStream(stream)
      if (call.step !== undefined && call.step === openStep) closeOpenStep()
      call.folded = true
      mirrored += written.length
      for (const line of written) localAgent?.reportRunProgress(childSession.id, { kind: 'delta', text: codexLineText(line) })
    }

    /**
     * Write the round's calls in order while the oldest unwritten one is
     * done: its boundary arrived and every item it started completed (the
     * released-log reader resolves every advertised tool before step/end; a
     * later call meanwhile previews live). The settle (`settle: true` —
     * turn/completed, or the final flush after a cancel/failure) writes
     * everything left, call by call.
     */
    const foldCalls = (settle: boolean, interrupted = false): void => {
      let wrote = false
      for (const call of calls) {
        if (call.folded) continue
        if (!settle && !(call.ended && call.pending.size === 0)) break
        foldCall(call, interrupted)
        wrote = true
      }
      if (wrote) persist()
    }

    let resolveCompletion!: (outcome: { status: string; error?: JsonObject }) => void
    const completion = new Promise<{ status: string; error?: JsonObject }>((resolve) => { resolveCompletion = resolve })

    const openTurn = (): void => {
      // The boundary opens after the accept ack (a definitive reject leaves no
      // dangling turn/start); the prompt and any early items flush inside it.
      openMirrorTurn(childSession, turn, 'live')
      // The provider's own launch facts are the child log's request config —
      // codex's notifications never carry model/effort, so the turn/start
      // request parameters the provider sends are the authoritative source.
      // The header contract requires a model: without one nothing is recorded.
      if (spec.configuration?.model !== undefined) {
        appendRequestHeaderIfChanged(childSession, {
          provider: 'codex-local',
          model: spec.configuration.model,
          ...spec.configuration.effort === undefined ? {} : { reasoningEffort: spec.configuration.effort as ReasoningEffortId },
        })
      }
      childSession.append('user/message', createUserMessage({
        content: [{ type: 'text', text: task }],
        source: { kind: 'user' },
      }), { surfaceOp: 'append' })
      turnOpened = true
      persist()
      localAgent?.reportRunProgress(childSession.id, { kind: 'delta', text: task })
      for (const early of earlyNotifications.splice(0)) {
        dispatchTurnNotification(early.method, early.params, early.observedAt)
      }
    }

    /** Process one turn-scoped notification for the round's own turn id. */
    const dispatchTurnNotification = (method: string, params: JsonObject, observedAt: number): void => {
      const previousAt = lastEventAt
      lastEventAt = observedAt
      if (method === 'item/started') {
        const item = params['item'] as JsonObject | undefined
        const id = item?.['id']
        if (typeof id === 'string') {
          toolStarts.set(id, observedAt)
          if (previousAt !== undefined) toolArgStarts.set(id, previousAt)
          // The item joins the open call and holds it until it completes.
          if (modelItem(item)) callFor(id).pending.add(id)
        }
        return
      }
      if (method === 'item/completed') {
        const item = params['item'] as JsonObject
        if (item['type'] === 'contextCompaction') {
          const beforeTokens = runtime?.contextTokens
          autoCompactions.push({ at: observedAt, ...beforeTokens === undefined ? {} : { beforeTokens } })
        }
        const itemId = typeof item['id'] === 'string' ? item['id'] : undefined
        const startedAt = itemId === undefined ? undefined : toolStarts.get(itemId)
        const argStartedAt = itemId === undefined ? undefined : toolArgStarts.get(itemId)
        if (itemId !== undefined) {
          toolStarts.delete(itemId)
          toolArgStarts.delete(itemId)
        }
        const trackId = itemId ?? `codex-item-${(anonymousItems += 1)}`
        const call = modelItem(item) ? callFor(trackId) : undefined
        call?.pending.delete(trackId)
        call?.completed.add(trackId)
        const line = codexAppServerItemToLine(item)
        if (item['type'] === 'agentMessage' && typeof item['text'] === 'string') {
          const phase = item['phase']
          if (phase === 'final_answer') lastFinalAnswer = item['text']
          else if (phase === null || phase === undefined) lastUnphasedAnswer = item['text']
          lastText = item['text']
        }
        if (line !== undefined && call !== undefined) {
          // A streamed item without an item/started still has a generation
          // window: its first delta to its completion.
          const generationStart = startedAt ?? (line.kind === 'tool' ? undefined : streams.get(trackId)?.startedAt)
          if (generationStart !== undefined) {
            line.generation = line.kind === 'tool'
              ? { startedAt: argStartedAt ?? generationStart, endedAt: generationStart }
              : { startedAt: generationStart, endedAt: observedAt }
          }
          if (line.kind === 'tool' && startedAt !== undefined) {
            line.timing = { startedAt, endedAt: observedAt, source: 'observed' }
          }
          call.lines.set(trackId, line)
        }
        // The call writes once its boundary arrived and its items completed —
        // this completion may be the last one it waited for.
        if (call !== undefined) foldCalls(false)
        return
      }
      if (method === 'item/agentMessage/delta' || method === 'item/reasoning/textDelta') {
        if (typeof params['delta'] !== 'string') return
        const text = params['delta']
        if (text === '') return
        const reasoning = method === 'item/reasoning/textDelta'
        // The item id pairs the stream with its completion (the call's fold
        // writes the completed text in the stream's place); a delta without
        // one shares a per-kind stream, matching the pre-item-id behavior.
        const itemId = typeof params['itemId'] === 'string'
          ? params['itemId']
          : `codex-stream-${reasoning ? 'think' : 'text'}-${turn}`
        reserveStream(itemId, reasoning ? 'think' : 'text', observedAt)
        const stream = activeStream === undefined ? undefined : streams.get(activeStream)
        if (stream !== undefined) {
          stream.text += text
          appendStreamSnapshot(stream, false)
        }
        localAgent?.reportRunProgress(childSession.id, { kind: 'delta', text })
        return
      }
      if (method === 'thread/tokenUsage/updated') {
        // The thread's occupancy: what the last request sent, against the window.
        const reported = params['tokenUsage'] as JsonObject | undefined
        const sent = Number((reported?.['last'] as JsonObject | undefined)?.['inputTokens'])
        if (runtime !== undefined && Number.isFinite(sent)) runtime.contextTokens = sent
        const window = Number(reported?.['modelContextWindow'])
        if (runtime !== undefined && Number.isFinite(window) && window > 0) runtime.contextWindow = window
        const tokenUsage = params['tokenUsage'] as JsonObject | undefined
        const last = tokenUsage?.['last'] as JsonObject | undefined
        const total = tokenUsage?.['total'] as JsonObject | undefined
        // Codex re-emits an unchanged reading (a rate-limit refresh carries
        // the last token info again — seen mid-call in real rollouts, and at
        // a turn's start carried over from the previous round). The thread
        // total only grows with a new request, so an identical one is no
        // new call. A total with no numbers is "not reported" (never
        // override the per-call read with an empty object, never dedupe on it).
        const totalReported = total !== undefined && (Number.isFinite(Number(total['inputTokens'])) || Number.isFinite(Number(total['outputTokens'])))
        const reading = totalReported ? JSON.stringify(total) : undefined
        const repeated = reading !== undefined && runtime?.lastUsageReading === reading
        if (runtime !== undefined && reading !== undefined) runtime.lastUsageReading = reading
        if (total !== undefined && totalReported) {
          threadTotalBefore ??= repeated || last === undefined ? total : breakdownMinus(total, last)
          totalUsage = usageFromAppServer(breakdownMinus(total, threadTotalBefore))
        }
        if (repeated) return
        if (last !== undefined) usage = usageFromAppServer(last)
        // One fresh reading closes one model call — codex emits it right
        // after the call's last item (the rollout's token_count position) —
        // and its `last` is that call's own usage, written once on the
        // call's message.
        const open = calls.at(-1)
        if (open !== undefined && !open.ended && !open.folded) {
          open.ended = true
          if (last !== undefined) open.usage = usageFromAppServer(last)
          foldCalls(false)
        }
        return
      }
      if (method === 'turn/completed') {
        const turnData = params['turn'] as JsonObject
        // A fold failure must never skip the completion: the round settles
        // with its mirrored prefix instead of hanging forever.
        try { foldCalls(true) } finally {
          resolveCompletion({
            status: String(turnData['status']),
            ...(turnData['error'] === null || turnData['error'] === undefined
              ? {}
              : { error: turnData['error'] as JsonObject }),
          })
        }
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
      if (!['item/started', 'item/completed', 'item/agentMessage/delta', 'item/reasoning/textDelta',
        'thread/tokenUsage/updated', 'turn/completed'].includes(method)) return
      const observedAt = Date.now()
      // turn/completed carries the id inside its turn object; the rest carry
      // a top-level turnId.
      const turnId = method === 'turn/completed'
        ? (params['turn'] as JsonObject | undefined)?.['id']
        : params['turnId']
      const matchesActive = activeTurnId !== undefined && turnId === activeTurnId
      const matchesPending = activeTurnId === undefined && pendingTurnId !== undefined && turnId === pendingTurnId
      if (!matchesActive && !matchesPending) return // retired or foreign turn
      if (!turnOpened) {
        earlyNotifications.push({ method, params, observedAt })
        return
      }
      dispatchTurnNotification(method, params, observedAt)
    }

    const accepted: Promise<void> = (async () => {
      await this.retireIfToolsStale(String(childSession.id))
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
    }).then(async (settled) => {
      roundSettled = true
      liveFlush.dispose()
      if (turnOpened) {
        // An aborted or failed turn never sees turn/completed: its unwritten
        // calls (and the usage their boundaries named) still land INSIDE the
        // turn window, call by call (the exec settle-mirror's partial-work
        // contract) — a stream whose completion never came rides from its
        // live text, marked interrupted on a non-completed round.
        foldCalls(true, settled.stopReason !== 'completed')
        closeOpenStep()
        streams.clear()
        activeStream = undefined
        closeMirrorTurn(childSession, turn, settled.stopReason, 'the live round did not complete')
        if (runtime !== undefined) recordRoundContext(childSession, runtime, autoCompactions)
      }
      // Settlement retires the turn: its late notifications are tagged out,
      // and the round's sink is cleared so a stray notification drops dead.
      if (runtime !== undefined) {
        if (activeTurnId !== undefined) runtime.retiredTurnIds.add(activeTurnId)
        runtime.onWireNotification = undefined
      }
      streamPublisher?.dispose()
      // A completed answer is not a durable turn until its final boundary
      // and any closing stream checkpoints have reached the child store.
      if (turnOpened) {
        persist()
        await persistQueue
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
          // The settled report wants the round TOTAL: prefer the wire's
          // tokenUsage.total diffed to this round (the per-call `last`
          // under-reports a multi-call round; the raw total over-reports a
          // resumed thread); the rollout read is the non-completed turn's
          // fallback, as before.
          const settledUsage = totalUsage ?? usage ?? facts.usage
          const round = {
            ...facts.model === undefined ? {} : { observedModel: facts.model },
            ...facts.cliVersion === undefined ? {} : { cliVersion: facts.cliVersion },
            ...settledUsage === undefined ? {} : { usage: settledUsage },
            // Only the wire's own thread total diffed to this round is the
            // CLI's report; the per-call `last` and the rollout read are not
            // round totals (batch 5 S1).
            ...totalUsage === undefined ? {} : { providerReportedUsage: totalUsage },
          }
          localAgent?.recordRoundSettled(childSession.id, round)
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
      // Host 0.2.1: a fresh PER-EXECUTION run id — the activation manager
      // rejects a run id naming a live Session (this child session is live),
      // and resume rounds reuse the child session id. The family's durable
      // tracking key (the child session id) rides the staged intent instead.
      id: SessionId(randomUUID()),
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

/**
 * After a round: each compaction codex ran on its own (one
 * `local-agent/compaction`, source `auto`, marked `unrecorded: ['usage']` —
 * codex states no spend for it, and no summary and no after-count), and the thread's occupancy (one `local-agent/context`, when
 * it moved).
 */
function recordRoundContext(
  childSession: Session,
  rt: { contextTokens: number | undefined; contextWindow: number | undefined; boundModel?: string | undefined },
  autoCompactions: readonly { at: number; beforeTokens?: number }[],
): void {
  for (const compaction of autoCompactions) {
    childSession.append('local-agent/compaction', {
      source: 'auto', outcome: 'completed', provider: 'codex-local',
      ...rt.boundModel === undefined ? {} : { model: rt.boundModel },
      ...compaction.beforeTokens === undefined ? {} : { beforeTokens: compaction.beforeTokens },
      ...rt.contextWindow === undefined ? {} : { contextWindow: rt.contextWindow },
      startedAt: compaction.at, endedAt: compaction.at, boundarySeq: childSession.snapshotEvents().at(-1)?.seq ?? -1,
      // Codex states no spend for a compaction it runs on its own: marked
      // here, when written, so a reader never mistakes it for a missing field.
      unrecorded: ['usage'],
    })
  }
  if (rt.contextTokens === undefined) return
  // A compaction just ran: the same number is news, so it is written anyway.
  recordContextOccupancy(childSession, { provider: 'codex-local', usedTokens: rt.contextTokens, contextWindow: rt.contextWindow },
    { force: autoCompactions.length > 0 })
}

/** Each resident runtime's member-bridge token (the round-start tool check asks by it). */
const runtimeTokens = new WeakMap<CodexLiveRuntime, string>()
