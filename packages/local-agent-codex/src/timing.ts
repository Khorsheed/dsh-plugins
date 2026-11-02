import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { LocalAgentMemberModelTiming } from '@khorsheed/dsh-local-agent/types'
import { CodexStreamParser, codexStreamFromLines } from './codex-cli-provider.ts'
import { codexAppServerItemToLine } from './live-driver.ts'

async function findCodexRollout(homeDir: string, cliSessionId: string): Promise<string | undefined> {
  let years: string[]
  try {
    years = await readdir(join(homeDir, 'sessions'))
  } catch {
    return undefined
  }
  for (const year of years) {
    let months: string[]
    try {
      months = await readdir(join(homeDir, 'sessions', year))
    } catch {
      continue
    }
    for (const month of months) {
      let days: string[]
      try {
        days = await readdir(join(homeDir, 'sessions', year, month))
      } catch {
        continue
      }
      for (const day of days) {
        try {
          const names = await readdir(join(homeDir, 'sessions', year, month, day))
          const name = names.find(candidate => candidate.startsWith('rollout-') && candidate.endsWith(`${cliSessionId}.jsonl`))
          if (name !== undefined) return join(homeDir, 'sessions', year, month, day, name)
        } catch {
          continue
        }
      }
    }
  }
  return undefined
}

type RolloutPayload = {
  type?: string
  id?: string
  call_id?: string
  name?: string
  text?: string
  command?: string
  arguments?: string
  input?: string
  output?: unknown
  aggregated_output?: string
  exit_code?: unknown
  status?: unknown
  changes?: { kind?: string; path?: string; diff?: string }[]
  content?: { type?: string; text?: string }[]
  summary?: { type?: string; text?: string }[]
  summary_text?: { text?: string }[]
  role?: string
  server?: string
  tool?: string
  result?: unknown
  error?: unknown
  duration?: { secs?: unknown; nanos?: unknown }
}

function messageText(payload: RolloutPayload): string {
  if (typeof payload.text === 'string') return payload.text
  return [...(payload.summary ?? []), ...(payload.content ?? [])].map(block => block.text ?? '').join('')
}

const NATIVE_ITEM_TYPES: Readonly<Record<string, string>> = {
  AgentMessage: 'agentMessage',
  Reasoning: 'reasoning',
  CommandExecution: 'commandExecution',
  McpToolCall: 'mcpToolCall',
  WebSearch: 'webSearch',
  FileChange: 'fileChange',
}

/** Reconstruct a member's historical model streams and tool intervals from a rollout. */
export async function readCodexModelTiming(homeDir: string, cliSessionId: string): Promise<LocalAgentMemberModelTiming | undefined> {
  const path = await findCodexRollout(homeDir, cliSessionId)
  if (path === undefined) return undefined
  const text = await readFile(path, 'utf8')
  const streams: LocalAgentMemberModelTiming['streams'] = {}
  const requestStarts: NonNullable<LocalAgentMemberModelTiming['requestStarts']> = {}
  const toolTimings: LocalAgentMemberModelTiming['toolTimings'] = {}
  let turn = 0
  let previousAt: number | undefined
  let parser = new CodexStreamParser()
  let nativeLines: { line: ReturnType<typeof codexAppServerItemToLine> & object; requestStart: number | undefined }[] = []
  const consume = () => {
    const entries = nativeLines.length > 0
      ? nativeLines
      : parser.lines.map(line => ({ line, requestStart: line.generation?.startedAt }))
    for (const [index, entry] of entries.entries()) {
      const key = `${turn}:${index + 1}`
      const stream = codexStreamFromLines([entry.line])
      if (stream.length > 0) streams[key] = stream
      if (entry.requestStart !== undefined) requestStarts[key] = entry.requestStart
      if (entry.line.kind === 'tool' && entry.line.timing !== undefined) toolTimings[entry.line.id] = entry.line.timing
    }
  }
  for (const raw of text.split('\n')) {
    if (raw.trim() === '') continue
    let row: {
      type?: string
      timestamp?: string
      payload?: RolloutPayload & {
        turn_id?: string
        item?: RolloutPayload
        started_at_ms?: unknown
        completed_at_ms?: unknown
      }
    }
    try {
      row = JSON.parse(raw) as typeof row
    } catch {
      continue
    }
    if (row.type === 'turn_context') {
      consume()
      turn += 1
      parser = new CodexStreamParser()
      nativeLines = []
      previousAt = Date.parse(row.timestamp ?? '')
      continue
    }
    if (turn === 0) continue
    if (row.type === 'event_msg' && row.payload?.type === 'item_completed') {
      const payload = row.payload
      const item = payload.item
      if (item === undefined) continue
      const type = item.type === undefined ? undefined : NATIVE_ITEM_TYPES[item.type]
      if (type === undefined) continue
      const line = codexAppServerItemToLine({
        ...item,
        type,
        ...type === 'agentMessage' ? { text: messageText(item) } : {},
        ...type === 'reasoning' ? { summary: (item.summary_text ?? []).map(part => part.text ?? '') } : {},
        ...type === 'commandExecution' ? { aggregatedOutput: item.aggregated_output, exitCode: item.exit_code } : {},
      })
      if (line === undefined) continue
      const startedAt = Number(payload.started_at_ms)
      const endedAt = Number(payload.completed_at_ms)
      const hasInterval = Number.isSafeInteger(startedAt) && Number.isSafeInteger(endedAt) && endedAt >= startedAt
      if (hasInterval) {
        line.generation = line.kind === 'tool'
          ? { startedAt: previousAt ?? startedAt, endedAt: startedAt }
          : { startedAt, endedAt }
        if (line.kind === 'tool') {
          const seconds = Number(item.duration?.secs)
          const nanos = Number(item.duration?.nanos)
          const durationMs = seconds * 1000 + nanos / 1_000_000
          line.timing = item.duration !== undefined && Number.isFinite(durationMs) && durationMs >= 0
            ? { startedAt: endedAt - durationMs, endedAt, source: 'provider' }
            : { startedAt, endedAt, source: 'observed' }
        }
      }
      nativeLines.push({ line, requestStart: previousAt })
      continue
    }
    if (row.type !== 'response_item' || row.payload === undefined) continue
    const payload = row.payload
    const at = Date.parse(row.timestamp ?? '')
    if (!Number.isFinite(at)) continue
    const base = { id: payload.id, type: payload.type }
    if (payload.type === 'function_call' || payload.type === 'custom_tool_call'
      || payload.type === 'command_execution' || payload.type === 'web_search_call' || payload.type === 'file_change') {
      parser.push(`${JSON.stringify({ type: 'item.started', item: base })}\n`, at)
      parser.push(`${JSON.stringify({ type: 'item.completed', item: payload })}\n`, at)
    } else if (payload.type === 'function_call_output' || payload.type === 'custom_tool_call_output') {
      parser.push(`${JSON.stringify({ type: 'item.completed', item: payload })}\n`, at)
    } else if (payload.type === 'reasoning' || (payload.type === 'message' && payload.role === 'assistant')) {
      const itemType = payload.type === 'reasoning' ? 'reasoning' : 'agent_message'
      const content = messageText(payload)
      if (content.trim() !== '') {
        if (previousAt !== undefined) parser.push(`${JSON.stringify({ type: 'item.started', item: base })}\n`, previousAt)
        parser.push(`${JSON.stringify({ type: 'item.completed', item: { ...base, type: itemType, text: content } })}\n`, at)
      }
    }
    previousAt = at
  }
  consume()
  return { streams, requestStarts, toolTimings }
}
