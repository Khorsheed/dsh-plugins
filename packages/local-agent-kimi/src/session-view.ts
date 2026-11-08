/**
 * Kimi session viewer: read a scoped-home session's `wire.jsonl` event log
 * and render a readable transcript (user prompts, assistant thinking and
 * replies, tool calls with arguments and results). The kimi ACP mode writes
 * responses to the session file rather than pushing them over the protocol,
 * and the dsh subagent record for a one-shot run carries only the final
 * output — this is the way to see what the kimi subagent actually did.
 *
 * The transcript is harness-comparison grade: every line is tagged with its
 * wire turn number (1-based, matching the dsh child session's `turn/start`
 * numbering), kimi's auto-permission `<system-reminder>` user messages are
 * filtered out, tool calls carry their rendered arguments, tool results are
 * matched to their owning call by `parentUuid`, and every `usage.record`
 * (kimi reports accounting per LLM request, not cumulative) is surfaced with
 * its transcript position so a delta mirror can sum a round's total.
 * @module @khorsheed/dsh-local-agent-kimi/session-view
 */

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ReasoningEffortId, TokenUsage } from '@deepseek-ai/dsh-llm'
import type { LocalAgentToolTiming } from '@khorsheed/dsh-local-agent/types'

/** The request config one `llm.request` wire event declares (its own words). */
export interface KimiRequestConfig {
  model?: string
  reasoningEffort?: ReasoningEffortId
  maxTokens?: number
}

/** One rendered transcript line. */
export type KimiTranscriptLine = (
  /**
   * `injected`: a round kimi opened on its own (a background task's completion
   * notification) — kept so line positions match the wire, but it is not the
   * human's message and opens no dsh round.
   */
  | { kind: 'user'; text: string; turn: number; injected?: true }
  | { kind: 'assistant'; text: string; turn: number; wireStep?: number; requestConfig?: KimiRequestConfig }
  | { kind: 'think'; text: string; turn: number; wireStep?: number; requestConfig?: KimiRequestConfig }
  /**
   * Tool activity: one call with its (possibly still pending) result. `id`
   * is the wire's toolCallId/uuid when present, else a synthesized
   * position-based id — stable across mirror passes either way, so the
   * child session's `tool/call`/`tool/result` events pair by it. `timing`
   * preserves the wire's execution interval, independently of mirror writes.
   */
  | { kind: 'tool'; id: string; name: string; args?: string; result?: string; turn: number; wireStep?: number; requestConfig?: KimiRequestConfig; timing?: LocalAgentToolTiming }
) & { model?: string; at?: number }

/** Timing facts one closed wire step reports about its model request. */
export interface KimiStepTiming {
  requestAt?: number
  firstChunkAt?: number
}

/** One abandoned model-call attempt: its turn and wall-clock window (`from` absent when its step.begin carried no time). */
export interface KimiRetriedAttempt {
  readonly turn: number
  readonly from?: number
  readonly until: number
}

/** A parsed transcript of one kimi session. */
export interface KimiSessionTranscript {
  /** Session id. */
  sessionId: string
  /** Transcript lines in event order, each tagged with its wire turn number. */
  lines: readonly KimiTranscriptLine[]
  /**
   * Every `usage.record` the wire reported, tagged with the transcript-line
   * position it occurred at. Each record is ONE LLM request's accounting
   * (kimi does not accumulate within a turn), so a mirror sums the records
   * whose position falls inside the delta it appends. `step` names the wire
   * step (`${turn}:${wireStep}`) open when the record was written — kimi
   * writes a step's record after its `step.begin`, before its content.
   */
  usageRecords: readonly { readonly line: number; readonly usage: TokenUsage; readonly step?: string }[]
  /**
   * Wire steps (`${turn}:${wireStep}`, turn 1-based) whose `step.end` the wire
   * recorded — a closed step's content is complete, so a mirror may fold it
   * without waiting for the next step to begin. Older wires carry no step
   * markers; their lines simply never appear here.
   */
  closedSteps: ReadonlySet<string>
  /** Request and first-content times for steps that report them. */
  stepTimings: ReadonlyMap<string, KimiStepTiming>
  /**
   * Model-call attempts kimi abandoned and retried (`turn.step.retrying`,
   * e.g. a connection cut mid-stream). The wire records nothing of such an
   * attempt's content, but its ACP notifications (thought chunks, a
   * lazily-created `pending` tool call) already reached the live driver.
   * Each entry is the attempt's wall-clock window on kimi's own clock: from
   * its `step.begin` to the retry's time plus its announced backoff (the next
   * attempt is not even requested before then).
   */
  retriedAttempts?: readonly KimiRetriedAttempt[]
  /**
   * The model identifier the wire named: the `model` field of a `usage.record`
   * or `llm.request` event, LAST one seen (a resumed session's later rounds
   * append later records, so the last record is the latest round's). Absent
   * when the wire named none — older kimi releases omit it.
   */
  model?: string
  /** Turn containing the latest native model observation. */
  modelTurn?: number
  /**
   * A subagent wire's ended rounds (`turn.ended`): 1-based turn → the
   * reason Kimi gave (`completed`, `cancelled`, …). Read only for a
   * subagent's wire ({@link KimiTranscriptOptions.agent}); absent otherwise.
   */
  endedTurns?: ReadonlyMap<number, string>
}

/**
 * The wire event log path for a session directory.
 * @param sessionDir - the session directory.
 * @param agent - the agent whose wire to read: `main` (the member itself,
 *   the default) or one of its own subagents (`agent-N`).
 */
export function wirePath(sessionDir: string, agent = 'main'): string {
  return join(sessionDir, 'agents', agent, 'wire.jsonl')
}

/**
 * Find a session directory under `<homeDir>/sessions/wd_*` whose id matches.
 * @param homeDir - the `kimi` harness's scoped home.
 * @param sessionId - the kimi session id.
 * @returns the session directory, or undefined when absent.
 */
export async function findKimiSessionDir(homeDir: string, sessionId: string): Promise<string | undefined> {
  const sessionsRoot = join(homeDir, 'sessions')
  let workspaces: string[]
  try {
    workspaces = await readdir(sessionsRoot)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  for (const workspace of workspaces) {
    const sessionDir = join(sessionsRoot, workspace, `session_${sessionId}`)
    try {
      await readFile(wirePath(sessionDir))
      return sessionDir
    } catch {
      // Not this workspace's session; keep looking.
    }
  }
  return undefined
}

/** Whether a user message is kimi's auto-permission reminder, never real task text. */
function isSystemReminder(text: string): boolean {
  return text.startsWith('<system-reminder>')
}

/** Flatten the text blocks of a message content array. */
function textOf(content: unknown[]): string {
  return (content ?? [])
    .filter((block): block is { type: string; text?: string } =>
      typeof block === 'object' && block !== null && (block as { type?: string }).type === 'text')
    .map(block => block.text ?? '')
    .join('')
}

/**
 * Render a file-editing tool call's arguments apply-patch style: the path
 * plus the old/new content. Without this a delegation's edits collapsed to
 * the bare path (or nothing) and the transcript hid what the member actually
 * changed — the kimi twin of codex's fileChange → ApplyPatch fold.
 * @param name - the tool name the wire recorded.
 * @param record - the call's argument object.
 * @returns the patch-style summary, or undefined when the tool is not a
 *   known file-editing shape.
 */
function editArgsOf(name: string, record: Record<string, unknown>): string | undefined {
  const path = typeof record['path'] === 'string' ? record['path'] : undefined
  if (name === 'Edit' || name === 'MultiEdit') {
    if (path === undefined || path.trim() === '') return undefined
    const edits = Array.isArray(record['edits']) ? record['edits'] as Record<string, unknown>[] : [record]
    const hunks: string[] = []
    for (const edit of edits) {
      const oldText = typeof edit['old_string'] === 'string' ? edit['old_string'] : ''
      const newText = typeof edit['new_string'] === 'string' ? edit['new_string'] : ''
      if (oldText === '' && newText === '') continue
      hunks.push(
        '@@',
        ...oldText.split('\n').map(line => `-${line}`),
        ...newText.split('\n').map(line => `+${line}`),
      )
    }
    // An edit call whose content the wire did not carry keeps the scalar path.
    if (hunks.length === 0) return undefined
    return [`update: ${path}`, ...hunks].join('\n')
  }
  if (name === 'Write') {
    if (path === undefined || path.trim() === '') return undefined
    const content = typeof record['content'] === 'string' ? record['content'] : ''
    // A Write whose content the wire did not carry keeps the scalar path.
    if (content === '') return undefined
    return [`add: ${path}`, ...content.split('\n').map(line => `+${line}`)].join('\n')
  }
  // Patch-style tools (ApplyPatch and friends): the patch text IS the argument.
  const patch = record['patch'] ?? record['diff']
  if (typeof patch === 'string' && patch.trim() !== '') return patch
  return undefined
}

/** Cap on a structured tool call's mirrored JSON arguments. */
const STRUCTURED_ARGS_MAX = 16_000

/** Render a tool call's arguments into a compact summary. */
function argsOf(name: string, args: unknown): string | undefined {
  if (args === undefined) return undefined
  if (typeof args === 'string') return args.trim() === '' ? undefined : args
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return undefined
  const record = args as Record<string, unknown>
  // File-editing tools first: their edit content outranks the bare path the
  // scalar preference below would otherwise reduce them to.
  const edit = editArgsOf(name, record)
  if (edit !== undefined) return edit
  // Structured arguments (an MCP tool's nested questions, options, lists)
  // keep their full JSON: the one-line summary below keeps only scalars and
  // dropped them, so the member's ask_user_question read as called with nothing.
  if (Object.values(record).some(value => typeof value === 'object' && value !== null)) {
    const json = JSON.stringify(record)
    return json.length <= STRUCTURED_ARGS_MAX ? json : `${json.slice(0, STRUCTURED_ARGS_MAX)}…`
  }
  // WebSearch/FetchURL expose a query/url; prefer the most meaningful scalar.
  for (const key of ['query', 'url', 'path', 'command']) {
    const value = record[key]
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  }
  // A tool whose meaningful arg is none of the four (Agent's prompt, Grep's
  // pattern, …): a short key=value summary beats dropping the call entirely.
  const pairs: string[] = []
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === 'string' && value.trim() !== '') pairs.push(`${key}=${value.trim()}`)
    else if (typeof value === 'number' || typeof value === 'boolean') pairs.push(`${key}=${String(value)}`)
  }
  if (pairs.length === 0) return undefined
  const summary = pairs.join(' ')
  return summary.length > 200 ? `${summary.slice(0, 200)}…` : summary
}

/** How {@link readKimiTranscript} numbers the rounds kimi opened itself. */
export interface KimiTranscriptOptions {
  /**
   * The notification ids (`origin.notificationId`, Kimi `task:<id>:<status>`)
   * of the self-opened rounds the member's child log holds as rounds of their
   * own — a `self` execution start followed by its `turn/start`
   * (member-self-started-rounds A③, core `ownSelfRounds`). Such a round takes
   * its own dsh turn number, and the human's next prompt opens the next one.
   * Every other self-opened round keeps the 11-01 fold: it takes the next
   * turn number and the next prompt joins it. Absent or empty, the transcript
   * is exactly the 11-01 one.
   */
  readonly ownRounds?: ReadonlySet<string>
  /**
   * Read one of the member's own subagents' wires (`agents/<agent>/wire.jsonl`)
   * instead of the member's (member-cli-subagents M3). Each call that starts
   * or resumes the subagent is a `turn.prompt` Kimi opens itself (origin
   * `system_trigger`/`subagent`): there it is the round's own prompt — it
   * opens the next turn and its text is the subagent's task, never an
   * injection — and the wire's `turn.ended` lines are reported as
   * {@link KimiSessionTranscript.endedTurns}. Absent or `main`: the member's
   * own wire, read exactly as before.
   */
  readonly agent?: string
}

/** Whether a `turn.prompt` origin is the start (or resume) of a subagent call. */
function isSubagentCallOrigin(origin: unknown): boolean {
  const record = origin as { kind?: unknown; name?: unknown } | undefined
  return record?.kind === 'system_trigger' && record.name === 'subagent'
}

/**
 * Parse a session's wire log into transcript lines plus every usage record.
 * @param sessionDir - the session directory.
 * @param options - which self-opened rounds count as rounds of their own.
 * @returns the transcript.
 */
export async function readKimiTranscript(sessionDir: string, options: KimiTranscriptOptions = {}): Promise<KimiSessionTranscript> {
  const ownRounds = options.ownRounds
  const agent = options.agent ?? 'main'
  const subagentWire = agent !== 'main'
  const endedTurns = new Map<number, string>()
  const sessionId = sessionDir.split('session_').pop() ?? sessionDir
  const lines: KimiTranscriptLine[] = []
  const usageRecords: { line: number; usage: TokenUsage; step?: string }[] = []
  const closedSteps = new Set<string>()
  const stepTimings = new Map<string, KimiStepTiming>()
  const retriedAttempts: KimiRetriedAttempt[] = []
  /** Each step attempt's `step.begin` time by its uuid (a retry names the attempt it abandons by it). */
  const stepBegunAt = new Map<string, number>()
  /** The wire step begun and not yet ended (`${turn}:${wireStep}`). */
  let openStep: string | undefined
  let model: string | undefined
  let modelTurn: number | undefined
  let lineModel: string | undefined
  // The latest llm.request's declared config; content/tool lines carry a
  // snapshot of it, so the mirror can write each folded step's request/header
  // in the wire's own words.
  let lineConfig: KimiRequestConfig | undefined
  const push = (line: KimiTranscriptLine): void => {
    lines.push({
      ...line,
      ...lineModel === undefined ? {} : { model: lineModel },
      ...line.kind !== 'user' && lineConfig !== undefined ? { requestConfig: { ...lineConfig } } : {},
    })
  }
  // Wire turns are 0-based on loop events; a `turn.prompt` also opens a new
  // round. The transcript uses 1-based turns matching the dsh child session's
  // turn/start numbering.
  let turn = 0
  let turnSeen = false
  /** The wire marks rounds with turn.prompt (current kimi): a user message it did not prompt is an injection. */
  let promptsMarkTurns = false
  /** An injected (kimi-opened) round already advanced `turn` to the next dsh round. */
  let injectedPending = false
  // Tool calls by uuid and toolCallId, so a result attaches to its own call
  // even when several calls run in parallel within one step.
  const callsByUuid = new Map<string, number>()
  const callsByToolCallId = new Map<string, number>()
  let text: string
  try {
    text = await readFile(wirePath(sessionDir, agent), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { sessionId, lines, usageRecords, closedSteps, stepTimings, ...subagentWire ? { endedTurns } : {} }
    }
    throw error
  }
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line === '') continue
    let event: Record<string, unknown>
    try {
      event = JSON.parse(line) as Record<string, unknown>
    } catch {
      continue
    }
    if (event.type === 'usage.record') {
      // A compaction call's own spend (`usageScope: 'session'`, written
      // between full_compaction.begin and .complete, untagged by any step):
      // never a round's. The compaction event carries it; counted here it
      // would ride the next round's reply as unclaimed usage.
      if (event.usageScope === 'session') continue
      // The record's own `model` field is the observed model identifier
      // (verified against kimi 0.39.x wires); the `llm.request` fallback
      // below covers wires whose usage records omit it. Last one seen wins:
      // a resumed session's later rounds append later records.
      if (typeof event.model === 'string' && event.model !== '') {
        model = lineModel = event.model
        modelTurn = turn || 1
        // The record names the alias spelling (kimi-code/k3), llm.request the
        // raw one (k3) — the pending header config follows the alias so the
        // header and the message source name the model identically.
        if (lineConfig !== undefined) lineConfig = { ...lineConfig, model: event.model }
      }
      const usage = usageFromWire(event.usage)
      if (usage !== undefined) usageRecords.push({ line: lines.length, usage, ...openStep === undefined ? {} : { step: openStep } })
      continue
    }
    if (event.type === 'turn.step.retrying') {
      // The attempt is abandoned: its content never reaches the wire, the
      // next attempt re-asks the model. Its window bounds the ACP updates it
      // sent; the live driver drops them instead of writing them at settle.
      if (typeof event.time === 'number' && Number.isFinite(event.time)) {
        const begun = typeof event.stepId === 'string' ? stepBegunAt.get(event.stepId) : undefined
        const backoff = typeof event.delayMs === 'number' && Number.isFinite(event.delayMs) && event.delayMs > 0 ? event.delayMs : 0
        retriedAttempts.push({ turn: turn === 0 ? 1 : turn, ...begun === undefined ? {} : { from: begun }, until: event.time + backoff })
      }
      continue
    }
    if (event.type === 'llm.request') {
      lineModel =typeof event.model === 'string' && event.model !== '' ? event.model : undefined
      if (typeof event.model === 'string' && event.model !== '') { model = event.model; modelTurn = turn || 1 }
      // The header contract requires provider+model; a wire that names no
      // model records no config at all rather than an invented one.
      lineConfig = lineModel === undefined ? undefined : {
        model: lineModel,
        ...typeof event.thinkingEffort === 'string' && event.thinkingEffort !== '' ? { reasoningEffort: event.thinkingEffort as ReasoningEffortId } : {},
        ...typeof event.maxTokens === 'number' && Number.isFinite(event.maxTokens) ? { maxTokens: event.maxTokens } : {},
      }
      const requestStep = typeof event.turnStep === 'string' ? Number(event.turnStep.split('.').at(-1)) : Number.NaN
      if (Number.isSafeInteger(requestStep) && typeof event.time === 'number' && Number.isFinite(event.time)) {
        const key = `${turn === 0 ? 1 : turn}:${requestStep}`
        stepTimings.set(key, { ...stepTimings.get(key), requestAt: event.time })
      }
      continue
    }
    if (event.type === 'turn.ended') {
      if (subagentWire && turn > 0) endedTurns.set(turn, typeof event.reason === 'string' ? event.reason : 'completed')
      continue
    }
    if (event.type === 'turn.prompt') {
      promptsMarkTurns = true
      lineModel = undefined
      const prompt = textOf((event.input as unknown[] | undefined) ?? [])
      // A subagent's wire: each call (new or resumed) is a prompt Kimi opened
      // for it — the round's own task, one turn per call.
      if (subagentWire && isSubagentCallOrigin(event.origin)) {
        turnSeen = true
        injectedPending = false
        turn += 1
        if (prompt.trim() !== '' && !isSystemReminder(prompt)) push({ kind: 'user', text: prompt, turn })
        continue
      }
      // A round kimi opened on its own — a background task's completion
      // notification (`origin.kind: 'task'`) — is no dsh round: dsh never
      // sent it, so counting it put every later wire round one turn ahead of
      // the child session's (the fold then never paired the live streams and
      // re-wrote them at settle). Its work folds into the NEXT dsh round,
      // which the next human prompt opens at the same number.
      const origin = (event.origin as { kind?: unknown } | undefined)?.kind
      const notificationId = (event.origin as { notificationId?: unknown } | undefined)?.notificationId
      // A self-opened round the child log holds as its own (a `self`
      // execution opened its turn): it numbers like a human prompt — the
      // pending 11-01 fold, if any, joins it — and the next prompt opens the
      // next turn. Its prompt line stays injected: not the human's message.
      if (origin !== undefined && origin !== 'user' && typeof notificationId === 'string' && ownRounds?.has(notificationId) === true) {
        turnSeen = true
        if (injectedPending) injectedPending = false
        else turn += 1
        if (prompt.trim() !== '' && !isSystemReminder(prompt)) push({ kind: 'user', text: prompt, turn: turn === 0 ? 1 : turn, injected: true })
        continue
      }
      if (origin !== undefined && origin !== 'user') {
        if (!injectedPending) {
          injectedPending = true
          turn += 1
        }
        turnSeen = true
        // Kept as a line (positions are the mirror offset's unit) but marked:
        // the fold writes no user message for it.
        if (prompt.trim() !== '' && !isSystemReminder(prompt)) push({ kind: 'user', text: prompt, turn: turn === 0 ? 1 : turn, injected: true })
        continue
      }
      // Each round's user prompt opens the next turn — unless an injected
      // round already opened it; the matching context.append_message below
      // is deduped against this text.
      turnSeen = true
      if (injectedPending) injectedPending = false
      else turn += 1
      if (prompt.trim() !== '' && !isSystemReminder(prompt)) {
        push({ kind: 'user', text: prompt, turn: turn === 0 ? 1 : turn })
      }
      continue
    }
    if (event.type === 'context.append_message') {
      const message = event.message as { role?: string; content?: unknown[] } | undefined
      const role = message?.role
      const textContent = textOf(message?.content ?? [])
      if (role === 'user' && textContent.trim() !== '' && !isSystemReminder(textContent)) {
        // A user append_message that duplicates the current turn.prompt (the
        // ACP server replays the prompt into the context) must not open a new
        // turn; when no turn.prompt preceded it, treat it as the round start.
        // The dedupe compares TEXT, not just kind: a second DISTINCT user
        // message in a row (a mid-round injection) is real content.
        const last = lines[lines.length - 1]
        if (turnSeen && last?.kind === 'user' && last.text === textContent) {
          // Duplicate of the prompt; skip.
          continue
        }
        // A wire that opens every round with turn.prompt: any other user
        // message is kimi's own injection inside the round (a Skill's loaded
        // instructions, a steer) — its loop events keep the same turnId. It
        // opens no turn (the dsh round is still running: a turn here wrote
        // steps into a turn the log never opened) and is not the human's.
        if (promptsMarkTurns) continue
        turnSeen = true
        turn += 1
        lineModel = undefined
        push({ kind: 'user', text: textContent, turn: turn === 0 ? 1 : turn })
      } else if (role === 'assistant' && textContent.trim() !== '') {
        push({ kind: 'assistant', text: textContent, turn: turn === 0 ? 1 : turn })
      }
      continue
    }
    if (event.type === 'context.append_loop_event') {
      const loop = event.event as Record<string, unknown> | undefined
      if (loop === undefined) continue
      // Wires that mark rounds with turn.prompt number turns by prompts (an
      // injected round shifts the wire's own turnId off the dsh count).
      const loopTurn = !promptsMarkTurns && typeof loop.turnId === 'number' ? loop.turnId + 1 : undefined
      if (loopTurn !== undefined) {
        turn = Math.max(turn, loopTurn)
        turnSeen = true
      }
      // The wire's own 1-based step within the turn: one loop step is one LLM
      // request (its think/text parts and tool calls share it), so the mirror
      // folds per wire step. Older wires omit it — their lines fold singly.
      const wireStep = typeof loop.step === 'number' ? loop.step : undefined
      const part = loop.part as { type?: string; text?: string; think?: string } | undefined
      const lineTurn = turn === 0 ? 1 : turn
      if (loop.type === 'step.begin' && wireStep !== undefined) openStep = `${lineTurn}:${wireStep}`
      if (loop.type === 'step.begin' && typeof loop.uuid === 'string' && typeof event.time === 'number' && Number.isFinite(event.time)) stepBegunAt.set(loop.uuid, event.time)
      if (loop.type === 'step.end' && wireStep !== undefined) {
        const key = `${lineTurn}:${wireStep}`
        closedSteps.add(key)
        const latency = loop.llmFirstTokenLatencyMs
        const requestAt = stepTimings.get(key)?.requestAt
        if (requestAt !== undefined && typeof latency === 'number' && Number.isFinite(latency)) {
          stepTimings.set(key, { ...stepTimings.get(key), firstChunkAt: requestAt + latency })
        }
        if (openStep === key) openStep = undefined
      }
      if (part?.type === 'text' && part.text !== undefined && part.text.trim() !== '') {
        push({ kind: 'assistant', text: part.text, turn: lineTurn, ...wireStep === undefined ? {} : { wireStep }, ...typeof event.time === 'number' && Number.isFinite(event.time) ? { at: event.time } : {} })
      } else if (part?.type === 'think' && part.think !== undefined && part.think.trim() !== '') {
        push({ kind: 'think', text: part.think, turn: lineTurn, ...wireStep === undefined ? {} : { wireStep }, ...typeof event.time === 'number' && Number.isFinite(event.time) ? { at: event.time } : {} })
      } else if (loop.type === 'tool.call') {
        const call = loop as {
          toolCall?: { name?: string; args?: unknown }
          name?: string
          args?: unknown
          uuid?: string
          toolCallId?: string
        }
        const name = call.toolCall?.name ?? call.name ?? 'tool'
        const args = argsOf(name, call.toolCall?.args ?? call.args)
        const lineIndex = lines.length
        push({
          kind: 'tool',
          id: typeof call.toolCallId === 'string'
            ? call.toolCallId
            : typeof call.uuid === 'string' ? call.uuid : `kimi-tool-${lineIndex}`,
          name,
          ...args === undefined ? {} : { args },
          turn: lineTurn,
          ...wireStep === undefined ? {} : { wireStep },
          ...typeof event.time === 'number' && Number.isFinite(event.time)
            ? { at: event.time, timing: { startedAt: event.time, source: 'provider' as const } } : {},
        })
        if (typeof call.uuid === 'string') callsByUuid.set(call.uuid, lineIndex)
        if (typeof call.toolCallId === 'string') callsByToolCallId.set(call.toolCallId, lineIndex)
      } else if (loop.type === 'tool.result') {
        const result = loop as {
          result?: { output?: unknown }
          parentUuid?: string
          toolCallId?: string
        }
        const output = toolOutputText(result.result?.output)
        let target = typeof result.parentUuid === 'string'
          ? callsByUuid.get(result.parentUuid)
          : undefined
        if (target === undefined && typeof result.toolCallId === 'string') {
          target = callsByToolCallId.get(result.toolCallId)
        }
        if (target === undefined) {
          // No id to pair with: fall back to the most recent tool line so a
          // wire without ids still renders the result on its call.
          for (let index = lines.length - 1; index >= 0; index -= 1) {
            if (lines[index]?.kind === 'tool') {
              target = index
              break
            }
          }
        }
        if (target !== undefined) {
          const current = lines[target]
          if (current !== undefined && current.kind === 'tool') {
            lines[target] = {
              ...current,
              ...output !== undefined && output.trim() !== '' ? { result: output } : {},
              ...current.timing !== undefined && typeof event.time === 'number' && Number.isFinite(event.time)
                ? { timing: { ...current.timing, endedAt: event.time } } : {},
            }
          }
        }
      } else if (
        loop.type === 'content.part'
        && part?.type !== undefined
        && part.type !== 'text'
        && part.type !== 'think'
      ) {
        // A content part type this fold does not know (image, audio, a future
        // plan part, …): keep a visible marker instead of the content
        // vanishing from the transcript.
        push({ kind: 'assistant', text: `[未支持的内容类型 ${part.type}]`, turn: lineTurn })
      }
    }
  }
  return {
    sessionId, lines, usageRecords, closedSteps, stepTimings,
    ...retriedAttempts.length === 0 ? {} : { retriedAttempts },
    ...model === undefined ? {} : { model },
    ...modelTurn === undefined ? {} : { modelTurn },
    ...subagentWire ? { endedTurns } : {},
  }
}

/**
 * A wire tool result's output as display text. Most tools report a string;
 * a media read (ReadMediaFile) reports content parts — text parts keep their
 * text, an image part becomes a short marker (its bytes stay in kimi's blob
 * store). Anything else reads as no output, never a parse failure: one
 * unreadable result must not stop the whole transcript (and the round's
 * usage) from folding.
 * @param raw - the result's `output` field.
 * @returns the text, or undefined when there is none.
 */
export function toolOutputText(raw: unknown): string | undefined {
  if (typeof raw === 'string') return raw
  if (!Array.isArray(raw)) return undefined
  const parts = raw.map((part: unknown) => {
    if (part === null || typeof part !== 'object') return ''
    const entry = part as { type?: unknown; text?: unknown }
    if (entry.type === 'text' && typeof entry.text === 'string') return entry.text
    return typeof entry.type === 'string' && entry.type !== '' ? `[${entry.type}]` : ''
  })
  return parts.join('')
}

/**
 * Map a wire `usage.record` payload onto the shared usage contract. kimi
 * reports input (uncached), cache read, cache creation, and output; the
 * creation counter is its cache-write analog. Non-numeric or missing
 * counters are dropped so the record stays usable when kimi omits a field;
 * a reported cache-read counter is always written (zero included), so a
 * reader can tell "no hits" from "not reported".
 * @param raw - the event's `usage` value.
 * @returns the shared usage record, or undefined when nothing was reported.
 */
export function usageFromWire(raw: unknown): TokenUsage | undefined {
  const counters = raw as { inputOther?: unknown; output?: unknown; inputCacheRead?: unknown; inputCacheCreation?: unknown } | undefined
  if (counters === undefined || typeof counters !== 'object') return undefined
  const num = (value: unknown): number | undefined => {
    const n = Number(value)
    return Number.isFinite(n) ? n : undefined
  }
  const input = num(counters.inputOther)
  const output = num(counters.output)
  const cacheRead = num(counters.inputCacheRead)
  const cacheWrite = num(counters.inputCacheCreation)
  if (input === undefined && output === undefined && cacheRead === undefined && cacheWrite === undefined) {
    return undefined
  }
  const usage: TokenUsage = {
    inputTokens: input ?? 0,
    outputTokens: output ?? 0,
  }
  if (cacheRead !== undefined) usage.cacheReadTokens = cacheRead
  if (cacheWrite !== undefined && cacheWrite > 0) usage.cacheWriteTokens = cacheWrite
  return usage
}

/**
 * Sum per-request usage records into one round total. Each `usage.record` is
 * a single LLM request's accounting, so a round's totals are the sum of the
 * records inside it.
 * @param records - the usage records to add.
 * @returns the summed usage, or undefined when the list is empty.
 */
export function sumUsageRecords(
  records: readonly { readonly line: number; readonly usage: TokenUsage }[],
): TokenUsage | undefined {
  let input = 0
  let output = 0
  let cacheRead = 0
  let cacheWrite = 0
  for (const record of records) {
    input += record.usage.inputTokens ?? 0
    output += record.usage.outputTokens ?? 0
    cacheRead += record.usage.cacheReadTokens ?? 0
    cacheWrite += record.usage.cacheWriteTokens ?? 0
  }
  if (input === 0 && output === 0 && cacheRead === 0 && cacheWrite === 0) return undefined
  const usage: TokenUsage = { inputTokens: input, outputTokens: output }
  if (cacheRead > 0) usage.cacheReadTokens = cacheRead
  if (cacheWrite > 0) usage.cacheWriteTokens = cacheWrite
  return usage
}

/**
 * Merge two usage windows into one running total — the delegation run's
 * per-round accumulator: each mirror pass (live poll, settle) returns its
 * own window's accounting, and the disjoint windows sum to the round's
 * total. `undefined` operands pass through, so callers accumulate without
 * absence checks.
 * @param left - the running total, or undefined before the first window.
 * @param right - the next window's usage, or undefined when it had none.
 * @returns the merged total, or undefined when both operands are absent.
 */
export function addTokenUsage(
  left: TokenUsage | undefined,
  right: TokenUsage | undefined,
): TokenUsage | undefined {
  if (left === undefined) return right
  if (right === undefined) return left
  return sumUsageRecords([
    { line: 0, usage: left },
    { line: 0, usage: right },
  ])
}

/**
 * One call that started (or resumed) one of the member's own subagents, read
 * from the member's wire (member-cli-subagents M3): a `subagent.spawned`
 * line plus the `subagent.completed` line that closes it.
 */
export interface KimiSubagentCall {
  /** Kimi's subagent id (`agent-N`): its wire is `agents/<id>/wire.jsonl`. */
  readonly subagentId: string
  /** The member's `Agent`/`AgentSwarm` tool call id (`parentToolCallId`). */
  readonly callId: string
  /** The subagent type (`subagentName`: `explore`, `coder`, …). */
  readonly name?: string
  readonly description?: string
  /** `runInBackground: true`: the member's round does not wait for it. */
  readonly background: boolean
  /** The background task id Kimi gave a background call (`taskId`). */
  readonly taskId?: string
  /** Its place in an `AgentSwarm` call (0-based), when the call started several. */
  readonly group?: { readonly index: number; readonly size: number }
  /** 1-based: the how-many-th call of this subagent (its wire's turn). */
  readonly ordinal: number
  /** The call resumed an existing subagent (an earlier spawn of the same id). */
  readonly resumed: boolean
  /** The member wire's line index of the spawn (a mirror skips calls before its baseline). */
  readonly line: number
  /** When Kimi spawned it (epoch ms). */
  readonly spawnedAt?: number
  /** `subagent.completed`, once Kimi wrote it. */
  readonly completed?: {
    readonly at?: number
    /**
     * This call's own spend. Kimi's `usage` on a resumed subagent is the
     * subagent's running total (checked against local wires: each resumed
     * completion equals the sum of all its rounds so far), so a resumed
     * call's share is the difference from the previous completion.
     */
    readonly usage?: TokenUsage
  }
}

/** Kimi writes the member wire's `subagent.*` times in seconds, its loop events in ms. */
function epochMs(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined
  return value < 1e12 ? value * 1000 : value
}

function subtractUsage(total: TokenUsage, earlier: TokenUsage | undefined): TokenUsage {
  if (earlier === undefined) return total
  const minus = (a: number | undefined, b: number | undefined): number => Math.max(0, (a ?? 0) - (b ?? 0))
  const usage: TokenUsage = {
    inputTokens: minus(total.inputTokens, earlier.inputTokens),
    outputTokens: minus(total.outputTokens, earlier.outputTokens),
  }
  if (total.cacheReadTokens !== undefined) usage.cacheReadTokens = minus(total.cacheReadTokens, earlier.cacheReadTokens)
  if (total.cacheWriteTokens !== undefined) {
    const write = minus(total.cacheWriteTokens, earlier.cacheWriteTokens)
    if (write > 0) usage.cacheWriteTokens = write
  }
  return usage
}

type MutableSubagentCall = { -readonly [K in keyof KimiSubagentCall]: KimiSubagentCall[K] } & { swarmIndex?: number }

/**
 * Read the member's own subagent calls from its wire's `subagent.*` lines,
 * in spawn order. A completion belongs to the subagent's latest spawn
 * before it; a spawn without one is still running (or was cut off).
 * @param sessionDir - the Kimi session directory.
 * @returns the calls (empty when the wire is missing or holds none).
 */
export async function readKimiSubagents(sessionDir: string): Promise<KimiSubagentCall[]> {
  let text: string
  try {
    text = await readFile(wirePath(sessionDir), 'utf8')
  } catch {
    return []
  }
  const calls: MutableSubagentCall[] = []
  const lastOf = new Map<string, MutableSubagentCall>()
  const totals = new Map<string, TokenUsage>()
  const rows = text.split('\n')
  for (let line = 0; line < rows.length; line += 1) {
    const raw = rows[line] as string
    if (!raw.includes('"subagent.')) continue
    let event: Record<string, unknown>
    try {
      event = JSON.parse(raw) as Record<string, unknown>
    } catch {
      continue
    }
    const subagentId = typeof event.subagentId === 'string' && event.subagentId !== '' ? event.subagentId : undefined
    if (subagentId === undefined) continue
    if (event.type === 'subagent.spawned') {
      const callId = typeof event.parentToolCallId === 'string' && event.parentToolCallId !== '' ? event.parentToolCallId : undefined
      if (callId === undefined) continue
      const previous = calls.filter(call => call.subagentId === subagentId).length
      const at = epochMs(event.time)
      const call: MutableSubagentCall = {
        subagentId,
        callId,
        ...typeof event.subagentName === 'string' && event.subagentName !== '' ? { name: event.subagentName } : {},
        ...typeof event.description === 'string' && event.description.trim() !== '' ? { description: event.description } : {},
        background: event.runInBackground === true,
        ...event.runInBackground === true && typeof event.taskId === 'string' && event.taskId !== '' ? { taskId: event.taskId } : {},
        ordinal: previous + 1,
        resumed: previous > 0,
        line,
        ...at === undefined ? {} : { spawnedAt: at },
        ...typeof event.swarmIndex === 'number' && Number.isSafeInteger(event.swarmIndex) ? { swarmIndex: event.swarmIndex } : {},
      }
      calls.push(call)
      lastOf.set(subagentId, call)
    } else if (event.type === 'subagent.completed') {
      const call = lastOf.get(subagentId)
      if (call === undefined || call.completed !== undefined) continue
      const total = usageFromWire(event.usage)
      const at = epochMs(event.time)
      call.completed = {
        ...at === undefined ? {} : { at },
        ...total === undefined ? {} : { usage: subtractUsage(total, totals.get(subagentId)) },
      }
      if (total !== undefined) totals.set(subagentId, total)
    }
  }
  // An AgentSwarm call spawns several subagents under one tool call id.
  const bySwarm = new Map<string, MutableSubagentCall[]>()
  for (const call of calls) bySwarm.set(call.callId, [...bySwarm.get(call.callId) ?? [], call])
  return calls.map(({ swarmIndex, ...call }): KimiSubagentCall => {
    const members = bySwarm.get(call.callId) as MutableSubagentCall[]
    if (members.length < 2) return call
    const index = swarmIndex !== undefined && swarmIndex >= 1 && swarmIndex <= members.length
      ? swarmIndex - 1
      : members.findIndex(entry => entry.line === call.line)
    return { ...call, group: { index, size: members.length } }
  })
}

/** Render a transcript as command-reply text. */
export function renderTranscript(transcript: KimiSessionTranscript): string {
  if (transcript.lines.length === 0) return `kimi session ${transcript.sessionId}: no readable transcript yet.`
  const parts: string[] = [`kimi session ${transcript.sessionId}:`]
  for (const line of transcript.lines) {
    if (line.kind === 'user') {
      parts.push(`\n用户: ${line.text}`)
    } else if (line.kind === 'assistant') {
      parts.push(`\nkimi: ${line.text}`)
    } else if (line.kind === 'think') {
      parts.push(`\n[思考] ${line.text}`)
    } else {
      // The other kinds are exhausted above; this is the tool line.
      const call = `[工具 ${line.name}]${line.args !== undefined ? ` ${line.args}` : ''}`
      parts.push(`\n  ↳ ${call}${line.result !== undefined ? ` → ${line.result}` : ''}`)
    }
  }
  return parts.join('\n')
}
