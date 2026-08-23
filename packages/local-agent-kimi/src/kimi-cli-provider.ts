/**
 * One-shot and resumable Kimi CLI subagent lifecycle: spawn `kimi -p "<task>"`
 * through the subprocess seam, capture its printed response as the run output,
 * and dispose to whole-tree quiescence. Mirrors the official one-shot Codex
 * provider, and adds the family's own resume: a later round calls the tool with
 * the first round's dsh child session id, the family registry maps it back to
 * the kimi session, and the provider spawns `kimi -S session_<id> -p` so the
 * SAME kimi conversation continues inside the SAME dsh child session.
 * @module @khorsheed/dsh-local-agent-kimi/kimi-cli-provider
 */

import { randomUUID } from 'node:crypto'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
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
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { delegationEnv, subagentDelegationLabel } from '@khorsheed/dsh-local-agent'
import { MEMBER_BRIDGE_SOCKET_ENV, MEMBER_BRIDGE_TOKEN_ENV } from '@khorsheed/dsh-local-agent/types'
import { LiveChannelUnavailableError } from './live-driver.ts'
import type { KimiAcpLiveDriver } from './live-driver.ts'
import { injectMemberBridge, memberBridgeServerKey, removeMemberBridge } from './member-bridge-config.ts'
import { readKimiBaseUrl } from './provision.ts'
import { mirrorKimiSessionDelta, type KimiMirrorDelta } from './session-mirror.ts'

/** Default POSIX grace between subprocess termination tiers. */
export const DEFAULT_DISPOSE_GRACE_MS = 3_000

/**
 * Auth-shaped failure signatures in kimi's stderr or output: the endpoint
 * rejected the credential. Narrow on purpose — matched against
 * provider-controlled error output only.
 */
export const KIMI_AUTH_FAILURE = /401|unauthorized|invalid api key|not authenticated/i

/** Default interval between live transcript-mirror polls during a run. */
export const DEFAULT_LIVE_MIRROR_INTERVAL_MS = 2_000

/**
 * One-shot Kimi CLI subagent provider: every accepted fresh run starts a
 * fresh `kimi -p` process in the delegating Session's workspace, under the
 * harness scoped home; a resume round (the family tool's staged resume intent)
 * continues the SAME kimi session with `kimi -S session_<id> -p` inside the
 * SAME dsh child session. Mirrors the official one-shot Codex provider for the
 * fresh path, including `NO_START_CAPABILITIES` — continuation is the family's
 * own resume mechanism, not the official Agent-type continuable seam.
 */
export class KimiCliProvider implements SubagentProvider {
  readonly name = 'kimi-cli'
  readonly capabilities: SubagentCapabilities = NO_START_CAPABILITIES
  readonly inheritsParentContext = false

  constructor(private readonly ctx: Context, private readonly live?: KimiAcpLiveDriver) {}

  /**
   * Register one run with the member channel and declare the bridge MCP server
   * in the scoped home's mcp.json (per-run entry, socket + token in its env).
   * Returns the bind/release handles, or undefined when the mounted core
   * predates the member channel (declare-and-degrade: the run proceeds
   * exactly as before). `bind` records the spawned CLI pid (the bridge's
   * parentage cross-check); `release` invalidates the token and prunes the
   * config entry on any settle path.
   */
  private memberRun(
    childSessionId: string,
    parentSessionId: string,
    homeDir: string,
  ): { bind(pid: number): void; release(): void } | undefined {
    const registry = this.ctx.localAgent
    if (
      typeof registry.registerMemberRun !== 'function'
      || typeof registry.memberBridgeSocketPath !== 'function'
      || typeof registry.memberBridgeCommand !== 'function'
    ) return undefined
    const token = registry.registerMemberRun({ childSessionId, parentSessionId, provider: this.name })
    const key = memberBridgeServerKey(token)
    try {
      injectMemberBridge(homeDir, key, registry.memberBridgeCommand(), {
        [MEMBER_BRIDGE_SOCKET_ENV]: registry.memberBridgeSocketPath(),
        [MEMBER_BRIDGE_TOKEN_ENV]: token,
      })
    } catch (error: unknown) {
      registry.unregisterMemberRun(token)
      this.ctx.logger.warn(`subagent-kimi: member bridge config injection failed: ${error instanceof Error ? error.message : String(error)}`)
      return undefined
    }
    let released = false
    return {
      bind: pid => registry.bindMemberRunPid(token, pid),
      release: () => {
        if (released) return
        released = true
        registry.unregisterMemberRun(token)
        try {
          removeMemberBridge(homeDir, key)
        } catch (error: unknown) {
          this.ctx.logger.warn(`subagent-kimi: member bridge config cleanup failed: ${error instanceof Error ? error.message : String(error)}`)
        }
      },
    }
  }

  async start(request: ResolvedSubagentStartRequest): Promise<SubagentRun> {
    const parentCwd = request.parent.session.header.cwd
    if (parentCwd === undefined) {
      throw new Error('subagent-kimi: the parent session has no working directory to run the CLI in')
    }
    const homeDir = this.ctx.localAgent.homeDir('kimi')
    // The family tool stages exactly one intent per delegation call; the
    // provider consumes exactly one per start. A resume intent continues the
    // recorded kimi session inside the existing child session.
    const intent = this.ctx.localAgent.takeDelegationIntent(request.parent.session.id, this.name)
    if (intent !== undefined && intent.kind === 'resume') {
      return this.startKimiResume(request, intent, parentCwd, homeDir)
    }
    return this.startKimiFresh(request, parentCwd, homeDir)
  }

  /** Fresh round: record the child session, spawn `kimi -p`, mirror after settle. */
  private async startKimiFresh(
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
      const harness = this.ctx.localAgent.get('kimi')
      childSession.append('subagent/descriptor', {
        ...request.descriptor,
        label: subagentDelegationLabel(harness?.displayName ?? 'kimi', request.descriptor.label),
      })
      void this.ctx.get('sessionPersistence')?.create(childSession.header).catch(() => {})
    } catch (error) {
      this.ctx.logger.warn(`subagent-kimi: subagent session record failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    // Resolve the effective endpoint from the scoped config.toml for
    // diagnostics: the CLI reads it directly, and a user-edited value is
    // authoritative. Log it so a failing delegation reports which endpoint
    // it actually used.
    const baseUrl = await readKimiBaseUrl(homeDir).catch(() => undefined)
    this.ctx.logger.info(`subagent-kimi: delegating via ${baseUrl ?? 'kimi default endpoint'}`)
    // Live driver: the round goes to the member's resident `kimi acp` process.
    // A channel that fails at spawn/handshake falls through to the exec
    // one-shot below — and stays there until the breaker cools down.
    if (this.live !== undefined && childSession !== undefined && !this.live.disabled) {
      try {
        return await this.live.startRound(request, {
          cwd: parentCwd,
          homeDir,
          childSession,
          parentSessionId: request.parent.session.id,
          // The ACP session id arrives with session/new (server-assigned), far
          // earlier than the exec path's settle-time stderr parse.
          onCliSessionId: (cliSessionId) => {
            this.ctx.localAgent.recordDelegation({
              childSessionId: runId,
              provider: this.name,
              parentSessionId: request.parent.session.id,
              cliSessionId,
            })
          },
        })
      } catch (error) {
        if (!(error instanceof LiveChannelUnavailableError) || request.signal.aborted) throw error
        this.ctx.logger.warn(`subagent-kimi: live driver unavailable, using the exec one-shot: ${error.message}`)
      }
    }
    // Member channel: register this run and declare the bridge MCP before the
    // spawn, so the CLI session starts with member_message available.
    const member = this.memberRun(runId, request.parent.session.id, homeDir)
    try {
      const run = await startKimiCliRun(request, {
        cwd: parentCwd,
        env: delegationEnv({ KIMI_CODE_HOME: homeDir }),
        endpointLabel: baseUrl,
        disposeGraceMs: DEFAULT_DISPOSE_GRACE_MS,
        spawn: spec => this.ctx.subprocess.spawn(spec),
        onError: (error: unknown, stopReason) => {
          this.ctx.logger.warn(`subagent-kimi: child run failed (${stopReason}) via ${baseUrl ?? 'kimi default endpoint'}: ${error instanceof Error ? error.message : String(error)}`)
        },
        onAuthFailure: (detail) => { this.ctx.localAgent.reportAuthFailure('kimi', detail) },
        onSpawned: (pid) => { member?.bind(pid) },
        childSession,
        homeDir,
        ctx: this.ctx,
        // The first round records the kimi session id so a later resume round
        // can continue it; the mirror offset starts at zero.
        onCliSessionId: (cliSessionId) => {
          if (cliSessionId === undefined) return
          this.ctx.localAgent.recordDelegation({
            childSessionId: runId,
            provider: this.name,
            parentSessionId: request.parent.session.id,
            cliSessionId,
          })
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

  /** Resume round: continue the recorded kimi session inside the existing child session. */
  private async startKimiResume(
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
        `subagent-kimi: 该子会话有进行中的委派，等其完成后再追问 (child session ${intent.childSessionId})`,
      )
    }
    try {
      const sessions = this.ctx.get('sessions')
      const childSession = sessions?.get(SessionId(intent.childSessionId))
      if (childSession === undefined) {
        throw new Error(
          `subagent-kimi: resume target child session ${intent.childSessionId} is not live — start a fresh delegation instead`,
        )
      }
      // The next turn follows the rounds already recorded in the child session.
      const nextTurn = childSession.events.filter(event => event.type === 'turn/start').length + 1
      // Live driver: continue the member's resident ACP session. Channel
      // spawn/handshake failure falls through to the exec one-shot below.
      if (this.live !== undefined && !this.live.disabled) {
        try {
          const liveRun = await this.live.startRound(request, {
            cwd: parentCwd,
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
          this.ctx.logger.warn(`subagent-kimi: live driver unavailable, using the exec one-shot: ${error.message}`)
        }
      }
      // Member channel: register the resume round (same child session, fresh
      // per-run token) and declare the bridge MCP before the spawn.
      const member = this.memberRun(intent.childSessionId, request.parent.session.id, homeDir)
      const baseUrl = await readKimiBaseUrl(homeDir).catch(() => undefined)
      this.ctx.logger.info(`subagent-kimi: resuming via ${baseUrl ?? 'kimi default endpoint'}`)
      let run: SubagentRun
      try {
        run = await startKimiCliRun(request, {
          cwd: parentCwd,
          env: delegationEnv({ KIMI_CODE_HOME: homeDir }),
          endpointLabel: baseUrl,
          disposeGraceMs: DEFAULT_DISPOSE_GRACE_MS,
          spawn: spec => this.ctx.subprocess.spawn(spec),
          onError: (error: unknown, stopReason) => {
            this.ctx.logger.warn(`subagent-kimi: child run failed (${stopReason}) via ${baseUrl ?? 'kimi default endpoint'}: ${error instanceof Error ? error.message : String(error)}`)
          },
          onAuthFailure: (detail) => { this.ctx.localAgent.reportAuthFailure('kimi', detail) },
          onSpawned: (pid) => { member?.bind(pid) },
          childSession,
          homeDir,
          ctx: this.ctx,
          resume: { cliSessionId: intent.cliSessionId, turn: nextTurn },
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

/** Fully resolved inputs for one Kimi CLI run. */
export interface KimiCliRunSpec {
  /** Parent Session workspace; also the kimi process cwd. */
  readonly cwd: string
  /** Explicit environment layered after the shared credential scrub. */
  readonly env: Readonly<NodeJS.ProcessEnv>
  /** Resolved endpoint label for diagnostics; absent means the CLI default. */
  readonly endpointLabel?: string | undefined
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
  /** dsh subagent session recording this delegation; its transcript is mirrored after settle. */
  readonly childSession?: Session | undefined
  /** The `kimi` harness's scoped home, read for the transcript to mirror. */
  readonly homeDir?: string | undefined
  /** Host context carrying session persistence for the transcript mirror. */
  readonly ctx?: Context | undefined
  /**
   * Resume round: continue the CLI session named by `cliSessionId` with
   * `kimi -S session_<id> -p` instead of a fresh `kimi -p`, appending this
   * round into the same child session under the given turn number.
   */
  readonly resume?: { readonly cliSessionId: string; readonly turn: number } | undefined
  /**
   * Called after the run settles with the kimi session id parsed from stderr
   * (absent when the hint is missing). The fresh path uses it to record the
   * delegation so a later resume round can continue the session.
   */
  readonly onCliSessionId?: ((cliSessionId: string | undefined) => void) | undefined
  /**
   * Live-mirror poll interval during the run; absent disables nothing — the
   * default ({@link DEFAULT_LIVE_MIRROR_INTERVAL_MS}) applies. Tests inject a
   * small value.
   */
  readonly liveMirrorIntervalMs?: number | undefined
}

function thrown(value: unknown): Error {
  /* v8 ignore next -- typed subprocess failures reject with Error. */
  return value instanceof Error ? value : new Error(String(value))
}

/**
 * Extract the kimi session id from the CLI's printed response. `kimi -p`
 * prints a resume hint (`To resume this session: kimi -r session_<id>`) on
 * stdout after a run; mirroring that exact session instead of the newest-by-
 * mtime keeps concurrent delegations from cross-mirroring.
 * @param output - the collected CLI stdout.
 * @returns the session id, or undefined when the hint is absent.
 */
export function kimiSessionIdFromOutput(output: string): string | undefined {
  const match = /kimi -r session_([0-9a-fA-F-]+)/.exec(output)
  return match?.[1]
}

/**
 * Validate and join the one-shot task before crossing the process boundary.
 * @param prompt - task content accepted from the shared subagent service.
 * @returns the joined non-empty text.
 */
export function textTask(prompt: readonly ContentBlock[]): string {
  if (prompt.length === 0) {
    throw new Error('subagent-kimi: the one-shot task must contain only text blocks')
  }
  const texts: string[] = []
  for (const block of prompt) {
    if (block.type !== 'text') {
      throw new Error('subagent-kimi: the one-shot task must contain only text blocks')
    }
    texts.push(block.text)
  }
  if (texts.every(text => text.trim().length === 0)) {
    throw new Error('subagent-kimi: the one-shot task must not be empty')
  }
  return texts.join('\n')
}

/**
 * Mirror the transcript delta after the recorded offset, advance the offset,
 * and report one `delta` progress per newly mirrored line. Shared by the live
 * poll and the settle-time mirror so the two paths cannot drift. The offset
 * read (`kimiMirroredLines`) and write (`setKimiMirroredLines`) are the same
 * bookkeeping the settle path used before live mirroring existed.
 * @param ctx - host context carrying localAgent and session persistence.
 * @param childSession - the dsh child session being mirrored into.
 * @param homeDir - the `kimi` harness's scoped home.
 * @param kimiSessionId - the kimi session to mirror.
 * @returns the mirror delta (new total + newly mirrored line texts).
 */
export async function mirrorKimiDelta(
  ctx: Context,
  childSession: Session,
  homeDir: string,
  kimiSessionId: string | undefined,
): Promise<KimiMirrorDelta> {
  // Degrade without the localAgent service: the transcript still mirrors (the
  // pre-live-mirror behavior for a bare context), only the offset bookkeeping
  // and progress reporting drop out.
  const localAgent = ctx.get('localAgent')
  const fromLines = localAgent?.kimiMirroredLines(childSession.id) ?? 0
  const delta = await mirrorKimiSessionDelta(ctx, childSession, homeDir, kimiSessionId, fromLines)
  if (delta.texts.length === 0) return delta
  localAgent?.setKimiMirroredLines(childSession.id, delta.total)
  for (const text of delta.texts) {
    localAgent?.reportRunProgress(childSession.id, { kind: 'delta', text })
  }
  return delta
}

/**
 * Mirror the kimi session's transcript into the child session AFTER the CLI
 * process has exited, whatever its stop reason. A cancelled or failed round
 * still preserves whatever the wire already recorded (partial answer, tool
 * activity, usage) instead of leaving the child blank — the run result
 * settles 'aborted'/'error' at the cancel moment, but the CLI may have
 * produced content before the kill landed, and that content belongs in the
 * 子代理 surface with its real token accounting. Also records the delegation
 * (fresh rounds) so a later resume can continue the session.
 * @param spec - the run spec carrying the child session, home, and context.
 * @param stderr - the collected CLI stderr (the resume hint lives here).
 */
async function mirrorKimiAfterExit(
  spec: KimiCliRunSpec,
  stderr: string,
): Promise<void> {
  if (spec.childSession === undefined || spec.homeDir === undefined || spec.ctx === undefined) return
  try {
    const kimiSessionId = spec.resume?.cliSessionId ?? kimiSessionIdFromOutput(stderr)
    if (spec.resume === undefined) spec.onCliSessionId?.(kimiSessionId)
    const delta = await mirrorKimiDelta(spec.ctx, spec.childSession, spec.homeDir, kimiSessionId)
    // Report the final mirrored-line count even when the live mirror already
    // advanced the offset (empty delta): the settle report is authoritative.
    spec.ctx.get('localAgent')?.reportRunProgress(spec.childSession.id, { kind: 'mirror', mirroredLines: delta.total })
  } catch (error) {
    spec.onError?.(thrown(error), 'error')
  }
}

/**
 * Start the real `kimi -p` (fresh) or `kimi -S session_<id> -p` (resume)
 * child and publish its run. The kimi response is printed to stdout; stderr
 * is inherited for diagnostics. The run id is the child session id for a
 * session-backed run, so the tool's `resume="<id>"` self-description names
 * the same handle the registry records.
 * @param request - resolved shared subagent request.
 * @param spec - workspace, environment, process service, and diagnostic policy.
 * @returns the published run after the child starts.
 */
export function startKimiCliRun(
  request: SubagentStartRequest,
  spec: KimiCliRunSpec,
): Promise<SubagentRun> {
  const task = textTask(request.prompt)
  if (request.signal.aborted) {
    throw new Error('subagent-kimi: request was aborted before the CLI started')
  }
  const turn = spec.resume?.turn ?? 1
  // The turn opens at the real spawn moment so the timing projection
  // measures actual CLI runtime, not the post-hoc mirror time.
  spec.childSession?.append('turn/start', { turn })

  const child = spec.spawn({
    // -S must precede -p: after -p, kimi parses the id as a command.
    argv: spec.resume === undefined
      ? ['kimi', '-p', task]
      : ['kimi', '-S', `session_${spec.resume.cliSessionId}`, '-p', task],
    cwd: spec.cwd,
    stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
    graceMs: spec.disposeGraceMs,
    env: spec.env,
  })
  spec.onSpawned?.(child.pid)

  let output = ''
  child.stdout?.on('data', (chunk: Buffer) => { output += chunk.toString() })
  // stderr carries diagnostics plus the resume hint naming this run's session;
  // parsed for the mirror and the delegation record, never folded into output.
  let stderr = ''
  child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString() })

  // Live transcript mirroring: poll the kimi wire log while the run is in
  // flight and mirror the delta through the SAME folding path the settle-time
  // mirror uses, so a caller watching the child session sees progress instead
  // of silence. The offset is the shared kimiMirroredLines bookkeeping, so the
  // settle-time final mirror is a no-op when polling kept up. A poll failure
  // never kills the run: it logs, and the settle mirror remains the fallback.
  // All mirror passes (polls and the settle mirror) serialize through
  // mirrorQueue so concurrent passes cannot fold overlapping ranges.
  let mirrorQueue: Promise<void> = Promise.resolve()
  const enqueueMirror = (task: () => Promise<void>): void => {
    mirrorQueue = mirrorQueue.then(task)
  }
  if (spec.childSession !== undefined && spec.homeDir !== undefined && spec.ctx !== undefined) {
    const childSession = spec.childSession
    const homeDir = spec.homeDir
    const mirrorCtx = spec.ctx
    const poll = async (): Promise<void> => {
      // A fresh run's session id arrives on stderr with the resume hint; skip
      // the tick until it is known (the newest-session heuristic would risk
      // cross-mirroring a concurrent delegation).
      const kimiSessionId = spec.resume?.cliSessionId ?? kimiSessionIdFromOutput(stderr)
      if (kimiSessionId === undefined) return
      const delta = await mirrorKimiDelta(mirrorCtx, childSession, homeDir, kimiSessionId)
      if (delta.texts.length > 0) {
        mirrorCtx.get('localAgent')?.reportRunProgress(childSession.id, { kind: 'mirror', mirroredLines: delta.total })
      }
    }
    const liveMirror = setInterval(() => {
      enqueueMirror(async () => {
        try {
          await poll()
        } catch (error: unknown) {
          mirrorCtx.logger.warn(`subagent-kimi: live mirror poll failed: ${thrown(error).message}`)
        }
      })
    }, spec.liveMirrorIntervalMs ?? DEFAULT_LIVE_MIRROR_INTERVAL_MS)
    liveMirror.unref()
    // Polling stops when the process exits; the settle mirror (enqueued below)
    // runs the final fold afterwards through the same queue.
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
    runAbort.abort(new Error('subagent-kimi: run cancelled locally'))
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
    runAbort.signal.addEventListener('abort', () => reject(new Error('subagent-kimi: run cancelled locally')), { once: true })
  })

  const processFailure: Promise<never> = child.done.then(
    outcome => Promise.reject(new Error(
      'subagent-kimi: CLI exited before the run settled '
      + `(code ${String(outcome.exitCode)}, signal ${String(outcome.signal)})`,
    )),
    (error: unknown) => Promise.reject(thrown(error)),
  )
  // A normal post-result dispose also closes the process; keep the expected
  // late rejection observed after the result race has already settled.
  processFailure.catch(() => {})

  const collectOutput = (): ContentBlock[] => {
    // Post-exit the seam's collected buffer is authoritative — a fast-exiting
    // process can settle `done` before the streamed data events land.
    const drained = child.collected.stdout?.readFrom(0).text
    const text = (drained !== undefined && drained !== '' ? drained : output).trim()
    return text === '' ? [] : [{ type: 'text', text }]
  }

  const result: Promise<SubagentResult> = settleRunResult({
    attempt: () => Promise.race([
      child.done.then((outcome) => {
        if (outcome.exitCode !== 0) {
          const via = spec.endpointLabel ?? 'kimi default endpoint'
          throw new Error(`subagent-kimi: kimi -p exited with code ${String(outcome.exitCode)} via ${via}`)
        }
        // A zero exit with no printed answer is a silent failure, not a
        // success: the CLI produced nothing, so the delegation did not
        // deliver a result. Throwing here settles 'error' through the seam
        // instead of reporting an empty 'completed' (which the upstream
        // settleRunResult does not re-check).
        const output = collectOutput()
        if (output.length === 0) {
          throw new Error('subagent-kimi: kimi -p exited 0 but produced no answer')
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
          reason: { kind: 'error', error: { message: 'kimi -p exited before the run completed', code: 'UNKNOWN' } },
        })
      }
    }
    return settled
  })

  // After the child EXITS — however it ended (completed, killed by dispose, or
  // crashed) — mirror whatever the kimi session already produced into the dsh
  // subagent session, so a cancelled round still preserves its partial work
  // and real token usage instead of leaving the child blank. The mirror reads
  // the wire file, so it only reflects what kimi flushed before the kill.
  // Waits for the settle chain first (so turn/end is already appended) AND for
  // the process to actually exit (so the wire file is complete) before
  // reading it. Enqueued behind any in-flight live poll on the mirror queue.
  void result.then(() => child.done).then(
    () => {
      // Auth detection runs post-exit: streams are drained by then, so a fast
      // failure's stderr is complete (a settle-time read could race the flush).
      if (spec.onAuthFailure !== undefined) {
        // The seam's collected buffers are complete at process exit; the
        // streamed variables can lag `done` by a tick.
        const drainedStderr = child.collected.stderr?.readFrom(0).text || stderr
        const drainedStdout = child.collected.stdout?.readFrom(0).text || output
        const authDetail = `${drainedStderr}\n${drainedStdout}`
        if (KIMI_AUTH_FAILURE.test(authDetail)) {
          spec.onAuthFailure(authDetail.split('\n').find(line => line.trim() !== '') ?? 'auth failure')
        }
      }
      enqueueMirror(() => mirrorKimiAfterExit(spec, stderr))
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
