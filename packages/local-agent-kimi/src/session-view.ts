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
import type { TokenUsage } from '@deepseek-ai/dsh-llm'

/** One rendered transcript line. */
export type KimiTranscriptLine =
  | { kind: 'user'; text: string; turn: number }
  | { kind: 'assistant'; text: string; turn: number }
  | { kind: 'think'; text: string; turn: number }
  /**
   * Tool activity: one call with its (possibly still pending) result. `id`
   * is the wire's toolCallId/uuid when present, else a synthesized
   * position-based id — stable across mirror passes either way, so the
   * child session's `tool/call`/`tool/result` events pair by it.
   */
  | { kind: 'tool'; id: string; name: string; args?: string; result?: string; turn: number }

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
   * whose position falls inside the delta it appends.
   */
  usageRecords: readonly { readonly line: number; readonly usage: TokenUsage }[]
  /**
   * The model identifier the wire named: the `model` field of a `usage.record`
   * or `llm.request` event, LAST one seen (a resumed session's later rounds
   * append later records, so the last record is the latest round's). Absent
   * when the wire named none — older kimi releases omit it.
   */
  model?: string
}

/** The wire event log path for a session directory. */
function wirePath(sessionDir: string): string {
  return join(sessionDir, 'agents', 'main', 'wire.jsonl')
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

/**
 * Parse a session's wire log into transcript lines plus every usage record.
 * @param sessionDir - the session directory.
 * @returns the transcript.
 */
export async function readKimiTranscript(sessionDir: string): Promise<KimiSessionTranscript> {
  const sessionId = sessionDir.split('session_').pop() ?? sessionDir
  const lines: KimiTranscriptLine[] = []
  const usageRecords: { line: number; usage: TokenUsage }[] = []
  let model: string | undefined
  // Wire turns are 0-based on loop events; a `turn.prompt` also opens a new
  // round. The transcript uses 1-based turns matching the dsh child session's
  // turn/start numbering.
  let turn = 0
  let turnSeen = false
  // Tool calls by uuid and toolCallId, so a result attaches to its own call
  // even when several calls run in parallel within one step.
  const callsByUuid = new Map<string, number>()
  const callsByToolCallId = new Map<string, number>()
  let text: string
  try {
    text = await readFile(wirePath(sessionDir), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { sessionId, lines, usageRecords }
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
      // The record's own `model` field is the observed model identifier
      // (verified against kimi 0.39.x wires); the `llm.request` fallback
      // below covers wires whose usage records omit it. Last one seen wins:
      // a resumed session's later rounds append later records.
      if (typeof event.model === 'string' && event.model !== '') model = event.model
      const usage = usageFromWire(event.usage)
      if (usage !== undefined) usageRecords.push({ line: lines.length, usage })
      continue
    }
    if (event.type === 'llm.request') {
      if (typeof event.model === 'string' && event.model !== '') model = event.model
      continue
    }
    if (event.type === 'turn.prompt') {
      // Each round's user prompt opens the next turn; the matching
      // context.append_message below is deduped against this text.
      turnSeen = true
      turn += 1
      const prompt = textOf((event.input as unknown[] | undefined) ?? [])
      if (prompt.trim() !== '' && !isSystemReminder(prompt)) {
        lines.push({ kind: 'user', text: prompt, turn: turn === 0 ? 1 : turn })
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
        turnSeen = true
        turn += 1
        lines.push({ kind: 'user', text: textContent, turn: turn === 0 ? 1 : turn })
      } else if (role === 'assistant' && textContent.trim() !== '') {
        lines.push({ kind: 'assistant', text: textContent, turn: turn === 0 ? 1 : turn })
      }
      continue
    }
    if (event.type === 'context.append_loop_event') {
      const loop = event.event as Record<string, unknown> | undefined
      if (loop === undefined) continue
      const loopTurn = typeof loop.turnId === 'number' ? loop.turnId + 1 : undefined
      if (loopTurn !== undefined) {
        turn = Math.max(turn, loopTurn)
        turnSeen = true
      }
      const part = loop.part as { type?: string; text?: string; think?: string } | undefined
      const lineTurn = turn === 0 ? 1 : turn
      if (part?.type === 'text' && part.text !== undefined && part.text.trim() !== '') {
        lines.push({ kind: 'assistant', text: part.text, turn: lineTurn })
      } else if (part?.type === 'think' && part.think !== undefined && part.think.trim() !== '') {
        lines.push({ kind: 'think', text: part.think, turn: lineTurn })
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
        lines.push({
          kind: 'tool',
          id: typeof call.toolCallId === 'string'
            ? call.toolCallId
            : typeof call.uuid === 'string' ? call.uuid : `kimi-tool-${lineIndex}`,
          name,
          ...args === undefined ? {} : { args },
          turn: lineTurn,
        })
        if (typeof call.uuid === 'string') callsByUuid.set(call.uuid, lineIndex)
        if (typeof call.toolCallId === 'string') callsByToolCallId.set(call.toolCallId, lineIndex)
      } else if (loop.type === 'tool.result') {
        const result = loop as {
          result?: { output?: string }
          parentUuid?: string
          toolCallId?: string
        }
        const output = result.result?.output
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
        if (output !== undefined && output.trim() !== '' && target !== undefined) {
          const current = lines[target]
          if (current !== undefined && current.kind === 'tool') {
            lines[target] = { ...current, result: output }
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
        lines.push({ kind: 'assistant', text: `[未支持的内容类型 ${part.type}]`, turn: lineTurn })
      }
    }
  }
  return { sessionId, lines, usageRecords, ...model === undefined ? {} : { model } }
}

/**
 * Map a wire `usage.record` payload onto the shared usage contract. kimi
 * reports input (uncached), cache read, cache creation, and output; the
 * creation counter is its cache-write analog. Non-numeric or missing
 * counters are dropped so the record stays usable when kimi omits a field.
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
  if (cacheRead !== undefined && cacheRead > 0) usage.cacheReadTokens = cacheRead
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
