/**
 * One-shot Codex CLI subagent lifecycle: spawn `codex exec "<task>"` through
 * the subprocess seam under the harness's scoped home, capture its printed
 * response as the run output, and dispose to whole-tree quiescence. Mirrors
 * the kimi-cli provider: every accepted run is a fresh process and a fresh
 * codex session; there is no continuation across runs.
 *
 * The provider name `codex-local` avoids colliding with the official
 * `subagent-codex` package's provider name `codex` — a composition that
 * mounts both would fail loud with DUPLICATE_PROVIDER. The tool row in this
 * bundle's patch takes the official model-facing name `subagent_codex`
 * instead: the official preset row ships disabled, and the patch disables
 * it too (a deliberate user re-enable conflicts loud, by design).
 * @module @khorsheed/dsh-local-agent-codex/codex-cli-provider
 */

import { randomUUID } from 'node:crypto'
import type { ContentBlock, TokenUsage } from '@deepseek-ai/dsh-llm'
import { createAssistantMessage, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import {
  NO_START_CAPABILITIES,
  settleRunResult,
  subprocessRunHandle,
  type ResolvedSubagentStartRequest,
  type SubagentCapabilities,
  type SubagentProvider,
  type SubagentResult,
  type SubagentRun,
  type SubagentStartRequest,
  type SubagentStopReason,
} from '@deepseek-ai/dsh-subagent'
import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEventMap } from '@deepseek-ai/dsh-session'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import {
  assertResumeCwdUnchanged,
  delegationEnv,
  resolveChildCwd,
  subagentDelegationLabel,
} from '@khorsheed/dsh-local-agent'
import { MEMBER_BRIDGE_SOCKET_ENV, MEMBER_BRIDGE_TOKEN_ENV } from '@khorsheed/dsh-local-agent/types'
import { LiveChannelUnavailableError } from './live-driver.ts'
import type { CodexLiveDriver } from './live-driver.ts'
import { readCodexBaseUrl } from './provision.ts'
import { codexRolloutUsage, codexRolloutTurnModel, usageFromCodex } from './records.ts'

// The host renamed its tool-call id brand between lines (`CallId` on the npm
// rc line, a new name on 0.1.2-alpha). A brand is compile-time-only and the
// runtime value is a plain string, so instead of importing either brand
// factory we extract the field types from the consuming APIs — the same
// source then compiles against both lines.
type ToolCallEventCallId = SessionEventMap['tool/call']['callId']
type ToolResultCallId = Parameters<typeof createToolResultMessage>[0]['callId']

/** Quote one TOML basic string for the `-c` config override. */
function tomlString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/** Default POSIX grace between subprocess termination tiers. */
export const DEFAULT_DISPOSE_GRACE_MS = 3_000

/**
 * Auth-shaped failure signatures in codex's stderr or event stream: the
 * endpoint rejected the credential. Narrow on purpose — matched against
 * provider-controlled error output only.
 */
export const CODEX_AUTH_FAILURE = /401 unauthorized|unauthorized|authentication failed|not logged in|access token/i

/** Codex sandbox policy values accepted by `codex exec --sandbox`. */
export type CodexSandbox = 'read-only' | 'workspace-write' | 'danger-full-access'

/**
 * Member channel registration for one codex process lifetime: mint the
 * per-run token and build the bridge MCP declaration as a per-process `-c`
 * config override (codex takes inline TOML — spike-verified end-to-end
 * against the real CLI on 2026-08-20, including the model-call leg).
 * `default_tools_approval_mode="approve"` is required: codex's stable MCP
 * elicitation gate auto-cancels tools lacking a readOnlyHint in
 * non-interactive mode ("user cancelled MCP tool call"), and the bridge's
 * member_message is a write tool. Nothing is written to the scoped home, so
 * there is nothing to prune at settle; `release` only invalidates the token.
 * Returns undefined when the mounted core predates the member channel
 * (declare-and-degrade: the run proceeds unchanged). The exec driver
 * registers per round; the live driver registers per resident process and
 * releases on reclaim.
 */
export interface CodexMemberRunHandle {
  readonly token: string
  readonly configOverride: string
  bind(pid: number): void
  release(): void
}

/** Register one member run with the channel; see {@link CodexMemberRunHandle}. */
export function registerCodexMemberRun(
  ctx: Context,
  childSessionId: string,
  parentSessionId: string,
): CodexMemberRunHandle | undefined {
  const registry = ctx.localAgent
  if (
    typeof registry.registerMemberRun !== 'function'
    || typeof registry.memberBridgeSocketPath !== 'function'
    || typeof registry.memberBridgeCommand !== 'function'
  ) return undefined
  const token = registry.registerMemberRun({ childSessionId, parentSessionId, provider: 'codex-local' })
  // Dashed server names are valid TOML bare keys (spike-verified parse).
  const serverName = `dsh-member-${token.slice(0, 8)}`
  const bridge = registry.memberBridgeCommand()
  const configOverride = `mcp_servers.${serverName}={`
    + `command=${tomlString(bridge.command)},`
    + `args=[${bridge.args.map(tomlString).join(',')}],`
    + `env={${MEMBER_BRIDGE_SOCKET_ENV}=${tomlString(registry.memberBridgeSocketPath())},${MEMBER_BRIDGE_TOKEN_ENV}=${tomlString(token)}},`
    + `default_tools_approval_mode=${tomlString('approve')}`
    + `}`
  let released = false
  return {
    token,
    configOverride,
    bind: pid => registry.bindMemberRunPid(token, pid),
    release: () => {
      if (released) return
      released = true
      registry.unregisterMemberRun(token)
    },
  }
}

/**
 * One-shot and resumable Codex CLI subagent provider: every accepted FRESH run
 * starts a `codex exec` process in the delegating Session's workspace, under
 * the harness scoped home; a resume round (the family tool's staged resume
 * intent) continues the SAME thread with `codex exec --json resume <thread_id>`
 * inside the SAME dsh child session. With the live driver configured
 * (`live: true`), rounds instead go to the resident app-server process (see
 * live-driver.ts); the exec path below stays the fallback.
 */
export class CodexCliProvider implements SubagentProvider {
  readonly name = 'codex-local'
  readonly capabilities: SubagentCapabilities = NO_START_CAPABILITIES
  readonly inheritsParentContext = false

  /**
   * @param live - the live driver, or a resolver returning the current
   *   generation's driver per member (the settings toggle swaps generations;
   *   a resolver may return undefined to steer one member's round to exec
   *   while a retiring generation still hosts it).
   */
  constructor(
    private readonly ctx: Context,
    private readonly sandbox: CodexSandbox = 'workspace-write',
    private readonly live?: CodexLiveDriver | ((childSessionId: string) => CodexLiveDriver | undefined),
  ) {}

  /** Resolve the live driver for one round's member, if live is on for it. */
  private liveDriver(childSessionId: string): CodexLiveDriver | undefined {
    const live = this.live
    if (live === undefined) return undefined
    return typeof live === 'function' ? live(childSessionId) : live
  }

  /** Per-round member-channel registration for the exec path (see {@link registerCodexMemberRun}). */
  private memberRun(
    childSessionId: string,
    parentSessionId: string,
  ): CodexMemberRunHandle | undefined {
    return registerCodexMemberRun(this.ctx, childSessionId, parentSessionId)
  }

  async start(request: ResolvedSubagentStartRequest): Promise<SubagentRun> {
    const homeDir = this.ctx.localAgent.homeDir('codex')
    // The family tool stages exactly one intent per delegation call; the
    // provider consumes exactly one per start. A resume intent continues the
    // recorded thread inside the existing child session.
    const intent = this.ctx.localAgent.takeDelegationIntent(request.parent.session.id, this.name)
    // The effective cwd: the caller's override (the staged intent's `cwd`,
    // riding DelegationCallOptions.cwd) when present, else the parent
    // session's workspace — the behavior before overrides existed.
    const cwd = resolveChildCwd(request.parent.session.header.cwd, intent?.cwd)
    if (cwd === undefined) {
      throw new Error('subagent-codex: the parent session has no working directory to run the CLI in')
    }
    if (intent !== undefined && intent.kind === 'resume') {
      // A CLI session continues in the directory its first round ran in; a
      // round resolving elsewhere is rejected before any process spawns.
      assertResumeCwdUnchanged(this.ctx.localAgent.getDelegation(intent.childSessionId), cwd, 'subagent-codex')
      return this.startCodexResume(request, intent, cwd, homeDir)
    }
    return this.startCodexFresh(request, cwd, homeDir)
  }

  /** Fresh round: record the child session, spawn `codex exec`, append after settle. */
  private async startCodexFresh(
    request: ResolvedSubagentStartRequest,
    cwd: string,
    homeDir: string,
  ): Promise<SubagentRun> {
    const runId = SessionId(randomUUID())
    let childSession: Session | undefined
    try {
      const sessions = this.ctx.get('sessions')
      if (sessions === undefined) {
        throw new Error('the sessions service is not mounted')
      }
      childSession = sessions.create(runId, {
        meta: {
          cwd,
          parentSession: request.parent.session.id,
          origin: 'subagent',
          delegationDepth: (request.parent.session.header.delegationDepth ?? 0) + 1,
        },
      })
      const harness = this.ctx.localAgent.get('codex')
      childSession.append('subagent/descriptor', {
        ...request.descriptor,
        label: subagentDelegationLabel(harness?.displayName ?? 'codex', request.descriptor.label),
      })
      void this.ctx.get('sessionPersistence')?.create(childSession.header).catch(() => {})
    } catch (error) {
      this.ctx.logger.warn(`subagent-codex: subagent session record failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    // Resolve the effective custom endpoint from the scoped config.toml for
    // diagnostics: codex reads it directly (a user manually editing the
    // config to route through a custom provider is authoritative). Logged
    // BEFORE the drive-mode branch so live rounds report their endpoint too.
    const baseUrl = await readCodexBaseUrl(homeDir).catch(() => undefined)
    this.ctx.logger.info(`subagent-codex: delegating via ${baseUrl ?? 'codex default endpoint'}`)
    // Live driver: the round goes to the resident app-server process (one per
    // member). A channel that fails at spawn/handshake falls through to the
    // exec one-shot below — and stays there until the breaker cools down.
    const live = this.liveDriver(runId)
    if (live !== undefined && childSession !== undefined && !live.disabled) {
      try {
        return await live.startRound(request, {
          cwd,
          homeDir,
          childSession,
          parentSessionId: request.parent.session.id,
          // The thread id arrives with thread/start (server-assigned), far
          // earlier than the exec path's settle-time parse.
          onThreadId: (threadId) => {
            this.ctx.localAgent.recordDelegation({
              childSessionId: runId,
              provider: this.name,
              parentSessionId: request.parent.session.id,
              cliSessionId: threadId,
              // The round's resolved working directory anchors the
              // resume-consistency check.
              cwd,
            })
          },
        })
      } catch (error) {
        if (!(error instanceof LiveChannelUnavailableError) || request.signal.aborted) throw error
        this.ctx.logger.warn(`subagent-codex: live driver unavailable, using the exec one-shot: ${error.message}`)
      }
    }
    // Member channel: register this run and carry the bridge declaration on
    // the spawn argv, so the CLI session starts with member_message available.
    const member = this.memberRun(runId, request.parent.session.id)
    try {
      const run = await startCodexCliRun(request, {
        cwd,
        env: delegationEnv({ CODEX_HOME: homeDir }),
        endpointLabel: baseUrl,
        sandbox: this.sandbox,
        disposeGraceMs: DEFAULT_DISPOSE_GRACE_MS,
        spawn: spec => this.ctx.subprocess.spawn(spec),
        onError: (error: unknown, stopReason) => {
          this.ctx.logger.warn(`subagent-codex: child run failed (${stopReason}) via ${baseUrl ?? 'codex default endpoint'}: ${error instanceof Error ? error.message : String(error)}`)
        },
        onSpawned: (pid) => { member?.bind(pid) },
        onAuthFailure: (detail) => { this.ctx.localAgent.reportAuthFailure('codex', detail) },
        ...member === undefined ? {} : { member: { configOverride: member.configOverride } },
        childSession,
        ctx: this.ctx,
        // The first round records the thread id so a later resume round can
        // continue it.
        onThreadId: (threadId) => {
          if (threadId === undefined) return
          this.ctx.localAgent.recordDelegation({
            childSessionId: runId,
            provider: this.name,
            parentSessionId: request.parent.session.id,
            cliSessionId: threadId,
            // The round's resolved working directory anchors the
            // resume-consistency check.
            cwd,
          })
        },
        // Every settled round reports its observed model and usage through the
        // registry's observation channel (record merge + `settled` event).
        onRoundSettled: (round) => {
          this.ctx.localAgent.recordRoundSettled(runId, round)
        },
      })
      // The member-channel token dies with the run, whatever its stop reason.
      if (member !== undefined) void run.result.then(member.release, member.release)
      return run
    } catch (error) {
      member?.release()
      throw error
    }
  }

  /** Resume round: continue the recorded thread inside the existing child session. */
  private async startCodexResume(
    request: ResolvedSubagentStartRequest,
    intent: { readonly kind: 'resume'; readonly childSessionId: string; readonly cliSessionId: string },
    cwd: string,
    homeDir: string,
  ): Promise<SubagentRun> {
    // One in-flight resume per child session: a second resume of the same
    // child fails loud instead of racing the first process. The lock releases
    // on every settle path (the run.result handler below) and on the error
    // path, so a deadlock never strands a later resume.
    if (!this.ctx.localAgent.acquireResumeLock(intent.childSessionId)) {
      throw new Error(
        `subagent-codex: 该子会话有进行中的委派，等其完成后再追问 (child session ${intent.childSessionId})`,
      )
    }
    try {
      const sessions = this.ctx.get('sessions')
      const childSession = sessions?.get(SessionId(intent.childSessionId))
      if (childSession === undefined) {
        throw new Error(
          `subagent-codex: resume target child session ${intent.childSessionId} is not live — start a fresh delegation instead`,
        )
      }
      const nextTurn = childSession.events.filter(event => event.type === 'turn/start').length + 1
      const baseUrl = await readCodexBaseUrl(homeDir).catch(() => undefined)
      // Logged BEFORE the drive-mode branch so live rounds report their endpoint too.
      this.ctx.logger.info(`subagent-codex: resuming via ${baseUrl ?? 'codex default endpoint'}`)
      // Live driver: continue the member's resident app-server thread. Channel
      // spawn/handshake failure falls through to the exec one-shot below.
      const live = this.liveDriver(intent.childSessionId)
      if (live !== undefined && !live.disabled) {
        try {
          const liveRun = await live.startRound(request, {
            cwd,
            homeDir,
            childSession,
            parentSessionId: request.parent.session.id,
            resume: { cliSessionId: intent.cliSessionId, turn: nextTurn },
          })
          void liveRun.result.then(
            () => { this.ctx.localAgent.releaseResumeLock(intent.childSessionId) },
            () => { this.ctx.localAgent.releaseResumeLock(intent.childSessionId) },
          )
          return liveRun
        } catch (error) {
          if (!(error instanceof LiveChannelUnavailableError) || request.signal.aborted) throw error
          this.ctx.logger.warn(`subagent-codex: live driver unavailable, using the exec one-shot: ${error.message}`)
        }
      }
      // Member channel: register the resume round (same child session, fresh
      // per-run token) before the spawn.
      const member = this.memberRun(intent.childSessionId, request.parent.session.id)
      let run: SubagentRun
      try {
        run = await startCodexCliRun(request, {
          cwd,
          env: delegationEnv({ CODEX_HOME: homeDir }),
          endpointLabel: baseUrl,
          sandbox: this.sandbox,
          disposeGraceMs: DEFAULT_DISPOSE_GRACE_MS,
          spawn: spec => this.ctx.subprocess.spawn(spec),
          onError: (error: unknown, stopReason) => {
            this.ctx.logger.warn(`subagent-codex: child run failed (${stopReason}) via ${baseUrl ?? 'codex default endpoint'}: ${error instanceof Error ? error.message : String(error)}`)
          },
          onSpawned: (pid) => { member?.bind(pid) },
        onAuthFailure: (detail) => { this.ctx.localAgent.reportAuthFailure('codex', detail) },
          ...member === undefined ? {} : { member: { configOverride: member.configOverride } },
          childSession,
          ctx: this.ctx,
          resume: { cliSessionId: intent.cliSessionId, turn: nextTurn },
          // Every settled round reports its observed model and usage through
          // the registry's observation channel.
          onRoundSettled: (round) => {
            this.ctx.localAgent.recordRoundSettled(intent.childSessionId, round)
          },
        })
      } catch (error) {
        member?.release()
        throw error
      }
      void run.result.then(
        () => {
          this.ctx.localAgent.releaseResumeLock(intent.childSessionId)
          member?.release()
        },
        () => {
          this.ctx.localAgent.releaseResumeLock(intent.childSessionId)
          member?.release()
        },
      )
      return run
    } catch (error) {
      this.ctx.localAgent.releaseResumeLock(intent.childSessionId)
      throw error
    }
  }
}

/** Fully resolved inputs for one Codex CLI run. */
export interface CodexCliRunSpec {
  /** Parent Session workspace; also the codex process cwd. */
  readonly cwd: string
  /** Explicit environment layered after the shared credential scrub. */
  readonly env: Readonly<NodeJS.ProcessEnv>
  /** Resolved endpoint label for diagnostics; absent means the CLI default. */
  readonly endpointLabel?: string | undefined
  /** Sandbox policy passed to `codex exec --sandbox`. */
  readonly sandbox: CodexSandbox
  /** Subprocess termination grace passed to the shared process-tree owner. */
  readonly disposeGraceMs: number
  /** Shared subprocess service spawn operation. */
  readonly spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle
  /** Diagnostic sink for a post-publication error flattened into a result. */
  readonly onError?: (error: Error, stopReason: SubagentStopReason) => void
  /**
   * Called when the settled failure is auth-shaped (the endpoint rejected the
   * credential — a 401 a presence probe cannot see). The provider wires this
   * to the family registry's auth-failure mark.
   */
  readonly onAuthFailure?: ((detail: string) => void) | undefined
  /** Called with the spawned CLI pid right after spawn (member-channel pid binding). */
  readonly onSpawned?: (pid: number) => void
  /**
   * Member channel: the bridge MCP declaration for this run as one `-c`
   * inline-TOML config override (per-process; nothing lands in the scoped
   * config.toml). Absent on a core that predates the member channel — the
   * argv is then exactly the pre-channel shape.
   */
  readonly member?: { readonly configOverride: string } | undefined
  /** dsh subagent session recording this delegation; its response is appended after settle. */
  readonly childSession?: Session | undefined
  /** Host context carrying session persistence. */
  readonly ctx?: Context | undefined
  /**
   * Resume round: continue the thread named by `cliSessionId` with
   * `codex exec --json resume <thread_id>` instead of a fresh exec, appending
   * this round into the same child session under the given turn number.
   */
  readonly resume?: { readonly cliSessionId: string; readonly turn: number } | undefined
  /**
   * Called after the run settles with the thread id parsed from the NDJSON
   * stream (absent when none was reported). The fresh path uses it to record
   * the delegation so a later resume round can continue the thread.
   */
  readonly onThreadId?: ((threadId: string | undefined) => void) | undefined
  /**
   * Called once per settled round, after the output stream has been fully
   * parsed and mirrored: the round's observed model identifier and token
   * usage, each absent when the stream (and the rollout fallback) yielded
   * none. The provider wires this to the registry's observation channel
   * (`recordRoundSettled` — the delegation record's `observedModel` merge and
   * the `settled` run-progress event). Fires for fresh and resume rounds
   * alike, on every terminal state.
   */
  readonly onRoundSettled?: ((round: { readonly observedModel?: string; readonly usage?: TokenUsage }) => void) | undefined
}

function thrown(value: unknown): Error {
  /* v8 ignore next -- typed subprocess failures reject with Error. */
  return value instanceof Error ? value : new Error(String(value))
}

/**
 * Validate and join the one-shot task before crossing the process boundary.
 * @param prompt - task content accepted from the shared subagent service.
 * @returns the joined non-empty text.
 */
export function textTask(prompt: readonly ContentBlock[]): string {
  if (prompt.length === 0) {
    throw new Error('subagent-codex: the one-shot task must contain only text blocks')
  }
  const texts: string[] = []
  for (const block of prompt) {
    if (block.type !== 'text') {
      throw new Error('subagent-codex: the one-shot task must contain only text blocks')
    }
    texts.push(block.text)
  }
  if (texts.every(text => text.trim().length === 0)) {
    throw new Error('subagent-codex: the one-shot task must not be empty')
  }
  return texts.join('\n')
}

/** One ordered transcript line from a `codex exec --json` event stream. */
export type CodexTranscriptLine =
  | { kind: 'think'; text: string }
  | { kind: 'text'; text: string }
  /**
   * Tool activity: one call with its (possibly absent) result. `id` is the
   * stream item's id when present, else a synthesized position-based id —
   * stable within a run either way, so the child session's
   * `tool/call`/`tool/result` events pair by it.
   */
  | { kind: 'tool'; id: string; name: string; args?: string; result?: string }

/** Mutable fold state shared by the batch parse and the incremental parser. */
interface CodexStreamFoldState {
  readonly lines: CodexTranscriptLine[]
  text: string | undefined
  usage: TokenUsage | undefined
  threadId: string | undefined
  /**
   * The model identifier the stream itself named (a `model` field on
   * `thread.started` or `turn.completed`), when the CLI emits one. codex
   * 0.144.0's exec stream carries none — the model then comes from the
   * rollout's turn_context at settle — but the fold accepts it so a CLI that
   * starts naming the model in the stream needs no parser change.
   */
  model: string | undefined
  /** Whether the stream's terminal `turn.completed` event was folded. */
  completed: boolean
}

/**
 * Fold one NDJSON line into the stream state. Shared by
 * {@link parseCodexJsonStream} (settle-time whole-stream parse) and
 * {@link CodexStreamParser} (live incremental parse) so the two paths cannot
 * drift.
 */
function foldCodexStreamLine(state: CodexStreamFoldState, raw: string): void {
  const line = raw.trim()
  if (line === '') return
  let event: {
    type?: string
    model?: unknown
    item?: { type?: string; text?: string; command?: string; aggregated_output?: string; raw?: string; output?: string; name?: string; id?: string }
    usage?: unknown
    thread_id?: unknown
  }
  try {
    event = JSON.parse(line) as typeof event
  } catch {
    return
  }
  if (event.type === 'thread.started' && typeof event.thread_id === 'string') {
    state.threadId = event.thread_id
    if (typeof event.model === 'string' && event.model !== '') state.model = event.model
    return
  }
  if (event.type === 'turn.completed') {
    state.completed = true
    if (event.usage !== undefined) state.usage = usageFromCodex(event.usage)
    if (typeof event.model === 'string' && event.model !== '') state.model = event.model
    return
  }
  if (event.type !== 'item.completed' || event.item === undefined) return
  const item = event.item
  if (item.type === 'reasoning' && typeof item.text === 'string' && item.text.trim() !== '') {
    state.lines.push({ kind: 'think', text: item.text })
  } else if (item.type === 'agent_message' && typeof item.text === 'string') {
    state.lines.push({ kind: 'text', text: item.text })
    state.text = item.text
  } else if (item.type === 'command_execution') {
    const command = typeof item.command === 'string' ? item.command : undefined
    const output = typeof item.aggregated_output === 'string' && item.aggregated_output.trim() !== ''
      ? item.aggregated_output
      : undefined
    if (command !== undefined || output !== undefined) {
      state.lines.push({
        kind: 'tool',
        id: typeof item.id === 'string' ? item.id : `codex-tool-${state.lines.length}`,
        name: 'Bash',
        ...command === undefined ? {} : { args: command },
        ...output === undefined ? {} : { result: output },
      })
    }
  } else if (item.type === 'web_search_call') {
    state.lines.push({
      kind: 'tool',
      id: typeof item.id === 'string' ? item.id : `codex-tool-${state.lines.length}`,
      name: 'WebSearch',
    })
  } else if (item.type === 'function_call_output') {
    // A function/command result; attach to the previous tool line when one
    // is pending (web search or command output).
    const output = typeof item.output === 'string' ? item.output : undefined
    if (output !== undefined && output.trim() !== '') {
      const last = state.lines[state.lines.length - 1]
      if (last !== undefined && last.kind === 'tool') {
        state.lines[state.lines.length - 1] = {
          ...last,
          result: last.result === undefined ? output : `${last.result}\n${output}`,
        }
      }
    }
  }
}

/**
 * Incremental `codex exec --json` parser: feed stdout chunks as they arrive
 * and the folded transcript accumulates line by line. The last line is
 * volatile until the terminal `turn.completed` — a `function_call_output`
 * merges into a pending tool line — so live consumers hold it back (see the
 * run's live mirror).
 */
export class CodexStreamParser implements CodexStreamFoldState {
  private buffer = ''
  readonly lines: CodexTranscriptLine[] = []
  text: string | undefined
  usage: TokenUsage | undefined
  threadId: string | undefined
  model: string | undefined
  completed = false

  /** Fold every complete NDJSON line in the chunk; the tail stays buffered. */
  push(chunk: string): void {
    this.buffer += chunk
    const parts = this.buffer.split('\n')
    this.buffer = parts.pop() ?? ''
    for (const raw of parts) foldCodexStreamLine(this, raw)
  }
}

/**
 * Parse a `codex exec --json` NDJSON event stream into an ordered transcript
 * (thinking, agent text, tool/command activity in event order), plus the final
 * answer text, token usage, the thread id a later resume round continues, and
 * the model identifier the stream named (usually absent — codex 0.144.0 does
 * not put one on the wire; the settle path then reads the rollout's
 * turn_context). Item types covered: `reasoning` (thinking), `agent_message`
 * (reply text), `command_execution` (shell command with aggregated output),
 * `web_search_call`, and `function_call_output`. The last `agent_message`
 * wins as the run output (the final answer), and `turn.completed` carries the
 * turn's usage. Malformed lines are skipped.
 * @param stream - the collected stdout NDJSON text.
 * @returns the ordered transcript, final answer text, usage, thread id, and
 *   any stream-named model.
 */
export function parseCodexJsonStream(stream: string): {
  lines: readonly CodexTranscriptLine[]
  text?: string
  usage?: TokenUsage
  threadId?: string
  model?: string
} {
  const state: CodexStreamFoldState = { lines: [], text: undefined, usage: undefined, threadId: undefined, model: undefined, completed: false }
  for (const raw of stream.split('\n')) foldCodexStreamLine(state, raw)
  return {
    lines: state.lines,
    ...state.text === undefined ? {} : { text: state.text },
    ...state.usage === undefined ? {} : { usage: state.usage },
    ...state.threadId === undefined ? {} : { threadId: state.threadId },
    ...state.model === undefined ? {} : { model: state.model },
  }
}

/**
 * Start the real `codex exec` child and publish its run. The codex
 * reply arrives as an NDJSON event stream on stdout (`--json`): the final
 * `agent_message` item is the run output and the `turn.completed` usage is
 * the token accounting. stderr is piped for diagnostics and never folded
 * into the run output. A resume round spawns `codex exec --json resume
 * <thread_id>` instead, continuing the same thread. The run id is the child
 * session id for a session-backed run.
 * @param request - resolved shared subagent request.
 * @param spec - workspace, environment, process service, and diagnostic policy.
 * @returns the published run after the child starts.
 */
export function startCodexCliRun(
  request: SubagentStartRequest,
  spec: CodexCliRunSpec,
): Promise<SubagentRun> {
  const task = textTask(request.prompt)
  if (request.signal.aborted) {
    throw new Error('subagent-codex: request was aborted before the CLI started')
  }
  const turn = spec.resume?.turn ?? 1
  // The member bridge rides a per-process `-c` override placed right after
  // `exec` (the spike-verified position; `codex exec resume` accepts it too).
  const memberArgv = spec.member === undefined ? [] : ['-c', spec.member.configOverride]

  const child = spec.spawn({
    argv: spec.resume === undefined
      ? ['codex', 'exec', ...memberArgv, '--sandbox', spec.sandbox, '--json', task]
      : ['codex', 'exec', ...memberArgv, '--sandbox', spec.sandbox, '--json', 'resume', spec.resume.cliSessionId, task],
    cwd: spec.cwd,
    stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
    graceMs: spec.disposeGraceMs,
    env: spec.env,
  })
  spec.onSpawned?.(child.pid)
  // The spawn moment anchors the rollout-locator time window: the run's
  // rollout file starts around here (thread creation ≈ turn start ≈ spawn),
  // so the usage fallback can find it even when a kill truncated the stream
  // before `thread.started` ever reached stdout.
  const startedAtMs = Date.now()

  // The turn opens at the real spawn moment so the timing projection
  // measures actual CLI runtime, not the post-hoc append time.
  spec.childSession?.append('turn/start', { turn })
  // Live mirror: fold the NDJSON stream as chunks arrive so the child session
  // shows the run's progress before settle; the settle mirror below resumes
  // from the live counters and stays a no-op when live mirroring kept up.
  const liveMirror = spec.childSession !== undefined && spec.ctx !== undefined
    ? createCodexLiveMirror(spec, task, turn)
    : undefined
  let output = ''
  child.stdout?.on('data', (chunk: Buffer) => {
    const text = chunk.toString()
    output += text
    liveMirror?.push(text)
  })
  let stderr = ''
  child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString() })

  const disposeProcess = async (): Promise<void> => {
    if (child.pid <= 0) {
      await child.done.catch(() => {})
      return
    }
    child.terminate()
    await child.waitForExit()
    await child.done
  }

  const runAbort = new AbortController()
  const requestCancel = (): void => {
    if (runAbort.signal.aborted) return
    runAbort.abort(new Error('subagent-codex: run cancelled locally'))
  }
  const onAbort = (): void => { requestCancel() }
  request.signal.addEventListener('abort', onAbort, { once: true })

  // Abort branch: the moment the run is cancelled locally, the attempt settles
  // immediately — settleRunResult observes `cancelled()` and resolves the
  // result with 'aborted' WITHOUT waiting for the child to exit. The actual
  // process kill is dispose's job (SIGTERM → grace → SIGKILL teardown ladder),
  // per the subprocessRunHandle contract: requestCancel settles the result,
  // teardown reaps the process. Without this branch the result would only
  // settle after the child exits, and dispose (which runs after the result)
  // would never fire — a dead wait on a long-running CLI.
  const abortBranch = new Promise<never>((_, reject) => {
    runAbort.signal.addEventListener('abort', () => reject(new Error('subagent-codex: run cancelled locally')), { once: true })
  })

  const processFailure: Promise<never> = child.done.then(
    outcome => Promise.reject(new Error(
      'subagent-codex: CLI exited before the run settled '
      + `(code ${String(outcome.exitCode)}, signal ${String(outcome.signal)})`,
    )),
    (error: unknown) => Promise.reject(thrown(error)),
  )
  // A normal post-result dispose also closes the process; keep the expected
  // late rejection observed after the result race has already settled.
  processFailure.catch(() => {})

  const collectOutput = (): ContentBlock[] => {
    // Parse fresh at call time: stdout 'data' events may still be flushing
    // when the settle callback computes its first output, and the consumer
    // may poll output again later. Post-exit the seam's collected buffer is
    // authoritative — a fast-exiting process can settle `done` before the
    // streamed data events land.
    const drained = child.collected.stdout?.readFrom(0).text
    const text = parseCodexJsonStream(drained !== undefined && drained !== '' ? drained : output).text?.trim()
    return text === undefined || text === '' ? [] : [{ type: 'text', text }]
  }

  // Captured from the child's exit so the error turn/end can name the real
  // code without the settle chain re-deriving it.
  let exitCode: number | null = null

  const result: Promise<SubagentResult> = settleRunResult({
    attempt: () => Promise.race([
      child.done.then((outcome) => {
        if (outcome.exitCode !== 0) {
          const via = spec.endpointLabel ?? 'codex default endpoint'
          exitCode = outcome.exitCode
          throw new Error(`subagent-codex: codex exec exited with code ${String(outcome.exitCode)} via ${via}`)
        }
        // A zero exit with no parsed answer is a silent failure, not a
        // success: the NDJSON stream yielded no agent_message (internal
        // error, truncated stdout, or a schema drift — the exec --json event
        // field names are not contract-backed). Throwing here settles 'error'
        // through the seam instead of reporting an empty 'completed' (which
        // the upstream settleRunResult does not re-check). The abort path is
        // untouched: it settles 'aborted' through abortBranch before this
        // branch is ever reached.
        const parsed = parseCodexJsonStream(output)
        if (parsed.lines.length === 0) {
          // Format-drift early warning: a normally-exited stream with no
          // item.completed at all means the parser and the CLI disagreed on
          // the event shape. Warn once per run (not per line) without
          // changing the settle semantics — the empty output above still
          // reports 'error' either way.
          spec.onError?.(new Error('subagent-codex: exited 0 but parsed no codex events — check the codex --json event schema'), 'error')
          throw new Error('subagent-codex: codex exec exited 0 but produced no answer')
        }
        const answer = collectOutput()
        if (answer.length === 0) {
          throw new Error('subagent-codex: codex exec exited 0 but produced no answer')
        }
        return { output: answer, stopReason: 'completed' as const }
      }),
      processFailure,
      abortBranch,
    ]),
    collectOutput,
    cancelled: () => runAbort.signal.aborted,
    onError: spec.onError,
    signal: request.signal,
    onAbort,
  }).then((settled) => {
    // Every terminal path closes the turn so the timing window never stays
    // open on a failed or cancelled run: success settles 'completed', a
    // non-zero exit 'error', and a locally cancelled run 'aborted'. The
    // turn/end timestamp is the real settle moment.
    if (spec.childSession !== undefined) {
      if (settled.stopReason === 'completed') {
        spec.childSession.append('turn/end', { turn, reason: { kind: 'completed' } })
      } else if (settled.stopReason === 'aborted') {
        spec.childSession.append('turn/end', { turn, reason: { kind: 'aborted', reason: { kind: 'parent' } } })
      } else {
        spec.childSession.append('turn/end', {
          turn,
          reason: { kind: 'error', error: { message: `codex exec exited with code ${String(exitCode)}`, code: 'UNKNOWN' } },
        })
      }
    }
    return settled
  })

  // After the child EXITS — however it ended (completed, killed by dispose, or
  // crashed) — mirror whatever the NDJSON stream already produced into the dsh
  // subagent session, so a cancelled round still preserves its partial work
  // (reasoning, commands, replies) and real token usage. The thread id is
  // recorded even on abort so the partial thread stays resumable. Waits for
  // the settle chain first (so turn/end is already appended) AND for the
  // process to actually exit (so stdout is drained before parsing).
  void result.then(() => child.done).then(
    () => {
      if (spec.onAuthFailure !== undefined) {
        // The seam's collected buffers are complete at process exit; the
        // streamed variables can lag `done` by a tick.
        const drainedStderr = child.collected.stderr?.readFrom(0).text || stderr
        const drainedStdout = child.collected.stdout?.readFrom(0).text || output
        const authDetail = `${drainedStderr}\n${drainedStdout}`
        if (CODEX_AUTH_FAILURE.test(authDetail)) {
          spec.onAuthFailure(authDetail.split('\n').find(line => line.trim() !== '') ?? 'auth failure')
        }
      }
      return mirrorCodexAfterExit(spec, task, turn, output, liveMirror, startedAtMs)
    },
    () => { /* child.done rejects only on infra faults; nothing to mirror */ },
  )

  return Promise.resolve(subprocessRunHandle({
    // A session-backed run's id is the child session id (the seam's local-run
    // contract), so the tool's resume self-description names the same handle
    // the delegation registry records.
    id: spec.childSession?.id ?? SessionId(randomUUID()),
    result,
    signal: request.signal,
    onAbort,
    requestCancel,
    teardown: disposeProcess,
  }))
}

/** One assistant-role message event, attributed to the codex route. */
export function codexAssistantEvent(blocks: readonly ContentBlock[]) {
  return createAssistantMessage({
    content: blocks as ContentBlock[],
    source: { provider: 'codex-local', model: 'codex' },
  })
}

/** Mirror behavior switches shared by the exec and live paths. */
export interface CodexMirrorOptions {
  /**
   * Do not fold think/text lines into `assistant/message` events (the
   * token-granularity live mode streams that content as `assistant/chunk`
   * instead; the driver completes the stream with one combined final
   * message). Tool lines still fold, and the round's usage is left to the
   * caller — it rides the combined final message, not a folded line.
   */
  skipAssistantContent?: boolean
}

/**
 * Fold one transcript line into the child session as one assistant step.
 * @returns whether the line folded (false when the options skipped it).
 */
export function appendCodexTranscriptLine(
  childSession: Session,
  turn: number,
  step: number,
  line: CodexTranscriptLine,
  usage: TokenUsage | undefined,
  options?: CodexMirrorOptions,
): boolean {
  // Token-granularity live mode streams think/text as assistant/chunk; the
  // driver completes the stream with one combined final message, so the fold
  // leaves these lines out (their usage rides that final message).
  if (options?.skipAssistantContent === true && line.kind !== 'tool') return false
  if (line.kind === 'tool') {
    // Native tool card: the call event now, the result event when the stream
    // already carries it. Tool lines never carry the round's usage — the
    // callers attach usage to the round's final line, which is an agent
    // message on every well-formed stream.
    const call = childSession.append('tool/call', {
      turn,
      step,
      callId: line.id as ToolCallEventCallId,
      name: line.name,
      arguments: line.args ?? '',
    })
    if (line.result !== undefined) {
      childSession.append('tool/result', {
        turn,
        step,
        message: createToolResultMessage({
          callId: line.id as ToolResultCallId,
          content: [{ type: 'text', text: line.result }],
          isError: false,
        }),
      }, { surfaceOp: 'append', sourceEventSeqs: [call.seq] })
    }
    return true
  }
  const blocks = line.kind === 'think'
    ? [{ type: 'reasoning' as const, text: line.text }]
    : [{ type: 'text' as const, text: line.text }]
  childSession.append('assistant/message', {
    turn,
    step,
    message: codexAssistantEvent(blocks),
    ...usage === undefined ? {} : { usage },
  }, { surfaceOp: 'append' })
  return true
}

/** Fold one transcript line into the run's child session as one assistant step. */
function appendCodexLine(
  spec: CodexCliRunSpec,
  turn: number,
  step: number,
  line: CodexTranscriptLine,
  usage: TokenUsage | undefined,
): void {
  if (spec.childSession === undefined) return
  appendCodexTranscriptLine(spec.childSession, turn, step, line, usage)
}

/**
 * Book a round's usage when its carrier line (the last non-tool transcript
 * line) was already mirrored WITHOUT it — a killed run's usage is only
 * knowable at settle, and the carrier may have gone out through the live
 * mirror by then. Appends a usage chunk pinned to the carrier's turn/step:
 * the token projection treats a repeated step sample as a replacement, never
 * a double count. No-op when the round has no mirrored assistant message.
 * @param childSession - the run's child session.
 * @param turn - the round's turn number.
 * @param usage - the usage to book.
 * @returns whether the chunk was appended.
 */
export function appendCodexUsageChunk(childSession: Session, turn: number, usage: TokenUsage): boolean {
  for (let index = childSession.events.length - 1; index >= 0; index -= 1) {
    const event = childSession.events[index]
    if (event?.type !== 'assistant/message') continue
    const data = event.data as { turn?: number; step?: number }
    if (data.turn !== turn || typeof data.step !== 'number') return false
    childSession.append('assistant/chunk', {
      turn,
      step: data.step,
      chunk: { type: 'usage', usage },
    })
    return true
  }
  return false
}

/** The delta-progress text for one transcript line. */
export function codexLineText(line: CodexTranscriptLine): string {
  return line.kind === 'tool'
    ? `[工具 ${line.name}]${line.args !== undefined ? ` ${line.args}` : ''}${line.result !== undefined ? `\n${line.result}` : ''}`
    : line.text
}

/**
 * Persist the session's events ONLY when the session is standalone (tests,
 * ad-hoc mirrors). A live session's own write-behind pipeline already durably
 * stores every appended event; re-appending the full list here violates the
 * store's contiguous-seq contract ('append seq mismatch'), and the throw used
 * to kill the mirror pass BEFORE the offset advanced — every later pass then
 * re-folded the same lines (duplicated user messages, no usage, no offset on
 * the delegation record).
 */
export async function persistIfStandalone(ctx: Context, childSession: Session): Promise<void> {
  const sessions = ctx.get('sessions')
  if (sessions !== undefined && sessions.get(childSession.id) !== undefined) return
  const persistence = ctx.get('sessionPersistence')
  await persistence?.append(childSession.id, childSession.events)
}

/**
 * Per-run live mirror: folds stdout chunks incrementally and mirrors newly
 * completed transcript lines into the child session as they arrive, so a
 * caller watching the child session sees progress instead of silence until
 * settle. The LAST line is held back until the stream's terminal
 * `turn.completed`: it may still merge a trailing `function_call_output`, and
 * it is the round's usage carrier (the settle fold attaches usage to the
 * final line — same placement here). The counters are the settle path's
 * offset: the final mirror resumes from them and is a no-op when live
 * mirroring kept up. Failures are diagnostic-only and never kill the run.
 */
interface CodexLiveMirror {
  /** Fold one stdout chunk and mirror the newly completed lines. */
  push(chunk: string): void
  /** Transcript lines mirrored so far (the settle path resumes from here). */
  readonly mirroredLines: number
  /** Whether the run's user/message was already appended. */
  readonly userMirrored: boolean
  /** Serialize one async mirror task behind the in-flight ones. */
  enqueue(task: () => Promise<void>): Promise<void>
}

/** Create the per-run live mirror over the incremental parser. */
function createCodexLiveMirror(spec: CodexCliRunSpec, task: string, turn: number): CodexLiveMirror {
  const parser = new CodexStreamParser()
  const childSession = spec.childSession as Session
  const ctx = spec.ctx as Context
  let mirrored = 0
  let userMirrored = false
  let queue: Promise<void> = Promise.resolve()

  const mirror: CodexLiveMirror = {
    get mirroredLines() { return mirrored },
    get userMirrored() { return userMirrored },
    enqueue(task) {
      queue = queue.then(task)
      return queue
    },
    push(chunk) {
      parser.push(chunk)
      const upto = parser.completed ? parser.lines.length : parser.lines.length - 1
      if (upto <= mirrored) return
      void mirror.enqueue(async () => {
        try {
          const localAgent = ctx.get('localAgent')
          if (!userMirrored) {
            userMirrored = true
            childSession.append('user/message', createUserMessage({
              content: [{ type: 'text', text: task }],
              source: { kind: 'user' },
            }), { surfaceOp: 'append' })
            localAgent?.reportRunProgress(childSession.id, { kind: 'delta', text: task })
          }
          // The usage rides the last NON-tool line (tool events carry no
          // usage slot); a stream ending on a tool line would otherwise drop
          // the round's accounting. When that carrier was mirrored in an
          // earlier flush (before the usage was knowable), book it as a usage
          // chunk pinned to the carrier's step instead.
          let carrier = -1
          if (parser.completed && parser.usage !== undefined) {
            for (let scan = 0; scan < parser.lines.length; scan += 1) {
              if (parser.lines[scan]?.kind !== 'tool') carrier = scan
            }
          }
          const carrierMirrored = carrier !== -1 && carrier < mirrored
          for (let index = mirrored; index < upto; index += 1) {
            const line = parser.lines[index]
            if (line === undefined) continue
            const usage = index === carrier ? parser.usage : undefined
            appendCodexLine(spec, turn, index + 1, line, usage)
            mirrored = index + 1
            localAgent?.reportRunProgress(childSession.id, { kind: 'delta', text: codexLineText(line) })
          }
          if (carrierMirrored && parser.usage !== undefined) {
            appendCodexUsageChunk(childSession, turn, parser.usage)
          }
          await persistIfStandalone(ctx, childSession)
          localAgent?.reportRunProgress(childSession.id, { kind: 'mirror', mirroredLines: mirrored })
        } catch (error: unknown) {
          ctx.logger.warn(`subagent-codex: live mirror failed: ${thrown(error).message}`)
        }
      })
    },
  }
  return mirror
}

/**
 * Mirror the delegation's user prompt and the codex event transcript into the
 * dsh subagent session, then persist. Runs detached from the settle race — the
 * run result settles with the child exit, and a failure here is
 * diagnostic-only (the subagent record degrades to a final-text-only view).
 * The transcript's reasoning folds to `reasoning` blocks, agent text and tool
 * activity to text blocks (tool lines render `[工具 Bash] <command> → output`),
 * and the final assistant message carries the round's usage when codex
 * reported it, so the tokenUsage projection counts the delegation.
 * @param spec - the run spec carrying the child session and host context.
 * @param task - the one-shot task text (the user prompt).
 * @param turn - the round's turn number (1 for a fresh round, incremented on resume).
 * @param parsed - the parsed NDJSON transcript, final output, and usage.
 * @param fromLines - transcript lines the live mirror already appended.
 * @param userMirrored - whether the live mirror already appended the prompt.
 */
async function appendCodexResponse(
  spec: CodexCliRunSpec,
  task: string,
  turn: number,
  parsed: { lines: readonly CodexTranscriptLine[]; output: ContentBlock[]; usage?: TokenUsage },
  fromLines = 0,
  userMirrored = false,
): Promise<void> {
  if (spec.childSession === undefined || spec.ctx === undefined) return
  const childSession = spec.childSession
  const localAgent = spec.ctx.get('localAgent')
  if (!userMirrored) {
    childSession.append('user/message', createUserMessage({
      content: [{ type: 'text', text: task }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    localAgent?.reportRunProgress(childSession.id, { kind: 'delta', text: task })
  }
  // The round's usage rides the last NON-tool line: tool activity folds to
  // `tool/call`/`tool/result` events (which carry no usage slot), and a kill
  // mid-command ends the transcript with a tool line — exactly the case the
  // rollout-usage recovery exists for.
  let usageIndex = -1
  for (let index = 0; index < parsed.lines.length; index += 1) {
    if (parsed.lines[index]?.kind !== 'tool') usageIndex = index
  }
  let step = fromLines + 1
  for (const line of parsed.lines.slice(fromLines)) {
    appendCodexLine(spec, turn, step, line, step - 1 === usageIndex ? parsed.usage : undefined)
    localAgent?.reportRunProgress(childSession.id, { kind: 'delta', text: codexLineText(line) })
    step += 1
  }
  if (parsed.usage !== undefined && usageIndex !== -1 && usageIndex < fromLines) {
    // The carrier line went out through the live mirror before the usage was
    // knowable (a killed run recovers it from the rollout at settle): book it
    // as a usage chunk pinned to the carrier's step.
    appendCodexUsageChunk(childSession, turn, parsed.usage)
  }
  await persistIfStandalone(spec.ctx, childSession)
  localAgent?.reportRunProgress(childSession.id, { kind: 'mirror', mirroredLines: parsed.lines.length })
}

/**
 * Mirror the codex NDJSON stream into the child session AFTER the CLI process
 * has exited, whatever its stop reason. A cancelled or failed round still
 * preserves the events the stream already emitted (reasoning, commands,
 * replies, usage) instead of leaving the child blank — the run result settles
 * 'aborted'/'error' at the cancel moment, but codex may have produced content
 * before the kill landed. Also records the thread id (fresh rounds) so a
 * later resume can continue the partial thread.
 *
 * **Usage recovery**: a non-completed terminal state never emits
 * `turn.completed`, so the parsed stream carries no usage even though codex
 * wrote the run's real token spend to its rollout file. When the stream's
 * usage is absent, the mirror falls back to the run's rollout file — located
 * by the thread id (the `session_meta` head id) or by the spawn-time window —
 * and attaches the file's LAST `token_count` entry (same
 * `input − cached` caliber as `turn.completed`, via the shared
 * {@link usageFromCodex}), so a killed or failed run still books its tokens.
 * The fallback is best-effort and silent: no rollout file, an unreadable
 * home, or a hard kill that wrote no token_count leaves the child without
 * usage, exactly as before.
 *
 * **Model observation**: the exec --json wire carries no model field (codex
 * 0.144.0), so the run's model identifier is read from the located rollout
 * file's LAST `turn_context` line whose timestamp falls inside this run's
 * window — the turn codex actually started for this round. When the stream
 * itself names a model (a future CLI), the stream wins. Absent on any miss;
 * the observation rides {@link CodexCliRunSpec.onRoundSettled} along with the
 * round's usage.
 * @param spec - the run spec carrying the child session and host context.
 * @param task - the one-shot task text (the user prompt).
 * @param turn - the round's turn number.
 * @param output - the collected NDJSON stdout.
 * @param startedAtMs - the spawn moment, anchoring the rollout time window.
 */
async function mirrorCodexAfterExit(
  spec: CodexCliRunSpec,
  task: string,
  turn: number,
  output: string,
  live: CodexLiveMirror | undefined,
  startedAtMs: number,
): Promise<void> {
  if (spec.childSession === undefined || spec.ctx === undefined) return
  const work = async (): Promise<void> => {
    const parsed = parseCodexJsonStream(output)
    if (spec.resume === undefined) spec.onThreadId?.(parsed.threadId)
    const fromLines = live?.mirroredLines ?? 0
    const userMirrored = live?.userMirrored ?? false
    // Non-completed terminal states (aborted/error) never emit turn.completed,
    // so parsed.usage is absent; recover this run's last token_count from its
    // rollout file (scoped home via the spawn env, located by thread id or
    // the run's start-time window). A completed run keeps its stream usage.
    // The same located file names the run's model in its turn_context line.
    let usage = parsed.usage
    let observedModel = parsed.model
    const homeDir = spec.env['CODEX_HOME']
    if ((usage === undefined || observedModel === undefined) && homeDir !== undefined && homeDir !== '') {
      const locator = { threadId: parsed.threadId, windowStart: startedAtMs }
      if (usage === undefined) {
        usage = await codexRolloutUsage(homeDir, locator)
      }
      if (observedModel === undefined) {
        observedModel = await codexRolloutTurnModel(homeDir, locator)
      }
    }
    // The round's settled observation rides out even when nothing streamed:
    // an empty stream is still a settled round, and the rollout may already
    // name the model and the spend.
    spec.onRoundSettled?.({
      ...observedModel === undefined ? {} : { observedModel },
      ...usage === undefined ? {} : { usage },
    })
    // Nothing streamed at all (e.g. the CLI died before the first item): keep
    // the pre-live-mirror behavior of recording nothing.
    if (parsed.lines.length === 0 && !userMirrored) return
    await appendCodexResponse(spec, task, turn, {
      lines: parsed.lines,
      output: collectOutputBlocks(parsed.text),
      ...usage === undefined ? {} : { usage },
    }, fromLines, userMirrored)
  }
  try {
    // Behind the live mirror's queue so a flush in flight cannot interleave.
    if (live === undefined) await work()
    else await live.enqueue(work)
  } catch (error) {
    spec.onError?.(thrown(error), 'error')
  }
}

/** Build the run-output blocks from the final codex answer text. */
function collectOutputBlocks(text: string | undefined): ContentBlock[] {
  const trimmed = text?.trim()
  return trimmed === undefined || trimmed === '' ? [] : [{ type: 'text', text: trimmed }]
}
