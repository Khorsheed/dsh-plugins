import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { LocalAgentMemberModelTiming } from '@khorsheed/dsh-local-agent/types'
import { claudeStreamFromLines, groupClaudeTranscriptLines, parseClaudeStreamJson } from './claude-cli-provider.ts'

async function findClaudeTranscript(homeDir: string, cliSessionId: string): Promise<string | undefined> {
  let projects: string[]
  try {
    projects = await readdir(join(homeDir, 'projects'))
  } catch {
    return undefined
  }
  for (const project of projects) {
    const path = join(homeDir, 'projects', project, `${cliSessionId}.jsonl`)
    try {
      return await readFile(path, 'utf8')
    } catch {
      // Try the next workspace slug.
    }
  }
  return undefined
}

/** Reconstruct model streams and tool intervals from a stream-json log or native transcript. */
export async function readClaudeModelTiming(homeDir: string, cliSessionId: string): Promise<LocalAgentMemberModelTiming | undefined> {
  const text = await findClaudeTranscript(homeDir, cliSessionId)
  if (text === undefined) return undefined
  const streams: LocalAgentMemberModelTiming['streams'] = {}
  const requestStarts: NonNullable<LocalAgentMemberModelTiming['requestStarts']> = {}
  const toolTimings: LocalAgentMemberModelTiming['toolTimings'] = {}
  let turn = 0
  let round: string[] = []
  let native = false
  let turnStartedAt: number | undefined
  let pendingRequestAt: number | undefined
  let nativeRequestStarts = new Map<string, number>()
  const consume = () => {
    if (round.length === 0) return
    if (!native) turn += 1
    const parsed = parseClaudeStreamJson(round.join('\n'))
    const groups = groupClaudeTranscriptLines(parsed.lines)
    for (const [index, group] of groups.entries()) {
      const key = `${turn}:${index + 1}`
      const stream = claudeStreamFromLines(group)
      if (stream.length > 0) streams[key] = stream
      const messageId = group[0]?.messageId
      const startedAt = (messageId === undefined ? undefined : nativeRequestStarts.get(messageId)) ?? group[0]?.generation?.startedAt
      if (startedAt !== undefined) requestStarts[key] = startedAt
    }
    for (const line of parsed.lines) {
      if (line.kind === 'tool' && line.timing !== undefined) toolTimings[line.id] = line.timing
    }
    round = []
    nativeRequestStarts = new Map()
  }
  for (const raw of text.split('\n')) {
    if (raw.trim() === '') continue
    let event: {
      type?: unknown
      operation?: unknown
      timestamp?: unknown
      message?: { id?: unknown }
    }
    try {
      event = JSON.parse(raw) as typeof event
    } catch {
      continue
    }
    const at = typeof event.timestamp === 'string' ? Date.parse(event.timestamp) : Number.NaN
    if (event.type === 'queue-operation' && event.operation === 'dequeue') {
      consume()
      if (native) turn += 1
      else {
        native = true
        turn = 1
      }
      turnStartedAt = Number.isFinite(at) ? at : undefined
      pendingRequestAt = undefined
    } else if (native && event.type === 'api-request' && Number.isFinite(at)) {
      pendingRequestAt = at
    } else if (native && event.type === 'assistant' && typeof event.message?.id === 'string'
      && !nativeRequestStarts.has(event.message.id)) {
      const startedAt = pendingRequestAt ?? turnStartedAt
      if (startedAt !== undefined) nativeRequestStarts.set(event.message.id, startedAt)
    }
    round.push(raw)
    if (!native && event.type === 'result') consume()
  }
  consume()
  return { streams, requestStarts, toolTimings }
}
