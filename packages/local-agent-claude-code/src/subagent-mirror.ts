/**
 * A Claude Code member's own subagents, mirrored as grandchild sessions
 * (member-cli-subagents design, step M4).
 *
 * When a member's `claude` calls its `Agent` tool (the older name is `Task`),
 * the CLI runs a subagent and records it beside the member's own transcript:
 *
 * - `<CLAUDE_CONFIG_DIR>/projects/<slug>/<cliSession>/subagents/agent-<id>.meta.json`
 *   carries `toolUseId` (the member's `Agent` tool_use id), `agentType`,
 *   `description`, and, on recent CLI builds, `finished: true` once the
 *   subagent is done;
 * - `agent-<id>.jsonl` beside it is the subagent's transcript (every line
 *   `isSidechain: true`): the prompt as the first `user` line, then one
 *   `assistant` line per content block (the lines of one API call share
 *   `message.id` and repeat its usage), `user` tool_result lines, and
 *   `attachment`/`api-request*`/`system` lines that are not mirrored.
 *
 * {@link ClaudeSubagentMirror} pairs each subagent with the member's call by
 * `toolUseId`, tails the transcript by byte offset, and writes each API call
 * as one step into the grandchild session through the core's
 * `openCliSubagent` writer (one subagent = one session = one execution = one
 * turn). The stream's `parent_tool_use_id` events stay a liveness signal
 * only: they schedule a tail, they never carry content.
 *
 * Closing rules (the design's front/background split):
 * - **Foreground**: the member's tool_result for the call is the subagent's
 *   answer. Its arrival flushes the transcript and ends the execution `done`.
 *   A member round that settles before that ends it `cancelled`.
 * - **Background** (`run_in_background`, or a tool result that reports
 *   `async_launched`): the member's round ends first, and the execution stays
 *   open. It ends `done` when the meta reports `finished`. It ends
 *   `uncertain` when the member's process goes away first (a reclaim, a
 *   crash, a model switch). On the exec path the process has already exited
 *   at settle, so a background subagent the meta does not report finished
 *   ends `cancelled` there.
 *
 * Everything here degrades: a missing file, a half-written meta, a format
 * this reader does not know, or a writer failure only means the subagent is
 * not mirrored. The member's round is never affected.
 * @module @khorsheed/dsh-local-agent-claude-code/subagent-mirror
 */
import { open, readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import {
  appendRequestHeaderIfChanged,
  openCliSubagent,
  type CliSubagentExecution,
  type CliSubagentHandle,
  type MirrorTransport,
} from '@khorsheed/dsh-local-agent'
import type { LocalAgentExecutionOutcome } from '@khorsheed/dsh-local-agent/types'
import {
  ClaudeStreamParser,
  claudeMirrorSource,
  claudeSubagentParentId,
  groupClaudeTranscriptLines,
  type ClaudeTranscriptLine,
} from './claude-cli-provider.ts'

/** The member tool names that start a Claude Code subagent (`Task` is the pre-2.x name). */
export const CLAUDE_SUBAGENT_TOOLS: ReadonlySet<string> = new Set(['Agent', 'Task'])

/** The delegation provider the grandchild's descriptor names (the member's own). */
const PROVIDER = 'claude-local'

/** One member `Agent`/`Task` call as the member's stream showed it. */
interface MemberCall {
  readonly id: string
  readonly description?: string | undefined
  readonly subagentType?: string | undefined
  /** `run_in_background: true` on the call, or an `async_launched` tool result. */
  background: boolean
  /** The member's tool_result arrived (for a foreground call: the subagent's answer). */
  resulted: boolean
  /** The subagent id the tool result named (`toolUseResult.agentId`), when it did. */
  agentId?: string | undefined
}

/** One paired subagent: its transcript cursor and its grandchild execution. */
interface Tail {
  readonly agentId: string
  readonly call: MemberCall
  readonly transcript: string
  readonly meta: string
  readonly name?: string | undefined
  readonly description?: string | undefined
  /** Byte offset already read; the partial last line waits in `rest`. */
  offset: number
  rest: string
  readonly parser: ClaudeStreamParser
  /** The subagent's prompt (its first user line). */
  prompt?: string | undefined
  /** The model the transcript's assistant lines name. */
  model?: string | undefined
  firstAt?: number | undefined
  lastAt?: number | undefined
  /** Transcript lines already written as steps. */
  mirrored: number
  promptWritten: boolean
  handle?: CliSubagentHandle | undefined
  execution?: CliSubagentExecution | undefined
  ended: boolean
  /** The meta reported `finished: true`. */
  finished: boolean
}

/** Options for {@link ClaudeSubagentMirror}. */
export interface ClaudeSubagentMirrorOptions {
  readonly ctx: Context
  /** The member's live dsh child session. */
  readonly member: Session
  /** The `claude-code` scoped home the member's CLI runs against (`CLAUDE_CONFIG_DIR`). */
  readonly homeDir: string
  /** How the member's rounds run: picks the harness's `unrecorded` declaration. */
  readonly transport: MirrorTransport
  /** The coalescing delay for liveness-driven tails (ms); default 250. */
  readonly tailDelayMs?: number | undefined
  /** How often open background subagents are re-read between rounds (ms); default 2000. */
  readonly pollMs?: number | undefined
}

type JsonObject = Record<string, unknown>

const asObject = (value: unknown): JsonObject | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as JsonObject : undefined

const nonEmpty = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value : undefined

/** The text of a transcript `user` line's prompt (a string, or text blocks). */
function promptText(content: unknown): string | undefined {
  if (typeof content === 'string') return nonEmpty(content)
  if (!Array.isArray(content)) return undefined
  const texts = content.flatMap(block => {
    const record = asObject(block)
    return record?.['type'] === 'text' && typeof record['text'] === 'string' ? [record['text']] : []
  })
  return texts.length === 0 ? undefined : nonEmpty(texts.join('\n'))
}

/** Whether a member tool_result says the call went to the background (`async_launched`). */
function launchedAsync(event: JsonObject, block: JsonObject): { async: boolean; agentId?: string } {
  // The transcript spells it `toolUseResult`; stream-json spells it `tool_use_result`.
  const result = asObject(event['tool_use_result']) ?? asObject(event['toolUseResult'])
  const agentId = nonEmpty(result?.['agentId'])
  if (result?.['status'] === 'async_launched' || result?.['isAsync'] === true) return { async: true, ...agentId === undefined ? {} : { agentId } }
  // Without the structured field, the CLI's own launch notice is the signal.
  const content = block['content']
  const text = typeof content === 'string' ? content
    : Array.isArray(content) ? content.map(part => asObject(part)?.['text']).filter(part => typeof part === 'string').join('\n') : ''
  return { async: /^Async agent launched/.test(text.trimStart()), ...agentId === undefined ? {} : { agentId } }
}

/**
 * One member's Claude Code subagents, mirrored into grandchild sessions.
 * One instance lives as long as the member's CLI process can run subagents:
 * per live runtime (it outlives a round for background subagents), per exec
 * round otherwise.
 */
export class ClaudeSubagentMirror {
  private readonly calls = new Map<string, MemberCall>()
  private readonly tails = new Map<string, Tail>()
  private cliSessionId: string | undefined
  private subagentsDir: string | undefined
  private queue: Promise<void> = Promise.resolve()
  private tailTimer: NodeJS.Timeout | undefined
  private pollTimer: NodeJS.Timeout | undefined
  private disposed = false

  constructor(private readonly options: ClaudeSubagentMirrorOptions) {}

  /** The CLI session the member runs (the stream's init `session_id`). */
  setCliSession(sessionId: string | undefined): void {
    if (sessionId === undefined || sessionId === this.cliSessionId) return
    this.cliSessionId = sessionId
    this.subagentsDir = undefined
  }

  /** Whether any subagent's execution is still open. */
  get open(): boolean {
    return [...this.tails.values()].some(tail => !tail.ended) || [...this.calls.values()].some(call => !this.paired(call))
  }

  private paired(call: MemberCall): boolean {
    return [...this.tails.values()].some(tail => tail.call === call)
  }

  /**
   * Observe one member stream-json event. The member's `Agent`/`Task`
   * tool_use registers a call; its tool_result marks the call answered (or
   * launched in the background); a subagent's own event (`parent_tool_use_id`)
   * is only the signal that a tail is due. Returns whether a tail is due.
   */
  observe(event: JsonObject): boolean {
    if (this.disposed) return false
    if (event['type'] === 'system' && typeof event['session_id'] === 'string') {
      this.setCliSession(event['session_id'])
      return false
    }
    if (claudeSubagentParentId(event) !== undefined) return this.calls.size > 0
    if (event['type'] !== 'assistant' && event['type'] !== 'user') return false
    const content = asObject(event['message'])?.['content']
    if (!Array.isArray(content)) return false
    let due = false
    for (const raw of content) {
      const block = asObject(raw)
      if (block === undefined) continue
      if (event['type'] === 'assistant' && block['type'] === 'tool_use' && typeof block['id'] === 'string'
        && typeof block['name'] === 'string' && CLAUDE_SUBAGENT_TOOLS.has(block['name'])) {
        if (this.calls.has(block['id'])) continue
        const input = asObject(block['input'])
        this.calls.set(block['id'], {
          id: block['id'],
          description: nonEmpty(input?.['description']),
          subagentType: nonEmpty(input?.['subagent_type']),
          background: input?.['run_in_background'] === true,
          resulted: false,
        })
        due = true
      } else if (event['type'] === 'user' && block['type'] === 'tool_result' && typeof block['tool_use_id'] === 'string') {
        const call = this.calls.get(block['tool_use_id'])
        if (call === undefined || call.resulted) continue
        call.resulted = true
        const launched = launchedAsync(event, block)
        if (launched.async) call.background = true
        if (launched.agentId !== undefined) call.agentId = launched.agentId
        due = true
      }
    }
    return due
  }

  /** Observe every line of a whole stream-json text (the exec path's settle read). */
  observeStream(output: string): void {
    for (const raw of output.split('\n')) {
      if (raw.trim() === '') continue
      try {
        const event = asObject(JSON.parse(raw))
        if (event !== undefined) this.observe(event)
      } catch {
        // A truncated line is not this reader's to repair.
      }
    }
  }

  /** Coalesce a tail after a burst of stream events (the live path). */
  schedule(): void {
    if (this.disposed || this.tailTimer !== undefined) return
    this.tailTimer = setTimeout(() => {
      this.tailTimer = undefined
      void this.tail()
    }, this.options.tailDelayMs ?? 250)
    this.tailTimer.unref?.()
  }

  /** Discover new subagents, mirror new transcript lines, and close what is done. Serialized. */
  tail(): Promise<void> {
    return this.enqueue(async () => {
      await this.pass()
      this.armPoll()
    })
  }

  /**
   * The member's round settled. Tail once more; a foreground subagent still
   * without its answer ends `cancelled` (the member stopped waiting). A
   * background subagent stays open unless `processExited` (the exec path's
   * one-shot), where it ends `done` when the meta says finished, else
   * `cancelled`.
   */
  settleRound(options: { readonly processExited: boolean }): Promise<void> {
    return this.enqueue(async () => {
      await this.pass()
      for (const tail of this.tails.values()) {
        if (tail.ended) continue
        if (!tail.call.background) await this.finish(tail, tail.call.resulted ? 'done' : 'cancelled')
        else if (options.processExited) await this.finish(tail, tail.finished ? 'done' : 'cancelled')
      }
      // A call whose subagent never left a record has nothing to mirror.
      for (const call of [...this.calls.values()]) {
        if (!this.paired(call) && (!call.background || options.processExited)) this.calls.delete(call.id)
      }
      this.armPoll()
    })
  }

  /**
   * The member's CLI process is gone (reclaimed, crashed, retired): a
   * subagent still open can no longer finish. Its execution ends
   * `uncertain` after a last tail.
   */
  lost(): Promise<void> {
    return this.enqueue(async () => {
      await this.pass()
      for (const tail of this.tails.values()) {
        if (!tail.ended) await this.finish(tail, tail.finished ? 'done' : 'uncertain')
      }
      this.calls.clear()
      this.armPoll()
    })
  }

  /** Stop the timers (the owner is going away); open executions stay as written. */
  dispose(): void {
    this.disposed = true
    if (this.tailTimer !== undefined) clearTimeout(this.tailTimer)
    if (this.pollTimer !== undefined) clearInterval(this.pollTimer)
    this.tailTimer = undefined
    this.pollTimer = undefined
  }

  /** Wait for every queued pass (tests, and owners that must not outrun the writer). */
  idle(): Promise<void> {
    return this.enqueue(async () => {})
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    this.queue = this.queue.catch(() => {}).then(async () => {
      try {
        await task()
      } catch (error) {
        this.options.ctx.logger?.warn?.(`subagent-claude: subagent mirror failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    })
    return this.queue
  }

  /** Re-read open background subagents between rounds (nothing else drives a tail then). */
  private armPoll(): void {
    const waiting = [...this.tails.values()].some(tail => !tail.ended && tail.call.background)
      || [...this.calls.values()].some(call => call.background && !this.paired(call))
    if (!waiting || this.disposed) {
      if (this.pollTimer !== undefined) clearInterval(this.pollTimer)
      this.pollTimer = undefined
      return
    }
    if (this.pollTimer !== undefined) return
    this.pollTimer = setInterval(() => { void this.tail() }, this.options.pollMs ?? 2_000)
    this.pollTimer.unref?.()
  }

  /** One discover + tail + close pass. */
  private async pass(): Promise<void> {
    if (this.calls.size === 0 && this.tails.size === 0) return
    await this.discover()
    for (const tail of this.tails.values()) {
      if (tail.ended) continue
      await this.read(tail)
      if (tail.call.background) tail.finished = tail.finished || await this.metaFinished(tail)
      const done = tail.call.background ? tail.finished : tail.call.resulted
      if (done) await this.finish(tail, 'done')
      else await this.write(tail, false)
    }
  }

  /** The member CLI session's `subagents/` directory (found by name: the cwd slug is lossy). */
  private async directory(): Promise<string | undefined> {
    if (this.subagentsDir !== undefined) return this.subagentsDir
    const session = this.cliSessionId
    if (session === undefined) return undefined
    const projects = join(this.options.homeDir, 'projects')
    let slugs: string[]
    try { slugs = await readdir(projects) } catch { return undefined }
    for (const slug of slugs) {
      const dir = join(projects, slug, session, 'subagents')
      try {
        if ((await stat(dir)).isDirectory()) {
          this.subagentsDir = dir
          return dir
        }
      } catch {
        // Not this slug.
      }
    }
    return undefined
  }

  /** Pair each unpaired member call with its subagent's meta (`toolUseId`). */
  private async discover(): Promise<void> {
    const waiting = [...this.calls.values()].filter(call => !this.paired(call))
    if (waiting.length === 0) return
    const dir = await this.directory()
    if (dir === undefined) return
    let names: string[]
    try { names = await readdir(dir) } catch { return }
    const known = new Set([...this.tails.values()].map(tail => tail.agentId))
    for (const name of names.sort()) {
      const match = /^agent-(.+)\.meta\.json$/.exec(name)
      if (match === null || known.has(match[1]!)) continue
      const agentId = match[1]!
      let meta: JsonObject | undefined
      try { meta = asObject(JSON.parse(await readFile(join(dir, name), 'utf8'))) } catch { continue } // half-written: the next pass retries
      const toolUseId = nonEmpty(meta?.['toolUseId'])
      const call = (toolUseId === undefined ? undefined : this.calls.get(toolUseId))
        ?? waiting.find(candidate => candidate.agentId === agentId)
      if (call === undefined || this.paired(call)) continue
      this.tails.set(agentId, {
        agentId,
        call,
        transcript: join(dir, `agent-${agentId}.jsonl`),
        meta: join(dir, name),
        name: nonEmpty(meta?.['agentType']) ?? call.subagentType,
        description: nonEmpty(meta?.['description']) ?? call.description,
        offset: 0,
        rest: '',
        parser: new ClaudeStreamParser(),
        mirrored: 0,
        promptWritten: false,
        ended: false,
        finished: meta?.['finished'] === true,
      })
      known.add(agentId)
    }
  }

  private async metaFinished(tail: Tail): Promise<boolean> {
    try {
      return asObject(JSON.parse(await readFile(tail.meta, 'utf8')))?.['finished'] === true
    } catch {
      return false
    }
  }

  /** Read the transcript's new complete lines into the tail's parser. */
  private async read(tail: Tail): Promise<void> {
    let handle
    try { handle = await open(tail.transcript, 'r') } catch { return }
    try {
      const size = (await handle.stat()).size
      if (size <= tail.offset) return
      const buffer = Buffer.alloc(size - tail.offset)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, tail.offset)
      tail.offset += bytesRead
      const text = tail.rest + buffer.subarray(0, bytesRead).toString('utf8')
      const lines = text.split('\n')
      tail.rest = lines.pop() ?? ''
      for (const line of lines) this.fold(tail, line)
    } finally {
      await handle.close()
    }
  }

  /** Fold one transcript line: the prompt is kept aside, the call content goes to the parser. */
  private fold(tail: Tail, raw: string): void {
    if (raw.trim() === '') return
    let event: JsonObject | undefined
    try { event = asObject(JSON.parse(raw)) } catch { return }
    if (event === undefined) return
    const type = event['type']
    if (type !== 'assistant' && type !== 'user') return
    if (event['isMeta'] === true) return
    const timestamp = typeof event['timestamp'] === 'string' ? Date.parse(event['timestamp']) : Number.NaN
    if (Number.isFinite(timestamp)) {
      tail.firstAt ??= timestamp
      tail.lastAt = timestamp
    }
    const message = asObject(event['message'])
    if (type === 'user') {
      const content = message?.['content']
      // The first user line is the subagent's task; a later plain-text user
      // line is the CLI's own injection and never the model's content.
      if (!Array.isArray(content) || !content.some(block => asObject(block)?.['type'] === 'tool_result')) {
        tail.prompt ??= promptText(content)
        return
      }
    } else {
      tail.model ??= nonEmpty(message?.['model'])
    }
    // The member fold reads one stream-json event per line: a transcript line
    // has the same `type`/`message` shape (and never `parent_tool_use_id`).
    tail.parser.push(JSON.stringify({ type, timestamp: event['timestamp'], message }) + '\n')
  }

  /** Open the grandchild and its execution on first need. */
  private async ensureExecution(tail: Tail): Promise<CliSubagentExecution | undefined> {
    if (tail.execution !== undefined) return tail.execution
    tail.handle ??= await openCliSubagent(this.options.ctx, this.options.member, {
      provider: PROVIDER,
      key: tail.agentId,
      ...tail.name === undefined ? {} : { name: tail.name },
      ...tail.description === undefined ? {} : { description: tail.description },
    })
    tail.execution = tail.handle.beginExecution({
      callId: tail.call.id,
      ...tail.call.background ? { background: true } : {},
      transport: this.options.transport,
      ...tail.firstAt === undefined ? {} : { admittedAt: tail.firstAt },
    })
    return tail.execution
  }

  /**
   * Write the completed calls as steps. Live (`final` false), the last call
   * is held back (it may still grow a block) unless every tool in it has its
   * result, and a call with an unresulted tool holds the pass. `final`
   * writes everything; `interrupted` marks the cut-off last call.
   */
  private async write(tail: Tail, final: boolean, interrupted = false): Promise<void> {
    const lines = tail.parser.lines
    if (tail.prompt === undefined && lines.length === 0) return
    const execution = await this.ensureExecution(tail)
    if (execution === undefined || execution.ended) return
    const session = tail.handle!.session
    if (!tail.promptWritten && (tail.prompt !== undefined || final || lines.length > 0)) {
      execution.beginTurn()
      if (tail.model !== undefined) appendRequestHeaderIfChanged(session, { provider: PROVIDER, model: tail.model })
      if (tail.prompt !== undefined) {
        session.append('user/message', createUserMessage({
          content: [{ type: 'text', text: tail.prompt }],
          source: { kind: 'user' },
        }), { surfaceOp: 'append' })
      }
      tail.promptWritten = true
    }
    const groups = groupClaudeTranscriptLines(lines)
    let start = 0
    for (const [index, group] of groups.entries()) {
      const end = start + group.length
      if (end <= tail.mirrored) { start = end; continue }
      const unresulted = group.some(line => line.kind === 'tool' && line.result === undefined)
      const last = index === groups.length - 1
      if (!final && (unresulted || (last && !group.some(line => line.kind === 'tool')))) break
      this.writeGroup(tail, execution, group, final && interrupted && last)
      tail.mirrored = end
      start = end
    }
    await tail.handle!.persist()
  }

  private writeGroup(tail: Tail, execution: CliSubagentExecution, group: readonly ClaudeTranscriptLine[], interrupted: boolean): void {
    const usage = group.map(line => line.usage).find(value => value !== undefined)
    // The request config names the model the transcript showed; a model that
    // only appears after the prompt was written lands before the first step.
    if (tail.model !== undefined) appendRequestHeaderIfChanged(tail.handle!.session, { provider: PROVIDER, model: tail.model })
    execution.mirror({
      blocks: group,
      ...usage === undefined ? {} : { usage },
      ...interrupted ? { interrupted: true } : {},
    }, claudeMirrorSource(tail.model))
  }

  /** Flush the transcript and write the end record. */
  private async finish(tail: Tail, outcome: LocalAgentExecutionOutcome): Promise<void> {
    if (tail.ended) return
    tail.ended = true
    if (tail.prompt === undefined && tail.parser.lines.length === 0 && tail.execution === undefined) {
      // Nothing was ever recorded: still a subagent the member ran, so its
      // session and execution exist (the card has something to open).
      await this.ensureExecution(tail)
    }
    await this.write(tail, true, outcome !== 'done')
    // A finished subagent ends at its last recorded line; a cut-off one now.
    tail.execution?.end(outcome, {
      ...outcome !== 'done' || tail.lastAt === undefined ? {} : { endedAt: tail.lastAt },
    })
    await tail.handle?.persist()
  }
}
