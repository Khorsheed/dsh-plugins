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
 * tool row in this bundle's patch uses `subagent_claude_code_local` for the
 * same reason (the official presets carry a disabled
 * `subagent_claude_code` row).
 * @module @khorsheed/dsh-local-agent-claude-code/claude-cli-provider
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

/** Default POSIX grace between subprocess termination tiers. */
export const DEFAULT_DISPOSE_GRACE_MS = 3_000

/**
 * One-shot Claude Code CLI subagent provider: every accepted run starts a
 * fresh `claude -p` process in the delegating Session's workspace, under the
 * harness scoped home.
 */
export class ClaudeCliProvider implements SubagentProvider {
  readonly name = 'claude-local'
  readonly capabilities: SubagentCapabilities = NO_START_CAPABILITIES
  readonly inheritsParentContext = false

  constructor(
    private readonly ctx: Context,
    private readonly permissionMode: 'skip' | 'normal' = 'skip',
    private readonly baseUrl?: string,
  ) {}

  start(request: ResolvedSubagentStartRequest): Promise<SubagentRun> {
    const parentCwd = request.parent.session.header.cwd
    if (parentCwd === undefined) {
      throw new Error('subagent-claude: the parent session has no working directory to run the CLI in')
    }
    const homeDir = this.ctx.localAgent.homeDir('claude-code')
    // A dsh subagent session records the delegation so it appears in the
    // standard 子代理 surface; the response is appended after the run
    // settles. Failure to create or persist the record degrades to the
    // plain one-shot run rather than failing the delegation.
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
      const harness = this.ctx.localAgent.get('claude-code')
      childSession.append('subagent/descriptor', {
        ...request.descriptor,
        label: subagentDelegationLabel(harness?.displayName ?? 'Claude Code', request.descriptor.label),
      })
      void this.ctx.get('sessionPersistence')?.create(childSession.header).catch(() => {})
    } catch (error) {
      this.ctx.logger.warn(`subagent-claude: subagent session record failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    return startClaudeCliRun(request, {
      cwd: parentCwd,
      env: {
        CLAUDE_CONFIG_DIR: homeDir,
        ...this.baseUrl === undefined ? {} : { ANTHROPIC_BASE_URL: this.baseUrl },
      },
      permissionMode: this.permissionMode,
      disposeGraceMs: DEFAULT_DISPOSE_GRACE_MS,
      spawn: spec => this.ctx.subprocess.spawn(spec),
      onError: (error: unknown, stopReason) => {
        this.ctx.logger.warn(`subagent-claude: child run failed (${stopReason}): ${error instanceof Error ? error.message : String(error)}`)
      },
      childSession,
      ctx: this.ctx,
    })
  }
}

/** Fully resolved inputs for one Claude CLI run. */
export interface ClaudeCliRunSpec {
  /** Parent Session workspace; also the claude process cwd. */
  readonly cwd: string
  /** Explicit environment layered after the shared credential scrub. */
  readonly env: Record<string, string>
  /** Permission mode passed to `claude -p`. */
  readonly permissionMode: 'skip' | 'normal'
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

/**
 * Parse a `claude -p --output-format json` result payload. The single JSON
 * line carries `result` (the final answer), `usage` (Anthropic-style
 * counters), and `session_id`. A malformed or error result yields neither.
 * @param output - the collected stdout.
 * @returns the final answer text and the usage, when present.
 */
export function parseClaudeJsonResult(output: string): { text?: string; usage?: TokenUsage; error?: string } {
  let result: { result?: unknown; is_error?: unknown; error?: unknown; usage?: unknown; session_id?: unknown }
  try {
    result = JSON.parse(output) as { result?: unknown; is_error?: unknown; error?: unknown; usage?: unknown; session_id?: unknown }
  } catch {
    return {}
  }
  if (result.is_error === true) {
    return { error: typeof result.error === 'string' ? result.error : 'claude -p reported an error' }
  }
  const text = typeof result.result === 'string' ? result.result : undefined
  const usage = result.usage === undefined ? undefined : usageFromClaude(result.usage)
  return {
    ...text === undefined ? {} : { text },
    ...usage === undefined ? {} : { usage },
  }
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
 * Start the real `claude -p` child and publish its one-shot run. The claude
 * result arrives as a single JSON line on stdout (`--output-format json`):
 * `result` is the final answer and `usage` the token accounting. stderr is
 * piped for diagnostics and never folded into the run output.
 * @param request - resolved shared subagent request.
 * @param spec - workspace, environment, process service, and diagnostic policy.
 * @returns the published run after the child starts.
 */
export function startClaudeCliRun(
  request: SubagentStartRequest,
  spec: ClaudeCliRunSpec,
): Promise<SubagentRun> {
  const task = textTask(request.prompt)
  if (request.signal.aborted) {
    throw new Error('subagent-claude: request was aborted before the CLI started')
  }
  const argv = spec.permissionMode === 'skip'
    ? ['claude', '-p', '--dangerously-skip-permissions', '--output-format', 'json', task]
    : ['claude', '-p', '--output-format', 'json', task]

  const child = spec.spawn({
    argv,
    cwd: spec.cwd,
    stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
    graceMs: spec.disposeGraceMs,
    env: spec.env,
  })

  // The turn opens at the real spawn moment so the timing projection
  // measures actual CLI runtime, not the post-hoc append time.
  spec.childSession?.append('turn/start', { turn: 1 })
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
    runAbort.abort(new Error('subagent-claude: run cancelled locally'))
  }
  const onAbort = (): void => { requestCancel() }
  request.signal.addEventListener('abort', onAbort, { once: true })

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
    // may poll output again later.
    const text = parseClaudeJsonResult(output).text?.trim()
    return text === undefined || text === '' ? [] : [{ type: 'text', text }]
  }

  const result: Promise<SubagentResult> = settleRunResult({
    attempt: () => Promise.race([
      child.done.then((outcome) => {
        // Every terminal path closes the turn so the timing window never
        // stays open on a failed or cancelled run.
        if (runAbort.signal.aborted) {
          spec.childSession?.append('turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'parent' } } })
          throw new Error('subagent-claude: run cancelled locally')
        }
        if (outcome.exitCode !== 0) {
          spec.childSession?.append('turn/end', {
            turn: 1,
            reason: { kind: 'error', error: { message: `claude -p exited with code ${String(outcome.exitCode)}`, code: 'UNKNOWN' } },
          })
          throw new Error(`subagent-claude: claude -p exited with code ${String(outcome.exitCode)}`)
        }
        // The turn closes at the real settle moment, so the timing
        // projection's duration equals the actual CLI runtime. Voided: the
        // run result settles with the child exit, and the append is
        // diagnostic-only (the subagent record degrades to a timing-less
        // final-text view when the child session is absent).
        const parsed = parseClaudeJsonResult(output)
        if (parsed.error !== undefined) {
          spec.childSession?.append('turn/end', {
            turn: 1,
            reason: { kind: 'error', error: { message: parsed.error, code: 'UNKNOWN' } },
          })
          throw new Error(`subagent-claude: ${parsed.error}`)
        }
        spec.childSession?.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
        void appendClaudeResponse(spec, task, collectOutput(), parsed.usage)
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
    id: SessionId(randomUUID()),
    result,
    signal: request.signal,
    onAbort,
    requestCancel,
    teardown: disposeProcess,
  }))
}

/**
 * Append the delegation's user prompt and the claude response into the dsh
 * subagent session, then persist. Runs detached from the settle race — the
 * run result settles with the child exit, and a failure here is
 * diagnostic-only. The assistant message carries the turn's usage when
 * claude reported it, so the tokenUsage projection counts the delegation.
 * @param spec - the run spec carrying the child session and host context.
 * @param task - the one-shot task text (the user prompt).
 * @param output - the parsed claude response blocks.
 * @param usage - the turn's token usage, when present.
 */
async function appendClaudeResponse(
  spec: ClaudeCliRunSpec,
  task: string,
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
      turn: 1,
      step: 1,
      message: createAssistantMessage({
        content: output,
        source: { provider: 'claude-local', model: 'claude' },
      }),
      ...usage === undefined ? {} : { usage },
    }, { surfaceOp: 'append' })
    await spec.ctx.get('sessionPersistence')?.append(spec.childSession.id, spec.childSession.events)
  } catch (error) {
    spec.onError?.(thrown(error), 'error')
  }
}
