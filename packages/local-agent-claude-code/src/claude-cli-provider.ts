/**
 * One-shot Claude Code CLI subagent lifecycle: spawn `claude -p "<task>"`
 * through the subprocess seam under the harness's scoped home, capture its
 * JSON result as the run output, and dispose to whole-tree quiescence.
 * Mirrors the kimi/codex providers: every accepted run is a fresh process
 * and a fresh claude session; there is no continuation across runs.
 *
 * The provider name `claude-local` avoids colliding with the official
 * `subagent-claude-code` package's provider name `claude-code` — a
 * composition that mounts both would fail loud with DUPLICATE_PROVIDER. The
 * tool row in this bundle's patch takes the official model-facing name
 * `subagent_claude_code` instead: the official preset row ships disabled,
 * and the patch disables it too (a deliberate user re-enable conflicts
 * loud, by design).
 * @module @khorsheed/dsh-local-agent-claude-code/claude-cli-provider
 */

import { randomUUID } from 'node:crypto'
import type { ContentBlock, TokenUsage } from '@deepseek-ai/dsh-llm'
import { createAssistantMessage, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { TodoItem } from '@deepseek-ai/dsh-tool-todo'
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
  assertResumeScopeUnchanged,
  resolveRoundModel,
  containerExecSpawn,
  containerScopedHome,
  delegationEnv,
  establishSubagentCatalogChild,
  persistChildSession,
  probeCliVersion,
  resolveChildCwd,
  subagentDelegationLabel,
} from '@khorsheed/dsh-local-agent'
import type { LocalAgentAppliedConfiguration, DelegationExecTarget, LocalAgentToolCalls } from '@khorsheed/dsh-local-agent/types'
import { MEMBER_BRIDGE_SOCKET_ENV, MEMBER_BRIDGE_TOKEN_ENV } from '@khorsheed/dsh-local-agent/types'
import { LiveChannelUnavailableError } from './live-driver.ts'
import type { ClaudeLiveDriver } from './live-driver.ts'
import { syncClaudeCredentialFile } from './records.ts'

// The host renamed its tool-call id brand between lines (`CallId` on the npm
// rc line, a new name on 0.1.2-alpha). A brand is compile-time-only and the
// runtime value is a plain string, so instead of importing either brand
// factory we extract the field types from the consuming APIs — the same
// source then compiles against both lines.
type ToolCallEventCallId = SessionEventMap['tool/call']['callId']
type ToolResultCallId = Parameters<typeof createToolResultMessage>[0]['callId']

/** Default POSIX grace between subprocess termination tiers. */
export const DEFAULT_DISPOSE_GRACE_MS = 3_000

/**
 * Auth-shaped failure signatures in claude's result error or stderr: the
 * endpoint rejected the credential (401/403, revoked token). Narrow on
 * purpose — matched against provider-controlled error strings only.
 */
export const CLAUDE_AUTH_FAILURE = /failed to authenticate|authentication_failed|oauth access token/i

/**
 * Member channel registration for one claude process lifetime: mint the
 * per-run token and build the bridge MCP declaration for the spawn argv
 * (`--mcp-config <json>` — verified end-to-end against the real CLI).
 * Nothing is written to the scoped home and there is nothing to prune at
 * settle; `release` only invalidates the token. Returns undefined when the
 * mounted core predates the member channel (declare-and-degrade). The exec
 * driver registers per round; the live driver registers per resident
 * process and releases on reclaim.
 */
export interface ClaudeMemberRunHandle {
  readonly token: string
  readonly mcpConfig: string
  readonly allowedTool: string
  release(): void
}

/** Register one member run with the channel; see {@link ClaudeMemberRunHandle}. */
export function registerClaudeMemberRun(
  ctx: Context,
  childSessionId: string,
  parentSessionId: string,
): ClaudeMemberRunHandle | undefined {
  const registry = ctx.localAgent
  if (
    typeof registry.registerMemberRun !== 'function'
    || typeof registry.memberBridgeSocketPath !== 'function'
    || typeof registry.memberBridgeCommand !== 'function'
  ) return undefined
  const token = registry.registerMemberRun({ childSessionId, parentSessionId, provider: 'claude-local' })
  const serverName = `dsh-member-${token.slice(0, 8)}`
  const bridge = registry.memberBridgeCommand()
  const mcpConfig = JSON.stringify({
    mcpServers: {
      [serverName]: {
        command: bridge.command,
        args: bridge.args,
        env: {
          [MEMBER_BRIDGE_SOCKET_ENV]: registry.memberBridgeSocketPath(),
          [MEMBER_BRIDGE_TOKEN_ENV]: token,
        },
      },
    },
  })
  let released = false
  return {
    token,
    mcpConfig,
    // The one tool the bridge exposes, pre-allowed so the child (whose
    // non-interactive mode auto-denies permission prompts) can call it.
    allowedTool: `mcp__${serverName}__member_message`,
    // Token-only auth: host 0.1.5 removed the child pid the parentage
    // cross-check used; the per-run token is the sole credential (see the
    // package README's threat model).
    release: () => {
      if (released) return
      released = true
      registry.unregisterMemberRun(token)
    },
  }
}

/**
 * One-shot and resumable Claude Code CLI subagent provider: every accepted
 * FRESH run starts a `claude -p` process in the delegating Session's
 * workspace, under the harness scoped home; a resume round (the family tool's
 * staged resume intent) continues the SAME session with `claude -p --resume
 * <session_id>` inside the SAME dsh child session. With the live driver
 * configured (`live: true`), rounds instead go to the resident stream-json
 * process (see live-driver.ts); the exec path below stays the fallback.
 */
/**
 * Mark the harness credential verified after a completed round, degrading
 * silently on a core that predates the mark (the family's companion-pair
 * rule: a provider paired with an older core loses the grade, never the run).
 * @param ctx - host context carrying the family registry.
 */
function markCredentialVerified(ctx: Context, scope?: string): void {
  const registry = ctx.get('localAgent')
  if (registry === undefined || typeof registry.reportAuthSuccess !== 'function') return
  // The grade belongs to the scope the round ran against: each scoped home
  // holds its own account.
  registry.reportAuthSuccess('claude-code', scope)
}

/**
 * The version `claude --version` reports, probed through the shared subprocess
 * seam against the SCOPED config directory (never the user's own
 * installation) and cached by the family probe against the executable's
 * identity. The effective-settings snapshot uses it; a settled round prefers
 * the version its own stream named.
 * @param ctx - host context carrying the subprocess seam.
 * @param homeDir - the harness's scoped home.
 * @returns the version, or undefined when the CLI cannot be asked.
 */
export function claudeCliVersion(ctx: Context, homeDir: string): Promise<string | undefined> {
  // Degrade, don't explode: a composition without the subprocess seam simply
  // reports no version, exactly as an unaskable CLI does.
  const subprocess = ctx.get('subprocess')
  if (subprocess === undefined) return Promise.resolve(undefined)
  return probeCliVersion({
    argv: ['claude', '--version'],
    cwd: homeDir,
    spawn: spec => subprocess.spawn(spec),
    env: delegationEnv({ CLAUDE_CONFIG_DIR: homeDir }),
  })
}

export class ClaudeCliProvider implements SubagentProvider {
  readonly name = 'claude-local'
  readonly capabilities: SubagentCapabilities = NO_START_CAPABILITIES
  readonly inheritsParentContext = false

  /**
   * @param live - the live driver, or a resolver returning the current
   *   generation's driver per member (the settings toggle swaps generations;
   *   a resolver may return undefined to steer one member's round to exec
   *   while a retiring generation still hosts it).
   * @param model - resolver for the member's effective model, read PER ROUND
   *   so a settings-card write or a composer switch takes effect on the next
   *   delegation without a reload. Receives the member (the child session id)
   *   and the round's delegation-layer model, and answers in the family's
   *   order — session-level override, delegation, settings. Absent (the
   *   resolver not passed), the delegation's own model still rides, exactly
   *   as before the key existed.
   */
  constructor(
    private readonly ctx: Context,
    private readonly permissionMode: 'skip' | 'normal' = 'skip',
    private readonly baseUrl?: string,
    private readonly live?: ClaudeLiveDriver | ((childSessionId: string) => ClaudeLiveDriver | undefined),
    private readonly model?: (childSessionId: string, delegationModel?: string) => string | undefined,
  ) {}

  /** Resolve the live driver for one round's member, if live is on for it. */
  private liveDriver(childSessionId: string): ClaudeLiveDriver | undefined {
    const live = this.live
    if (live === undefined) return undefined
    return typeof live === 'function' ? live(childSessionId) : live
  }

  /** The round's model fragment for the exec spawn spec (see {@link resolveRoundModel}). */
  private roundModel(childSessionId: string, requestedModel: string | undefined): { model?: string } {
    return resolveRoundModel(this.model === undefined ? requestedModel : this.model(childSessionId, requestedModel))
  }

  /** Per-round member-channel registration for the exec path (see {@link registerClaudeMemberRun}). */
  private memberRun(
    childSessionId: string,
    parentSessionId: string,
  ): ClaudeMemberRunHandle | undefined {
    return registerClaudeMemberRun(this.ctx, childSessionId, parentSessionId)
  }

  async start(request: ResolvedSubagentStartRequest): Promise<SubagentRun> {
    // The family tool stages exactly one intent per delegation call; the
    // provider consumes exactly one per start. A resume intent continues the
    // recorded session inside the existing child session.
    const intent = this.ctx.localAgent.takeDelegationIntent(request.parent.session.id, this.name)
    // The scoped home this round runs against: the staged intent's scope
    // names a sibling directory under the homes root, absent means the
    // default one — the directory every round used before scopes existed.
    // claude's keychain item is keyed by the config directory's path, so a
    // named scope gets its own credential item for free.
    const scope = intent?.scope
    const homeDir = this.ctx.localAgent.homeDir('claude-code', scope)
    // The effective cwd: the caller's override (the staged intent's `cwd`,
    // riding DelegationCallOptions.cwd) when present, else the parent
    // session's workspace — the behavior before overrides existed.
    const cwd = resolveChildCwd(request.parent.session.header.cwd, intent?.cwd)
    if (cwd === undefined) {
      throw new Error('subagent-claude: the parent session has no working directory to run the CLI in')
    }
    // Container exec target: the same round, spawned through `docker exec`
    // inside a unit the caller acquired. Validated here so a target missing
    // the in-container scoped home fails before any session record is made.
    // On Linux claude READS its credentials from the default home and only
    // WRITES the scoped dir (upstream #47661), so the caller normally points
    // CLAUDE_CONFIG_DIR at the same in-container path it bind-mounted the
    // host scoped home onto — one directory, read and write.
    const exec = intent?.exec
    if (exec !== undefined) containerScopedHome(exec, 'CLAUDE_CONFIG_DIR', 'subagent-claude')
    if (intent !== undefined && intent.kind === 'resume') {
      // A CLI session continues in the directory its first round ran in; a
      // round resolving elsewhere is rejected before any process spawns.
      const record = this.ctx.localAgent.getDelegation(intent.childSessionId)
      assertResumeCwdUnchanged(record, cwd, 'subagent-claude')
      // …and in the scoped home its first round ran in.
      assertResumeScopeUnchanged(record, scope, 'subagent-claude')
      // A resume re-requests the model the FIRST round recorded — the caller
      // cannot name one (the facade refuses it), and a record without one is
      // a delegation that named none, which this round repeats.
      if (typeof this.ctx.localAgent.withMemberConfigurationRound !== 'function') return this.startClaudeResume(request, intent, cwd, homeDir, exec, scope, record?.model)
      return this.ctx.localAgent.withMemberConfigurationRound({
        childSessionId: intent.childSessionId, provider: this.name, parentSessionId: request.parent.session.id, cwd,
        ...scope === undefined ? {} : { scope },
        ...record?.model === undefined ? {} : { model: record.model },
        ...record?.effort === undefined ? {} : { effort: record.effort },
        ...record?.configurationLock === undefined ? {} : { configurationLock: record.configurationLock },
      }, configuration => this.startClaudeResume(request, intent, cwd, homeDir, exec, scope, record?.model, configuration), request.signal, intent?.onAdmitted)
    }
    const childSessionId = SessionId(intent?.preparedMemberId ?? randomUUID())
    if (typeof this.ctx.localAgent.withMemberConfigurationRound !== 'function') {
      if (intent?.effort !== undefined) throw new Error('Claude effort requires the configuration admission core')
      return this.startClaudeFresh(request, cwd, homeDir, exec, scope, intent?.model, childSessionId)
    }
    return this.ctx.localAgent.withMemberConfigurationRound({
      childSessionId, provider: this.name, parentSessionId: request.parent.session.id, cwd,
      ...scope === undefined ? {} : { scope },
      ...intent?.model === undefined ? {} : { model: intent.model },
      ...intent?.effort === undefined ? {} : { effort: intent.effort },
      ...intent?.configurationLock === undefined ? {} : { configurationLock: intent.configurationLock },
    }, configuration => this.startClaudeFresh(request, cwd, homeDir, exec, scope, intent?.model, childSessionId, configuration), request.signal, intent?.onAdmitted)
  }

  /** Fresh round: record the child session, spawn `claude -p`, append after settle. */
  private async startClaudeFresh(
    request: ResolvedSubagentStartRequest,
    cwd: string,
    homeDir: string,
    exec: DelegationExecTarget | undefined,
    scope: string | undefined,
    /** The model this DELEGATION requested, when the caller named one. */
    requestedModel: string | undefined,
    runId: ReturnType<typeof SessionId>,
    configuration?: LocalAgentAppliedConfiguration,
  ): Promise<SubagentRun> {
    let childSession: Session | undefined
    try {
      const sessions = this.ctx.get('sessions')
      if (sessions === undefined) {
        throw new Error('the sessions service is not mounted')
      }
      childSession = sessions.get(runId) ?? sessions.create(runId, {
        meta: {
          cwd,
          parentSession: request.parent.session.id,
          origin: 'subagent',
          delegationDepth: (request.parent.session.header.delegationDepth ?? 0) + 1,
        },
      })
      const harness = this.ctx.localAgent.get('claude-code')
      const label = subagentDelegationLabel(harness?.displayName ?? 'Claude Code', request.descriptor.label)
      childSession.append('subagent/descriptor', {
        ...request.descriptor,
        label,
      })
      // The official runtime appends the parent-side subagent/catalog
      // discovery row only for in-process children (run.localAgent); this run
      // is remote, so the provider appends it here — once per child, where
      // the descriptor lands. A failure degrades to the warn below; a missing
      // row never blocks the delegation.
      establishSubagentCatalogChild(request.parent.session, childSession.header, label)
      // No persistence create here: the stored session is materialized by the
      // first persistChildSession sync through the CORE's cached write handle.
      // A fire-and-forget create from the provider used to hold (and leak) a
      // second write handle, which blocks the core's claim with
      // SessionAlreadyOwnedError.
    } catch (error) {
      this.ctx.logger.warn(`subagent-claude: subagent session record failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    // Resolve the effective endpoint once per run: the cordis Config field
    // wins, else the host environment's ANTHROPIC_BASE_URL (a STARTUP-time
    // snapshot — a long-running dsh process does not see later shell exports),
    // else the CLI's own default. Log it (without the key) so a failing
    // delegation reports which endpoint it actually used.
    const effectiveBaseUrl = this.baseUrl ?? process.env.ANTHROPIC_BASE_URL
    this.ctx.logger.info(`subagent-claude: delegating via ${effectiveBaseUrl ?? 'claude default endpoint'}`)
    // Live driver: the round goes to the member's resident stream-json
    // process. A channel that fails at spawn falls through to the exec
    // one-shot below — and stays there until the breaker cools down.
    // A container target always takes the exec one-shot: the live driver runs
    // a resident stream-json process on the HOST, which is the transport the
    // target exists to replace.
    const live = exec === undefined ? this.liveDriver(runId) : undefined
    if (live !== undefined && childSession !== undefined && !live.disabled) {
      // The member-bound live driver receives this exact scoped home.
      try {
        return await live.startRound(request, {
          cwd,
          homeDir,
          childSession,
          ...configuration === undefined ? {} : { configuration: configuration.resolved },
          parentSessionId: request.parent.session.id,
          // A fresh delegation naming a model is NOT exec-only: the model
          // binds as the member's start model at the runtime's spawn (a
          // runtime already bound to a different model is retired first, and
          // the same CLI session resumes on the respawn).
          ...requestedModel === undefined ? {} : { model: requestedModel },
          // The stream-json session id arrives with the turn's system/init
          // (server-assigned), far earlier than the exec path's settle parse.
          onSessionId: (sessionId) => {
            this.ctx.localAgent.recordDelegation({
              childSessionId: runId,
              provider: this.name,
              parentSessionId: request.parent.session.id,
              cliSessionId: sessionId,
              // The round's resolved working directory anchors the
              // resume-consistency check.
              cwd,
              // …and its scoped home anchors the resume-scope check.
              ...scope === undefined ? {} : { scope },
              // The model this delegation asked for: every resume round reads
              // it back from here instead of the caller restating it.
              ...requestedModel === undefined ? {} : { model: requestedModel },
            })
          },
        })
      } catch (error) {
        if (!(error instanceof LiveChannelUnavailableError) || request.signal.aborted) throw error
        this.ctx.logger.warn(`subagent-claude: live driver unavailable, using the exec one-shot: ${error.message}`)
      }
    }
    // Member channel: register this run and carry the bridge declaration on
    // the spawn argv, so the CLI session starts with member_message available.
    // The member bridge is a host unix socket the container cannot reach, and
    // its MCP declaration names a host node path — a containerized round
    // therefore runs WITHOUT the member channel rather than with a broken one.
    const member = exec === undefined ? this.memberRun(runId, request.parent.session.id) : undefined
    try {
      const run = await startClaudeCliRun(request, {
        cwd,
        env: delegationEnv({
          CLAUDE_CONFIG_DIR: homeDir,
          ...this.baseUrl === undefined ? {} : { ANTHROPIC_BASE_URL: this.baseUrl },
        }),
        ...exec === undefined ? {} : { exec },
        endpointLabel: effectiveBaseUrl,
        permissionMode: this.permissionMode,
        ...(configuration?.resolved ?? this.roundModel(runId, requestedModel)),
        ...configuration === undefined ? {} : { controlled: true },
        disposeGraceMs: DEFAULT_DISPOSE_GRACE_MS,
        spawn: spec => this.ctx.subprocess.spawn(spec),
        onError: (error: unknown, stopReason) => {
          this.ctx.logger.warn(`subagent-claude: child run failed (${stopReason}) via ${effectiveBaseUrl ?? 'claude default endpoint'}: ${error instanceof Error ? error.message : String(error)}`)
        },
        onAuthFailure: (detail) => { this.ctx.localAgent.reportAuthFailure('claude-code', detail, scope) },
        onAuthSuccess: () => { markCredentialVerified(this.ctx, scope) },
        cliVersion: () => claudeCliVersion(this.ctx, homeDir),
        ...member === undefined ? {} : { member: { mcpConfig: member.mcpConfig, allowedTool: member.allowedTool } },
        childSession,
        ctx: this.ctx,
        // The first round records the claude session id so a later resume round
        // can continue it.
        onSessionId: (sessionId) => {
          if (sessionId === undefined) return
          this.ctx.localAgent.recordDelegation({
            childSessionId: runId,
            provider: this.name,
            parentSessionId: request.parent.session.id,
            cliSessionId: sessionId,
            // The round's resolved working directory anchors the
            // resume-consistency check.
            cwd,
            // …and its scoped home anchors the resume-scope check.
            ...scope === undefined ? {} : { scope },
            // The model this delegation asked for (see the live branch).
            ...requestedModel === undefined ? {} : { model: requestedModel },
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

  /** Resume round: continue the recorded claude session inside the existing child session. */
  private async startClaudeResume(
    request: ResolvedSubagentStartRequest,
    intent: { readonly kind: 'resume'; readonly childSessionId: string; readonly cliSessionId: string },
    cwd: string,
    homeDir: string,
    exec: DelegationExecTarget | undefined,
    scope: string | undefined,
    /** The model the delegation's FIRST round recorded, re-requested here. */
    requestedModel: string | undefined,
    configuration?: LocalAgentAppliedConfiguration,
  ): Promise<SubagentRun> {
    // One in-flight resume per child session: a second resume of the same
    // child fails loud instead of racing the first process. The lock releases
    // on every settle path (the run.result handler below) and on the error
    // path, so a deadlock never strands a later resume.
    if (!this.ctx.localAgent.acquireResumeLock(intent.childSessionId)) {
      throw new Error(
        `subagent-claude: 该子会话有进行中的委派，等其完成后再追问 (child session ${intent.childSessionId})`,
      )
    }
    try {
      const sessions = this.ctx.get('sessions')
      const childSession = sessions?.get(SessionId(intent.childSessionId))
      if (childSession === undefined) {
        throw new Error(
          `subagent-claude: resume target child session ${intent.childSessionId} is not live — start a fresh delegation instead`,
        )
      }
      const nextTurn = childSession.snapshotEvents().filter(event => event.type === 'turn/start').length + 1
      // Live driver: continue the member's resident stream-json session.
      // Channel failure falls through to the exec one-shot below.
      // See the fresh path: a container target is exec-only.
      const live = exec === undefined ? this.liveDriver(intent.childSessionId) : undefined
      if (live !== undefined && !live.disabled) {
        // Resume retains the recorded scope and its native session.
        try {
          const liveRun = await live.startRound(request, {
            cwd,
            homeDir,
            childSession,
            ...configuration === undefined ? {} : { configuration: configuration.resolved },
            parentSessionId: request.parent.session.id,
            resume: { cliSessionId: intent.cliSessionId, turn: nextTurn },
            // The delegation's recorded model re-requests through the spawn
            // binding too (see the fresh path): a runtime bound to a
            // different model retires, and the session resumes on the respawn.
            ...requestedModel === undefined ? {} : { model: requestedModel },
          })
          void liveRun.result.then(
            () => { this.ctx.localAgent.releaseResumeLock(intent.childSessionId) },
            () => { this.ctx.localAgent.releaseResumeLock(intent.childSessionId) },
          )
          return liveRun
        } catch (error) {
          if (!(error instanceof LiveChannelUnavailableError) || request.signal.aborted) throw error
          this.ctx.logger.warn(`subagent-claude: live driver unavailable, using the exec one-shot: ${error.message}`)
        }
      }
      const effectiveBaseUrl = this.baseUrl ?? process.env.ANTHROPIC_BASE_URL
      this.ctx.logger.info(`subagent-claude: resuming via ${effectiveBaseUrl ?? 'claude default endpoint'}`)
      // Member channel: register the resume round (same child session, fresh
      // per-run token) before the spawn.
      // See the fresh path: no member channel across the container boundary.
      const member = exec === undefined ? this.memberRun(intent.childSessionId, request.parent.session.id) : undefined
      let run: SubagentRun
      try {
        run = await startClaudeCliRun(request, {
          cwd,
          env: delegationEnv({
            CLAUDE_CONFIG_DIR: homeDir,
            ...this.baseUrl === undefined ? {} : { ANTHROPIC_BASE_URL: this.baseUrl },
          }),
          ...exec === undefined ? {} : { exec },
          endpointLabel: effectiveBaseUrl,
          permissionMode: this.permissionMode,
          ...(configuration?.resolved ?? this.roundModel(intent.childSessionId, requestedModel)),
          ...configuration === undefined ? {} : { controlled: true },
          disposeGraceMs: DEFAULT_DISPOSE_GRACE_MS,
          spawn: spec => this.ctx.subprocess.spawn(spec),
          onError: (error: unknown, stopReason) => {
            this.ctx.logger.warn(`subagent-claude: child run failed (${stopReason}) via ${effectiveBaseUrl ?? 'claude default endpoint'}: ${error instanceof Error ? error.message : String(error)}`)
          },
            onAuthFailure: (detail) => { this.ctx.localAgent.reportAuthFailure('claude-code', detail, scope) },
          onAuthSuccess: () => { markCredentialVerified(this.ctx, scope) },
          cliVersion: () => claudeCliVersion(this.ctx, homeDir),
          ...member === undefined ? {} : { member: { mcpConfig: member.mcpConfig, allowedTool: member.allowedTool } },
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

/** Fully resolved inputs for one Claude CLI run. */
export interface ClaudeCliRunSpec {
  /** Parent Session workspace; also the claude process cwd. */
  readonly cwd: string
  /**
   * Explicit environment layered after the shared credential scrub; an
   * `undefined` value tombstones an inherited ambient entry, a string
   * restores or overrides it.
   */
  readonly env: Readonly<NodeJS.ProcessEnv>
  /**
   * Run the CLI inside this container instead of on the host: the argv below
   * is wrapped in `docker exec` and {@link env} is forwarded through NAME-only
   * `-e` flags. Absent means the host spawn, unchanged.
   */
  readonly exec?: DelegationExecTarget | undefined
  /** Resolved endpoint label for diagnostics; absent means the CLI default. */
  readonly endpointLabel?: string | undefined
  /** Permission mode passed to `claude -p`. */
  readonly permissionMode: 'skip' | 'normal'
  /**
   * Model this round runs with, passed as `claude -p --model <model>`. Absent
   * means no `--model` on the argv at all: the scoped `settings.json`'s own
   * `model` (or, with none, the CLI's built-in default) decides, exactly as
   * before the key existed.
   */
  readonly model?: string | undefined
  readonly effort?: string | undefined
  readonly controlled?: boolean
  /** Subprocess termination grace passed to the shared process-tree owner. */
  readonly disposeGraceMs: number
  /** Shared subprocess service spawn operation. */
  readonly spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle
  /** Diagnostic sink for a post-publication error flattened into a result. */
  readonly onError?: (error: Error, stopReason: SubagentStopReason) => void
  /**
   * Called when the settled failure is auth-shaped (the endpoint rejected the
   * credential — a 401/403 a presence probe cannot see). The provider wires
   * this to the family registry's auth-failure mark.
   */
  readonly onAuthFailure?: ((detail: string) => void) | undefined
  /**
   * Called when the round SETTLED COMPLETED — the CLI reached its endpoint and
   * produced an answer, which is the only evidence a host has that the scoped
   * credential is live. The provider wires this to the family registry's
   * auth-success mark (the `verified` credential grade).
   */
  readonly onAuthSuccess?: (() => void) | undefined
  /**
   * The version the executable reports, resolved lazily and cached by the
   * family probe. Only consulted when the round's own stream named none.
   */
  readonly cliVersion?: (() => Promise<string | undefined>) | undefined
  /**
   * Member channel: the bridge MCP declaration for this run, injected as
   * `--mcp-config <json>` plus a `--allowedTools` entry for the bridge's one
   * tool (claude `-p` auto-denies permission prompts). Absent on a core that
   * predates the member channel — the argv is then exactly the pre-channel
   * shape.
   */
  readonly member?: { readonly mcpConfig: string; readonly allowedTool: string } | undefined
  /** dsh subagent session recording this delegation; its response is appended after settle. */
  readonly childSession?: Session | undefined
  /** Host context carrying session persistence. */
  readonly ctx?: Context | undefined
  /**
   * Resume round: continue the session named by `cliSessionId` with
   * `claude -p --resume <session_id>` instead of a fresh `claude -p`,
   * appending this round into the same child session under the given turn.
   */
  readonly resume?: { readonly cliSessionId: string; readonly turn: number } | undefined
  /**
   * Called after the run settles with the claude session id parsed from the
   * result JSON (absent when none was reported). The fresh path uses it to
   * record the delegation so a later resume round can continue the session.
   */
  readonly onSessionId?: ((sessionId: string | undefined) => void) | undefined
  /**
   * Called once per settled round, after the output stream has been fully
   * parsed and mirrored: the round's observed model identifier and token
   * usage, each absent when the stream yielded none. The provider wires this
   * to the registry's observation channel (`recordRoundSettled` — the
   * delegation record's `observedModel` merge and the `settled` run-progress
   * event). Fires for fresh and resume rounds alike, on every terminal state.
   */
  readonly onRoundSettled?: ((round: {
    readonly observedModel?: string
    readonly usage?: TokenUsage
    readonly toolCalls?: LocalAgentToolCalls
  }) => void) | undefined
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
    throw new Error('subagent-claude: the one-shot task must contain only text blocks')
  }
  const texts: string[] = []
  for (const block of prompt) {
    if (block.type !== 'text') {
      throw new Error('subagent-claude: the one-shot task must contain only text blocks')
    }
    texts.push(block.text)
  }
  if (texts.every(text => text.trim().length === 0)) {
    throw new Error('subagent-claude: the one-shot task must not be empty')
  }
  return texts.join('\n')
}

/** One ordered transcript line from a `claude --output-format stream-json` stream. */
export type ClaudeTranscriptLine =
  | { kind: 'think'; text: string; streamId?: string }
  | { kind: 'text'; text: string; streamId?: string }
  /**
   * Tool activity: one `tool_use` with its (possibly still pending)
   * `tool_result`. `id` is the stream's tool_use id when present, else a
   * synthesized position-based id — stable within a run either way, so the
   * child session's `tool/call`/`tool/result` events pair by it.
   */
  | { kind: 'tool'; id: string; name: string; args?: string; result?: string }

/** Mutable fold state shared by the batch parse and the incremental parser. */
interface ClaudeStreamFoldState {
  readonly lines: ClaudeTranscriptLine[]
  /** tool_use id → transcript line index, so a result pairs with its own call. */
  readonly callsById: Map<string, number>
  text: string | undefined
  usage: TokenUsage | undefined
  sessionId: string | undefined
  /**
   * The model identifier the stream named: the `model` field on the
   * `system` init event (verified against claude 2.x stream-json) or on the
   * terminal `result` event. Absent when neither carries one.
   */
  model: string | undefined
  /**
   * The CLI's own version, from the `system` init event's
   * `claude_code_version` (claude 2.1.x puts its whole build-info object
   * there, so the `VERSION` field is read out of it; a plain string is
   * accepted too). Absent when the stream names none — the provider then
   * falls back to the family's `--version` probe.
   */
  cliVersion: string | undefined
  error: string | undefined
  /** Whether the stream's terminal `result` event was folded. */
  completed: boolean
  /**
   * The last TodoWrite translation (last-wins within the stream). TodoWrite
   * blocks are intercepted BEFORE the text fold — the member's task list
   * crosses as a native `todo/write` snapshot, never a `[工具 TodoWrite]` line.
   */
  todos: TodoItem[] | undefined
  /** A TodoWrite whose input missed the documented shape (degraded to the text fold). */
  todoSkew: boolean
  /**
   * Tool calls this stream made, keyed by the `tool_use` block's own `name` —
   * claude's vocabulary verbatim (`Bash`, `Read`, `TodoWrite`, an MCP tool's
   * full `mcp__server__tool`), never normalized across harnesses. Counted in
   * the branch that already folds the block, so no event is parsed twice.
   */
  readonly toolCalls: Map<string, number>
}

/**
 * Fold a tool-call counter into the settled shape: `{count, byName}` with the
 * per-name values summing to `count`. An empty map yields undefined — a
 * stream that named no tool call reports nothing rather than a zero it did
 * not observe.
 * @param counts - the fold's per-name tally.
 * @returns the settled accounting, or undefined when nothing was counted.
 */
export function toolCallsOf(counts: ReadonlyMap<string, number>): LocalAgentToolCalls | undefined {
  if (counts.size === 0) return undefined
  let count = 0
  const byName: Record<string, number> = {}
  for (const [name, value] of counts) {
    count += value
    byName[name] = value
  }
  return { count, byName }
}

/**
 * Translate one TodoWrite tool input into the dsh whole-list snapshot.
 * Claude's documented schema is `{todos: [{content, status, activeForm}]}`
 * with status `pending | in_progress | completed` — dsh's TodoItem vocabulary
 * minus `activeForm` (display-only). Unknown statuses map to `pending`; a
 * shape-skewed input returns undefined and the caller degrades to the plain
 * text fold — shape skew must never throw into the mirror.
 * @param input - the tool_use block's `input` payload.
 * @returns the dsh todo list, or undefined on shape skew.
 */
export function todosFromTodoWrite(input: unknown): TodoItem[] | undefined {
  if (typeof input !== 'object' || input === null) return undefined
  const todos = (input as { todos?: unknown }).todos
  if (!Array.isArray(todos)) return undefined
  const out: TodoItem[] = []
  for (const item of todos) {
    if (typeof item !== 'object' || item === null) return undefined
    const content = (item as { content?: unknown }).content
    if (typeof content !== 'string' || content.trim() === '') return undefined
    const status = (item as { status?: unknown }).status
    out.push({ content, status: status === 'in_progress' || status === 'completed' ? status : 'pending' })
  }
  return out
}

/**
 * Append the todo/write snapshot unless the child session's last snapshot is
 * identical — the M2 dsh mirror's JSON-comparison idempotency: repeated passes
 * over the same state never duplicate it. The comparison base is the whole
 * log, not the current round: a standing whole-list snapshot has no round
 * scope, so a resume round with an unchanged list re-appends nothing and the
 * earlier round's list keeps standing.
 * @param childSession - the parent-side dsh subagent session.
 * @param todos - the translated whole list.
 * @returns whether a snapshot was appended.
 */
function appendTodosIfChanged(childSession: Session, todos: TodoItem[]): boolean {
  const last = childSession.snapshotEvents().filter(event => event.type === 'todo/write').at(-1)
  if (last !== undefined && JSON.stringify(last.data) === JSON.stringify({ todos })) return false
  // todo/write's append takes no surface options (log-only UI state).
  childSession.append('todo/write', { todos })
  return true
}

/**
 * The CLI version named by a `system` init event's `claude_code_version`.
 * claude 2.1.x serializes its whole build-info module there
 * (`{ VERSION, BUILD_TIME, GIT_SHA, … }`), so the version is a field of it; a
 * future release that emits a bare string is accepted unchanged. Anything
 * else yields undefined and the probe answers instead.
 * @param value - the event's `claude_code_version` field.
 * @returns the version string, or undefined.
 */
export function claudeVersionFromInit(value: unknown): string | undefined {
  if (typeof value === 'string' && value !== '') return value
  if (typeof value !== 'object' || value === null) return undefined
  const version = (value as { VERSION?: unknown }).VERSION
  return typeof version === 'string' && version !== '' ? version : undefined
}

/**
 * Fold one NDJSON line into the stream state. Shared by
 * {@link parseClaudeStreamJson} (settle-time whole-stream parse) and
 * {@link ClaudeStreamParser} (live incremental parse) so the two paths cannot
 * drift.
 */
function foldClaudeStreamLine(state: ClaudeStreamFoldState, raw: string): void {
  const line = raw.trim()
  if (line === '') return
  let event: {
    type?: string
    model?: unknown
    message?: { content?: unknown[]; type?: string; id?: unknown }
    is_error?: unknown
    error?: unknown
    usage?: unknown
    session_id?: unknown
    result?: unknown
    claude_code_version?: unknown
  }
  try {
    event = JSON.parse(line) as typeof event
  } catch {
    return
  }
  if (event.type === 'system' && typeof event.session_id === 'string') {
    state.sessionId = event.session_id
    if (typeof event.model === 'string' && event.model !== '') state.model = event.model
    const version = claudeVersionFromInit(event.claude_code_version)
    if (version !== undefined) state.cliVersion = version
    return
  }
  if (event.type === 'result') {
    state.completed = true
    if (event.is_error === true) {
      // The detail text arrives in `result` on real auth failures (e.g. the
      // 401's "Failed to authenticate. API Error: ..."), in `error` on others.
      state.error = typeof event.result === 'string' ? event.result
        : typeof event.error === 'string' ? event.error
        : 'claude -p reported an error'
    }
    if (typeof event.session_id === 'string') state.sessionId = event.session_id
    if (typeof event.model === 'string' && event.model !== '') state.model = event.model
    if (event.usage !== undefined) state.usage = usageFromClaude(event.usage)
    return
  }
  if (event.type !== 'assistant' && event.type !== 'user') return
  const blocks = event.message?.content ?? []
  for (const [blockIndex, block] of blocks.entries()) {
    if (typeof block !== 'object' || block === null) continue
    const record = block as Record<string, unknown>
    const identity = event.type === 'assistant' && typeof event.message?.id === 'string'
      ? { streamId: `${event.message.id}:${blockIndex}` } : {}
    const kind = record['type']
    if (kind === 'text' && typeof record['text'] === 'string' && (record['text'] as string).trim() !== '') {
      state.lines.push({ kind: 'text', text: record['text'] as string, ...identity })
      // The final assistant text block is the run output.
      if (event.type === 'assistant') state.text = record['text'] as string
    } else if (kind === 'thinking' && typeof record['thinking'] === 'string' && (record['thinking'] as string).trim() !== '') {
      state.lines.push({ kind: 'think', text: record['thinking'] as string, ...identity })
    } else if (kind === 'redacted_thinking') {
      // The model reasoned, but the content is opaque by design (encrypted on
      // the server): a visible placeholder line says so instead of dropping
      // the block and misreporting the round as reasoning-free.
      state.lines.push({ kind: 'think', text: REDACTED_THINKING_TEXT, ...identity })
    } else if (kind === 'tool_use' || kind === 'server_tool_use') {
      const name = typeof record['name'] === 'string' ? record['name'] : 'tool'
      // Counted here, ahead of the TodoWrite intercept below: that intercept
      // diverts the block out of the transcript, but the CLI still called the
      // tool, and an accounting that skipped it would under-report the round.
      state.toolCalls.set(name, (state.toolCalls.get(name) ?? 0) + 1)
      if (name === 'TodoWrite') {
        const todos = todosFromTodoWrite(record['input'])
        if (todos !== undefined) {
          state.todos = todos
          continue // intercepted before the text fold
        }
        // Shape skew: degrade to the plain text fold; the mirror paths warn.
        state.todoSkew = true
      }
      const id = typeof record['id'] === 'string' ? record['id'] : undefined
      if (id !== undefined) state.callsById.set(id, state.lines.length)
      const edit = kind === 'tool_use' ? editToolDetail(name, record['input']) : undefined
      if (edit !== undefined) {
        // The apply-patch-style card (codex's fileChange idiom): the path as
        // the args, the actual edit — old/new strings or the file body — as
        // the card body. Without this an implementation round's edits were
        // reduced to a bare path.
        state.lines.push({
          kind: 'tool',
          id: id ?? `claude-tool-${state.lines.length}`,
          name: 'ApplyPatch',
          args: edit.args,
          ...edit.patch === undefined ? {} : { result: edit.patch },
        })
      } else {
        const detail = inputDetail(record['input'])
        state.lines.push({
          kind: 'tool',
          id: id ?? `claude-tool-${state.lines.length}`,
          // The server-side tools surface under the local tools' card names
          // (web_search is the same activity the local WebSearch tool runs).
          name: kind === 'server_tool_use' ? SERVER_TOOL_CARD_NAMES[name] ?? name : name,
          ...detail === undefined ? {} : { args: detail },
        })
      }
    } else if (kind === 'tool_result') {
      const resultText = toolResultText(record['content'])
      if (resultText !== undefined && resultText.trim() !== '') {
        attachToolResult(state, record['tool_use_id'], resultText, record['is_error'] === true)
      }
    } else if (kind === 'web_search_tool_result' || kind === 'web_fetch_tool_result') {
      // The result half of a server_tool_use: pairs to its call by id like a
      // local tool_result, so server-side web activity stays visible.
      const resultText = serverToolResultText(record)
      if (resultText !== undefined && resultText.trim() !== '') {
        attachToolResult(state, record['tool_use_id'], resultText, false)
      }
    }
  }
}

/**
 * Merge a tool result into its call line: pair by tool_use_id when the stream
 * carries it, else the most recent tool line so an id-less stream still lands
 * the result on its call. A line already carrying a body (an edit tool's
 * patch) keeps it — the status text adds nothing to a successful edit — but
 * an error result always appends, since a failed edit's message is the point.
 */
function attachToolResult(state: ClaudeStreamFoldState, useId: unknown, resultText: string, isError: boolean): void {
  let target = typeof useId !== 'string' ? undefined : state.callsById.get(useId)
  if (target === undefined) {
    for (let index = state.lines.length - 1; index >= 0; index -= 1) {
      if (state.lines[index]?.kind === 'tool') {
        target = index
        break
      }
    }
  }
  if (target === undefined) return
  const last = state.lines[target]
  if (last === undefined || last.kind !== 'tool') return
  if (last.result === undefined) {
    state.lines[target] = { ...last, result: resultText }
  } else if (isError) {
    state.lines[target] = { ...last, result: `${last.result}\n${resultText}` }
  }
}

/**
 * Incremental `claude --output-format stream-json` parser: feed stdout chunks
 * as they arrive and the folded transcript accumulates line by line. The last
 * line is volatile until the terminal `result` event — a `tool_result` merges
 * into a pending tool line — so live consumers hold it back (see the run's
 * live mirror).
 */
export class ClaudeStreamParser implements ClaudeStreamFoldState {
  private buffer = ''
  readonly lines: ClaudeTranscriptLine[] = []
  readonly callsById: Map<string, number> = new Map()
  text: string | undefined
  usage: TokenUsage | undefined
  sessionId: string | undefined
  model: string | undefined
  cliVersion: string | undefined
  error: string | undefined
  completed = false
  todos: TodoItem[] | undefined
  todoSkew = false
  readonly toolCalls = new Map<string, number>()

  /** Fold every complete NDJSON line in the chunk; the tail stays buffered. */
  push(chunk: string): void {
    this.buffer += chunk
    const parts = this.buffer.split('\n')
    this.buffer = parts.pop() ?? ''
    for (const raw of parts) foldClaudeStreamLine(this, raw)
  }
}

/**
 * Parse a `claude -p --verbose --output-format stream-json` NDJSON stream.
 * Each line is one event: `system` init (carries the session id and the
 * model), `assistant` (content blocks: `text`, `tool_use`, `thinking`), `user`
 * (a `tool_result` block), and a terminal `result` (final usage, error flag,
 * session id). Content blocks fold into an ordered transcript (thinking,
 * reply text, tool calls with results), the last assistant `text` becomes the
 * run output, and the `result` event's usage/session id ride the parse. The
 * model identifier comes from the init (or result) event's `model` field. A
 * malformed stream or an `is_error` result yields the error instead.
 * @param output - the collected stdout NDJSON text.
 * @returns the ordered transcript, final answer text, usage, session id, the
 *   observed model, and the error when the run reported one.
 */
export function parseClaudeStreamJson(output: string): {
  lines: readonly ClaudeTranscriptLine[]
  text?: string
  usage?: TokenUsage
  error?: string
  sessionId?: string
  model?: string
  /** The CLI version the stream's init event named, when it carried one. */
  cliVersion?: string
  /** The stream's last TodoWrite translation, when one was folded. */
  todos?: TodoItem[]
  /** Whether a shape-skewed TodoWrite degraded to the text fold. */
  todoSkew?: boolean
  /** The round's tool-call accounting, absent when the stream made none. */
  toolCalls?: LocalAgentToolCalls
} {
  const state: ClaudeStreamFoldState = {
    lines: [],
    callsById: new Map(),
    toolCalls: new Map(),
    text: undefined,
    usage: undefined,
    sessionId: undefined,
    model: undefined,
    cliVersion: undefined,
    error: undefined,
    completed: false,
    todos: undefined,
    todoSkew: false,
  }
  for (const raw of output.split('\n')) foldClaudeStreamLine(state, raw)
  const toolCalls = toolCallsOf(state.toolCalls)
  return {
    lines: state.lines,
    ...state.text === undefined ? {} : { text: state.text },
    ...state.usage === undefined ? {} : { usage: state.usage },
    ...state.error === undefined ? {} : { error: state.error },
    ...state.sessionId === undefined ? {} : { sessionId: state.sessionId },
    ...state.cliVersion === undefined ? {} : { cliVersion: state.cliVersion },
    ...state.model === undefined ? {} : { model: state.model },
    ...state.todos === undefined ? {} : { todos: state.todos },
    ...state.todoSkew === false ? {} : { todoSkew: true },
    ...toolCalls === undefined ? {} : { toolCalls },
  }
}

/** The placeholder think line for a `redacted_thinking` block (content is server-encrypted by design). */
export const REDACTED_THINKING_TEXT = '（思考内容已由服务端隐藏：redacted_thinking，内容按设计不可见，此行仅标示它存在）'

/** Server-side tool_use names map to the card names of their local-tool twins. */
const SERVER_TOOL_CARD_NAMES: Readonly<Record<string, string>> = {
  web_search: 'WebSearch',
  web_fetch: 'WebFetch',
}

/** Render a tool_use input payload as a compact command/query line. */
function inputDetail(input: unknown): string | undefined {
  if (input === undefined) return undefined
  if (typeof input === 'string') return input.trim() === '' ? undefined : input.trim()
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return undefined
  const record = input as Record<string, unknown>
  for (const key of ['command', 'query', 'url', 'path']) {
    const value = record[key]
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  }
  // No single scalar names the call: a compact JSON summary beats dropping
  // the input entirely (the pre-fallback behavior hid e.g. a Task prompt).
  const json = JSON.stringify(record)
  if (json === '{}') return undefined
  return json.length <= 160 ? json : `${json.slice(0, 160)}…`
}

/**
 * The actual edit behind an Edit/Write/MultiEdit/NotebookEdit tool_use, for
 * the apply-patch-style card (codex's fileChange idiom: `kind: path` args,
 * the patch as the body). Edit and MultiEdit synthesize `-`-/`+`-prefixed
 * old/new lines; Write and NotebookEdit carry the whole new body verbatim.
 * Undefined for any other tool or a shape-skewed input (the caller then
 * keeps the one-scalar summary).
 * @param name - the tool_use block's `name`.
 * @param input - the tool_use block's `input` payload.
 * @returns the card args and patch body, or undefined.
 */
function editToolDetail(name: string, input: unknown): { args: string; patch?: string } | undefined {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return undefined
  const record = input as Record<string, unknown>
  const pathOf = (key: string): string | undefined => {
    const value = record[key]
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
  }
  const hunk = (oldString: unknown, newString: unknown): string | undefined => {
    if (typeof oldString !== 'string' || typeof newString !== 'string') return undefined
    return [
      ...oldString.split('\n').map(line => `- ${line}`),
      ...newString.split('\n').map(line => `+ ${line}`),
    ].join('\n')
  }
  if (name === 'Edit') {
    const path = pathOf('file_path')
    if (path === undefined) return undefined
    const patch = hunk(record['old_string'], record['new_string'])
    return { args: `update: ${path}`, ...patch === undefined ? {} : { patch } }
  }
  if (name === 'MultiEdit') {
    const path = pathOf('file_path')
    if (path === undefined) return undefined
    const edits = Array.isArray(record['edits']) ? record['edits'] as Record<string, unknown>[] : []
    const patch = edits
      .map(edit => hunk(edit['old_string'], edit['new_string']))
      .filter((entry): entry is string => entry !== undefined)
      .join('\n\n')
    return { args: `update: ${path}`, ...patch === '' ? {} : { patch } }
  }
  if (name === 'Write') {
    const path = pathOf('file_path')
    if (path === undefined) return undefined
    const content = record['content']
    return {
      args: `update: ${path}`,
      ...typeof content === 'string' && content !== '' ? { patch: content } : {},
    }
  }
  if (name === 'NotebookEdit') {
    const path = pathOf('notebook_path')
    if (path === undefined) return undefined
    const source = record['new_source']
    return {
      args: `update: ${path}`,
      ...typeof source === 'string' && source !== '' ? { patch: source } : {},
    }
  }
  return undefined
}

/** Cap for a fetched page's text on a WebFetch card — the log stays a log. */
const WEB_FETCH_TEXT_LIMIT = 4_000

/**
 * Flatten a server-side web tool result block to card text. A search folds
 * its hits as `title — url` lines (an error block as `error: <code>`); a
 * fetch folds the page text capped at {@link WEB_FETCH_TEXT_LIMIT}. Undefined
 * when the block carries nothing readable — the pending call line then simply
 * stays result-less, never dropped.
 * @param record - the `web_search_tool_result` / `web_fetch_tool_result` block.
 * @returns the card text, or undefined.
 */
function serverToolResultText(record: Record<string, unknown>): string | undefined {
  const content = record['content']
  if (Array.isArray(content)) {
    // web_search_tool_result: a hit list, or one error block.
    const lines = content.map((item): string | undefined => {
      if (typeof item !== 'object' || item === null) return undefined
      const entry = item as Record<string, unknown>
      if (entry['type'] === 'web_search_tool_result_error') {
        return `error: ${typeof entry['error_code'] === 'string' ? entry['error_code'] : 'unknown'}`
      }
      if (entry['type'] === 'web_search_result') {
        const title = typeof entry['title'] === 'string' ? entry['title'] : ''
        const url = typeof entry['url'] === 'string' ? entry['url'] : ''
        if (title === '' && url === '') return undefined
        return title === '' ? url : `${title} — ${url}`
      }
      return undefined
    }).filter((line): line is string => line !== undefined)
    return lines.length === 0 ? undefined : lines.join('\n')
  }
  if (typeof content === 'object' && content !== null) {
    // web_fetch_tool_result: one result object, or one error object.
    const entry = content as Record<string, unknown>
    if (entry['type'] === 'web_fetch_tool_result_error') {
      return `error: ${typeof entry['error_code'] === 'string' ? entry['error_code'] : 'unknown'}`
    }
    const url = typeof entry['url'] === 'string' ? entry['url'] : undefined
    const body = typeof entry['content'] === 'string' ? entry['content'] : undefined
    const text = body === undefined
      ? undefined
      : body.length <= WEB_FETCH_TEXT_LIMIT ? body : `${body.slice(0, WEB_FETCH_TEXT_LIMIT)}\n…`
    return [url, text].filter((part): part is string => part !== undefined && part !== '').join('\n') || undefined
  }
  return undefined
}

/** Flatten a tool_result content payload (string or block array) to text. */
function toolResultText(content: unknown): string | undefined {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return undefined
  return content
    .filter((block): block is { type?: string; text?: string } =>
      typeof block === 'object' && block !== null && (block as { type?: string }).type === 'text'
      && typeof (block as { text?: string }).text === 'string')
    .map(block => block.text ?? '')
    .join('\n')
}

/**
 * Map claude's usage payload onto the shared usage contract. Claude's
 * `input_tokens` is the uncached input; cache reads and cache creation are
 * reported separately, so each maps to its own bucket with no subtraction.
 * @param usage - the raw claude usage object.
 * @returns the shared usage record.
 */
function usageFromClaude(usage: unknown): TokenUsage {
  const raw = usage as {
    input_tokens?: unknown
    output_tokens?: unknown
    cache_read_input_tokens?: unknown
    cache_creation_input_tokens?: unknown
  } | undefined
  if (raw === undefined || typeof raw !== 'object') return { inputTokens: 0, outputTokens: 0 }
  const num = (value: unknown): number | undefined => {
    const n = Number(value)
    return Number.isFinite(n) ? n : undefined
  }
  const input = num(raw.input_tokens)
  const output = num(raw.output_tokens)
  const cacheRead = num(raw.cache_read_input_tokens)
  const cacheWrite = num(raw.cache_creation_input_tokens)
  const usageRecord: TokenUsage = {
    inputTokens: input ?? 0,
    outputTokens: output ?? 0,
  }
  if (cacheRead !== undefined && cacheRead > 0) usageRecord.cacheReadTokens = cacheRead
  if (cacheWrite !== undefined && cacheWrite > 0) usageRecord.cacheWriteTokens = cacheWrite
  return usageRecord
}

/**
 * Start the real `claude -p` child and publish its run. The claude
 * result arrives as an NDJSON event stream on stdout (`--verbose
 * --output-format stream-json`): assistant content blocks (text, tool_use,
 * thinking), user tool_result blocks, and a terminal result event carrying
 * usage and session id. stderr is piped for diagnostics and never folded
 * into the run output. A resume round spawns `claude -p --resume
 * <session_id>` instead, continuing the same session. The run id is the
 * child session id for a session-backed run.
 * @param request - resolved shared subagent request.
 * @param spec - workspace, environment, process service, and diagnostic policy.
 * @returns the published run after the child starts.
 */
export async function startClaudeCliRun(
  request: SubagentStartRequest,
  spec: ClaudeCliRunSpec,
): Promise<SubagentRun> {
  const task = textTask(request.prompt)
  if (request.signal.aborted) {
    throw new Error('subagent-claude: request was aborted before the CLI started')
  }
  // Credential reconcile before EVERY spawn: claude 2.1.236 reads
  // .credentials.json at runtime while login/refresh write the keychain, so
  // the login watch's sync alone leaves a rotated grant stale at spawn time
  // (the live driver's spawnRuntime does the same). Best-effort: a missing
  // grant fails the run with the CLI's own auth error, not here.
  // NOTE the directory: on a container round this is still the HOST scoped
  // home (the in-container path only replaces it in the `docker exec -e`
  // forwarding), and the unit is about to read that same file through the
  // bind mount — which is why the reconcile is newer-wins rather than a
  // mirror. See `syncClaudeCredentialFile`.
  const configDir = spec.env['CLAUDE_CONFIG_DIR']
  if (configDir !== undefined) {
    await syncClaudeCredentialFile(configDir, message => { spec.ctx?.logger.warn(message) }).catch(() => false)
  }
  const turn = spec.resume?.turn ?? 1
  // The member bridge flags ride every argv variant (skip and normal
  // permission modes alike): --allowedTools is redundant under
  // --dangerously-skip-permissions but keeps the injection uniform.
  const memberArgv = spec.member === undefined
    ? []
    // `--allowedTools` is variadic and greedily consumes following argv
    // entries — without the `--` separator it swallows the task itself and
    // the CLI exits 1 with "Input must be provided … as a prompt argument".
    : ['--mcp-config', spec.member.mcpConfig, '--allowedTools', spec.member.allowedTool, '--']
  // The configured model rides `--model`, which claude accepts on every one of
  // the four argv variants below. It goes BEFORE the member flags because
  // `--allowedTools` is variadic and its `--` terminator closes the flag
  // section. Nothing configured appends nothing: each variant is then
  // byte-for-byte the shape that shipped before the key existed.
  const modelArgv = spec.model === undefined ? [] : ['--model', spec.model]
  // --verbose is required by the CLI when --print and stream-json combine.
  const argv = spec.resume === undefined
    ? spec.permissionMode === 'skip'
      ? ['claude', '-p', '--dangerously-skip-permissions', '--verbose', ...modelArgv, '--output-format', 'stream-json', ...memberArgv, task]
      : ['claude', '-p', '--verbose', ...modelArgv, '--output-format', 'stream-json', ...memberArgv, task]
    : spec.permissionMode === 'skip'
      ? ['claude', '-p', '--dangerously-skip-permissions', '--verbose', ...modelArgv, '--resume', spec.resume.cliSessionId, '--output-format', 'stream-json', ...memberArgv, task]
      : ['claude', '-p', '--verbose', ...modelArgv, '--resume', spec.resume.cliSessionId, '--output-format', 'stream-json', ...memberArgv, task]

  // Container target: the same argv, wrapped in `docker exec`. The host cwd
  // still applies — it is the docker CLIENT's working directory now, while
  // the CLI's own is the target's in-container workdir.
  const env = spec.controlled ? { ...spec.env, CLAUDE_CODE_EFFORT_LEVEL: spec.effort ?? 'auto' } : spec.env
  const launch = spec.exec === undefined
    ? { argv, env }
    : containerExecSpawn(spec.exec, { argv, env }, 'subagent-claude')

  const child = spec.spawn({
    argv: launch.argv,
    cwd: spec.cwd,
    stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
    graceMs: spec.disposeGraceMs,
    env: launch.env,
  })
  // The turn opens at the real spawn moment so the timing projection
  // measures actual CLI runtime, not the post-hoc append time.
  spec.childSession?.append('turn/start', { turn })
  // Live mirror: fold the stream-json as chunks arrive so the child session
  // shows the run's progress before settle; the settle mirror below resumes
  // from the live counters and stays a no-op when live mirroring kept up.
  const liveMirror = spec.childSession !== undefined && spec.ctx !== undefined
    ? createClaudeLiveMirror(spec, task, turn)
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
    // Host 0.1.5 hides the child pid (the managed range owns termination):
    // terminate() is an idempotent no-op once the range is gone, so a failed
    // spawn needs no guard; done rejects there, which dispose must swallow.
    child.terminate()
    await child.waitForExit().catch(() => false)
    await child.done.catch(() => {})
  }

  const runAbort = new AbortController()
  const requestCancel = (): void => {
    if (runAbort.signal.aborted) return
    runAbort.abort(new Error('subagent-claude: run cancelled locally'))
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
    runAbort.signal.addEventListener('abort', () => reject(new Error('subagent-claude: run cancelled locally')), { once: true })
  })

  const processFailure: Promise<never> = child.done.then(
    outcome => Promise.reject(new Error(
      'subagent-claude: CLI exited before the run settled '
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
    const text = parseClaudeStreamJson(drained !== undefined && drained !== '' ? drained : output).text?.trim()
    return text === undefined || text === '' ? [] : [{ type: 'text', text }]
  }

  let exitCode: number | null = null

  const result: Promise<SubagentResult> = settleRunResult({
    attempt: () => Promise.race([
      child.done.then((outcome) => {
        if (outcome.exitCode !== 0) {
          const via = spec.endpointLabel ?? 'claude default endpoint'
          exitCode = outcome.exitCode
          throw new Error(`subagent-claude: claude -p exited with code ${String(outcome.exitCode)} via ${via}`)
        }
        // A zero exit with no parsed answer is a silent failure, not a
        // success: the stream-json yielded no reply text. Throwing here
        // settles 'error' through the seam instead of reporting an empty
        // 'completed' (which the upstream settleRunResult does not re-check).
        // The abort path is untouched: it settles 'aborted' through
        // abortBranch before this branch is ever reached.
        const output = collectOutput()
        if (output.length === 0) {
          throw new Error('subagent-claude: claude -p exited 0 but produced no answer')
        }
        return { output, stopReason: 'completed' as const }
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
    // A completed round proves the scoped credential is live — the endpoint
    // answered. Reported here rather than from the mirror so it lands whether
    // or not the round is session-backed.
    if (settled.stopReason === 'completed') spec.onAuthSuccess?.()
    // Every terminal path closes the turn so the timing window never stays
    // open on a failed or cancelled run. The turn/end timestamp is the real
    // settle moment; an in-stream error result or a non-zero exit settles
    // 'error', a locally cancelled run 'aborted'.
    if (spec.childSession !== undefined) {
      if (settled.stopReason === 'completed') {
        spec.childSession.append('turn/end', { turn, reason: { kind: 'completed' } })
      } else if (settled.stopReason === 'aborted') {
        spec.childSession.append('turn/end', { turn, reason: { kind: 'aborted', reason: { kind: 'parent' } } })
      } else {
        const parsed = parseClaudeStreamJson(output)
        spec.childSession.append('turn/end', {
          turn,
          reason: {
            kind: 'error',
            error: {
              message: parsed.error ?? `claude -p exited with code ${String(exitCode)}`,
              code: 'UNKNOWN',
            },
          },
        })
      }
    }
    return settled
  })

  // After the child EXITS — however it ended (completed, killed by dispose, or
  // crashed) — mirror whatever the stream-json already produced into the dsh
  // subagent session, so a cancelled round still preserves its partial work
  // (thinking, tool calls with results, replies) and real token usage. The
  // session id is recorded even on abort so the partial session stays
  // resumable. Waits for the settle chain first (so turn/end is already
  // appended) AND for the process to actually exit (so stdout is drained).
  void result.then(() => child.done).then(
    () => {
      // Auth detection runs post-exit: streams are drained by then, so a fast
      // failure's output is complete (a settle-time read could race the flush).
      if (spec.onAuthFailure !== undefined) {
        // The seam's collected buffers are complete at process exit; the
        // streamed variables can lag `done` by a tick.
        const drainedStderr = child.collected.stderr?.readFrom(0).text || stderr
        const drainedStdout = child.collected.stdout?.readFrom(0).text || output
        const authDetail = `${parseClaudeStreamJson(drainedStdout).error ?? ''}\n${drainedStderr}`
        if (CLAUDE_AUTH_FAILURE.test(authDetail)) {
          spec.onAuthFailure(authDetail.split('\n').find(line => line.trim() !== '') ?? 'auth failure')
        }
      }
      return mirrorClaudeAfterExit(spec, task, turn, output, liveMirror)
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

/** One assistant-role message event, attributed to the claude route. */
export function assistantEvent(blocks: readonly ContentBlock[]) {
  return createAssistantMessage({
    content: blocks as ContentBlock[],
    source: { provider: 'claude-local', model: 'claude' },
  })
}

/**
 * Fold one transcript line into the child session as one assistant step,
 * wrapped in the step/start–step/end boundary pair the live conversation
 * assembler requires: without a boundary the step never enters the location
 * index, the line's assistant message resolves to a turn-level location, and
 * the real-time view renders nothing (only a full rebuild, which mints step
 * drafts from the explicit coordinates, recovers it). Tool cards escape that
 * fate only because their definition does not consult the step location.
 */
export function appendClaudeTranscriptLine(
  childSession: Session,
  turn: number,
  step: number,
  line: ClaudeTranscriptLine,
  usage: TokenUsage | undefined,
): void {
  childSession.append('step/start', { turn, step })
  if (line.kind === 'tool') {
    // Native tool card: the call event now, the result event when the stream
    // already carries it. Tool lines never carry the round's usage — the
    // callers attach usage to the round's last non-tool line.
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
    childSession.append('step/end', { turn, step })
    return
  }
  const blocks = line.kind === 'think'
    ? [{ type: 'reasoning' as const, text: line.text }]
    : [{ type: 'text' as const, text: line.text }]
  childSession.append('assistant/message', {
    turn,
    step,
    message: assistantEvent(blocks),
    stream: [],
    ...usage === undefined ? {} : { usage },
  }, { surfaceOp: 'append' })
  childSession.append('step/end', { turn, step })
}

/**
 * Fold one transcript line into the run's child session as one assistant step.
 */
function appendClaudeLine(
  spec: ClaudeCliRunSpec,
  turn: number,
  step: number,
  line: ClaudeTranscriptLine,
  usage: TokenUsage | undefined,
): void {
  if (spec.childSession === undefined) return
  appendClaudeTranscriptLine(spec.childSession, turn, step, line, usage)
}

/** The delta-progress text for one transcript line. */
export function claudeLineText(line: ClaudeTranscriptLine): string {
  return line.kind === 'tool'
    ? `[工具 ${line.name}]${line.args !== undefined ? ` ${line.args}` : ''}${line.result !== undefined ? ` → ${line.result}` : ''}`
    : line.text
}

/**
 * Per-run live mirror: folds stdout chunks incrementally and mirrors newly
 * completed transcript lines into the child session as they arrive, so a
 * caller watching the child session sees progress instead of silence until
 * settle. The LAST line is held back until the stream's terminal `result`
 * event: it may still merge a trailing `tool_result`, and it is the round's
 * usage carrier (the settle fold attaches usage to the final line — same
 * placement here). The counters are the settle path's offset: the final
 * mirror resumes from them and is a no-op when live mirroring kept up.
 * Failures are diagnostic-only and never kill the run.
 */
interface ClaudeLiveMirror {
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
function createClaudeLiveMirror(spec: ClaudeCliRunSpec, task: string, turn: number): ClaudeLiveMirror {
  const parser = new ClaudeStreamParser()
  const childSession = spec.childSession as Session
  const ctx = spec.ctx as Context
  let mirrored = 0
  let userMirrored = false
  let lastTodos: TodoItem[] | undefined
  let todoSkewWarned = false
  let queue: Promise<void> = Promise.resolve()

  const mirror: ClaudeLiveMirror = {
    get mirroredLines() { return mirrored },
    get userMirrored() { return userMirrored },
    enqueue(task) {
      queue = queue.then(task)
      return queue
    },
    push(chunk) {
      parser.push(chunk)
      // TodoWrite translations cross immediately — they are not text lines, so
      // the mirrored/upto accounting does not see them. Reference-change is the
      // per-push trigger; content identity vs the child log is
      // appendTodosIfChanged's job (repeat passes over the same state do not
      // duplicate the snapshot).
      if (parser.todos !== undefined && parser.todos !== lastTodos) {
        lastTodos = parser.todos
        appendTodosIfChanged(childSession, parser.todos)
      }
      if (parser.todoSkew && !todoSkewWarned) {
        todoSkewWarned = true
        ctx.logger.warn('subagent-claude: a TodoWrite call missed the documented input shape; folded as a plain tool line')
      }
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
          // earlier flush (before the usage was knowable), the accounting is
          // lost — host 0.1.5 has no usage-backfill event.
          let carrier = -1
          if (parser.completed && parser.usage !== undefined) {
            for (let scan = 0; scan < parser.lines.length; scan += 1) {
              if (parser.lines[scan]?.kind !== 'tool') carrier = scan
            }
          }
          for (let index = mirrored; index < upto; index += 1) {
            const line = parser.lines[index]
            if (line === undefined) continue
            const usage = index === carrier ? parser.usage : undefined
            appendClaudeLine(spec, turn, index + 1, line, usage)
            mirrored = index + 1
            localAgent?.reportRunProgress(childSession.id, { kind: 'delta', text: claudeLineText(line) })
          }
          await persistChildSession(ctx, childSession)
          localAgent?.reportRunProgress(childSession.id, { kind: 'mirror', mirroredLines: mirrored })
        } catch (error: unknown) {
          ctx.logger.warn(`subagent-claude: live mirror failed: ${thrown(error).message}`)
        }
      })
    },
  }
  return mirror
}

/**
 * Mirror the delegation's user prompt and the claude stream transcript into
 * the dsh subagent session, then persist. Runs detached from the settle race —
 * the run result settles with the child exit, and a failure here is
 * diagnostic-only. The transcript's thinking folds to `reasoning` blocks,
 * reply text and tool activity (call with command plus result) to text
 * blocks, and the final assistant message carries the round's usage when
 * claude reported it, so the tokenUsage projection counts the delegation.
 * @param spec - the run spec carrying the child session and host context.
 * @param task - the one-shot task text (the user prompt).
 * @param turn - the round's turn number (1 for a fresh round, incremented on resume).
 * @param parsed - the parsed stream transcript, final output, and usage.
 * @param fromLines - transcript lines the live mirror already appended.
 * @param userMirrored - whether the live mirror already appended the prompt.
 */
async function appendClaudeResponse(
  spec: ClaudeCliRunSpec,
  task: string,
  turn: number,
  parsed: { lines: readonly ClaudeTranscriptLine[]; output: ContentBlock[]; usage?: TokenUsage },
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
  // mid-tool ends the transcript with a tool line.
  let usageIndex = -1
  for (let index = 0; index < parsed.lines.length; index += 1) {
    if (parsed.lines[index]?.kind !== 'tool') usageIndex = index
  }
  let step = fromLines + 1
  for (const line of parsed.lines.slice(fromLines)) {
    appendClaudeLine(spec, turn, step, line, step - 1 === usageIndex ? parsed.usage : undefined)
    localAgent?.reportRunProgress(childSession.id, { kind: 'delta', text: claudeLineText(line) })
    step += 1
  }
  if (parsed.usage !== undefined && usageIndex !== -1 && usageIndex < fromLines) {
    // The carrier line went out through the live mirror before the usage was
    // knowable. Host 0.1.5 has no usage-backfill event (the per-chunk event is
    // gone and appended messages are immutable), so the round's accounting is
    // lost in this race — log it instead of dropping it silently.
    spec.ctx.logger.warn(`subagent-claude: round ${turn} usage arrived after its carrier line was mirrored; the accounting is dropped`)
  }
  await persistChildSession(spec.ctx, childSession)
  localAgent?.reportRunProgress(childSession.id, { kind: 'mirror', mirroredLines: parsed.lines.length })
}

/**
 * Persist the child session's mirrored events. Thin wrapper over the core's
 * {@link persistChildSession}: a live session syncs through the core's cached
 * per-child write handle (host 0.1.5's live write-behind never checkpoints a
 * mirror session — it has no agent loop — so production child logs stayed
 * header-only until the explicit sync), a standalone one through a one-shot
 * handle flow. Kept under the historical name for the live driver. Root cause
 * and fix identical to codex's codex-cli-provider.ts persistIfStandalone.
 */
export async function persistIfStandalone(ctx: Context, childSession: Session): Promise<void> {
  await persistChildSession(ctx, childSession)
}

/**
 * Mirror the claude stream-json into the child session AFTER the CLI process
 * has exited, whatever its stop reason. A cancelled or failed round still
 * preserves the events the stream already emitted (thinking, tool calls with
 * results, replies, usage) instead of leaving the child blank — the run result
 * settles 'aborted'/'error' at the cancel moment, but claude may have produced
 * content before the kill landed. Also records the session id (fresh rounds)
 * so a later resume can continue the partial session.
 * @param spec - the run spec carrying the child session and host context.
 * @param task - the one-shot task text (the user prompt).
 * @param turn - the round's turn number.
 * @param output - the collected stream-json stdout.
 */
async function mirrorClaudeAfterExit(
  spec: ClaudeCliRunSpec,
  task: string,
  turn: number,
  output: string,
  live: ClaudeLiveMirror | undefined,
): Promise<void> {
  if (spec.childSession === undefined || spec.ctx === undefined) return
  const childSession = spec.childSession
  const work = async (): Promise<void> => {
    const parsed = parseClaudeStreamJson(output)
    if (spec.resume === undefined) spec.onSessionId?.(parsed.sessionId)
    // TodoWrite translations that only the final transcript carries still
    // cross; idempotency vs the live mirror's appends is appendTodosIfChanged's.
    if (parsed.todoSkew === true) {
      spec.ctx?.logger.warn('subagent-claude: a TodoWrite call missed the documented input shape; folded as a plain tool line')
    }
    if (parsed.todos !== undefined) appendTodosIfChanged(childSession, parsed.todos)
    const fromLines = live?.mirroredLines ?? 0
    const userMirrored = live?.userMirrored ?? false
    // The round's settled observation rides out even when nothing streamed:
    // an empty stream is still a settled round. The model and the CLI version
    // both come from the stream's own init/result events — claude names both
    // on the wire, so nothing else is consulted unless the stream was
    // truncated before its init event; then the `--version` probe answers.
    const cliVersion = parsed.cliVersion ?? await spec.cliVersion?.()
    spec.onRoundSettled?.({
      ...parsed.model === undefined ? {} : { observedModel: parsed.model },
      ...cliVersion === undefined ? {} : { cliVersion },
      ...parsed.usage === undefined ? {} : { usage: parsed.usage },
      ...parsed.toolCalls === undefined ? {} : { toolCalls: parsed.toolCalls },
    })
    // Nothing streamed at all (e.g. the CLI died before the first event):
    // keep the pre-live-mirror behavior of recording nothing. A todos-only
    // stream still mirrors its snapshot (handled above).
    if (parsed.lines.length === 0 && !userMirrored) return
    const trimmed = parsed.text?.trim()
    await appendClaudeResponse(spec, task, turn, {
      lines: parsed.lines,
      output: trimmed === undefined || trimmed === '' ? [] : [{ type: 'text', text: trimmed }],
      ...parsed.usage === undefined ? {} : { usage: parsed.usage },
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
