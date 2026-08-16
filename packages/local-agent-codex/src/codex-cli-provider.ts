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
 * bundle's patch uses `subagent_codex_local` for the same reason (the
 * official presets carry a disabled `subagent_codex` row).
 * @module @khorsheed/dsh-local-agent-codex/codex-cli-provider
 */

import { randomUUID } from 'node:crypto'
import type { ContentBlock, TokenUsage } from '@deepseek-ai/dsh-llm'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
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
import { readCodexBaseUrl } from './provision.ts'

/** Default POSIX grace between subprocess termination tiers. */
export const DEFAULT_DISPOSE_GRACE_MS = 3_000

/** Codex sandbox policy values accepted by `codex exec --sandbox`. */
export type CodexSandbox = 'read-only' | 'workspace-write' | 'danger-full-access'

/**
 * One-shot and resumable Codex CLI subagent provider: every accepted FRESH run
 * starts a `codex exec` process in the delegating Session's workspace, under
 * the harness scoped home; a resume round (the family tool's staged resume
 * intent) continues the SAME thread with `codex exec --json resume <thread_id>`
 * inside the SAME dsh child session.
 */
export class CodexCliProvider implements SubagentProvider {
  readonly name = 'codex-local'
  readonly capabilities: SubagentCapabilities = NO_START_CAPABILITIES
  readonly inheritsParentContext = false

  constructor(
    private readonly ctx: Context,
    private readonly sandbox: CodexSandbox = 'workspace-write',
  ) {}

  async start(request: ResolvedSubagentStartRequest): Promise<SubagentRun> {
    const parentCwd = request.parent.session.header.cwd
    if (parentCwd === undefined) {
      throw new Error('subagent-codex: the parent session has no working directory to run the CLI in')
    }
    const homeDir = this.ctx.localAgent.homeDir('codex')
    // The family tool stages exactly one intent per delegation call; the
    // provider consumes exactly one per start. A resume intent continues the
    // recorded thread inside the existing child session.
    const intent = this.ctx.localAgent.takeDelegationIntent(request.parent.session.id, this.name)
    if (intent !== undefined && intent.kind === 'resume') {
      return this.startCodexResume(request, intent, parentCwd, homeDir)
    }
    return this.startCodexFresh(request, parentCwd, homeDir)
  }

  /** Fresh round: record the child session, spawn `codex exec`, append after settle. */
  private async startCodexFresh(
    request: ResolvedSubagentStartRequest,
    parentCwd: string,
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
          cwd: parentCwd,
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
    // config to route through a custom provider is authoritative). Log it so
    // a failing delegation reports which endpoint it actually used.
    const baseUrl = await readCodexBaseUrl(homeDir).catch(() => undefined)
    this.ctx.logger.info(`subagent-codex: delegating via ${baseUrl ?? 'codex default endpoint'}`)
    return startCodexCliRun(request, {
      cwd: parentCwd,
      env: { CODEX_HOME: homeDir },
      endpointLabel: baseUrl,
      sandbox: this.sandbox,
      disposeGraceMs: DEFAULT_DISPOSE_GRACE_MS,
      spawn: spec => this.ctx.subprocess.spawn(spec),
      onError: (error: unknown, stopReason) => {
        this.ctx.logger.warn(`subagent-codex: child run failed (${stopReason}) via ${baseUrl ?? 'codex default endpoint'}: ${error instanceof Error ? error.message : String(error)}`)
      },
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
        })
      },
    })
  }

  /** Resume round: continue the recorded thread inside the existing child session. */
  private async startCodexResume(
    request: ResolvedSubagentStartRequest,
    intent: { readonly kind: 'resume'; readonly childSessionId: string; readonly cliSessionId: string },
    parentCwd: string,
    homeDir: string,
  ): Promise<SubagentRun> {
    const sessions = this.ctx.get('sessions')
    const childSession = sessions?.get(SessionId(intent.childSessionId))
    if (childSession === undefined) {
      throw new Error(
        `subagent-codex: resume target child session ${intent.childSessionId} is not live — start a fresh delegation instead`,
      )
    }
    const nextTurn = childSession.events.filter(event => event.type === 'turn/start').length + 1
    const baseUrl = await readCodexBaseUrl(homeDir).catch(() => undefined)
    this.ctx.logger.info(`subagent-codex: resuming via ${baseUrl ?? 'codex default endpoint'}`)
    return startCodexCliRun(request, {
      cwd: parentCwd,
      env: { CODEX_HOME: homeDir },
      endpointLabel: baseUrl,
      sandbox: this.sandbox,
      disposeGraceMs: DEFAULT_DISPOSE_GRACE_MS,
      spawn: spec => this.ctx.subprocess.spawn(spec),
      onError: (error: unknown, stopReason) => {
        this.ctx.logger.warn(`subagent-codex: child run failed (${stopReason}) via ${baseUrl ?? 'codex default endpoint'}: ${error instanceof Error ? error.message : String(error)}`)
      },
      childSession,
      ctx: this.ctx,
      resume: { cliSessionId: intent.cliSessionId, turn: nextTurn },
    })
  }
}

/** Fully resolved inputs for one Codex CLI run. */
export interface CodexCliRunSpec {
  /** Parent Session workspace; also the codex process cwd. */
  readonly cwd: string
  /** Explicit environment layered after the shared credential scrub. */
  readonly env: Record<string, string>
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

/**
 * Parse a `codex exec --json` NDJSON event stream for the final answer, token
 * usage, and the thread id a later resume round continues. Each event is one
 * JSON line: `thread.started` names the session's thread, `item.completed`
 * carries an `agent_message` item whose text is the assistant's final reply,
 * and `turn.completed` carries the turn's usage. The last of each wins — a
 * one-shot run emits exactly one of each, but taking the last is robust to
 * tool-heavy turns that interleave multiple item completions. Malformed
 * lines are skipped; a stream with no usable events yields neither.
 * @param stream - the collected stdout NDJSON text.
 * @returns the final reply text, the turn usage, and the thread id, when present.
 */
export function parseCodexJsonStream(stream: string): { text?: string; usage?: TokenUsage; threadId?: string } {
  let text: string | undefined
  let usage: TokenUsage | undefined
  let threadId: string | undefined
  for (const raw of stream.split('\n')) {
    const line = raw.trim()
    if (line === '') continue
    let event: { type?: string; item?: { type?: string; text?: string }; usage?: unknown; thread_id?: unknown }
    try {
      event = JSON.parse(line) as { type?: string; item?: { type?: string; text?: string }; usage?: unknown; thread_id?: unknown }
    } catch {
      continue
    }
    if (event.type === 'thread.started' && typeof event.thread_id === 'string') {
      threadId = event.thread_id
    } else if (event.type === 'item.completed' && event.item?.type === 'agent_message') {
      text = event.item.text
    } else if (event.type === 'turn.completed' && event.usage !== undefined) {
      usage = usageFromCodex(event.usage)
    }
  }
  return text === undefined && usage === undefined && threadId === undefined
    ? {}
    : {
      ...text === undefined ? {} : { text },
      ...usage === undefined ? {} : { usage },
      ...threadId === undefined ? {} : { threadId },
    }
}

/**
 * Map codex's token-count payload onto the shared usage contract. Codex's
 * `input_tokens` is the TOTAL input including cache hits (OpenAI-style
 * accounting, confirmed against `total_tokens` in the rollout token_count),
 * and `cached_input_tokens` is the cache-read subset — so the uncached bucket
 * subtracts the cached portion to avoid double counting. There is no
 * cache-write concept, so that bucket is omitted.
 * @param usage - the raw codex usage object from `turn.completed`.
 * @returns the shared usage record.
 */
function usageFromCodex(usage: unknown): TokenUsage {
  const raw = usage as { input_tokens?: unknown; cached_input_tokens?: unknown; output_tokens?: unknown }
  const input = Number(raw.input_tokens)
  const cached = Number(raw.cached_input_tokens)
  const output = Number(raw.output_tokens)
  const uncached = Number.isFinite(input) && Number.isFinite(cached)
    ? Math.max(0, input - cached)
    : Number.isFinite(input)
      ? input
      : 0
  const usageRecord: TokenUsage = {
    inputTokens: uncached,
    outputTokens: Number.isFinite(output) ? output : 0,
  }
  if (Number.isFinite(cached) && cached > 0) usageRecord.cacheReadTokens = cached
  return usageRecord
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

  const child = spec.spawn({
    argv: spec.resume === undefined
      ? ['codex', 'exec', '--sandbox', spec.sandbox, '--json', task]
      : ['codex', 'exec', '--sandbox', spec.sandbox, '--json', 'resume', spec.resume.cliSessionId, task],
    cwd: spec.cwd,
    stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
    graceMs: spec.disposeGraceMs,
    env: spec.env,
  })

  // The turn opens at the real spawn moment so the timing projection
  // measures actual CLI runtime, not the post-hoc append time.
  spec.childSession?.append('turn/start', { turn })
  let output = ''
  child.stdout?.on('data', (chunk: Buffer) => { output += chunk.toString() })
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
    // may poll output again later.
    const text = parseCodexJsonStream(output).text?.trim()
    return text === undefined || text === '' ? [] : [{ type: 'text', text }]
  }

  const result: Promise<SubagentResult> = settleRunResult({
    attempt: () => Promise.race([
      child.done.then((outcome) => {
        // Every terminal path closes the turn so the timing window never
        // stays open on a failed or cancelled run: success settles
        // 'completed', a non-zero exit 'error', and a locally cancelled run
        // 'aborted'. The turn/end timestamp is the real settle moment.
        if (runAbort.signal.aborted) {
          spec.childSession?.append('turn/end', { turn, reason: { kind: 'aborted', reason: { kind: 'parent' } } })
          throw new Error('subagent-codex: run cancelled locally')
        }
        if (outcome.exitCode !== 0) {
          const via = spec.endpointLabel ?? 'codex default endpoint'
          spec.childSession?.append('turn/end', {
            turn,
            reason: { kind: 'error', error: { message: `codex exec exited with code ${String(outcome.exitCode)} via ${via}`, code: 'UNKNOWN' } },
          })
          throw new Error(`subagent-codex: codex exec exited with code ${String(outcome.exitCode)} via ${via}`)
        }
        // The turn closes at the real settle moment, so the timing
        // projection's duration equals the actual CLI runtime. Voided: the
        // run result settles with the child exit, and the append is
        // diagnostic-only (the subagent record degrades to a timing-less
        // final-text view when the child session is absent).
        const parsed = parseCodexJsonStream(output)
        spec.childSession?.append('turn/end', { turn, reason: { kind: 'completed' } })
        void appendCodexResponse(spec, task, turn, collectOutput(), parsed.usage)
        if (spec.resume === undefined) spec.onThreadId?.(parsed.threadId)
        return { output: collectOutput(), stopReason: 'completed' as const }
      }),
      processFailure,
    ]),
    collectOutput,
    cancelled: () => runAbort.signal.aborted,
    onError: spec.onError,
    signal: request.signal,
    onAbort,
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

/**
 * Append the delegation's user prompt and the codex response into the dsh
 * subagent session, then persist. Runs detached from the settle race — the
 * run result settles with the child exit, and a failure here is
 * diagnostic-only (the subagent record degrades to a final-text-only view).
 * The assistant message carries the round's usage when codex reported it, so
 * the tokenUsage projection counts the delegation.
 * @param spec - the run spec carrying the child session and host context.
 * @param task - the one-shot task text (the user prompt).
 * @param turn - the round's turn number (1 for a fresh round, incremented on resume).
 * @param output - the parsed codex response blocks.
 * @param usage - the turn's token usage from the NDJSON stream, when present.
 */
async function appendCodexResponse(
  spec: CodexCliRunSpec,
  task: string,
  turn: number,
  output: ContentBlock[],
  usage?: TokenUsage,
): Promise<void> {
  if (spec.childSession === undefined || spec.ctx === undefined) return
  try {
    spec.childSession.append('user/message', createUserMessage({
      content: [{ type: 'text', text: task }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    spec.childSession.append('assistant/message', {
      turn,
      step: 1,
      message: createAssistantMessage({
        content: output,
        source: { provider: 'codex-local', model: 'codex' },
      }),
      ...usage === undefined ? {} : { usage },
    }, { surfaceOp: 'append' })
    await spec.ctx.get('sessionPersistence')?.append(spec.childSession.id, spec.childSession.events)
  } catch (error) {
    spec.onError?.(thrown(error), 'error')
  }
}
