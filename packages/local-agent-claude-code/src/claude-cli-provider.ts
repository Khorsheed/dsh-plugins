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
import type { TodoItem } from '@deepseek-ai/dsh-session/types'
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
import { MEMBER_BRIDGE_SOCKET_ENV, MEMBER_BRIDGE_TOKEN_ENV } from '@khorsheed/dsh-local-agent/types'

/** Default POSIX grace between subprocess termination tiers. */
export const DEFAULT_DISPOSE_GRACE_MS = 3_000

/**
 * One-shot and resumable Claude Code CLI subagent provider: every accepted
 * FRESH run starts a `claude -p` process in the delegating Session's
 * workspace, under the harness scoped home; a resume round (the family tool's
 * staged resume intent) continues the SAME session with `claude -p --resume
 * <session_id>` inside the SAME dsh child session.
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

  /**
   * Register one run with the member channel and prepare the bridge MCP
   * declaration for the spawn argv. Claude Code takes a per-invocation
   * `--mcp-config <json>` flag (verified end-to-end against the real CLI), so
   * the declaration is a single JSON string — nothing is written to the
   * scoped home and there is nothing to prune at settle; `release` only
   * invalidates the token. Returns undefined when the mounted core predates
   * the member channel (declare-and-degrade: the run proceeds unchanged).
   */
  private memberRun(
    childSessionId: string,
    parentSessionId: string,
  ): { token: string; mcpConfig: string; allowedTool: string; bind(pid: number): void; release(): void } | undefined {
    const registry = this.ctx.localAgent
    if (
      typeof registry.registerMemberRun !== 'function'
      || typeof registry.memberBridgeSocketPath !== 'function'
      || typeof registry.memberBridgeCommand !== 'function'
    ) return undefined
    const token = registry.registerMemberRun({ childSessionId, parentSessionId, provider: this.name })
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
      // The one tool the bridge exposes, pre-allowed so `claude -p` (whose
      // non-interactive mode auto-denies permission prompts) can call it.
      allowedTool: `mcp__${serverName}__member_message`,
      bind: pid => registry.bindMemberRunPid(token, pid),
      release: () => {
        if (released) return
        released = true
        registry.unregisterMemberRun(token)
      },
    }
  }

  async start(request: ResolvedSubagentStartRequest): Promise<SubagentRun> {
    const parentCwd = request.parent.session.header.cwd
    if (parentCwd === undefined) {
      throw new Error('subagent-claude: the parent session has no working directory to run the CLI in')
    }
    const homeDir = this.ctx.localAgent.homeDir('claude-code')
    // The family tool stages exactly one intent per delegation call; the
    // provider consumes exactly one per start. A resume intent continues the
    // recorded session inside the existing child session.
    const intent = this.ctx.localAgent.takeDelegationIntent(request.parent.session.id, this.name)
    if (intent !== undefined && intent.kind === 'resume') {
      return this.startClaudeResume(request, intent, parentCwd, homeDir)
    }
    return this.startClaudeFresh(request, parentCwd, homeDir)
  }

  /** Fresh round: record the child session, spawn `claude -p`, append after settle. */
  private async startClaudeFresh(
    request: ResolvedSubagentStartRequest,
    parentCwd: string,
    homeDir: string,
  ): Promise<SubagentRun> {
    const runId = SessionId(randomUUID())
    // Member channel: register this run and carry the bridge declaration on
    // the spawn argv, so the CLI session starts with member_message available.
    const member = this.memberRun(runId, request.parent.session.id)
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
    // Resolve the effective endpoint once per run: the cordis Config field
    // wins, else the host environment's ANTHROPIC_BASE_URL (a STARTUP-time
    // snapshot — a long-running dsh process does not see later shell exports),
    // else the CLI's own default. Log it (without the key) so a failing
    // delegation reports which endpoint it actually used.
    const effectiveBaseUrl = this.baseUrl ?? process.env.ANTHROPIC_BASE_URL
    this.ctx.logger.info(`subagent-claude: delegating via ${effectiveBaseUrl ?? 'claude default endpoint'}`)
    try {
      const run = await startClaudeCliRun(request, {
        cwd: parentCwd,
        env: {
          CLAUDE_CONFIG_DIR: homeDir,
          ...this.baseUrl === undefined ? {} : { ANTHROPIC_BASE_URL: this.baseUrl },
        },
        endpointLabel: effectiveBaseUrl,
        permissionMode: this.permissionMode,
        disposeGraceMs: DEFAULT_DISPOSE_GRACE_MS,
        spawn: spec => this.ctx.subprocess.spawn(spec),
        onError: (error: unknown, stopReason) => {
          this.ctx.logger.warn(`subagent-claude: child run failed (${stopReason}) via ${effectiveBaseUrl ?? 'claude default endpoint'}: ${error instanceof Error ? error.message : String(error)}`)
        },
        onSpawned: (pid) => { member?.bind(pid) },
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

  /** Resume round: continue the recorded claude session inside the existing child session. */
  private async startClaudeResume(
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
        `subagent-claude: 该子会话有进行中的委派，等其完成后再追问 (child session ${intent.childSessionId})`,
      )
    }
    // Member channel: register the resume round (same child session, fresh
    // per-run token) before the spawn.
    const member = this.memberRun(intent.childSessionId, request.parent.session.id)
    try {
      const sessions = this.ctx.get('sessions')
      const childSession = sessions?.get(SessionId(intent.childSessionId))
      if (childSession === undefined) {
        throw new Error(
          `subagent-claude: resume target child session ${intent.childSessionId} is not live — start a fresh delegation instead`,
        )
      }
      const nextTurn = childSession.events.filter(event => event.type === 'turn/start').length + 1
      const effectiveBaseUrl = this.baseUrl ?? process.env.ANTHROPIC_BASE_URL
      this.ctx.logger.info(`subagent-claude: resuming via ${effectiveBaseUrl ?? 'claude default endpoint'}`)
      const run = await startClaudeCliRun(request, {
        cwd: parentCwd,
        env: {
          CLAUDE_CONFIG_DIR: homeDir,
          ...this.baseUrl === undefined ? {} : { ANTHROPIC_BASE_URL: this.baseUrl },
        },
        endpointLabel: effectiveBaseUrl,
        permissionMode: this.permissionMode,
        disposeGraceMs: DEFAULT_DISPOSE_GRACE_MS,
        spawn: spec => this.ctx.subprocess.spawn(spec),
        onError: (error: unknown, stopReason) => {
          this.ctx.logger.warn(`subagent-claude: child run failed (${stopReason}) via ${effectiveBaseUrl ?? 'claude default endpoint'}: ${error instanceof Error ? error.message : String(error)}`)
        },
        onSpawned: (pid) => { member?.bind(pid) },
        ...member === undefined ? {} : { member: { mcpConfig: member.mcpConfig, allowedTool: member.allowedTool } },
        childSession,
        ctx: this.ctx,
        resume: { cliSessionId: intent.cliSessionId, turn: nextTurn },
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
      this.ctx.localAgent.releaseResumeLock(intent.childSessionId)
      member?.release()
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
  readonly env: Record<string, string>
  /** Resolved endpoint label for diagnostics; absent means the CLI default. */
  readonly endpointLabel?: string | undefined
  /** Permission mode passed to `claude -p`. */
  readonly permissionMode: 'skip' | 'normal'
  /** Subprocess termination grace passed to the shared process-tree owner. */
  readonly disposeGraceMs: number
  /** Shared subprocess service spawn operation. */
  readonly spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle
  /** Diagnostic sink for a post-publication error flattened into a result. */
  readonly onError?: (error: Error, stopReason: SubagentStopReason) => void
  /** Called with the spawned CLI pid right after spawn (member-channel pid binding). */
  readonly onSpawned?: (pid: number) => void
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
  | { kind: 'think'; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'tool'; name: string; detail?: string; result?: string }

/** Mutable fold state shared by the batch parse and the incremental parser. */
interface ClaudeStreamFoldState {
  readonly lines: ClaudeTranscriptLine[]
  text: string | undefined
  usage: TokenUsage | undefined
  sessionId: string | undefined
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
  const last = childSession.events.filter(event => event.type === 'todo/write').at(-1)
  if (last !== undefined && JSON.stringify(last.data) === JSON.stringify({ todos })) return false
  // todo/write's append takes no surface options (log-only UI state).
  childSession.append('todo/write', { todos })
  return true
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
    message?: { content?: unknown[]; type?: string }
    is_error?: unknown
    error?: unknown
    usage?: unknown
    session_id?: unknown
    result?: unknown
  }
  try {
    event = JSON.parse(line) as typeof event
  } catch {
    return
  }
  if (event.type === 'system' && typeof event.session_id === 'string') {
    state.sessionId = event.session_id
    return
  }
  if (event.type === 'result') {
    state.completed = true
    if (event.is_error === true) {
      state.error = typeof event.error === 'string' ? event.error : 'claude -p reported an error'
    }
    if (typeof event.session_id === 'string') state.sessionId = event.session_id
    if (event.usage !== undefined) state.usage = usageFromClaude(event.usage)
    return
  }
  if (event.type !== 'assistant' && event.type !== 'user') return
  const blocks = event.message?.content ?? []
  for (const block of blocks) {
    if (typeof block !== 'object' || block === null) continue
    const record = block as Record<string, unknown>
    const kind = record['type']
    if (kind === 'text' && typeof record['text'] === 'string' && (record['text'] as string).trim() !== '') {
      state.lines.push({ kind: 'text', text: record['text'] as string })
      // The final assistant text block is the run output.
      if (event.type === 'assistant') state.text = record['text'] as string
    } else if (kind === 'thinking' && typeof record['thinking'] === 'string' && (record['thinking'] as string).trim() !== '') {
      state.lines.push({ kind: 'think', text: record['thinking'] as string })
    } else if (kind === 'tool_use') {
      const name = typeof record['name'] === 'string' ? record['name'] : 'tool'
      if (name === 'TodoWrite') {
        const todos = todosFromTodoWrite(record['input'])
        if (todos !== undefined) {
          state.todos = todos
          continue // intercepted before the text fold
        }
        // Shape skew: degrade to the plain text fold; the mirror paths warn.
        state.todoSkew = true
      }
      const detail = inputDetail(record['input'])
      state.lines.push({
        kind: 'tool',
        name,
        ...detail === undefined ? {} : { detail },
      })
    } else if (kind === 'tool_result') {
      const content = record['content']
      const resultText = toolResultText(content)
      if (resultText !== undefined && resultText.trim() !== '') {
        const last = state.lines[state.lines.length - 1]
        if (last !== undefined && last.kind === 'tool') {
          state.lines[state.lines.length - 1] = { ...last, result: resultText }
        }
      }
    }
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
  text: string | undefined
  usage: TokenUsage | undefined
  sessionId: string | undefined
  error: string | undefined
  completed = false
  todos: TodoItem[] | undefined
  todoSkew = false

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
 * Each line is one event: `system` init (carries the session id), `assistant`
 * (content blocks: `text`, `tool_use`, `thinking`), `user` (a `tool_result`
 * block), and a terminal `result` (final usage, error flag, session id).
 * Content blocks fold into an ordered transcript (thinking, reply text, tool
 * calls with results), the last assistant `text` becomes the run output, and
 * the `result` event's usage/session id ride the parse. A malformed stream or
 * an `is_error` result yields the error instead.
 * @param output - the collected stdout NDJSON text.
 * @returns the ordered transcript, final answer text, usage, session id, and
 *   the error when the run reported one.
 */
export function parseClaudeStreamJson(output: string): {
  lines: readonly ClaudeTranscriptLine[]
  text?: string
  usage?: TokenUsage
  error?: string
  sessionId?: string
  /** The stream's last TodoWrite translation, when one was folded. */
  todos?: TodoItem[]
  /** Whether a shape-skewed TodoWrite degraded to the text fold. */
  todoSkew?: boolean
} {
  const state: ClaudeStreamFoldState = {
    lines: [],
    text: undefined,
    usage: undefined,
    sessionId: undefined,
    error: undefined,
    completed: false,
    todos: undefined,
    todoSkew: false,
  }
  for (const raw of output.split('\n')) foldClaudeStreamLine(state, raw)
  return {
    lines: state.lines,
    ...state.text === undefined ? {} : { text: state.text },
    ...state.usage === undefined ? {} : { usage: state.usage },
    ...state.error === undefined ? {} : { error: state.error },
    ...state.sessionId === undefined ? {} : { sessionId: state.sessionId },
    ...state.todos === undefined ? {} : { todos: state.todos },
    ...state.todoSkew === false ? {} : { todoSkew: true },
  }
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
export function startClaudeCliRun(
  request: SubagentStartRequest,
  spec: ClaudeCliRunSpec,
): Promise<SubagentRun> {
  const task = textTask(request.prompt)
  if (request.signal.aborted) {
    throw new Error('subagent-claude: request was aborted before the CLI started')
  }
  const turn = spec.resume?.turn ?? 1
  // The member bridge flags ride every argv variant (skip and normal
  // permission modes alike): --allowedTools is redundant under
  // --dangerously-skip-permissions but keeps the injection uniform.
  const memberArgv = spec.member === undefined
    ? []
    : ['--mcp-config', spec.member.mcpConfig, '--allowedTools', spec.member.allowedTool]
  // --verbose is required by the CLI when --print and stream-json combine.
  const argv = spec.resume === undefined
    ? spec.permissionMode === 'skip'
      ? ['claude', '-p', '--dangerously-skip-permissions', '--verbose', '--output-format', 'stream-json', ...memberArgv, task]
      : ['claude', '-p', '--verbose', '--output-format', 'stream-json', ...memberArgv, task]
    : spec.permissionMode === 'skip'
      ? ['claude', '-p', '--dangerously-skip-permissions', '--verbose', '--resume', spec.resume.cliSessionId, '--output-format', 'stream-json', ...memberArgv, task]
      : ['claude', '-p', '--verbose', '--resume', spec.resume.cliSessionId, '--output-format', 'stream-json', ...memberArgv, task]

  const child = spec.spawn({
    argv,
    cwd: spec.cwd,
    stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
    graceMs: spec.disposeGraceMs,
    env: spec.env,
  })
  spec.onSpawned?.(child.pid)

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
    // may poll output again later.
    const text = parseClaudeStreamJson(output).text?.trim()
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
    () => mirrorClaudeAfterExit(spec, task, turn, output, liveMirror),
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

/** Fold one transcript line into the child session as one assistant step. */
function appendClaudeLine(
  spec: ClaudeCliRunSpec,
  turn: number,
  step: number,
  line: ClaudeTranscriptLine,
  usage: TokenUsage | undefined,
): void {
  const blocks = line.kind === 'think'
    ? [{ type: 'reasoning' as const, text: line.text }]
    : line.kind === 'tool'
      ? [{
        type: 'text' as const,
        text: `[工具 ${line.name}]${line.detail !== undefined ? ` ${line.detail}` : ''}${line.result !== undefined ? ` → ${line.result}` : ''}`,
      }]
      : [{ type: 'text' as const, text: line.text }]
  spec.childSession?.append('assistant/message', {
    turn,
    step,
    message: createAssistantMessage({
      content: blocks,
      source: { provider: 'claude-local', model: 'claude' },
    }),
    ...usage === undefined ? {} : { usage },
  }, { surfaceOp: 'append' })
}

/** The delta-progress text for one transcript line. */
function claudeLineText(line: ClaudeTranscriptLine): string {
  return line.kind === 'tool'
    ? `[工具 ${line.name}]${line.detail !== undefined ? ` ${line.detail}` : ''}${line.result !== undefined ? ` → ${line.result}` : ''}`
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
          for (let index = mirrored; index < upto; index += 1) {
            const line = parser.lines[index]
            if (line === undefined) continue
            const usage = parser.completed && index === parser.lines.length - 1 ? parser.usage : undefined
            appendClaudeLine(spec, turn, index + 1, line, usage)
            mirrored = index + 1
            localAgent?.reportRunProgress(childSession.id, { kind: 'delta', text: claudeLineText(line) })
          }
          await ctx.get('sessionPersistence')?.append(childSession.id, childSession.events)
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
  let step = fromLines + 1
  for (const line of parsed.lines.slice(fromLines)) {
    appendClaudeLine(spec, turn, step, line, step === parsed.lines.length ? parsed.usage : undefined)
    localAgent?.reportRunProgress(childSession.id, { kind: 'delta', text: claudeLineText(line) })
    step += 1
  }
  await spec.ctx.get('sessionPersistence')?.append(childSession.id, childSession.events)
  localAgent?.reportRunProgress(childSession.id, { kind: 'mirror', mirroredLines: parsed.lines.length })
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
