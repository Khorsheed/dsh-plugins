/**
 * One-shot and resumable dsh CLI subagent lifecycle: spawn the sub-dsh
 * headless profile (`dsh --profile <name> --session-id <uuid> "<task>"` or
 * `--resume <uuid>`) through the subprocess seam with the harness scoped home
 * as the child's `$DSH_HOME` and the parent's resolved DeepSeek key injected
 * explicitly (the shared env scrub drops credential-shaped names and every
 * `DSH_*` fact; the explicit env layer is the sanctioned override). The
 * caller-supplied session id is the same uuid on every round: the fresh round
 * creates the sub-dsh session with it, and each resume round continues exactly
 * that session. No stdout parsing — the sub-dsh session id is known a priori.
 * @module @khorsheed/dsh-local-agent-dsh/dsh-cli-provider
 */

import { randomUUID } from 'node:crypto'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
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
import type { Session } from '@deepseek-ai/dsh-session'
import type { SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import {
  assertResumeCwdUnchanged,
  assertResumeScopeUnchanged,
  resolveRoundModel,
  containerExecSpawn,
  containerScopedHome,
  delegationEnv,
  establishSubagentCatalogChild,
  probeCliVersion,
  resolveChildCwd,
  subagentDelegationLabel,
} from '@khorsheed/dsh-local-agent'
import type { DelegationExecTarget, LocalAgentAppliedConfiguration } from '@khorsheed/dsh-local-agent/types'
import { MEMBER_BRIDGE_SOCKET_ENV, MEMBER_BRIDGE_TOKEN_ENV } from '@khorsheed/dsh-local-agent/types'
import type { LocalAgentDshConfig } from './index.ts'
import { LiveChannelUnavailableError } from './live-driver.ts'
import type { DshLiveDriver } from './live-driver.ts'
import { DEFAULT_SUB_PROFILE_NAME, provisionDshSubProfile } from './provision.ts'
import { mirrorDshSession } from './session-mirror.ts'

/**
 * Spawn-env name carrying the bridge entry path into the sub-dsh process,
 * where the headless bundle's mcp-client row reads it (`!!js`). The name is a
 * family-internal contract between this provider and
 * `@khorsheed/dsh-local-agent-dsh-headless`'s cordis.patch.yml — the member
 * bridge itself reads only the socket/token env.
 */
export const MEMBER_BRIDGE_ENTRY_ENV = 'DSH_MEMBER_BRIDGE_ENTRY'

/**
 * The `NODE_OPTIONS` a containerized round carries. dsh's HTTP client is
 * node's `fetch` (undici), which does NOT read `HTTP(S)_PROXY` by default: in
 * an evaluation unit whose only egress is a whitelist proxy the CLI dials the
 * API directly and fails with a transport error while the proxy never even
 * receives a `CONNECT`. `--use-env-proxy` opens undici's `EnvHttpProxyAgent`,
 * which does read those variables. Measured on the T16 image: without it the
 * round fails, with it the same round answers in 1.3 s. dsh is the only one
 * of the four CLIs that needs an extra knob to run inside a unit — the other
 * three carry their own proxy support — so the injection is automatic rather
 * than something every caller must remember, and the harness reports it in
 * its effective settings so the condition file can see it.
 */
export const CONTAINER_NODE_OPTIONS = '--use-env-proxy'

/** Default POSIX grace between subprocess termination tiers. */
export const DEFAULT_DISPOSE_GRACE_MS = 3_000

/** Default interval between live session-mirror polls during a run. */
export const DEFAULT_LIVE_MIRROR_INTERVAL_MS = 2_000


/**
 * Member channel registration for one sub-dsh process lifetime: mint the
 * per-run token and prepare the env the sub-dsh's mcp-client row reads (the
 * headless bundle patch declares the bridge server with `!!js` env lookups;
 * `@deepseek-ai/dsh-mcp-client` resolves from the installation's dependency
 * closure linked into the scoped home's profiles/node_modules fallback).
 * Returns undefined when the mounted core predates the member channel
 * (declare-and-degrade: the run proceeds unchanged — the row's
 * failOnStartupError is off, and the bridge itself fails closed on the absent
 * token). Token-only auth: host 0.1.5 removed the child pid the parentage
 * cross-check used; the per-run token is the sole credential (see the package
 * README's threat model). The exec driver registers per round; the live driver
 * registers per resident process and releases on reclaim.
 */
export interface MemberRunHandle {
  readonly env: Readonly<NodeJS.ProcessEnv>
  release(): void
}

/** Register one member run with the channel; see {@link MemberRunHandle}. */
export function registerMemberRun(
  ctx: Context,
  providerName: string,
  childSessionId: string,
  parentSessionId: string,
): MemberRunHandle | undefined {
  const registry = ctx.localAgent
  if (
    typeof registry.registerMemberRun !== 'function'
    || typeof registry.memberBridgeSocketPath !== 'function'
    || typeof registry.memberBridgeCommand !== 'function'
  ) return undefined
  const token = registry.registerMemberRun({ childSessionId, parentSessionId, provider: providerName })
  const bridge = registry.memberBridgeCommand()
  let released = false
  return {
    env: {
      [MEMBER_BRIDGE_SOCKET_ENV]: registry.memberBridgeSocketPath(),
      [MEMBER_BRIDGE_TOKEN_ENV]: token,
      [MEMBER_BRIDGE_ENTRY_ENV]: bridge.args[0] ?? '',
    },
    release: () => {
      if (released) return
      released = true
      registry.unregisterMemberRun(token)
    },
  }
}

/**
 * One-shot dsh CLI subagent provider: every accepted fresh run starts a fresh
 * sub-dsh headless process in the delegating Session's workspace, under the
 * harness scoped home; a resume round (the family tool's staged resume intent)
 * continues the SAME sub-dsh session with `--resume <uuid>` inside the SAME
 * dsh child session. Mirrors the other family providers' one-shot lifecycle,
 * including `NO_START_CAPABILITIES` — continuation is the family's own resume
 * mechanism, not the official Agent-type continuable seam. With the live
 * driver configured (`live: true`), rounds instead go to the resident sub-dsh
 * serve process (see live-driver.ts); the exec path below stays the fallback.
 */
export class DshCliProvider implements SubagentProvider {
  readonly name = 'dsh-cli'
  readonly capabilities: SubagentCapabilities = NO_START_CAPABILITIES
  readonly inheritsParentContext = false

  /**
   * @param live - the live driver, or a resolver returning the current
   *   generation's driver per member (the settings toggle swaps generations;
   *   a resolver may return undefined to steer one member's round to exec
   *   while a retiring generation still hosts it).
   */
  /**
   * @param model - resolver for the harness's `model` plugin-config key, read
   *   PER ROUND so a settings-card write reaches the next delegation without a
   *   reload. A delegation that names its own model outranks it.
   * @param overrides - resolver for the member's session-level model override
   *   (the composer picker, owned by the model broker). It outranks BOTH the
   *   delegation's recorded model and the configured one: on the exec path it
   *   re-points the next round's `--model`, and on the live path it is the
   *   member's start model — a resident runtime bound to a different model is
   *   retired so the round respawns onto the override.
   */
  constructor(
    private readonly ctx: Context,
    private readonly config: LocalAgentDshConfig,
    private readonly live?: DshLiveDriver | ((childSessionId: string) => DshLiveDriver | undefined),
    private readonly model?: () => string | undefined,
    private readonly overrides?: (childSessionId: string) => string | undefined,
  ) {}

  /** Resolve the live driver for one round's member, if live is on for it. */
  private liveDriver(childSessionId: string): DshLiveDriver | undefined {
    const live = this.live
    if (live === undefined) return undefined
    return typeof live === 'function' ? live(childSessionId) : live
  }

  /** Per-round member-channel registration for the exec path (see {@link registerMemberRun}). */
  private memberRun(
    childSessionId: string,
    parentSessionId: string,
  ): MemberRunHandle | undefined {
    return registerMemberRun(this.ctx, this.name, childSessionId, parentSessionId)
  }

  async start(request: ResolvedSubagentStartRequest): Promise<SubagentRun> {
    // The family tool stages exactly one intent per delegation call; the
    // provider consumes exactly one per start. A resume intent continues the
    // recorded sub-dsh session inside the existing child session.
    const intent = this.ctx.localAgent.takeDelegationIntent(request.parent.session.id, this.name)
    // The scoped home this round runs against: the staged intent's scope
    // names a sibling directory under the homes root (with its own sub-
    // profile), absent means the default one — the directory every round
    // used before scopes existed.
    const scope = intent?.scope
    const homeDir = this.ctx.localAgent.homeDir('dsh', scope)
    // The effective cwd: the caller's override (the staged intent's `cwd`,
    // riding DelegationCallOptions.cwd) when present, else the parent
    // session's workspace — the behavior before overrides existed.
    const cwd = resolveChildCwd(request.parent.session.header.cwd, intent?.cwd)
    if (cwd === undefined) {
      throw new Error('subagent-dsh: the parent session has no working directory to run the CLI in')
    }
    // Container exec target: the same round, spawned through `docker exec`
    // inside a unit the caller acquired. Validated here so a target missing
    // the in-container scoped home fails before any session record is made.
    const exec = intent?.exec
    if (exec !== undefined) containerScopedHome(exec, 'DSH_HOME', 'subagent-dsh')
    if (intent !== undefined && intent.kind === 'resume') {
      // A CLI session continues in the directory its first round ran in; a
      // round resolving elsewhere is rejected before any process spawns.
      const record = this.ctx.localAgent.getDelegation(intent.childSessionId)
      assertResumeCwdUnchanged(record, cwd, 'subagent-dsh')
      // …and in the scoped home its first round ran in.
      assertResumeScopeUnchanged(record, scope, 'subagent-dsh')
      // A resume re-requests the model the FIRST round recorded — the caller
      // cannot name one (the facade refuses it), and a record without one is
      // a delegation that named none, which this round repeats.
      if (typeof this.ctx.localAgent.withMemberConfigurationRound !== 'function') return this.startDshResume(request, intent, cwd, homeDir, exec, scope, record?.model)
      return this.ctx.localAgent.withMemberConfigurationRound({
        childSessionId: intent.childSessionId, provider: this.name, parentSessionId: request.parent.session.id, cwd,
        ...scope === undefined ? {} : { scope },
        ...record?.model === undefined ? {} : { model: record.model },
        ...record?.effort === undefined ? {} : { effort: record.effort },
        ...record?.configurationLock === undefined ? {} : { configurationLock: record.configurationLock },
      }, configuration => this.startDshResume(request, intent, cwd, homeDir, exec, scope, record?.model, configuration))
    }
    const childSessionId = SessionId(intent?.preparedMemberId ?? randomUUID())
    if (typeof this.ctx.localAgent.withMemberConfigurationRound !== 'function') {
      if (intent?.effort !== undefined) throw new Error('DSH effort requires the configuration admission core')
      return this.startDshFresh(request, cwd, homeDir, exec, scope, intent?.model, childSessionId)
    }
    return this.ctx.localAgent.withMemberConfigurationRound({
      childSessionId, provider: this.name, parentSessionId: request.parent.session.id, cwd,
      ...scope === undefined ? {} : { scope },
      ...intent?.model === undefined ? {} : { model: intent.model },
      ...intent?.effort === undefined ? {} : { effort: intent.effort },
      ...intent?.configurationLock === undefined ? {} : { configurationLock: intent.configurationLock },
    }, configuration => this.startDshFresh(request, cwd, homeDir, exec, scope, intent?.model, childSessionId, configuration))
  }

  /** Fresh round: record the child session and delegation, spawn the sub-dsh create. */
  private async startDshFresh(
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
      // Strict global read, never the caller-scope `ctx.sessions` proxy: the
      // bundle does not inject `sessions`, and the proxy would throw on access.
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
      // The durable one-shot descriptor the runtime resolved marks this child
      // as session-backed; without it the 子代理 projection cannot classify
      // the session and the delegation stays invisible. The label carries the
      // harness display name as the source marker so the dropdown shows which
      // local agent produced the conversation.
      const harness = this.ctx.localAgent.get('dsh')
      const label = subagentDelegationLabel(harness?.displayName ?? 'dsh', request.descriptor.label)
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
      this.ctx.logger.warn(`subagent-dsh: subagent session record failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    // The sub-dsh session id IS the child session id: the parent provider
    // generates one uuid and the sub-dsh creates its session with exactly it,
    // so the delegation record is known before the process spawns and a later
    // resume round continues the same sub-dsh session by the same handle.
    this.ctx.localAgent.recordDelegation({
      childSessionId: runId,
      provider: this.name,
      parentSessionId: request.parent.session.id,
      cliSessionId: runId,
      // The round's resolved working directory anchors the
      // resume-consistency check.
      cwd,
      // …and its scoped home anchors the resume-scope check.
      ...scope === undefined ? {} : { scope },
      // The model this delegation asked for: every resume round reads it back
      // from here instead of the caller restating it.
      ...requestedModel === undefined ? {} : { model: requestedModel },
    })
    // Live driver: the round goes to the resident serve process (one per
    // member). A channel that fails at spawn/handshake marks itself broken and
    // falls through to the exec one-shot below — and stays there
    // (driver.disabled) for later rounds. The resolver may gate this member to
    // exec while a retiring generation still hosts its runtime.
    // A container target always takes the exec one-shot: the live driver runs
    // a resident serve process on the HOST, which is the transport the target
    // exists to replace.
    const live = exec === undefined ? this.liveDriver(runId) : undefined
    if (live !== undefined && childSession !== undefined && !live.disabled) {
      // The member-bound live driver receives this exact scoped home.
      // A round that names its own model is NOT refused: it becomes the
      // member's start model, bound at the serve spawn (`--model`; a runtime
      // bound to a different model is retired first, so the fresh session
      // spawns onto the asked-for model). The session-level override outranks
      // even this.
      const startModel = configuration === undefined ? this.overrides?.(runId) ?? requestedModel : configuration.resolved.model
      try {
        return await live.startRound(request, {
          cwd,
          homeDir,
          childSession,
          sessionId: runId,
          parentSessionId: request.parent.session.id,
          ...startModel === undefined ? {} : { startModel },
          ...configuration === undefined ? {} : { configuration: configuration.resolved },
        })
      } catch (error) {
        if (!(error instanceof LiveChannelUnavailableError) || request.signal.aborted) throw error
        this.ctx.logger.warn(`subagent-dsh: live driver unavailable, using the exec one-shot: ${error.message}`)
      }
    }
    // Member channel: register this run and hand the bridge coordinates to
    // the sub-dsh through the spawn env, so its session starts with
    // member_message available.
    // The member bridge is a host unix socket the container cannot reach, and
    // the bridge entry it names is a host node path — a containerized round
    // therefore runs WITHOUT the member channel rather than with a broken one.
    const member = exec === undefined ? this.memberRun(runId, request.parent.session.id) : undefined
    try {
      const run = await startDshCliRun(request, {
        cwd,
        homeDir,
        childSession,
        sessionId: runId,
        ...(configuration?.resolved ?? resolveRoundModel(this.overrides?.(runId) ?? requestedModel, this.model)),
        resume: undefined,
        config: this.config,
        ctx: this.ctx,
        ...member === undefined ? {} : { memberEnv: member.env },
        ...exec === undefined ? {} : { exec },
        cliVersion: () => dshCliVersion(this.ctx, this.config, homeDir),
        ...scope === undefined ? {} : { scope },
      })
      // The member-channel token dies with the run, whatever its stop reason.
      if (member !== undefined) void run.result.then(member.release, member.release)
      return run
    } catch (error) {
      member?.release()
      throw error
    }
  }

  /** Resume round: continue the recorded sub-dsh session inside the existing child session. */
  private async startDshResume(
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
        `subagent-dsh: 该子会话有进行中的委派，等其完成后再追问 (child session ${intent.childSessionId})`,
      )
    }
    try {
      const sessions = this.ctx.get('sessions')
      const childSession = sessions?.get(SessionId(intent.childSessionId))
      if (childSession === undefined) {
        throw new Error(
          `subagent-dsh: resume target child session ${intent.childSessionId} is not live — start a fresh delegation instead`,
        )
      }
      // The next turn follows the rounds already recorded in the child session.
      const nextTurn = childSession.snapshotEvents().filter(event => event.type === 'turn/start').length + 1
      // Live driver: continue the member's resident serve process. Channel
      // spawn/handshake failure falls through to the exec one-shot below.
      // See the fresh path: a container target is exec-only.
      const live = exec === undefined ? this.liveDriver(intent.childSessionId) : undefined
      if (live !== undefined && !live.disabled) {
        // Resume retains the recorded scope and its native session.
        // The resume re-requests its recorded model as the member's start
        // model (the session-level override outranks it): a runtime bound to
        // a different model is retired so the session respawns onto this one.
        const startModel = configuration === undefined ? this.overrides?.(intent.childSessionId) ?? requestedModel : configuration.resolved.model
        try {
          const liveRun = await live.startRound(request, {
            cwd,
            homeDir,
            childSession,
            sessionId: intent.cliSessionId,
            parentSessionId: request.parent.session.id,
            resume: { turn: nextTurn },
            ...startModel === undefined ? {} : { startModel },
            ...configuration === undefined ? {} : { configuration: configuration.resolved },
          })
          void liveRun.result.then(
            () => { this.ctx.localAgent.releaseResumeLock(intent.childSessionId) },
            () => { this.ctx.localAgent.releaseResumeLock(intent.childSessionId) },
          )
          return liveRun
        } catch (error) {
          if (!(error instanceof LiveChannelUnavailableError) || request.signal.aborted) throw error
          this.ctx.logger.warn(`subagent-dsh: live driver unavailable, using the exec one-shot: ${error.message}`)
        }
      }
      // Member channel: register the resume round (same child session, fresh
      // per-run token) before the spawn.
      // See the fresh path: no member channel across the container boundary.
      const member = exec === undefined ? this.memberRun(intent.childSessionId, request.parent.session.id) : undefined
      try {
        const run = await startDshCliRun(request, {
          cwd,
          homeDir,
          childSession,
          sessionId: intent.cliSessionId,
          ...(configuration?.resolved ?? resolveRoundModel(this.overrides?.(intent.childSessionId) ?? requestedModel, this.model)),
          resume: { cliSessionId: intent.cliSessionId, turn: nextTurn },
          config: this.config,
          ctx: this.ctx,
          ...member === undefined ? {} : { memberEnv: member.env },
          ...exec === undefined ? {} : { exec },
            cliVersion: () => dshCliVersion(this.ctx, this.config, homeDir),
          ...scope === undefined ? {} : { scope },
        })
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
        member?.release()
        throw error
      }
    } catch (error) {
      this.ctx.localAgent.releaseResumeLock(intent.childSessionId)
      throw error
    }
  }
}

/** Fully resolved inputs for one sub-dsh CLI run. */
export interface DshCliRunSpec {
  /** Parent Session workspace; also the sub-dsh process cwd. */
  readonly cwd: string
  /** The `dsh` harness's scoped home, injected as the child's `$DSH_HOME`. */
  readonly homeDir: string
  /**
   * The named scope {@link DshCliRunSpec.homeDir} belongs to, when the round
   * runs against one. Absent means the default scope. Carried so a completed
   * round grades the credential of the scope it actually used.
   */
  readonly scope?: string | undefined
  /** dsh subagent session recording this delegation. */
  readonly childSession?: Session | undefined
  /**
   * The sub-dsh session id for this round — the caller-supplied uuid, passed
   * as `--session-id` on a fresh round and `--resume` on a continuation.
   */
  readonly sessionId: string
  /**
   * The model this round runs, spelled `provider/model` — passed to the
   * sub-dsh as `--model`, which overrides the instance's default selection
   * for that launch. Absent means no flag at all: the sub-dsh runs the
   * instance's default, exactly as it did before the flag existed.
   */
  readonly model?: string | undefined
  readonly effort?: string | undefined
  /**
   * Resume round: continue the sub-dsh session named by `sessionId` with
   * `--resume` instead of a fresh `--session-id`, appending this round into
   * the same child session under the given turn number.
   */
  readonly resume?: { readonly cliSessionId: string; readonly turn: number } | undefined
  /**
   * Live-mirror poll interval during the run; absent applies the default
   * ({@link DEFAULT_LIVE_MIRROR_INTERVAL_MS}). Tests inject a small value.
   */
  readonly liveMirrorIntervalMs?: number | undefined
  /**
   * Member channel: the per-run bridge coordinates (socket path, token,
   * bridge entry) merged into the explicit env layer — the sub-dsh's
   * mcp-client row reads them via `!!js` env lookups.
   */
  readonly memberEnv?: Readonly<NodeJS.ProcessEnv> | undefined
  /**
   * Run the sub-dsh inside this container instead of on the host: the argv
   * below is wrapped in `docker exec` and the explicit env layer is forwarded
   * through NAME-only `-e` flags (the resolved API key therefore never
   * reaches the host process table). Absent means the host spawn, unchanged.
   */
  readonly exec?: DelegationExecTarget | undefined
  /**
   * The dsh build the round runs, resolved lazily and cached by the family
   * probe. The sub-dsh session log names its model but never its build, so
   * this is the only version channel the round's read-back has.
   */
  readonly cliVersion?: (() => Promise<string | undefined>) | undefined
}

/** Validate and join the one-shot task before crossing the process boundary. */
export function dshTextTask(prompt: readonly ContentBlock[]): string {
  if (prompt.length === 0) {
    throw new Error('subagent-dsh: the one-shot task must contain only text blocks')
  }
  const texts: string[] = []
  for (const block of prompt) {
    if (block.type !== 'text') {
      throw new Error('subagent-dsh: the one-shot task must contain only text blocks')
    }
    texts.push(block.text)
  }
  if (texts.every(text => text.trim().length === 0)) {
    throw new Error('subagent-dsh: the one-shot task must not be empty')
  }
  return texts.join('\n')
}

function thrown(value: unknown): Error {
  /* v8 ignore next -- typed subprocess failures reject with Error. */
  return value instanceof Error ? value : new Error(String(value))
}

/**
 * The dsh launch argv the provider replicates: the parent instance's own
 * node + tsx import + entry point, so the sub-dsh runs the same dsh build as
 * its parent. A configured `cliLaunch` replaces this entirely.
 * @param config - plugin config carrying the optional override.
 * @returns the launch prefix before the profile flag.
 */
export function dshLaunchArgv(config: LocalAgentDshConfig): readonly string[] {
  // An empty array is a degenerate override (an absent schema field resolves
  // to [] without an explicit default); treat it as no override.
  if (config.cliLaunch !== undefined && config.cliLaunch.length > 0) return config.cliLaunch
  return [process.execPath, ...process.execArgv, process.argv[1] ?? 'dsh']
}

/**
 * Mark the harness credential verified after a completed round, degrading
 * silently on a core that predates the mark (the family's companion-pair
 * rule: a provider paired with an older core loses the grade, never the run).
 * @param ctx - host context carrying the family registry.
 */
function markCredentialVerified(ctx: Context, scope?: string): void {
  const registry = ctx.get('localAgent')
  if (registry === undefined || typeof registry.reportAuthSuccess !== 'function') return
  // The grade belongs to the scope the round ran against.
  registry.reportAuthSuccess('dsh', scope)
}

/**
 * The dsh build the sub-dsh runs, probed by asking the very launch argv the
 * delegation would spawn for its `--version` (the sub-dsh replicates the
 * parent instance's own node + entry point, so the parent's build IS the
 * child's). Cached by the family probe against that entry script's identity,
 * so a harness upgrade re-probes and an unchanged one never spawns twice.
 * @param ctx - host context carrying the subprocess seam.
 * @param config - plugin config carrying the optional launch override.
 * @param homeDir - the harness's scoped home.
 * @returns the version, or undefined when the launch cannot be asked.
 */
export function dshCliVersion(ctx: Context, config: LocalAgentDshConfig, homeDir: string): Promise<string | undefined> {
  // Degrade, don't explode: a composition without the subprocess seam simply
  // reports no version, exactly as an unaskable CLI does.
  const subprocess = ctx.get('subprocess')
  if (subprocess === undefined) return Promise.resolve(undefined)
  return probeCliVersion({
    argv: [...dshLaunchArgv(config), '--version'],
    cwd: homeDir,
    spawn: spec => subprocess.spawn(spec),
    env: delegationEnv({ DSH_HOME: homeDir }),
  })
}

/**
 * Start the real sub-dsh headless child and publish its run. The final answer
 * is printed to stdout; stderr is inherited for diagnostics. The run id is
 * the child session id for a session-backed run, so the tool's
 * `resume="<id>"` self-description names the same handle the registry
 * records.
 * @param request - resolved shared subagent request.
 * @param spec - workspace, scoped home, child session, and resume facts.
 * @returns the published run after the child starts.
 */
export async function startDshCliRun(
  request: SubagentStartRequest,
  spec: DshCliRunSpec & { config: LocalAgentDshConfig; ctx: Context },
): Promise<SubagentRun> {
  const { config, ctx } = spec
  const task = dshTextTask(request.prompt)
  if (request.signal.aborted) {
    throw new Error('subagent-dsh: request was aborted before the CLI started')
  }
  const profileName = config.profileName ?? DEFAULT_SUB_PROFILE_NAME
  // Provisioning is idempotent and cheap; re-running heals a deleted or
  // drifted sub-profile before every round. A CONTAINER round skips it: the
  // sub-profile's node_modules symlink points at the host installation of the
  // headless bundle, which resolves to nothing inside a unit — and the scoped
  // home is bind-mounted, so writing it would plant a broken profile in the
  // directory the unit actually reads. A containerized caller names the
  // unit's own profile through `profileName` (the image's in-box `headless`)
  // and its own entry through `cliLaunch`.
  if (spec.exec === undefined) provisionDshSubProfile(spec.homeDir, config)
  // Resolve the sub-dsh credential BEFORE spawning: the key travels in the
  // explicit env layer, which is the only way past the shared env scrub.
  const apiKey = await resolveApiKey(ctx, config)
  const turn = spec.resume?.turn ?? 1
  // The turn opens at the real spawn moment so the timing projection
  // measures actual CLI runtime.
  spec.childSession?.append('turn/start', { turn })

  // The default launch replicates THIS process (node + argv[1]), which only
  // exists on the host. A container target therefore expects the caller to
  // have pinned `cliLaunch` to the unit's own entry (`['dsh']` on the T16
  // image) — the existing config knob, not a new field on the exec target.
  const launch = dshLaunchArgv(config)
  // The model rides `--model`, after the session flag on both variants: it is
  // orthogonal to which session runs, and the sub-dsh's parser takes it in
  // either mode. Nothing configured appends nothing — the argv is then
  // byte-for-byte the shape that shipped before the flag existed.
  const modelArgv = [...spec.model === undefined ? [] : ['--model', spec.model], ...spec.effort === undefined ? [] : ['--effort', spec.effort]]
  const argv = spec.resume === undefined
    ? [...launch, '--profile', profileName, '--session-id', spec.sessionId, ...modelArgv, task]
    : [...launch, '--profile', profileName, '--resume', spec.sessionId, ...modelArgv, task]
  // The explicit env layer merges AFTER the shared credential scrub, so
  // both the credential-shaped key and the DSH_* fact survive into the
  // child — without DSH_HOME the sub-dsh would default to ~/.dsh and write
  // sessions into the parent instance's store.
  const env = delegationEnv({
    DSH_HOME: spec.homeDir,
    DEEPSEEK_API_KEY: apiKey,
    // The launch replicates the parent's tsx ESM hook (dshLaunchArgv), so
    // the hook's tsconfig path is a hard launch dependency: without it tsx
    // compiles the harness source with default options and the child dies
    // at import time ('FiberState' export mismatch). Pass it explicitly —
    // the delegation env allowlist tombstones it otherwise. A container
    // round runs the unit's own dsh, so the host hook path is not only
    // useless there, it would put a host directory layout inside the unit.
    ...spec.exec !== undefined || process.env.TSX_TSCONFIG_PATH === undefined
      ? {}
      : { TSX_TSCONFIG_PATH: process.env.TSX_TSCONFIG_PATH },
    // Container round: open undici's env proxy agent, without which the
    // sub-dsh dials the API directly and never reaches the unit's whitelist
    // proxy (see CONTAINER_NODE_OPTIONS). A caller that named NODE_OPTIONS
    // on the target keeps its own value — this is a default, not an override.
    ...spec.exec === undefined || spec.exec.env?.['NODE_OPTIONS'] !== undefined
      ? {}
      : { NODE_OPTIONS: CONTAINER_NODE_OPTIONS },
    // Member channel coordinates ride the same explicit layer (DSH_* names
    // are scrubbed from the ambient env; this layer is the sanctioned
    // override).
    ...spec.memberEnv,
  })
  // Container target: the same argv, wrapped in `docker exec`. The host cwd
  // still applies — it is the docker CLIENT's working directory now, while
  // the sub-dsh's own is the target's in-container workdir.
  const spawnSpec: SubprocessSpawnSpec = {
    ...spec.exec === undefined ? { argv, env } : containerExecSpawn(spec.exec, { argv, env }, 'subagent-dsh'),
    cwd: spec.cwd,
    stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
    graceMs: DEFAULT_DISPOSE_GRACE_MS,
  }
  const child = ctx.subprocess.spawn(spawnSpec)
  let output = ''
  child.stdout?.on('data', (chunk: Buffer) => { output += chunk.toString() })
  let stderr = ''
  child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString() })

  // Live session mirroring: poll the sub-dsh session log while the run is in
  // flight and mirror new events through the SAME mirrorDshSession path the
  // settle mirror uses (its already-mirrored prefix skip makes the settle
  // pass a no-op when polling kept up). A poll failure never kills the run:
  // mirrorDshSession degrades to a warn internally and the settle mirror
  // remains the fallback. All mirror passes serialize through mirrorQueue.
  let mirrorQueue: Promise<unknown> = Promise.resolve()
  const enqueueMirror = (task: () => Promise<unknown>): void => {
    mirrorQueue = mirrorQueue.then(task)
  }
  const mirrorAndReport = async (childSession: Session, alwaysReport: boolean): Promise<void> => {
    const delta = await mirrorDshSession(ctx, childSession, spec.homeDir, spec.sessionId)
    const localAgent = ctx.get('localAgent')
    if (localAgent === undefined) return
    if (delta.texts.length === 0 && !alwaysReport) return
    for (const text of delta.texts) {
      localAgent.reportRunProgress(childSession.id, { kind: 'delta', text })
    }
    localAgent.reportRunProgress(childSession.id, { kind: 'mirror', mirroredLines: delta.total })
    if (alwaysReport) {
      // The settle pass also reports the round's settled observation — the
      // sub-dsh session's own model attribution, the dsh build the round ran,
      // and the round's token usage — through the registry's observation
      // channel: the delegation record's merge plus the `settled` event. The
      // sub-dsh replicates the parent's own launch, so its build is what that
      // launch answers to `--version`.
      const cliVersion = await spec.cliVersion?.()
      localAgent.recordRoundSettled(childSession.id, {
        ...delta.observedModel === undefined ? {} : { observedModel: delta.observedModel },
        ...cliVersion === undefined ? {} : { cliVersion },
        ...delta.usage === undefined ? {} : { usage: delta.usage },
        ...delta.toolCalls === undefined ? {} : { toolCalls: delta.toolCalls },
      })
    }
  }
  if (spec.childSession !== undefined) {
    const childSession = spec.childSession
    const liveMirror = setInterval(() => {
      enqueueMirror(() => mirrorAndReport(childSession, false))
    }, spec.liveMirrorIntervalMs ?? DEFAULT_LIVE_MIRROR_INTERVAL_MS)
    liveMirror.unref()
    // Polling stops when the process exits; the settle mirror (enqueued below)
    // runs the final pass afterwards through the same queue.
    void child.done.then(
      () => { clearInterval(liveMirror) },
      () => { clearInterval(liveMirror) },
    )
  }

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
    runAbort.abort(new Error('subagent-dsh: run cancelled locally'))
  }
  const onAbort = (): void => { requestCancel() }
  request.signal.addEventListener('abort', onAbort, { once: true })

  // Abort branch: the moment the run is cancelled locally, the attempt settles
  // immediately — settleRunResult observes `cancelled()` and resolves the
  // result with 'aborted' WITHOUT waiting for the child to exit. The actual
  // process kill is dispose's job (SIGTERM → grace → SIGKILL teardown ladder),
  // per the subprocessRunHandle contract: requestCancel settles the result,
  // teardown reaps the process.
  const abortBranch = new Promise<never>((_, reject) => {
    runAbort.signal.addEventListener('abort', () => reject(new Error('subagent-dsh: run cancelled locally')), { once: true })
  })

  const processFailure: Promise<never> = child.done.then(
    outcome => Promise.reject(new Error(
      'subagent-dsh: CLI exited before the run settled '
      + `(code ${String(outcome.exitCode)}, signal ${String(outcome.signal)})`,
    )),
    (error: unknown) => Promise.reject(thrown(error)),
  )
  // A normal post-result dispose also closes the process; keep the expected
  // late rejection observed after the result race has already settled.
  processFailure.catch(() => {})

  const collectOutput = (): ContentBlock[] => {
    const text = output.trim()
    return text === '' ? [] : [{ type: 'text', text }]
  }

  const result: Promise<SubagentResult> = settleRunResult({
    attempt: () => Promise.race([
      child.done.then((outcome) => {
        if (outcome.exitCode !== 0) {
          throw new Error(`subagent-dsh: dsh exited with code ${String(outcome.exitCode)}`)
        }
        // A zero exit with no printed answer is a silent failure, not a
        // success: the sub-dsh produced nothing, so the delegation did not
        // deliver a result.
        const answer = collectOutput()
        if (answer.length === 0) {
          throw new Error('subagent-dsh: dsh exited 0 but produced no answer')
        }
        return { output: answer, stopReason: 'completed' as const }
      }),
      processFailure,
      abortBranch,
    ]),
    collectOutput,
    cancelled: () => runAbort.signal.aborted,
    onError: (error: Error, stopReason: SubagentStopReason) => {
      const suffix = stderr.trim() === '' ? '' : `; ${stderr.trim()}`
      ctx.logger.warn(`subagent-dsh: child run failed (${stopReason}): ${error.message}${suffix}`)
    },
    signal: request.signal,
    onAbort,
  }).then((settled) => {
    // A completed round proves the resolved credential is live — the sub-dsh
    // reached its endpoint and produced an answer.
    if (settled.stopReason === 'completed') markCredentialVerified(ctx, spec.scope)
    // The turn closes at the real settle moment, so the timing projection's
    // duration equals the actual CLI runtime. Every terminal path closes the
    // window — a failed or cancelled run settles 'error'/'aborted' instead of
    // leaving the turn open with a distorted tiny duration.
    if (spec.childSession !== undefined) {
      if (settled.stopReason === 'completed') {
        spec.childSession.append('turn/end', { turn, reason: { kind: 'completed' } })
      } else if (settled.stopReason === 'aborted') {
        spec.childSession.append('turn/end', { turn, reason: { kind: 'aborted', reason: { kind: 'parent' } } })
      } else {
        spec.childSession.append('turn/end', {
          turn,
          reason: { kind: 'error', error: { message: 'dsh exited before the run completed', code: 'UNKNOWN' } },
        })
      }
    }
    return settled
  })

  // After the child EXITS — however it ended (completed, killed by dispose, or
  // crashed) — mirror whatever the sub-dsh session already produced into the
  // dsh subagent session, so every round preserves its conversation and real
  // token usage instead of showing turn boundaries only. Waits for the settle
  // chain first (so turn/end is already appended) AND for the process to
  // actually exit (the sub-dsh flushed its session before exiting) before
  // reading.
  void result.then(() => child.done).then(
    () => {
      if (spec.childSession !== undefined) {
        const childSession = spec.childSession
        // The settle pass reports the final mirror count even when polling
        // already covered the round (empty delta): it is authoritative.
        return enqueueMirror(() => mirrorAndReport(childSession, true))
      }
      return undefined
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

/** Resolve the sub-dsh credential or fail loud before any process spawns. */
export async function resolveApiKey(ctx: Context, config: LocalAgentDshConfig): Promise<string> {
  const ref = config.apiKeyRef ?? 'DEEPSEEK_API_KEY'
  const resolved = await ctx.credentials.resolve(credentialRef(ref))
  if (resolved === undefined) {
    throw new Error(`subagent-dsh: ${ref} is not configured; set it in the credential settings to delegate to dsh`)
  }
  return resolved.value
}
