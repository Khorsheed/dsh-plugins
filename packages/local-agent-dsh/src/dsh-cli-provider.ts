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
import { delegationEnv, subagentDelegationLabel } from '@khorsheed/dsh-local-agent'
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
 * token). The exec driver registers per round; the live driver registers per
 * resident process and releases on reclaim.
 */
export interface MemberRunHandle {
  readonly env: Readonly<NodeJS.ProcessEnv>
  bind(pid: number): void
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
    bind: pid => registry.bindMemberRunPid(token, pid),
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
  constructor(
    private readonly ctx: Context,
    private readonly config: LocalAgentDshConfig,
    private readonly live?: DshLiveDriver | ((childSessionId: string) => DshLiveDriver | undefined),
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
    const parentCwd = request.parent.session.header.cwd
    if (parentCwd === undefined) {
      throw new Error('subagent-dsh: the parent session has no working directory to run the CLI in')
    }
    const homeDir = this.ctx.localAgent.homeDir('dsh')
    // The family tool stages exactly one intent per delegation call; the
    // provider consumes exactly one per start. A resume intent continues the
    // recorded sub-dsh session inside the existing child session.
    const intent = this.ctx.localAgent.takeDelegationIntent(request.parent.session.id, this.name)
    if (intent !== undefined && intent.kind === 'resume') {
      return this.startDshResume(request, intent, parentCwd, homeDir)
    }
    return this.startDshFresh(request, parentCwd, homeDir)
  }

  /** Fresh round: record the child session and delegation, spawn the sub-dsh create. */
  private async startDshFresh(
    request: ResolvedSubagentStartRequest,
    parentCwd: string,
    homeDir: string,
  ): Promise<SubagentRun> {
    const runId = SessionId(randomUUID())
    let childSession: Session | undefined
    try {
      // Strict global read, never the caller-scope `ctx.sessions` proxy: the
      // bundle does not inject `sessions`, and the proxy would throw on access.
      const sessions = this.ctx.get('sessions')
      if (sessions === undefined) {
        throw new Error('the sessions service is not mounted')
      }
      childSession = sessions.create(runId, {
        meta: {
          cwd: parentCwd,
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
      childSession.append('subagent/descriptor', {
        ...request.descriptor,
        label: subagentDelegationLabel(harness?.displayName ?? 'dsh', request.descriptor.label),
      })
      void this.ctx.get('sessionPersistence')?.create(childSession.header).catch(() => {})
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
    })
    // Live driver: the round goes to the resident serve process (one per
    // member). A channel that fails at spawn/handshake marks itself broken and
    // falls through to the exec one-shot below — and stays there
    // (driver.disabled) for later rounds. The resolver may gate this member to
    // exec while a retiring generation still hosts its runtime.
    const live = this.liveDriver(runId)
    if (live !== undefined && childSession !== undefined && !live.disabled) {
      try {
        return await live.startRound(request, {
          cwd: parentCwd,
          homeDir,
          childSession,
          sessionId: runId,
          parentSessionId: request.parent.session.id,
        })
      } catch (error) {
        if (!(error instanceof LiveChannelUnavailableError) || request.signal.aborted) throw error
        this.ctx.logger.warn(`subagent-dsh: live driver unavailable, using the exec one-shot: ${error.message}`)
      }
    }
    // Member channel: register this run and hand the bridge coordinates to
    // the sub-dsh through the spawn env, so its session starts with
    // member_message available.
    const member = this.memberRun(runId, request.parent.session.id)
    try {
      const run = await startDshCliRun(request, {
        cwd: parentCwd,
        homeDir,
        childSession,
        sessionId: runId,
        resume: undefined,
        config: this.config,
        ctx: this.ctx,
        ...member === undefined ? {} : { memberEnv: member.env },
        onSpawned: (pid) => { member?.bind(pid) },
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
    parentCwd: string,
    homeDir: string,
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
      const nextTurn = childSession.events.filter(event => event.type === 'turn/start').length + 1
      // Live driver: continue the member's resident serve process. Channel
      // spawn/handshake failure falls through to the exec one-shot below.
      const live = this.liveDriver(intent.childSessionId)
      if (live !== undefined && !live.disabled) {
        try {
          const liveRun = await live.startRound(request, {
            cwd: parentCwd,
            homeDir,
            childSession,
            sessionId: intent.cliSessionId,
            parentSessionId: request.parent.session.id,
            resume: { turn: nextTurn },
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
      const member = this.memberRun(intent.childSessionId, request.parent.session.id)
      try {
        const run = await startDshCliRun(request, {
          cwd: parentCwd,
          homeDir,
          childSession,
          sessionId: intent.cliSessionId,
          resume: { cliSessionId: intent.cliSessionId, turn: nextTurn },
          config: this.config,
          ctx: this.ctx,
          ...member === undefined ? {} : { memberEnv: member.env },
          onSpawned: (pid) => { member?.bind(pid) },
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
  /** dsh subagent session recording this delegation. */
  readonly childSession?: Session | undefined
  /**
   * The sub-dsh session id for this round — the caller-supplied uuid, passed
   * as `--session-id` on a fresh round and `--resume` on a continuation.
   */
  readonly sessionId: string
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
  /** Called with the spawned CLI pid right after spawn (member-channel pid binding). */
  readonly onSpawned?: (pid: number) => void
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
  // drifted sub-profile before every round.
  provisionDshSubProfile(spec.homeDir, config)
  // Resolve the sub-dsh credential BEFORE spawning: the key travels in the
  // explicit env layer, which is the only way past the shared env scrub.
  const apiKey = await resolveApiKey(ctx, config)
  const turn = spec.resume?.turn ?? 1
  // The turn opens at the real spawn moment so the timing projection
  // measures actual CLI runtime.
  spec.childSession?.append('turn/start', { turn })

  const launch = dshLaunchArgv(config)
  const spawnSpec: SubprocessSpawnSpec = {
    argv: spec.resume === undefined
      ? [...launch, '--profile', profileName, '--session-id', spec.sessionId, task]
      : [...launch, '--profile', profileName, '--resume', spec.sessionId, task],
    cwd: spec.cwd,
    stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
    graceMs: DEFAULT_DISPOSE_GRACE_MS,
    // The explicit env layer merges AFTER the shared credential scrub, so
    // both the credential-shaped key and the DSH_* fact survive into the
    // child — without DSH_HOME the sub-dsh would default to ~/.dsh and write
    // sessions into the parent instance's store.
    env: delegationEnv({
      DSH_HOME: spec.homeDir,
      DEEPSEEK_API_KEY: apiKey,
      // The launch replicates the parent's tsx ESM hook (dshLaunchArgv), so
      // the hook's tsconfig path is a hard launch dependency: without it tsx
      // compiles the harness source with default options and the child dies
      // at import time ('FiberState' export mismatch). Pass it explicitly —
      // the delegation env allowlist tombstones it otherwise.
      ...process.env.TSX_TSCONFIG_PATH === undefined
        ? {}
        : { TSX_TSCONFIG_PATH: process.env.TSX_TSCONFIG_PATH },
      // Member channel coordinates ride the same explicit layer (DSH_* names
      // are scrubbed from the ambient env; this layer is the sanctioned
      // override).
      ...spec.memberEnv,
    }),
  }
  const child = ctx.subprocess.spawn(spawnSpec)
  spec.onSpawned?.(child.pid)

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
