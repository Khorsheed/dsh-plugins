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
import { subagentDelegationLabel } from '@khorsheed/dsh-local-agent'
import { readKimiBaseUrl } from './provision.ts'
import { mirrorKimiSession } from './session-mirror.ts'

/** Default POSIX grace between subprocess termination tiers. */
export const DEFAULT_DISPOSE_GRACE_MS = 3_000

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

  constructor(private readonly ctx: Context) {}

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
    return startKimiCliRun(request, {
      cwd: parentCwd,
      env: { KIMI_CODE_HOME: homeDir },
      endpointLabel: baseUrl,
      disposeGraceMs: DEFAULT_DISPOSE_GRACE_MS,
      spawn: spec => this.ctx.subprocess.spawn(spec),
      onError: (error: unknown, stopReason) => {
        this.ctx.logger.warn(`subagent-kimi: child run failed (${stopReason}) via ${baseUrl ?? 'kimi default endpoint'}: ${error instanceof Error ? error.message : String(error)}`)
      },
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
      const baseUrl = await readKimiBaseUrl(homeDir).catch(() => undefined)
      this.ctx.logger.info(`subagent-kimi: resuming via ${baseUrl ?? 'kimi default endpoint'}`)
      const run = await startKimiCliRun(request, {
        cwd: parentCwd,
        env: { KIMI_CODE_HOME: homeDir },
        endpointLabel: baseUrl,
        disposeGraceMs: DEFAULT_DISPOSE_GRACE_MS,
        spawn: spec => this.ctx.subprocess.spawn(spec),
        onError: (error: unknown, stopReason) => {
          this.ctx.logger.warn(`subagent-kimi: child run failed (${stopReason}) via ${baseUrl ?? 'kimi default endpoint'}: ${error instanceof Error ? error.message : String(error)}`)
        },
        childSession,
        homeDir,
        ctx: this.ctx,
        resume: { cliSessionId: intent.cliSessionId, turn: nextTurn },
      })
      void run.result.then(
        () => this.ctx.localAgent.releaseResumeLock(intent.childSessionId),
        () => this.ctx.localAgent.releaseResumeLock(intent.childSessionId),
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
  readonly env: Record<string, string>
  /** Resolved endpoint label for diagnostics; absent means the CLI default. */
  readonly endpointLabel?: string | undefined
  /** Subprocess termination grace passed to the shared process-tree owner. */
  readonly disposeGraceMs: number
  /** Shared subprocess service spawn operation. */
  readonly spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle
  /** Diagnostic sink for a post-publication error flattened into a result. */
  readonly onError?: (error: Error, stopReason: SubagentStopReason) => void
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

  let output = ''
  child.stdout?.on('data', (chunk: Buffer) => { output += chunk.toString() })
  // stderr carries diagnostics plus the resume hint naming this run's session;
  // parsed for the mirror and the delegation record, never folded into output.
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
    runAbort.abort(new Error('subagent-kimi: run cancelled locally'))
  }
  const onAbort = (): void => { requestCancel() }
  request.signal.addEventListener('abort', onAbort, { once: true })

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
    const text = output.trim()
    return text === '' ? [] : [{ type: 'text', text }]
  }

  const result: Promise<SubagentResult> = settleRunResult({
    attempt: () => Promise.race([
      child.done.then((outcome) => {
        if (outcome.exitCode !== 0) {
          const via = spec.endpointLabel ?? 'kimi default endpoint'
          throw new Error(`subagent-kimi: kimi -p exited with code ${String(outcome.exitCode)} via ${via}`)
        }
        return { output: collectOutput(), stopReason: 'completed' as const }
      }),
      processFailure,
    ]),
    collectOutput,
    cancelled: () => runAbort.signal.aborted,
    onError: spec.onError,
    signal: request.signal,
    onAbort,
  }).then(async (settled) => {
    // The turn closes at the real settle moment, so the timing projection's
    // duration equals the actual CLI runtime; the mirror after it carries the
    // transcript into the already-closed turn. Every terminal path closes the
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
    // Mirror the kimi session's transcript delta into the dsh subagent session
    // so the delegation is visible in the standard 子代理 surface. Runs AFTER
    // the result race settles — an awaited mirror inside the race branch would
    // lose to processFailure and fail the run with a spurious 'CLI exited
    // before the run settled' error. A resume round mirrors only the lines
    // after the already-mirrored offset, keyed by the recorded CLI session id
    // (kimi prints its `-r session_<id>` hint on a fresh `-p`, not necessarily
    // on a resume, so the intent's recorded id is authoritative).
    if (settled.stopReason === 'completed'
      && spec.childSession !== undefined && spec.homeDir !== undefined && spec.ctx !== undefined) {
      try {
        const kimiSessionId = spec.resume?.cliSessionId ?? kimiSessionIdFromOutput(stderr)
        if (spec.resume === undefined) spec.onCliSessionId?.(kimiSessionId)
        // A resume round mirrors only the delta after the recorded offset; a
        // fresh round starts from zero. The mirror returns the new total
        // transcript-line count, which becomes the next round's offset.
        const fromLines = spec.resume === undefined
          ? 0
          : spec.ctx.localAgent.kimiMirroredLines(spec.childSession.id) ?? 0
        const total = await mirrorKimiSession(
          spec.ctx, spec.childSession, spec.homeDir, kimiSessionId, fromLines,
        )
        spec.ctx.localAgent.setKimiMirroredLines(spec.childSession.id, total)
      } catch (error) {
        spec.onError?.(thrown(error), 'error')
      }
    }
    return settled
  })

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
