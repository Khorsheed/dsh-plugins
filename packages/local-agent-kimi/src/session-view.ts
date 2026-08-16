/**
 * Kimi session viewer: read a scoped-home session's `wire.jsonl` event log
 * and render a readable transcript (user prompts, assistant thinking and
 * replies, tool calls with results). The kimi ACP mode writes responses to
 * the session file rather than pushing them over the protocol, and the dsh
 * subagent record for a one-shot run carries only the final output — this is
 * the way to see what the kimi subagent actually did.
 * @module @khorsheed/dsh-local-agent-kimi/session-view
 */

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'

/** One rendered transcript line. */
export type KimiTranscriptLine =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'think'; text: string }
  | { kind: 'tool'; name: string; result?: string }

/** A parsed transcript of one kimi session. */
export interface KimiSessionTranscript {
  /** Session id. */
  sessionId: string
  /** Transcript lines in event order. */
  lines: readonly KimiTranscriptLine[]
  /** Token usage of the last model turn, when the wire log reported it. */
  usage?: TokenUsage
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

/**
 * Parse a session's wire log into transcript lines plus the last turn's
 * token usage. The wire carries usage as standalone `usage.record` events
 * (kimi's ACP server reports accounting separately from the message text),
 * scoped to the turn; the last record's counters become the transcript's
 * usage.
 * @param sessionDir - the session directory.
 * @returns the transcript.
 */
export async function readKimiTranscript(sessionDir: string): Promise<KimiSessionTranscript> {
  const sessionId = sessionDir.split('session_').pop() ?? sessionDir
  const lines: KimiTranscriptLine[] = []
  let usage: TokenUsage | undefined
  let text: string
  try {
    text = await readFile(wirePath(sessionDir), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { sessionId, lines }
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
      usage = usageFromWire(event.usage)
      continue
    }
    if (event.type === 'context.append_message') {
      const message = event.message as { role?: string; content?: unknown[] } | undefined
      const role = message?.role
      const textContent = (message?.content ?? [])
        .filter((block): block is { type: string; text?: string } =>
          typeof block === 'object' && block !== null && (block as { type?: string }).type === 'text')
        .map(block => block.text ?? '')
        .join('')
      if ((role === 'user' || role === 'assistant') && textContent.trim() !== '') {
        lines.push({ kind: role === 'user' ? 'user' : 'assistant', text: textContent })
      }
      continue
    }
    if (event.type === 'context.append_loop_event') {
      const loop = event.event as Record<string, unknown> | undefined
      const part = loop?.part as { type?: string; text?: string; think?: string } | undefined
      if (part?.type === 'text' && part.text !== undefined && part.text.trim() !== '') {
        lines.push({ kind: 'assistant', text: part.text })
      } else if (part?.type === 'think' && part.think !== undefined && part.think.trim() !== '') {
        lines.push({ kind: 'think', text: part.think })
      } else if (loop?.type === 'tool.call') {
        const call = loop as { toolCall?: { name?: string }; name?: string }
        lines.push({ kind: 'tool', name: call.toolCall?.name ?? call.name ?? 'tool' })
      } else if (loop?.type === 'tool.result') {
        const result = loop.result as { output?: string } | undefined
        const output = result?.output
        if (output !== undefined && output.trim() !== '') {
          const last = lines[lines.length - 1]
          if (last !== undefined && last.kind === 'tool') {
            lines[lines.length - 1] = { ...last, result: output }
          }
        }
      }
    }
  }
  return { sessionId, lines, ...usage === undefined ? {} : { usage } }
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
      parts.push(`\n  ↳ 工具 ${line.name}${line.result !== undefined ? ` → ${line.result}` : ''}`)
    }
  }
  return parts.join('\n')
}
